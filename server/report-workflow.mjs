// Accepted scope: shared report queue, explicit ownership, append-only private notes.
import {randomUUID} from 'node:crypto';
import {ApiError} from './catalog.mjs';
import {adminAccess} from './admin-members.mjs';
import {transaction,rateLimit} from './accounts.mjs';
import {notify} from './notifications.mjs';

export function migrateReportWorkflow(db){
  db.exec(`CREATE TABLE IF NOT EXISTS report_workflow(
    report_id TEXT PRIMARY KEY REFERENCES reports(id) ON DELETE CASCADE,
    assignee_id TEXT REFERENCES accounts(user_id) ON DELETE SET NULL,
    claimed_at TEXT,version INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS report_notes(
    id INTEGER PRIMARY KEY AUTOINCREMENT,report_id TEXT NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
    author_id TEXT REFERENCES accounts(user_id) ON DELETE SET NULL,body TEXT NOT NULL,created_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS idx_report_notes_report ON report_notes(report_id,id);`);
}
const joins=`LEFT JOIN report_workflow w ON w.report_id=p.id
  LEFT JOIN accounts a ON a.user_id=w.assignee_id
  LEFT JOIN admin_permissions ap ON ap.account_id=a.user_id
  LEFT JOIN site_owner so ON so.account_id=a.user_id`;
const effective="CASE WHEN a.role='admin' AND (so.account_id IS NOT NULL OR ap.content=1) THEN a.user_id END";
function audit(db,person,action,id,detail){db.prepare('INSERT INTO admin_audit VALUES(?,?,?,?,?,?)').run(randomUUID(),person.account.id,action,id,JSON.stringify(detail),new Date().toISOString());}
function report(db,id){
  const r=db.prepare(`SELECT p.*,${effective} AS assigneeId,COALESCE(w.version,0) AS version FROM reports p ${joins} WHERE p.id=?`).get(id);
  if(!r)throw new ApiError(404,'举报不存在');return r;
}
function checkVersion(r,data,required=false){
  if(required||data.version!==undefined){
    if(!Number.isSafeInteger(data.version)||data.version<0)throw new ApiError(400,'请刷新举报后重试');
    if(data.version!==r.version)throw new ApiError(409,'举报已被其他操作更新，请刷新后重试');
  }
}
function assign(db,id,assignee){db.prepare(`INSERT INTO report_workflow VALUES(?,?,?,1) ON CONFLICT(report_id)
  DO UPDATE SET assignee_id=excluded.assignee_id,claimed_at=excluded.claimed_at,version=report_workflow.version+1`).run(id,assignee,assignee?new Date().toISOString():null);}
export function reportSummary(db,person){
  return db.prepare(`SELECT COUNT(*) AS open,COALESCE(SUM(${effective} IS NULL),0) AS unassigned,
    COALESCE(SUM(${effective}=?),0) AS mine FROM reports p ${joins} WHERE p.status='open'`).get(person.account.id);
}
export function readReports(db,person,params){
  const status=params.get('status')||'open',assignment=params.get('assignment')||'all',raw=params.get('page')||'1';
  if(!['open','resolved','dismissed'].includes(status)||!['all','unassigned','mine'].includes(assignment)||!/^\d+$/.test(raw)||+raw<1||+raw>100000)throw new ApiError(400,'举报筛选无效');
  const args=[status];let where='p.status=?';
  if(assignment==='unassigned')where+=` AND ${effective} IS NULL`;
  if(assignment==='mine'){where+=` AND ${effective}=?`;args.push(person.account.id);}
  const total=db.prepare(`SELECT COUNT(*) n FROM reports p ${joins} WHERE ${where}`).get(...args).n;
  const items=db.prepare(`SELECT p.id,p.review_id AS reviewId,p.reason,p.status,p.resolution,p.created_at AS createdAt,
    r.content,r.status AS reviewStatus,c.name AS courseName,g.teachers_raw AS teacher,
    ${effective} AS assigneeId,CASE WHEN ${effective} IS NOT NULL THEN a.username END AS assigneeName,
    w.claimed_at AS claimedAt,COALESCE(w.version,0) AS version,
    (SELECT COUNT(*) FROM report_notes n WHERE n.report_id=p.id) AS noteCount
    FROM reports p ${joins} LEFT JOIN reviews r ON r.id=p.review_id LEFT JOIN effective_groups g ON g.id=r.group_id
    LEFT JOIN effective_courses c ON c.code=g.course_code WHERE ${where}
    ORDER BY p.created_at ASC,p.id ASC LIMIT 20 OFFSET ?`).all(...args,(+raw-1)*20);
  return {items,total,page:+raw,totalPages:Math.ceil(total/20),summary:reportSummary(db,person)};
}
export function readReportNotes(db,id,params){
  report(db,id);const raw=params.get('page')||'1';if(!/^\d+$/.test(raw)||+raw<1||+raw>100000)throw new ApiError(400,'页码无效');
  const total=db.prepare('SELECT COUNT(*) n FROM report_notes WHERE report_id=?').get(id).n;
  const items=db.prepare(`SELECT n.id,n.body,n.created_at AS createdAt,COALESCE(a.username,'已注销管理员') AS author
    FROM report_notes n LEFT JOIN accounts a ON a.user_id=n.author_id WHERE n.report_id=? ORDER BY n.id DESC LIMIT 20 OFFSET ?`).all(id,(+raw-1)*20);
  return {items,total,page:+raw,totalPages:Math.ceil(total/20)};
}
// Call inside the existing moderation transaction when an action came from a report.
export function guardReportReview(db,person,reportId,reviewId,version){
  const r=report(db,reportId);checkVersion(r,{version},true);
  if(r.review_id!==reviewId||r.status!=='open'||r.assigneeId!==person.account.id)throw new ApiError(409,'请先认领该举报，或刷新处理状态');
  db.prepare('UPDATE report_workflow SET version=version+1 WHERE report_id=?').run(reportId);
}
export function writeReport(db,person,id,operation,data){
  if(operation==='notes'){
    if(typeof data.body!=='string'||!data.body.trim()||data.body.trim().length>2000)throw new ApiError(400,'请填写内部备注（最多 2000 字）');
    rateLimit(db,`report-notes:${person.account.id}`,60,60000);
    return transaction(db,()=>{report(db,id);const result=db.prepare('INSERT INTO report_notes(report_id,author_id,body,created_at) VALUES(?,?,?,?)').run(id,person.account.id,data.body.trim(),new Date().toISOString());audit(db,person,'report.note',id,{noteId:Number(result.lastInsertRowid)});return {ok:true};});
  }
  return transaction(db,()=>{
    const r=report(db,id),me=person.account.id;
    if(['claim','release','takeover'].includes(operation)){
      checkVersion(r,data,true);if(r.status!=='open')throw new ApiError(409,'举报已处理，不能再认领');
      if(operation==='takeover'&&!adminAccess(db,me).isOwner)throw new ApiError(403,'仅站点负责人可以接管');
      if(operation==='release'&&r.assigneeId!==me&&!adminAccess(db,me).isOwner)throw new ApiError(403,'只能释放自己认领的举报');
      if(operation==='claim'&&r.assigneeId&&r.assigneeId!==me)throw new ApiError(409,'已有其他管理员认领，请刷新列表');
      if(operation==='claim'&&r.assigneeId===me)return {ok:true};
      assign(db,id,operation==='release'?null:me);audit(db,person,'report.'+operation,id,{previousAssignee:r.assigneeId});return {ok:true};
    }
    if(operation!=='resolve')throw new ApiError(404,'举报操作不存在');
    if(!['resolved','dismissed'].includes(data.status)||typeof data.resolution!=='string'||!data.resolution.trim()||data.resolution.trim().length>500)throw new ApiError(400,'请填写有效处理结果与说明（最多 500 字）');
    if(r.status!=='open'){
      if(r.status===data.status&&r.resolution===data.resolution.trim())return {ok:true,replayed:true};
      throw new ApiError(409,'举报已有处理结果，不能覆盖；请在内部备注中补充核查情况');
    }
    checkVersion(r,data);if(r.assigneeId&&r.assigneeId!==me)throw new ApiError(409,'该举报已由其他管理员认领，请先协调或由负责人接管');
    // Older clients may resolve an unassigned report; claim and resolution remain atomic.
    if(!r.assigneeId){assign(db,id,me);audit(db,person,'report.claim',id,{previousAssignee:null});}
    const resolution=data.resolution.trim();db.prepare('UPDATE reports SET status=?,resolution=?,updated_at=? WHERE id=?').run(data.status,resolution,new Date().toISOString(),id);
    db.prepare('UPDATE report_workflow SET version=version+1 WHERE report_id=?').run(id);
    audit(db,person,'report.'+data.status,id,{resolution});notify(db,r.reporter_id,'report.'+data.status,r.review_id,resolution);return {ok:true};
  });
}
