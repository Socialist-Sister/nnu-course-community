import {scryptSync,randomBytes} from 'node:crypto';
import {openDatabase} from '../server/database.mjs';
import {readCatalog,importCatalog} from '../server/import-catalog.mjs';
import {createProfile} from '../server/profiles.mjs';
import {digest} from '../server/accounts.mjs';
import {createApp} from '../server/index.mjs';
export async function fixture(){
 const db=openDatabase(':memory:');importCatalog(db,readCatalog());const people={},password='Isolated-bookmark-123',now=new Date().toISOString(),salt='qa-bookmark';
 for(const id of ['alpha','beta']){
  db.prepare('INSERT INTO users VALUES(?,?,?)').run(id,'test',now);
  db.prepare('INSERT INTO accounts(user_id,username,password_hash,recovery_hash,role,created_at,email,email_verified_at) VALUES(?,?,?,?,?,?,?,?)').run(id,id,salt+':'+scryptSync(password,salt,64).toString('hex'),'unused','member',now,id+'@njnu.edu.cn',now);
  db.prepare('INSERT INTO account_members VALUES(?,?)').run(id,id);createProfile(db,id);
  const token=randomBytes(32).toString('hex'),csrf=randomBytes(24).toString('hex');db.prepare('INSERT INTO visitor_sessions VALUES(?,?,?,?)').run(digest(token),id,csrf,Date.now()+3600000);
  people[id]={token,csrf};
 }
 const server=createApp(db,{mailer:{ready:false}});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 return {db,people,password,base:`http://127.0.0.1:${server.address().port}`,close:async()=>{await new Promise(r=>server.close(r));db.close();}};
}
