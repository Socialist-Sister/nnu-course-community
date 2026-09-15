// Campus-mail verification gates publishing; public reviews remain anonymous.
import {randomBytes,randomUUID,createHash,scrypt as scryptCallback,timingSafeEqual} from 'node:crypto';
import {promisify} from 'node:util';
import {adminAccess} from './admin-members.mjs';
import {clientIp} from './client-ip.mjs';
import {mailLimits} from './mail-limits.mjs';
import {writeFileSync,existsSync,readFileSync} from 'node:fs';
import {ApiError} from './catalog.mjs';
import {normalizeEmail,sendEmailCode,checkEmailCode,consumeEmailCode} from './email-verification.mjs';
import {createProfile,profileFields,validateNickname,normalizeAvatar,saveProfile} from './profiles.mjs';
const scrypt=promisify(scryptCallback);
export const digest=s=>createHash('sha256').update(s).digest('hex');
export function transaction(db,fn){db.exec('BEGIN IMMEDIATE');try{const result=fn();db.exec('COMMIT');return result;}catch(e){db.exec('ROLLBACK');throw e;}}
export function currentPerson(db,req){
  const raw=(req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith('nnu_visitor='))?.slice(12);
  if(!raw||!/^[a-f0-9]{64}$/.test(raw))return null;
  const row=db.prepare('SELECT user_id AS userId,csrf,token_hash AS tokenHash FROM visitor_sessions WHERE token_hash=? AND expires_at>?').get(digest(raw),Date.now());
  if(!row)return null;
  // Only sessions issued directly to the account may authenticate it. Old linked guest cookies are revoked.
  const account=db.prepare('SELECT user_id AS id,username,role,email,email_verified_at AS emailVerifiedAt FROM accounts WHERE user_id=?').get(row.userId);
  return {...row,account:account?{...account,...adminAccess(db,account.id),...profileFields(db,account.id),emailVerified:!!account.emailVerifiedAt}:null};
}
export function ownedIds(db,person){return person?.account?db.prepare('SELECT user_id FROM account_members WHERE account_id=?').all(person.account.id).map(r=>r.user_id):[person?.userId||''];}
export function requireAccount(person){if(!person?.account)throw new ApiError(401,'请先登录账号');return person;}
export function requireVerified(person){requireAccount(person);if(!person.account.emailVerified)throw new ApiError(403,'请先在账号页面验证校园邮箱');return person;}
export function requireAdmin(person){requireAccount(person);if(person.account.role!=='admin')throw new ApiError(403,'需要管理员权限');return person;}
export function newSession(db,res,req,userId){
  const token=randomBytes(32).toString('hex'),csrf=randomBytes(24).toString('hex');
  db.prepare('INSERT INTO visitor_sessions VALUES(?,?,?,?)').run(digest(token),userId,csrf,Date.now()+30*86400000);
  res.setHeader('Set-Cookie',`nnu_visitor=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=2592000${req.socket.encrypted||process.env.COOKIE_SECURE==='1'?'; Secure':''}`);
  return {csrf};
}
export function rateLimit(db,key,max=10,ms=15*60000){
  const now=Date.now();db.prepare('DELETE FROM auth_attempts WHERE reset_at<?').run(now);
  const row=db.prepare('SELECT * FROM auth_attempts WHERE key=?').get(key);
  if(row?.count>=max)throw new ApiError(429,'操作较频繁，请稍后重试');
  db.prepare('INSERT INTO auth_attempts VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1').run(key,now+ms);
}
function username(value){if(typeof value!=='string'||!/^[a-zA-Z0-9_]{3,32}$/.test(value.trim()))throw new ApiError(400,'用户名需为 3–32 位字母、数字或下划线');return value.trim().toLowerCase();}
function password(value){if(typeof value!=='string'||value.length<10||value.length>128)throw new ApiError(400,'密码需为 10–128 个字符');return value;}
async function encode(value){const salt=randomBytes(16).toString('hex'),hash=await scrypt(value,salt,64);return salt+':'+hash.toString('hex');}
async function matches(value,encoded){const [salt,hex]=encoded.split(':'),actual=await scrypt(value,salt,64);return timingSafeEqual(actual,Buffer.from(hex,'hex'));}
const recovery=()=>randomBytes(20).toString('hex').match(/.{1,8}/g).join('-');
const normalizeRecovery=s=>typeof s==='string'?s.replace(/[\s-]/g,'').toLowerCase():'';
function attachGuest(db,guest,accountId){
  if(!guest||guest.account||guest.userId===accountId)return 0;
  if(db.prepare('SELECT 1 FROM account_members WHERE user_id=?').get(guest.userId))return 0;
  db.prepare('INSERT INTO account_members VALUES(?,?)').run(guest.userId,accountId);
  db.prepare('DELETE FROM visitor_sessions WHERE user_id=?').run(guest.userId);
  return db.prepare('SELECT COUNT(*) AS n FROM reviews WHERE user_id=?').get(guest.userId).n;
}
export function accountDeletionInfo(db,person){
  requireAccount(person);
  const ids=[...new Set([person.userId,...ownedIds(db,person)])];
  const placeholders=ids.map(()=>'?').join(',');
  const lastAdmin=person.account.role==='admin'&&db.prepare("SELECT COUNT(*) n FROM accounts WHERE role='admin'").get().n<=1;
  return {reviewCount:db.prepare(`SELECT COUNT(*) n FROM reviews WHERE user_id IN (${placeholders})`).get(...ids).n,
    canDelete:!lastAdmin&&!adminAccess(db,person.account.id).isOwner,reason:adminAccess(db,person.account.id).isOwner?'站点负责人不能注销账号。':lastAdmin?'当前账号是唯一管理员，请先移交管理权限后再注销。':null};
}
export async function accountAction(db,req,res,person,action,data,mailer){
  if(action==='send-code')return sendEmailCode(db,person,data,req,mailer);
  const ip=clientIp(req);
  if(action==='register')rateLimit(db,`register-ip:${ip}`,mailLimits().registrationMinute,60000);
  if(['login','recover'].includes(action))rateLimit(db,`auth-ip:${ip}`,50);
  if(action==='register'){
    if(person.account)throw new ApiError(409,'请先退出当前账号');
    const name=username(data.username),secret=password(data.password),proof=checkEmailCode(db,person,'register',data);
    if(db.prepare('SELECT 1 FROM accounts WHERE username=?').get(name))throw new ApiError(409,'该用户名已被使用');
    const encoded=await encode(secret),code=recovery(),now=new Date().toISOString();
    const id=randomUUID();
    const claimed=transaction(db,()=>{
      if(db.prepare('SELECT 1 FROM accounts WHERE username=?').get(name))throw new ApiError(409,'该用户名已被使用');
      db.prepare('INSERT INTO users VALUES(?,?,?)').run(id,'匿名同学',now);
      if(db.prepare('SELECT 1 FROM accounts WHERE email=?').get(proof.email))throw new ApiError(409,'该邮箱已注册，请登录或找回密码');
      consumeEmailCode(db,proof);
      db.prepare('INSERT INTO accounts(user_id,username,password_hash,recovery_hash,role,created_at,email,email_verified_at) VALUES(?,?,?,?,?,?,?,?)').run(id,name,encoded,digest(normalizeRecovery(code)),'member',now,proof.email,now);
      db.prepare('INSERT INTO account_members VALUES(?,?)').run(id,id);
      createProfile(db,id);
      return attachGuest(db,person,id);
    });
    return {...newSession(db,res,req,id),account:{id,username:name,role:'member',email:proof.email,emailVerified:true,emailVerifiedAt:now,...profileFields(db,id)},claimed};
  }
  if(action==='recover'&&data.email){
    const secret=password(data.password),proof=checkEmailCode(db,person,'recover',data),encoded=await encode(secret);
    transaction(db,()=>{
      consumeEmailCode(db,proof);
      const result=db.prepare('UPDATE accounts SET password_hash=?,recovery_hash=? WHERE user_id=? AND email=? AND email_verified_at IS NOT NULL AND password_hash=?')
        .run(encoded,digest(recovery()),proof.account_id,proof.email,proof.password_version);
      if(!result.changes)throw new ApiError(409,'账号状态已变更，请重新获取验证码');
      db.prepare('DELETE FROM email_challenges WHERE account_id=?').run(proof.account_id);
      db.prepare('DELETE FROM visitor_sessions WHERE user_id IN(SELECT user_id FROM account_members WHERE account_id=?)').run(proof.account_id);
    });
    res.setHeader('Set-Cookie','nnu_visitor=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0');
    return {message:'密码已重置，请使用新密码登录'};
  }
  if(action==='login'||action==='recover'){
    const identifier=data.identifier??data.username;
    const name=action==='login'&&typeof identifier==='string'&&identifier.includes('@')?normalizeEmail(identifier):username(identifier);
    const account=db.prepare(name.includes('@')?'SELECT * FROM accounts WHERE email=?':'SELECT * FROM accounts WHERE username=?').get(name);
    rateLimit(db,`auth-user:${account?.user_id||name}`,10);
    if(action==='login'){
      const secret=typeof data.password==='string'&&data.password.length<=128?data.password:'';
      const ok=await matches(secret,account?.password_hash||'00000000000000000000000000000000:'+ '00'.repeat(64));
      if(!account||!ok)throw new ApiError(401,'邮箱、用户名或密码不正确');
      if(!db.prepare('SELECT 1 FROM accounts WHERE user_id=? AND password_hash=?').get(account.user_id,account.password_hash))throw new ApiError(401,'密码已变更，请使用新密码登录');
      const claimed=transaction(db,()=>{const n=attachGuest(db,person,account.user_id);db.prepare('DELETE FROM visitor_sessions WHERE token_hash=?').run(person.tokenHash);return n;});
      db.prepare('DELETE FROM auth_attempts WHERE key=?').run(`auth-user:${account.user_id}`);
      return {...newSession(db,res,req,account.user_id),account:{id:account.user_id,username:account.username,role:account.role,email:account.email,emailVerified:!!account.email_verified_at,emailVerifiedAt:account.email_verified_at,...profileFields(db,account.user_id)},claimed};
    }
    // Compatibility only for old accounts that have not bound a campus mailbox.
    const secret=password(data.password),provided=digest(normalizeRecovery(data.recoveryCode));
    if(!account||account.email_verified_at||!timingSafeEqual(Buffer.from(provided,'hex'),Buffer.from(account.recovery_hash,'hex')))throw new ApiError(401,'用户名或恢复码不正确');
    const encoded=await encode(secret),code=recovery();
    transaction(db,()=>{
      const result=db.prepare('UPDATE accounts SET password_hash=?,recovery_hash=? WHERE user_id=? AND recovery_hash=?').run(encoded,digest(normalizeRecovery(code)),account.user_id,provided);
      if(!result.changes)throw new ApiError(409,'恢复码已使用，请使用最新恢复码');
      db.prepare('DELETE FROM visitor_sessions WHERE user_id IN(SELECT user_id FROM account_members WHERE account_id=?)').run(account.user_id);
    });
    res.setHeader('Set-Cookie','nnu_visitor=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0');
    return {recoveryCode:code,message:'密码已重置，请使用新密码登录。旧恢复码已失效。'};
  }
  requireAccount(person);
  if(action==='profile'){
    rateLimit(db,`profile:${person.userId}`,30);
    const nickname=validateNickname(data.nickname),avatar=data.avatar===undefined?undefined:await normalizeAvatar(data.avatar);
    return transaction(db,()=>{
      const fresh=currentPerson(db,req);
      if(!fresh?.account||fresh.userId!==person.userId)throw new ApiError(401,'登录已失效，请重新登录');
      createProfile(db,person.userId);
      return {profile:saveProfile(db,person.userId,nickname,avatar),message:'个人资料已更新'};
    });
  }
  if(action==='delete'){
    rateLimit(db,`delete-account:${person.userId}`,5);
    if(data.confirmation!=='注销账号')throw new ApiError(400,'请确认注销账号且无法恢复');
    const account=db.prepare('SELECT * FROM accounts WHERE user_id=?').get(person.userId);
    if(!account)throw new ApiError(401,'账号已失效，请重新登录');
    if(typeof data.currentPassword!=='string'||data.currentPassword.length>128||!await matches(data.currentPassword,account.password_hash))throw new ApiError(401,'当前密码不正确');
    const keptReviews=transaction(db,()=>{
      // Recheck identity, password and admin role after the asynchronous password check.
      const fresh=currentPerson(db,req);
      if(!fresh?.account||fresh.userId!==person.userId||!db.prepare('SELECT 1 FROM accounts WHERE user_id=? AND password_hash=?').get(person.userId,account.password_hash))throw new ApiError(409,'账号状态已变更，请重新登录');
      const info=accountDeletionInfo(db,fresh);
      if(!info.canDelete)throw new ApiError(409,info.reason);
      const ids=[...new Set([person.userId,...ownedIds(db,fresh)])],slots=ids.map(()=>'?').join(',');
      const reviews=db.prepare(`SELECT id,created_at FROM reviews WHERE user_id IN (${slots})`).all(...ids);
      // A separate anonymous identity per review removes even the grouping by account.
      for(const review of reviews){
        const anonymousId=randomUUID();
        db.prepare('INSERT INTO users VALUES(?,?,?)').run(anonymousId,'匿名同学',review.created_at);
        db.prepare('UPDATE reviews SET user_id=? WHERE id=?').run(anonymousId,review.id);
      }
      db.prepare(`DELETE FROM visitor_sessions WHERE user_id IN (${slots})`).run(...ids);
      db.prepare(`DELETE FROM email_challenges WHERE account_id=? OR requester_id IN (${slots}) OR email=?`).run(person.userId,...ids,account.email);
      db.prepare('DELETE FROM account_members WHERE account_id=?').run(person.userId);
      // Existing report and audit rows become anonymous through ON DELETE SET NULL.
      db.prepare('DELETE FROM accounts WHERE user_id=?').run(person.userId);
      for(const id of ids){
        db.prepare("UPDATE admin_audit SET target='已注销账号' WHERE target=?").run(id);
        db.prepare('DELETE FROM users WHERE id=?').run(id);
      }
      return reviews.length;
    });
    res.setHeader('Set-Cookie',`nnu_visitor=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${req.socket.encrypted||process.env.COOKIE_SECURE==='1'?'; Secure':''}`);
    return {ok:true,keptReviews,message:'账号已注销，原有评价已解除账号关联。'};
  }
  if(action==='bind-email'){
    if(person.account.emailVerified)throw new ApiError(409,'校园邮箱已验证，无需重复绑定');
    rateLimit(db,`bind:${person.userId}`,10);
    const account=db.prepare('SELECT * FROM accounts WHERE user_id=?').get(person.userId);
    if(typeof data.currentPassword!=='string'||data.currentPassword.length>128||!await matches(data.currentPassword,account.password_hash))throw new ApiError(401,'当前密码不正确');
    const proof=checkEmailCode(db,person,'bind',data),now=new Date().toISOString();
    transaction(db,()=>{
      if(db.prepare('SELECT 1 FROM accounts WHERE email=?').get(proof.email))throw new ApiError(409,'该邮箱已绑定其他账号');
      consumeEmailCode(db,proof);
      const updated=db.prepare('UPDATE accounts SET email=?,email_verified_at=?,recovery_hash=? WHERE user_id=? AND email IS NULL AND password_hash=?')
        .run(proof.email,now,digest(recovery()),person.userId,account.password_hash);
      if(!updated.changes)throw new ApiError(409,'账号状态已变更，请重新登录');
      db.prepare('DELETE FROM email_challenges WHERE account_id=?').run(person.userId);
      db.prepare('DELETE FROM visitor_sessions WHERE user_id IN(SELECT user_id FROM account_members WHERE account_id=?)').run(person.userId);
    });
    return {...newSession(db,res,req,person.userId),message:'校园邮箱验证成功',account:{...person.account,email:proof.email,emailVerified:true,emailVerifiedAt:now}};
  }
  if(action==='logout'){
    db.prepare('DELETE FROM visitor_sessions WHERE token_hash=?').run(person.tokenHash);
    res.setHeader('Set-Cookie','nnu_visitor=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0');return {ok:true};
  }
  if(action==='password'){
    rateLimit(db,`password:${person.userId}`,10);
    const account=db.prepare('SELECT * FROM accounts WHERE user_id=?').get(person.userId);
    if(typeof data.currentPassword!=='string'||data.currentPassword.length>128||!await matches(data.currentPassword,account.password_hash))throw new ApiError(401,'当前密码不正确');
    const encoded=await encode(password(data.password)),code=recovery();
    transaction(db,()=>{const updated=db.prepare('UPDATE accounts SET password_hash=?,recovery_hash=? WHERE user_id=? AND password_hash=?').run(encoded,digest(normalizeRecovery(code)),person.userId,account.password_hash);if(!updated.changes)throw new ApiError(409,'密码已变更，请重新登录');db.prepare('DELETE FROM visitor_sessions WHERE user_id=?').run(person.userId);db.prepare('DELETE FROM email_challenges WHERE account_id=?').run(person.userId);});
    return {...newSession(db,res,req,person.userId),...(account.email_verified_at?{message:'密码已更新，其他设备已退出登录'}:{recoveryCode:code})};
  }
  throw new ApiError(404,'账号操作不存在');
}
export function ensureAdminSetup(db,path){
  if(db.prepare("SELECT 1 FROM accounts WHERE role='admin'").get())return;
  if(existsSync(path)){
    const token=readFileSync(path,'utf8').trim();
    if(db.prepare('SELECT 1 FROM admin_setup WHERE token_hash=?').get(digest(token)))return;
  }
  const token=randomBytes(24).toString('hex');
  writeFileSync(path,token+'\n',{mode:0o600});db.prepare('INSERT OR REPLACE INTO admin_setup VALUES(1,?)').run(digest(token));
}
