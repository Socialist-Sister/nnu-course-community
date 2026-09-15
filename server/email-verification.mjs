import {randomInt,randomUUID,timingSafeEqual} from 'node:crypto';
import {ApiError} from './catalog.mjs';
import {digest,requireAccount} from './accounts.mjs';
import {clientIp} from './client-ip.mjs';
import {mailLimits,checkMailRequests,reserveMail,refundMail} from './mail-limits.mjs';
export const emailDomains=['njnu.edu.cn'];
export function normalizeEmail(value){
  if(typeof value!=='string')throw new ApiError(400,'请填写校园邮箱');
  const email=value.trim().toLowerCase();
  const [local,domain,...extra]=email.split('@');
  if(email.length>254||!local||local.length>64||extra.length||!emailDomains.includes(domain)||!/^\w(?:[\w.+-]*[\w+-])?$/.test(local)||local.includes('..'))throw new ApiError(400,'请使用 @njnu.edu.cn 校园邮箱');
  return email;
}
export async function sendEmailCode(db,person,data,req,mailer,limits=mailLimits()){
  checkMailRequests(db,clientIp(req),person.userId,limits);
  const email=normalizeEmail(data.email),purpose=data.purpose;
  if(!['register','recover','bind'].includes(purpose))throw new ApiError(400,'验证码用途无效');
  if(purpose==='register'&&person.account)throw new ApiError(409,'请先退出当前账号');
  if(purpose==='bind'){requireAccount(person);if(person.account.emailVerified)throw new ApiError(409,'校园邮箱已验证，无需重复绑定');}
  if(!mailer.ready)throw new ApiError(503,'邮件服务暂未开通，请稍后再试');
  const account=db.prepare('SELECT * FROM accounts WHERE email=?').get(email),id=randomUUID(),now=Date.now();
  db.prepare('DELETE FROM email_challenges WHERE expires_at<?').run(now);
  // Registration explicitly points existing members to login; recovery remains neutral.
  if(purpose==='register'&&account)throw new ApiError(409,'该邮箱已注册，请登录','EMAIL_ALREADY_REGISTERED');
  const response={challengeId:id,retryAfter:limits.cooldown,message:'若邮箱符合条件，验证码将发送至该邮箱，请检查收件箱和垃圾邮件。'};
  const willSend=!((purpose==='recover'&&!account?.email_verified_at)||(purpose==='bind'&&account));
  const code=String(randomInt(0,1000000)).padStart(6,'0');
  const reservations=reserveMail(db,person.userId,digest(email),limits,willSend,()=>{
    if(!willSend)return;
    db.prepare('DELETE FROM email_challenges WHERE email=? AND purpose=? AND requester_id=?').run(email,purpose,person.userId);
    db.prepare('INSERT INTO email_challenges(id,email,purpose,requester_id,account_id,password_version,code_hash,expires_at,created_at) VALUES(?,?,?,?,?,?,?,?,?)')
      .run(id,email,purpose,person.userId,purpose==='bind'?person.account.id:account?.user_id||null,account?.password_hash||null,digest(id+':'+code),now+600000,now);
  });
  if(!willSend)return response;
  try{await mailer.send({email,code,purpose});db.prepare('UPDATE email_challenges SET delivered=1 WHERE id=?').run(id);}
  catch(e){db.prepare('DELETE FROM email_challenges WHERE id=?').run(id);if(e.mailDefinitelyNotSent)refundMail(db,reservations);e.retryAfter??=limits.cooldown;throw e;}
  return response;
}
export function checkEmailCode(db,person,purpose,data){
  const email=normalizeEmail(data.email),id=typeof data.challengeId==='string'?data.challengeId:'';
  const row=db.prepare('SELECT * FROM email_challenges WHERE id=? AND email=? AND purpose=? AND requester_id=?').get(id,email,purpose,person.userId);
  if(!row||!row.delivered||row.expires_at<=Date.now()||row.attempts>=5)throw new ApiError(400,'验证码无效或已过期，请重新获取');
  const provided=typeof data.emailCode==='string'?data.emailCode.trim():'';
  if(!/^\d{6}$/.test(provided)||!timingSafeEqual(Buffer.from(digest(id+':'+provided),'hex'),Buffer.from(row.code_hash,'hex'))){
    db.prepare('UPDATE email_challenges SET attempts=attempts+1 WHERE id=?').run(id);
    throw new ApiError(400,'验证码不正确，请重新输入');
  }
  return row;
}
// Call inside the transaction that creates/binds/resets the account; failed writes roll it back.
export function consumeEmailCode(db,proof){
  const result=db.prepare('DELETE FROM email_challenges WHERE id=? AND code_hash=? AND delivered=1 AND attempts<5 AND expires_at>?').run(proof.id,proof.code_hash,Date.now());
  if(!result.changes)throw new ApiError(409,'验证码已使用或失效，请重新获取');
}
