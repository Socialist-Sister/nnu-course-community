import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {commonCategories,normalized} from './taxonomy.mjs';

export const readBoya=()=>JSON.parse(readFileSync(new URL('./data/boya-2026-autumn.json',import.meta.url),'utf8'));
export function importBoya(db,manifest=readBoya(),{check=false}={}){
  const categories=commonCategories.filter(c=>c.kind==='liberal');
  if(manifest.basis!=='2024'||manifest.semester!=='2026-2027-1'||!Array.isArray(manifest.courses)||manifest.courses.length!==113)throw Error('本学期博雅表或培养方案不完整');
  if(!db.prepare('SELECT 1 FROM semesters WHERE id=?').get(manifest.semester))throw Error('请先导入本学期课程目录');
  if(manifest.sources?.length!==2||manifest.sources.some(s=>!s.file.endsWith('.xlsx')||!/^[a-f0-9]{64}$/.test(s.sha256)))throw Error('工作簿来源缺失');
  const seen=new Set();
  for(const c of manifest.courses){
    const known=db.prepare('SELECT name FROM courses WHERE code=?').get(c.code);
    if(seen.has(c.code)||!known||normalized(known.name)!==normalized(c.name))throw Error('重复、新增或改名课程：'+c.code);
    if(!categories.some(t=>t.id===c.categoryId)||!['offline','online','interuniversity'].includes(c.mode)||!manifest.sources[c.source]||!c.sheet||!c.rows?.length||c.rows.some(n=>!Number.isInteger(n)||n<3))throw Error('课程分类或来源无效：'+c.code);
    seen.add(c.code);
  }
  const counts=categories.map(c=>({id:c.id,name:c.name,count:manifest.courses.filter(r=>r.categoryId===c.id).length}));
  const modes=Object.fromEntries(['offline','online','interuniversity'].map(mode=>[mode,manifest.courses.filter(c=>c.mode===mode).length]));
  if(modes.offline!==71||modes.online!==25||modes.interuniversity!==17)throw Error('开课方式数量核对失败');
  const hasOverrides=db.prepare("SELECT 1 FROM sqlite_master WHERE name='course_overrides'").get();
  const overrides=hasOverrides?db.prepare('SELECT code FROM course_overrides WHERE category_ids IS NOT NULL').all().filter(c=>seen.has(c.code)).map(c=>c.code):[];
  const removed=db.prepare("SELECT DISTINCT course_code FROM liberal_classifications WHERE category_id LIKE 'liberal-%'").all().filter(c=>!seen.has(c.course_code)).map(c=>c.course_code);
  const result={courses:seen.size,basis:manifest.basis,counts,modes,removedFromSemesterCategories:removed,preservedCategoryOverrides:overrides};
  if(check)return result;
  const hash=createHash('sha256').update(JSON.stringify(manifest)).digest('hex'),now=new Date().toISOString();
  db.exec('BEGIN IMMEDIATE');
  try{
    db.prepare('DELETE FROM boya_courses WHERE semester_id=?').run(manifest.semester);
    for(const c of categories)db.prepare('DELETE FROM liberal_classifications WHERE category_id=?').run(c.id);
    const tag=db.prepare('INSERT INTO liberal_classifications VALUES(?,?,?,?)');
    const add=db.prepare('INSERT INTO boya_courses(course_code,semester_id,category_id,basis,delivery_mode,platform,school,source_file,source_sheet,source_rows,source_hash,manifest_hash,imported_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)');
    for(const c of manifest.courses){
      const source=manifest.sources[c.source];
      tag.run(c.code,c.categoryId,source.file,now);
      add.run(c.code,manifest.semester,c.categoryId,manifest.basis,c.mode,c.platform,c.school,source.file,c.sheet,JSON.stringify(c.rows),source.sha256,hash,now);
    }
    const status=db.prepare('INSERT INTO liberal_capture_status VALUES(?,?,?,?) ON CONFLICT(category_id) DO UPDATE SET source_url=excluded.source_url,captured_at=excluded.captured_at,course_count=excluded.course_count');
    for(const c of counts)status.run(c.id,'2026-2027学年第一学期博雅开课表（24版培养方案）',now,c.count);
    db.exec('COMMIT');
  }catch(e){db.exec('ROLLBACK');throw e;}
  return result;
}
export function boyaMap(db){
  return new Map(db.prepare('SELECT course_code AS code,semester_id AS semester,category_id AS categoryId,basis,delivery_mode AS mode,platform,school,source_file AS sourceFile FROM boya_courses ORDER BY semester_id').all().map(c=>[c.code,c]));
}
