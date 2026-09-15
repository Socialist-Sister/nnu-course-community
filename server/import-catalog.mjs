import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { openDatabase, root } from './database.mjs';
import { syncCoursePages } from './taxonomy.mjs';
import { importAvailableLiberal } from './import-liberal.mjs';
export const groupId = (code, name, teachers) => createHash('sha256').update(JSON.stringify([code, name, teachers])).digest('hex').slice(0, 32);
export function readCatalog(source = resolve(root, '../course-data')) {
  const read = file => JSON.parse(readFileSync(resolve(source, file), 'utf8'));
  return { courses: read('2026-autumn/courses.json'), offerings: read('2026-autumn/offerings.json'),
    deduplicated: read('2026-autumn-deduplicated/offerings.json'), report: read('2026-autumn/validation-report.json') };
}
export function importCatalog(db, data) {
  const { courses, offerings, deduplicated, report } = data;
  const assert = (ok, message) => { if (!ok) throw Error(message); };
  const courseMap = new Map(courses.map(c => [c.course_code, c]));
  assert(courseMap.size === courses.length && courses.length === report.courses, '课程数量或编号不一致');
  assert(offerings.length === report.offerings, '原始教学班数量不一致');
  const groups = new Map(), keys = new Set();
  for (const o of offerings) {
    const c = courseMap.get(o.course_code);
    assert(c && typeof o.section_no === 'string' && typeof o.course_code === 'string', '无效课程关联或编号类型');
    assert(o.semester === report.semester && !keys.has(o.offering_id), '重复教学班或学期不一致');
    assert(o.offering_id === `${o.semester}:${o.course_code}:${o.section_no}`, '教学班编号不一致');
    keys.add(o.offering_id);
    const id = groupId(c.course_code, c.name, o.teachers_raw);
    if (!groups.has(id)) groups.set(id, o);
  }
  assert(groups.size === deduplicated.length, '去重数量不一致');
  for (const o of deduplicated) {
    const c = courseMap.get(o.course_code), first = c && groups.get(groupId(c.course_code, c.name, o.teachers_raw));
    assert(first?.offering_id === o.offering_id, '去重结果未保留原始第一条');
  }
  const hash = createHash('sha256').update(JSON.stringify(data)).digest('hex');
  const existing = db.prepare('SELECT source_hash FROM semesters WHERE id = ?').get(report.semester);
  if (existing) {
    assert(existing.source_hash === hash, '该学期已有不同快照，请先备份并编写显式更新迁移');
    syncCoursePages(db);
    return { skipped: true, courses: courses.length, groups: groups.size, offerings: offerings.length };
  }
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare('INSERT INTO semesters VALUES (?, ?, ?, ?, ?, ?)').run(report.semester, report.term_label, report.captured_end, report.source_url, hash, report.pages);
    const insertCourse = db.prepare(`INSERT INTO courses VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(code) DO UPDATE SET
      name=excluded.name, department=excluded.department, nature=excluded.nature, category=excluded.category, credits=excluded.credits, hours=excluded.hours`);
    const snapshot = db.prepare('INSERT INTO course_snapshots VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    for (const c of courses) {
      insertCourse.run(c.course_code, c.name, c.department, c.nature, c.category, c.credits, c.hours);
      snapshot.run(c.course_code, report.semester, c.name, c.department, c.nature, c.category, c.credits, c.hours);
    }
    const insertGroup = db.prepare('INSERT OR IGNORE INTO teaching_groups VALUES (?, ?, ?, ?, ?)');
    for (const [id, o] of groups) insertGroup.run(id, o.course_code, courseMap.get(o.course_code).name, o.teachers_raw, Number(o.teachers_provided));
    const insertOffering = db.prepare('INSERT INTO offerings VALUES (?, ?, ?, ?, ?, ?, ?)');
    for (const o of offerings) insertOffering.run(o.offering_id, groupId(o.course_code, courseMap.get(o.course_code).name, o.teachers_raw), o.semester, o.section_no, o.source_page, o.source_row, o.captured_at);
    assert(db.prepare('PRAGMA foreign_key_check').all().length === 0, '外键校验失败');
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
  syncCoursePages(db);
  return { skipped: false, courses: courses.length, groups: groups.size, offerings: offerings.length };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const db = openDatabase();
  try { console.log(JSON.stringify({catalog:importCatalog(db, readCatalog(process.argv[2])),liberal:importAvailableLiberal(db,process.argv[2])}, null, 2)); }
  finally { db.close(); }
}
