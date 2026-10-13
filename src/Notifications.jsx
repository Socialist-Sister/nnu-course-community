import {useEffect,useState} from 'react';
import {Bell,ArrowUpRight} from '@phosphor-icons/react';
import {communityApi,communityWrite} from './community-api.js';
import './notifications.css';

const changed=()=>window.dispatchEvent(new Event('nnu:notifications-changed'));
export function useUnreadNotifications(enabled){
  const [count,setCount]=useState(0);
  useEffect(()=>{
    if(!enabled){setCount(0);return;}
    let live=true,sequence=0;
    async function refresh(){
      if(document.hidden)return;const request=++sequence;
      try{const data=await communityApi('/api/notifications/unread');if(live&&request===sequence)setCount(data.unread);}
      catch(e){if(live&&request===sequence&&e.status===401)setCount(0);}
    }
    refresh();const timer=setInterval(refresh,60000);
    window.addEventListener('focus',refresh);window.addEventListener('nnu:notifications-changed',refresh);document.addEventListener('visibilitychange',refresh);
    return()=>{live=false;clearInterval(timer);window.removeEventListener('focus',refresh);window.removeEventListener('nnu:notifications-changed',refresh);document.removeEventListener('visibilitychange',refresh);};
  },[enabled]);
  return count;
}
const labels={'review.revision.approved':'你的评价复核已通过','review.revision.rejected':'你的评价复核未通过','review.block':'你的评价已下架','review.restore':'你的评价已解除下架','report.resolved':'你的举报已处理','report.dismissed':'你的举报已驳回'};
export function Notifications(){
  const [feed,setFeed]=useState(null),[page,setPage]=useState(1),[version,setVersion]=useState(0),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  useEffect(()=>{
    const refresh=()=>{if(!document.hidden)setVersion(v=>v+1);};
    const timer=setInterval(refresh,60000);window.addEventListener('focus',refresh);document.addEventListener('visibilitychange',refresh);
    return()=>{clearInterval(timer);window.removeEventListener('focus',refresh);document.removeEventListener('visibilitychange',refresh);};
  },[]);
  useEffect(()=>{
    const c=new AbortController();setError('');
    communityApi(`/api/notifications?page=${page}`,{signal:c.signal}).then(data=>{setFeed(data);changed();}).catch(e=>{if(!c.signal.aborted)setError(e.message);});
    return()=>c.abort();
  },[page,version]);
  async function read(ids,href){
    if(busy)return;setBusy(true);setError('');
    try{await communityWrite('/api/notifications/read',{ids});changed();if(href)location.assign(href);else setVersion(v=>v+1);}
    catch(e){setError(e.message);}finally{setBusy(false);}
  }
  return <section className="account-notifications" aria-labelledby="notifications-heading">
    <div className="notifications-heading"><div><h2 id="notifications-heading">通知</h2><span>{feed?`${feed.unread} 条未读`:'正在加载…'}</span></div><button className="account-secondary-button" disabled={busy||!feed?.items.some(n=>!n.readAt)} onClick={()=>read(feed.items.filter(n=>!n.readAt).map(n=>n.id))}>本页全部已读</button></div>
    <p className="notifications-intro">查看评价与举报的处理结果。仅记录此功能上线后的通知。</p>
    {error&&<p className="inline-error" role="alert">{error} <button onClick={()=>setVersion(v=>v+1)}>重试</button></p>}
    {!feed&&!error?<p role="status">正在加载通知…</p>:feed?.items.length===0?<div className="account-empty"><Bell size={30} aria-hidden="true"/><h3>暂无通知</h3><p>评价下架、解除下架、复核或举报处理后，会在这里提醒你。</p></div>:feed?.items.map(n=>{
      const own=n.kind.startsWith('review.');
      const href=own?(n.reviewId?`/account?review=${encodeURIComponent(n.reviewId)}`:null):(n.reviewId&&n.courseCode?`/courses?course=${encodeURIComponent(n.courseCode)}`:null);
      return <article key={n.id} className={`notification-row${n.readAt?'':' unread'}`}>
        <div className="notification-title"><h3>{labels[n.kind]}</h3><span className="notification-state">{n.readAt?'已读':'未读'}</span></div>
        <p className="notification-course">{n.courseName}</p><p className="notification-reason">处理说明：{n.reason}</p>
        {['review.restore','review.revision.approved'].includes(n.kind)&&<p className="notification-note">你主动撤回的评价仍保持撤回，不会自动公开。</p>}
        {!n.reviewId&&<p className="notification-note">原评价已删除，此通知保留处理记录。</p>}
        <div className="notification-footer"><time dateTime={n.createdAt}>{new Date(n.createdAt).toLocaleString('zh-CN')}</time><div>
          {!n.readAt&&<button disabled={busy} onClick={()=>read([n.id])}>标记已读</button>}
          {href&&<a href={href} onClick={e=>{e.preventDefault();read([n.id],href);}}>{own?'查看我的评价':'查看相关课程'}<ArrowUpRight size={14} aria-hidden="true"/></a>}
        </div></div>
      </article>;
    })}
    {feed?.totalPages>1&&<nav className="review-pagination" aria-label="通知分页"><button disabled={page<=1||busy} onClick={()=>{setFeed(null);setPage(p=>p-1);}}>上一页</button><span>{feed.page} / {feed.totalPages}</span><button disabled={page>=feed.totalPages||busy} onClick={()=>{setFeed(null);setPage(p=>p+1);}}>下一页</button></nav>}
  </section>;
}
