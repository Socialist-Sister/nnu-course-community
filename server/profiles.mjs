import {randomInt,randomUUID} from 'node:crypto';
import sharp from 'sharp';
import {ApiError} from './catalog.mjs';

export function createProfile(db,userId,draw=()=>randomInt(1000000)){
  if(db.prepare('SELECT 1 FROM account_profiles WHERE user_id=?').get(userId))return;
  if(db.prepare('SELECT COUNT(*) n FROM nickname_numbers').get().n>=1000000)throw new ApiError(503,'默认昵称名额已满，请联系管理员');
  const start=draw();
  for(let attempt=0;attempt<1000000;attempt++){
    const number=String(attempt<30?draw():(start+attempt)%1000000).padStart(6,'0'),nickname='小南狮'+number;
    if(db.prepare('SELECT 1 FROM account_profiles WHERE nickname=?').get(nickname))continue;
    if(!db.prepare('INSERT OR IGNORE INTO nickname_numbers VALUES(?)').run(number).changes)continue;
    db.prepare('INSERT INTO account_profiles(user_id,nickname,default_number) VALUES(?,?,?)').run(userId,nickname,number);return;
  }
  throw new ApiError(503,'暂时无法分配昵称，请稍后再试');
}
export function migrateProfiles(db){
  if(db.prepare('SELECT 1 FROM schema_migrations WHERE version=9').get())return;
  db.exec('BEGIN IMMEDIATE');try{
    db.exec(`CREATE TABLE nickname_numbers(number TEXT PRIMARY KEY CHECK(length(number)=6));
      CREATE TABLE account_profiles(user_id TEXT PRIMARY KEY REFERENCES accounts(user_id) ON DELETE CASCADE,
        nickname TEXT NOT NULL COLLATE NOCASE UNIQUE,default_number TEXT NOT NULL UNIQUE REFERENCES nickname_numbers(number),
        avatar BLOB,avatar_version TEXT);
    `);
    for(const a of db.prepare('SELECT user_id FROM accounts').all())createProfile(db,a.user_id);
    db.exec("INSERT INTO schema_migrations VALUES(9,strftime('%Y-%m-%dT%H:%M:%fZ','now')); COMMIT");
  }catch(e){db.exec('ROLLBACK');throw e;}
}
export function profileFields(db,userId){
  const p=db.prepare('SELECT nickname,avatar_version FROM account_profiles WHERE user_id=?').get(userId);
  return {nickname:p?.nickname||null,avatarUrl:p?.avatar_version?'/api/account/avatar?v='+p.avatar_version:null};
}
export function validateNickname(value){
  if(typeof value!=='string')throw new ApiError(400,'请填写昵称');
  const name=value.normalize('NFC').trim();
  if([...name].length<1||[...name].length>20||/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(name))throw new ApiError(400,'昵称需为 1–20 个字符，不能包含换行或控制字符');
  return name;
}
export async function normalizeAvatar(value){
  if(value===null)return null;
  if(typeof value!=='string'||value.length>350000)throw new ApiError(400,'头像文件过大，请重新选择图片');
  const match=value.match(/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/);
  if(!match)throw new ApiError(400,'请上传 JPG、PNG 或 WebP 图片');
  try{
    const buffer=Buffer.from(match[2],'base64');
    const signatures={png:buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])),jpeg:buffer[0]===255&&buffer[1]===216&&buffer[2]===255,webp:buffer.toString('ascii',0,4)==='RIFF'&&buffer.toString('ascii',8,12)==='WEBP'};
    if(!signatures[match[1]])throw Error();
    const image=sharp(buffer,{limitInputPixels:16000000,failOn:'warning'}),meta=await image.metadata();
    if(!['png','jpeg','webp'].includes(meta.format)||meta.format!==match[1]||meta.pages>1)throw Error();
    return await image.rotate().resize(256,256,{fit:'cover'}).webp({quality:85}).toBuffer();
  }catch{throw new ApiError(400,'图片无法读取，请换一张 JPG、PNG 或 WebP 图片');}
}
export function saveProfile(db,userId,nickname,avatar){
  const other=db.prepare('SELECT user_id FROM account_profiles WHERE nickname=? AND user_id<>?').get(nickname,userId);
  if(other)throw new ApiError(409,'这个昵称已被使用，请换一个');
  const profile=db.prepare('SELECT default_number FROM account_profiles WHERE user_id=?').get(userId);
  if(/^小南狮\d{6}$/.test(nickname)&&nickname!=='小南狮'+profile.default_number)throw new ApiError(400,'小南狮加六位数字为系统保留昵称，请使用其他昵称');
  if(avatar===undefined)db.prepare('UPDATE account_profiles SET nickname=? WHERE user_id=?').run(nickname,userId);
  else db.prepare('UPDATE account_profiles SET nickname=?,avatar=?,avatar_version=? WHERE user_id=?').run(nickname,avatar,avatar?randomUUID():null,userId);
  return profileFields(db,userId);
}
