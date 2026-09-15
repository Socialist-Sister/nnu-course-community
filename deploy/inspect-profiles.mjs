// Deployment check: aggregates only, never print nicknames, avatars or credentials.
import {DatabaseSync} from 'node:sqlite';
const db=new DatabaseSync(process.argv[2]||'/var/lib/nnu-course/catalog.sqlite',{readOnly:true,timeout:5000});
try{
  const result={accounts:db.prepare('SELECT COUNT(*) n FROM accounts').get().n,
    profiles:db.prepare('SELECT COUNT(*) n FROM account_profiles').get().n,
    uniqueNicknames:db.prepare('SELECT COUNT(DISTINCT nickname) n FROM account_profiles').get().n,
    reservedNumbers:db.prepare('SELECT COUNT(*) n FROM nickname_numbers').get().n,
    avatars:db.prepare('SELECT COUNT(*) n FROM account_profiles WHERE avatar IS NOT NULL').get().n,
    foreignKeyErrors:db.prepare('PRAGMA foreign_key_check').all().length};
  console.log(JSON.stringify(result));
  if(result.accounts!==result.profiles||result.profiles!==result.uniqueNicknames||result.foreignKeyErrors)process.exitCode=1;
}finally{db.close();}
