export function migrateEmail(db){
  db.exec('BEGIN IMMEDIATE');
  try{
    const columns=db.prepare('PRAGMA table_info(accounts)').all().map(c=>c.name);
    if(!columns.includes('email'))db.exec('ALTER TABLE accounts ADD COLUMN email TEXT');
    if(!columns.includes('email_verified_at'))db.exec('ALTER TABLE accounts ADD COLUMN email_verified_at TEXT');
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_email ON accounts(email) WHERE email IS NOT NULL;
      CREATE TABLE IF NOT EXISTS email_challenges(
        id TEXT PRIMARY KEY,email TEXT NOT NULL,purpose TEXT NOT NULL CHECK(purpose IN('register','recover','bind')),
        requester_id TEXT NOT NULL,account_id TEXT,password_version TEXT,code_hash TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,expires_at INTEGER NOT NULL,created_at INTEGER NOT NULL,delivered INTEGER NOT NULL DEFAULT 0);
      CREATE INDEX IF NOT EXISTS idx_email_challenges_scope ON email_challenges(email,purpose,requester_id);
      INSERT OR IGNORE INTO schema_migrations VALUES(7,strftime('%Y-%m-%dT%H:%M:%fZ','now'));`);
    db.exec('COMMIT');
  }catch(e){db.exec('ROLLBACK');throw e;}
}
