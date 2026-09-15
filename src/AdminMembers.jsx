import {useEffect,useState} from 'react';
import {communityApi,communityWrite} from './community-api.js';
export function AdminMembers(){
  const [items,setItems]=useState([]),[username,setUsername]=useState(''),[selected,setSelected]=useState(null),[content,setContent]=useState(false),[courses,setCourses]=useState(false),[error,setError]=useState(''),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[ready,setReady]=useState(false);
  async function load(){const r=await communityApi('/api/admin/members');setItems(r.items);setReady(true);}
  useEffect(()=>{load().catch(e=>setError(e.message));},[]);
  function choose(m){setSelected(m);setContent(m.permissions.content);setCourses(m.permissions.courses);setMessage('');setError('');}
  async function search(e){e.preventDefault();setBusy(true);setError('');setSelected(null);try{const r=await communityApi('/api/admin/members?'+new URLSearchParams({username}));choose(r.member);}catch(e){setError(e.message);}finally{setBusy(false);}}
  async function save(action){setBusy(true);setError('');try{await communityWrite('/api/admin/members',{id:selected.id,action,content,courses});setSelected(null);setMessage(action==='revoke'?'管理权限已撤销。':'管理权限已保存。');await load();}catch(e){setError(e.message);}finally{setBusy(false);}}
  return <section>
    <h2>管理员管理</h2><p>只有站点负责人可以授权或撤销。对方须先注册并验证校园邮箱，查找时填写登录用户名。</p>
    {error&&<p role="alert" className="inline-error">{error} <button onClick={()=>load().catch(e=>setError(e.message))}>重试列表</button></p>}{message&&<p role="status">{message}</p>}
    <form className="community-search" onSubmit={search}><input aria-label="成员登录用户名" placeholder="完整登录用户名" required maxLength={32} value={username} onChange={e=>{setUsername(e.target.value);setSelected(null);}}/><button disabled={busy} className="secondary-button">查找账号</button></form>
    {selected&&<div className="student-review"><h3>确认账号：{selected.username}</h3><p>校园邮箱已验证</p>{selected.isOwner?<p>站点负责人拥有全部权限，不能修改或撤销。</p>:<fieldset disabled={busy} className="community-form"><legend>设置权限</legend><label className="check-label"><input type="checkbox" checked={content} onChange={e=>setContent(e.target.checked)}/>内容审核：评价与举报处理</label><label className="check-label"><input type="checkbox" checked={courses} onChange={e=>setCourses(e.target.checked)}/>课程维护：课程、教师和分类修订</label><p>不会获得管理员授权、服务器或邮箱权限。</p><div className="admin-actions"><button className="review-primary" disabled={!content&&!courses} onClick={()=>save('grant')}>确认保存权限</button><button onClick={()=>setSelected(null)}>取消</button></div>{(selected.permissions.content||selected.permissions.courses)&&<details><summary>撤销管理权限</summary><p>撤销后，该账号仍可正常浏览和评价，但不能再使用管理功能。</p><button onClick={()=>save('revoke')}>确认撤销 {selected.username} 的管理权限</button></details>}</fieldset>}</div>}
    <h3>现有管理员</h3>{!ready?<p>正在加载…</p>:items.map(m=><article className="student-review" key={m.id}><h3>{m.username} {m.isOwner&&'· 站点负责人'}</h3><p>{m.isOwner?'全部管理权限':[m.permissions.content&&'内容审核',m.permissions.courses&&'课程维护'].filter(Boolean).join(' · ')}</p><p>授权时间：{new Date(m.grantedAt).toLocaleString('zh-CN')}</p>{!m.isOwner&&<button disabled={busy} className="secondary-button" onClick={()=>choose(m)}>修改或撤销权限</button>}</article>)}
  </section>;
}
