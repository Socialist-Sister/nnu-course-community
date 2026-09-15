import {useEffect,useState} from 'react';
import {communityWrite} from './community-api.js';
import {authHref,safeReturnPath} from '../shared/auth-navigation.mjs';

export function EmailFields({purpose,mailReady,disabled=false,onBusy}){
  const [email,setEmail]=useState(''),[challenge,setChallenge]=useState(''),[code,setCode]=useState(''),[busy,setBusy]=useState(false),[until,setUntil]=useState(0),[seconds,setSeconds]=useState(0),[message,setMessage]=useState(''),[error,setError]=useState(''),[registered,setRegistered]=useState(false);
  const next=safeReturnPath(new URLSearchParams(location.search).get('next'));
  useEffect(()=>{if(!until)return;const update=()=>setSeconds(Math.max(0,Math.ceil((until-Date.now())/1000)));update();const timer=setInterval(update,1000);return()=>clearInterval(timer);},[until]);
  async function send(){
    setBusy(true);onBusy?.(true);setError('');setRegistered(false);setMessage('');setChallenge('');setCode('');
    try{const result=await communityWrite('/api/account/send-code',{email,purpose});setChallenge(result.challengeId);setUntil(Date.now()+result.retryAfter*1000);setMessage(result.message);}
    catch(e){setError(e.message);setRegistered(e.code==='EMAIL_ALREADY_REGISTERED');if(e.retryAfter>0)setUntil(Date.now()+e.retryAfter*1000);}finally{setBusy(false);onBusy?.(false);}
  }
  return <>
    <label>校园邮箱<input required type="email" name="email" autoComplete="email" maxLength={254} placeholder="学号@njnu.edu.cn" value={email} disabled={disabled||busy} onChange={e=>{setEmail(e.target.value);setChallenge('');setCode('');setMessage('');setError('');setRegistered(false);}}/></label>
    <div className="email-code-field"><label htmlFor={`email-code-${purpose}`}>邮箱验证码</label><div className="email-code-row"><input id={`email-code-${purpose}`} required name="emailCode" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} placeholder="6 位验证码" value={code} onChange={e=>setCode(e.target.value)} disabled={disabled}/><button type="button" disabled={disabled||busy||!mailReady||seconds>0||!email.trim()} onClick={send}>{busy?'发送中…':seconds>0?`${seconds} 秒后重发`:'获取验证码'}</button></div></div>
    <input type="hidden" name="challengeId" value={challenge}/>
    {!mailReady&&<p className="inline-error" role="status">邮箱验证暂未开放，请稍后再试。课程和评价仍可直接浏览。</p>}
    {message&&<p role="status">{message}</p>}{error&&<p className="inline-error" role="alert">{error}{registered&&<>。<a href={authHref('login',next)}>前往登录</a> · <a href={authHref('forgot-password',next)}>找回密码</a></>}</p>}
  </>;
}
