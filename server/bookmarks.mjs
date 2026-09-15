// Account-owned bookmarks, incremental writes, and retry-safe legacy imports.
import {ApiError} from './catalog.mjs';
import {searchIndex} from './search.mjs';
export function migrateBookmarks(db){
 db.exec(`CREATE TABLE IF NOT EXISTS account_bookmarks(
 account_id TEXT NOT NULL REFERENCES accounts(user_id) ON DELETE CASCADE,
 course_code TEXT NOT NULL REFERENCES courses(code),PRIMARY KEY(account_id,course_code));
 CREATE TABLE IF NOT EXISTS bookmark_imports(account_id TEXT NOT NULL REFERENCES accounts(user_id) ON DELETE CASCADE,
 token TEXT NOT NULL,PRIMARY KEY(account_id,token));`);
}
function resolvePage(db,code){
 let page=searchIndex(db).find(p=>p.id===code||p.members.some(c=>c.code===code));
 if(!page){const alias=db.prepare('SELECT course_code FROM course_page_aliases WHERE old_page_id=?').get(code);if(alias)page=searchIndex(db).find(p=>p.members.some(c=>c.code===alias.course_code));}
 return page;
}
export function readBookmarks(db,person){
 if(!person?.account)return {accountId:null,codes:[]};
 const codes=db.prepare('SELECT course_code FROM account_bookmarks WHERE account_id=? ORDER BY course_code').all(person.account.id).map(r=>resolvePage(db,r.course_code)?.id).filter(Boolean);
 return {accountId:person.account.id,csrf:person.csrf,codes:[...new Set(codes)]};
}
export function writeBookmarks(db,person,data){
 if(!person?.account)throw new ApiError(401,'请先登录账号');
 if(!data||typeof data!=='object'||Array.isArray(data))throw new ApiError(400,'收藏参数无效');
 if(data.accountId!==person.account.id)throw new ApiError(409,'登录账号已改变，请刷新后重试');
 if(!['set','import'].includes(data.action))throw new ApiError(400,'收藏操作无效');
 const isImport=data.action==='import';
 if(isImport&&(!/^[a-f0-9-]{36}$/.test(data.token||'')||!Array.isArray(data.codes)||data.codes.length>2500))throw new ApiError(400,'旧收藏数据无效');
 if(!isImport&&(typeof data.saved!=='boolean'||typeof data.code!=='string'))throw new ApiError(400,'收藏参数无效');
 const raw=isImport?data.codes:[data.code];
 if(raw.some(c=>typeof c!=='string'||!c.length||c.length>60))throw new ApiError(400,'课程编号无效');
 const pages=raw.map(c=>resolvePage(db,c));
 if(!isImport&&!pages[0])throw new ApiError(404,'未找到这门课程');
 db.exec('BEGIN IMMEDIATE');
 try{
  const done=isImport&&db.prepare('SELECT 1 FROM bookmark_imports WHERE account_id=? AND token=?').get(person.account.id,data.token);
  if(!done){
   const add=db.prepare('INSERT OR IGNORE INTO account_bookmarks VALUES(?,?)'),remove=db.prepare('DELETE FROM account_bookmarks WHERE account_id=? AND course_code=?');
   for(const p of pages.filter(Boolean)){
    if(isImport||data.saved)add.run(person.account.id,p.members[0].code);
    else for(const c of p.members)remove.run(person.account.id,c.code);
   }
   if(isImport)db.prepare('INSERT INTO bookmark_imports VALUES(?,?)').run(person.account.id,data.token);
  }
  db.exec('COMMIT');
 }catch(e){db.exec('ROLLBACK');throw e;}
 return {...readBookmarks(db,person),unmatched:isImport?raw.filter((_,i)=>!pages[i]):[]};
}
