import {readFileSync,writeFileSync,renameSync,readdirSync,statSync,statfsSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {request} from 'node:https';
import nodemailer from 'nodemailer';
import {evaluateOps,planNotifications,markNotified} from './ops-checks.mjs';
const statePath='/var/lib/nnu-ops/state.json';
const env=process.env,recipient=env.OPS_ALERT_TO;
if(!recipient||!/^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/.test(recipient))throw Error('Configure one OPS_ALERT_TO recipient');
const checkErrors=[];
function service(name){try{const text=execFileSync('systemctl',['show',name,'-p','ActiveState','-p','Result'],{encoding:'utf8',timeout:3000});return Object.fromEntries(text.trim().split('\n').map(s=>s.split('=')));}catch{checkErrors.push(name);return {};}}
async function httpsHealth(){return new Promise(resolve=>{const req=request({hostname:'127.0.0.1',port:443,servername:'nnucr.cn',headers:{Host:'nnucr.cn'},path:'/api/health',timeout:5000},res=>{const certExpiresAt=Date.parse(res.socket.getPeerCertificate().valid_to);let body='';res.on('data',chunk=>body+=chunk);res.on('end',()=>{try{resolve({httpsHealthy:res.statusCode===200&&JSON.parse(body).status==='ok',certExpiresAt});}catch{resolve({httpsHealthy:false,certExpiresAt});}});});req.on('timeout',()=>req.destroy());req.on('error',()=>resolve({httpsHealthy:false}));req.end();});}
const now=Date.now(),services={};
for(const name of ['nnu-course','nginx'])services[name]={active:service(name+'.service').ActiveState};
for(const name of ['nnu-backup','nnu-cert-renew','logrotate'])services[name]={timer:service(name+'.timer').ActiveState,result:service(name+'.service').Result};
let appHealthy=false;try{const r=await fetch('http://127.0.0.1:4180/api/health',{signal:AbortSignal.timeout(5000)});appHealthy=r.ok&&(await r.json()).status==='ok';}catch{}
const directory='/var/lib/nnu-course/backups';let latestBackupAt=0,diskPercent=null;
try{const disk=statfsSync('/var/lib/nnu-course');diskPercent=Math.ceil(100*(disk.blocks-disk.bavail)/disk.blocks);}catch{checkErrors.push('disk');}
try{const backups=readdirSync(directory).filter(n=>/^catalog-\d{4}-\d{2}-\d{2}T[\d.-]+Z\.sqlite$/.test(n));latestBackupAt=Math.max(0,...backups.map(n=>statSync(join(directory,n)).mtimeMs));}catch{checkErrors.push('backup-directory');}
const sample={services,appHealthy,...await httpsHealth(),diskPercent,latestBackupAt,checkErrors};
const config={domainExpiresOn:env.OPS_DOMAIN_EXPIRES_ON,azureExpiresOn:env.OPS_AZURE_EXPIRES_ON};
const issues=evaluateOps(sample,config,now),previous=existsSync(statePath)?JSON.parse(readFileSync(statePath,'utf8')):{};
const plan=planNotifications(previous,issues,now,Number(env.OPS_BILLING_REVIEW_DAYS||30));
if(process.argv.includes('--test'))plan.notify.push({id:'test',level:'info',kind:'test',message:'这是一封运维提醒测试邮件。收到它表示发送通道可用，不表示网站发生故障。'});
if(process.argv.includes('--dry-run')){console.log(JSON.stringify({issues,plannedNotifications:plan.notify.map(n=>({id:n.id,kind:n.kind})),emailSent:false}));process.exit(0);}
let state=plan.next;
if(plan.notify.length){
  const transport=nodemailer.createTransport({host:env.SMTP_HOST,port:Number(env.SMTP_PORT||465),secure:Number(env.SMTP_PORT||465)===465,requireTLS:true,auth:{user:env.SMTP_USER,pass:env.SMTP_PASS},connectionTimeout:8000,greetingTimeout:8000,socketTimeout:10000,logger:false,debug:false,disableFileAccess:true,disableUrlAccess:true});
  try{
    const result=await transport.sendMail({from:env.MAIL_FROM,to:recipient,subject:plan.notify.some(n=>n.kind==='test')?'南师选课簿：运维提醒测试':'南师选课簿：运维状态提醒',text:`检查时间：${new Date(now).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'})}\n\n`+plan.notify.map(n=>`[${n.kind==='recovery'?'恢复':n.level}] ${n.message}`).join('\n')+'\n\n网址：https://nnucr.cn/\n详情：服务器 journalctl -u nnu-ops.service\n同机监控无法在整机断网或停机时发送提醒，仍需独立外部监控。'});
    if(!result.accepted?.length)throw Error('Recipient rejected');state=markNotified(plan,now);
  }catch{console.error('Operational alert delivery failed; notification state was not advanced.');process.exitCode=1;state=previous;}
}
const temporary=statePath+'.tmp';writeFileSync(temporary,JSON.stringify(state),{mode:0o600});renameSync(temporary,statePath);
console.log(JSON.stringify({checkedAt:new Date(now).toISOString(),issues:issues.map(i=>i.id),notifications:plan.notify.length,deliveryFailed:!!process.exitCode}));
