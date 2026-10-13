import {randomUUID} from 'node:crypto';
import {ApiError} from './catalog.mjs';
import {ownedIds,requireVerified,transaction,rateLimit} from './accounts.mjs';
import {checkAdminAccess} from './admin-members.mjs';
import {validateReviewChange} from './reviews.mjs';
import {reviewDimensions} from '../shared/review-dimensions.mjs';
import {notify} from './notifications.mjs';

export function migrateReviewRevisions(db){
  db.exec(`CREATE TABLE IF NOT EXISTS review_revisions(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    review_id TEXT NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
    account_id TEXT REFERENCES accounts(user_id) ON DELETE SET NULL,
    original TEXT NOT NULL, proposed TEXT NOT NULL, note TEXT NOT NULL,
    block_reason TEXT NOT NULL, moderation_at TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN('pending','approved','rejected','cancelled')),
    reason TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL,decided_at TEXT,
    actor_id TEXT REFERENCES accounts(user_id) ON DELETE SET NULL);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_revision_pending ON review_revisions(review_id) WHERE status='pending';
    CREATE INDEX IF NOT EXISTS idx_revision_queue ON review_revisions(status,id);
    CREATE INDEX IF NOT EXISTS idx_revision_review ON review_revisions(review_id,id DESC);`);
}
function snapshot(r,d){return {content:r.content,rating:r.rating,...Object.fromEntries(reviewDimensions.map(({key})=>[key,d?.[key]??null]))};}
function publicRevision(r){return r?{id:r.id,status:r.status,proposed:JSON.parse(r.proposed),note:r.note,reason:r.reason,createdAt:r.created_at,decidedAt:r.decided_at}:null;}
export function latestRevision(db,id){return publicRevision(db.prepare('SELECT * FROM review_revisions WHERE review_id=? ORDER BY id DESC LIMIT 1').get(id));}
export function submitRevision(db,person,id,data){
  requireVerified(person);
  return transaction(db,()=>saveRevision(db,person,id,data));
}
function saveRevision(db,person,id,data){
  const r=db.prepare('SELECT * FROM reviews WHERE id=?').get(id);
  if(!r||!ownedIds(db,person).includes(r.user_id))throw new ApiError(404,'未找到可复核的评价');
  const moderation=db.prepare('SELECT * FROM review_moderation WHERE review_id=? AND blocked=1').get(id);
  if(!moderation)throw new ApiError(409,'评价已不处于下架状态，请刷新后查看');
  const existing=db.prepare("SELECT * FROM review_revisions WHERE review_id=? AND status='pending'").get(id);
  const normalized={...data,semesterId:data.semesterId||null};
  if(r.group_id!==data.groupId||r.semester_id!==normalized.semesterId)throw new ApiError(400,'课程、教师和学期不能变更');
  const {content}=validateReviewChange(db,normalized,r,{appealUnchanged:true});
  const proposed={content,rating:data.rating};
  for(const {key,label} of reviewDimensions){if(!Number.isInteger(data[key])||data[key]<1||data[key]>5)throw new ApiError(400,`请选择${label}`);proposed[key]=data[key];}
  if(data.note!=null&&(typeof data.note!=='string'||data.note.trim().length>1000))throw new ApiError(400,'复核说明最多 1000 字');
  const note=(data.note||'').trim(),original=snapshot(r,db.prepare('SELECT * FROM review_dimensions WHERE review_id=?').get(id));
  if(!note&&JSON.stringify(original)===JSON.stringify(proposed))throw new ApiError(400,'未修改评价时，请说明申请复核的理由');
  if(existing){
    if(existing.proposed===JSON.stringify(proposed)&&existing.note===note)return {id:existing.id,status:'pending',replayed:true};
    throw new ApiError(409,'已有待处理的复核申请，请先撤回申请再修改');
  }
  rateLimit(db,`revision:${person.account.id}`,10,3600000);
  const result=db.prepare(`INSERT INTO review_revisions(review_id,account_id,original,proposed,note,block_reason,moderation_at,status,created_at) VALUES(?,?,?,?,?,?,?,'pending',?)`)
    .run(id,person.account.id,JSON.stringify(original),JSON.stringify(proposed),note,moderation.reason,moderation.updated_at,new Date().toISOString());
  return {id:Number(result.lastInsertRowid),status:'pending'};
}
export function cancelRevision(db,person,id,data){
  const r=db.prepare('SELECT user_id FROM reviews WHERE id=?').get(id);
  if(!r||!ownedIds(db,person).includes(r.user_id))throw new ApiError(404,'未找到可复核的评价');
  if(!Number.isSafeInteger(data.revisionId))throw new ApiError(400,'请刷新后重试');
  const result=db.prepare("UPDATE review_revisions SET status='cancelled',reason='作者撤回复核申请',decided_at=? WHERE id=? AND review_id=? AND status='pending'").run(new Date().toISOString(),data.revisionId,id);
  if(!result.changes)throw new ApiError(409,'申请已被处理，请刷新后查看');
  return {ok:true};
}
export function readRevisions(db,params){
  const status=params.get('status')||'pending',page=Number(params.get('page')||1);
  if(!['pending','approved','rejected','cancelled','all'].includes(status)||!Number.isSafeInteger(page)||page<1||page>100000)throw new ApiError(400,'筛选参数无效');
  const where=status==='all'?'1=1':'v.status=?',args=status==='all'?[]:[status];
  const total=db.prepare(`SELECT COUNT(*) n FROM review_revisions v WHERE ${where}`).get(...args).n;
  const rows=db.prepare(`SELECT v.*,c.name course_name,g.teachers_raw FROM review_revisions v JOIN reviews r ON r.id=v.review_id JOIN effective_groups g ON g.id=r.group_id JOIN effective_courses c ON c.code=g.course_code WHERE ${where} ORDER BY v.id ${status==='pending'?'ASC':'DESC'} LIMIT 20 OFFSET ?`).all(...args,(page-1)*20);
  return {items:rows.map(r=>({...publicRevision(r),reviewId:r.review_id,original:JSON.parse(r.original),blockReason:r.block_reason,courseName:r.course_name,teacher:r.teachers_raw})),total,page,totalPages:Math.ceil(total/20),pending:db.prepare("SELECT COUNT(*) n FROM review_revisions WHERE status='pending'").get().n};
}
export function decideRevision(db,person,id,data){
  checkAdminAccess(db,person,'revisions');
  if(!Number.isSafeInteger(id)||id<1)throw new ApiError(400,'复核编号无效');
  if(!['approve','reject'].includes(data.action)||typeof data.reason!=='string'||!data.reason.trim()||data.reason.trim().length>500)throw new ApiError(400,'请选择处理结果并填写说明（最多 500 字）');
  return transaction(db,()=>{
    const v=db.prepare('SELECT * FROM review_revisions WHERE id=?').get(id);
    if(!v)throw new ApiError(404,'复核申请不存在');
    const status=data.action==='approve'?'approved':'rejected',reason=data.reason.trim();
    if(v.status!=='pending'){
      if(v.status===status&&v.reason===reason&&v.actor_id===person.account.id)return {ok:true,replayed:true};
      throw new ApiError(409,'申请已被处理或撤回，请刷新后查看');
    }
    const m=db.prepare('SELECT * FROM review_moderation WHERE review_id=?').get(v.review_id);
    if(!m?.blocked||m.updated_at!==v.moderation_at)throw new ApiError(409,'评价的下架状态已变化，请重新核查');
    const time=new Date().toISOString();
    if(status==='approved'){
      const proposed=JSON.parse(v.proposed);
      db.prepare("UPDATE reviews SET content=?,rating=?,status=CASE WHEN status='hidden' THEN 'hidden' ELSE 'published' END,updated_at=? WHERE id=?").run(proposed.content,proposed.rating,time,v.review_id);
      db.prepare('INSERT INTO review_dimensions VALUES(?,?,?,?,?) ON CONFLICT(review_id) DO UPDATE SET difficulty=excluded.difficulty,workload=excluded.workload,grading=excluded.grading,gain=excluded.gain').run(v.review_id,...reviewDimensions.map(({key})=>proposed[key]));
      db.prepare('UPDATE review_moderation SET blocked=0,reason=?,updated_at=? WHERE review_id=?').run(reason,time,v.review_id);
    }
    db.prepare('UPDATE review_revisions SET status=?,reason=?,decided_at=?,actor_id=? WHERE id=?').run(status,reason,time,person.account.id,id);
    db.prepare('INSERT INTO admin_audit VALUES(?,?,?,?,?,?)').run(randomUUID(),person.account.id,'review.revision.'+status,v.review_id,JSON.stringify({revisionId:v.id,reason}),time);
    const owner=db.prepare('SELECT account_id FROM account_members WHERE user_id=(SELECT user_id FROM reviews WHERE id=?)').get(v.review_id)?.account_id;
    notify(db,owner,'review.revision.'+status,v.review_id,reason);
    return {ok:true};
  });
}
