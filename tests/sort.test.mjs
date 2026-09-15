import {test} from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../server/database.mjs';
import {syncCoursePages} from '../server/taxonomy.mjs';
import {listCourses} from '../server/catalog.mjs';
import {readNavigation,navigationUrl,DEFAULTS} from '../src/navigation.mjs';

test('老师人数跨上下册及合教去重，缺失不计；排序先于分页并保留筛选和 URL',()=>{
  const db=openDatabase(':memory:');
  try{
    const data=[['001','高等数学Ⅰ(上)',['张三(教授),李四','教师信息未提供']],['002','高等数学Ⅰ(下)',['张三（教授）']],['003','高等数学Ⅱ(上)',['王五、赵六；钱七']],['004','高等数学Ⅲ(上)',['孙八,周九,吴十']]];
    for(const [code,name,teachers]of data){
      db.prepare('INSERT INTO courses VALUES(?,?,?,?,?,?,?)').run(code,name,'测试学院','测试','测试',4,72);
      teachers.forEach((raw,i)=>db.prepare('INSERT INTO teaching_groups VALUES(?,?,?,?,?)').run(code+i,code,name,raw,raw==='教师信息未提供'?0:1));
    }
    syncCoursePages(db);
    const get=extra=>listCourses(db,new URLSearchParams({sort:'teachers',...extra}));
    assert.deepEqual(get().items.map(c=>[c.courseCodes[0],c.teacherCount]),[['003',3],['004',3],['001',2]]);
    assert.equal(get({pageSize:'1',page:'2'}).items[0].courseCodes[0],'004');
    assert.deepEqual(get({q:'高数 张三',topic:'advanced-math',department:'测试学院'}).items.map(c=>c.teacherCount),[2]);
    assert.deepEqual(get({codes:'001,004'}).items.map(c=>c.courseCodes[0]),['004','001']);
    const filters={...DEFAULTS,sort:'teachers',topic:'liberal-innovation'};
    assert.deepEqual(readNavigation(new URL(navigationUrl('https://example.test/',filters,'','all',false),'https://example.test')).filters,filters);
  }finally{db.close();}
});

test('三种排序先于分页；已发布评价统计、上下册加权均值、空评分与搜索筛选',()=>{
  const db=openDatabase(':memory:');
  try {
    db.prepare('INSERT INTO semesters VALUES(?,?,?,?,?,?)').run('term','测试学期','2026-01-01','https://example.test','test',1);
    const courses=[['001','高等数学Ⅰ(上)'],['002','高等数学Ⅰ(下)'],['003','高等数学Ⅱ(上)'],['004','高等数学Ⅲ(上)'],['005','高等数学']];
    for(const [code,name]of courses){db.prepare('INSERT INTO courses VALUES(?,?,?,?,?,?,?)').run(code,name,'测试学院','测试','测试',4,72);db.prepare('INSERT INTO teaching_groups VALUES(?,?,?,?,?)').run('g'+code,code,name,'测试老师',1);}
    syncCoursePages(db);
    const get=(sort,extra={})=>listCourses(db,new URLSearchParams({sort,pageSize:'100',...extra}));
    const ids=result=>result.items.map(c=>c.courseCodes[0]);
    assert.deepEqual(ids(get('rating')),['001','003','004','005']); // Empty database does not invent scores.
    let sequence=0;
    const review=(code,rating,status='published')=>{const id=String(++sequence);db.prepare('INSERT INTO users VALUES(?,?,?)').run(id,'测试用户','2026-01-01');db.prepare('INSERT INTO reviews VALUES(?,?,?,?,?,?,?,?,?,?)').run(id,id,'g'+code,'term',rating,'测试内容',1,status,'2026-01-01','2026-01-01');};
    review('001',1);review('002',5);review('002',5); // 11 / 3, not the teacher-average value 3.
    review('003',4);review('005',4);review('004',5,'pending');review('004',5,'hidden');
    const rating=get('rating');assert.deepEqual(ids(rating),['003','005','001','004']);
    assert.deepEqual(ids(get('reviews')),['001','003','005','004']);
    assert.deepEqual(ids(get('code')),['001','003','004','005']);
    const series=rating.items.find(c=>c.courseCodes.includes('001'));assert.equal(series.reviewCount,3);assert.equal(series.rating,11/3);
    const empty=rating.items.find(c=>c.courseCodes.includes('004'));assert.equal(empty.reviewCount,0);assert.equal(empty.rating,null);
    assert.deepEqual(ids(get('rating',{page:'2',pageSize:'1'})),['005']);
    assert.deepEqual(ids(get('rating',{q:'高数',department:'测试学院',topic:'advanced-math'})),['003','005','001','004']);
    // Exact course-name relevance must not override an explicitly selected course-code order.
    assert.equal(ids(get('relevance',{q:'高数'}))[0],'005');
    assert.deepEqual(ids(get('code',{q:'高数'})),['001','003','004','005']);
    assert.deepEqual(ids(get('reviews',{codes:'005,004,003'})),['003','005','004']);
    db.prepare('UPDATE reviews SET status=? WHERE group_id=?').run('hidden','g003');
    assert.deepEqual(ids(get('rating')),['005','001','003','004']); // Cached index refreshes after moderation.
  }finally{db.close();}
});
