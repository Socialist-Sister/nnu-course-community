// Run while the local preview is stopped. Preserves a consistent pre-migration backup.
import {DatabaseSync,backup} from 'node:sqlite';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {defaultDbPath,openDatabase,root} from '../server/database.mjs';

const source=new DatabaseSync(defaultDbPath,{readOnly:true});
const tables=source.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name!='schema_migrations'").all().map(r=>r.name);
const quote=s=>'"'+s.replaceAll('"','""')+'"';
const queries=tables.map(name=>({name,sql:`SELECT ${source.prepare(`PRAGMA table_info(${quote(name)})`).all().map(c=>quote(c.name)).join(',')} FROM ${quote(name)} ORDER BY rowid`}));
const snapshot=db=>queries.map(({name,sql})=>{const rows=db.prepare(sql).all();return {table:name,count:rows.length,hash:createHash('sha256').update(JSON.stringify(rows)).digest('hex')};});
const before=snapshot(source),stamp=new Date().toISOString().replaceAll(':','-');
const backupDir=resolve(root,'database/backups');mkdirSync(backupDir,{recursive:true});
const backupPath=resolve(backupDir,`before-campus-email-${stamp}.sqlite`);
await backup(source,backupPath);source.close();
const migrated=openDatabase(defaultDbPath);
try{
  assert.deepEqual(snapshot(migrated),before,'Existing data changed during migration');
  assert.deepEqual(migrated.prepare('PRAGMA foreign_key_check').all(),[]);
  const result={backupPath,verifiedAt:new Date().toISOString(),existingTables:before,migration:migrated.prepare('SELECT MAX(version) version FROM schema_migrations').get().version};
  writeFileSync(resolve(backupDir,`campus-email-check-${stamp}.json`),JSON.stringify(result,null,2));
  console.log(JSON.stringify({backupPath,migration:result.migration,preservedTables:before.length,foreignKeys:'ok'}));
}finally{migrated.close();}
