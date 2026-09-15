import {readFileSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {openDatabase,root} from './database.mjs';
import {commonCategories,syncCoursePages} from './taxonomy.mjs';
import {importBoya} from './boya.mjs';
export function importAvailableLiberal(db, source=resolve(root,'../course-data')) {
  if(existsSync(resolve(root,'server/data/boya-2026-autumn.json'))&&db.prepare("SELECT 1 FROM semesters WHERE id='2026-2027-1'").get())return importBoya(db).counts;
  const file=resolve(source,'2026-autumn/liberal-classifications.json');
  return existsSync(file)?importLiberal(db,JSON.parse(readFileSync(file,'utf8'))):[];
}
export function importLiberal(db, records) {
  const expected=commonCategories.filter(c=>c.kind==='liberal');
  // Categories may be captured separately; retain mappings for categories not supplied.
  if(!Array.isArray(records)||!records.length||new Set(records.map(r=>r.id)).size!==records.length)throw Error('分类不完整');
  const known=new Map(db.prepare('SELECT code,name FROM courses').all().map(c=>[c.code,c.name]));
  for(const r of records){
    if(!expected.some(c=>c.id===r.id&&c.name===r.name))throw Error('未知分类');
    if(r.sourceUrl!=='https://xsxk.nnu.edu.cn/'||!r.pages.length)throw Error('来源不完整');
    if(r.pages.some((p,i)=>p.page!==i+1||p.totalPages!==r.pages.length))throw Error('分类缺页');
    for(const row of r.pages.flatMap(p=>p.rows))if(!known.has(row[0])||known.get(row[0])!==row[1])throw Error('分类含新增或改名课程，需先补充课程目录：'+row[0]);
    const unique=[...new Set(r.pages.flatMap(p=>p.rows.map(row=>row[0])))];
    if(JSON.stringify(unique)!==JSON.stringify(r.courseCodes))throw Error('分类课程编号核对失败');
  }
  if(db.prepare("SELECT 1 FROM boya_courses WHERE semester_id='2026-2027-1' LIMIT 1").get())throw Error('已有本学期工作簿分类，不能用旧采集结果覆盖；请更新博雅工作簿清单');
  db.exec('BEGIN IMMEDIATE');
  try{
    const add=db.prepare('INSERT INTO liberal_classifications VALUES(?,?,?,?)');
    const status=db.prepare('INSERT INTO liberal_capture_status VALUES(?,?,?,?) ON CONFLICT(category_id) DO UPDATE SET source_url=excluded.source_url,captured_at=excluded.captured_at,course_count=excluded.course_count');
    for(const r of records){db.prepare('DELETE FROM liberal_classifications WHERE category_id=?').run(r.id);for(const code of r.courseCodes)add.run(code,r.id,r.sourceUrl,r.capturedAt);status.run(r.id,r.sourceUrl,r.capturedAt,r.courseCodes.length);}
    db.exec('COMMIT');
  }catch(e){db.exec('ROLLBACK');throw e;}
  return records.map(r=>({category:r.name,count:r.courseCodes.length}));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const db=openDatabase();try{syncCoursePages(db);console.log(importLiberal(db,JSON.parse(readFileSync(process.argv[2]||resolve(root,'../course-data/2026-autumn/liberal-classifications.json'),'utf8'))));}finally{db.close();}
}
