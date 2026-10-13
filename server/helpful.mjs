import {ApiError} from './catalog.mjs';
import {requireVerified,ownedIds,transaction,rateLimit} from './accounts.mjs';

export function migrateHelpful(db){
  db.exec(`CREATE TABLE IF NOT EXISTS review_helpful(
    review_id TEXT NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
    account_id TEXT NOT NULL REFERENCES accounts(user_id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    PRIMARY KEY(review_id,account_id));
    CREATE INDEX IF NOT EXISTS idx_review_helpful_account ON review_helpful(account_id);`);
}

// Only counts and the requesting account's state are public; never return voter identities.
export function withHelpful(db,person,items){
  if(!items.length)return items;
  const rows=db.prepare(`SELECT review_id,COUNT(*) AS n,MAX(account_id=?) AS mine FROM review_helpful
    WHERE review_id IN (${items.map(()=>'?').join(',')}) GROUP BY review_id`)
    .all(person?.account?.id??'',...items.map(r=>r.id));
  const states=new Map(rows.map(r=>[r.review_id,r]));
  return items.map(r=>({...r,helpfulCount:states.get(r.id)?.n??0,helpful:!!states.get(r.id)?.mine}));
}

export function writeHelpful(db,person,id,data){
  requireVerified(person);
  if(typeof data.helpful!=='boolean')throw new ApiError(400,'点赞状态无效');
  rateLimit(db,`helpful:${person.account.id}`,60,60000);
  return transaction(db,()=>{
    const review=db.prepare(`SELECT r.user_id,r.status,COALESCE(m.blocked,0) AS blocked FROM reviews r
      LEFT JOIN review_moderation m ON m.review_id=r.id WHERE r.id=?`).get(id);
    if(!review||review.status!=='published'||review.blocked)throw new ApiError(404,'该评价已不可见');
    if(ownedIds(db,person).includes(review.user_id))throw new ApiError(400,'不能为自己的评价点赞');
    if(data.helpful)db.prepare('INSERT INTO review_helpful VALUES(?,?,?) ON CONFLICT(review_id,account_id) DO NOTHING').run(id,person.account.id,new Date().toISOString());
    else db.prepare('DELETE FROM review_helpful WHERE review_id=? AND account_id=?').run(id,person.account.id);
    return withHelpful(db,person,[{id}])[0];
  });
}
