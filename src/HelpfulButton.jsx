import {useEffect,useRef,useState} from 'react';
import {ThumbsUp} from '@phosphor-icons/react';
import {communityWrite} from './community-api.js';
import {authHref} from '../shared/auth-navigation.mjs';
import './helpful.css';

// Accepted design: outline thumb, filled after voting, with the label 有帮助.
export function HelpfulButton({review}){
  const [state,setState]=useState({helpful:!!review.helpful,helpfulCount:review.helpfulCount??0});
  const [busy,setBusy]=useState(false),[error,setError]=useState(null);
  const locked=useRef(false),mounted=useRef(true);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  useEffect(()=>{setState({helpful:!!review.helpful,helpfulCount:review.helpfulCount??0});},[review]);
  useEffect(()=>{const update=e=>{if(e.detail.id===review.id)setState(e.detail);};window.addEventListener('nnu:helpful-changed',update);return()=>window.removeEventListener('nnu:helpful-changed',update);},[review.id]);
  async function toggle(){
    if(locked.current||review.isMine)return;
    locked.current=true;setBusy(true);setError(null);
    try{
      const result=await communityWrite(`/api/reviews/${review.id}/helpful`,{helpful:!state.helpful},'PUT');
      window.dispatchEvent(new CustomEvent('nnu:helpful-changed',{detail:result}));
      if(mounted.current)setState(result);
    }catch(e){if(mounted.current)setError({message:e.message,status:e.status});}
    finally{locked.current=false;if(mounted.current)setBusy(false);}
  }
  return <div className="review-helpful"><button type="button" className="review-helpful-button" aria-pressed={state.helpful} aria-busy={busy} disabled={busy||review.isMine} title={review.isMine?'自己的评价不能点赞':state.helpful?'取消有帮助':'认为这条评价有帮助'} onClick={toggle}>
    <ThumbsUp size={18} weight={state.helpful?'fill':'regular'} aria-hidden="true"/><span>有帮助</span>{state.helpfulCount>0&&<span className="review-helpful-count">{state.helpfulCount}</span>}
  </button>{error&&<span className="review-helpful-error" role="alert">{error.message} {error.status===401&&<a href={authHref('login',location.pathname+location.search)}>去登录</a>}{error.status===403&&<a href="/account?tab=security">账号设置</a>}</span>}</div>;
}
