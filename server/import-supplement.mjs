import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {openDatabase} from './database.mjs';
import {groupId} from './import-catalog.mjs';
import {syncCoursePages} from './taxonomy.mjs';
export const readSupplement=()=>JSON.parse(readFileSync(new URL('./data/catalog-supplement-20260914.json',import.meta.url)));
export function importSupplement(db,data=readSupplement()) {
  const courses=new Map(),keys=new Set();
  for(const item of data.rows){
    const r=item.row,key=JSON.stringify([r[0],r[2]]);
    if(r.length!==9||!r[0]||!r[1]||!r[2]||keys.has(key)||!Number.isFinite(Number(r[6]))||!Number.isFinite(Number(r[7])))throw Error('Invalid supplemental row');
    keys.add(key);
    if(courses.has(r[0])&&JSON.stringify(courses.get(r[0]).filter((_,i)=>i!==2&&i!==8))!==JSON.stringify(r.filter((_,i)=>i!==2&&i!==8)))throw Error('Conflicting course metadata');
    courses.set(r[0],r);
  }
  if(courses.size!==data.courseCount||data.courseCount!==17||data.semester!=='2026-2027-1')throw Error('Unexpected supplemental scope');
  db.exec('BEGIN IMMEDIATE');
  let addedCourses=0,addedOfferings=0;
  try{
    db.exec('CREATE TABLE IF NOT EXISTS catalog_supplements(id TEXT PRIMARY KEY,source_hash TEXT NOT NULL,source_url TEXT NOT NULL,captured_at TEXT NOT NULL,applied_at TEXT NOT NULL)');
    const done=db.prepare('SELECT source_hash FROM catalog_supplements WHERE id=?').get(data.id);
    if(done){if(done.source_hash!==data.sourceHash)throw Error('Supplement hash mismatch');db.exec('COMMIT');return {skipped:true,addedCourses:0,addedOfferings:0};}
    // Refuse existing course collisions instead of overwriting live metadata or review identities.
    for(const [code,r]of courses){
      if(db.prepare('SELECT 1 FROM courses WHERE code=?').get(code))throw Error(`Course already exists: ${code}`);
      db.prepare('INSERT INTO courses VALUES(?,?,?,?,?,?,?)').run(code,r[1],r[3],r[4],r[5],Number(r[6]),Number(r[7]));
      db.prepare('INSERT INTO course_snapshots VALUES(?,?,?,?,?,?,?,?)').run(code,data.semester,r[1],r[3],r[4],r[5],Number(r[6]),Number(r[7]));addedCourses++;
    }
    for(const {row:r,page,position}of data.rows){
      const id=groupId(r[0],r[1],r[8]);
      db.prepare('INSERT OR IGNORE INTO teaching_groups VALUES(?,?,?,?,?)').run(id,r[0],r[1],r[8],Number(Boolean(r[8])&&!/^[-—\s]+$/.test(r[8])));
      db.prepare('INSERT INTO offerings VALUES(?,?,?,?,?,?,?)').run(`${data.semester}:${r[0]}:${r[2]}`,id,data.semester,r[2],page,position,data.capturedAt);addedOfferings++;
    }
    syncCoursePages(db);
    db.prepare('INSERT INTO catalog_supplements VALUES(?,?,?,?,?)').run(data.id,data.sourceHash,data.sourceUrl,data.capturedAt,new Date().toISOString());
    if(db.prepare('PRAGMA foreign_key_check').all().length)throw Error('Foreign key violation');
    db.exec('COMMIT');return {skipped:false,addedCourses,addedOfferings};
  }catch(e){db.exec('ROLLBACK');throw e;}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){const db=openDatabase();try{console.log(importSupplement(db));}finally{db.close();}}
