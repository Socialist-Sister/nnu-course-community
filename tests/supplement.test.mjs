import {test} from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../server/database.mjs';
import {readCatalog,importCatalog} from '../server/import-catalog.mjs';
import {readSupplement,importSupplement} from '../server/import-supplement.mjs';
import {commonCourseCategory} from '../server/taxonomy.mjs';
test('supplement adds only new courses, preserves all old rows, and is idempotent',()=>{
 const db=openDatabase(':memory:');
 try{
  importCatalog(db,readCatalog());
  const tables=['courses','course_snapshots','teaching_groups','offerings','semesters','reviews','liberal_classifications'];
  const before=Object.fromEntries(tables.map(t=>[t,db.prepare(`SELECT * FROM ${t}`).all()]));
  const result=importSupplement(db);assert.equal(result.addedCourses,17);
  assert.equal(db.prepare('SELECT count(*) n FROM courses').get().n,2041);
  for(const t of tables){const after=new Set(db.prepare(`SELECT * FROM ${t}`).all().map(r=>JSON.stringify(r)));for(const row of before[t])assert.ok(after.has(JSON.stringify(row)),`Changed old ${t} row`);}
  assert.equal(importSupplement(db).skipped,true);
  assert.equal(db.prepare('SELECT count(*) n FROM offerings').get().n,5074+readSupplement().rows.length);
  assert.equal(commonCourseCategory(db.prepare('SELECT * FROM courses WHERE code=?').get('1025009028')),'civics-ethics-law');
  assert.equal(commonCourseCategory({code:'other',name:'思想政治教育原理',department:'马克思主义学院'}),null);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
 }finally{db.close();}
});
