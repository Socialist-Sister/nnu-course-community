// Read-only deployment verification: counts and integrity, never account content.
import {DatabaseSync} from 'node:sqlite';
const db=new DatabaseSync(process.argv[2]||'/var/lib/nnu-course/catalog.sqlite',{readOnly:true,timeout:5000});
try{
  const tables=['courses','teaching_groups','offerings','accounts','reviews','reports','admin_audit'];
  console.log(JSON.stringify({counts:Object.fromEntries(tables.map(table=>[table,db.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n])),
    schemaVersion:db.prepare('SELECT MAX(version) n FROM schema_migrations').get().n,
    integrity:db.prepare('PRAGMA integrity_check').get().integrity_check,foreignKeyErrors:db.prepare('PRAGMA foreign_key_check').all().length}));
}finally{db.close();}
