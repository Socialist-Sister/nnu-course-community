import {ApiError} from './catalog.mjs';
import {requireAccount,transaction} from './accounts.mjs';

export function migrateNotifications(db){
  const schema=`CREATE TABLE IF NOT EXISTS notifications(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id TEXT NOT NULL REFERENCES accounts(user_id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK(kind IN('review.block','review.restore','report.resolved','report.dismissed','review.revision.approved','review.revision.rejected')),
    review_id TEXT REFERENCES reviews(id) ON DELETE SET NULL,
    course_code TEXT, course_name TEXT NOT NULL, reason TEXT NOT NULL,
    created_at TEXT NOT NULL, read_at TEXT);`;
  const old=db.prepare("SELECT sql FROM sqlite_master WHERE name='notifications'").get();
  if(old&&!old.sql.includes('review.revision.approved'))transaction(db,()=>{
    const seq=db.prepare("SELECT seq FROM sqlite_sequence WHERE name='notifications'").get()?.seq||0;
    db.exec('ALTER TABLE notifications RENAME TO notifications_previous');
    db.exec(schema);
    db.exec('INSERT INTO notifications SELECT * FROM notifications_previous; DROP TABLE notifications_previous;');
    db.prepare("UPDATE sqlite_sequence SET seq=MAX(seq,?) WHERE name='notifications'").run(seq);
    if(!db.prepare("SELECT 1 FROM sqlite_sequence WHERE name='notifications'").get())db.prepare('INSERT INTO sqlite_sequence VALUES(?,?)').run('notifications',seq);
  });
  else db.exec(schema);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_notifications_account ON notifications(account_id,id DESC);
    CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications(account_id) WHERE read_at IS NULL;`);
}

// Called within the moderation transaction: no actor, reporter or review body is copied.
export function notify(db,accountId,kind,reviewId,reason){
  if(!accountId||!db.prepare('SELECT 1 FROM accounts WHERE user_id=?').get(accountId))return;
  const course=db.prepare(`SELECT g.course_code,c.name FROM reviews r JOIN effective_groups g ON g.id=r.group_id
    JOIN effective_courses c ON c.code=g.course_code WHERE r.id=?`).get(reviewId);
  db.prepare(`INSERT INTO notifications(account_id,kind,review_id,course_code,course_name,reason,created_at)
    VALUES(?,?,?,?,?,?,?)`).run(accountId,kind,reviewId,course?.course_code??null,course?.name??'原评价已删除',reason,new Date().toISOString());
}
export function unreadNotifications(db,person){
  requireAccount(person);
  return {unread:db.prepare('SELECT COUNT(*) AS n FROM notifications WHERE account_id=? AND read_at IS NULL').get(person.account.id).n};
}
export function readNotifications(db,person,params){
  requireAccount(person);const page=Number(params.get('page')||1);
  if(!Number.isSafeInteger(page)||page<1||page>100000)throw new ApiError(400,'页码无效');
  const id=person.account.id;
  const total=db.prepare('SELECT COUNT(*) AS n FROM notifications WHERE account_id=?').get(id).n;
  const items=db.prepare(`SELECT id,kind,review_id AS reviewId,course_code AS courseCode,course_name AS courseName,
    reason,created_at AS createdAt,read_at AS readAt FROM notifications WHERE account_id=? ORDER BY id DESC LIMIT 20 OFFSET ?`).all(id,(page-1)*20);
  return {items,total,page,totalPages:Math.ceil(total/20),...unreadNotifications(db,person)};
}
export function markNotificationsRead(db,person,data){
  requireAccount(person);
  if(!Array.isArray(data.ids)||!data.ids.length||data.ids.length>100||data.ids.some(id=>!Number.isSafeInteger(id)||id<1))throw new ApiError(400,'通知编号无效');
  // Scope every write to the authenticated account; repeated reads are harmless.
  db.prepare(`UPDATE notifications SET read_at=? WHERE account_id=? AND read_at IS NULL AND id IN(${data.ids.map(()=>'?').join(',')})`)
    .run(new Date().toISOString(),person.account.id,...data.ids);
  return unreadNotifications(db,person);
}
