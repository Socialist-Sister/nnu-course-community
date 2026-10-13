import test from 'node:test';
import assert from 'node:assert/strict';
import {notificationFixture} from './notification-fixture.mjs';
import {migrateNotifications} from '../server/notifications.mjs';

const author='notify_author',admin='notify_owner',other='notify_reporter';
async function setup(t){const f=await notificationFixture();t.after(()=>f.close());const r=f.db.prepare('SELECT * FROM reviews WHERE id=?').get(f.reviewId);f.path=`/api/reviews/${f.reviewId}/revision`;f.input={courseId:'1000000015',groupId:r.group_id,semesterId:r.semester_id,rating:3,difficulty:2,workload:3,grading:4,gain:4,content:'每周作业较多，需要提前安排时间。',note:'补充了具体的作业情况'};assert.equal((await f.call(admin,`/api/admin/reviews/${f.reviewId}`,'POST',{action:'block',reason:'请补充具体经历'})).status,200);return f;}
const decision=(f,id,action='approve',name=admin)=>f.call(name,`/api/admin/revisions/${id}`,'POST',{action,reason:action==='approve'?'已核查，内容可以公开。':'请补充发生的学期与作业内容。'});

test('复核稿私有、旧评价保持下架，通过后原子更新正文评分维度并通知一次',async t=>{
  const f=await setup(t),old=f.db.prepare('SELECT * FROM reviews WHERE id=?').get(f.reviewId);
  const posted=await f.call(author,f.path,'POST',f.input);assert.equal(posted.status,200);const id=posted.data.id;
  assert.deepEqual(f.db.prepare('SELECT * FROM reviews WHERE id=?').get(f.reviewId),old);
  const mine=(await f.call(author,'/api/my/reviews')).data.items[0];assert.equal(mine.revision.id,id);assert.equal(mine.revision.proposed.content,f.input.content);
  assert.equal((await f.call(other,'/api/courses/1000000015/reviews')).data.items.length,0);
  assert.equal((await f.call(author,'/api/courses/1000000015/reviews')).data.items[0].revision.id,id);
  assert.equal((await f.call(admin,'/api/admin/revisions/summary')).data.pending,1);
  assert.equal((await f.call(admin,'/api/admin/reviews')).data.items[0].pendingRevision,1);
  const queue=(await f.call(admin,'/api/admin/revisions')).data;assert.equal(queue.items[0].original.content,old.content);
  assert.equal((await f.call(author,f.path,'POST',f.input)).data.id,id);
  assert.equal((await f.call(author,f.path,'POST',{...f.input,content:'另一版本'})).status,409);
  assert.equal((await f.call(author,`/api/reviews/${f.reviewId}`,'PUT',f.input)).status,403);
  assert.equal((await f.call(admin,`/api/admin/reviews/${f.reviewId}`,'POST',{action:'restore',reason:'直接恢复'})).status,409);
  assert.equal((await decision(f,id)).status,200);assert.equal((await decision(f,id)).data.replayed,true);
  const r=(await f.call(other,'/api/courses/1000000015/reviews')).data.items[0];assert.equal(r.content,f.input.content);assert.equal(r.rating,3);assert.equal(r.workload,3);assert.equal(r.revision,undefined);
  const log=f.db.prepare('SELECT * FROM review_revisions WHERE id=?').get(id);assert.equal(log.status,'approved');assert.equal(JSON.parse(log.original).content,old.content);
  const notices=(await f.call(author,'/api/notifications')).data.items.filter(n=>n.kind==='review.revision.approved');assert.equal(notices.length,1);assert.equal(notices[0].reason,'已核查，内容可以公开。');assert.equal(JSON.stringify(notices).includes(f.input.content),false);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM admin_audit WHERE action='review.revision.approved'").get().n,1);
});
test('退回后保留修改稿和历史，作者可再次申请；处理结果不能被覆盖',async t=>{
  const f=await setup(t),id=(await f.call(author,f.path,'POST',f.input)).data.id;
  assert.equal((await decision(f,id,'reject')).status,200);assert.equal((await decision(f,id,'reject')).data.replayed,true);
  assert.equal((await decision(f,id)).status,409);assert.equal((await f.call(other,'/api/courses/1000000015/reviews')).data.items.length,0);
  const mine=(await f.call(author,'/api/my/reviews')).data.items[0];assert.equal(mine.revision.status,'rejected');assert.match(mine.revision.reason,/补充/);assert.equal(mine.revision.proposed.content,f.input.content);
  const next=await f.call(author,f.path,'POST',{...f.input,note:'补充材料后重新申请'});assert.equal(next.status,200);assert.notEqual(next.data.id,id);
  assert.equal((await f.call(admin,'/api/admin/revisions?status=all')).data.total,2);
  assert.equal((await f.call(author,'/api/notifications')).data.items.filter(n=>n.kind==='review.revision.rejected').length,1);
});
test('复核接口隔离作者、校园验证、同源校验及管理员分级并即时撤权',async t=>{
  const f=await setup(t);
  assert.equal((await f.call(null,f.path,'POST',f.input)).status,401);
  assert.equal((await f.call(other,f.path,'POST',f.input)).status,404);
  assert.equal((await f.call(author,f.path,'POST',f.input,{'X-CSRF-Token':'wrong'})).status,403);
  assert.equal((await f.call(author,f.path,'POST',f.input,{Origin:'https://untrusted.example'})).status,403);
  f.db.prepare('UPDATE accounts SET email_verified_at=NULL WHERE user_id=?').run(author);
  assert.equal((await f.call(author,f.path,'POST',f.input)).status,403);
  f.db.prepare('UPDATE accounts SET email_verified_at=? WHERE user_id=?').run(new Date().toISOString(),author);
  const id=(await f.call(author,f.path,'POST',f.input)).data.id;
  assert.equal((await f.call(author,'/api/admin/revisions')).status,403);
  assert.equal((await decision(f,id,'approve',other)).status,403);
  await f.call(admin,'/api/admin/members','POST',{action:'grant',id:other,content:false,courses:true});
  assert.equal((await f.call(other,'/api/admin/revisions/summary')).status,403);
  assert.equal((await decision(f,id,'approve',other)).status,403);
  await f.call(admin,'/api/admin/members','POST',{action:'grant',id:other,content:true,courses:false});
  assert.equal((await f.call(other,'/api/admin/revisions')).status,200);
  await f.call(admin,'/api/admin/members','POST',{action:'revoke',id:other});
  assert.equal((await decision(f,id,'approve',other)).status,403);
  assert.equal((await f.call(other,f.path,'DELETE',{revisionId:id})).status,404);
});
test('取消申请和撤回评价阻止旧审批；撤回后的评价通过复核仍不公开',async t=>{
  const f=await setup(t);let id=(await f.call(author,f.path,'POST',f.input)).data.id;
  assert.equal((await f.call(author,f.path,'DELETE',{revisionId:id})).status,200);assert.equal((await decision(f,id)).status,409);
  id=(await f.call(author,f.path,'POST',f.input)).data.id;
  await f.call(author,`/api/reviews/${f.reviewId}`,'DELETE');assert.equal((await decision(f,id)).status,409);
  id=(await f.call(author,f.path,'POST',f.input)).data.id;
  assert.equal((await decision(f,id)).status,200);
  assert.equal(f.db.prepare('SELECT status FROM reviews WHERE id=?').get(f.reviewId).status,'hidden');
  assert.equal((await f.call(other,'/api/courses/1000000015/reviews')).data.items.length,0);
  assert.equal((await f.call(author,f.path,'POST',f.input)).status,409);
  await f.call(author,`/api/reviews/${f.reviewId}/permanent`,'DELETE');assert.equal(f.db.prepare('SELECT COUNT(*) n FROM review_revisions').get().n,0);
});
test('原文申诉要求理由且可人工复核规则误判，修改稿仍接受敏感内容和字段校验',async t=>{
  const f=await setup(t),original=f.db.prepare('SELECT * FROM reviews WHERE id=?').get(f.reviewId);
  assert.equal((await f.call(author,f.path,'POST',{...f.input,rating:original.rating,content:original.content,note:''})).status,400);
  for(const data of [{groupId:'no-group'},{semesterId:'no-term'},{rating:7},{gain:null},{note:'x'.repeat(1001)},{content:'你是傻逼'}])assert.ok([400,422].includes((await f.call(author,f.path,'POST',{...f.input,...data})).status));
  // An old quotation can now match a rule; appeal it privately without granting ordinary edits a bypass.
  f.db.prepare('UPDATE reviews SET content=? WHERE id=?').run('有人说“你是傻逼”，我认为不应这样说。',f.reviewId);
  const body=f.db.prepare('SELECT content FROM reviews WHERE id=?').get(f.reviewId).content;
  const appeal=await f.call(author,f.path,'POST',{...f.input,content:body,note:'这是对原话的引用，请核查语境。'});assert.equal(appeal.status,200);
  assert.equal((await f.call(other,'/api/courses/1000000015/reviews')).data.items.length,0);
});
test('两个管理员并发处理只有一次生效，失败通知令整个审批回滚',async t=>{
  const f=await setup(t);await f.call(admin,'/api/admin/members','POST',{action:'grant',id:other,content:true,courses:false});
  const id=(await f.call(author,f.path,'POST',f.input)).data.id;
  f.db.exec("CREATE TRIGGER fail_revision_notice BEFORE INSERT ON notifications WHEN NEW.kind='review.revision.approved' BEGIN SELECT RAISE(ABORT,'isolated test failure'); END");
  assert.equal((await decision(f,id)).status,500);assert.equal(f.db.prepare('SELECT status FROM review_revisions WHERE id=?').get(id).status,'pending');
  assert.equal(f.db.prepare('SELECT status FROM reviews WHERE id=?').get(f.reviewId).status,'pending');
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM admin_audit WHERE action='review.revision.approved'").get().n,0);
  f.db.exec('DROP TRIGGER fail_revision_notice');
  const results=await Promise.all([decision(f,id),decision(f,id,'reject',other)]);assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM notifications WHERE kind LIKE 'review.revision.%'").get().n,1);
});
test('账号注销清除私有复核材料，不会留下无人可管理的待办',async t=>{
  const f=await setup(t),id=(await f.call(author,f.path,'POST',f.input)).data.id;
  assert.equal((await f.call(author,'/api/account/delete','POST',{currentPassword:f.password,confirmation:'注销账号'})).status,200);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM review_revisions').get().n,0);assert.equal((await decision(f,id)).status,404);
  assert.equal(f.db.prepare('SELECT status FROM reviews WHERE id=?').get(f.reviewId).status,'pending');
});
test('通知迁移保留旧通知、已读状态及单调 ID；重复迁移安全',async t=>{
  const f=await notificationFixture();t.after(()=>f.close());
  f.db.exec(`DROP TABLE notifications; CREATE TABLE notifications(id INTEGER PRIMARY KEY AUTOINCREMENT,account_id TEXT NOT NULL REFERENCES accounts(user_id) ON DELETE CASCADE,kind TEXT NOT NULL CHECK(kind IN('review.block','review.restore','report.resolved','report.dismissed')),review_id TEXT REFERENCES reviews(id) ON DELETE SET NULL,course_code TEXT,course_name TEXT NOT NULL,reason TEXT NOT NULL,created_at TEXT NOT NULL,read_at TEXT);`);
  const insert=f.db.prepare('INSERT INTO notifications VALUES(?,?,?,?,?,?,?,?,?)');insert.run(1,author,'review.block',f.reviewId,'1000000015','课程','原说明','2026-09-01','2026-09-02');insert.run(8,author,'review.restore',f.reviewId,'1000000015','课程','原说明','2026-09-01',null);
  f.db.exec('DELETE FROM notifications WHERE id=8');const before=f.db.prepare('SELECT * FROM notifications').all();migrateNotifications(f.db);migrateNotifications(f.db);
  assert.deepEqual(f.db.prepare('SELECT * FROM notifications').all(),before);
  insert.run(null,author,'review.revision.approved',f.reviewId,'1000000015','课程','复核通过','2026-10-12',null);
  assert.equal(f.db.prepare('SELECT MAX(id) n FROM notifications').get().n,9);assert.equal(f.db.prepare('PRAGMA foreign_key_check').all().length,0);
});
