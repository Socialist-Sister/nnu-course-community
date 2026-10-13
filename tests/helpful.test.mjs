import {test} from 'node:test';
import assert from 'node:assert/strict';
import {notificationFixture} from './notification-fixture.mjs';
import {newSession} from '../server/accounts.mjs';
import {migrateHelpful} from '../server/helpful.mjs';

async function setup(t){const f=await notificationFixture();t.after(()=>f.close());return f;}
const feed=f=>'/api/courses/1000000015/reviews';

test('有帮助要求账号、校园邮箱和有效CSRF，拒绝为关联的旧评价自赞',async t=>{
  const f=await setup(t),path=`/api/reviews/${f.reviewId}/helpful`;
  assert.equal((await f.call(null,path,'PUT',{helpful:true})).status,401);
  assert.equal((await f.call('notify_reporter',path,'PUT',{helpful:true},{'X-CSRF-Token':'wrong'})).status,403);
  assert.equal((await f.call('notify_reporter',path,'PUT',{helpful:true},{Origin:'https://other.test'})).status,403);
  assert.equal((await f.call('notify_author',path,'PUT',{helpful:true})).status,400);
  f.db.prepare('UPDATE accounts SET email_verified_at=NULL WHERE user_id=?').run('notify_reporter');
  assert.equal((await f.call('notify_reporter',path,'PUT',{helpful:true})).status,403);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM review_helpful').get().n,0);
});

test('点赞和取消为幂等状态设置，重复并发请求只计一次，跨会话同步且不泄漏点赞者',async t=>{
  const f=await setup(t),path=`/api/reviews/${f.reviewId}/helpful`;
  for(const result of await Promise.all(Array.from({length:8},()=>f.call('notify_reporter',path,'PUT',{helpful:true})))){
    assert.equal(result.status,200);assert.deepEqual(result.data,{id:f.reviewId,helpfulCount:1,helpful:true});
  }
  const cookie={};const session=newSession(f.db,{setHeader(k,v){cookie.cookie=v.split(';')[0];}},{socket:{}},'notify_reporter');
  f.clients.second={...cookie,csrf:session.csrf};
  const own=await f.call('second',feed(f));assert.equal(own.data.items[0].helpful,true);assert.equal(own.cache,'no-store');
  const publicFeed=(await f.call(null,feed(f))).data.items[0];assert.equal(publicFeed.helpful,false);assert.equal(publicFeed.helpfulCount,1);
  assert.ok(!JSON.stringify(publicFeed).includes('notify_reporter'));
  assert.equal((await f.call('notify_reporter','/api/home')).data.reviews[0].helpful,true);
  assert.equal((await f.call(null,'/api/home')).data.reviews[0].helpful,false);
  assert.equal((await f.call('notify_author','/api/my/reviews')).data.items[0].helpfulCount,1);
  assert.equal((await f.call('notify_owner',path,'PUT',{helpful:true})).data.helpfulCount,2);
  assert.equal((await f.call('second',path,'PUT',{helpful:false})).data.helpfulCount,1);
  assert.equal((await f.call('second',path,'PUT',{helpful:false})).data.helpfulCount,1);
  assert.equal((await f.call('notify_owner',feed(f))).data.items[0].helpful,true);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM notifications').get().n,0);
});

test('评价撤回或下架后拒绝点赞，恢复后保留原计数，删除评价清理点赞',async t=>{
  const f=await setup(t),path=`/api/reviews/${f.reviewId}/helpful`;
  await f.call('notify_reporter',path,'PUT',{helpful:true});
  await f.call('notify_owner',`/api/admin/reviews/${f.reviewId}`,'POST',{action:'block',reason:'隔离测试'});
  assert.equal((await f.call('notify_owner',path,'PUT',{helpful:true})).status,404);
  assert.equal((await f.call('notify_reporter',feed(f))).data.total,0);
  await f.call('notify_owner',`/api/admin/reviews/${f.reviewId}`,'POST',{action:'restore',reason:'隔离测试解除'});
  assert.equal((await f.call('notify_reporter',feed(f))).data.items[0].helpfulCount,1);
  await f.call('notify_author',`/api/reviews/${f.reviewId}`,'DELETE');
  assert.equal((await f.call('notify_reporter',path,'PUT',{helpful:false})).status,404);
  await f.call('notify_author',`/api/reviews/${f.reviewId}/permanent`,'DELETE');
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM review_helpful').get().n,0);
  assert.equal((await f.call('notify_reporter',path,'PUT',{helpful:true})).status,404);
});

test('迁移幂等、删除点赞账号清理其计数，参数和快速操作受校验',async t=>{
  const f=await setup(t),path=`/api/reviews/${f.reviewId}/helpful`;
  assert.equal((await f.call('notify_reporter',path,'PUT',{helpful:'true'})).status,400);
  await f.call('notify_reporter',path,'PUT',{helpful:true});
  migrateHelpful(f.db);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM review_helpful').get().n,1);
  assert.equal((await f.call('notify_reporter','/api/account/delete','POST',{currentPassword:f.password,confirmation:'注销账号'})).status,200);
  assert.equal((await f.call(null,feed(f))).data.items[0].helpfulCount,0);
  assert.equal(f.db.prepare('PRAGMA foreign_key_check').all().length,0);
  for(let i=0;i<60;i++)assert.equal((await f.call('notify_owner',path,'PUT',{helpful:true})).status,200);
  assert.equal((await f.call('notify_owner',path,'PUT',{helpful:false})).status,429);
});
