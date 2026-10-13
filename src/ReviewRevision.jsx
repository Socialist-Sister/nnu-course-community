import {useState} from 'react';
import {communityWrite} from './community-api.js';
import {reviewDimensions} from '../shared/review-dimensions.mjs';
import './review-revisions.css';

export const revisionStatus={pending:'等待复核',approved:'复核通过',rejected:'复核未通过',cancelled:'已撤回申请'};
export function RevisionText({value}){
  return <><p className="revision-rating">总体评分：{value.rating} 分</p><div className="student-review-dimensions">{reviewDimensions.filter(({key})=>value[key]!=null).map(({key,label,options})=><span key={key}>{label} <b>{options[value[key]-1]}</b></span>)}</div><p className="student-review-content">{value.content}</p></>;
}
export function ReviewRevisionStatus({review,onChanged}){
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[confirm,setConfirm]=useState(false);
  const revision=review.revision;if(!revision)return null;
  async function cancel(){if(busy)return;setBusy(true);setError('');try{await communityWrite(`/api/reviews/${review.id}/revision`,{revisionId:revision.id},'DELETE');onChanged();}catch(e){setError(e.message);}finally{setBusy(false);}}
  return <aside className="review-revision-status" aria-label="复核进度"><div className="revision-status-line"><strong>{revisionStatus[revision.status]}</strong><time dateTime={revision.decidedAt||revision.createdAt}>{new Date(revision.decidedAt||revision.createdAt).toLocaleString('zh-CN')}</time></div>
    {revision.status==='pending'&&<p>提交的内容暂不公开，处理结果会在站内通知中告知。维护者会在有空时查看。</p>}
    {revision.reason&&<p>处理说明：{revision.reason}</p>}
    <details><summary>查看这次提交的内容与说明</summary><RevisionText value={revision.proposed}/>{revision.note&&<p className="revision-note">复核说明：{revision.note}</p>}</details>
    {revision.status==='pending'&&(confirm?<div className="withdraw-confirm"><span>撤回后可以重新修改，评价仍保持下架。</span><button disabled={busy} onClick={cancel}>{busy?'撤回中…':'确认撤回申请'}</button><button disabled={busy} onClick={()=>setConfirm(false)}>取消</button></div>:<button className="revision-cancel" onClick={()=>setConfirm(true)}>撤回申请后修改</button>)}
    {error&&<p className="inline-error" role="alert">{error} <button onClick={onChanged}>刷新状态</button></p>}
  </aside>;
}
