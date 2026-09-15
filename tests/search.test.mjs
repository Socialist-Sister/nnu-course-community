import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {openDatabase,root} from '../server/database.mjs';
import {readCatalog,importCatalog} from '../server/import-catalog.mjs';
import {importLiberal,importAvailableLiberal} from '../server/import-liberal.mjs';
import {syncCoursePages,seriesFor} from '../server/taxonomy.mjs';
import {metadata,listCourses,courseDetail} from '../server/catalog.mjs';
import {resolve} from 'node:path';
import {readBoya} from '../server/boya.mjs';
let db;
const list=params=>listCourses(db,new URLSearchParams({pageSize:'100',...params}));
before(()=>{db=openDatabase(':memory:');importCatalog(db,readCatalog());importAvailableLiberal(db);});
after(()=>db.close());

test('十七个常用分类；体育按指定开课单位归类，博雅对应学校补采',()=>{
  const categories=metadata(db).commonCategories;
  assert.equal(categories.length,17);
  // Index 12 (civics-ethics-law) counts the user-confirmed 1025009028 mapping added 2026-09-14.
  assert.deepEqual(categories.map(c=>c.count),[2,6,5,0,2,42,13,16,22,19,21,22,1,0,0,1,1]);
  assert.equal(list({topic:'liberal-innovation'}).total,22);
  const sport=list({topic:'physical-education'});
  assert.deepEqual(sport.items.flatMap(c=>c.courseCodes).sort(),db.prepare("SELECT code FROM courses WHERE department='公共体育教学部' ORDER BY code").all().map(c=>c.code));
  assert.ok(sport.items.every(c=>c.department==='公共体育教学部'));
  assert.equal(list({topic:'physical-education',department:'体育科学学院'}).total,0);
  assert.equal(categories.find(c=>c.id==='physical-education').kind,'course');
  const records=JSON.parse(readFileSync(resolve(root,'../course-data/2026-autumn/liberal-classifications.json'),'utf8'));
  for(const c of categories.filter(c=>c.kind==='liberal'))assert.deepEqual(list({topic:c.id}).items.flatMap(c=>c.courseCodes).sort(),readBoya().courses.filter(r=>r.categoryId===c.id).map(r=>r.code).sort());
  assert.deepEqual(list({topic:'english'}).items.map(c=>c.name),['提高英语(1)','提高英语(3)']);
  assert.equal(list({topic:'probability-statistics'}).total,0);
  assert.equal(list({topic:'probability-statistics'}).notice.kind,'not-collected');
  assert.ok(list({q:'概率论与数理统计'}).items.some(c=>c.name.includes('英文')));
  assert.throws(()=>list({topic:'unknown'}),/分类无效/);
  const data=list({topic:'liberal-global',department:'历史文博学院'});
  assert.equal(data.total,1);assert.ok(data.items.every(c=>c.department==='历史文博学院'));
  assert.throws(()=>importLiberal(db,records.slice(1)),/工作簿/);
  assert.equal(list({topic:'liberal-global'}).total,13); // Partial capture preserves other categories.
  assert.equal(list({topic:'liberal-innovation'}).total,22);
  assert.throws(()=>importLiberal(db,[records[0],records[0]]),/分类不完整/);
  assert.throws(()=>importLiberal(db,[]),/分类不完整/);
  const bad=structuredClone(records);bad[0].pages[0].rows[0][1]='错误的课程名称';
  assert.throws(()=>importLiberal(db,bad),/改名课程/);assert.equal(list({topic:'liberal-global'}).total,13);
});

test('思政五门课准确归类，缺课提示对应课名，不混入相近专业课',()=>{
  const civics=metadata(db).commonCategories.filter(c=>c.kind==='civics');
  assert.equal(civics.length,5);
  // 1025009028 is the user-confirmed mapping for 思想道德与法治; the school's own course name is preserved.
  const ethics=list({topic:'civics-ethics-law'});
  assert.deepEqual(ethics.items.map(c=>c.code),['1025009028']);
  assert.equal(ethics.items[0].name,'思想政治必修课1');
  for(const c of civics.slice(1,3)){
    const result=list({topic:c.id});assert.equal(result.total,0);assert.equal(result.notice.kind,'not-collected');assert.ok(result.notice.message.includes(c.name));assert.ok(!result.notice.message.includes('概率论'));
  }
  assert.deepEqual(list({topic:'civics-mao-theory'}).items.map(c=>c.code),['1025009015']);
  assert.deepEqual(list({topic:'civics-xi-thought'}).items.map(c=>c.code),['1025000057']);
  assert.equal(list({topic:'civics-mao-theory',department:'马克思主义学院',sort:'rating'}).total,1);
  assert.equal(list({topic:'civics-mao-theory',department:'文学院'}).total,0);
  assert.equal(list({topic:'civics-mao-theory',q:'专题'}).total,0);
});

test('简称、宽字符、版本与多关键词搜索；命中教师进入预览',()=>{
  for(const [short,full] of [['高数','高等数学'],['线代','线性代数'],['大物','大学物理']])assert.deepEqual(list({q:short}).items.map(c=>c.code),list({q:full}).items.map(c=>c.code));
  const exact=list({q:'１００６００９００１'});assert.equal(exact.total,1);assert.equal(exact.items[0].courseCodes[0],'1006009001');
  for(const q of ['高数1','高数Ⅰ','高数 I','高数一']) {
    const data=list({q});assert.equal(data.total,2);assert.ok(data.items.every(c=>c.name==='高等数学Ⅰ'));
  }
  assert.equal(list({q:'高数Ⅱ'}).total,1);
  const found=list({q:'高数 吴老师'});assert.ok(found.total>0);
  assert.ok(found.items.every(c=>c.name.startsWith('高等数学')&&c.teachers.some(t=>t.includes('吴'))&&c.matchReasons.some(m=>m.type==='teacher')));
  assert.equal(list({q:'高数 完全不存在的教师'}).total,0);
  assert.equal(list({q:'1006009001',department:'文学院'}).total,0);
});

test('缺失下册名称仍可找到同版本系列；不虚构其课程号或教师',()=>{
  const upper=courseDetail(db,'1006009001');
  assert.equal(upper.name,'高等数学Ⅰ');assert.deepEqual(upper.missingParts,['下']);
  assert.deepEqual(upper.courseCodes,['1006009001']);
  assert.equal(courseDetail(db,upper.code).code,upper.code);
  const lower=list({q:'高数Ⅰ下'});assert.ok(lower.items.some(c=>c.code===upper.code));
  assert.ok(lower.items.every(c=>c.name==='高等数学Ⅰ'));
  assert.equal(list({codes:'1006009001,'+upper.code}).total,1);
});

test('独立测试库上下册合并路由、教师和收藏；不同版本及单位继续分开',()=>{
  const isolated=openDatabase(':memory:');
  try {
    isolated.prepare('INSERT INTO semesters VALUES(?,?,?,?,?,?)').run('test-term','测试学期','2026-01-01','https://example.test','test',1);
    const fixtures=[['TEST-UP','高等数学Ⅰ(上)','测试学院'],['TEST-DOWN','高等数学Ⅰ(下)','测试学院'],['TEST-II','高等数学Ⅱ(上)','测试学院'],['TEST-OTHER','高等数学Ⅰ(下)','其他测试学院']];
    for(const [code,name,department]of fixtures){
      isolated.prepare('INSERT INTO courses VALUES(?,?,?,?,?,?,?)').run(code,name,department,'测试性质','测试类别',4,72);
      isolated.prepare('INSERT INTO teaching_groups VALUES(?,?,?,?,?)').run('group-'+code,code,name,'测试教师',1);
      isolated.prepare('INSERT INTO offerings VALUES(?,?,?,?,?,?,?)').run('offering-'+code,'group-'+code,'test-term','01',1,1,'2026-01-01');
    }
    syncCoursePages(isolated);
    const a=courseDetail(isolated,'TEST-UP'),b=courseDetail(isolated,'TEST-DOWN');
    assert.equal(a.code,b.code);assert.equal(a.groups.length,1);assert.equal(a.groups[0].sections.length,2);
    assert.deepEqual(a.groups[0].sourceGroupIds.sort(),['group-TEST-DOWN','group-TEST-UP']);
    assert.deepEqual(a.missingParts,[]);assert.notEqual(a.code,courseDetail(isolated,'TEST-II').code);assert.notEqual(a.code,courseDetail(isolated,'TEST-OTHER').code);
    for(const code of ['TEST-UP','TEST-DOWN']){const result=listCourses(isolated,new URLSearchParams({q:code}));assert.equal(result.total,1);assert.equal(result.items[0].code,a.code);}
    assert.equal(listCourses(isolated,new URLSearchParams({codes:'TEST-UP,TEST-DOWN,'+a.code})).total,1);
    assert.equal(listCourses(isolated,new URLSearchParams()).total,3);
    syncCoursePages(isolated);assert.equal(courseDetail(isolated,'TEST-UP').code,a.code);
    assert.notEqual(seriesFor({name:'高等数学(英文)(上)',department:'测试学院'}).id,a.code);
    assert.equal(seriesFor({name:'线性代数',department:'测试学院'}),null);
  }finally{isolated.close();}
});
