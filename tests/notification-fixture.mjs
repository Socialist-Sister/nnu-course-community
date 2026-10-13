import {scryptSync} from 'node:crypto';
import {openDatabase} from '../server/database.mjs';
import {importCatalog,readCatalog} from '../server/import-catalog.mjs';
import {courseDetail} from '../server/catalog.mjs';
import {newSession} from '../server/accounts.mjs';
import {createApp} from '../server/index.mjs';
import {writeReview} from '../server/reviews.mjs';

export async function notificationFixture(){
  const db=openDatabase(':memory:');importCatalog(db,readCatalog());
  const clients={},password='Notification-test-1234',time=new Date().toISOString();
  const hash='notification-test-salt:'+scryptSync(password,'notification-test-salt',64).toString('hex');
  for(const id of ['notify_owner','notify_author','notify_reporter']){
    db.prepare('INSERT INTO users VALUES(?,?,?)').run(id,id,time);
    db.prepare(`INSERT INTO accounts(user_id,username,password_hash,recovery_hash,role,created_at,email,email_verified_at) VALUES(?,?,?,?,?,?,?,?)`).run(id,id,hash,'unused',id==='notify_owner'?'admin':'member',time,id+'@njnu.edu.cn',time);
    db.prepare('INSERT INTO account_members VALUES(?,?)').run(id,id);
    const c={};const session=newSession(db,{setHeader(k,v){c.cookie=v.split(';')[0];}},{socket:{}},id);c.csrf=session.csrf;clients[id]=c;
  }
  db.prepare('INSERT INTO site_owner VALUES(1,?)').run('notify_owner');
  db.prepare('INSERT INTO users VALUES(?,?,?)').run('legacy-review-author','legacy',time);
  const review=writeReview(db,{userId:'legacy-review-author'},{courseId:'1000000015',groupId:courseDetail(db,'1000000015').groups[0].sourceGroupIds[0],rating:4,difficulty:2,workload:3,grading:4,gain:4,content:'隔离环境通知测试评价'});
  db.prepare('INSERT INTO account_members VALUES(?,?)').run('legacy-review-author','notify_author');
  const server=createApp(db,{mailer:{ready:false}});await new Promise(r=>server.listen(0,'127.0.0.1',r));const url=`http://127.0.0.1:${server.address().port}`;
  async function call(name,path,method='GET',data,headers={}){
    const c=clients[name];const res=await fetch(url+path,{method,headers:{Cookie:c?.cookie||'','X-CSRF-Token':c?.csrf||'','Content-Type':'application/json',...headers},...(data===undefined?{}:{body:JSON.stringify(data)})});
    return {status:res.status,data:await res.json(),cache:res.headers.get('cache-control')};
  }
  return {db,server,url,clients,password,reviewId:review.id,call,async close(){await new Promise(r=>server.close(r));db.close();}};
}
