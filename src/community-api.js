export async function communityApi(url,options={}){
  const response=await fetch(url,{...options,signal:options.signal||AbortSignal.timeout(15000)});
  if(!response.headers.get('content-type')?.includes('application/json'))throw Error('服务暂时不可用，请稍后重试');
  const data=await response.json();if(!response.ok)throw Object.assign(Error(data.error||'操作失败'),{code:data.code,status:response.status,retryAfter:data.retryAfter});return data;
}
export async function communityWrite(url,data,method='POST'){
  const session=await communityApi('/api/session');
  return communityApi(url,{method,headers:{'Content-Type':'application/json','X-CSRF-Token':session.csrf},...(data===undefined?{}:{body:JSON.stringify(data)})});
}
