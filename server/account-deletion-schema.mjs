// Reports and moderation history survive an account deletion without identity links.
export function migrateAccountDeletion(db){
  if(db.prepare('SELECT 1 FROM schema_migrations WHERE version=8').get())return;
  db.exec('BEGIN IMMEDIATE');
  try{
    db.exec(`CREATE TABLE reports_next(
      id TEXT PRIMARY KEY,review_id TEXT REFERENCES reviews(id) ON DELETE SET NULL,
      reporter_id TEXT REFERENCES accounts(user_id) ON DELETE SET NULL,reason TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open' CHECK(status IN('open','resolved','dismissed')),
      resolution TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL,updated_at TEXT NOT NULL,
      UNIQUE(review_id,reporter_id));
      INSERT INTO reports_next SELECT * FROM reports;
      DROP TABLE reports;
      ALTER TABLE reports_next RENAME TO reports;
      CREATE TABLE admin_audit_next(
        id TEXT PRIMARY KEY,actor_id TEXT REFERENCES accounts(user_id) ON DELETE SET NULL,
        action TEXT NOT NULL,target TEXT NOT NULL,detail TEXT NOT NULL,created_at TEXT NOT NULL);
      INSERT INTO admin_audit_next SELECT * FROM admin_audit;
      DROP TABLE admin_audit;
      ALTER TABLE admin_audit_next RENAME TO admin_audit;
      INSERT INTO schema_migrations VALUES(8,strftime('%Y-%m-%dT%H:%M:%fZ','now'));`);
    if(db.prepare('PRAGMA foreign_key_check').all().length)throw Error('Account deletion migration foreign key check failed');
    db.exec('COMMIT');
  }catch(error){db.exec('ROLLBACK');throw error;}
}
