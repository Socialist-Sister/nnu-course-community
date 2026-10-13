import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {releaseFiles,sha256} from './release-assets.mjs';

export async function checkRelease(root,base){
  const signal=AbortSignal.timeout(5000),origin=new URL(base);
  if(!['http:','https:'].includes(origin.protocol)||origin.username||origin.password)throw Error('Invalid check origin');
  const health=await fetch(new URL('/api/health',origin),{signal,redirect:'error',cache:'no-store'});
  if(!health.ok)throw Error(`Health HTTP ${health.status}`);
  const data=await health.json();if(data.status!=='ok'||data.database!=='ready')throw Error('Database is not ready');
  for(const file of releaseFiles(root)){
    const response=await fetch(new URL(file.url,origin),{signal,redirect:'error',cache:'no-store'});
    if(!response.ok)throw Error(`Asset HTTP ${response.status}: ${file.url}`);
    if(file.type&&!response.headers.get('content-type')?.includes(file.type))throw Error(`Wrong content type: ${file.url}`);
    if(sha256(Buffer.from(await response.arrayBuffer()))!==file.hash)throw Error(`Release bytes do not match: ${file.url}`);
    if(file.url==='/'&&!/no-cache|no-store/.test(response.headers.get('cache-control')||''))throw Error('HTML must not be served from a long-lived cache');
  }
  return {health:'ok',database:'ready',htmlAndAssets:'match'};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  try{console.log(JSON.stringify(await checkRelease(process.argv[2],process.argv[3]||'http://127.0.0.1:4180')));}
  catch(error){console.error('Release check failed:',error.message);process.exitCode=1;}
}
