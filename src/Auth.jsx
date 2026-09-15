import {useEffect,useState} from 'react';
import {BookOpen} from '@phosphor-icons/react';
import {EmailFields} from './EmailFields.jsx';
import {communityApi,communityWrite} from './community-api.js';
import {authHref,safeReturnPath} from '../shared/auth-navigation.mjs';
import {PolicyLinks} from './PolicyLinks.jsx';

function claimLocalDrafts(account){
  if(!account)return;
  try{for(const key of Object.keys(sessionStorage)){
    if(!key.startsWith('nnu:review-draft:'))continue;
    const tail=key.slice('nnu:review-draft:'.length),parts=tail.split(':');
    if(parts[0]==='guest'||parts.length===2){
      const scoped='nnu:review-draft:'+account.id+':'+(parts[0]==='guest'?parts.slice(1).join(':'):tail);
      if(!sessionStorage.getItem(scoped))sessionStorage.setItem(scoped,sessionStorage.getItem(key));
      sessionStorage.removeItem(key);
    }
  }}catch{}
}

export function AuthPage({mode}){
  const [ready,setReady]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState(()=>new URLSearchParams(location.search).get('deleted')==='1'?'账号已注销，保留的评价已解除账号关联。':''),[mailReady,setMailReady]=useState(false),[sending,setSending]=useState(false),[done,setDone]=useState(false);
  const next=safeReturnPath(new URLSearchParams(location.search).get('next'));
  const title={login:'登录',register:'注册','forgot-password':'找回密码'}[mode];
  async function load(){setError('');try{const session=await communityApi('/api/session');if(session.account){location.replace(next);return;}setMailReady(session.mailReady);setReady(true);}catch(e){setError(e.message);}}
  useEffect(()=>{document.title=title+' · 南师选课簿';load();},[mode]);
  async function submit(e){
    e.preventDefault();const form=e.currentTarget,data=Object.fromEntries(new FormData(form));
    if(mode!=='login'&&data.password!==data.confirmPassword){setError('两次输入的密码不一致');return;}
    setBusy(true);setError('');
    try{
      const result=await communityWrite('/api/account/'+(mode==='forgot-password'?'recover':mode),data);
      claimLocalDrafts(result.account);
      if(mode==='login'||mode==='register'){location.assign(next);return;}
      setMessage(result.message||'密码已重设，请重新登录');setDone(true);form.reset();
    }catch(e){setError(e.message);}finally{setBusy(false);}
  }
  return <div className="community-page auth-page"><main className="auth-shell">
    <a className="auth-site-mark" href="/" aria-label="南师选课簿，返回首页" title="返回首页"><BookOpen size={36} weight="bold" aria-hidden="true"/></a>
    <h1>{mode==='forgot-password'?title:title+'南师选课簿'}</h1>
    {error&&<p role="alert" className="inline-error">{error} {!ready&&<button onClick={load}>重试</button>}</p>}
    {message&&<p role="status" className="review-feedback">{message}</p>}
    {done?<nav className="auth-links"><a href={authHref('login',next)}>使用新密码登录</a></nav>:!ready?<p role="status">正在连接…</p>:<>
      <form className="community-form" onSubmit={submit}>
        {mode==='register'&&<p className="auth-policy-notice">提交邮箱前请阅读 <a href="/privacy" target="_blank" rel="noreferrer">隐私说明</a>和<a href="/terms" target="_blank" rel="noreferrer">使用说明</a>。账号数据存储于香港服务器，验证码经阿里云邮件服务发送；不注册也可浏览。</p>}
        {mode!=='login'&&<EmailFields key={mode} purpose={mode==='register'?'register':'recover'} mailReady={mailReady} disabled={busy} onBusy={setSending}/>}
        {mode==='login'?<label>校园邮箱或用户名<input required name="identifier" maxLength={254} autoComplete="username" placeholder="校园邮箱 / 用户名"/></label>:mode==='register'&&<label>用户名<input required name="username" pattern="[A-Za-z0-9_]{3,32}" minLength={3} maxLength={32} autoComplete="username" placeholder="3–32 位字母、数字或下划线"/></label>}
        <div className="auth-password-field"><div className="auth-label-row"><label htmlFor="auth-password">{mode==='forgot-password'?'新密码':'密码'}</label>{mode==='login'&&<a href={authHref('forgot-password',next)}>忘记密码？</a>}</div><input id="auth-password" required name="password" type="password" minLength={10} maxLength={128} autoComplete={mode==='login'?'current-password':'new-password'} placeholder="至少 10 个字符"/></div>
        {mode!=='login'&&<label>确认密码<input required name="confirmPassword" type="password" minLength={10} maxLength={128} autoComplete="new-password"/></label>}
        {mode==='forgot-password'?<p>使用已绑定校园邮箱的验证码重设密码，成功后其他设备会退出登录。</p>:mode==='register'?<p>仅限 @njnu.edu.cn 校园邮箱注册，评价匿名公开。请设置独立的网站密码，无需提供校园邮箱密码。</p>:null}
        <button className="review-primary" disabled={busy||sending||(mode!=='login'&&!mailReady)}>{busy?'处理中…':mode==='forgot-password'?'重设密码':title}</button>
      </form>
      <nav className="auth-links" aria-label="账号页面导航">
        {mode==='login'?<span>还没有账号？<a href={authHref('register',next)}>创建账号</a></span>:mode==='register'?<span>已有账号？<a href={authHref('login',next)}>登录</a></span>:<a href={authHref('login',next)}>返回登录</a>}
      </nav>
    </>}
    <PolicyLinks/>
  </main></div>;
}
