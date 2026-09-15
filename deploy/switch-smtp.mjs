// Run as root on the VM. Authenticate the new sender before replacing config.
import {readFileSync,writeFileSync,renameSync} from 'node:fs';
import {parseEnv} from 'node:util';
import {execFileSync} from 'node:child_process';
import nodemailer from 'nodemailer';

const envPath='/etc/nnu-course/app.env';
const secretPath='/home/azureuser/nnu-upload/aliyun-smtp.password';
const oldText=readFileSync(envPath,'utf8');
const password=readFileSync(secretPath,'utf8').replace(/^\uFEFF/,'').replace(/[\r\n]+$/,'');
if(!password.trim()||/[\r\n\0]/.test(password))throw Error('Invalid SMTP password file format');
const config={...parseEnv(oldText),SMTP_HOST:'smtpdm.aliyun.com',SMTP_PORT:'465',SMTP_USER:'noreply@mail.nnucr.cn',SMTP_PASS:password,MAIL_FROM:'南师选课簿 <noreply@mail.nnucr.cn>'};
const transport=nodemailer.createTransport({host:config.SMTP_HOST,port:465,secure:true,requireTLS:true,
  auth:{user:config.SMTP_USER,pass:password},connectionTimeout:10000,greetingTimeout:10000,socketTimeout:10000,
  logger:false,debug:false,disableFileAccess:true,disableUrlAccess:true});
try {
  await transport.verify();
  console.log('Aliyun SMTP TLS connection and authentication: OK; no email sent.');
} catch(error) {
  console.error(JSON.stringify({status:'authentication-failed',code:/^[A-Z_]+$/.test(error.code||'')?error.code:'SMTP_ERROR',responseCode:error.responseCode||null}));
  process.exitCode=1;
} finally {transport.close();}
if(process.exitCode)process.exit(process.exitCode);
if(!process.argv.includes('--apply'))process.exit(0);
const stamp=new Date().toISOString().replaceAll(':','-');
writeFileSync(envPath+'.before-aliyun-'+stamp,oldText,{mode:0o600,flag:'wx'});
const candidate=envPath+'.pending-aliyun';
writeFileSync(candidate,Object.entries(config).map(([key,value])=>`${key}=${JSON.stringify(value)}`).join('\n')+'\n',{mode:0o600});
renameSync(candidate,envPath);
async function healthy(){
  for(let attempt=0;attempt<12;attempt++){
    try{const r=await fetch('http://127.0.0.1:4180/api/health',{signal:AbortSignal.timeout(1500)});if(r.ok&&(await r.json()).database==='ready')return true;}catch{}
    await new Promise(r=>setTimeout(r,500));
  }
  return false;
}
try{
  execFileSync('/bin/systemctl',['restart','nnu-course'],{stdio:'ignore',timeout:30000});
  if(!await healthy())throw Error('Service health check failed');
  const session=await fetch('http://127.0.0.1:4180/api/session',{signal:AbortSignal.timeout(3000)});
  if(!session.ok||!(await session.json()).mailReady)throw Error('Mail configuration is not ready');
  console.log('Server switched to noreply@mail.nnucr.cn; application healthy. Previous config retained privately.');
}catch{
  writeFileSync(candidate,oldText,{mode:0o600});renameSync(candidate,envPath);
  execFileSync('/bin/systemctl',['restart','nnu-course'],{stdio:'ignore',timeout:30000});
  console.error('Switch failed; previous SMTP configuration restored.');
  process.exitCode=1;
}
