import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowUpRight, BookmarkSimple, Books, CaretDown, CaretLeft, CaretRight, CheckCircle, MagnifyingGlass, SlidersHorizontal, Users, X } from '@phosphor-icons/react';

import {Home} from './Home.jsx';
import {useBookmarks,setBookmark,refreshBookmarks} from './bookmarks.js';
import {CourseBadges,BoyaSource} from './CourseBadges.jsx';
import {CategorySelect} from './CategorySelect.jsx';
import {Reviews} from './Reviews.jsx';
import {AccountLink} from './Account.jsx';
import {SiteHeader,AboutDialog as Dialog} from './SiteHeader.jsx';
import {DEFAULTS,readNavigation,sameFilters,navigationUrl,courseShareUrl} from './navigation.mjs';
const reasonLabels={code:'课程编号',name:'课程名称',teacher:'授课教师',department:'开课单位',series:'系列关联'};
const number = n => (n ?? 0).toLocaleString('zh-CN');
const date = s => s ? new Intl.DateTimeFormat('zh-CN', {timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(s)) : '—';
const fromUrl=()=>readNavigation(location.href);
async function api(url, signal) {
  const controller=new AbortController(), abort=()=>controller.abort();
  signal?.addEventListener('abort',abort,{once:true});const timer=setTimeout(abort,15000);
  try {
    const res=await fetch(url,{signal:controller.signal});
    if(!res.headers.get('content-type')?.includes('application/json'))throw Error('课程服务尚未连接，请检查后端是否运行。');
    const body=await res.json();if(!res.ok)throw Error(body.error||'课程加载失败，请重试。');return body;
  }catch(e){if(e.name==='AbortError'&&!signal?.aborted)throw Error('请求超时，请重试。');if(e instanceof TypeError)throw Error('暂时无法连接课程服务，请稍后重试。');throw e;}
  finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
}
function Select({label,value,onChange,children,title}) {
  return <CategorySelect {...{label,value,onChange,children,title}}/>;
}
function Highlight({text,terms=[]}) {
  const value=String(text), needles=[...new Set(terms.filter(t=>t.length>0))].sort((a,b)=>b.length-a.length);
  if(!needles.length)return value;
  const pattern=new RegExp('('+needles.map(t=>t.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('|')+')','gi');
  return value.split(pattern).map((part,i)=>i%2?<mark key={i}>{part}</mark>:part);
}
function Notice({title,children,retry}) {
  return <div className="empty-state" role={retry?'alert':undefined}><Books size={34}/><h3>{title}</h3><p>{children}</p>{retry&&<button className="secondary-button" onClick={retry}>重新加载</button>}</div>;
}
export function App() {
  const initial=useRef(fromUrl()).current;
  const [isHome,setIsHome]=useState(initial.isHome);
  const [sidebarCollapsed,setSidebarCollapsed]=useState(false);
  useEffect(()=>{document.title=isHome?'南师选课簿 · 首页':'南师选课簿 · 课程库';},[isHome]);
  const [filters,setFilters]=useState(initial.filters),[query,setQuery]=useState(initial.filters.q);
  const [selected,setSelected]=useState(initial.selected),[group,setGroup]=useState(initial.group);
  const [meta,setMeta]=useState(null),[metaError,setMetaError]=useState(''),[retry,setRetry]=useState(0);
  const [items,setItems]=useState([]),[total,setTotal]=useState(0),[page,setPage]=useState(1),[pages,setPages]=useState(0);
  const [listLoading,setListLoading]=useState(true),[listError,setListError]=useState(''),[notice,setNotice]=useState(null),[searchInfo,setSearchInfo]=useState(null);
  const [detail,setDetail]=useState(null),[detailLoading,setDetailLoading]=useState(false),[detailError,setDetailError]=useState('');
  const {codes:saved,loading:savedLoading,error:storageError}=useBookmarks();
  const [mobileDetail,setMobileDetail]=useState(initial.mobileDetail),[showFilters,setShowFilters]=useState(true),[about,setAbout]=useState(false),[toast,setToast]=useState(''),[shareFallback,setShareFallback]=useState(''),[listRetry,setListRetry]=useState(0);
  const keepSelection=useRef(!!initial.selected),listRef=useRef(null),detailRef=useRef(null),composing=useRef(false),searchRef=useRef(null);
  const selectedRef=useRef(selected);selectedRef.current=selected;
  const closeAbout=useCallback(()=>setAbout(false),[]);
  const listScroll=useRef(0),latestFilters=useRef(filters);latestFilters.current=filters;
  useEffect(()=>{if(composing.current||query===filters.q)return;const t=setTimeout(()=>{if(composing.current)return;setFilters(f=>f.q===query?f:{...f,q:query});setPage(1);},250);return()=>clearTimeout(t);},[query,filters.q]);
  useEffect(()=>{if(sidebarCollapsed||isHome||(mobileDetail&&window.matchMedia('(max-width:760px)').matches))return;const frame=requestAnimationFrame(()=>{listRef.current?.scrollTo({top:listScroll.current});});return()=>cancelAnimationFrame(frame);},[mobileDetail,isHome,sidebarCollapsed]);
  useEffect(()=>{const key=e=>{if(!isHome&&!document.querySelector('dialog[open]')&&e.key==='/'&&!['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName)&&!e.target.isContentEditable){e.preventDefault();setSidebarCollapsed(false);setMobileDetail(false);requestAnimationFrame(()=>searchRef.current?.focus());}};window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);},[isHome]);
  useEffect(()=>{const c=new AbortController();setMetaError('');api('/api/meta',c.signal).then(setMeta).catch(e=>{if(!c.signal.aborted)setMetaError(e.message);});return()=>c.abort();},[retry]);
  const savedKey=filters.view==='saved'?saved.join(','):'';
  useEffect(()=>{
    const c=new AbortController();setListLoading(true);setListError('');
    const p=new URLSearchParams({page:String(page),pageSize:'24'});
    for(const key of ['q','department','topic','sort'])if(filters[key])p.set(key,filters[key]);
    if(filters.view==='saved')p.set('codes',savedKey);
    api(`/api/courses?${p}`,c.signal).then(data=>{
      if(c.signal.aborted)return;
      setItems(old=>page===1?data.items:[...new Map([...old,...data.items].map(item=>[item.code,item])).values()]);setTotal(data.total);setPages(data.totalPages);
      setNotice(data.notice);setSearchInfo(data.search);
      if(page===1){listScroll.current=0;listRef.current?.scrollTo({top:0});if(!keepSelection.current){setSelected(data.items[0]?.code||'');setGroup('all');}keepSelection.current=false;}
    }).catch(e=>{if(!c.signal.aborted)setListError(e.message);}).finally(()=>{if(!c.signal.aborted)setListLoading(false);});
    return()=>c.abort();
  },[filters,page,savedKey,listRetry]);
  useEffect(()=>{
    setShareFallback('');
    if(!selected){setDetail(null);setDetailError('');setDetailLoading(false);return;}
    const c=new AbortController();setDetailLoading(true);setDetailError('');setDetail(null);
    api(`/api/courses/${encodeURIComponent(selected)}`,c.signal).then(data=>{if(c.signal.aborted)return;setDetail(data);setGroup(g=>g==='all'||data.groups.some(x=>x.id===g)?g:'all');if(data.code!==selected)setSelected(data.code);}).catch(e=>{if(!c.signal.aborted)setDetailError(e.message);}).finally(()=>{if(!c.signal.aborted)setDetailLoading(false);});
    detailRef.current?.scrollTo({top:0});return()=>c.abort();
  },[selected,retry]);
  useEffect(()=>{
    history.replaceState(history.state,'',isHome?'/':navigationUrl(location.href,filters,selected,group,mobileDetail));
  },[filters,selected,group,mobileDetail,isHome]);
  useEffect(()=>{const pop=()=>{const next=fromUrl();setIsHome(next.isHome);if(next.isHome)return;const same=sameFilters(latestFilters.current,next.filters);keepSelection.current=!same;setFilters(f=>sameFilters(f,next.filters)?f:next.filters);setQuery(next.filters.q);setSelected(next.selected);setGroup(next.group);if(!same)setPage(1);listScroll.current=same?(history.state?.listScroll??listScroll.current):0;setMobileDetail(next.mobileDetail);};window.addEventListener('popstate',pop);return()=>window.removeEventListener('popstate',pop);},[]);
  useEffect(()=>{if(!toast)return;const t=setTimeout(()=>setToast(''),3500);return()=>clearTimeout(t);},[toast]);
  function filter(k,v){keepSelection.current=k==='sort';setFilters(f=>({...f,[k]:v}));setPage(1);setMobileDetail(false);}
  function reset(view=filters.view){keepSelection.current=false;setQuery('');setFilters({...DEFAULTS,sort:filters.sort,view});setPage(1);setMobileDetail(false);}
  function navigate(view){setSidebarCollapsed(false);if(isHome){history.pushState({},'',navigationUrl(location.href,{...filters,view},selected,group,false));setIsHome(false);setMobileDetail(false);if(view!==filters.view)reset(view);return;}if(view!==filters.view){reset(view);return;}if(mobileDetail){history.pushState({listScroll:listScroll.current},'',navigationUrl(location.href,filters,selected,group,false));setMobileDetail(false);}}
  function goHome(){if(isHome)return;listScroll.current=listRef.current?.scrollTop||listScroll.current;history.replaceState({listScroll:listScroll.current},'',location.href);history.pushState({},'','/');setIsHome(true);}
  function openFromHome({q='',topic='',course='',teacher='all'}={}){
    setSidebarCollapsed(false);const next={...DEFAULTS,q,topic};
    history.pushState({},'',navigationUrl(location.href,next,course,teacher,!!course));
    keepSelection.current=!!course;setFilters(next);setQuery(q);setSelected(course);setGroup(teacher);setPage(1);setMobileDetail(!!course);setIsHome(false);
  }
  function collapseSidebar(){listScroll.current=listRef.current?.scrollTop||0;setSidebarCollapsed(true);requestAnimationFrame(()=>document.getElementById('expand-course-sidebar')?.focus({preventScroll:true}));}
  function expandSidebar(){setSidebarCollapsed(false);requestAnimationFrame(()=>document.getElementById('collapse-course-sidebar')?.focus({preventScroll:true}));}
  useEffect(()=>{const media=window.matchMedia('(max-width:760px)'),resize=()=>{if(media.matches)setSidebarCollapsed(false);};media.addEventListener('change',resize);return()=>media.removeEventListener('change',resize);},[]);
  function choose(code){listScroll.current=listRef.current?.scrollTop||0;history.replaceState({listScroll:listScroll.current},'',location.href);if(!mobileDetail||selected!==code)history.pushState({listScroll:listScroll.current},'',navigationUrl(location.href,filters,code,'all',true));setSelected(code);setGroup('all');setMobileDetail(true);requestAnimationFrame(()=>detailRef.current?.focus({preventScroll:true}));}
  async function bookmark(){
    const memberCodes=detail?.courseCodes||[];
    const alreadySaved=saved.includes(selected)||memberCodes.some(code=>saved.includes(code));
    try{await setBookmark(selected,!alreadySaved,memberCodes);if(filters.view==='saved'){keepSelection.current=false;setPage(1);}}catch{}
  }
  async function copyLink(){const url=courseShareUrl(location.href,selected,group);try{await navigator.clipboard.writeText(url);setShareFallback('');setToast('课程链接已复制');}catch{setShareFallback(url);}}
  async function reviewsChanged(){const code=selected;const updated=await api(`/api/courses/${encodeURIComponent(code)}`);if(selectedRef.current!==code)return;setDetail(updated);keepSelection.current=true;setPage(1);setListRetry(v=>v+1);}
  const matchedTeachers=items.find(c=>c.code===selected)?.matchReasons?.filter(m=>m.type==='teacher').map(m=>m.text)||[];
  const teacherOptions=detail?.groups.slice().sort((a,b)=>Number(matchedTeachers.includes(b.teachersRaw))-Number(matchedTeachers.includes(a.teachersRaw)))||[];
  const groups=teacherOptions.filter(g=>group==='all'||g.id===group);
  const currentTerm=meta?.semesters[0],activeFilters=!!(filters.q||filters.department||filters.topic),isSaved=saved.includes(selected)||detail?.courseCodes.some(code=>saved.includes(code));
  const filterCount=Number(!!filters.department)+Number(!!filters.topic);
  function searchEverywhere(){keepSelection.current=false;setFilters(f=>({...f,department:'',topic:'',view:'courses'}));setPage(1);setMobileDetail(false);}
  function submitSearch(){if(composing.current)return;keepSelection.current=false;setFilters(f=>f.q===query?f:{...f,q:query});setPage(1);setMobileDetail(false);}
  return <div className="app catalog-app"><a className="skip-link" href={isHome?'#home-content':'#course-detail'} onClick={e=>{if(isHome)return;e.preventDefault();setMobileDetail(true);requestAnimationFrame(()=>detailRef.current?.focus({preventScroll:true}));}}>{isHome?'跳转到主页内容':'跳转到课程详情'}</a>
    <SiteHeader active={isHome?'home':filters.view} onHome={goHome} onNavigate={navigate} onAbout={()=>setAbout(true)} savedCount={saved.length} accountEntry={<AccountLink/>}/>
    {isHome&&<Home meta={meta} metaError={metaError} onMetaRetry={()=>setRetry(v=>v+1)} onOpen={openFromHome}/>}
    <main hidden={isHome} className={`workspace ${mobileDetail?'show-detail':''} ${sidebarCollapsed?'sidebar-collapsed':''}`}>
      <div className="sidebar-rail"><button id="expand-course-sidebar" aria-label="展开左侧课程栏" title="展开左侧课程栏" aria-expanded={false} aria-controls="course-sidebar" onClick={expandSidebar}><CaretRight size={20}/><span>课程库</span>{(filterCount>0||filters.q)&&<span className="rail-filter-dot" aria-label="已有搜索或筛选条件"/>}</button></div>
      <aside className="course-sidebar" id="course-sidebar" aria-label="课程列表"><div className="search-area">
        <form className="search-box" role="search" onSubmit={e=>{e.preventDefault();submitSearch();}}><button type="submit" className="icon-button" aria-label="搜索"><MagnifyingGlass size={22}/></button><input ref={searchRef} aria-label="搜索课程或老师" aria-describedby="search-hint" title="支持简称；多个关键词用空格分隔，例如：高数 吴老师" maxLength={100} placeholder="课程号 / 课程名 / 教师姓名" value={query} onCompositionStart={()=>{composing.current=true;}} onCompositionEnd={e=>{const value=e.currentTarget.value;composing.current=false;setQuery(value);keepSelection.current=false;setFilters(f=>({...f,q:value}));setPage(1);}} onKeyDown={e=>{if(e.nativeEvent.isComposing)return;if(e.key==='Escape'){setQuery('');}if(e.key==='ArrowDown'){e.preventDefault();listRef.current?.querySelector('[data-testid="course-row"]')?.focus();}}} onChange={e=>{keepSelection.current=false;setQuery(e.target.value);}}/>{query&&<button type="button" className="icon-button" aria-label="清空搜索" onClick={()=>{setQuery('');searchRef.current?.focus();}}><X size={17}/></button>}<button type="button" className={`icon-button filter-toggle ${filterCount?'has-filters':''}`} title={filterCount?`已有 ${filterCount} 个筛选条件生效`:'展开或收起筛选'} aria-label="展开或收起筛选" aria-expanded={showFilters} onClick={()=>setShowFilters(v=>!v)}><SlidersHorizontal size={21}/>{filterCount>0&&<span className="filter-count" aria-label={`${filterCount} 个筛选条件生效`}>{filterCount}</span>}</button></form>
        <p className="sr-only" id="search-hint">支持课程号、简称和教师，多个关键词用空格分隔，例如高数 吴老师。</p>
        {showFilters&&<div className="filters"><Select label="开课单位" title={filters.department||'全部开课单位'} value={filters.department} onChange={v=>filter('department',v)}><option value="">全部开课单位</option>{meta?.departments.map(d=><option key={d.name} value={d.name}>{d.name} · {d.count}</option>)}</Select><Select label="常用课程" title={meta?.commonCategories?.find(c=>c.id===filters.topic)?.name||'全部课程'} value={filters.topic} onChange={v=>filter('topic',v)}><option value="">全部课程 · 常用分类</option><optgroup label="公共课">{meta?.commonCategories?.filter(c=>c.kind==='course').map(c=><option key={c.id} value={c.id}>{c.name}{c.status==='ready'?` · ${c.count}`:' · 待补录'}</option>)}</optgroup><optgroup label="思政课">{meta?.commonCategories?.filter(c=>c.kind==='civics').map(c=><option key={c.id} value={c.id}>{c.name}{c.status==='ready'?` · ${c.count}`:' · 待补录'}</option>)}</optgroup><optgroup label="博雅课">{meta?.commonCategories?.filter(c=>c.kind==='liberal').map(c=><option key={c.id} value={c.id}>{c.name}{c.status==='pending'?' · 待归类':` · ${c.count}`}</option>)}</optgroup></Select></div>}
        {metaError&&<p className="inline-error" role="alert">{metaError}<button onClick={()=>setRetry(v=>v+1)}>重试</button></p>}</div>
        {storageError&&<p role="alert" className="inline-error">{storageError} <button onClick={refreshBookmarks}>重试</button></p>}<div className="list-toolbar"><span className="result-count" role="status">{listLoading?'正在查找…':`${number(total)} 门${filters.view==='saved'?'收藏':'课程'}`}</span>{activeFilters&&<button className="reset-filters" onClick={()=>reset()}>重置</button>}<div title={filters.sort==='code'?'课程号从小到大':filters.sort==='teachers'?'授课老师从多到少，同一老师去重':filters.sort==='rating'?'高分优先，暂无评分排最后':'评价多的优先'}><Select label="课程排序" value={filters.sort} onChange={v=>filter('sort',v)}><option value="code">按课程号排序</option><option value="teachers">按授课老师数排序</option><option value="rating">按评分排序</option><option value="reviews">按评价数排序</option></Select></div><button className="sidebar-collapse" id="collapse-course-sidebar" aria-label="收起左侧课程栏" title="收起左侧课程栏" aria-expanded={true} aria-controls="course-sidebar" onClick={collapseSidebar}><CaretLeft size={16} aria-hidden="true"/><span>收起</span></button></div>
        {filters.q&&searchInfo?.expanded.length>0&&<p className="search-expansion">{searchInfo.expanded.join('；')}</p>}
        <div className="course-list" ref={listRef} onScroll={e=>{if(!mobileDetail&&!sidebarCollapsed&&!isHome)listScroll.current=e.currentTarget.scrollTop;}} aria-busy={listLoading} onKeyDown={e=>{if(!['ArrowDown','ArrowUp'].includes(e.key)||!e.target.matches('[data-testid="course-row"]'))return;const rows=[...listRef.current.querySelectorAll('[data-testid="course-row"]')],i=rows.indexOf(e.target),next=i+(e.key==='ArrowDown'?1:-1);e.preventDefault();if(next<0)searchRef.current?.focus();else rows[next]?.focus();}}>
          {listError&&page===1?<Notice title="暂时无法加载课程" retry={()=>setListRetry(v=>v+1)}>{listError}</Notice>:listLoading&&page===1?<div className="skeleton-list" aria-label="课程加载中">{[1,2,3,4].map(n=><div className="skeleton-card" key={n}><i/><i/><i/></div>)}</div>:<>
{items.map(c=><button key={c.code} data-testid="course-row" className={`course-row ${selected===c.code?'selected':''}`} aria-pressed={selected===c.code} onClick={()=>choose(c.code)}><div className="row-eyebrow"><span><Highlight text={c.courseCodes.join(' / ')} terms={searchInfo?.terms}/></span><span>{c.isSeries?'上下册系列':`${c.credits??'—'} 学分`}</span></div><div className="row-title"><Highlight text={c.name} terms={searchInfo?.terms}/>{(saved.includes(c.code)||c.courseCodes.some(code=>saved.includes(code)))&&<BookmarkSimple size={17} weight="fill"/>}</div><div className="row-meta"><span className="row-meta-text">{c.department}<span className="row-meta-separator">·</span>{c.category}</span><CourseBadges boya={c.boya}/></div><div className="row-teacher" title={c.teachers.join('、')}><Users size={15}/><span><Highlight text={c.teachers.join('、')} terms={searchInfo?.terms}/></span>{c.groupCount>3&&<small>等 {c.groupCount} 组</small>}</div>{filters.q&&<div className="match-reasons">{c.matchReasons?.slice(0,3).map((m,i)=><span key={i}>{reasonLabels[m.type]}：{m.text}</span>)}</div>}<div className="row-date"><span className="unrated">{c.reviewCount?`${c.rating.toFixed(1)} 分 · ${number(c.reviewCount)} 条评价`:'暂无评价'}</span><span>{filters.sort==='teachers'?`${c.teacherCount} 位授课老师`:`${c.groupCount} 个授课组合`}</span></div><CaretRight className="row-arrow" size={22}/></button>)}
            {!items.length&&!savedLoading&&!storageError&&<Notice title={notice?.title||(filters.view==='saved'&&!saved.length?'还没有收藏的课程':'没有找到匹配的课程')}>{notice?.message||(filters.view==='saved'&&!saved.length?'在课程详情点击收藏，感兴趣的课就会留在这里。':activeFilters?'试试简称、教师姓名，或清除筛选。当前仅收录本学期开课快照，未命中不代表课程不存在。':'当前范围没有已收录课程。')}<br/>{filters.q&&(filterCount>0||filters.view==='saved')?<button className="text-button" onClick={searchEverywhere}>保留关键词，在全部课程中搜索</button>:<button className="text-button" onClick={()=>reset(filters.view)}>{filters.view==='saved'?'清除条件，查看全部收藏':'清除条件，浏览全部课程'}</button>}{filters.view==='saved'&&!saved.length&&<><br/><button className="text-button" onClick={()=>reset('courses')}>去课程库逛逛</button></>}</Notice>}
            {listError&&page>1&&<div className="more-error" role="alert"><p>更多课程加载失败，已显示的课程仍可查看。</p><button className="text-button" onClick={()=>setListRetry(v=>v+1)}>重试加载</button></div>}{!listError&&page<pages&&<button className="load-more" disabled={listLoading} onClick={()=>setPage(v=>v+1)}>{listLoading?'加载中…':`加载更多 · 已显示 ${items.length} / ${number(total)}`}<CaretDown size={16}/></button>}{items.length>0&&page>=pages&&<p className="list-end">已显示全部 {number(total)} 门课程</p>}
          </>}
        </div>
      </aside>
      <section className="course-detail" id="course-detail" ref={detailRef} aria-label="课程详情" tabIndex={-1}>
        {detailLoading?<div className="detail-skeleton" role="status">正在加载课程详情…</div>:detailError?<Notice title="课程详情加载失败" retry={()=>setRetry(v=>v+1)}>{detailError}</Notice>:!detail?<Notice title="选择一门课程，慢慢了解">从课程库搜索课程或教师，查看课程信息和本学期授课情况。</Notice>:<>
          <div className="course-heading"><button className="mobile-detail-back" aria-label="返回课程列表" title="返回课程列表" onClick={()=>{navigate(filters.view);requestAnimationFrame(()=>{const row=listRef.current?.querySelector('[data-testid="course-row"][aria-pressed="true"]');(row||searchRef.current)?.focus({preventScroll:true});});}}><ArrowLeft size={22} aria-hidden="true"/></button><div><h1>{detail.name}</h1><p>{detail.department}<span>·</span>{detail.courseCodes.join(' / ')}</p><CourseBadges boya={detail.boya}/></div><button className={`save-course ${isSaved?'is-saved':''}`} aria-label={isSaved?'取消收藏课程':'收藏课程'} aria-pressed={isSaved} disabled={savedLoading} onClick={bookmark}><BookmarkSimple size={21} weight={isSaved?'fill':'regular'}/><span>{isSaved?'已收藏':'收藏'}</span></button></div>
          {storageError&&<p role="alert" className="inline-error">{storageError} <button onClick={refreshBookmarks}>重试</button></p>}<Reviews key={`reviews:${detail.code}`} detail={detail} group={group} teacherOptions={teacherOptions} onGroupChange={v=>{setGroup(v);setShareFallback('');}} copyLink={copyLink} shareFallback={shareFallback} onChanged={reviewsChanged}/>
          <details className="course-reference" key={detail.code}><summary><span>课程信息</span><span>课程号、分册与教学班 <CaretDown size={14}/></span></summary><div className="reference-content">
            {detail.isSeries&&<p className="reference-note">同一版本上下册共用此页；各分册的教师与开课记录分别保留。</p>}
            <BoyaSource boya={detail.boya}/><ul className="reference-members">{detail.members.map(c=><li key={c.code}><strong>{c.name}</strong><span>{c.code} · {c.credits??'—'} 学分 · {c.hours??'—'} 学时 · {c.nature}</span></li>)}</ul>
            {detail.missingParts.length>0&&<p className="reference-note">{detail.missingParts.join('、')}册资料待补录，教师信息仅对应已收录课程。</p>}
            <div className="reference-teachers">{groups.map(g=><details key={g.id}><summary><span>{g.teacher}</span><span>{g.sections.length} 个教学班 <CaretDown size={13}/></span></summary><div className="section-table"><table><thead><tr>{detail.isSeries&&<th>原始课程</th>}<th>课序号</th><th>学期</th><th>来源</th></tr></thead><tbody>{g.sections.map(s=><tr key={`${s.courseCode}:${s.semester}:${s.sectionNo}`}>{detail.isSeries&&<td>{s.courseName}<br/>{s.courseCode}</td>}<td>{s.sectionNo}</td><td>{s.semesterLabel}</td><td>第 {s.sourcePage} 页 · 第 {s.sourceRow} 行</td></tr>)}</tbody></table></div></details>)}</div>
            <p className="reference-source">学校目录采集于 {date(currentTerm?.capturedAt)} · <a href="https://xsxk.nnu.edu.cn/" target="_blank" rel="noreferrer">前往选课系统核对 <ArrowUpRight size={12}/></a></p>
          </div></details>
        </>}
      </section>
    </main>
    {about&&<Dialog onClose={closeAbout}/>}{toast&&<div className="toast" role="status"><CheckCircle size={20}/>{toast}<button aria-label="关闭提示" onClick={()=>setToast('')}><X size={16}/></button></div>}
  </div>;
}
