import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {ApiError,courseDetail} from './catalog.mjs';
import {studyTerms} from './review-schema.mjs';
import {reviewDimensions} from '../shared/review-dimensions.mjs';
import {currentPerson,ownedIds} from './accounts.mjs';
const dimensionValues=row=>Object.fromEntries(reviewDimensions.map(({key})=>[key,row?.[key]??null]));
function saveReview(db,id,dimensions,write){
  db.exec('BEGIN IMMEDIATE');
  try{
    write();
    db.prepare(`INSERT INTO review_dimensions VALUES(?,?,?,?,?) ON CONFLICT(review_id) DO UPDATE SET difficulty=excluded.difficulty,workload=excluded.workload,grading=excluded.grading,gain=excluded.gain`).run(id,...reviewDimensions.map(({key})=>dimensions[key]));
    db.exec('COMMIT');
  }catch(e){db.exec('ROLLBACK');throw e;}
}
const hash=s=>createHash('sha256').update(s).digest('hex');
export function visitor(db,req){
  return currentPerson(db,req);
}
export function session(db,req,res){
  let person=visitor(db,req);
  if(!person){
    const token=randomBytes(32).toString('hex'),userId=randomUUID(),csrf=randomBytes(24).toString('hex');
    db.exec('BEGIN IMMEDIATE');try{db.prepare('INSERT INTO users VALUES(?,?,?)').run(userId,'匿名同学',new Date().toISOString());db.prepare('INSERT INTO visitor_sessions VALUES(?,?,?,?)').run(hash(token),userId,csrf,Date.now()+365*86400000);db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}
    res.setHeader('Set-Cookie',`nnu_visitor=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=31536000${req.socket.encrypted||process.env.COOKIE_SECURE==='1'?'; Secure':''}`);person={userId,csrf};
  }
  return {csrf:person.csrf,identity:person.account?'account':'anonymous-visitor',account:person.account||null,adminSetupNeeded:!db.prepare("SELECT 1 FROM accounts WHERE role='admin'").get(),terms:studyTerms(db)};
}
export function authorizeWrite(db,req){
  const origin=req.headers.origin;
  if(origin&&origin!==`http://${req.headers.host}`&&origin!==`https://${req.headers.host}`)throw new ApiError(403,'请求来源不匹配');
  if(req.headers['sec-fetch-site']==='cross-site')throw new ApiError(403,'不允许跨站提交');
  const person=visitor(db,req);if(!person)throw new ApiError(401,'访客身份已失效，请重新打开评价窗口');
  if(req.headers['x-csrf-token']!==person.csrf)throw new ApiError(403,'请求校验失败，请重新打开评价窗口');
  return person;
}
export async function jsonBody(req,limit=20000){
  if(!/^application\/json(?:;|$)/i.test(req.headers['content-type']||''))throw new ApiError(415,'请使用 JSON 提交');
  let size=0;const chunks=[];for await(const chunk of req){size+=chunk.length;if(size>limit)throw new ApiError(413,'提交内容过长');chunks.push(chunk);}
  try{const data=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(!data||typeof data!=='object'||Array.isArray(data))throw Error();return data;}catch{throw new ApiError(400,'提交格式无效');}
}
function validate(db,data,original=null){
  if(!Number.isInteger(data.rating)||data.rating<1||data.rating>5)throw new ApiError(400,'请选择 1–5 分的评分');
  if(typeof data.content!=='string'||!data.content.trim())throw new ApiError(400,'请填写评价内容');
  if(data.content.trim().length>3000)throw new ApiError(400,'评价最多填写 3000 字');
  const detail=courseDetail(db,String(data.courseId||''));
  const group=detail.groups.find(g=>g.sourceGroupIds.includes(data.groupId));
  if(!group?.teachersProvided)throw new ApiError(400,'请选择这门课已收录的授课教师');
  if(data.semesterId!==null&&original?.semester_id!==data.semesterId&&!studyTerms(db).some(t=>t.id===data.semesterId))throw new ApiError(400,'请选择有效的修读学期');
  return {detail,content:data.content.trim()};
}
export function writeReview(db,person,data,id=null){
  data={...data,semesterId:data.semesterId==null||data.semesterId===''?null:data.semesterId};
  const owners=ownedIds(db,person),ownership=`user_id IN(${owners.map(()=>'?').join(',')})`;
  const old=id?db.prepare(`SELECT * FROM reviews WHERE id=? AND ${ownership}`).get(id,...owners):null;
  if(id&&!old)throw new ApiError(404,'未找到可修改的评价');
  if(id&&db.prepare('SELECT 1 FROM review_moderation WHERE review_id=? AND blocked=1').get(id))throw new ApiError(403,'评价已被管理员下架，请等待复核；你仍可撤回并删除');
  const {detail,content}=validate(db,data,old),now=new Date().toISOString();
  const dimensions={};
  for(const {key,label} of reviewDimensions){
    if(data[key]==null||data[key]==='')throw new ApiError(400,`请选择${label}`);
    if(!Number.isInteger(data[key])||data[key]<1||data[key]>5)throw new ApiError(400,`${label}选项无效`);
    dimensions[key]=data[key];
  }
  if(id){
    if(old.group_id!==data.groupId||old.semester_id!==data.semesterId)throw new ApiError(400,'修改评价时课程、教师和学期不能变更');
    saveReview(db,id,dimensions,()=>db.prepare("UPDATE reviews SET rating=?,content=?,status='published',updated_at=? WHERE id=?").run(data.rating,content,now,id));
    return {id,courseId:detail.code,status:'published'};
  }
  const existing=db.prepare(`SELECT * FROM reviews WHERE ${ownership} AND group_id=? AND semester_id IS ?`).get(...owners,data.groupId,data.semesterId);
  if(existing){
    const saved=dimensionValues(db.prepare('SELECT * FROM review_dimensions WHERE review_id=?').get(existing.id));
    if(existing.status==='published'&&existing.rating===data.rating&&existing.content===content&&reviewDimensions.every(({key})=>saved[key]===dimensions[key]))return {id:existing.id,courseId:detail.code,status:'published',replayed:true};
    throw new ApiError(409,data.semesterId===null?'你已为这门课的这位教师发布过未填学期的评价，请修改已有评价':'你已评价过这位教师在该学期的这门课，请修改已有评价');
  }
  const recent=db.prepare(`SELECT COUNT(*) AS n FROM reviews WHERE ${ownership} AND created_at>?`).get(...owners,new Date(Date.now()-60000).toISOString()).n;
  if(recent>=5)throw new ApiError(429,'提交较频繁，请稍后再试');
  const reviewId=randomUUID();saveReview(db,reviewId,dimensions,()=>db.prepare('INSERT INTO reviews VALUES(?,?,?,?,?,?,?,?,?,?)').run(reviewId,person.userId,data.groupId,data.semesterId,data.rating,content,1,'published',now,now));
  return {id:reviewId,courseId:detail.code,status:'published'};
}
export function withdrawReview(db,person,id){
  const review=db.prepare('SELECT user_id FROM reviews WHERE id=?').get(id);if(!review||!ownedIds(db,person).includes(review.user_id))throw new ApiError(404,'未找到可撤回的评价');
  db.prepare("UPDATE reviews SET status='hidden',updated_at=? WHERE id=?").run(new Date().toISOString(),id);return {id,status:'hidden'};
}
export function deleteReview(db,person,id){
  const review=db.prepare('SELECT status,user_id FROM reviews WHERE id=?').get(id);
  if(!review||!ownedIds(db,person).includes(review.user_id))throw new ApiError(404,'未找到可删除的评价');
  if(review.status!=='hidden')throw new ApiError(409,'请先撤回评价，再删除');
  db.prepare("DELETE FROM reviews WHERE id=? AND status='hidden'").run(id);
  return {id,status:'deleted'};
}
export function readReviews(db,req,code,params){
  const detail=courseDetail(db,code),person=visitor(db,req),teacher=params.get('teacher')||'all';
  const groups=teacher==='all'?detail.groups:detail.groups.filter(g=>g.id===teacher);if(!groups.length&&teacher!=='all')throw new ApiError(400,'教师筛选无效');
  const ids=groups.flatMap(g=>g.sourceGroupIds),pageText=params.get('page')||'1';if(!/^\d+$/.test(pageText)||Number(pageText)<1||Number(pageText)>100000)throw new ApiError(400,'页码无效');
  const page=Number(pageText),pageSize=20;
  if(!ids.length)return {items:[],page,total:0,totalPages:0};
  const owners=ownedIds(db,person);
  const where=`r.group_id IN (${ids.map(()=>'?').join(',')}) AND (r.status='published' OR r.user_id IN(${owners.map(()=>'?').join(',')}))`,args=[...ids,...owners];
  const total=db.prepare(`SELECT COUNT(*) AS n FROM reviews r WHERE ${where}`).get(...args).n;
  const rows=db.prepare(`SELECT r.*,ap.nickname AS author_nickname,d.difficulty,d.workload,d.grading,d.gain,g.course_code,g.teachers_raw,c.name AS course_name,t.label AS semester_label,m.blocked,m.reason AS moderation_reason FROM reviews r LEFT JOIN account_members am ON am.user_id=r.user_id LEFT JOIN account_profiles ap ON ap.user_id=am.account_id JOIN effective_groups g ON g.id=r.group_id JOIN effective_courses c ON c.code=g.course_code LEFT JOIN review_terms t ON t.id=r.semester_id LEFT JOIN review_dimensions d ON d.review_id=r.id LEFT JOIN review_moderation m ON m.review_id=r.id WHERE ${where} ORDER BY r.status!='published',r.created_at DESC,r.id DESC LIMIT ? OFFSET ?`).all(...args,pageSize,(page-1)*pageSize);
  return {items:rows.map(r=>({id:r.id,groupId:r.group_id,teacher:r.teachers_raw,courseCode:r.course_code,courseName:r.course_name,semesterId:r.semester_id,semesterLabel:r.semester_label,rating:r.rating,...dimensionValues(r),content:r.content,status:r.status,createdAt:r.created_at,updatedAt:r.updated_at,author:r.author_nickname||'已注销用户',isMine:owners.includes(r.user_id),moderationReason:owners.includes(r.user_id)&&r.blocked?r.moderation_reason:null})),page,total,totalPages:Math.ceil(total/pageSize)};
}
