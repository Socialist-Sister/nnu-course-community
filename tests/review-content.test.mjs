import {test} from 'node:test';
import assert from 'node:assert/strict';
import {reviewContentIssue,reviewContentMessage} from '../shared/review-content.mjs';
import {notificationFixture} from './notification-fixture.mjs';

test('明确辱骂、常见分隔/零宽变体、直接威胁和招揽会被提示',()=>{
  for(const text of ['真是傻逼','傻 逼','傻*逼','傻\u200b逼','操你妈','狗东西',
    '你这个垃圾','这老师是个废物','垃圾老师','你是ＳＢ','你是s.b','fuck you',
    '我要弄死你','你去死','出售真人肢解视频','出售无码色情视频',
    '加我裸聊','加我做刷单返利','刷单返利联系我']){
    const issue=reviewContentIssue(text);assert.ok(issue,text);
    assert.ok(reviewContentMessage(issue).includes(issue.fragment));
  }
});

test('正常负面评价、专业词汇、反诈和课程内容不使用宽泛单词拦截',()=>{
  for(const text of ['老师讲得很差，给分很低，作业很多，不推荐。','这门课程很垃圾，PPT照读，没有反馈。',
    '垃圾分类讲得好，傻比较起来不如笨这个词合适。','变态反应和智障儿童教育都是课程内容。',
    'USB 接口、SB 模型和傻瓜相机；class、Scunthorpe、assist。','死记硬背真累，期末挂科率高。',
    '电影比较血腥，涉及杀人、肢解和色情镜头，不适合我。','反诈课讲了裸聊诈骗、刷单返利，不要给陌生人转账。',
    '杀死一只知更鸟是阅读书目。','犯罪学讨论暴力、强奸、赌博与洗钱。',
    '老师说话带有人身攻击，我已向学院反映。','傻。逼近极限时需要计算。',
    '你是SB模型的研究者吗？','老师是垃圾分类的专家，他是废物利用方面的研究者。','正常评价'.repeat(700)]){
    assert.equal(reviewContentIssue(text),null,text.slice(0,70));
  }
  assert.equal(reviewContentIssue(null),null);
});

test('服务端阻止新增、编辑、撤回后重发；失败不写库，修改后可以发布',async t=>{
  const f=await notificationFixture();t.after(()=>f.close());
  const original=f.db.prepare('SELECT * FROM reviews WHERE id=?').get(f.reviewId);
  const body={courseId:'1000000015',groupId:original.group_id,semesterId:null,
    rating:1,difficulty:2,workload:3,grading:2,gain:2,content:'这个老师是个废物'};
  const count=()=>f.db.prepare('SELECT COUNT(*) n FROM reviews').get().n;
  const before=count();
  for(let i=0;i<6;i++){
    const r=await f.call('notify_reporter','/api/reviews','POST',body);
    assert.equal(r.status,422);assert.equal(r.data.code,'REVIEW_CONTENT_BLOCKED');
    assert.match(r.data.error,/老师是个废物/);
  }
  assert.equal(count(),before);
  const path='/api/reviews/'+f.reviewId;
  assert.equal((await f.call('notify_author',path,'PUT',body)).status,422);
  assert.deepEqual(f.db.prepare('SELECT * FROM reviews WHERE id=?').get(f.reviewId),original);
  await f.call('notify_author',path,'DELETE');
  assert.equal((await f.call('notify_author',path,'PUT',body)).status,422);
  assert.equal(f.db.prepare('SELECT status FROM reviews WHERE id=?').get(f.reviewId).status,'hidden');
  const corrected={...body,content:'讲得很差，作业多，给分低，不推荐。'};
  assert.equal((await f.call('notify_author',path,'PUT',corrected)).status,200);
  assert.equal((await f.call('notify_reporter','/api/reviews','POST',corrected)).status,201);
  assert.equal(count(),before+1);
  // Detection doesn't create moderation records, alerts, or silently rewrite text.
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM notifications').get().n,0);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM review_moderation').get().n,0);
  assert.equal(f.db.prepare('SELECT content FROM reviews WHERE id=?').get(f.reviewId).content,corrected.content);
  const guest=await f.call(null,'/api/reviews','POST',body);assert.equal(guest.status,401);
});
