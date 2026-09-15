import {loadEnvFile} from 'node:process';
import {existsSync} from 'node:fs';
import {resolve} from 'node:path';
import nodemailer from 'nodemailer';
import {root} from '../server/database.mjs';
import {normalizeEmail} from '../server/email-verification.mjs';

const envPath=resolve(root,'.env');if(existsSync(envPath))loadEnvFile(envPath);
let transport;
try{
  const email=normalizeEmail(process.argv[2]);
  for(const key of ['SMTP_HOST','SMTP_USER','SMTP_PASS','MAIL_FROM'])if(!process.env[key])throw Error('SMTP_CONFIG_MISSING');
  const port=Number(process.env.SMTP_PORT||465);
  if(!Number.isInteger(port)||port<1||port>65535)throw Error('SMTP_PORT_INVALID');
  transport=nodemailer.createTransport({host:process.env.SMTP_HOST,port,secure:port===465,requireTLS:true,
    auth:{user:process.env.SMTP_USER,pass:process.env.SMTP_PASS},connectionTimeout:8000,greetingTimeout:8000,socketTimeout:10000,
    logger:false,debug:false,disableFileAccess:true,disableUrlAccess:true});
  await transport.verify();
  console.log('SMTP authentication: OK');
  const sent=await transport.sendMail({from:process.env.MAIL_FROM,to:email,subject:'南师选课簿：邮件发送测试',
    text:'这是一封由你请求发送的南师选课簿测试邮件，用于确认网站能向校园邮箱发送邮件。\n\n此邮件不包含有效验证码，不会创建账号或更改密码。收到后可回到对话确认收信。\n\n南师选课簿 · 学生自发建设，非学校官方网站'});
  if(!sent.accepted?.length)throw Error('SMTP_RECIPIENT_REJECTED');
  console.log('SMTP accepted the test message. Inbox delivery still needs recipient confirmation.');
}catch(error){
  // Never print credentials, raw SMTP responses, or recipient addresses.
  console.error(JSON.stringify({status:'failed',code:error.code||(['SMTP_CONFIG_MISSING','SMTP_PORT_INVALID','SMTP_RECIPIENT_REJECTED'].includes(error.message)?error.message:'SMTP_TEST_FAILED'),responseCode:error.responseCode||null}));
  process.exitCode=1;
}finally{transport?.close();}
