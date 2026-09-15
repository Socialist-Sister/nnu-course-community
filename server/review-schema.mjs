// Review study terms are user-reported; they must never create catalog snapshots.
export function migrateReviews(db){
  db.exec(`CREATE TABLE IF NOT EXISTS review_terms(id TEXT PRIMARY KEY,label TEXT NOT NULL);
    INSERT OR IGNORE INTO review_terms SELECT id,label FROM semesters;
    CREATE TRIGGER IF NOT EXISTS review_terms_from_catalog AFTER INSERT ON semesters BEGIN INSERT OR IGNORE INTO review_terms VALUES(NEW.id,NEW.label); END;
    CREATE TABLE IF NOT EXISTS visitor_sessions(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),csrf TEXT NOT NULL,expires_at INTEGER NOT NULL);`);
  if(db.prepare('PRAGMA foreign_key_list(reviews)').all().some(f=>f.table==='semesters')||db.prepare('PRAGMA table_info(reviews)').all().some(c=>c.name==='semester_id'&&c.notnull)){
    db.exec('PRAGMA foreign_keys=OFF; BEGIN IMMEDIATE');
    try{
      db.exec(`CREATE TABLE reviews_next(
        id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),group_id TEXT NOT NULL REFERENCES teaching_groups(id),semester_id TEXT REFERENCES review_terms(id),
        rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),content TEXT NOT NULL,anonymous INTEGER NOT NULL DEFAULT 1 CHECK(anonymous IN(0,1)),
        status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN('pending','published','hidden')),created_at TEXT NOT NULL,updated_at TEXT NOT NULL,
        UNIQUE(user_id,group_id,semester_id));
        INSERT INTO reviews_next SELECT * FROM reviews;`);
      if(db.prepare('SELECT COUNT(*) AS n FROM reviews').get().n!==db.prepare('SELECT COUNT(*) AS n FROM reviews_next').get().n)throw Error('评价迁移数量不一致');
      db.exec('DROP TABLE reviews; ALTER TABLE reviews_next RENAME TO reviews; CREATE INDEX idx_reviews_group ON reviews(group_id,semester_id,status);');
      if(db.prepare('PRAGMA foreign_key_check').all().length)throw Error('评价迁移外键检查失败');
      db.exec('COMMIT');
    }catch(e){db.exec('ROLLBACK');throw e;}finally{db.exec('PRAGMA foreign_keys=ON');}
  }
  db.exec("INSERT OR IGNORE INTO schema_migrations VALUES(3,strftime('%Y-%m-%dT%H:%M:%fZ','now'))");
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_reviews_unspecified_term ON reviews(user_id,group_id) WHERE semester_id IS NULL; INSERT OR IGNORE INTO schema_migrations VALUES(4,strftime('%Y-%m-%dT%H:%M:%fZ','now'))");
  db.exec(`CREATE TABLE IF NOT EXISTS review_dimensions(
    review_id TEXT PRIMARY KEY REFERENCES reviews(id) ON DELETE CASCADE,
    difficulty INTEGER CHECK(difficulty BETWEEN 1 AND 5),
    workload INTEGER CHECK(workload BETWEEN 1 AND 5),
    grading INTEGER CHECK(grading BETWEEN 1 AND 5),
    gain INTEGER CHECK(gain BETWEEN 1 AND 5)
  ) STRICT;
  INSERT OR IGNORE INTO schema_migrations VALUES(5,strftime('%Y-%m-%dT%H:%M:%fZ','now'));`);
}
export function studyTerms(db,now=new Date()){
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en',{timeZone:'Asia/Shanghai',year:'numeric',month:'numeric'}).formatToParts(now).map(p=>[p.type,p.value]));
  const year=Number(parts.year),month=Number(parts.month),start=month>=9?year:year-1,term=month>=2&&month<=8?2:1;
  const items=[];for(let y=start;y>=start-7;y--)for(const n of [2,1]){if(y===start&&n>term)continue;items.push({id:`${y}-${y+1}-${n}`,label:`${y}–${y+1} 学年第 ${n} 学期`});}
  const insert=db.prepare('INSERT OR IGNORE INTO review_terms VALUES(?,?)');for(const t of items)insert.run(t.id,t.label);
  return items;
}
