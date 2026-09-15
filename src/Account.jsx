import {useEffect,useRef,useState} from 'react';
import {Dropdown} from './CategorySelect.jsx';
import {X,BookOpen,NotePencil,ShieldCheck,SignOut,ArrowUpRight,CheckCircle} from '@phosphor-icons/react';
import {communityApi,communityWrite} from './community-api.js';
import {EmailFields} from './EmailFields.jsx';
import {Composer} from './Reviews.jsx';
import {reviewDimensions} from '../shared/review-dimensions.mjs';
import {authHref,safeReturnPath} from '../shared/auth-navigation.mjs';
import './account.css';
import {SiteHeader} from './SiteHeader.jsx';
import {Avatar,prepareAvatar} from './Avatar.jsx';
export const statusName={published:'已发布',hidden:'已撤回',pending:'已下架 / 待复核'};
export function AccountLink(){const [session,setSession]=useState(null);useEffect(()=>{communityApi('/api/session').then(setSession).catch(()=>{});const update=e=>setSession(s=>s?.account?{...s,account:{...s.account,...e.detail}}:s);window.addEventListener('nnu:profile-updated',update);return()=>window.removeEventListener('nnu:profile-updated',update);},[]);const next=safeReturnPath(location.pathname+location.search,new URLSearchParams(location.search).get('next')||'/account');return <div className="account-entry" aria-label="账号入口">{session?.account?<a className="account-avatar-link" href="/account" aria-label="我的账号" title={session.account.nickname||'我的账号'}><Avatar src={session.account.avatarUrl}/></a>:<><a className="account-link auth-button" href={authHref('login',next)}>登录</a><a className="account-link auth-button auth-signup" href={authHref('register',next)}>注册</a></>}</div>;}
export function Modal({title,onClose,children}){
  const ref=useRef(null),saved=useRef(document.activeElement),closeRef=useRef(onClose);closeRef.current=onClose;
  useEffect(()=>{const d=ref.current;d.showModal();const cancel=e=>{e.preventDefault();closeRef.current();};d.addEventListener('cancel',cancel);return()=>{d.removeEventListener('cancel',cancel);d.close();saved.current?.focus?.();};},[]);
  return <dialog ref={ref} className="community-dialog" aria-label={title}><div className="dialog-head"><h2>{title}</h2><button aria-label="关闭窗口" className="icon-button" onClick={onClose}><X size={22}/></button></div><div className="community-dialog-body">{children}</div></dialog>;
}
export function CommunityFrame({title,children,auth=false,className=''}){return <div className={`community-page ${className}`}><SiteHeader accountEntry={<AccountLink/>}/><main className={`community-main${auth?' auth-main':''}`}><h1>{title}</h1>{children}</main></div>;}
export function RecoveryPanel({code,onDone}){return <section className="recovery-panel"><h2>请保存你的恢复码</h2><p>忘记密码时，凭用户名和恢复码重设密码。此码只在这里显示一次，请保存在你能找回的地方。</p><code>{code}</code><p>不要把恢复码发给他人；重置密码后旧码会失效。</p><button className="review-primary" onClick={onDone}>我已妥善保存</button></section>;}
export function Pager({feed,onPage}){return feed?.totalPages>1&&<nav className="review-pagination" aria-label="分页"><button disabled={feed.page<=1} onClick={()=>onPage(feed.page-1)}>上一页</button><span>{feed.page} / {feed.totalPages}</span><button disabled={feed.page>=feed.totalPages} onClick={()=>onPage(feed.page+1)}>下一页</button></nav>;}
export function ReportButton({reviewId}){
  const [open,setOpen]=useState(false),[reason,setReason]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false),[sent,setSent]=useState(false);
  async function submit(e){e.preventDefault();setBusy(true);setError('');try{await communityWrite(`/api/reviews/${reviewId}/report`,{reason});setSent(true);setOpen(false);}catch(e){setError(e.message);}finally{setBusy(false);}}
  return <><button disabled={sent} onClick={()=>setOpen(true)}>{sent?'已举报':'举报'}</button>{open&&<Modal title="举报评价" onClose={()=>{if(!busy)setOpen(false);}}><form className="community-form" onSubmit={submit}><p>请说明具体问题。举报原因仅供管理员处理，不会公开显示。</p><label>举报原因<textarea required maxLength={500} value={reason} onChange={e=>setReason(e.target.value)} placeholder="例如泄露个人信息、人身攻击、广告或明显无关内容"/></label>{error&&<p role="alert" className="inline-error">{error} <a href={authHref('login',location.pathname+location.search)}>登录账号</a></p>}<button className="review-primary" disabled={busy}>{busy?'提交中…':'提交举报'}</button></form></Modal>}</>;
}
function MyReviews(){
  const [feed,setFeed]=useState(null),[page,setPage]=useState(1),[status,setStatus]=useState('all'),[version,setVersion]=useState(0),[error,setError]=useState(''),[busy,setBusy]=useState(false),[editing,setEditing]=useState(null),[confirm,setConfirm]=useState(null);
  const close=useRef(()=>setEditing(null)).current;
  useEffect(()=>{const c=new AbortController();setFeed(null);setError('');communityApi(`/api/my/reviews?${new URLSearchParams({page,status})}`,{signal:c.signal}).then(f=>{if(page>1&&page>Math.max(f.totalPages,1))setPage(Math.max(f.totalPages,1));else setFeed(f);}).catch(e=>{if(!c.signal.aborted)setError(e.message);});return()=>c.abort();},[page,status,version]);
  async function edit(review){setBusy(true);setError('');try{setEditing({review,detail:await communityApi(`/api/courses/${encodeURIComponent(review.courseId)}`)});}catch(e){setError(e.message);}finally{setBusy(false);}}
  async function action(){setBusy(true);setError('');try{await communityWrite(`/api/reviews/${confirm.id}${confirm.remove?'/permanent':''}`,undefined,'DELETE');if(confirm.remove){try{for(const key of Object.keys(sessionStorage))if(key.startsWith('nnu:review-draft:')&&key.endsWith(':'+confirm.id))sessionStorage.removeItem(key);}catch{}}setConfirm(null);setVersion(v=>v+1);}catch(e){setError(e.message);}finally{setBusy(false);}}
  return <section className="account-reviews"><div className="community-toolbar"><div className="account-section-title"><h2>我的评价</h2>{feed&&<span>{feed.total} 条</span>}</div><label><span className="account-filter-label">状态</span><Dropdown aria-label="我的评价状态" value={status} onChange={e=>{setStatus(e.target.value);setPage(1);}}><option value="all">全部状态</option>{Object.entries(statusName).map(([v,n])=><option value={v} key={v}>{n}</option>)}</Dropdown></label></div>
    {error&&<p className="inline-error" role="alert">{error} <button onClick={()=>setVersion(v=>v+1)}>重试</button></p>}
    {!feed&&!error?<p role="status" className="account-loading">正在加载评价…</p>:feed?.items.length===0?<div className="account-empty"><BookOpen size={30} aria-hidden="true"/><h3>{status==='all'?'还没有写过评价':'暂无'+statusName[status]+'的评价'}</h3>{status==='all'?<a className="account-secondary-button" href="/courses">找一门修读过的课 <ArrowUpRight size={15}/></a>:<button className="account-secondary-button" onClick={()=>setStatus('all')}>查看全部评价</button>}</div>:feed?.items.map(r=><article className="student-review" key={r.id}><div className="community-row-heading"><a href={`/courses?course=${encodeURIComponent(r.courseId)}`}><h3>{r.courseName}</h3></a><strong>{r.rating}<small> 分</small></strong></div><div className="account-review-meta"><p className="student-review-scope">{r.teacher}{r.semesterLabel&&` · ${r.semesterLabel}`}</p><span className={`account-review-status status-${r.status}`}>{statusName[r.status]}</span></div><div className="student-review-dimensions">{reviewDimensions.filter(({key})=>r[key]!=null).map(({key,label,options})=><span key={key}>{label} <b>{options[r[key]-1]}</b></span>)}</div><p className="student-review-content">{r.content}</p>{r.moderationReason&&<p className="inline-error">下架原因：{r.moderationReason}</p>}<div className="student-review-footer"><span>{new Date(r.createdAt).toLocaleDateString('zh-CN')}</span><div><button disabled={busy||!!r.moderationReason} onClick={()=>edit(r)}>{r.status==='hidden'?'修改并重新发布':'修改'}</button><button disabled={busy} onClick={()=>setConfirm({...r,remove:r.status==='hidden'})}>{r.status==='hidden'?'删除':'撤回'}</button></div></div></article>)}<Pager feed={feed} onPage={setPage}/>
    {editing&&<Composer detail={editing.detail} review={editing.review} teacher="all" onClose={close} onSuccess={()=>{setEditing(null);setVersion(v=>v+1);}}/>}
    {confirm&&<Modal title={confirm.remove?'删除评价':'撤回评价'} onClose={()=>{if(!busy)setConfirm(null);}}><p>{confirm.remove?'删除后无法恢复，确定删除这条评价？':'撤回后其他同学将看不到这条评价。'}</p>{error&&<p role="alert">{error}</p>}<div className="review-form-actions"><button disabled={busy} onClick={()=>setConfirm(null)}>取消</button><button disabled={busy} className="review-primary" onClick={action}>{busy?'处理中…':'确认'}</button></div></Modal>}
  </section>;
}
function ProfileEditor({account,onClose,onSaved}){
  const [nickname,setNickname]=useState(account.nickname||''),[avatar,setAvatar]=useState(undefined),[busy,setBusy]=useState(false),[processing,setProcessing]=useState(false),[error,setError]=useState('');
  const fileInput=useRef(null);
  async function choose(e){const file=e.target.files?.[0];e.target.value='';if(!file)return;setProcessing(true);setError('');try{setAvatar(await prepareAvatar(file));}catch(e){setError(e.message);}finally{setProcessing(false);}}
  async function submit(e){e.preventDefault();setBusy(true);setError('');try{const result=await communityWrite('/api/account/profile',{nickname,...(avatar===undefined?{}:{avatar})});onSaved(result.profile);onClose();}catch(e){setError(e.message);}finally{setBusy(false);}}
  return <Modal title="编辑个人资料" onClose={()=>{if(!busy&&!processing)onClose();}}><form className="community-form profile-editor" onSubmit={submit}><div className="profile-avatar-editor"><Avatar src={avatar===undefined?account.avatarUrl:avatar}/><div><input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp" onChange={choose} hidden aria-label="选择头像图片"/><div className="profile-avatar-actions"><button type="button" className="account-secondary-button" disabled={busy||processing} onClick={()=>fileInput.current.click()}>{processing?'处理图片中…':'上传头像'}</button><button type="button" disabled={busy||processing} onClick={()=>setAvatar(null)}>恢复默认</button></div><p>JPG、PNG 或 WebP，最大 5 MB，居中裁为正方形。</p></div></div><label>昵称<input required value={nickname} maxLength={40} onChange={e=>setNickname(e.target.value)} disabled={busy} autoComplete="nickname"/></label><small>1–20 个字符。登录用户名仍为 {account.username}，评价显示你的昵称。</small>{error&&<p role="alert" className="inline-error">{error}</p>}<div className="review-form-actions"><button type="button" disabled={busy||processing} onClick={onClose}>取消</button><button className="review-primary" disabled={busy||processing}>{busy?'保存中…':'保存资料'}</button></div></form></Modal>;
}
function BindEmail({session,onBound}){
  const [busy,setBusy]=useState(false),[sending,setSending]=useState(false),[error,setError]=useState('');
  async function submit(e){e.preventDefault();const data=Object.fromEntries(new FormData(e.currentTarget));setBusy(true);setError('');try{await communityWrite('/api/account/bind-email',data);await onBound();}catch(e){setError(e.message);}finally{setBusy(false);}}
  return <section className="email-verification-panel"><h2>验证校园邮箱</h2><p>绑定后即可发布或修改评价，也可通过邮箱找回密码。原有评价会保留。</p><form className="community-form" onSubmit={submit}><EmailFields purpose="bind" mailReady={session.mailReady} disabled={busy} onBusy={setSending}/><label>当前网站密码<input required name="currentPassword" type="password" autoComplete="current-password" maxLength={128}/></label>{error&&<p role="alert" className="inline-error">{error}</p>}<button className="review-primary" disabled={busy||sending||!session.mailReady}>{busy?'验证中…':'验证并绑定邮箱'}</button></form></section>;
}
function DeleteAccount(){
  const [open,setOpen]=useState(false),[info,setInfo]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
  async function show(){setOpen(true);setInfo(null);setError('');try{setInfo(await communityApi('/api/account/deletion'));}catch(e){setError(e.message);}}
  async function submit(e){
    e.preventDefault();const data=Object.fromEntries(new FormData(e.currentTarget));setBusy(true);setError('');
    try{await communityWrite('/api/account/delete',data);try{for(const key of Object.keys(sessionStorage))if(key.startsWith('nnu:review-draft:'))sessionStorage.removeItem(key);}catch{}location.replace('/login?deleted=1');}
    catch(e){setError(e.message);setBusy(false);}
  }
  return <section className="account-deletion account-security-section"><div className="account-security-heading"><h2>注销账号</h2><p>永久删除账号，操作无法恢复。</p></div><div className="account-security-content"><p>评价会保留，作者显示为“已注销用户”，与账号解除关联，之后无法再修改或撤回。</p><button className="account-delete-button" onClick={show}>注销账号</button></div>
    {open&&<Modal title="确认注销账号" onClose={()=>{if(!busy)setOpen(false);}}>
      {!info&&!error&&<p role="status">正在读取账号信息…</p>}
      {error&&<p className="inline-error" role="alert">{error}{!info&&<button onClick={show}>重试</button>}</p>}
      {info&&(info.canDelete?<form className="community-form" onSubmit={submit}>
        <p>注销后账号无法恢复，所有设备会退出登录。{info.reviewCount>0?`现有 ${info.reviewCount} 条评价会保留，已撤回或下架的评价仍不公开。`:'当前账号没有评价。'}重新注册也无法认领旧评价。如需删除评价，请先在“我的评价”中撤回并删除。</p>
        <label>当前密码<input required name="currentPassword" type="password" autoComplete="current-password" maxLength={128} disabled={busy}/></label>
        <label className="check-label"><input type="checkbox" name="confirmation" value="注销账号" required disabled={busy}/>我已了解后果，确认永久注销账号</label>
        <div className="review-form-actions"><button type="button" disabled={busy} onClick={()=>setOpen(false)}>取消</button><button className="account-delete-button" disabled={busy}>{busy?'正在注销…':'永久注销账号'}</button></div>
      </form>:<p role="status">{info.reason}</p>)}
    </Modal>}
  </section>;
}
export function AccountPage(){
  const [session,setSession]=useState(null),[tab,setTab]=useState('reviews'),[busy,setBusy]=useState(false),[error,setError]=useState(''),[code,setCode]=useState(''),[message,setMessage]=useState(''),[editingProfile,setEditingProfile]=useState(false);
  const next=safeReturnPath(new URLSearchParams(location.search).get('next'),'/courses');
  async function load(){setError('');try{const result=await communityApi('/api/session');if(!result.account){location.replace(authHref('login',new URLSearchParams(location.search).has('next')?next:'/account'));return;}setSession(result);if(!result.account.emailVerified)setTab('settings');}catch(e){setError(e.message);}}
  useEffect(()=>{document.title='我的账号 · 南师选课簿';load();},[]);
  async function submit(e){e.preventDefault();const form=e.currentTarget,data=Object.fromEntries(new FormData(form));if(data.password!==data.confirmPassword){setError('两次输入的密码不一致');return;}setBusy(true);setError('');try{const result=await communityWrite('/api/account/password',data);setCode(result.recoveryCode||'');setMessage(result.message||'密码已更新，请保存新的恢复码');form.reset();await load();}catch(e){setError(e.message);}finally{setBusy(false);}}
  async function logout(){setBusy(true);setError('');try{await communityWrite('/api/account/logout',{});location.assign('/login');}catch(e){setError(e.message);setBusy(false);}}
  return <CommunityFrame title="我的账号" className="account-page">{message&&<p role="status" className="review-feedback">{message}</p>}{error&&<p role="alert" className="inline-error">{error} {!session&&<button onClick={load}>重试</button>}</p>}
    {!session?<p role="status">正在连接…</p>:code?<RecoveryPanel code={code} onDone={()=>setCode('')}/>:<>
      <section className="account-profile" aria-label="账号信息"><div className="account-identity"><button className="profile-avatar-edit" onClick={()=>setEditingProfile(true)} aria-label="编辑头像和昵称"><Avatar src={session.account.avatarUrl}/></button><div className="account-identity-text"><div className="account-name-row"><h2>{session.account.nickname||session.account.username}</h2><span className={`account-verified${session.account.emailVerified?'':' unverified'}`}><ShieldCheck size={14} aria-hidden="true"/>{session.account.emailVerified?'邮箱已验证':'邮箱待验证'}</span></div></div></div><div className="account-profile-actions"><button className="account-secondary-button" onClick={()=>setEditingProfile(true)}>编辑资料</button><button className="account-secondary-button" disabled={busy} onClick={logout}><SignOut size={16} aria-hidden="true"/>退出登录</button></div></section>
      {editingProfile&&<ProfileEditor account={session.account} onClose={()=>setEditingProfile(false)} onSaved={profile=>{setSession(s=>({...s,account:{...s.account,...profile}}));window.dispatchEvent(new CustomEvent('nnu:profile-updated',{detail:profile}));setMessage('个人资料已更新');}}/>}
      <nav className="account-tabs" aria-label="个人页导航"><button aria-pressed={tab==='reviews'} className={tab==='reviews'?'active':''} onClick={()=>setTab('reviews')}><NotePencil size={18} aria-hidden="true"/>我的评价</button><button aria-pressed={tab==='settings'} className={tab==='settings'?'active':''} onClick={()=>setTab('settings')}><ShieldCheck size={18} aria-hidden="true"/>账号安全</button></nav>
      {!session.account.emailVerified&&<p className="account-email-status">校园邮箱尚未验证，暂时无法发布或修改评价。<button onClick={()=>setTab('settings')}>前往验证</button></p>}
      {tab==='reviews'?<MyReviews/>:<div className="account-security">
        <section className="account-security-section"><div className="account-security-heading"><h2>校园邮箱</h2><p>用于身份验证和找回密码。</p></div><div className="account-security-content">{session.account.emailVerified?<div className="account-email-details"><span>{session.account.email}</span><small><CheckCircle size={15} aria-hidden="true"/>已验证</small></div>:<BindEmail session={session} onBound={async()=>{setMessage('校园邮箱验证成功');await load();}}/>}</div></section>
        <section className="account-security-section"><div className="account-security-heading"><h2>修改密码</h2><p>{session.account.emailVerified?'保存后，其他设备会退出登录。':'保存后，其他设备会退出登录，并生成新的恢复码。'}</p></div><form className="community-form account-security-content" onSubmit={submit}><label>当前密码<input name="currentPassword" type="password" required autoComplete="current-password" maxLength={128}/></label><div className="account-password-pair"><label>新密码<input name="password" type="password" required minLength={10} maxLength={128} autoComplete="new-password" placeholder="至少 10 个字符"/></label><label>确认新密码<input name="confirmPassword" type="password" required minLength={10} maxLength={128} autoComplete="new-password" placeholder="再次输入新密码"/></label></div><button className="review-primary" disabled={busy}>{busy?'保存中…':'更新密码'}</button></form></section>
        <DeleteAccount/>
        {session.account.role==='admin'&&<div className="account-settings-footer"><a className="account-admin-link" href="/admin">站点管理<ArrowUpRight size={14} aria-hidden="true"/></a></div>}
      </div>}
    </>}
  </CommunityFrame>;
}
