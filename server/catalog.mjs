import {createHash} from 'node:crypto';
import {searchIndex,parseQuery,matchPage,courseCard,categoryStatus} from './search.mjs';
export class ApiError extends Error { constructor(status,message,code){super(message);this.status=status;if(code)this.code=code;} }
function integer(params,name,fallback,max){const s=params.get(name);if(s===null)return fallback;if(!/^\d+$/.test(s)||Number(s)<1||Number(s)>max)throw new ApiError(400,`${name} 参数无效`);return Number(s);}
export function metadata(db){
  const count=table=>db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
  const pages=searchIndex(db);
  return {counts:{courses:count('courses'),groups:count('teaching_groups'),offerings:count('offerings'),departments:db.prepare('SELECT COUNT(DISTINCT department) AS n FROM courses').get().n},pageCount:pages.length,
    departments:[...new Set(pages.map(p=>p.department))].sort().map(name=>({name,count:pages.filter(p=>p.department===name).length})),
    categories:db.prepare('SELECT category AS name,COUNT(*) AS count FROM courses GROUP BY category ORDER BY category').all(),
    commonCategories:categoryStatus(db,pages),
    semesters:db.prepare('SELECT id,label,captured_at AS capturedAt,source_url AS sourceUrl FROM semesters ORDER BY id DESC').all(),reviewSubmissionEnabled:true};
}
export function listCourses(db,params){
  const page=integer(params,'page',1,100000),pageSize=integer(params,'pageSize',24,100),query=(params.get('q')||'').trim();
  if(query.length>100)throw new ApiError(400,'搜索词不能超过 100 字');
  const tokens=parseQuery(query),index=searchIndex(db),topic=params.get('topic'),statuses=categoryStatus(db,index);
  if(topic&&!statuses.some(c=>c.id===topic))throw new ApiError(400,'常用课程分类无效');
  const sort=params.get('sort')||'relevance';if(!['relevance','code','teachers','rating','reviews','name','credits'].includes(sort))throw new ApiError(400,'排序参数无效');
  let codes=null;
  if(params.has('codes')){codes=params.get('codes').split(',').filter(Boolean);if(codes.length>2500||codes.some(c=>c.length>60))throw new ApiError(400,'收藏参数无效');}
  const results=[];
  for(const p of index){
    if(params.get('department')&&p.department!==params.get('department'))continue;
    if(topic&&!p.categoryIds.includes(topic))continue;
    // Legacy API compatibility; the new UI never sends these hidden filters.
    if(params.get('category')&&!p.members.some(c=>c.category===params.get('category')))continue;
    if(params.get('semester')&&!p.semesters.includes(params.get('semester')))continue;
    if(codes&&!codes.some(code=>code===p.id||p.members.some(c=>c.code===code)))continue;
    const match=matchPage(p,tokens);if(match)results.push({p,match});
  }
  results.sort((a,b)=>{
    if(sort==='teachers'){const delta=b.p.teacherCount-a.p.teacherCount;if(delta)return delta;}
    if(sort==='relevance'&&query&&(b.match.score!==a.match.score))return b.match.score-a.match.score;
    if(sort==='rating'){const delta=(b.p.rating??-1)-(a.p.rating??-1);if(delta)return delta;}
    if(sort==='reviews'){const delta=b.p.reviewCount-a.p.reviewCount;if(delta)return delta;}
    if(sort==='name')return a.p.name.localeCompare(b.p.name,'zh-CN')||a.p.id.localeCompare(b.p.id);
    if(sort==='credits'){const delta=(b.p.members[0].credits||0)-(a.p.members[0].credits||0);if(delta)return delta;}
    return a.p.members[0].code.localeCompare(b.p.members[0].code);
  });
  const status=statuses.find(c=>c.id===topic);
  let notice=null;
  if(status?.status==='pending')notice={kind:'pending',title:'此类课程的归类信息正在补充',message:'目前尚未完成学校分类对应关系的核对；这不代表该类别没有课程。可先用课程名称搜索。'};
  else if(status?.status==='not-collected')notice={kind:'not-collected',title:'本学期尚未收录这类公共课',message:status.id==='probability-statistics'?'当前目录为本学期快照。概率论与数理统计公共课的课程号和教师待取得其他学期记录后补充，专业版及英文版仍可通过搜索查找。':`当前目录为本学期开课快照，尚未收录“${status.name}”。课程号与任课教师待补录，未收录不代表学校没有这门课。`};
  const total=results.length;
  return {items:results.slice((page-1)*pageSize,page*pageSize).map(({p,match})=>courseCard(p,match)),total,page,pageSize,totalPages:Math.ceil(total/pageSize),notice,
    search:{query,terms:tokens.map(t=>t.expanded),expanded:tokens.filter(t=>t.input!==t.expanded).map(t=>`${t.input} → ${t.expanded}`),scope:'当前已收录课程，多个关键词同时匹配'}};
}
export function courseDetail(db,code){
  const index=searchIndex(db);let p=index.find(p=>p.id===code||p.members.some(c=>c.code===code));
  if(!p&&db.prepare("SELECT 1 FROM sqlite_master WHERE name='course_page_aliases'").get()){const alias=db.prepare('SELECT course_code FROM course_page_aliases WHERE old_page_id=?').get(code);if(alias)p=index.find(p=>p.members.some(c=>c.code===alias.course_code));}
  if(!p)throw new ApiError(404,'未找到这门课程');
  const sections=db.prepare(`SELECT o.section_no AS sectionNo,o.semester_id AS semester,s.label AS semesterLabel,o.source_page AS sourcePage,o.source_row AS sourceRow,o.captured_at AS capturedAt,s.source_url AS sourceUrl FROM offerings o JOIN semesters s ON s.id=o.semester_id WHERE o.group_id=? ORDER BY o.semester_id DESC,o.source_page,o.source_row`);
  const grouped=new Map();
  const stats=db.prepare("SELECT COUNT(*) AS n,COALESCE(SUM(rating),0) AS sum FROM reviews WHERE group_id=? AND status='published'");
  for(const g of p.groups){
    const c=p.members.find(c=>c.code===g.course_code);
    let row=grouped.get(g.teachers_raw);
    if(!row){row={id:p.isSeries?'teacher-'+createHash('sha256').update(p.id+g.teachers_raw).digest('hex').slice(0,24):g.id,sourceGroupIds:[],teacher:g.teachers_provided?g.teachers_raw:'教师信息未提供',teachersRaw:g.teachers_raw,teachersProvided:!!g.teachers_provided,sections:[],reviewCount:0,rating:null};grouped.set(g.teachers_raw,row);}
    row.sourceGroupIds.push(g.id);(row.sourceGroups??=[]).push({id:g.id,courseCode:c.code,courseName:c.name});row.sections.push(...sections.all(g.id).map(s=>({...s,courseCode:c.code,courseName:c.name,part:c.part})));
    const stat=stats.get(g.id);row.reviewCount+=stat.n;row.ratingSum=(row.ratingSum||0)+stat.sum;row.rating=row.reviewCount?row.ratingSum/row.reviewCount:null;
  }
  return {...courseCard(p),requestedCode:code,members:p.members.map(c=>({code:c.code,name:c.name,part:c.part,credits:c.credits,hours:c.hours,nature:c.nature})),
    missingParts:p.isSeries?['上','下'].filter(part=>!p.members.some(c=>c.part===part)):[],
    groups:[...grouped.values()].map(({ratingSum,...g})=>g).sort((a,b)=>Number(b.teachersProvided)-Number(a.teachersProvided)||a.teacher.localeCompare(b.teacher,'zh-CN')),reviewSubmissionEnabled:true};
}
