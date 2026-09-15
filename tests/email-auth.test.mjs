import {test} from 'node:test';
import assert from 'node:assert/strict';
import {scryptSync,randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {openDatabase,root} from '../server/database.mjs';
import {createApp} from '../server/index.mjs';
import {createMailer} from '../server/mailer.mjs';
import {normalizeEmail} from '../server/email-verification.mjs';
import {migrateAccounts} from '../server/accounts-schema.mjs';
import {migrateReviews} from '../server/review-schema.mjs';
import {migrateEmail} from '../server/email-schema.mjs';
import {digest,currentPerson,accountAction} from '../server/accounts.mjs';
import {migrateAccountDeletion} from '../server/account-deletion-schema.mjs';
import {createProfile,migrateProfiles} from '../server/profiles.mjs';
import sharp from 'sharp';
import {importCatalog,readCatalog} from '../server/import-catalog.mjs';
import {courseDetail,ApiError} from '../server/catalog.mjs';
import {writeReview} from '../server/reviews.mjs';
import {testMailbox,emailProof} from './mail-fixture.mjs';
const password='Isolated-test-password-123';
const nextPassword='Another-test-password-456';

test('公开评价显示所属账号当前昵称，兼容已认领评价，改名同步且注销后解除署名',async t=>{
  const f=await fixture(t,{catalog:true}),c=await f.guest();
  const oldGuest=currentPerson(f.db,{headers:{cookie:c.cookie}}).userId;
  const account=(await f.register(c,'nickname_author')).account;
  const detail=courseDetail(f.db,'1000000015');
  const posted=await f.call(c,'/api/reviews','POST',{courseId:detail.code,groupId:detail.groups[0].sourceGroupIds[0],rating:4,difficulty:2,workload:3,grading:4,gain:5,content:'昵称署名测试评价'});
  assert.equal(posted.status,201,JSON.stringify(posted.data));
  // A pre-registration review can belong to a claimed visitor identity.
  f.db.prepare('UPDATE reviews SET user_id=? WHERE id=?').run(oldGuest,posted.data.id);
  async function checkAuthor(expected){
    const course=await f.call(null,`/api/courses/${detail.code}/reviews`),home=await f.call(null,'/api/home');
    assert.equal(course.status,200);assert.equal(home.status,200);
    for(const item of [course.data.items.find(r=>r.id===posted.data.id),home.data.reviews.find(r=>r.id===posted.data.id)]){
      assert.ok(item);assert.equal(item.author,expected);
      for(const key of ['email','username','userId','user_id','accountId','avatar','avatarUrl'])assert.equal(item[key],undefined);
      assert.ok(!JSON.stringify(item).includes('nickname_author'));
    }
  }
  await checkAuthor(account.nickname);
  assert.equal((await f.call(c,'/api/account/profile','POST',{nickname:'随园读书人'})).status,200);
  await checkAuthor('随园读书人');
  assert.equal((await f.call(c,'/api/account/delete','POST',{currentPassword:password,confirmation:'注销账号'})).status,200);
  await checkAuthor('已注销用户');
  assert.equal(f.db.prepare('SELECT 1 FROM account_profiles WHERE user_id=?').get(account.id),undefined);
});

test('同一校园出口100位访客依次完成验证码注册，不受旧注册IP上限误拦',async t=>{
  const f=await fixture(t);let now=Date.now();t.mock.method(Date,'now',()=>now);
  for(let i=0;i<100;i++){const c=await f.guest();const result=await f.register(c,'campus_'+i);assert.ok(result.account);now+=500;}
  assert.equal(f.db.prepare('SELECT count(*) n FROM accounts').get().n,100);assert.equal(f.mailer.messages.length,100);
});

test('默认昵称唯一且六位数字碰撞时重试；迁移已有账号不改变登录信息',()=>{
  const db=new DatabaseSync(':memory:');try{
    db.exec('PRAGMA foreign_keys=ON');db.exec(readFileSync(resolve(root,'server/schema.sql'),'utf8'));migrateReviews(db);migrateAccounts(db);migrateEmail(db);migrateAccountDeletion(db);
    seedLegacy(db,'profile_old_one');seedLegacy(db,'profile_old_two');const before=db.prepare('SELECT * FROM accounts ORDER BY username').all();
    migrateProfiles(db);migrateProfiles(db);
    assert.deepEqual(db.prepare('SELECT * FROM accounts ORDER BY username').all(),before);
    const profiles=db.prepare('SELECT * FROM account_profiles').all();assert.equal(profiles.length,2);assert.notEqual(profiles[0].nickname,profiles[1].nickname);
    for(const p of profiles)assert.match(p.nickname,/^小南狮\d{6}$/);
    const a=seedLegacy(db,'forced_collision_one'),b=seedLegacy(db,'forced_collision_two');createProfile(db,a.id,()=>42);createProfile(db,b.id,()=>42);
    const names=db.prepare('SELECT nickname FROM account_profiles').all().map(p=>p.nickname);assert.equal(new Set(names).size,4);
    assert.ok(names.includes('小南狮000042'));assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
  }finally{db.close();}
});

test('昵称与头像跨会话保存，头像受身份保护且删除账号后清理，登录名不变',async t=>{
  const f=await fixture(t),c=await f.guest(),other=await f.guest(),a=await f.register(c,'profile_student');
  assert.match(a.account.nickname,/^小南狮\d{6}$/);assert.equal(a.account.avatarUrl,null);
  const img=await sharp({create:{width:48,height:32,channels:3,background:'#217050'}}).png().toBuffer();
  const avatar='data:image/png;base64,'+img.toString('base64');
  const result=await f.call(c,'/api/account/profile','POST',{nickname:'随园小狮子',avatar});
  assert.equal(result.status,200,JSON.stringify(result.data));assert.equal(result.data.profile.nickname,'随园小狮子');assert.ok(result.data.profile.avatarUrl);
  const saved=f.db.prepare('SELECT * FROM account_profiles WHERE user_id=?').get(a.account.id),meta=await sharp(saved.avatar).metadata();
  assert.equal(meta.width,256);assert.equal(meta.height,256);assert.equal(meta.format,'webp');assert.equal(meta.exif,undefined);
  const served=await f.raw(c,result.data.profile.avatarUrl);assert.equal(served.status,200);assert.equal(served.headers.get('content-type'),'image/webp');assert.match(served.headers.get('cache-control'),/no-store/);assert.deepEqual(Buffer.from(await served.arrayBuffer()),Buffer.from(saved.avatar));
  const outsider=await f.guest();assert.equal((await f.raw(outsider,result.data.profile.avatarUrl)).status,401);
  const session=(await f.call(c,'/api/session')).data;assert.equal(session.account.nickname,'随园小狮子');assert.equal(session.account.username,'profile_student');
  const login=await f.call(other,'/api/account/login','POST',{identifier:'PROFILE_STUDENT',password});assert.equal(login.status,200);
  assert.equal((await f.call(other,'/api/session')).data.account.nickname,'随园小狮子');
  const avatarRow=f.db.prepare('SELECT avatar_version FROM account_profiles WHERE user_id=?').get(a.account.id);
  assert.equal((await f.call(c,'/api/account/profile','POST',{nickname:'新昵称'})).status,200);
  assert.equal(f.db.prepare('SELECT avatar_version FROM account_profiles WHERE user_id=?').get(a.account.id).avatar_version,avatarRow.avatar_version);
  assert.equal((await f.call(c,'/api/account/profile','POST',{nickname:'新昵称',avatar:null})).data.profile.avatarUrl,null);
  assert.equal(f.db.prepare('SELECT avatar FROM account_profiles WHERE user_id=?').get(a.account.id).avatar,null);
  assert.equal((await f.call(c,'/api/account/delete','POST',{currentPassword:password,confirmation:'注销账号'})).status,200);
  assert.equal(f.db.prepare('SELECT 1 FROM account_profiles WHERE user_id=?').get(a.account.id),undefined);
  assert.ok(f.db.prepare('SELECT 1 FROM nickname_numbers WHERE number=?').get(saved.default_number));
});

test('资料修改拒绝跨站、重复昵称、无效图片和超长输入',async t=>{
  const f=await fixture(t),c=await f.guest(),g=await f.guest(),o=await f.guest();await f.register(c,'profile_guard');await f.register(o,'profile_other');
  const body={nickname:'正常昵称'};
  assert.equal((await f.call(g,'/api/account/profile','POST',body)).status,401);
  assert.equal((await f.call(g,'/api/account/avatar')).status,401);
  assert.equal((await f.call(c,'/api/account/avatar')).status,404);
  assert.equal((await f.call(c,'/api/account/profile','POST',body,{Origin:'https://evil.example'})).status,403);
  assert.equal((await f.call(c,'/api/account/profile','POST',body,{'X-CSRF-Token':'bad'})).status,403);
  assert.equal((await f.call(c,'/api/account/profile','POST',body)).status,200);
  assert.equal((await f.call(o,'/api/account/profile','POST',body)).status,409);
  for(const nickname of ['', '字'.repeat(21),'换\n行','不可见\u200b','小南狮999999'])assert.equal((await f.call(c,'/api/account/profile','POST',{nickname})).status,400);
  for(const avatar of ['https://example.com/a.png','data:image/svg+xml;base64,PHN2Zy8+','data:image/png;base64,YWJj','x'.repeat(350001)])assert.equal((await f.call(c,'/api/account/profile','POST',{...body,avatar})).status,400);
  assert.equal((await f.call(c,'/api/account/profile','POST',{...body,avatar:'x'.repeat(360001)})).status,413);
  assert.equal((await f.call(c,'/api/session')).data.account.nickname,'正常昵称');
});
function seedLegacy(db,name='legacy_user'){
  const id=randomUUID(),now=new Date().toISOString(),salt='legacy-test-salt',hash=salt+':'+scryptSync(password,salt,64).toString('hex'),recoveryCode='test-old-recovery';
  db.prepare('INSERT INTO users VALUES(?,?,?)').run(id,'匿名同学',now);
  db.prepare('INSERT INTO accounts(user_id,username,password_hash,recovery_hash,role,created_at) VALUES(?,?,?,?,?,?)').run(id,name,hash,digest(recoveryCode.replaceAll('-','')),'member',now);
  db.prepare('INSERT INTO account_members VALUES(?,?)').run(id,id);
  return {id,recoveryCode};
}

test('注销保留各状态评价与维度、解除所有身份关联、撤销所有设备和验证码，重注册不能认领',async t=>{
  const f=await fixture(t,{catalog:true}),c=await f.guest(),oldGuest=currentPerson(f.db,{headers:{cookie:c.cookie}}).userId;
  const registered=await f.register(c,'delete_user'),id=registered.account.id,other=await f.guest();
  const survivor=await f.register(other,'survivor_user');
  const device=await f.guest();assert.equal((await f.call(device,'/api/account/login','POST',{identifier:'delete_user',password})).status,200);
  const oldDevice={...device},oldClient={...c};
  const group=courseDetail(f.db,'1000000015').groups[0].sourceGroupIds[0],time=new Date().toISOString();
  const reviews=[];
  for(const [i,status] of ['published','hidden','pending'].entries()){
    const reviewId=randomUUID(),term='delete-test-'+i;
    f.db.prepare('INSERT INTO review_terms VALUES(?,?)').run(term,term);
    f.db.prepare('INSERT INTO reviews VALUES(?,?,?,?,?,?,?,?,?,?)').run(reviewId,i===1?oldGuest:id,group,term,4,'保留评价 '+status,1,status,time,time);
    f.db.prepare('INSERT INTO review_dimensions VALUES(?,?,?,?,?)').run(reviewId,1,2,3,4);reviews.push(reviewId);
  }
  f.db.prepare('INSERT INTO review_moderation VALUES(?,?,?,?)').run(reviews[2],1,'测试下架',time);
  f.db.prepare('INSERT INTO reports VALUES(?,?,?,?,?,?,?,?)').run('deleted-reporter',reviews[0],id,'测试原因','open','',time,time);
  f.db.prepare('INSERT INTO reports VALUES(?,?,?,?,?,?,?,?)').run('kept-reporter',reviews[0],survivor.account.id,'其他举报','open','',time,time);
  const before=f.db.prepare('SELECT * FROM reviews ORDER BY id').all(),dimensions=f.db.prepare('SELECT * FROM review_dimensions ORDER BY review_id').all();
  f.cooldown();const requester=await f.guest(),proof=await f.proof(requester,'delete_user@njnu.edu.cn','recover');
  assert.deepEqual((await f.call(c,'/api/account/deletion')).data,{reviewCount:3,canDelete:true,reason:null});
  const result=await f.call(c,'/api/account/delete','POST',{currentPassword:password,confirmation:'注销账号'});
  assert.equal(result.status,200,JSON.stringify(result.data));assert.equal(result.data.keptReviews,3);assert.equal(c.cookie,'nnu_visitor=');
  const after=f.db.prepare('SELECT * FROM reviews ORDER BY id').all();
  assert.equal(new Set(after.map(r=>r.user_id)).size,3);
  for(let i=0;i<after.length;i++){
    assert.notEqual(after[i].user_id,before[i].user_id);const {user_id:a,...restA}=after[i],{user_id:b,...restB}=before[i];assert.deepEqual(restA,restB);
    assert.equal(f.db.prepare('SELECT public_name FROM users WHERE id=?').get(a).public_name,'匿名同学');
    assert.equal(f.db.prepare('SELECT 1 FROM account_members WHERE user_id=?').get(a),undefined);
  }
  assert.deepEqual(f.db.prepare('SELECT * FROM review_dimensions ORDER BY review_id').all(),dimensions);
  assert.equal(f.db.prepare('SELECT blocked FROM review_moderation WHERE review_id=?').get(reviews[2]).blocked,1);
  for(const owner of [id,oldGuest]){
    assert.equal(f.db.prepare('SELECT 1 FROM users WHERE id=?').get(owner),undefined);
    assert.equal(f.db.prepare('SELECT 1 FROM visitor_sessions WHERE user_id=?').get(owner),undefined);
    assert.equal(f.db.prepare('SELECT 1 FROM account_members WHERE user_id=? OR account_id=?').get(owner,owner),undefined);
  }
  assert.equal(f.db.prepare('SELECT 1 FROM accounts WHERE user_id=?').get(id),undefined);
  assert.equal(f.db.prepare('SELECT 1 FROM email_challenges WHERE id=?').get(proof.challengeId),undefined);
  assert.equal(f.db.prepare("SELECT reporter_id FROM reports WHERE id='deleted-reporter'").get().reporter_id,null);
  assert.equal(f.db.prepare("SELECT reporter_id FROM reports WHERE id='kept-reporter'").get().reporter_id,survivor.account.id);
  for(const client of [oldClient,oldDevice])assert.equal((await f.call(client,'/api/my/reviews')).status,401);
  assert.equal((await f.call(other,'/api/my/reviews')).status,200);
  const publicReviews=(await f.call(null,'/api/courses/1000000015/reviews')).data;
  assert.equal(publicReviews.total,1);assert.equal(publicReviews.items[0].content,'保留评价 published');
  assert.equal((await f.call(requester,'/api/account/recover','POST',{...proof,password:nextPassword})).status,400);
  f.cooldown();const fresh=await f.guest(),newAccount=await f.register(fresh,'delete_user');assert.notEqual(newAccount.account.id,id);
  assert.equal((await f.call(fresh,'/api/my/reviews')).data.total,0);
  assert.equal((await f.call(fresh,`/api/reviews/${reviews[0]}`,'DELETE')).status,404);
  assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(),[]);
});

test('注销要求登录、同源 CSRF、正确密码和明确确认；失败不改变账号',async t=>{
  const f=await fixture(t),g=await f.guest(),c=await f.guest(),body={currentPassword:password,confirmation:'注销账号'};
  assert.equal((await f.call(g,'/api/account/deletion')).status,401);
  assert.equal((await f.call(g,'/api/account/delete','POST',body)).status,401);
  const {account}=await f.register(c,'delete_guard');
  assert.equal((await f.call(c,'/api/account/delete','POST',body,{'X-CSRF-Token':'invalid'})).status,403);
  assert.equal((await f.call(c,'/api/account/delete','POST',body,{Origin:'https://evil.example'})).status,403);
  assert.equal((await f.call(c,'/api/account/delete','POST',{currentPassword:password})).status,400);
  assert.equal((await f.call(c,'/api/account/delete','POST',{...body,currentPassword:'wrong'})).status,401);
  assert.equal(f.db.prepare('SELECT user_id FROM accounts WHERE user_id=?').get(account.id).user_id,account.id);
  assert.equal((await f.call(c,'/api/session')).data.account.id,account.id);
});

test('唯一管理员不可注销；多管理员注销后审计记录保留并匿名化',async t=>{
  const f=await fixture(t),c=await f.guest(),a=await f.register(c,'delete_admin');
  f.db.prepare("UPDATE accounts SET role='admin' WHERE user_id=?").run(a.account.id);
  const body={currentPassword:password,confirmation:'注销账号'};
  assert.equal((await f.call(c,'/api/account/deletion')).data.canDelete,false);
  assert.equal((await f.call(c,'/api/account/delete','POST',body)).status,409);
  const other=await f.guest(),b=await f.register(other,'remaining_admin');
  f.db.prepare("UPDATE accounts SET role='admin' WHERE user_id=?").run(b.account.id);
  f.db.prepare('INSERT INTO site_owner VALUES(1,?)').run(b.account.id);
  f.db.prepare('INSERT INTO admin_audit VALUES(?,?,?,?,?,?)').run('old-audit',a.account.id,'admin.setup',a.account.id,'{}',new Date().toISOString());
  assert.equal((await f.call(c,'/api/account/delete','POST',body)).status,200);
  const audit=(await f.call(other,'/api/admin/audit')).data;
  assert.equal(audit.total,1);assert.equal(audit.items[0].actor,'已注销账号');assert.equal(audit.items[0].target,'已注销账号');
  assert.equal(f.db.prepare('SELECT actor_id FROM admin_audit').get().actor_id,null);
});

test('验证密码期间会话被撤销时，注销中止且不删除账号',async t=>{
  const f=await fixture(t),c=await f.guest(),a=await f.register(c,'delete_race');
  const req={headers:{cookie:c.cookie},socket:{remoteAddress:'127.0.0.1'}},person=currentPerson(f.db,req);
  const deletion=accountAction(f.db,req,{setHeader(){}},person,'delete',{currentPassword:password,confirmation:'注销账号'},f.mailer);
  f.db.prepare('DELETE FROM visitor_sessions WHERE user_id=?').run(a.account.id);
  await assert.rejects(deletion,e=>e.status===409);
  assert.ok(f.db.prepare('SELECT 1 FROM accounts WHERE user_id=?').get(a.account.id));
});

test('注销迁移完整保留旧举报及审计数据，重复运行安全',()=>{
  const db=new DatabaseSync(':memory:');try{
    db.exec('PRAGMA foreign_keys=ON');db.exec(readFileSync(resolve(root,'server/schema.sql'),'utf8'));migrateReviews(db);migrateAccounts(db);migrateEmail(db);
    const a=seedLegacy(db),time=new Date().toISOString();
    db.prepare('INSERT INTO reports VALUES(?,?,?,?,?,?,?,?)').run('report',null,a.id,'原因','resolved','处理结果',time,time);
    db.prepare('INSERT INTO admin_audit VALUES(?,?,?,?,?,?)').run('audit',a.id,'admin.setup',a.id,'{}',time);
    const reports=db.prepare('SELECT * FROM reports').all(),audit=db.prepare('SELECT * FROM admin_audit').all();
    migrateAccountDeletion(db);migrateAccountDeletion(db);
    assert.deepEqual(db.prepare('SELECT * FROM reports').all(),reports);assert.deepEqual(db.prepare('SELECT * FROM admin_audit').all(),audit);
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
    db.prepare('DELETE FROM account_members WHERE account_id=?').run(a.id);db.prepare('DELETE FROM accounts WHERE user_id=?').run(a.id);
    assert.equal(db.prepare('SELECT reporter_id FROM reports').get().reporter_id,null);assert.equal(db.prepare('SELECT actor_id FROM admin_audit').get().actor_id,null);
  }finally{db.close();}
});
async function fixture(t,{catalog=false,mailer=testMailbox()}={}){
  const db=openDatabase(':memory:');if(catalog)importCatalog(db,readCatalog());
  const server=createApp(db,{mailer});await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const url=`http://127.0.0.1:${server.address().port}`;
  t.after(async()=>{await new Promise(r=>server.close(r));db.close();});
  async function call(client,path,method='GET',data,extra={}){
    const res=await fetch(url+path,{method,headers:{Cookie:client?.cookie||'','X-CSRF-Token':client?.csrf||'','Content-Type':'application/json',...extra},...(data===undefined?{}:{body:JSON.stringify(data)})});
    const result=await res.json(),cookie=res.headers.get('set-cookie');if(client&&cookie)client.cookie=cookie.split(';')[0];if(client&&result.csrf)client.csrf=result.csrf;
    return {status:res.status,data:result};
  }
  async function guest(){const c={};assert.equal((await call(c,'/api/session')).status,200);return c;}
  const proof=(c,email,purpose)=>emailProof(call,c,mailer,email,purpose);
  async function register(c,name){const p=await proof(c,name+'@njnu.edu.cn');const r=await call(c,'/api/account/register','POST',{...p,username:name,password});assert.equal(r.status,200,JSON.stringify(r.data));return r.data;}
  function cooldown(){db.prepare("DELETE FROM auth_attempts WHERE key LIKE 'mail-cooldown:%'").run();}
  return {db,call,guest,proof,register,cooldown,mailer,raw:(c,path)=>fetch(url+path,{headers:{Cookie:c?.cookie||''}})};
}

test('仅允许确切校园邮箱域名，迁移保留旧账号且不伪造验证状态',()=>{
  assert.equal(normalizeEmail(' 12345@NJNU.EDU.CN '),'12345@njnu.edu.cn');
  for(const email of ['123@gmail.com','123@njnu.edu.cn.evil.com','123@nnu.edu.cn','123@student.njnu.edu.cn','a@@njnu.edu.cn','a\r\nb@njnu.edu.cn','a..b@njnu.edu.cn','@njnu.edu.cn'])assert.throws(()=>normalizeEmail(email));
  const db=new DatabaseSync(':memory:');try{
    db.exec(readFileSync(resolve(root,'server/schema.sql'),'utf8'));migrateReviews(db);migrateAccounts(db);
    const legacy=seedLegacy(db),before=db.prepare('SELECT * FROM accounts').get();migrateEmail(db);migrateEmail(db);
    const after=db.prepare('SELECT * FROM accounts').get();assert.equal(after.user_id,legacy.id);assert.equal(after.email,null);assert.equal(after.email_verified_at,null);
    for(const key of Object.keys(before))assert.equal(after[key],before[key]);assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
  }finally{db.close();}
});

test('验证码注册、邮箱/用户名登录，不暴露验证码或密码且前端字段不能伪造验证',async t=>{
  const f=await fixture(t),c=await f.guest();
  assert.equal((await f.call(c,'/api/account/register','POST',{username:'student',password,email:'student@njnu.edu.cn',emailVerified:true})).status,400);
  assert.equal((await f.call(c,'/api/account/send-code','POST',{email:'student@njnu.edu.cn',purpose:'register'},{'X-CSRF-Token':'bad'})).status,403);
  assert.equal((await f.call(c,'/api/account/send-code','POST',{email:'student@njnu.edu.cn',purpose:'register'},{Origin:'https://evil.example'})).status,403);
  const p=await f.proof(c,'student@njnu.edu.cn');assert.match(p.emailCode,/^\d{6}$/);
  const row=f.db.prepare('SELECT * FROM email_challenges').get();assert.equal(row.code,undefined);assert.equal(row.code_hash,digest(p.challengeId+':'+p.emailCode));assert.notEqual(row.code_hash,p.emailCode);
  const registered=await f.call(c,'/api/account/register','POST',{...p,email:'STUDENT@NJNU.EDU.CN',username:'Student',password,role:'admin'});
  assert.equal(registered.status,200);assert.equal(registered.data.account.emailVerified,true);assert.equal(registered.data.account.role,'member');assert.equal(registered.data.recoveryCode,undefined);assert.equal(registered.data.emailCode,undefined);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM email_challenges').get().n,0);
  for(const identifier of ['STUDENT','STUDENT@NJNU.EDU.CN']){const other=await f.guest();const login=await f.call(other,'/api/account/login','POST',{identifier,password});assert.equal(login.status,200);assert.equal(login.data.account.id,registered.data.account.id);}
  const fresh=await f.guest();assert.equal((await f.call(fresh,'/api/session')).data.account,null);
  assert.equal((await f.call(fresh,'/api/account/login','POST',{identifier:'student',password:'wrong'})).status,401);
});

test('验证码绑定用途、邮箱和请求身份，五次输错及过期后失效',async t=>{
  const f=await fixture(t),c=await f.guest(),other=await f.guest(),p=await f.proof(c,'scope@njnu.edu.cn');
  const body={...p,username:'scope_user',password};
  assert.equal((await f.call(other,'/api/account/register','POST',body)).status,400);
  assert.equal((await f.call(c,'/api/account/recover','POST',body)).status,400);
  assert.equal((await f.call(c,'/api/account/register','POST',{...body,email:'else@njnu.edu.cn'})).status,400);
  for(let n=0;n<5;n++)assert.equal((await f.call(c,'/api/account/register','POST',{...body,emailCode:p.emailCode==='000000'?'111111':'000000'})).status,400);
  assert.equal((await f.call(c,'/api/account/register','POST',body)).status,400);
  f.cooldown();const resent=await f.proof(c,p.email);assert.notEqual(resent.challengeId,p.challengeId);
  assert.equal((await f.call(c,'/api/account/register','POST',body)).status,400);
  f.db.prepare('UPDATE email_challenges SET expires_at=? WHERE id=?').run(Date.now()-1,resent.challengeId);
  assert.equal((await f.call(c,'/api/account/register','POST',{...body,...resent})).status,400);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM accounts').get().n,0);
});

test('重发验证码有冷却；验证码并发使用仅创建一个账号',async t=>{
  const f=await fixture(t),c=await f.guest(),p=await f.proof(c,'race@njnu.edu.cn');
  const other=await f.guest();assert.equal((await f.call(other,'/api/account/send-code','POST',{email:p.email,purpose:'register'})).status,429);
  const results=await Promise.all(['race_one','race_two'].map(username=>f.call({...c},'/api/account/register','POST',{...p,username,password})));
  assert.equal(results.filter(r=>r.status===200).length,1);assert.equal(results.filter(r=>r.status===409).length,1);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM accounts').get().n,1);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM email_challenges').get().n,0);
  f.cooldown();const count=f.mailer.messages.length;
  const duplicate=await f.call(other,'/api/account/send-code','POST',{email:p.email,purpose:'register'});assert.equal(duplicate.status,409);assert.equal(duplicate.data.code,'EMAIL_ALREADY_REGISTERED');assert.match(duplicate.data.error,/已注册.*登录/);assert.equal(f.mailer.messages.length,count);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM email_challenges').get().n,0);
});

test('邮件未配置或发送失败不能注册；查无邮箱的找回请求不泄露账号状态',async t=>{
  const f=await fixture(t,{mailer:createMailer({})}),c=await f.guest();
  assert.equal((await f.call(c,'/api/session')).data.mailReady,false);
  assert.equal((await f.call(c,'/api/account/send-code','POST',{email:'offline@njnu.edu.cn',purpose:'register'})).status,503);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM email_challenges').get().n,0);
  const broken=await fixture(t,{mailer:{ready:true,async send(){throw new ApiError(503,'测试发信失败');}}}),b=await broken.guest();
  assert.equal((await broken.call(b,'/api/account/send-code','POST',{email:'broken@njnu.edu.cn',purpose:'register'})).status,503);
  assert.equal(broken.db.prepare('SELECT COUNT(*) n FROM email_challenges').get().n,0);
  const ready=await fixture(t),g=await ready.guest();const missing=await ready.call(g,'/api/account/send-code','POST',{email:'unknown@njnu.edu.cn',purpose:'recover'});
  assert.equal(missing.status,200);assert.ok(missing.data.challengeId);assert.equal(ready.mailer.messages.length,0);
});

test('邮箱找回撤销所有设备和其他验证码；旧密码与旧验证码失效',async t=>{
  const f=await fixture(t),c=await f.guest();await f.register(c,'reset_user');
  const other=await f.guest();await f.call(other,'/api/account/login','POST',{identifier:'reset_user@njnu.edu.cn',password});
  f.cooldown();const requester=await f.guest(),p=await f.proof(requester,'reset_user@njnu.edu.cn','recover');
  f.cooldown();const another=await f.guest(),anotherProof=await f.proof(another,p.email,'recover');
  const original={...requester};assert.equal((await f.call(requester,'/api/account/recover','POST',{...p,password:nextPassword})).status,200);
  for(const client of [c,other])assert.equal((await f.call(client,'/api/my/reviews')).status,401);
  assert.equal((await f.call(original,'/api/account/recover','POST',{...p,password})).status,400);
  assert.equal((await f.call(another,'/api/account/recover','POST',{...anotherProof,password})).status,400);
  const login=await f.guest();assert.equal((await f.call(login,'/api/account/login','POST',{identifier:'reset_user',password})).status,401);
  assert.equal((await f.call(login,'/api/account/login','POST',{identifier:'reset_user',password:nextPassword})).status,200);
});

test('修改密码使未使用的找回验证码失效',async t=>{
  const f=await fixture(t),c=await f.guest();await f.register(c,'password_user');f.cooldown();
  const g=await f.guest(),p=await f.proof(g,'password_user@njnu.edu.cn','recover');
  const result=await f.call(c,'/api/account/password','POST',{currentPassword:password,password:nextPassword});assert.equal(result.status,200);assert.equal(result.data.recoveryCode,undefined);
  assert.equal((await f.call(g,'/api/account/recover','POST',{...p,password})).status,400);
});

test('旧账号可登录和管理旧评价；补绑前拒绝发布，补绑后保留所有权并允许评价',async t=>{
  const f=await fixture(t,{catalog:true}),old=seedLegacy(f.db),c=await f.guest();
  const login=await f.call(c,'/api/account/login','POST',{identifier:'legacy_user',password});assert.equal(login.status,200);assert.equal(login.data.account.emailVerified,false);
  const detail=courseDetail(f.db,'1000000015'),body={courseId:detail.code,groupId:detail.groups[0].sourceGroupIds[0],rating:4,difficulty:2,workload:3,grading:4,gain:5,content:'旧账号测试评价'};
  const review=writeReview(f.db,currentPerson(f.db,{headers:{cookie:c.cookie}}),body);
  assert.equal((await f.call(c,'/api/reviews','POST',body)).status,403);assert.equal((await f.call(c,`/api/reviews/${review.id}`,'PUT',body)).status,403);
  const publicFeed=await f.call(null,`/api/courses/${detail.code}/reviews`);assert.equal(publicFeed.status,200);assert.equal(publicFeed.data.total,1);assert.equal(publicFeed.data.items[0].email,undefined);assert.equal(publicFeed.data.items[0].username,undefined);
  assert.equal((await f.call(c,'/api/my/reviews')).data.items[0].id,review.id);
  assert.equal((await f.call(c,`/api/reviews/${review.id}`,'DELETE')).status,200);
  const p=await f.proof(c,'legacy@njnu.edu.cn','bind'),before={...c};
  assert.equal((await f.call(c,'/api/account/bind-email','POST',{...p,currentPassword:'wrong'})).status,401);
  const bound=await f.call(c,'/api/account/bind-email','POST',{...p,currentPassword:password});assert.equal(bound.status,200);assert.equal(bound.data.account.id,old.id);assert.equal(bound.data.account.emailVerified,true);
  assert.equal((await f.call(before,'/api/my/reviews')).status,401);
  assert.equal((await f.call(c,'/api/my/reviews')).data.items[0].id,review.id);
  assert.equal((await f.call(c,`/api/reviews/${review.id}`,'PUT',body)).status,200);
  assert.equal(f.db.prepare('SELECT user_id FROM reviews WHERE id=?').get(review.id).user_id,old.id);
  const guest=await f.guest();assert.equal((await f.call(guest,'/api/account/recover','POST',{username:'legacy_user',recoveryCode:old.recoveryCode,password:nextPassword})).status,401);
  assert.equal((await f.call(guest,'/api/account/login','POST',{identifier:'legacy@njnu.edu.cn',password})).status,200);
});

test('尚未补绑的旧账号仍可使用原恢复码找回，码轮换且不绕过邮箱验证',async t=>{
  const f=await fixture(t),old=seedLegacy(f.db),c=await f.guest();
  const reset=await f.call(c,'/api/account/recover','POST',{username:'legacy_user',recoveryCode:old.recoveryCode,password:nextPassword});assert.equal(reset.status,200);assert.ok(reset.data.recoveryCode);
  const g=await f.guest();assert.equal((await f.call(g,'/api/account/recover','POST',{username:'legacy_user',recoveryCode:old.recoveryCode,password})).status,401);
  const login=await f.call(g,'/api/account/login','POST',{identifier:'legacy_user',password:nextPassword});assert.equal(login.status,200);assert.equal(login.data.account.emailVerified,false);
  assert.equal((await f.call(g,'/api/reviews','POST',{})).status,403);
});
