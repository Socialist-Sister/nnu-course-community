export const DEFAULTS={q:'',department:'',topic:'',sort:'code',view:'courses'};
export function readNavigation(href){
  const url=new URL(href),p=url.searchParams;
  const filters=Object.fromEntries(Object.entries(DEFAULTS).map(([k,v])=>[k,p.get(k)||v]));
  if(!['code','teachers','rating','reviews'].includes(filters.sort))filters.sort='code';
  if(!['courses','saved'].includes(filters.view))filters.view='courses';
  const selected=p.get('course')||'';
  const isHome=url.pathname==='/'&&!['course','q','department','topic','sort','view','panel'].some(k=>p.has(k));
  return {filters,selected,group:p.get('teacher')||'all',mobileDetail:!!selected&&p.get('panel')!=='list',isHome};
}
export const sameFilters=(a,b)=>Object.keys(DEFAULTS).every(k=>a[k]===b[k]);
export function navigationUrl(href,filters,selected,group,mobileDetail){
  const url=new URL(href),p=new URLSearchParams();
  for(const [key,value]of Object.entries(filters))if(key in DEFAULTS&&value&&value!==DEFAULTS[key])p.set(key,value);
  if(selected){p.set('course',selected);if(!mobileDetail)p.set('panel','list');}
  if(selected&&group!=='all')p.set('teacher',group);
  return `/courses${p.size?'?'+p:''}`;
}
export function courseShareUrl(href,code,teacher='all'){
  const url=new URL(href);url.pathname='/courses';url.search='';url.hash='';url.searchParams.set('course',code);
  if(teacher!=='all')url.searchParams.set('teacher',teacher);
  return url.href;
}
