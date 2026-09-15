import {ApiError} from './catalog.mjs';

export function mailLimits(env=process.env){
  const number=(key,fallback)=>{
    const raw=env[key];if(raw===undefined||raw==='')return fallback;
    const n=Number(raw);if(!/^\d+$/.test(raw)||!Number.isSafeInteger(n)||n<1||n>1000000)throw new ApiError(503,'邮件限流配置有误，请联系管理员');return n;
  };
  return {registrationMinute:number('REGISTRATION_REQUEST_IP_PER_MINUTE',120),ipMinute:number('MAIL_REQUEST_IP_PER_MINUTE',120),ipBurst:number('MAIL_REQUEST_IP_BURST',30),
    visitorMinute:number('MAIL_REQUEST_VISITOR_PER_MINUTE',20),cooldown:number('MAIL_CODE_COOLDOWN_SECONDS',60),
    visitorHour:number('MAIL_VISITOR_PER_HOUR',10),emailHour:number('MAIL_EMAIL_PER_HOUR',10),
    globalHour:number('MAIL_GLOBAL_PER_HOUR',200),globalDay:number('MAIL_GLOBAL_PER_DAY',1000)};
}
function limited(retryAfter,message){
  const error=new ApiError(429,message,'MAIL_RATE_LIMITED');error.retryAfter=Math.max(1,Math.ceil(retryAfter));return error;
}
function atomic(db,fn){db.exec('BEGIN IMMEDIATE');try{const result=fn();db.exec('COMMIT');return result;}catch(e){db.exec('ROLLBACK');throw e;}}
function take(db,rules,now){
  const checked=rules.map(([key,max,ms,message])=>({key,max,ms,message,row:db.prepare('SELECT count,reset_at FROM auth_attempts WHERE key=?').get(key)}));
  const blocked=checked.filter(r=>r.row?.reset_at>now&&r.row.count>=r.max).sort((a,b)=>b.row.reset_at-a.row.reset_at);
  if(blocked.length)throw limited((blocked[0].row.reset_at-now)/1000,blocked[0].message);
  return checked.map(({key,ms,row})=>{
    const active=row?.reset_at>now,resetAt=active?row.reset_at:now+ms;
    db.prepare('INSERT INTO auth_attempts VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET count=excluded.count,reset_at=excluded.reset_at').run(key,active?row.count+1:1,resetAt);
    return {key,resetAt};
  });
}
export function checkMailRequests(db,ip,user,limits){
  return atomic(db,()=>{db.prepare('DELETE FROM auth_attempts WHERE reset_at<=?').run(Date.now());return take(db,[
    [`mail-request-user:${user}`,limits.visitorMinute,60000,'请求较频繁，请稍后重试'],
    [`mail-request-ip:${ip}`,limits.ipMinute,60000,'当前网络请求较频繁，请稍后重试'],
    [`mail-request-burst:${ip}`,limits.ipBurst,10000,'当前网络请求较集中，请稍后重试'],
  ],Date.now());});
}
export function reserveMail(db,user,emailHash,limits,willSend,createChallenge){
  return atomic(db,()=>{
    const rules=[[`mail-cooldown:${emailHash}`,1,limits.cooldown*1000,'验证码已请求，请稍后重发']];
    if(willSend)rules.push(
      [`mail-user:${user}`,limits.visitorHour,3600000,'本小时验证码请求较多，请稍后重试'],
      [`mail-email:${emailHash}`,limits.emailHour,3600000,'此邮箱本小时验证码请求较多，请稍后重试'],
      ['mail-global:hour',limits.globalHour,3600000,'网站发信较繁忙，请稍后重试'],
      ['mail-global:day',limits.globalDay,86400000,'网站发信较繁忙，请稍后重试'],
    );
    const reservations=take(db,rules,Date.now());createChallenge();return reservations;
  });
}
export function refundMail(db,reservations){
  atomic(db,()=>{for(const {key,resetAt}of reservations){
    // Preserve cooldown against repeated failures; never decrement a newer window.
    if(key.startsWith('mail-cooldown:'))continue;
    db.prepare('UPDATE auth_attempts SET count=MAX(0,count-1) WHERE key=? AND reset_at=?').run(key,resetAt);
  }});
}
