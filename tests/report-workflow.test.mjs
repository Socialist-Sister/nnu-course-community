import {test} from 'node:test';
import assert from 'node:assert/strict';
import {notificationFixture} from './notification-fixture.mjs';
import {migrateReportWorkflow} from '../server/report-workflow.mjs';

async function setup(t){
  const f=await notificationFixture();t.after(()=>f.close());
  const result=await f.call('notify_reporter',`/api/reviews/${f.reviewId}/report`,'POST',{reason:'测试举报'});
  f.reportId=result.data.id;f.path=`/api/admin/reports/${f.reportId}`;
  await f.call('notify_owner','/api/admin/members','POST',{id:'notify_author',action:'grant',content:true,courses:false});
  return f;
}
const row=async f=>(await f.call('notify_owner','/api/admin/reports')).data.items[0];

test('协作权限、认领竞争、版本冲突和待办筛选',async t=>{
  const f=await setup(t);
  assert.equal((await f.call(null,'/api/admin/reports/summary')).status,401);
  assert.equal((await f.call('notify_reporter',f.path+'/notes')).status,403);
  await f.call('notify_owner','/api/admin/members','POST',{id:'notify_reporter',action:'grant',content:false,courses:true});
  assert.equal((await f.call('notify_reporter','/api/admin/reports/summary')).status,403);
  assert.equal((await f.call('notify_reporter',f.path+'/claim','POST',{version:0})).status,403);
  assert.equal((await f.call('notify_author',f.path+'/claim','POST',{version:0},{'X-CSRF-Token':'bad'})).status,403);
  assert.equal((await f.call('notify_author',f.path+'/claim','POST',{version:0},{Origin:'https://other.test'})).status,403);
  assert.equal((await f.call('notify_author',f.path+'/claim','POST',{})).status,400);
  const races=await Promise.all(['notify_author','notify_owner'].map(a=>f.call(a,f.path+'/claim','POST',{version:0})));
  assert.deepEqual(races.map(r=>r.status).sort(),[200,409]);
  const current=await row(f),winner=current.assigneeId,loser=winner==='notify_owner'?'notify_author':'notify_owner';
  assert.equal((await f.call(winner,'/api/admin/reports/summary')).data.mine,1);
  assert.equal((await f.call(winner,'/api/admin/reports?assignment=mine')).data.total,1);
  assert.equal((await f.call(loser,'/api/admin/reports?assignment=mine')).data.total,0);
  assert.equal((await f.call(winner,'/api/admin/reports?assignment=unassigned')).data.total,0);
  assert.equal((await f.call(loser,f.path,'POST',{status:'resolved',resolution:'越过认领人'})).status,409);
  assert.equal((await f.call(winner,f.path,'POST',{status:'resolved',resolution:'旧窗口',version:0})).status,409);
  assert.equal((await f.call('notify_owner','/api/admin/reports?assignment=bad')).status,400);
  assert.equal((await f.call(winner,f.path+'/release','POST',{version:current.version})).status,200);
  assert.equal((await f.call(winner,'/api/admin/reports/summary')).data.unassigned,1);
});

test('内部备注追加并分页，仅审核员可见且不会进入通知或公开评价',async t=>{
  const f=await setup(t),secret='仅后台内部的交接事项';
  assert.equal((await f.call('notify_author',f.path+'/notes','POST',{body:secret})).status,200);
  for(let i=0;i<21;i++)assert.equal((await f.call('notify_owner',f.path+'/notes','POST',{body:'核查记录 '+i})).status,200);
  const first=(await f.call('notify_author',f.path+'/notes')).data,second=(await f.call('notify_author',f.path+'/notes?page=2')).data;
  assert.equal(first.total,22);assert.equal(first.items.length,20);assert.equal(second.items.length,2);
  assert.equal(second.items[1].body,secret);assert.equal(second.items[1].author,'notify_author');
  assert.equal((await row(f)).noteCount,22);
  for(const body of ['', 'a'.repeat(2001)])assert.equal((await f.call('notify_author',f.path+'/notes','POST',{body})).status,400);
  assert.equal((await f.call('notify_author',f.path+'/notes?page=-1')).status,400);
  for(const [who,path] of [[null,'/api/home'],[null,'/api/courses/1000000015/reviews'],['notify_author','/api/my/reviews'],['notify_reporter','/api/notifications']])assert.ok(!JSON.stringify((await f.call(who,path)).data).includes(secret));
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM notifications').get().n,0);
  const audit=f.db.prepare("SELECT detail FROM admin_audit WHERE action='report.note'").all();assert.equal(audit.length,22);assert.ok(audit.every(a=>!a.detail.includes(secret)));
  migrateReportWorkflow(f.db);assert.equal((await f.call('notify_author',f.path+'/notes')).data.total,22);
});

test('负责人接管、撤权任务重新认领、报告上下文下架防过期操作',async t=>{
  const f=await setup(t);
  await f.call('notify_owner',f.path+'/claim','POST',{version:0});
  assert.equal((await f.call('notify_author',f.path+'/takeover','POST',{version:1})).status,403);
  assert.equal((await f.call('notify_author',f.path+'/release','POST',{version:1})).status,403);
  await f.call('notify_owner',f.path+'/release','POST',{version:1});
  await f.call('notify_author',f.path+'/claim','POST',{version:2});
  assert.equal((await f.call('notify_owner',f.path+'/takeover','POST',{version:3})).status,200);
  assert.equal((await f.call('notify_author',`/api/admin/reviews/${f.reviewId}`,'POST',{action:'block',reason:'过期',reportId:f.reportId,reportVersion:3})).status,409);
  assert.equal(f.db.prepare('SELECT status FROM reviews WHERE id=?').get(f.reviewId).status,'published');
  await f.call('notify_owner',f.path+'/release','POST',{version:4});
  await f.call('notify_author',f.path+'/claim','POST',{version:5});
  await f.call('notify_owner','/api/admin/members','POST',{id:'notify_author',action:'revoke'});
  assert.equal((await f.call('notify_author',f.path+'/notes')).status,403);
  assert.equal((await f.call('notify_owner','/api/admin/reports/summary')).data.unassigned,1);
  assert.equal((await f.call('notify_owner',f.path+'/claim','POST',{version:6})).status,200);
  assert.equal((await f.call('notify_owner',`/api/admin/reviews/${f.reviewId}`,'POST',{action:'block',reason:'公开说明',reportId:f.reportId,reportVersion:7})).status,200);
  assert.equal((await row(f)).version,8);
});

test('处理和通知原子提交，已完成结果不能互相覆盖，删除账号不阻塞任务',async t=>{
  const f=await setup(t);
  await f.call('notify_author',f.path+'/claim','POST',{version:0});
  await f.call('notify_author',f.path+'/notes','POST',{body:'备注保留'});
  // Foreign-key behavior for a departed assignee, without changing report/review ownership.
  f.db.prepare('DELETE FROM account_members WHERE account_id=?').run('notify_author');
  f.db.prepare('DELETE FROM accounts WHERE user_id=?').run('notify_author');
  assert.equal((await row(f)).assigneeId,null);
  assert.equal((await f.call('notify_owner',f.path+'/notes')).data.items[0].author,'已注销管理员');
  f.db.exec("CREATE TRIGGER fail_report_notification BEFORE INSERT ON notifications BEGIN SELECT RAISE(ABORT,'rollback report'); END;");
  assert.equal((await f.call('notify_owner',f.path,'POST',{status:'resolved',resolution:'用户可见',version:1})).status,500);
  assert.equal((await row(f)).assigneeId,null);assert.equal((await row(f)).status,'open');
  f.db.exec('DROP TRIGGER fail_report_notification');
  const result={status:'resolved',resolution:'用户可见',version:1};
  assert.equal((await f.call('notify_owner',f.path,'POST',result)).status,200);
  assert.equal((await f.call('notify_owner',f.path,'POST',result)).status,200);
  assert.equal((await f.call('notify_owner',f.path,'POST',{status:'dismissed',resolution:'覆盖'})).status,409);
  assert.equal((await f.call('notify_reporter','/api/notifications')).data.total,1);
  assert.equal((await f.call('notify_reporter','/api/notifications')).data.items[0].reason,'用户可见');
  assert.equal((await f.call('notify_owner','/api/admin/reports/summary')).data.open,0);
  assert.equal((await f.call('notify_owner',f.path+'/claim','POST',{version:3})).status,409);
  assert.equal(f.db.prepare('PRAGMA foreign_key_check').all().length,0);
});
