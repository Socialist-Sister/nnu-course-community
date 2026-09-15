import {DatabaseSync,backup} from 'node:sqlite';
import {mkdirSync,readdirSync,unlinkSync} from 'node:fs';
import {join} from 'node:path';
const directory='/var/lib/nnu-course/backups';
mkdirSync(directory,{recursive:true,mode:0o700});
const db=new DatabaseSync('/var/lib/nnu-course/catalog.sqlite',{readOnly:true});
const name=`catalog-${new Date().toISOString().replaceAll(':','-')}.sqlite`;
await backup(db,join(directory,name));
db.close();
const check=new DatabaseSync(join(directory,name),{readOnly:true});
if(check.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')throw Error('Backup integrity check failed');
check.close();
// Retain the newest 14 successful backups, touching only files we generated.
const files=readdirSync(directory).filter(n=>/^catalog-\d{4}-\d{2}-\d{2}T[\d.-]+Z\.sqlite$/.test(n)).sort();
for(const old of files.slice(0,-14))unlinkSync(join(directory,old));
console.log(`Backup verified: ${name}`);
