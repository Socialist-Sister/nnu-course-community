import {test} from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../server/database.mjs';
import {sendEmailCode} from '../server/email-verification.mjs';
import {clientIp} from '../server/client-ip.mjs';
import {testMailbox} from './mail-fixture.mjs';
import {mailLimits,reserveMail,refundMail} from '../server/mail-limits.mjs';
import {ApiError} from '../server/catalog.mjs';
import {createApp} from '../server/index.mjs';
import {definitelyNotSent} from '../server/mailer.mjs';

function fixture(t,env={}){
  const db=openDatabase(':memory:'),mailer=testMailbox();t.after(()=>db.close());
  const send=(user,email,ip='192.0.2.1')=>sendEmailCode(db,{userId:user,account:null},{email:email+'@njnu.edu.cn',purpose:'register'},{socket:{remoteAddress:ip},headers:{}},mailer,mailLimits(env));
  return {db,mailer,send,expire:pattern=>db.prepare('UPDATE auth_attempts SET reset_at=0 WHERE key LIKE ?').run(pattern)};
}
test('校园共享出口一分钟内100位访客正常发信，不再受旧20次上限影响',async t=>{
  const f=fixture(t);let now=Date.now();t.mock.method(Date,'now',()=>now);
  for(let i=0;i<100;i++){await f.send('u'+i,'student'+i);now+=500;}
  assert.equal(f.mailer.messages.length,100);
});
test('共享出口突发和分钟保护返回等待时间，过期恢复',async t=>{
  const f=fixture(t);let now=Date.now();t.mock.method(Date,'now',()=>now);
  const results=await Promise.allSettled(Array.from({length:31},(_,i)=>f.send('u'+i,'student'+i)));
  assert.equal(results.filter(r=>r.status==='fulfilled').length,30);
  assert.equal(results.at(-1).reason.retryAfter,10);
  now+=10001;await f.send('again','again');
  const minute=fixture(t,{MAIL_REQUEST_IP_BURST:'1000'});
  for(let i=0;i<120;i++)await minute.send('u'+i,'e'+i);
  await assert.rejects(minute.send('last','last'),e=>e.status===429&&e.retryAfter===60);
  now+=60001;await minute.send('last','last');
});
test('同邮箱并发换访客和出口仍仅发送一次，冷却结束可重发且旧验证码失效',async t=>{
  const f=fixture(t);
  const results=await Promise.allSettled(Array.from({length:8},(_,i)=>f.send('u'+i,'shared','192.0.2.'+(i+1))));
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(f.mailer.messages.length,1);
  f.expire('mail-cooldown:%');await f.send('u0','shared');
  assert.equal(f.mailer.messages.length,2);
  assert.equal(f.db.prepare('SELECT count(*) n FROM email_challenges').get().n,1);
});
test('邮箱每小时10次上限跨访客和IP有效，时间窗结束恢复',async t=>{
  const f=fixture(t);
  for(let i=0;i<10;i++){f.expire('mail-cooldown:%');await f.send('u'+i,'same','192.0.2.'+(i+1));}
  f.expire('mail-cooldown:%');await assert.rejects(f.send('last','same','192.0.2.99'),e=>e.status===429);
  f.expire('mail-%');await f.send('last','same','192.0.2.99');assert.equal(f.mailer.messages.length,11);
});
test('同一访客每小时10次上限不能通过换邮箱和IP绕过',async t=>{
  const f=fixture(t);for(let i=0;i<10;i++)await f.send('same','email'+i,'192.0.2.'+(i+1));
  await assert.rejects(f.send('same','another','192.0.2.99'),e=>e.status===429);
});
test('冷却期重复点击不再扣发信额度，同出口正常同学仍可发送',async t=>{
  const f=fixture(t);await f.send('first','first');
  for(let i=1;i<20;i++)await assert.rejects(f.send('retry'+i,'first'),e=>e.status===429);
  await f.send('innocent','new-student');
  assert.equal(f.mailer.messages.length,2);
  assert.equal(f.db.prepare("SELECT count FROM auth_attempts WHERE key='mail-global:hour'").get().count,2);
});

test('全站额度在异步邮件发送前原子预占，达到上限不会超发，也不扣被拒邮箱额度',async t=>{
  const f=fixture(t,{MAIL_GLOBAL_PER_HOUR:'3'});let release;const pending=new Promise(r=>release=r);
  f.mailer.send=async message=>{f.mailer.messages.push(message);await pending;};
  const outcomes=Array.from({length:10},(_,i)=>f.send('u'+i,'e'+i,'192.0.2.'+(i+1)).then(()=>200,e=>e.status));
  assert.equal(f.mailer.messages.length,3);assert.equal(f.db.prepare('SELECT count(*) n FROM email_challenges').get().n,3);
  release();assert.deepEqual(await Promise.all(outcomes),[200,200,200,429,429,429,429,429,429,429]);
  f.expire('mail-global:hour');await f.send('u4','e4','192.0.2.5');
});
test('全站24小时额度独立于小时额度；不同访客与出口不能绕过',async t=>{
  const f=fixture(t,{MAIL_GLOBAL_PER_DAY:'2'});await f.send('u1','e1');await f.send('u2','e2');f.expire('mail-global:hour');
  await assert.rejects(f.send('u3','e3','192.0.2.9'),e=>e.status===429&&e.retryAfter>3600);
  f.expire('mail-global:day');await f.send('u3','e3');
});
test('明确发信失败退回发送额度，冷却保留；不确定是否发送则保留额度',async t=>{
  const f=fixture(t,{MAIL_GLOBAL_PER_HOUR:'1'});
  f.mailer.send=async()=>{throw Object.assign(new ApiError(503,'模拟拒绝'),{mailDefinitelyNotSent:true});};
  await assert.rejects(f.send('u1','e1'),e=>e.status===503&&e.retryAfter===60);
  assert.equal(f.db.prepare("SELECT count FROM auth_attempts WHERE key='mail-global:hour'").get().count,0);
  assert.equal(f.db.prepare('SELECT count(*) n FROM email_challenges').get().n,0);
  await assert.rejects(f.send('u1','e1'),e=>e.status===429);
  f.mailer.send=async()=>{throw new ApiError(503,'模拟DATA超时');};await assert.rejects(f.send('u2','e2'),e=>e.status===503);
  await assert.rejects(f.send('u3','e3'),e=>e.status===429);
});
test('跨窗口退款不误减新额度，创建验证码失败会回滚整笔预占',t=>{
  let now=Date.now();t.mock.method(Date,'now',()=>now);
  const f=fixture(t),limits=mailLimits({}),old=reserveMail(f.db,'u','e',limits,true,()=>{});
  now+=86400001;reserveMail(f.db,'u','e',limits,true,()=>{});refundMail(f.db,old);
  assert.equal(f.db.prepare("SELECT count FROM auth_attempts WHERE key='mail-global:hour'").get().count,1);
  const before=f.db.prepare('SELECT * FROM auth_attempts ORDER BY key').all();
  assert.throws(()=>reserveMail(f.db,'other','other',limits,true,()=>{throw Error('insert failed');}),/insert failed/);
  assert.deepEqual(f.db.prepare('SELECT * FROM auth_attempts ORDER BY key').all(),before);
});
test('HTTP限流响应带Retry-After和JSON倒计时；已注册与无账号找回不占发信额度',async t=>{
  const f=fixture(t),server=createApp(f.db,{mailer:f.mailer});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));});
  const base='http://127.0.0.1:'+server.address().port,s=await fetch(base+'/api/session'),cookie=s.headers.get('set-cookie').split(';')[0],{csrf}=await s.json();
  const send=(email,purpose='register')=>fetch(base+'/api/account/send-code',{method:'POST',headers:{Cookie:cookie,'X-CSRF-Token':csrf,'Content-Type':'application/json'},body:JSON.stringify({email,purpose})});
  assert.equal((await send('unknown@njnu.edu.cn','recover')).status,200);
  assert.equal(f.db.prepare("SELECT count(*) n FROM auth_attempts WHERE key LIKE 'mail-global:%'").get().n,0);
  assert.equal((await send('student@njnu.edu.cn')).status,200);
  const limited=await send('student@njnu.edu.cn');assert.equal(limited.status,429);const data=await limited.json();assert.equal(Number(limited.headers.get('retry-after')),data.retryAfter);assert.ok(data.retryAfter>0&&data.retryAfter<=60);
  const time=new Date().toISOString();f.db.prepare('INSERT INTO users VALUES(?,?,?)').run('existing','匿名同学',time);
  f.db.prepare('INSERT INTO accounts(user_id,username,password_hash,recovery_hash,role,created_at,email) VALUES(?,?,?,?,?,?,?)').run('existing','existing','test','test','member',time,'existing@njnu.edu.cn');
  assert.equal((await send('existing@njnu.edu.cn')).status,409);
  assert.equal(f.db.prepare("SELECT count FROM auth_attempts WHERE key='mail-global:hour'").get().count,1);
});
test('环境配置可覆盖，非法数值不静默关闭限流',()=>{
  assert.equal(mailLimits({MAIL_GLOBAL_PER_HOUR:'500'}).globalHour,500);
  for(const value of ['0','-1','abc','2.5','Infinity'])assert.throws(()=>mailLimits({MAIL_GLOBAL_PER_DAY:value}),/配置有误/);
});
test('SMTP明确拒绝可退款，DATA超时或未知连接中断保守计数',()=>{
  for(const error of [{responseCode:550},{responseCode:421},{code:'EAUTH'},{code:'EDNS'},{command:'RCPT TO'},{code:'ETIMEDOUT',command:'CONN'}])assert.equal(definitelyNotSent(error),true);
  for(const error of [{code:'ETIMEDOUT',command:'DATA'},{code:'ECONNECTION'},{code:'ECONNRESET'},{}])assert.equal(definitelyNotSent(error),false);
});
test('非本机请求不能伪造代理IP头绕过限流',()=>{
  assert.equal(clientIp({socket:{remoteAddress:'192.0.2.1'},headers:{'x-real-ip':'192.0.2.2'}},{TRUST_LOCAL_PROXY:'1'}),'192.0.2.1');
  assert.equal(clientIp({socket:{remoteAddress:'127.0.0.1'},headers:{'x-real-ip':'192.0.2.2'}},{TRUST_LOCAL_PROXY:'1'}),'192.0.2.2');
});
