import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from '../server/database.mjs';
import { readCatalog, importCatalog } from '../server/import-catalog.mjs';
import { metadata, listCourses, courseDetail } from '../server/catalog.mjs';
import { createApp } from '../server/index.mjs';
import { importAvailableLiberal } from '../server/import-liberal.mjs';
let db,server,url;
const input=readCatalog();
before(async()=>{db=openDatabase(':memory:');importCatalog(db,input);importAvailableLiberal(db);server=createApp(db);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));url=`http://127.0.0.1:${server.address().port}`;});
after(async()=>{await new Promise(resolve=>server.close(resolve));db.close();});
test('完整导入与三字段去重，重复导入不增加记录',()=>{
  assert.deepEqual(metadata(db).counts,{courses:2024,groups:3528,offerings:5074,departments:38});
  assert.equal(importCatalog(db,input).skipped,true);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM offerings').get().n,5074);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM reviews').get().n,0);
});
test('教师搜索、学院类别交集与特殊字符按字面搜索',()=>{
  const data=listCourses(db,new URLSearchParams({q:'贾冀川'}));
  assert.ok(data.items.some(c=>c.code==='1000000015'));
  const filtered=listCourses(db,new URLSearchParams({department:'文学院',category:'博雅教育课程',semester:'2026-2027-1',pageSize:'100'}));
  assert.ok(filtered.total>0);assert.ok(filtered.items.every(c=>c.department==='文学院'&&c.category==='博雅教育课程'));
  for(const q of ["' OR 1=1 --",'%','_','绝不可能存在的课程ABCDEFGHI'])assert.equal(listCourses(db,new URLSearchParams({q})).total,0);
  assert.equal(listCourses(db,new URLSearchParams({semester:'1900-1901-1'})).total,0);
});
test('遍历所有分页无遗漏重复，末页与越界正确',()=>{
  const codes=[];for(let page=1;page<=21;page++)codes.push(...listCourses(db,new URLSearchParams({page:String(page),pageSize:'100'})).items.map(c=>c.code));
  assert.equal(codes.length,2024);assert.equal(new Set(codes).size,2024);
  assert.equal(listCourses(db,new URLSearchParams({page:'22',pageSize:'100'})).items.length,0);
});
test('全部课程教师与来源字段逐条对应，课序号保留前导零和字母',()=>{
  let groups=0,sections=0;const ids=new Set();
  for(const c of input.courses){const detail=courseDetail(db,c.course_code);assert.equal(detail.members.find(m=>m.code===c.course_code).name,c.name);for(const g of detail.groups){groups++;assert.ok(!ids.has(g.id));ids.add(g.id);sections+=g.sections.length;assert.equal(typeof g.sections[0].sectionNo,'string');}}
  assert.equal(groups,3528);assert.equal(sections,5074);
  assert.equal(courseDetail(db,'1000000015').groups[0].sections[0].sectionNo,'01');
  assert.ok(courseDetail(db,'STAJ1379').groups[0].sections.some(s=>s.sectionNo==='01S01'));
  assert.equal(courseDetail(db,'STAJ1379').groups[0].teacher,'教师信息未提供');
});
test('收藏列表过滤与学分排序',()=>{
  assert.equal(listCourses(db,new URLSearchParams({codes:''})).total,0);
  const data=listCourses(db,new URLSearchParams({codes:'1000000015,STAJ1379'}));assert.equal(data.total,2);
  const sorted=listCourses(db,new URLSearchParams({sort:'credits'})).items;assert.ok(sorted.every((c,i)=>i===0||sorted[i-1].credits>=c.credits));
});
test('HTTP API 校验、404、评价身份边界和静态页面',async()=>{
  const get=path=>fetch(url+path);
  assert.equal((await (await get('/api/health')).json()).database,'ready');
  for(const query of ['page=0','page=1.2','pageSize=101','sort=DROP','q='+encodeURIComponent('字'.repeat(101))])assert.equal((await get('/api/courses?'+query)).status,400);
  assert.equal((await get('/api/courses/unknown')).status,404);
  assert.equal((await get('/api/unknown')).status,404);
  assert.equal((await fetch(url+'/api/reviews',{method:'POST',body:'{}'})).status,401);
  assert.equal((await get('/server/schema.sql')).status,404);
  const page=await get('/');assert.equal(page.status,200);assert.match(await page.text(),/<div id="root">/);
});
test('数据库重开仍有数据；冲突快照与无效导入不会破坏已导入数据',()=>{
  const dir=mkdtempSync(join(tmpdir(),'nnu-catalog-test-')),file=join(dir,'test.sqlite');
  let disk=openDatabase(file);
  try {importCatalog(disk,input);disk.close();disk=openDatabase(file);assert.equal(metadata(disk).counts.groups,3528);
    const conflict=structuredClone(input);conflict.report.captured_end='2099-01-01T00:00:00Z';assert.throws(()=>importCatalog(disk,conflict),/不同快照/);
    const invalid=structuredClone(input);invalid.offerings[0].course_code='missing';assert.throws(()=>importCatalog(disk,invalid),/无效课程/);
    assert.equal(metadata(disk).counts.offerings,5074);
  }finally{disk.close();rmSync(dir,{recursive:true,force:true});}
});
