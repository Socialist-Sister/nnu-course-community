export function migrateAccounts(db){
  db.exec(`CREATE TABLE IF NOT EXISTS accounts(
    user_id TEXT PRIMARY KEY REFERENCES users(id),username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,recovery_hash TEXT NOT NULL,role TEXT NOT NULL DEFAULT 'member' CHECK(role IN('member','admin')),
    created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS account_members(user_id TEXT PRIMARY KEY REFERENCES users(id),account_id TEXT NOT NULL REFERENCES accounts(user_id));
    CREATE INDEX IF NOT EXISTS idx_account_members ON account_members(account_id);
    CREATE TABLE IF NOT EXISTS auth_attempts(key TEXT PRIMARY KEY,count INTEGER NOT NULL,reset_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS admin_setup(id INTEGER PRIMARY KEY CHECK(id=1),token_hash TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS review_moderation(review_id TEXT PRIMARY KEY REFERENCES reviews(id) ON DELETE CASCADE,blocked INTEGER NOT NULL CHECK(blocked IN(0,1)),reason TEXT NOT NULL,updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS reports(id TEXT PRIMARY KEY,review_id TEXT REFERENCES reviews(id) ON DELETE SET NULL,reporter_id TEXT NOT NULL REFERENCES accounts(user_id),reason TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open' CHECK(status IN('open','resolved','dismissed')),resolution TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL,updated_at TEXT NOT NULL,UNIQUE(review_id,reporter_id));
    CREATE TABLE IF NOT EXISTS admin_audit(id TEXT PRIMARY KEY,actor_id TEXT NOT NULL REFERENCES accounts(user_id),action TEXT NOT NULL,target TEXT NOT NULL,detail TEXT NOT NULL,created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS course_overrides(code TEXT PRIMARY KEY REFERENCES courses(code),name TEXT NOT NULL,department TEXT NOT NULL,category_ids TEXT,series_mode TEXT NOT NULL CHECK(series_mode IN('auto','separate')),updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS group_overrides(group_id TEXT PRIMARY KEY REFERENCES teaching_groups(id),teachers_raw TEXT NOT NULL,teachers_provided INTEGER NOT NULL CHECK(teachers_provided IN(0,1)),updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS course_page_aliases(old_page_id TEXT PRIMARY KEY,course_code TEXT NOT NULL REFERENCES courses(code));
    CREATE VIEW IF NOT EXISTS effective_courses AS SELECT c.code,COALESCE(o.name,c.name) AS name,COALESCE(o.department,c.department) AS department,c.nature,c.category,c.credits,c.hours FROM courses c LEFT JOIN course_overrides o ON o.code=c.code;
    CREATE VIEW IF NOT EXISTS effective_groups AS SELECT g.id,g.course_code,g.course_name,COALESCE(o.teachers_raw,g.teachers_raw) AS teachers_raw,COALESCE(o.teachers_provided,g.teachers_provided) AS teachers_provided FROM teaching_groups g LEFT JOIN group_overrides o ON o.group_id=g.id;
    INSERT OR IGNORE INTO schema_migrations VALUES(6,strftime('%Y-%m-%dT%H:%M:%fZ','now'));`);
}
