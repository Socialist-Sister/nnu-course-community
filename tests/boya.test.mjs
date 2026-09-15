import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {openDatabase} from '../server/database.mjs';
import {readCatalog,importCatalog} from '../server/import-catalog.mjs';
import {importLiberal,importAvailableLiberal} from '../server/import-liberal.mjs';
import {importBoya,readBoya} from '../server/boya.mjs';
import {metadata,courseDetail} from '../server/catalog.mjs';
import {homeFeed} from '../server/home.mjs';

test('工作簿24版分类、完整名单、渠道标签、幂等与原始数据保留',()=>{
  const db=openDatabase(':memory:');
  try{
    importCatalog(db,readCatalog());
    importLiberal(db,JSON.parse(readFileSync(new URL('../../course-data/2026-autumn/liberal-classifications.json',import.meta.url),'utf8')));
    const manifest=readBoya(),group=courseDetail(db,manifest.courses.find(c=>c.mode==='interuniversity').code).groups[0].sourceGroupIds[0],time='2026-09-12T00:00:00Z';
    db.prepare('INSERT INTO users VALUES(?,?,?)').run('qa-boya','private-test',time);
    db.prepare('INSERT INTO reviews VALUES(?,?,?,?,?,?,?,?,?,?)').run('qa-review','qa-boya',group,null,4,'独立测试数据库的评价',1,'published',time,time);
    const tables=['courses','teaching_groups','offerings','course_snapshots','users','reviews','accounts','account_profiles'];
    const snapshot=()=>tables.map(t=>db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all());
    const original=snapshot();
    const report=importBoya(db,manifest,{check:true});
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM boya_courses').get().n,0);
    assert.deepEqual(report.removedFromSemesterCategories.sort(),['1000000045','1000000371','1000000560']);
    importBoya(db,manifest);
    assert.deepEqual(metadata(db).commonCategories.filter(c=>c.kind==='liberal').map(c=>c.count),[13,16,22,19,21,22]);
    for(const c of manifest.courses){const actual=courseDetail(db,c.code).boya;assert.equal(actual.categoryId,c.categoryId);assert.equal(actual.mode,c.mode);assert.equal(actual.basis,'2024');}
    for(const code of ['1000000270','1000000552'])assert.equal(courseDetail(db,code).boya.mode,'offline');
    assert.equal(homeFeed(db).reviews[0].boya.mode,'interuniversity');
    for(const code of report.removedFromSemesterCategories)assert.ok(courseDetail(db,code));
    importAvailableLiberal(db);assert.deepEqual(snapshot(),original);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM boya_courses').get().n,113);
    const mappings=db.prepare('SELECT * FROM liberal_classifications ORDER BY course_code').all();
    const bad=structuredClone(manifest);bad.courses[0].name='未经确认的新名称';
    assert.throws(()=>importBoya(db,bad),/改名课程/);
    const duplicate=structuredClone(manifest);duplicate.courses[1]=duplicate.courses[0];assert.throws(()=>importBoya(db,duplicate),/重复/);
    const wrong=structuredClone(manifest);wrong.basis='2026';assert.throws(()=>importBoya(db,wrong),/培养方案/);
    // A database failure after deletion must restore the old mapping atomically.
    db.exec("CREATE TRIGGER qa_import_failure BEFORE INSERT ON boya_courses BEGIN SELECT RAISE(ABORT,'qa rollback'); END;");
    assert.throws(()=>importBoya(db,manifest),/qa rollback/);
    assert.deepEqual(db.prepare('SELECT * FROM liberal_classifications ORDER BY course_code').all(),mappings);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM boya_courses').get().n,113);
    db.exec('DROP TRIGGER qa_import_failure');
    const c=db.prepare('SELECT * FROM courses WHERE code=?').get(manifest.courses[0].code);
    db.prepare('INSERT INTO course_overrides VALUES(?,?,?,?,?,?)').run(c.code,c.name,c.department,'["liberal-global"]','auto',time);
    assert.deepEqual(importBoya(db).preservedCategoryOverrides,[c.code]);
    assert.equal(db.prepare('SELECT category_ids FROM course_overrides WHERE code=?').get(c.code).category_ids,'["liberal-global"]');
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
  }finally{db.close();}
});
