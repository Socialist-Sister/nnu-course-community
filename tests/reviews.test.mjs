import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {openDatabase,root} from '../server/database.mjs';
import {readCatalog,importCatalog} from '../server/import-catalog.mjs';
import {courseDetail,listCourses} from '../server/catalog.mjs';
import {createApp} from '../server/index.mjs';
import {migrateReviews,studyTerms} from '../server/review-schema.mjs';
import {syncCoursePages} from '../server/taxonomy.mjs';
import {writeReview,readReviews} from '../server/reviews.mjs';
import {reviewDimensions} from '../shared/review-dimensions.mjs';
import {testMailbox} from './mail-fixture.mjs';
const mailbox=testMailbox();
let db,server,url,person,other,body,id;
const dimensions={difficulty:1,workload:2,grading:4,gain:5};
const content='这是独立测试库中的修读体验：讲解清楚，作业每周一次，建议按时完成练习。';
let accountNumber=0;
async function identity(){const r=await fetch(url+'/api/session');assert.equal(r.status,200);const data=await r.json();const cookie=r.headers.get('set-cookie').split(';')[0],headers={Cookie:cookie,'X-CSRF-Token':data.csrf,'Content-Type':'application/json'},username='review_test_'+(++accountNumber),email=username+'@njnu.edu.cn';const sent=await fetch(url+'/api/account/send-code',{method:'POST',headers,body:JSON.stringify({email,purpose:'register'})});assert.equal(sent.status,200);const {challengeId}=await sent.json();const registered=await fetch(url+'/api/account/register',{method:'POST',headers,body:JSON.stringify({username,password:'Test-password-12345',email,challengeId,emailCode:mailbox.messages.at(-1).code})});assert.equal(registered.status,200);const account=await registered.json();return {...data,...account,cookie:registered.headers.get('set-cookie').split(';')[0]};}
async function call(path,method='GET',data,who=person,extra={}){const r=await fetch(url+path,{method,headers:{...(who?{Cookie:who.cookie,'X-CSRF-Token':who.csrf}:{}),'Content-Type':'application/json',...extra},...(data===undefined?{}:{body:JSON.stringify(data)})});return {status:r.status,data:await r.json()};}
before(async()=>{db=openDatabase(':memory:');importCatalog(db,readCatalog());server=createApp(db,{mailer:mailbox});await new Promise(r=>server.listen(0,'127.0.0.1',r));url=`http://127.0.0.1:${server.address().port}`;person=await identity();other=await identity();const c=courseDetail(db,'1000000015');body={courseId:c.code,groupId:c.groups[0].sourceGroupIds[0],semesterId:person.terms[1].id,rating:4,content,...dimensions};});
after(async()=>{await new Promise(r=>server.close(r));db.close();});

test('访客身份不外泄；跨站、缺少身份或 CSRF 的写入被拒绝',async()=>{
  assert.equal((await call('/api/reviews','POST',body,null)).status,401);
  assert.equal((await call('/api/reviews','POST',body,person,{'X-CSRF-Token':'wrong'})).status,403);
  assert.equal((await call('/api/reviews','POST',body,person,{Origin:'https://other.example'})).status,403);
  assert.equal((await call('/api/reviews','POST',body,person,{'Sec-Fetch-Site':'cross-site'})).status,403);
  const reused=await call('/api/session');assert.equal(reused.data.csrf,person.csrf);assert.equal(reused.data.userId,undefined);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM reviews').get().n,0);
});
test('校验评分、正文、课程教师关系和修读学期；拒绝无教师记录',async()=>{
  for(const patch of [{rating:0},{rating:6},{rating:1.5},{rating:'5'},{content:''},{content:' '.repeat(30)},{content:'字'.repeat(3001)},{semesterId:'2099-2100-1'},{groupId:'wrong'},{courseId:'unknown'}])assert.ok([400,404].includes((await call('/api/reviews','POST',{...body,...patch})).status));
  const missing=courseDetail(db,'STAJ1379');assert.equal((await call('/api/reviews','POST',{...body,courseId:missing.code,groupId:missing.groups[0].sourceGroupIds[0]})).status,400);
  assert.equal((await call('/api/reviews','POST',body,person,{'Content-Type':'text/plain'})).status,415);
});
test('发布、重复请求幂等、教师筛选、真实统计与排序；修读学期不污染开课快照',async()=>{
  const created=await call('/api/reviews','POST',body);assert.equal(created.status,201);id=created.data.id;
  assert.equal((await call('/api/reviews','POST',body)).status,200);
  assert.equal((await call('/api/reviews','POST',{...body,rating:5})).status,409);
  const feed=await call(`/api/courses/${body.courseId}/reviews`);assert.equal(feed.data.total,1);assert.equal(feed.data.items[0].isMine,true);assert.equal(feed.data.items[0].semesterId,body.semesterId);assert.equal(feed.data.items[0].userId,undefined);
  const publicFeed=await call(`/api/courses/${body.courseId}/reviews`,'GET',undefined,other);assert.equal(publicFeed.data.items[0].isMine,false);
  const c=courseDetail(db,body.courseId);assert.equal(c.reviewCount,1);assert.equal(c.rating,4);assert.equal(c.groups[0].rating,4);
  for(const sort of ['rating','reviews'])assert.equal(listCourses(db,new URLSearchParams({sort})).items[0].code,body.courseId);
  assert.equal((await call(`/api/courses/${body.courseId}/reviews?teacher=${c.groups[0].id}`)).data.total,1);
  assert.equal((await call(`/api/courses/${body.courseId}/reviews?teacher=wrong`)).status,400);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM semesters').get().n,1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM offerings').get().n,5074);
});
test('仅作者可编辑、撤回与重新发布；隐藏评价不参与公开列表和统计',async()=>{
  assert.equal((await call(`/api/reviews/${id}`,'PUT',body,other)).status,404);
  assert.equal((await call(`/api/reviews/${id}`,'DELETE',undefined,other)).status,404);
  assert.equal((await call(`/api/reviews/${id}`,'PUT',{...body,semesterId:person.terms[0].id})).status,400);
  const changed={...body,rating:2,content:content+' <img src=x onerror=alert(1)> 按原文保存。'};
  assert.equal((await call(`/api/reviews/${id}`,'PUT',changed)).status,200);
  assert.equal(courseDetail(db,body.courseId).rating,2);
  assert.equal((await call(`/api/courses/${body.courseId}/reviews`)).data.items[0].content,changed.content);
  assert.equal((await call(`/api/reviews/${id}`,'DELETE')).status,200);
  assert.equal((await call(`/api/courses/${body.courseId}/reviews`,'GET',undefined,other)).data.total,0);
  assert.equal((await call(`/api/courses/${body.courseId}/reviews`)).data.items[0].status,'hidden');
  assert.equal(courseDetail(db,body.courseId).reviewCount,0);assert.equal(courseDetail(db,body.courseId).rating,null);
  assert.equal((await call(`/api/reviews/${id}`,'PUT',body)).status,200);
  assert.equal(courseDetail(db,body.courseId).reviewCount,1);
});
test('分页固定顺序且无重复；没有会话时只返回公开评价',async()=>{
  const now=new Date().toISOString();for(let n=0;n<23;n++){db.prepare('INSERT INTO users VALUES(?,?,?)').run(`page-user-${n}`,'test',now);db.prepare('INSERT INTO reviews VALUES(?,?,?,?,?,?,?,?,?,?)').run(`page-review-${n}`,`page-user-${n}`,body.groupId,body.semesterId,3,content,1,'published',now,now);}
  const first=(await call(`/api/courses/${body.courseId}/reviews`,'GET',undefined,null)).data;
  const second=(await call(`/api/courses/${body.courseId}/reviews?page=2`,'GET',undefined,null)).data;
  assert.equal(first.total,24);assert.equal(first.items.length,20);assert.equal(second.items.length,4);assert.equal(new Set([...first.items,...second.items].map(r=>r.id)).size,24);
  assert.ok(first.items.every(r=>!r.isMine));assert.equal((await call(`/api/courses/${body.courseId}/reviews?page=0`)).status,400);
});
test('旧评价无损迁移，写入后关闭重开仍保留，外键完整',()=>{
  const dir=mkdtempSync(join(tmpdir(),'nnu-review-migration-')),file=join(dir,'test.sqlite');let disk=new DatabaseSync(file);
  try{disk.exec(readFileSync(resolve(root,'server/schema.sql'),'utf8'));importCatalog(disk,readCatalog());const c=courseDetail(disk,'1000000015'),now=new Date().toISOString();disk.prepare('INSERT INTO users VALUES(?,?,?)').run('old-user','匿名',now);disk.prepare('INSERT INTO reviews VALUES(?,?,?,?,?,?,?,?,?,?)').run('old-review','old-user',c.groups[0].id,'2026-2027-1',5,content,1,'published',now,now);const old=disk.prepare('SELECT * FROM reviews').get();
    migrateReviews(disk);assert.deepEqual(disk.prepare('SELECT * FROM reviews').get(),old);disk.close();disk=openDatabase(file);assert.deepEqual(disk.prepare('SELECT * FROM reviews').get(),old);assert.deepEqual(disk.prepare('PRAGMA foreign_key_check').all(),[]);assert.ok(disk.prepare('PRAGMA foreign_key_list(reviews)').all().some(f=>f.table==='review_terms'));
  }finally{disk.close();rmSync(dir,{recursive:true,force:true});}
});
test('修读学期遵循上海时区学年，跨年不产生未来学期',()=>{
  const terms=studyTerms(db,new Date('2027-01-01T00:00:00+08:00'));assert.equal(terms[0].id,'2026-2027-1');assert.equal(studyTerms(db,new Date('2027-02-01T00:00:00+08:00'))[0].id,'2026-2027-2');
});

test('四维必填校验、重试、编辑、隐藏再发布和删除保持一致；总分独立',async()=>{
  const who=await identity(),data={...body,difficulty:1,workload:2,grading:4,gain:5};
  for(const {key} of reviewDimensions)for(const value of [undefined,null,'',0,6,2.5,'3',false,{},[]])assert.equal((await call('/api/reviews','POST',{...data,[key]:value},who)).status,400);
  const before=courseDetail(db,body.courseId),created=await call('/api/reviews','POST',data,who),reviewId=created.data.id;
  assert.equal(created.status,201);
  assert.equal((await call('/api/reviews','POST',data,who)).status,200);
  assert.equal((await call('/api/reviews','POST',{...data,gain:1},who)).status,409);
  const row=()=>db.prepare('SELECT * FROM review_dimensions WHERE review_id=?').get(reviewId);
  for(const {key} of reviewDimensions)assert.equal(row()[key],data[key]);
  const feed=(await call(`/api/courses/${body.courseId}/reviews`,'GET',undefined,who)).data.items.find(r=>r.id===reviewId);
  for(const {key} of reviewDimensions)assert.equal(feed[key],data[key]);
  assert.equal(courseDetail(db,body.courseId).reviewCount,before.reviewCount+1);
  assert.equal(db.prepare('SELECT rating FROM reviews WHERE id=?').get(reviewId).rating,body.rating);
  assert.equal((await call(`/api/reviews/${reviewId}`,'PUT',body,who)).status,200);
  assert.equal(row().gain,5);
  for(const {key} of reviewDimensions)for(const value of [undefined,null,''])assert.equal((await call(`/api/reviews/${reviewId}`,'PUT',{...data,[key]:value},who)).status,400);
  assert.equal(row().difficulty,1);assert.equal(row().gain,5);
  assert.equal((await call(`/api/reviews/${reviewId}`,'PUT',{...data,gain:3},who)).status,200);
  assert.equal(row().gain,3);
  assert.equal((await call(`/api/reviews/${reviewId}`,'PUT',{...data,gain:'bad'},who)).status,400);
  assert.equal(row().gain,3);
  await call(`/api/reviews/${reviewId}`,'DELETE',undefined,who);
  assert.equal(row().gain,3);
  assert.equal((await call(`/api/reviews/${reviewId}`,'PUT',{...data,gain:null},who)).status,400);
  assert.equal(db.prepare('SELECT status FROM reviews WHERE id=?').get(reviewId).status,'hidden');
  assert.equal((await call(`/api/reviews/${reviewId}`,'PUT',{...data,gain:3},who)).status,200);
  assert.equal(row().gain,3);
  await call(`/api/reviews/${reviewId}`,'DELETE',undefined,who);
  await call(`/api/reviews/${reviewId}/permanent`,'DELETE',undefined,who);
  assert.equal(row(),undefined);assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
});

test('维度重开数据库仍保留，迁移可重复执行，旧评价不补造维度',()=>{
  const dir=mkdtempSync(join(tmpdir(),'nnu-dimensions-')),file=join(dir,'test.sqlite');let disk=openDatabase(file);
  try{
    importCatalog(disk,readCatalog());disk.prepare('INSERT INTO users VALUES(?,?,?)').run('dimension-user','test',new Date().toISOString());
    const c=courseDetail(disk,'1000000015'),data={courseId:c.code,groupId:c.groups[0].sourceGroupIds[0],rating:4,content:'持久化测试',difficulty:5,workload:3,grading:2,gain:1};
    const created=writeReview(disk,{userId:'dimension-user'},data);disk.close();disk=openDatabase(file);migrateReviews(disk);
    const r=readReviews(disk,{headers:{}},c.code,new URLSearchParams()).items.find(r=>r.id===created.id);
    for(const {key} of reviewDimensions)assert.equal(r[key],data[key]);
    assert.equal(r.rating,4);
    disk.prepare('DELETE FROM review_dimensions WHERE review_id=?').run(created.id);
    const legacy=readReviews(disk,{headers:{}},c.code,new URLSearchParams()).items[0];
    for(const {key} of reviewDimensions)assert.equal(legacy[key],null);
    assert.throws(()=>writeReview(disk,{userId:'dimension-user'},{...data,gain:null},created.id),/请选择收获/);
    assert.equal(disk.prepare('SELECT * FROM review_dimensions WHERE review_id=?').get(created.id),undefined);
    writeReview(disk,{userId:'dimension-user'},data,created.id);
    assert.equal(readReviews(disk,{headers:{}},c.code,new URLSearchParams()).items[0].gain,1);
  }finally{disk.close();rmSync(dir,{recursive:true,force:true});}
});
test('上下册评价保存原始课程，同时在统一页和同一教师下汇总',()=>{
  const isolated=openDatabase(':memory:');try{
    for(const [code,name] of [['UP','高等数学Ⅰ(上)'],['DOWN','高等数学Ⅰ(下)'],['OTHER','线性代数']]){isolated.prepare('INSERT INTO courses VALUES(?,?,?,?,?,?,?)').run(code,name,'测试学院','测试','测试',4,72);isolated.prepare('INSERT INTO teaching_groups VALUES(?,?,?,?,?)').run('g-'+code,code,name,'测试教师',1);}
    syncCoursePages(isolated);isolated.prepare('INSERT INTO users VALUES(?,?,?)').run('u','test',new Date().toISOString());
    const term=studyTerms(isolated)[0].id,detail=courseDetail(isolated,'UP');assert.equal(detail.groups[0].sourceGroups.length,2);
    for(const [code,rating]of [['UP',1],['DOWN',5]])writeReview(isolated,{userId:'u'},{courseId:detail.code,groupId:'g-'+code,semesterId:term,rating,content,...dimensions});
    const updated=courseDetail(isolated,'DOWN');assert.equal(updated.code,detail.code);assert.equal(updated.reviewCount,2);assert.equal(updated.rating,3);assert.equal(updated.groups[0].rating,3);
    const feed=readReviews(isolated,{headers:{}},'UP',new URLSearchParams({teacher:updated.groups[0].id}));assert.deepEqual(feed.items.map(r=>r.courseCode).sort(),['DOWN','UP']);
    assert.throws(()=>writeReview(isolated,{userId:'u'},{courseId:detail.code,groupId:'g-OTHER',semesterId:term,rating:4,content}),/请选择这门课/);
  }finally{isolated.close();}
});
test('短时间多次新评价受限；无效 JSON 不写入数据库',async()=>{
  const bad=await fetch(url+'/api/reviews',{method:'POST',headers:{Cookie:person.cookie,'X-CSRF-Token':person.csrf,'Content-Type':'application/json'},body:'{broken'});assert.equal(bad.status,400);
  for(let n=2;n<=5;n++)assert.equal((await call('/api/reviews','POST',{...body,semesterId:person.terms[n].id})).status,201);
  assert.equal((await call('/api/reviews','POST',{...body,semesterId:person.terms[6].id})).status,429);
});
test('短评和省略学期可发布、查看、修改和撤回；空学期重复请求不会多写',async()=>{
  const who=await identity(),data={courseId:body.courseId,groupId:body.groupId,rating:5,content:'好',...dimensions};
  const created=await call('/api/reviews','POST',data,who);assert.equal(created.status,201);
  for(const semesterId of [null,'']){const replay=await call('/api/reviews','POST',{...data,semesterId},who);assert.equal(replay.status,200);assert.equal(replay.data.id,created.data.id);}
  assert.equal((await call('/api/reviews','POST',{...data,content:'不错'},who)).status,409);
  const row=db.prepare('SELECT * FROM reviews WHERE id=?').get(created.data.id);assert.equal(row.semester_id,null);
  assert.throws(()=>db.prepare('INSERT INTO reviews SELECT ?,user_id,group_id,semester_id,rating,content,anonymous,status,created_at,updated_at FROM reviews WHERE id=?').run('duplicate-no-term',row.id),/UNIQUE/);
  const feed=(await call(`/api/courses/${body.courseId}/reviews`,'GET',undefined,who)).data.items.find(r=>r.id===row.id);assert.equal(feed.content,'好');assert.equal(feed.semesterLabel,null);
  assert.equal((await call(`/api/reviews/${row.id}`,'PUT',{...data,content:'不错',semesterId:''},who)).status,200);
  assert.equal((await call(`/api/reviews/${row.id}`,'DELETE',undefined,who)).status,200);
  assert.equal((await call(`/api/reviews/${row.id}`,'PUT',{...data,semesterId:null},who)).status,200);
  assert.equal((await call('/api/reviews','POST',{...data,semesterId:0},who)).status,400);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
});
test('只有作者能彻底删除已撤回评价；删除后不可见、不可恢复且可重新评价',async()=>{
  const who=await identity(),data={courseId:body.courseId,groupId:body.groupId,rating:4,content:'删除功能独立测试',...dimensions};
  const created=await call('/api/reviews','POST',data,who),reviewId=created.data.id,path=`/api/reviews/${reviewId}/permanent`;
  assert.equal(created.status,201);
  assert.equal((await call(path,'DELETE',undefined,null)).status,401);
  assert.equal((await call(path,'DELETE',undefined,who,{'X-CSRF-Token':'wrong'})).status,403);
  assert.equal((await call(path,'DELETE',undefined,who)).status,409);
  assert.equal((await call(`/api/reviews/${reviewId}`,'DELETE',undefined,who)).status,200);
  assert.equal((await call(path,'DELETE',undefined,other)).status,404);
  assert.equal(db.prepare('SELECT status FROM reviews WHERE id=?').get(reviewId).status,'hidden');
  const before=courseDetail(db,body.courseId).reviewCount;
  assert.equal((await call(path,'DELETE',undefined,who)).status,200);
  assert.equal(db.prepare('SELECT * FROM reviews WHERE id=?').get(reviewId),undefined);
  assert.equal((await call(`/api/reviews/${reviewId}`,'PUT',data,who)).status,404);
  for(const viewer of [who,other,null])assert.ok(!(await call(`/api/courses/${body.courseId}/reviews`,'GET',undefined,viewer)).data.items.some(r=>r.id===reviewId));
  assert.equal(courseDetail(db,body.courseId).reviewCount,before);
  const again=await call('/api/reviews','POST',data,who);assert.equal(again.status,201);assert.notEqual(again.data.id,reviewId);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
});
