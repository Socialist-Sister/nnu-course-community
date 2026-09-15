import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {fixture} from './bookmark-fixture.mjs';
import {searchIndex} from '../server/search.mjs';
import {syncCoursePages} from '../server/taxonomy.mjs';
test('跨会话收藏、账号隔离、系列合并、重试导入与注销级联',async()=>{
 const f=await fixture();
 async function call(id,body,headers={}){const p=f.people[id];const r=await fetch(f.base+'/api/bookmarks',{method:body?'POST':'GET',headers:{Cookie:p?'nnu_visitor='+p.token:'','Content-Type':'application/json','X-CSRF-Token':p?.csrf||'',...headers},...(body?{body:JSON.stringify({accountId:id,...body})}:{})});return {status:r.status,data:await r.json()};}
 try{
  const set=(code,saved)=>({action:'set',code,saved});
  assert.equal((await call(null,set('1000000015',true))).status,401);
  assert.equal((await call('alpha',set('1000000015',true),{'X-CSRF-Token':'bad'})).status,403);
  assert.equal((await call('alpha',set('1000000015',true),{Origin:'https://other.invalid'})).status,403);
  assert.equal((await call('alpha',{...set('1000000015',true),accountId:'beta'})).status,409);
  assert.equal((await call('alpha',set('missing',true))).status,404);
  await call('alpha',set('1000000015',true));assert.deepEqual((await call('beta')).data.codes,[]);
  await call('alpha',set('1000000015',true));assert.deepEqual((await call('alpha')).data.codes,['1000000015']);
  const batch={action:'import',token:randomUUID(),codes:['1000000201','1000000201','unknown']};
  assert.deepEqual((await call('alpha',batch)).data.unmatched,['unknown']);
  await call('alpha',set('1000000201',false));await call('alpha',batch);
  assert.ok(!(await call('alpha')).data.codes.includes('1000000201'),'Retry must not resurrect removed bookmark');
  for(const [code,name]of [['QA-UP','高等数学Ⅰ(上)'],['QA-DOWN','高等数学Ⅰ(下)']])f.db.prepare('INSERT INTO courses VALUES(?,?,?,?,?,?,?)').run(code,name,'测试学院','必修','公共课',4,72);
  syncCoursePages(f.db);
  const series=searchIndex(f.db).find(p=>p.isSeries&&p.members.length>1);
  for(const member of series.members)await call('alpha',set(member.code,true));
  assert.equal((await call('alpha')).data.codes.filter(c=>c===series.id).length,1);
  await call('alpha',set(series.members.at(-1).code,false));assert.ok(!(await call('alpha')).data.codes.includes(series.id));
  // Independent requests only mutate their own code, not a stale full-list snapshot.
  await Promise.all(['1000000201','1000000202'].map(code=>call('alpha',set(code,true))));
  assert.equal((await call('alpha')).data.codes.length,3);
  await call('beta',set('1000000202',true));
  f.db.prepare('DELETE FROM account_members WHERE account_id=?').run('alpha');
  f.db.prepare('DELETE FROM accounts WHERE user_id=?').run('alpha');
  assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM account_bookmarks WHERE account_id='alpha'").get().n,0);
  assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM bookmark_imports WHERE account_id='alpha'").get().n,0);
  assert.deepEqual((await call('beta')).data.codes,['1000000202']);
  assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(),[]);
 }finally{await f.close();}
});
