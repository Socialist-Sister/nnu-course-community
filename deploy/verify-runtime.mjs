import assert from 'node:assert/strict';
import nodemailer from 'nodemailer';
import {DatabaseSync} from 'node:sqlite';

const base=process.env.VERIFY_URL || 'https://nnucr.cn';
const health=await fetch(base+'/api/health');
assert.equal(health.status,200);
assert.equal((await health.json()).database,'ready');
const s=await fetch(base+'/api/session');
assert.equal(s.status,200);
const cookie=s.headers.get('set-cookie');
assert.match(cookie,/; Secure/);
assert.match(s.headers.get('cache-control'),/no-store/);
const session=await s.json();
assert.equal(session.mailReady,true);
const search=await fetch(base+'/api/courses?q='+encodeURIComponent('高数'));
assert.equal(search.status,200);
const courses=await search.json();
assert.ok(courses.total>0);
const id=courses.items[0].id;
assert.equal((await fetch(base+'/api/courses/'+encodeURIComponent(id))).status,200);
for(const path of ['/','/.env','/database/catalog.sqlite','/server/index.mjs']) {
  const response=await fetch(base+path);
  if(path==='/')assert.equal(response.status,200);
  else assert.ok([403,404].includes(response.status),`${path} must be private`);
}
const rejected=await fetch(base+'/api/reviews',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
assert.equal(rejected.status,401);
const csrf=await fetch(base+'/api/account/login',{method:'POST',headers:{'Content-Type':'application/json','Cookie':cookie.split(';')[0]},body:'{}'});
assert.equal(csrf.status,403);
const transport=nodemailer.createTransport({host:process.env.SMTP_HOST,port:Number(process.env.SMTP_PORT||465),secure:Number(process.env.SMTP_PORT||465)===465,requireTLS:true,
  auth:{user:process.env.SMTP_USER,pass:process.env.SMTP_PASS},connectionTimeout:10000,greetingTimeout:10000,socketTimeout:10000,logger:false,debug:false});
try {await transport.verify();console.log('SMTP connection and authentication: OK (no message sent)');}
catch {console.log('SMTP connection/authentication: FAILED');process.exitCode=1;}
finally {transport.close();}
const db=new DatabaseSync('/var/lib/nnu-course/catalog.sqlite',{readOnly:true});
assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
assert.equal(db.prepare('PRAGMA foreign_key_check').all().length,0);
const counts=Object.fromEntries(['courses','teaching_groups','offerings','accounts','reviews'].map(t=>[t,db.prepare(`SELECT count(*) n FROM ${t}`).get().n]));
db.close();
console.log(JSON.stringify({https:'verified',searchMatches:courses.total,secureCookie:true,privateFiles:'blocked',unauthenticatedWrites:'blocked',csrf:'enforced',database:counts}));
