import {useEffect,useRef,useState} from 'react';
import {HelpfulButton} from './HelpfulButton.jsx';
import {Dropdown} from './CategorySelect.jsx';
import {ChatCircleText,Copy,Star,X} from '@phosphor-icons/react';
import {reviewDimensions} from '../shared/review-dimensions.mjs';
import {reviewContentIssue,reviewContentMessage} from '../shared/review-content.mjs';
import {ReviewRevisionStatus} from './ReviewRevision.jsx';
import {ReportButton} from './Account.jsx';

async function request(url,options={}){
  const timeout=AbortSignal.timeout(15000);
  const response=await fetch(url,{...options,signal:options.signal?AbortSignal.any([options.signal,timeout]):timeout});
  if(!response.headers.get('content-type')?.includes('application/json'))throw Error('评价服务暂时不可用，请稍后重试。');
  const data=await response.json();if(!response.ok)throw Error(data.error||'操作失败，请重试。');return data;
}
const errorText=e=>e.name==='TimeoutError'?'请求超时，请重试；重复提交不会产生两条评价。':e instanceof TypeError?'暂时无法连接评价服务，请重试。':e.message;
const date=s=>new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',year:'numeric',month:'numeric',day:'numeric'}).format(new Date(s));

export function Composer(props){
  const [identity,setIdentity]=useState(null),[error,setError]=useState(''),[retry,setRetry]=useState(0);
  useEffect(()=>{const c=new AbortController();setError('');request('/api/session',{signal:c.signal}).then(setIdentity).catch(e=>{if(!c.signal.aborted)setError(errorText(e));});return()=>c.abort();},[retry]);
  if(!identity)return <div className="review-feedback" role={error?'alert':'status'}>{error||'正在连接评价服务…'} {error&&<button onClick={()=>setRetry(v=>v+1)}>重试</button>} <button onClick={props.onClose}>取消</button></div>;
  return <ComposerForm {...props} identity={identity}/>;
}
function ComposerForm({detail,teacher,review,onClose,onSuccess,identity}){
  const dialog=useRef(null),busy=useRef(false);
  const revision=!!review?.moderationReason;
  const initialReview=revision&&review.revision?.status!=='approved'?{...review,...review.revision?.proposed}:review;
  const draftKey=`nnu:review-draft:${identity.account?.id||'guest'}:${detail.code}:${revision?'revision-'+(review.revision?.id||0)+':':''}${review?.id||'new'}`;
  const [form,setForm]=useState(()=>{
    const initial={groupId:review?.groupId||(detail.groups.find(g=>g.id===teacher)?.sourceGroups.length===1?detail.groups.find(g=>g.id===teacher).sourceGroups[0].id:''),semesterId:review?.semesterId||'',rating:initialReview?.rating||0,content:initialReview?.content||'',note:revision?(review.revision?.note||''):'',...Object.fromEntries(reviewDimensions.map(({key})=>[key,initialReview?.[key]??null]))};
    try{const d=JSON.parse(sessionStorage.getItem(draftKey));if(d&&typeof d.content==='string')return {...initial,...d,...(review?{groupId:review.groupId,semesterId:review.semesterId}:{})};}catch{/* Draft storage is optional. */}return initial;
  });
  const [teacherId,setTeacherId]=useState(()=>detail.groups.find(g=>g.sourceGroupIds.includes(form.groupId))?.id||(teacher==='all'?'':teacher));
  const [pending,setPending]=useState(false),[error,setError]=useState('');
  useEffect(()=>{const d=dialog.current;d.showModal();const cancel=e=>{e.preventDefault();if(!busy.current)onClose();};d.addEventListener('cancel',cancel);return()=>{d.removeEventListener('cancel',cancel);d.close();};},[onClose]);

  useEffect(()=>{try{sessionStorage.setItem(draftKey,JSON.stringify(form));}catch{/* Publishing remains available without draft storage. */}},[draftKey,form]);
  const options=detail.groups.find(g=>g.id===teacherId)?.sourceGroups||[];
  function change(key,value){setForm(f=>({...f,[key]:value}));setError('');}
  async function submit(e){
    e.preventDefault();if(!identity||busy.current)return;
    const issue=reviewContentIssue(form.content);
    if(issue&&!(revision&&form.content.trim()===review.content)){setError(reviewContentMessage(issue));return;}
    busy.current=true;setPending(true);setError('');
    try{
      await request(revision?`/api/reviews/${review.id}/revision`:review?`/api/reviews/${review.id}`:'/api/reviews',{method:revision?'POST':review?'PUT':'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':identity.csrf},body:JSON.stringify({...form,courseId:detail.code})});
      try{sessionStorage.removeItem(draftKey);}catch{/* Optional storage. */}
      onSuccess({revision});
    }catch(e){setError(errorText(e));}finally{busy.current=false;setPending(false);}
  }
  return <dialog ref={dialog} className="review-dialog" aria-labelledby="write-review-title"><div className="dialog-head"><div><h2 id="write-review-title">{revision?'修改与申请复核':review?'修改评价':'写评价'}</h2><p>{detail.name}</p></div><button className="icon-button" aria-label="关闭评价窗口" disabled={pending} onClick={onClose}><X size={22}/></button></div>
    <form onSubmit={submit} className="review-form">
      {revision&&<p className="review-form-note">提交后仍保持下架，管理员复核通过后才会公开。若认为原文没有问题，可以保留正文，在下方说明理由；你主动撤回的评价不会自动公开。</p>}
      <fieldset disabled={pending}><legend className="sr-only">评价内容</legend>
        <div className="review-form-grid"><label>授课教师<Dropdown aria-label="授课教师" required disabled={!!review} value={teacherId} onChange={e=>{const id=e.target.value;setTeacherId(id);const choices=detail.groups.find(g=>g.id===id)?.sourceGroups||[];change('groupId',choices.length===1?choices[0].id:'');}}><option value="">请选择教师</option>{detail.groups.filter(g=>g.teachersProvided).map(g=><option key={g.id} value={g.id}>{g.teacher}</option>)}</Dropdown></label>
        <label>修读学期（选填）<Dropdown aria-label="修读学期" disabled={!!review||!identity} value={form.semesterId||''} onChange={e=>change('semesterId',e.target.value)}><option value="">不填写学期</option>{review?.semesterId&&!identity?.terms.some(t=>t.id===review.semesterId)&&<option value={review.semesterId}>{review.semesterLabel}</option>}{identity?.terms.map(t=><option key={t.id} value={t.id}>{t.label}</option>)}</Dropdown></label></div>
        {options.length>1?<label>修读课程<Dropdown aria-label="修读课程" required disabled={!!review} value={form.groupId} onChange={e=>change('groupId',e.target.value)}><option value="">请选择分册 / 原始课程</option>{options.map(g=><option key={g.id} value={g.id}>{g.courseName} · {g.courseCode}</option>)}</Dropdown></label>:options.length===1&&detail.isSeries&&<p className="review-form-note">修读课程：{options[0].courseName}</p>}
        <fieldset className="rating-input"><legend>总体评分</legend><div>{[1,2,3,4,5].map(n=><label key={n} className={form.rating===n?'selected':''}><input required type="radio" name="rating" value={n} checked={form.rating===n} onChange={()=>change('rating',n)}/><Star size={17} weight={form.rating===n?'fill':'regular'} aria-hidden="true"/>{n} 分</label>)}</div><p>1 分不推荐 · 3 分一般 · 5 分很推荐</p></fieldset>
        <fieldset className="review-dimension-inputs"><legend>其他维度 <span>必填</span></legend><div>{reviewDimensions.map(({key,label,options})=><label key={key}>{label}<Dropdown required aria-label={label} value={form[key]??''} onChange={e=>change(key,e.target.value===''?null:Number(e.target.value))}><option value="" disabled hidden>请选择</option>{options.map((option,i)=><option key={option} value={i+1}>{option}</option>)}</Dropdown></label>)}</div></fieldset>
        <label>修读体验<textarea aria-label="修读体验" required maxLength={3000} rows={6} value={form.content} onChange={e=>change('content',e.target.value)} placeholder="分享你亲身经历的教学、作业与考核体验，帮助后来同学判断是否适合自己。"/><span className="review-character-count">{form.content.trim().length} / 3000 字</span></label>
        {revision&&<label>复核说明（未修改评价时必填）<textarea aria-label="复核说明" rows={3} maxLength={1000} value={form.note} onChange={e=>change('note',e.target.value)} placeholder="说明修改了哪些地方，或为什么希望重新核查。请不要填写无关个人信息。"/></label>}
      </fieldset>

      {identity&&!identity.account&&<p className="inline-error">发布评价需要登录。<a href={`/login?next=${encodeURIComponent(location.pathname+location.search)}`}>登录</a>或<a href={`/register?next=${encodeURIComponent(location.pathname+location.search)}`}>注册</a>，填写内容会保留在此标签页。</p>}
      {identity?.account&&!identity.account.emailVerified&&<p className="inline-error">发布或修改评价需要验证校园邮箱。<a href={`/account?next=${encodeURIComponent(location.pathname+location.search)}`}>前往验证</a>，填写内容会保留在此标签页。</p>}

      {error&&<p className="inline-error" role="alert">{error}</p>}
      <div className="review-form-actions"><button type="button" className="secondary-button" disabled={pending} onClick={onClose}>{revision?'暂不提交':'暂不发布'}</button><button className="review-primary" type="submit" disabled={pending||!identity?.account?.emailVerified}>{pending?(revision?'正在提交…':'正在发布…'):!identity?'连接中…':!identity.account?'请先登录':!identity.account.emailVerified?'请先验证邮箱':revision?'提交复核':review?'保存并发布':'发布评价'}</button></div>
    </form></dialog>;
}

export function Reviews({detail,group,teacherOptions,onGroupChange,copyLink,shareFallback,onChanged}){
  const [feed,setFeed]=useState(null),[page,setPage]=useState(1),[retry,setRetry]=useState(0),[loading,setLoading]=useState(true),[error,setError]=useState('');
  const [composer,setComposer]=useState(null),[confirmId,setConfirmId]=useState(''),[pendingId,setPendingId]=useState(''),[message,setMessage]=useState('');
  const [deleteConfirmId,setDeleteConfirmId]=useState('');
  const [sort,setSort]=useState('latest'),[semester,setSemester]=useState('all');
  const close=useRef(()=>setComposer(null)).current;
  useEffect(()=>{const c=new AbortController();setLoading(true);setError('');request(`/api/courses/${encodeURIComponent(detail.code)}/reviews?${new URLSearchParams({teacher:group,page:String(page),sort,semester})}`,{signal:c.signal}).then(data=>{if(c.signal.aborted)return;if(page>1&&page>data.totalPages){setPage(Math.max(1,data.totalPages));return;}setFeed(data);}).catch(e=>{if(!c.signal.aborted)setError(errorText(e));}).finally(()=>{if(!c.signal.aborted)setLoading(false);});return()=>c.abort();},[detail.code,group,page,retry,sort,semester]);
  useEffect(()=>{const refresh=()=>{if(document.visibilityState==='visible')setRetry(v=>v+1);};window.addEventListener('focus',refresh);return()=>window.removeEventListener('focus',refresh);},[]);
  function refresh(message){setMessage(message);setPage(1);setRetry(v=>v+1);Promise.resolve(onChanged()).catch(()=>setMessage(`${message}，课程统计刷新失败，请刷新页面重试。`));}
  async function withdraw(id){if(pendingId)return;setPendingId(id);setError('');try{const identity=await request('/api/session');await request(`/api/reviews/${id}`,{method:'DELETE',headers:{'X-CSRF-Token':identity.csrf}});setConfirmId('');refresh('评价已撤回，仅自己可见。');}catch(e){setError(errorText(e));}finally{setPendingId('');}}
  async function remove(id){if(pendingId)return;setPendingId(id);setError('');try{const identity=await request('/api/session');await request(`/api/reviews/${id}/permanent`,{method:'DELETE',headers:{'X-CSRF-Token':identity.csrf}});try{for(const key of Object.keys(sessionStorage))if(key.startsWith('nnu:review-draft:')&&key.endsWith(':'+id))sessionStorage.removeItem(key);}catch{/* Optional draft storage. */}setDeleteConfirmId('');setFeed(f=>f?{...f,items:f.items.filter(r=>r.id!==id)}:f);refresh('评价已删除。');}catch(e){setError(errorText(e));}finally{setPendingId('');}}
  const scope=group==='all'?detail:detail.groups.find(g=>g.id===group)||detail;
  return <section className="reviews-focus" aria-labelledby="reviews-heading">
    <div className="review-heading"><h2 id="reviews-heading">同学评价 <span className="zero-count">{scope.reviewCount}</span>{scope.rating!==null&&<span className="review-average">{scope.rating.toFixed(1)} 分</span>}</h2><div className="review-heading-actions"><button className="copy-link" aria-label="复制课程链接" onClick={copyLink}><Copy size={16}/>复制链接</button><button className="review-primary" onClick={()=>{setMessage('');setComposer({review:null});}} disabled={!detail.groups.some(g=>g.teachersProvided)}>写评价</button></div></div>
    <div className="review-filters"><label>教师<Dropdown aria-label="查看授课教师" value={group} onChange={e=>{setFeed(null);setPage(1);setConfirmId('');setDeleteConfirmId('');onGroupChange(e.target.value);}}><option value="all">全部教师</option>{teacherOptions.map(g=><option key={g.id} value={g.id}>{g.teacher}{g.reviewCount?` · ${g.rating.toFixed(1)} 分 · ${g.reviewCount} 条`:''}</option>)}</Dropdown></label><label>修读学期<Dropdown aria-label="筛选修读学期" value={semester} onChange={e=>{setSemester(e.target.value);setPage(1);}}><option value="all">全部学期</option>{feed?.terms?.map(t=><option key={t.id} value={t.id}>{t.label}</option>)}<option value="none">未填写学期</option></Dropdown></label><label>排序<Dropdown aria-label="评价排序" value={sort} onChange={e=>{setSort(e.target.value);setPage(1);}}><option value="latest">最新</option><option value="helpful">最有帮助</option></Dropdown></label></div>
    {semester!=='all'&&!loading&&!error&&feed&&<p className="review-filter-summary" role="status">当前学期筛选：{feed.total} 条评价 · 上方评分为该教师范围内全部学期的汇总</p>}
    {shareFallback&&<div className="share-fallback" role="status"><label>请复制课程链接<input aria-label="课程分享链接" readOnly value={shareFallback} onFocus={e=>e.target.select()}/></label></div>}
    {message&&<p className="review-feedback" role="status">{message}</p>}
    {error&&<div className="inline-error" role="alert">{error} <button onClick={()=>setRetry(v=>v+1)}>重新加载</button></div>}
    {loading?<p className="review-loading" role="status">正在加载评价…</p>:!error&&feed?.items.length===0?<div className="review-empty compact-review-empty" role="status"><ChatCircleText size={23}/><div><h3>{semester!=='all'?'该学期暂无评价':group==='all'?'暂无评价':'这位教师暂无评价'}</h3><p>{detail.groups.some(g=>g.teachersProvided)?'写下你的修读体验，供后来同学参考。':'教师资料待补录后开放评价。'}</p></div></div>:<div className="review-feed" aria-busy={loading}>{feed?.items.map(r=><article className={`student-review ${r.status==='hidden'?'withdrawn':''}`} key={r.id}>
      <div className="student-review-heading"><span>{r.author}{r.isMine&&<small>我的评价</small>}{r.status==='hidden'&&<small>已撤回，仅自己可见</small>}{r.status==='pending'&&<small>已下架</small>}</span><strong aria-label={`评分 ${r.rating} 分`}><Star size={14} weight="fill"/>{r.rating} 分</strong></div>
      <p className="student-review-scope">{r.teacher}{r.semesterLabel&&<> · {r.semesterLabel}</>}{detail.isSeries&&<> · {r.courseName}</>}</p>
      {reviewDimensions.some(({key})=>r[key]!=null)&&<div className="student-review-dimensions">{reviewDimensions.filter(({key})=>r[key]!=null).map(({key,label,options})=><span key={key}>{label} <b>{options[r[key]-1]}</b></span>)}</div>}
      <p className="student-review-content">{r.content}</p>{r.moderationReason&&<p className="inline-error">下架原因：{r.moderationReason}</p>}
      {r.isMine&&<ReviewRevisionStatus review={r} onChanged={()=>refresh('复核状态已更新。')}/>}
      <div className="student-review-footer"><span>{date(r.createdAt)}{r.updatedAt!==r.createdAt&&' · 已编辑'}</span><div className="student-review-actions">{r.status==='published'&&<HelpfulButton review={r}/>}{r.isMine&&<div><button disabled={!!pendingId||r.revision?.status==='pending'} onClick={()=>setComposer({review:r})}>{r.moderationReason?'申请复核':r.status==='hidden'?'修改并重新发布':'修改'}</button>{r.status!=='hidden'&&<button disabled={!!pendingId} onClick={()=>{setDeleteConfirmId('');setConfirmId(r.id);}}>撤回</button>}{r.status==='hidden'&&<button className="review-delete-button" disabled={!!pendingId} onClick={()=>{setConfirmId('');setDeleteConfirmId(r.id);}}>删除</button>}</div>}{!r.isMine&&r.status==='published'&&<ReportButton reviewId={r.id}/>}</div></div>
      {confirmId===r.id&&<div className="withdraw-confirm"><span>撤回后，其他同学将看不到这条评价。</span><button disabled={!!pendingId} onClick={()=>withdraw(r.id)}>{pendingId===r.id?'撤回中…':'确认撤回'}</button><button disabled={!!pendingId} onClick={()=>setConfirmId('')}>取消</button></div>}
      {deleteConfirmId===r.id&&<div className="withdraw-confirm delete-confirm"><span>删除后无法恢复，确定删除这条评价？</span><button disabled={!!pendingId} onClick={()=>remove(r.id)}>{pendingId===r.id?'删除中…':'确认删除'}</button><button disabled={!!pendingId} onClick={()=>setDeleteConfirmId('')}>取消</button></div>}
    </article>)}</div>}
    {feed?.totalPages>1&&<nav className="review-pagination" aria-label="评价分页"><button disabled={page===1||loading} onClick={()=>setPage(p=>p-1)}>上一页</button><span>{page} / {feed.totalPages}</span><button disabled={page>=feed.totalPages||loading} onClick={()=>setPage(p=>p+1)}>下一页</button></nav>}
    {composer&&<Composer detail={detail} teacher={group} review={composer.review} onClose={close} onSuccess={({revision})=>{setComposer(null);refresh(revision?'已提交复核，处理结果会在站内通知中告知。':'评价已发布。');}}/>}
  </section>;
}
