const allowedPaths=new Set(['/','/courses','/account','/admin']);
export function safeReturnPath(value,fallback='/account'){
  if(typeof value!=='string'||!value.startsWith('/')||value.startsWith('//')||/[\\\u0000-\u0020]/.test(value))return fallback;
  try{const url=new URL(value,'https://coursebook.local');return url.origin==='https://coursebook.local'&&allowedPaths.has(url.pathname)?url.pathname+url.search+url.hash:fallback;}catch{return fallback;}
}
export function authHref(page,next){return '/'+page+'?'+new URLSearchParams({next:safeReturnPath(next)});}
