import {test} from 'node:test';
import assert from 'node:assert/strict';
import {backup} from 'node:sqlite';
import {mkdtempSync,copyFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {scryptSync} from 'node:crypto';
import sharp from 'sharp';
import {openDatabase} from '../server/database.mjs';
import {createProfile} from '../server/profiles.mjs';
import {syncCoursePages} from '../server/taxonomy.mjs';
import {createApp} from '../server/index.mjs';

test('含评价维度和头像的WAL数据库备份可完整恢复，恢复后登录、头像及评价接口可读',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'nnu-backup-test-')),source=openDatabase(join(dir,'source.sqlite'));
  let restored,server;
  try{
    const time=new Date().toISOString(),password='Isolated-backup-test-123',salt='test-salt';
    source.prepare('INSERT INTO courses VALUES(?,?,?,?,?,?,?)').run('001','备份测试课','测试学院','测试','测试',2,36);
    source.prepare('INSERT INTO teaching_groups VALUES(?,?,?,?,?)').run('group','001','备份测试课','测试教师',1);
    source.prepare('INSERT INTO users VALUES(?,?,?)').run('user','匿名同学',time);
    source.prepare('INSERT INTO accounts(user_id,username,password_hash,recovery_hash,role,created_at,email,email_verified_at) VALUES(?,?,?,?,?,?,?,?)').run('user','backup_test',salt+':'+scryptSync(password,salt,64).toString('hex'),'unused','member',time,'backup-test@njnu.edu.cn',time);
    source.prepare('INSERT INTO account_members VALUES(?,?)').run('user','user');createProfile(source,'user');
    const avatar=await sharp({create:{width:256,height:256,channels:3,background:'#217050'}}).webp().toBuffer();
    source.prepare('UPDATE account_profiles SET avatar=?,avatar_version=? WHERE user_id=?').run(avatar,'test','user');
    source.prepare('INSERT INTO reviews VALUES(?,?,?,?,?,?,?,?,?,?)').run('review','user','group',null,4,'仅独立备份恢复测试',1,'published',time,time);
    source.prepare('INSERT INTO review_dimensions VALUES(?,?,?,?,?)').run('review',2,3,4,5);syncCoursePages(source);
    const tables=['accounts','account_profiles','reviews','review_dimensions'],expected=Object.fromEntries(tables.map(t=>[t,source.prepare(`SELECT * FROM ${t}`).all()]));
    const snapshot=join(dir,'backup.sqlite'),copy=join(dir,'restored.sqlite');await backup(source,snapshot);copyFileSync(snapshot,copy);assert.deepEqual(readFileSync(snapshot),readFileSync(copy));
    restored=openDatabase(copy);for(const t of tables)assert.deepEqual(restored.prepare(`SELECT * FROM ${t}`).all(),expected[t]);
    assert.equal(restored.prepare('PRAGMA integrity_check').get().integrity_check,'ok');assert.deepEqual(restored.prepare('PRAGMA foreign_key_check').all(),[]);
    server=createApp(restored,{mailer:{ready:false,async send(){throw Error('Real email disabled');}}});await new Promise(r=>server.listen(0,'127.0.0.1',r));const url='http://127.0.0.1:'+server.address().port;
    const session=await fetch(url+'/api/session'),cookie=session.headers.get('set-cookie').split(';')[0],{csrf}=await session.json();
    const login=await fetch(url+'/api/account/login',{method:'POST',headers:{Cookie:cookie,'X-CSRF-Token':csrf,'Content-Type':'application/json'},body:JSON.stringify({username:'backup_test',password})});assert.equal(login.status,200);
    const loggedCookie=login.headers.get('set-cookie')?.split(';')[0]||cookie;
    const image=await fetch(url+'/api/account/avatar',{headers:{Cookie:loggedCookie}});assert.equal(image.status,200);assert.deepEqual(Buffer.from(await image.arrayBuffer()),avatar);
    const reviews=await fetch(url+'/api/courses/001/reviews');assert.equal(reviews.status,200);assert.match(await reviews.text(),/仅独立备份恢复测试/);
  }finally{
    if(server){server.closeAllConnections();await new Promise(r=>server.close(r));}restored?.close();source.close();
    assert.equal(resolve(dir).startsWith(resolve(tmpdir())+requireSeparator()),true);rmSync(dir,{recursive:true,force:true});
  }
});
function requireSeparator(){return process.platform==='win32'?'\\':'/';}
