import { commonCategories, commonCourseCategory, normalized } from './taxonomy.mjs';
import {boyaMap} from './boya.mjs';
const cache=new WeakMap();
const aliases=new Map([['高数','高等数学'],['大物','大学物理'],['线代','线性代数'],['概率统计','概率论与数理统计'],['概率与统计','概率论与数理统计'],['英语','提高英语']]);
export function parseQuery(query) {
  const parts=query.normalize('NFKC').trim().split(/[\s+，,、]+/).filter(Boolean);
  return parts.map(input=>{
    let expanded=input;
    if(aliases.has(input))expanded=aliases.get(input);
    else for(const [short,full]of aliases)if(short!=='英语'&&expanded.startsWith(short)){expanded=full+expanded.slice(short.length);break;}
    expanded=expanded.replace(/^(高等数学|线性代数)([123一二三])/,(_,base,n)=>base+({'1':'I','2':'II','3':'III','一':'I','二':'II','三':'III'}[n]));
    if(expanded.endsWith('老师')&&expanded.length>2)expanded=expanded.slice(0,-2);
    return {input,expanded,value:normalized(expanded)};
  });
}
export function searchIndex(db) {
  const version=db.prepare('PRAGMA data_version').get().data_version+':'+db.prepare('SELECT total_changes() AS n').get().n;
  if(cache.get(db)?.version===version)return cache.get(db).value;
  const extended=!!db.prepare("SELECT 1 FROM sqlite_master WHERE name='effective_courses'").get();
  const rows=db.prepare(`SELECT c.*,m.page_id,m.part,p.name AS page_name,p.is_series FROM ${extended?'effective_courses':'courses'} c JOIN course_page_members m ON m.course_code=c.code JOIN course_pages p ON p.id=m.page_id ORDER BY c.code`).all();
  const teachers=new Map();for(const g of db.prepare(`SELECT id,course_code,teachers_raw,teachers_provided FROM ${extended?'effective_groups':'teaching_groups'}`).all()) {if(!teachers.has(g.course_code))teachers.set(g.course_code,[]);teachers.get(g.course_code).push(g);}
  const overrides=new Map((extended?db.prepare('SELECT code,category_ids FROM course_overrides WHERE category_ids IS NOT NULL').all():[]).map(r=>[r.code,JSON.parse(r.category_ids)]));
  const tags=new Map();for(const t of db.prepare('SELECT course_code,category_id FROM liberal_classifications').all()){if(!tags.has(t.course_code))tags.set(t.course_code,[]);tags.get(t.course_code).push(t.category_id);}
  const terms=new Map();for(const s of db.prepare('SELECT course_code,semester_id FROM course_snapshots').all()){if(!terms.has(s.course_code))terms.set(s.course_code,[]);terms.get(s.course_code).push(s.semester_id);}
  const pages=new Map(),boya=boyaMap(db);
  for(const c of rows) {
    let p=pages.get(c.page_id);
    if(!p){p={id:c.page_id,code:c.page_id,name:c.page_name,department:c.department,isSeries:!!c.is_series,members:[],groups:[],categoryIds:new Set(),semesters:new Set()};pages.set(p.id,p);}
    p.members.push({...c});p.groups.push(...(teachers.get(c.code)||[]));
    if(boya.has(c.code))p.boya=boya.get(c.code);
    if(overrides.has(c.code)){for(const t of overrides.get(c.code))p.categoryIds.add(t);}else{const topic=commonCourseCategory(c);if(topic)p.categoryIds.add(topic);for(const t of tags.get(c.code)||[])p.categoryIds.add(t);}for(const s of terms.get(c.code)||[])p.semesters.add(s);
  }
  for(const p of pages.values()) {
    // Count named teachers once across sections, co-teaching groups and series parts.
    p.teacherCount=new Set(p.groups.filter(g=>g.teachers_provided).flatMap(g=>g.teachers_raw.replace(/[（(][^）)]*[）)]/g,'').split(/[,，、;；\n]+/)).map(normalized).filter(Boolean)).size;
    p.search={names:[p.name,...p.members.map(c=>c.name)].map(normalized),codes:p.members.map(c=>normalized(c.code)),teachers:[...new Set(p.groups.filter(g=>g.teachers_provided).map(g=>g.teachers_raw))].map(s=>({raw:s,text:normalized(s),name:normalized(s.replace(/[（(][^）)]*[）)]/g,''))})),department:normalized(p.department)};
    p.categoryIds=[...p.categoryIds];p.semesters=[...p.semesters];
  }
  const ratings=new Map(db.prepare(`SELECT m.page_id,COUNT(*) AS count,AVG(r.rating) AS rating FROM reviews r JOIN teaching_groups g ON g.id=r.group_id JOIN course_page_members m ON m.course_code=g.course_code WHERE r.status='published' GROUP BY m.page_id`).all().map(r=>[r.page_id,r]));
  for(const p of pages.values()){const stats=ratings.get(p.id);p.reviewCount=stats?.count||0;p.rating=stats?.rating??null;}
  const value=[...pages.values()];cache.set(db,{version,value});return value;
}
function tokenMatch(page, token) {
  const q=token.value,s=page.search;
  if(!q)return null;
  if(/^i{1,3}$/.test(q))return s.names.some(n=>n.match(/^(?:高等数学|线性代数|大学物理)(i{1,3})(?:上|下|$)/)?.[1]===q)?{score:550,type:'name',text:token.expanded}:null;
  const exact=s.codes.indexOf(q);if(exact>=0)return {score:1200,type:'code',text:page.members[exact].code};
  const prefix=s.codes.findIndex(c=>c.startsWith(q));if(prefix>=0)return {score:850,type:'code',text:page.members[prefix].code};
  if(s.names.includes(q))return {score:700,type:'name',text:token.expanded};
  if(s.names.some(n=>n.includes(q)&&(!/^(高等数学|线性代数)i+$/.test(q)||n.match(/^(?:高等数学|线性代数)(i+)(?:上|下|$)/)?.[1]===q.match(/i+$/)[0])))return {score:500,type:'name',text:token.expanded};
  // Upper/lower aliases locate the existing series page even when that half has not been collected.
  if(page.isSeries&&/[上下]$/.test(q)&&(normalized(page.name)===q.slice(0,-1)||/^(高等数学|大学物理)$/.test(q.slice(0,-1))&&normalized(page.name).startsWith(q.slice(0,-1))))return {score:450,type:'series',text:'同系列课程'};
  const teacher=s.teachers.find(t=>t.name===q)||s.teachers.find(t=>t.text.includes(q));
  if(teacher)return {score:teacher.name===q?650:350,type:'teacher',text:teacher.raw};
  if(s.department.includes(q))return {score:180,type:'department',text:page.department};
  return null;
}
export function matchPage(page,tokens) {
  if(!tokens.length)return {score:0,matches:[]};
  const matches=tokens.map(t=>tokenMatch(page,t));if(matches.some(m=>!m))return null;
  return {score:matches.reduce((sum,m)=>sum+m.score,0),matches};
}
export function categoryStatus(db,pages) {
  const captured=new Set(db.prepare('SELECT category_id FROM liberal_capture_status').all().map(r=>r.category_id));
  return commonCategories.map(c=>{
    const count=pages.filter(p=>p.categoryIds.includes(c.id)).length;
    return {...c,count,status:count?'ready':c.kind==='liberal'&&!captured.has(c.id)?'pending':'not-collected'};
  });
}
export function courseCard(p,match={matches:[]}) {
  const teacherRows=[...new Map(p.groups.map(g=>[g.teachers_raw,g])).values()];
  const matchedTeachers=match.matches.filter(m=>m.type==='teacher').map(m=>m.text);
  teacherRows.sort((a,b)=>Number(matchedTeachers.includes(b.teachers_raw))-Number(matchedTeachers.includes(a.teachers_raw))||b.teachers_provided-a.teachers_provided||a.teachers_raw.localeCompare(b.teachers_raw,'zh-CN'));
  const credits=[...new Set(p.members.map(c=>c.credits))],hours=[...new Set(p.members.map(c=>c.hours))];
  return {id:p.id,code:p.id,name:p.name,department:p.department,isSeries:p.isSeries,courseCodes:p.members.map(c=>c.code),memberNames:p.members.map(c=>c.name),
    credits:credits.length===1?credits[0]:null,hours:hours.length===1?hours[0]:null,category:p.members[0].category,nature:p.members[0].nature,boya:p.boya||null,
    teacherCount:p.teacherCount,groupCount:teacherRows.length,teachers:teacherRows.slice(0,3).map(g=>g.teachers_provided?g.teachers_raw:'教师信息未提供'),teachersRaw:teacherRows.map(g=>g.teachers_raw),
    reviewCount:p.reviewCount,rating:p.rating,matchReasons:[...new Map(match.matches.map(m=>[m.type+':'+m.text,m])).values()].map(({type,text})=>({type,text}))};
}
