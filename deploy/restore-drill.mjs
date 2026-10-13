// Run on the VM, or pass a decrypted local backup with --source <file>.
// All mutations are confined to a private temporary copy; mail is always stubbed.
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createHash,randomUUID} from 'node:crypto';
import {readdirSync,mkdtempSync,copyFileSync,readFileSync,rmSync} from 'node:fs';
import {join,resolve,dirname,basename} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const {openDatabase}=await import(pathToFileURL(join(root,'server/database.mjs')));
const {createApp}=await import(pathToFileURL(join(root,'server/index.mjs')));
const sharp=createRequire(root+'/package.json')('sharp');
const start=Date.now(),sourceArg=process.argv.indexOf('--source');
if(sourceArg!==-1)assert.ok(process.argv[sourceArg+1],'Missing --source file');
const directory=sourceArg===-1?'/var/lib/nnu-course/backups':dirname(resolve(process.argv[sourceArg+1]));
const name=sourceArg===-1?readdirSync(directory).filter(n=>/^catalog-\d{4}-\d{2}-\d{2}T[\d.-]+Z\.sqlite$/.test(n)).sort().at(-1):basename(process.argv[sourceArg+1]);
assert.ok(name,'No backup found');
process.umask(0o077);
const temp=mkdtempSync(join(directory,'restore-drill-'));
const restored=join(temp,'catalog.sqlite'),source=join(directory,name);
let db,server;
const tables=['courses','teaching_groups','offerings','accounts','account_profiles','account_members','reviews','review_dimensions','review_moderation','reports','admin_audit','account_bookmarks','notifications','review_helpful','admin_permissions','site_owner','review_revisions'];
const exists=(d,t)=>!!d.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(t);
const counts=d=>Object.fromEntries(tables.map(t=>[t,exists(d,t)?d.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n:0]));
const fingerprints=d=>Object.fromEntries(tables.map(t=>[t,createHash('sha256').update(JSON.stringify((exists(d,t)?d.prepare(`SELECT * FROM ${t}`).all():[]).map(r=>JSON.stringify(r)).sort())).digest('hex')]));
try{
  copyFileSync(source,restored);
  const sha=p=>createHash('sha256').update(readFileSync(p)).digest('hex');assert.equal(sha(source),sha(restored));
  const shaSnapshot=sha(source);
  const original=new DatabaseSync(source,{readOnly:true});let expected,expectedPrints;try{expected=counts(original);expectedPrints=fingerprints(original);}finally{original.close();}
  db=openDatabase(restored);assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');assert.equal(db.prepare('PRAGMA foreign_key_check').all().length,0);assert.deepEqual(counts(db),expected);
  assert.deepEqual(fingerprints(db),expectedPrints,'Restored table contents changed');
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
  const bookmarks=await call('/api/bookmarks');
  await call('/api/bookmarks',{accountId:bookmarks.accountId,action:'set',code:list.items[0].code,saved:true});
  await call('/api/account/logout',{});await call('/api/session');await call('/api/account/login',{username,password});
  assert.ok((await call('/api/bookmarks')).codes.includes(list.items[0].code));
  assert.equal((await call('/api/notifications')).total,0);
  assert.equal((await call('/api/notifications/unread')).unread,0);
  assert.equal((await fetch(base+'/api/notifications')).status,401);
  assert.equal((await fetch(base+'/admin/handbook',{headers:{Cookie:client.cookie}})).status,403);
  assert.equal(sha(source),shaSnapshot,'Source backup changed');
  console.log(JSON.stringify({backup:name,identicalCopy:true,sourceUnchanged:true,tableContentsPreserved:true,integrity:'ok',foreignKeyErrors:0,counts:expected,avatarsDecoded:avatars,readRoutes:'passed',syntheticRegistrationAndLogin:'passed',bookmarksAcrossSessions:'passed',notificationAndAdminAccess:'passed',realEmailsSent:0,elapsedMs:Date.now()-start,scope:'private local copy only'}));
}finally{
  if(server){server.closeAllConnections();await new Promise(r=>server.close(r));}db?.close();
  assert.equal(dirname(temp),resolve(directory));assert.ok(basename(temp).startsWith('restore-drill-'));rmSync(temp,{recursive:true,force:true});
}
