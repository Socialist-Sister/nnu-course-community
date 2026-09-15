import {useEffect,useSyncExternalStore} from 'react';
import {communityApi} from './community-api.js';
const key='nnu:saved:v1',pendingKey='nnu:saved:import:v1';
export function readSaved(){try{const v=JSON.parse(localStorage.getItem(key)||'[]');return Array.isArray(v)?[...new Set(v.filter(c=>typeof c==='string'&&c.length>0&&c.length<=60))].slice(0,2500):[];}catch{return [];}}
let state={codes:[],accountId:null,loading:true,error:''},queue=Promise.resolve(),started=false;
const listeners=new Set();
function emit(patch){state={...state,...patch};listeners.forEach(fn=>fn());}
function serialized(fn){const task=queue.then(fn);queue=task.catch(()=>{});return task;}
async function post(session,data){return communityApi('/api/bookmarks',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':session.csrf},body:JSON.stringify({...data,accountId:session.accountId})});}
async function load(){
 const session=await communityApi('/api/bookmarks');
 if(!session.accountId){emit({codes:readSaved(),accountId:null,error:''});return session;}
 if(state.accountId!==session.accountId)emit({codes:[],accountId:session.accountId});
 let result=session;
 const legacy=readSaved();
 if(legacy.length){
  // Persist the id before sending so a lost response cannot resurrect later deletions.
  let batch=JSON.parse(localStorage.getItem(pendingKey)||'null');
  if(batch?.accountId&&batch.accountId!==session.accountId){emit({codes:session.codes,accountId:session.accountId,error:''});return session;}
  if(!batch){batch={token:crypto.randomUUID(),codes:legacy,accountId:session.accountId};localStorage.setItem(pendingKey,JSON.stringify(batch));}
  result=await post(session,{action:'import',token:batch.token,codes:batch.codes});
  localStorage.setItem('nnu:saved:legacy-backup',JSON.stringify(legacy));
  const remaining=legacy.filter(c=>!batch.codes.includes(c));
  localStorage.setItem(key,JSON.stringify(remaining));localStorage.removeItem(pendingKey);
 }
 emit({codes:result.codes,accountId:result.accountId,error:''});return result;
}
export function refreshBookmarks(){return serialized(async()=>{emit({loading:true});try{await load();}catch(e){emit({codes:[],error:'收藏同步失败：'+e.message});}finally{emit({loading:false});}});}
export function setBookmark(code,saved,memberCodes=[]){const expected=state.accountId;return serialized(async()=>{
 emit({loading:true,error:''});
 try{
  const session=await load();
  if(session.accountId!==expected)throw Error('登录状态已改变，请重新操作');
  if(session.accountId){const result=await post(session,{action:'set',code,saved});emit({codes:result.codes});}
  else{const next=saved?[...new Set([...state.codes,code])]:state.codes.filter(c=>c!==code&&!memberCodes.includes(c));localStorage.setItem(key,JSON.stringify(next));emit({codes:next});}
 }catch(e){emit({error:e.message});throw e;}finally{emit({loading:false});}
});}
function subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn);}
export function useBookmarks(){
 const value=useSyncExternalStore(subscribe,()=>state);
 useEffect(()=>{if(!started){started=true;refreshBookmarks();window.addEventListener('focus',refreshBookmarks);document.addEventListener('visibilitychange',()=>{if(!document.hidden)refreshBookmarks();});window.addEventListener('storage',e=>{if(e.key===key)refreshBookmarks();});}},[]);
 return value;
}
