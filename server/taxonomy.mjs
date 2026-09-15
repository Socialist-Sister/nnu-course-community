import { createHash } from 'node:crypto';

// User-defined shortcuts, separate from the source system's course-category column.
export const commonCategories = [
  {id:'english',name:'英语',kind:'course'},
  {id:'advanced-math',name:'高等数学',kind:'course'},
  {id:'linear-algebra',name:'线性代数',kind:'course'},
  {id:'probability-statistics',name:'概率论与数理统计',kind:'course'},
  {id:'physics',name:'大学物理',kind:'course'},
  {id:'physical-education',name:'体育',kind:'course'},
  {id:'liberal-global',name:'国际视野与文明互鉴',kind:'liberal'},
  {id:'liberal-health',name:'身心健康与生命关怀',kind:'liberal'},
  {id:'liberal-science',name:'数理基础与科学技术',kind:'liberal'},
  {id:'liberal-humanities',name:'人文经典与社会研究',kind:'liberal'},
  {id:'liberal-arts',name:'艺术鉴赏与审美体验',kind:'liberal'},
  {id:'liberal-innovation',name:'创新与创业',kind:'liberal'},
  {id:'civics-ethics-law',name:'思想道德与法治',kind:'civics'},
  {id:'civics-marxism',name:'马克思主义基本原理',kind:'civics'},
  {id:'civics-modern-history',name:'中国近现代史纲要',kind:'civics'},
  {id:'civics-mao-theory',name:'毛泽东思想和中国特色社会主义理论体系概论',courseName:'毛泽东思想和中国特色社会主义理论体系概论',kind:'civics'},
  {id:'civics-xi-thought',name:'习近平新时代中国特色社会主义思想概论',courseName:'习近平新时代中国特色社会主义思想概论',kind:'civics'},
];
export const normalized = s => String(s).normalize('NFKC').toLowerCase().replace(/[\s()（）·:：,，、\-—]/g,'');
export function commonCourseCategory(course) {
  // Explicit user mapping; retain the school's original course name and identity.
  if(course.code==='1025009028')return 'civics-ethics-law';
  // Provisional scope requested by the user; refine once course details are clarified.
  if(course.department==='公共体育教学部')return 'physical-education';
  const name=course.name.normalize('NFKC');
  // Match the requested courses, not similarly titled specialist courses or seminars.
  const civics=commonCategories.find(c=>c.kind==='civics'&&normalized(c.courseName||c.name)===normalized(name));
  if(civics)return civics.id;
  if(/^提高英语\(\d+\)$/.test(name)&&course.department==='大学外语教学部')return 'english';
  if(/^高等数学/.test(name))return 'advanced-math';
  if(/^线性代数/.test(name))return 'linear-algebra';
  // Do not substitute English-language or specialist probability courses for the missing public course.
  if(/^概率论与数理统计(?:[ABCⅠⅡⅢIV123]*)$/.test(name))return 'probability-statistics';
  if(/^大学物理(?!实验|基础)/.test(name))return 'physics';
  return null;
}
export function seriesFor(course) {
  const name=course.name.normalize('NFKC');
  if(!/^(高等数学|大学物理)/.test(name)||!/\((上|下)\)$/.test(name))return null;
  const part=name.match(/\((上|下)\)$/)[1];
  // Preserve version and department, so I/II/III, A/B and English versions never collapse together.
  const title=course.name.replace(/[（(](上|下)[）)]$/,'');
  const key=JSON.stringify([course.department,normalized(title)]);
  return {id:'series-'+createHash('sha256').update(key).digest('hex').slice(0,20),name:title,part};
}
export function syncCoursePages(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS course_pages(id TEXT PRIMARY KEY,name TEXT NOT NULL,department TEXT NOT NULL,is_series INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS course_page_members(course_code TEXT PRIMARY KEY REFERENCES courses(code),page_id TEXT NOT NULL REFERENCES course_pages(id),part TEXT);
    CREATE INDEX IF NOT EXISTS idx_page_members ON course_page_members(page_id);
    CREATE TABLE IF NOT EXISTS liberal_classifications(course_code TEXT NOT NULL REFERENCES courses(code),category_id TEXT NOT NULL,source_url TEXT NOT NULL,captured_at TEXT NOT NULL,PRIMARY KEY(course_code,category_id));
    CREATE TABLE IF NOT EXISTS liberal_capture_status(category_id TEXT PRIMARY KEY,source_url TEXT NOT NULL,captured_at TEXT NOT NULL,course_count INTEGER NOT NULL);`);
  const page=db.prepare('INSERT INTO course_pages VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,department=excluded.department');
  const member=db.prepare('INSERT INTO course_page_members VALUES(?,?,?) ON CONFLICT(course_code) DO UPDATE SET page_id=excluded.page_id,part=excluded.part');
  const outer=db.isTransaction;
  if(!outer)db.exec('BEGIN IMMEDIATE');
  try {
    const hasOverrides=!!db.prepare("SELECT 1 FROM sqlite_master WHERE name='effective_courses'").get();
    for(const c of db.prepare(hasOverrides?'SELECT c.*,o.series_mode FROM effective_courses c LEFT JOIN course_overrides o ON o.code=c.code':'SELECT * FROM courses').all()) {
      const series=c.series_mode==='separate'?null:seriesFor(c),nextId=series?.id||c.code;
      if(hasOverrides){const previous=db.prepare('SELECT page_id FROM course_page_members WHERE course_code=?').get(c.code);if(previous&&previous.page_id!==nextId)db.prepare('INSERT OR IGNORE INTO course_page_aliases VALUES(?,?)').run(previous.page_id,c.code);}
      page.run(nextId,series?.name||c.name,c.department,Number(!!series));member.run(c.code,nextId,series?.part||null);
    }
    db.exec("INSERT OR IGNORE INTO schema_migrations VALUES(2,strftime('%Y-%m-%dT%H:%M:%fZ','now'))");
    if(!outer)db.exec('COMMIT');
  }catch(e){if(!outer)db.exec('ROLLBACK');throw e;}
}
