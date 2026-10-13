// Run by the current Windows user, not the Codex sandbox identity.
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {existsSync,mkdirSync,readFileSync,writeFileSync,renameSync,readdirSync,unlinkSync,openSync,closeSync,statSync,lstatSync} from 'node:fs';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {encryptBackup,decryptBackup,writeNew} from './portable-backup.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),folder=join(root,'local-backups');
if(!existsSync(folder))throw Error('Run install-local-backup.ps1 first to create the private folder.');
if(lstatSync(folder).isSymbolicLink())throw Error('Backup folder must not be a link.');
const config=JSON.parse(readFileSync(join(folder,'config.json'),'utf8'));
const metadataFile=join(folder,'status.json'),status=existsSync(metadataFile)?JSON.parse(readFileSync(metadataFile,'utf8')):{};
const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai'}).format(new Date());
const recoveryKit=join(folder,'recovery-kit'),publicKeyFile=join(recoveryKit,'public.pem'),privateKeyFile=join(recoveryKit,'recovery-private.pem');
const portableReady=existsSync(publicKeyFile)?(status.portableFile&&/^[\w.-]+$/.test(status.portableFile)&&existsSync(join(folder,status.portableFile))):!status.portableFile;
if(!process.argv.includes('--force')&&status.lastSuccessDate===today&&status.latestFile&&/^[\w.-]+$/.test(status.latestFile)&&existsSync(join(folder,status.latestFile))&&portableReady){console.log('Today already has a verified backup.');process.exit(0);}
const lock=join(folder,'running.lock');let lockFd;
try{lockFd=openSync(lock,'wx',0o600);writeFileSync(lockFd,String(process.pid));}
catch(e){if(e.code!=='EEXIST')throw e;const pid=Number(readFileSync(lock,'utf8'));let alive=false;try{if(Number.isInteger(pid)&&pid>0){process.kill(pid,0);alive=true;}}catch(e){if(e.code!=='ESRCH')alive=true;}if(alive){console.log('A backup is already running.');process.exit(0);}unlinkSync(lock);lockFd=openSync(lock,'wx',0o600);writeFileSync(lockFd,String(process.pid));}
function run(exe,args,{outputFile}={}){return new Promise((resolve,reject)=>{
  const fd=outputFile?openSync(outputFile,'wx',0o600):null;
  const child=spawn(exe,args,{windowsHide:true,stdio:['ignore',fd??'pipe','pipe']});let out='',err='';
  child.stdout?.on('data',v=>{out+=v;if(out.length>100000)child.kill();});child.stderr.on('data',v=>err=(err+v).slice(-4000));
  const timer=setTimeout(()=>{child.kill();},180000);let finished=false;
  const finish=(error)=>{if(finished)return;finished=true;clearTimeout(timer);if(fd!==null)closeSync(fd);error?reject(error):resolve(out);};
  child.on('error',finish);
  child.on('close',code=>finish(code===0?null:Error(err.trim()||'Backup command failed: '+code)));
});}
const sshArgs=['-i',config.keyPath,'-o','UserKnownHostsFile="'+config.knownHostsPath.replaceAll('\\','/')+'"','-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o','ConnectTimeout=15','-o','ServerAliveInterval=10','-o','ServerAliveCountMax=3',...(config.hostKeyAlias?['-o','HostKeyAlias='+config.hostKeyAlias]:[]),config.target];
const ssh=command=>run(config.sshPath,[...sshArgs,command]);
const tmp=join(folder,'download-'+process.pid+'.sqlite.part'),encrypted=join(folder,'encrypted-'+process.pid+'.part'),check=join(folder,'check-'+process.pid+'.sqlite.part');
const portableTemp=join(folder,'portable-'+process.pid+'.part');
const hash=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
function verify(path){const db=new DatabaseSync(path,{readOnly:true,timeout:5000});try{if(db.prepare('PRAGMA integrity_check').get().integrity_check!=='ok'||db.prepare('PRAGMA foreign_key_check').all().length)throw Error('SQLite integrity verification failed.');return Object.fromEntries(['courses','accounts','reviews'].map(t=>[t,db.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n]));}finally{db.close();}}
function saveStatus(value){const temp=metadataFile+'.tmp';writeFileSync(temp,JSON.stringify(value,null,2),{mode:0o600});renameSync(temp,metadataFile);}
function safeDelete(path){if(dirname(resolve(path))!==folder)throw Error('Cleanup path outside backup directory.');if(existsSync(path)){if(lstatSync(path).isSymbolicLink())throw Error('Refusing to clean a symbolic link.');unlinkSync(path);}}
try{
  if(status.portableFile&&!existsSync(publicKeyFile))throw Error('Portable backup public key is missing; restore the original recovery-kit/public.pem.');
  // A power loss can bypass finally. With the exclusive lock held, remove only
  // our old temporary files whose producing process no longer exists.
  for(const entry of readdirSync(folder)){
    const match=entry.match(/^(?:download|encrypted|check|portable)-(\d+)\.(?:sqlite\.)?part(?:-wal|-shm)?$/);
    if(!match)continue;
    const path=join(folder,entry),info=lstatSync(path),pid=Number(match[1]);
    if(!info.isFile()||Date.now()-info.mtimeMs<86400000||!Number.isSafeInteger(pid)||pid<=0)continue;
    try{process.kill(pid,0);continue;}catch(e){if(e.code!=='ESRCH')continue;}
    safeDelete(path);
  }
  const name=(await ssh('sudo -n systemctl start nnu-backup.service && sudo -n find /var/lib/nnu-course/backups -maxdepth 1 -type f -name "catalog-*.sqlite" -printf "%f\\n" | sort | tail -n 1')).trim();
  if(!/^catalog-\d{4}-\d{2}-\d{2}T[\d.-]+Z\.sqlite$/.test(name))throw Error('Unexpected remote backup name.');
  const remote='/var/lib/nnu-course/backups/'+name;
  const expected=(await ssh('sudo -n sha256sum '+remote)).trim().split(/\s+/)[0];if(!/^[a-f0-9]{64}$/.test(expected))throw Error('Missing remote checksum.');
  await run(config.sshPath,[...sshArgs,'sudo -n cat '+remote],{outputFile:tmp});
  if(hash(tmp)!==expected)throw Error('Download checksum mismatch.');const counts=verify(tmp);
  const protect=(mode,input,output)=>run(config.powershellPath,['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',join(root,'deploy/protect-backup.ps1'),'-Mode',mode,'-InputPath',input,'-OutputPath',output]);
  await protect('Encrypt',tmp,encrypted);await protect('Decrypt',encrypted,check);
  if(hash(check)!==expected)throw Error('Encrypted backup round-trip verification failed.');verify(check);
  let portableFile=null,portableRoundTrip=false;
  if(existsSync(publicKeyFile)){
    const bytes=encryptBackup(readFileSync(tmp),readFileSync(publicKeyFile));
    writeNew(portableTemp,bytes);
    if(existsSync(privateKeyFile)){
      const recovered=decryptBackup(readFileSync(portableTemp),readFileSync(privateKeyFile));
      if(createHash('sha256').update(recovered).digest('hex')!==expected)throw Error('Portable backup round-trip failed.');
      portableRoundTrip=true;
    }
    portableFile=name+'.nnu-backup';renameSync(portableTemp,join(folder,portableFile));
  }
  const final=name+'.dpapi';renameSync(encrypted,join(folder,final));
  const records=readdirSync(folder).filter(n=>/^catalog-\d{4}-\d{2}-\d{2}T[\d.-]+Z\.sqlite\.dpapi$/.test(n)).sort();
  for(const old of records.slice(0,-30))safeDelete(join(folder,old));
  const portableRecords=readdirSync(folder).filter(n=>/^catalog-\d{4}-\d{2}-\d{2}T[\d.-]+Z\.sqlite\.nnu-backup$/.test(n)).sort();
  for(const old of portableRecords.slice(0,-30))safeDelete(join(folder,old));
  const result={...status,lastAttemptAt:new Date().toISOString(),lastAttempt:'success',lastError:null,lastSuccessAt:new Date().toISOString(),lastSuccessDate:today,latestFile:final,bytes:statSync(join(folder,final)).size,sha256:expected,counts,verified:true,retention:30,portableFile,portableRoundTrip};saveStatus(result);console.log(JSON.stringify(result));
}catch(e){saveStatus({...status,lastAttemptAt:new Date().toISOString(),lastAttempt:'failed',lastError:String(e.message).slice(0,1500)});console.error('Local backup failed. See local-backups/status.json. Existing backups preserved.');process.exitCode=1;}
finally{for(const path of [tmp,tmp+'-wal',tmp+'-shm',encrypted,portableTemp,check,check+'-wal',check+'-shm'])safeDelete(path);closeSync(lockFd);safeDelete(lock);}
