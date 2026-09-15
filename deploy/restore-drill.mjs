// Run manually on the VM. All mutations are confined to a private temporary copy.
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createHash,randomUUID} from 'node:crypto';
import {readdirSync,mkdtempSync,copyFileSync,readFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {createRequire} from 'node:module';
const root='/opt/nnu-course/current';
const {openDatabase}=await import(root+'/server/database.mjs');
const {createApp}=await import(root+'/server/index.mjs');
const sharp=createRequire(root+'/package.json')('sharp');
const start=Date.now(),directory='/var/lib/nnu-course/backups';
const name=readdirSync(directory).filter(n=>/^catalog-\d{4}-\d{2}-\d{2}T[\d.-]+Z\.sqlite$/.test(n)).sort().at(-1);
assert.ok(name,'No backup found');
const temp=mkdtempSync('/var/lib/nnu-course/restore-drill-');
const restored=join(temp,'catalog.sqlite'),source=join(directory,name);
let db,server;
const counts=d=>Object.fromEntries(['courses','teaching_groups','offerings','accounts','account_profiles','reviews','reports','admin_audit'].map(t=>[t,d.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n]));
try{
  copyFileSync(source,restored);
  const sha=p=>createHash('sha256').update(readFileSync(p)).digest('hex');assert.equal(sha(source),sha(restored));
  const original=new DatabaseSync(source,{readOnly:true});let expected;try{expected=counts(original);}finally{original.close();}
  db=openDatabase(restored);assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');assert.equal(db.prepare('PRAGMA foreign_key_check').all().length,0);assert.deepEqual(counts(db),expected);
  let avatars=0;for(const row of db.prepare('SELECT avatar FROM account_profiles WHERE avatar IS NOT NULL').all()){await sharp(row.avatar).raw().toBuffer();avatars++;}
  const messages=[],mailer={ready:true,async send(message){messages.push(message);}};
  server=createApp(db,{staticDir:root+'/dist/client',mailer});await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const base='http://127.0.0.1:'+server.address().port;
  for(const path of ['/','/api/health','/api/meta','/api/home','/api/courses?sort=teachers']){const r=await fetch(base+path);assert.equal(r.status,200);await r.text();}
  const list=await fetch(base+'/api/courses').then(r=>r.json());assert.ok(list.items.length);
  for(const suffix of ['','/reviews']){const r=await fetch(base+'/api/courses/'+encodeURIComponent(list.items[0].code)+suffix);assert.equal(r.status,200);await r.text();}
  const client={};
  async function call(path,body){const r=await fetch(base+path,{method:body?'POST':'GET',headers:{Cookie:client.cookie||'','X-CSRF-Token':client.csrf||'','Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});const data=await r.json();if(r.headers.get('set-cookie'))client.cookie=r.headers.get('set-cookie').split(';')[0];if(data.csrf)client.csrf=data.csrf;assert.equal(r.status,200);return data;}
  await call('/api/session');
  const username='drill_'+randomUUID().replaceAll('-','').slice(0,12),email=username+'@njnu.edu.cn',password='Restore-drill-only-12345';
  const proof=await call('/api/account/send-code',{email,purpose:'register'});
  const registered=await call('/api/account/register',{username,email,password,challengeId:proof.challengeId,emailCode:messages[0].code});assert.ok(registered.account);
  await call('/api/account/logout',{});await call('/api/session');const logged=await call('/api/account/login',{username,password});assert.ok(logged.account);
  console.log(JSON.stringify({backup:name,identicalCopy:true,integrity:'ok',foreignKeyErrors:0,counts:expected,avatarsDecoded:avatars,readRoutes:'passed',syntheticRegistrationAndLogin:'passed',realEmailsSent:0,elapsedMs:Date.now()-start,scope:'private local copy only'}));
}finally{
  if(server){server.closeAllConnections();await new Promise(r=>server.close(r));}db?.close();
  assert.ok(temp.startsWith('/var/lib/nnu-course/restore-drill-'));rmSync(temp,{recursive:true,force:true});
}
