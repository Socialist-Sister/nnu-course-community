// One owner manages scoped administrators; authorization is re-read on every request.
import {randomUUID} from 'node:crypto';
import {ApiError} from './catalog.mjs';
export function migrateAdminMembers(db){
  if(db.prepare("SELECT 1 FROM sqlite_master WHERE name='site_owner'").get())return;
  db.exec('BEGIN IMMEDIATE');
  try{
    db.exec(`CREATE TABLE site_owner(id INTEGER PRIMARY KEY CHECK(id=1),account_id TEXT NOT NULL UNIQUE REFERENCES accounts(user_id) ON DELETE RESTRICT);
      CREATE TABLE admin_permissions(account_id TEXT PRIMARY KEY REFERENCES accounts(user_id) ON DELETE CASCADE,content INTEGER NOT NULL CHECK(content IN(0,1)),courses INTEGER NOT NULL CHECK(courses IN(0,1)),granted_at TEXT NOT NULL,CHECK(content=1 OR courses=1));`);
    const admins=db.prepare("SELECT user_id FROM accounts WHERE role='admin' ORDER BY created_at,user_id").all();
    if(admins.length){
      const first=db.prepare("SELECT actor_id FROM admin_audit WHERE action='admin.setup' AND actor_id IN (SELECT user_id FROM accounts WHERE role='admin') ORDER BY created_at,id LIMIT 1").get();
      if(admins.length>1&&!first)throw Error('无法确定站点负责人，请核对原管理员初始化记录');
      db.prepare('INSERT INTO site_owner VALUES(1,?)').run(first?.actor_id||admins[0].user_id);
      for(const a of admins)db.prepare('INSERT INTO admin_permissions VALUES(?,1,1,?)').run(a.user_id,new Date().toISOString());
    }
    db.exec('COMMIT');
  }catch(e){db.exec('ROLLBACK');throw e;}
}
export function adminAccess(db,id){
  const isOwner=!!db.prepare('SELECT 1 FROM site_owner WHERE account_id=?').get(id);
  const p=db.prepare("SELECT p.* FROM admin_permissions p JOIN accounts a ON a.user_id=p.account_id WHERE a.role='admin' AND p.account_id=?").get(id);
  return {isOwner,permissions:{content:isOwner||!!p?.content,courses:isOwner||!!p?.courses}};
}
export function checkAdminAccess(db,person,path){
  if(!person?.account)throw new ApiError(401,'请先登录账号');
  if(db.prepare('SELECT role FROM accounts WHERE user_id=?').get(person.account.id)?.role!=='admin')throw new ApiError(403,'需要管理员权限');
  const a=adminAccess(db,person.account.id),area=path.split('/')[0];
  if(a.isOwner)return;
  if((['reviews','reports'].includes(area)&&a.permissions.content)||(area==='courses'&&a.permissions.courses))return;
  throw new ApiError(403,'没有此项管理权限');
}
function publicMember(db,a){return {id:a.user_id,username:a.username,...adminAccess(db,a.user_id),grantedAt:a.granted_at||a.created_at,emailVerified:!!a.email_verified_at};}
export function readAdminMembers(db,params){
  if(params.has('username')){
    const username=params.get('username').trim().toLowerCase();
    if(!/^[a-z0-9_]{3,32}$/.test(username))throw new ApiError(400,'请输入完整登录用户名');
    const a=db.prepare('SELECT * FROM accounts WHERE username=? COLLATE NOCASE').get(username);
    if(!a)throw new ApiError(404,'未找到该账号，请对方先注册');
    if(!a.email_verified_at)throw new ApiError(400,'该账号尚未验证校园邮箱');
    return {member:publicMember(db,a)};
  }
  const items=db.prepare("SELECT a.user_id,a.username,a.created_at,a.email_verified_at,p.granted_at FROM accounts a LEFT JOIN admin_permissions p ON p.account_id=a.user_id WHERE a.role='admin' ORDER BY a.created_at,a.user_id").all().map(a=>publicMember(db,a));
  return {items,total:items.length,page:1,totalPages:1};
}
export function writeAdminMember(db,person,data){
  checkAdminAccess(db,person,'members');
  if(typeof data.id!=='string'||!['grant','revoke'].includes(data.action))throw new ApiError(400,'管理操作无效');
  if(adminAccess(db,data.id).isOwner)throw new ApiError(403,'不能修改或撤销站点负责人的权限');
  const target=db.prepare('SELECT * FROM accounts WHERE user_id=?').get(data.id);
  if(!target)throw new ApiError(404,'账号不存在');
  if(data.action==='grant'&&(!target.email_verified_at||typeof data.content!=='boolean'||typeof data.courses!=='boolean'||(!data.content&&!data.courses)))throw new ApiError(400,'账号须验证校园邮箱，并至少选择一项权限');
  db.exec('BEGIN IMMEDIATE');
  try{
    const before=adminAccess(db,data.id).permissions,time=new Date().toISOString();
    if(data.action==='grant'){
      db.prepare("UPDATE accounts SET role='admin' WHERE user_id=?").run(data.id);
      db.prepare('INSERT INTO admin_permissions VALUES(?,?,?,?) ON CONFLICT(account_id) DO UPDATE SET content=excluded.content,courses=excluded.courses').run(data.id,+data.content,+data.courses,time);
    }else{
      db.prepare("UPDATE accounts SET role='member' WHERE user_id=?").run(data.id);
      db.prepare('DELETE FROM admin_permissions WHERE account_id=?').run(data.id);
    }
    db.prepare('INSERT INTO admin_audit VALUES(?,?,?,?,?,?)').run(randomUUID(),person.account.id,'admin.'+data.action,data.id,JSON.stringify({before,after:adminAccess(db,data.id).permissions}),time);
    db.exec('COMMIT');return {ok:true};
  }catch(e){db.exec('ROLLBACK');throw e;}
}
