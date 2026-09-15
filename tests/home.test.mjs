import {test} from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../server/database.mjs';
import {syncCoursePages} from '../server/taxonomy.mjs';
import {courseDetail} from '../server/catalog.mjs';
import {homeFeed} from '../server/home.mjs';
import {createApp} from '../server/index.mjs';

test('首页只返回最新公开评价，链接到上下册统一页和正确教师，兼容空学期',async()=>{
  const db=openDatabase(':memory:');let server;
  try{
    for(const [code,name]of [['UP','高等数学Ⅰ(上)'],['DOWN','高等数学Ⅰ(下)']]){db.prepare('INSERT INTO courses VALUES(?,?,?,?,?,?,?)').run(code,name,'测试学院','测试','测试',4,72);db.prepare('INSERT INTO teaching_groups VALUES(?,?,?,?,?)').run('g'+code,code,name,'测试老师',1);}
    syncCoursePages(db);assert.deepEqual(homeFeed(db),{reviews:[]});
    for(let n=0;n<12;n++){const timestamp=`2026-09-07T10:${String(n).padStart(2,'0')}:00Z`,id='r'+n;db.prepare('INSERT INTO users VALUES(?,?,?)').run(id,'private-user',timestamp);db.prepare('INSERT INTO reviews VALUES(?,?,?,?,?,?,?,?,?,?)').run(id,id,n%2?'gUP':'gDOWN',null,4,'测'.repeat(300),1,n===11?'hidden':n===10?'pending':'published',timestamp,timestamp);}
    const rows=homeFeed(db).reviews;assert.equal(rows.length,8);assert.equal(rows[0].id,'r9');assert.equal(rows[7].id,'r2');
    const detail=courseDetail(db,'UP');for(const r of rows){assert.equal(r.courseId,detail.code);assert.equal(r.teacherId,detail.groups[0].id);assert.equal(r.semesterLabel,null);assert.equal(r.excerpt.length,221);assert.equal(r.userId,undefined);assert.equal(r.author,'已注销用户');assert.ok(r.originalName.includes('高等数学'));}
    server=createApp(db);await new Promise(r=>server.listen(0,'127.0.0.1',r));const url=`http://127.0.0.1:${server.address().port}`;
    assert.deepEqual(await (await fetch(url+'/api/home')).json(),{reviews:rows});
    assert.equal((await fetch(url+'/courses')).status,200);
    db.prepare("UPDATE reviews SET status='hidden' WHERE id='r9'").run();assert.equal(homeFeed(db).reviews[0].id,'r8');
  }finally{if(server)await new Promise(r=>server.close(r));db.close();}
});
