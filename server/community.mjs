import {checkAdminAccess,readAdminMembers,writeAdminMember} from './admin-members.mjs';
import {randomUUID,timingSafeEqual} from 'node:crypto';
import {ApiError,courseDetail,listCourses} from './catalog.mjs';
import {ownedIds,requireAccount,requireAdmin,transaction,digest,rateLimit} from './accounts.mjs';
import {commonCategories,syncCoursePages} from './taxonomy.mjs';
const now=()=>new Date().toISOString();
const slots=ids=>ids.map(()=>'?').join(',');
function text(value,label,max=500){if(typeof value!=='string'||!value.trim()||value.trim().length>max)throw new ApiError(400,`请填写${label}（最多 ${max} 字）`);return value.trim();}
function page(params){const value=params.get('page')||'1';if(!/^\d+$/.test(value)||+value<1||+value>100000)throw new ApiError(400,'页码无效');return +value;}
function audit(db,person,action,target,detail){db.prepare('INSERT INTO admin_audit VALUES(?,?,?,?,?,?)').run(randomUUID(),person.account.id,action,target,JSON.stringify(detail),now());}
export function myReviews(db,person,params){
  requireAccount(person);const ids=ownedIds(db,person),p=page(params),status=params.get('status')||'all';
  if(!['all','published','hidden','pending'].includes(status))throw new ApiError(400,'评价状态无效');
  const where=`r.user_id IN(${slots(ids)})${status==='all'?'':' AND r.status=?'}`,args=status==='all'?ids:[...ids,status];
  const total=db.prepare(`SELECT COUNT(*) AS n FROM reviews r WHERE ${where}`).get(...args).n;
  const items=db.prepare(`SELECT r.*,g.course_code,pm.page_id,c.name AS course_name,g.teachers_raw,t.label AS semester_label,m.reason AS moderation_reason,m.blocked,
    d.difficulty,d.workload,d.grading,d.gain FROM reviews r JOIN effective_groups g ON g.id=r.group_id JOIN effective_courses c ON c.code=g.course_code
    JOIN course_page_members pm ON pm.course_code=g.course_code LEFT JOIN review_terms t ON t.id=r.semester_id LEFT JOIN review_dimensions d ON d.review_id=r.id LEFT JOIN review_moderation m ON m.review_id=r.id
    WHERE ${where} ORDER BY r.created_at DESC,r.id DESC LIMIT 20 OFFSET ?`).all(...args,(p-1)*20).map(r=>({id:r.id,groupId:r.group_id,courseId:r.page_id,courseName:r.course_name,teacher:r.teachers_raw,
      semesterId:r.semester_id,semesterLabel:r.semester_label,rating:r.rating,content:r.content,status:r.status,createdAt:r.created_at,updatedAt:r.updated_at,
      difficulty:r.difficulty,workload:r.workload,grading:r.grading,gain:r.gain,moderationReason:r.blocked?r.moderation_reason:null}));
  return {items,total,page:p,totalPages:Math.ceil(total/20)};
}
export function reportReview(db,person,id,data){
  requireAccount(person);const r=db.prepare("SELECT * FROM reviews WHERE id=? AND status='published'").get(id);
  if(!r)throw new ApiError(404,'该评价已不可见');if(ownedIds(db,person).includes(r.user_id))throw new ApiError(400,'自己的评价可以直接修改或撤回');
  const reason=text(data.reason,'举报原因');
  const existing=db.prepare('SELECT id FROM reports WHERE review_id=? AND reporter_id=?').get(id,person.account.id);if(existing)return {id:existing.id,replayed:true};
  rateLimit(db,`reports:${person.account.id}`,10,3600000);
  const reportId=randomUUID(),time=now();db.prepare('INSERT INTO reports VALUES(?,?,?,?,?,?,?,?)').run(reportId,id,person.account.id,reason,'open','',time,time);return {id:reportId};
}
export function adminRead(db,person,path,params){
  requireAdmin(person);checkAdminAccess(db,person,path);
  if(path==='members')return readAdminMembers(db,params);
  if(path==='overview')return {openReports:db.prepare("SELECT COUNT(*) AS n FROM reports WHERE status='open'").get().n,accounts:db.prepare('SELECT COUNT(*) AS n FROM accounts').get().n,published:db.prepare("SELECT COUNT(*) AS n FROM reviews WHERE status='published'").get().n};
  const p=page(params),offset=(p-1)*20;
  if(path==='reports'){
    const status=params.get('status')||'open';if(!['open','resolved','dismissed'].includes(status))throw new ApiError(400,'举报状态无效');
    const total=db.prepare('SELECT COUNT(*) AS n FROM reports WHERE status=?').get(status).n;
    const items=db.prepare(`SELECT p.id,p.review_id AS reviewId,p.reason,p.status,p.resolution,p.created_at AS createdAt,r.content,r.status AS reviewStatus,c.name AS courseName,g.teachers_raw AS teacher
      FROM reports p LEFT JOIN reviews r ON r.id=p.review_id LEFT JOIN effective_groups g ON g.id=r.group_id LEFT JOIN effective_courses c ON c.code=g.course_code WHERE p.status=? ORDER BY p.created_at DESC,p.id DESC LIMIT 20 OFFSET ?`).all(status,offset);
    return {items,total,page:p,totalPages:Math.ceil(total/20)};
  }
  if(path==='reviews'){
    const q=(params.get('q')||'').trim();if(q.length>100)throw new ApiError(400,'搜索词过长');
    const status=params.get('status')||'all';if(!['all','published','hidden','pending'].includes(status))throw new ApiError(400,'评价状态无效');
    const where="(instr(r.content,?)>0 OR instr(c.name,?)>0 OR instr(g.course_code,?)>0)"+(status==='all'?'':' AND r.status=?'),args=[q,q,q,...(status==='all'?[]:[status])];
    const from='FROM reviews r JOIN effective_groups g ON g.id=r.group_id JOIN effective_courses c ON c.code=g.course_code';
    const total=db.prepare(`SELECT COUNT(*) AS n ${from} WHERE ${where}`).get(...args).n;
    const items=db.prepare(`SELECT r.id,r.content,r.rating,r.status,r.created_at AS createdAt,c.name AS courseName,g.teachers_raw AS teacher,m.blocked,m.reason ${from} LEFT JOIN review_moderation m ON m.review_id=r.id WHERE ${where} ORDER BY r.created_at DESC,r.id DESC LIMIT 20 OFFSET ?`).all(...args,offset);
    return {items,total,page:p,totalPages:Math.ceil(total/20)};
  }
  if(path==='courses'){
    const q=params.get('q')||'';if(q.length>100)throw new ApiError(400,'搜索词过长');
    const where='instr(c.code,?)>0 OR instr(c.name,?)>0 OR instr(c.department,?)>0';
    const total=db.prepare(`SELECT COUNT(*) AS n FROM effective_courses c WHERE ${where}`).get(q,q,q).n;
    return {items:db.prepare(`SELECT c.code,c.name,c.department FROM effective_courses c WHERE ${where} ORDER BY c.code LIMIT 20 OFFSET ?`).all(q,q,q,offset),total,page:p,totalPages:Math.ceil(total/20)};
  }
  if(path.startsWith('courses/')){
    const code=decodeURIComponent(path.slice(8)),c=db.prepare('SELECT * FROM effective_courses WHERE code=?').get(code);if(!c)throw new ApiError(404,'课程不存在');
    const override=db.prepare('SELECT * FROM course_overrides WHERE code=?').get(code);
    return {course:c,original:db.prepare('SELECT * FROM courses WHERE code=?').get(code),override:override?{...override,categoryIds:override.category_ids===null?null:JSON.parse(override.category_ids)}:null,
      groups:db.prepare('SELECT e.*,g.teachers_raw AS originalTeacher FROM effective_groups e JOIN teaching_groups g ON g.id=e.id WHERE e.course_code=?').all(code),categories:commonCategories,detail:courseDetail(db,code)};
  }
  if(path==='audit'){
    const total=db.prepare('SELECT COUNT(*) AS n FROM admin_audit').get().n;
    return {items:db.prepare("SELECT l.id,COALESCE(a.username,'已注销账号') AS actor,l.action,l.target,l.detail,l.created_at AS createdAt FROM admin_audit l LEFT JOIN accounts a ON a.user_id=l.actor_id ORDER BY l.created_at DESC,l.id DESC LIMIT 20 OFFSET ?").all(offset),total,page:p,totalPages:Math.ceil(total/20)};
  }
  throw new ApiError(404,'后台页面不存在');
}
export function adminWrite(db,person,path,data){
  if(path==='members')return writeAdminMember(db,person,data);
  if(path==='setup'){
    requireAccount(person);rateLimit(db,`setup:${person.userId}`,5);
    const row=db.prepare('SELECT token_hash FROM admin_setup WHERE id=1').get();
    if(db.prepare("SELECT 1 FROM accounts WHERE role='admin'").get())throw new ApiError(409,'管理员已设置');
    if(!row||typeof data.code!=='string'||!timingSafeEqual(Buffer.from(digest(data.code.trim()),'hex'),Buffer.from(row.token_hash,'hex')))throw new ApiError(403,'管理初始化码不正确');
    transaction(db,()=>{db.prepare("UPDATE accounts SET role='admin' WHERE user_id=?").run(person.userId);db.prepare('INSERT INTO site_owner VALUES(1,?)').run(person.userId);db.exec('DELETE FROM admin_setup');audit(db,person,'admin.setup',person.userId,{});});return {ok:true};
  }
  requireAdmin(person);checkAdminAccess(db,person,path);
  if(path.startsWith('reviews/')){
    const id=path.slice(8),r=db.prepare('SELECT * FROM reviews WHERE id=?').get(id);if(!r)throw new ApiError(404,'评价不存在');
    if(!['block','restore'].includes(data.action))throw new ApiError(400,'管理操作无效');const reason=text(data.reason,'处理说明');
    transaction(db,()=>{
      db.prepare('INSERT INTO review_moderation VALUES(?,?,?,?) ON CONFLICT(review_id) DO UPDATE SET blocked=excluded.blocked,reason=excluded.reason,updated_at=excluded.updated_at').run(id,Number(data.action==='block'),reason,now());
      if(data.action==='block')db.prepare("UPDATE reviews SET status='pending' WHERE id=? AND status='published'").run(id);
      else db.prepare("UPDATE reviews SET status='published' WHERE id=? AND status='pending'").run(id);
      audit(db,person,'review.'+data.action,id,{reason,previousStatus:r.status});
    });return {ok:true};
  }
  if(path.startsWith('reports/')){
    const id=path.slice(8);if(!db.prepare('SELECT 1 FROM reports WHERE id=?').get(id))throw new ApiError(404,'举报不存在');
    if(!['resolved','dismissed'].includes(data.status))throw new ApiError(400,'处理结果无效');const resolution=text(data.resolution,'处理说明');
    transaction(db,()=>{db.prepare('UPDATE reports SET status=?,resolution=?,updated_at=? WHERE id=?').run(data.status,resolution,now(),id);audit(db,person,'report.'+data.status,id,{resolution});});return {ok:true};
  }
  if(path.startsWith('courses/')){
    const code=decodeURIComponent(path.slice(8)),original=db.prepare('SELECT * FROM courses WHERE code=?').get(code);if(!original)throw new ApiError(404,'课程不存在');
    if(data.reset===true){
      transaction(db,()=>{db.prepare('DELETE FROM course_overrides WHERE code=?').run(code);db.prepare('DELETE FROM group_overrides WHERE group_id IN(SELECT id FROM teaching_groups WHERE course_code=?)').run(code);syncCoursePages(db);audit(db,person,'course.reset',code,{});});return {ok:true};
    }
    const name=text(data.name,'课程名',150),department=text(data.department,'开课单位',100),reason=text(data.reason,'修订依据');
    if(!['auto','separate'].includes(data.seriesMode))throw new ApiError(400,'归并方式无效');
    if(data.categoryIds!==null&&(!Array.isArray(data.categoryIds)||data.categoryIds.length>16||data.categoryIds.some(id=>!commonCategories.some(c=>c.id===id))))throw new ApiError(400,'分类无效');
    if(!Array.isArray(data.groups)||data.groups.length>100)throw new ApiError(400,'教师资料无效');
    const groups=data.groups.map(g=>{
      if(!db.prepare('SELECT 1 FROM teaching_groups WHERE id=? AND course_code=?').get(g.id,code))throw new ApiError(400,'授课组合不属于该课程');
      if(typeof g.teacher!=='string'||g.teacher.trim().length>300)throw new ApiError(400,'教师姓名最多 300 字');return {id:g.id,teacher:g.teacher.trim()};
    });
    const before=adminRead(db,person,path,new URLSearchParams());
    transaction(db,()=>{
      db.prepare('INSERT INTO course_overrides VALUES(?,?,?,?,?,?) ON CONFLICT(code) DO UPDATE SET name=excluded.name,department=excluded.department,category_ids=excluded.category_ids,series_mode=excluded.series_mode,updated_at=excluded.updated_at').run(code,name,department,data.categoryIds===null?null:JSON.stringify([...new Set(data.categoryIds)]),data.seriesMode,now());
      for(const g of groups)db.prepare('INSERT INTO group_overrides VALUES(?,?,?,?) ON CONFLICT(group_id) DO UPDATE SET teachers_raw=excluded.teachers_raw,teachers_provided=excluded.teachers_provided,updated_at=excluded.updated_at').run(g.id,g.teacher,Number(!!g.teacher),now());
      syncCoursePages(db);audit(db,person,'course.update',code,{reason,before:{course:before.course,override:before.override,groups:before.groups},after:{name,department,categoryIds:data.categoryIds,seriesMode:data.seriesMode,groups}});
    });return {ok:true};
  }
  throw new ApiError(404,'后台操作不存在');
}
