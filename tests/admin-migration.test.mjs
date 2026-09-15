import {test} from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../server/database.mjs';
import {migrateAdminMembers,adminAccess} from '../server/admin-members.mjs';
test('现有首位管理员迁移为唯一负责人，重复迁移不恢复已撤销权限',()=>{
 const db=openDatabase(':memory:');try{
 db.exec('DROP TABLE admin_permissions; DROP TABLE site_owner');
 db.prepare('INSERT INTO users VALUES(?,?,?)').run('legacy','legacy','2026-01-01');
 db.prepare('INSERT INTO accounts(user_id,username,password_hash,recovery_hash,role,created_at) VALUES(?,?,?,?,?,?)').run('legacy','legacy','test','test','admin','2026-01-01');
 migrateAdminMembers(db);assert.equal(adminAccess(db,'legacy').isOwner,true);
 assert.throws(()=>db.prepare('DELETE FROM accounts WHERE user_id=?').run('legacy'));
 db.exec('DELETE FROM admin_permissions');migrateAdminMembers(db);
 assert.equal(db.prepare('SELECT COUNT(*) n FROM admin_permissions').get().n,0);
 assert.equal(adminAccess(db,'legacy').isOwner,true);
 assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
 }finally{db.close();}
});
