// Retain only public, content-hashed build assets. Never copy HTML or private files.
import {copyFileSync,existsSync,lstatSync,mkdirSync,readFileSync,readdirSync,renameSync,chmodSync} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {dirname,join,resolve,relative,sep} from 'node:path';
import {pathToFileURL} from 'node:url';
export const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
const hashed=name=>/-[A-Za-z0-9_-]{8,}\.(?:js|css|png|jpe?g|webp|avif|svg|woff2?|ttf|ico)$/.test(name);
function regular(path){const s=lstatSync(path);if(s.isSymbolicLink()||!s.isFile())throw Error(`Expected regular asset: ${path}`);}
function assetFiles(directory,prefix=''){
  if(!existsSync(directory))return [];
  if(lstatSync(directory).isSymbolicLink()||!lstatSync(directory).isDirectory())throw Error('Invalid asset directory');
  return readdirSync(directory,{withFileTypes:true}).flatMap(entry=>{
    if(entry.isSymbolicLink())throw Error('Symbolic links are not allowed in build assets');
    const name=prefix+entry.name,path=join(directory,entry.name);
    return entry.isDirectory()?assetFiles(path,name+'/'):entry.isFile()&&hashed(entry.name)?[name]:[];
  });
}
export function retainAssets(source,target){
  const entries=assetFiles(source);mkdirSync(target,{recursive:true,mode:0o755});
  // Check all collisions before copying anything. A hashed URL must never change bytes.
  assetFiles(target);
  for(const name of entries){const a=join(source,name),b=join(target,name);if(existsSync(b)){regular(b);if(sha256(readFileSync(a))!==sha256(readFileSync(b)))throw Error(`Asset hash-name collision: ${name}`);}}
  let copied=0;
  for(const name of entries){const dest=join(target,name);if(existsSync(dest))continue;mkdirSync(dirname(dest),{recursive:true,mode:0o755});const temp=dest+'.'+randomUUID()+'.tmp';copyFileSync(join(source,name),temp);chmodSync(temp,0o644);renameSync(temp,dest);copied++;}
  return {copied,total:assetFiles(target).length};
}
export function releaseFiles(root){
  const base=resolve(root,'dist/client'),htmlFile=join(base,'index.html');regular(htmlFile);
  const html=readFileSync(htmlFile),text=html.toString('utf8');
  const paths=[...new Set([...text.matchAll(/(?:src|href)=["'](\/assets\/[^"']+)["']/g)].map(m=>m[1]))];
  if(!paths.some(p=>p.endsWith('.js'))||!paths.some(p=>p.endsWith('.css')))throw Error('HTML must reference built JS and CSS assets');
  return [{url:'/',hash:sha256(html),type:'text/html'},...paths.map(url=>{
    if(!/^\/assets\/[A-Za-z0-9_./-]+$/.test(url)||url.split('/').includes('..')||!hashed(url.split('/').at(-1)))throw Error('Invalid built asset URL');
    const path=resolve(base,'.'+url),rel=relative(base,path);if(rel.startsWith('..'+sep)||rel==='..')throw Error('Asset escaped build directory');
    let dir=dirname(path);while(dir!==base){if(lstatSync(dir).isSymbolicLink())throw Error('Symlink in asset path');dir=dirname(dir);}
    regular(path);return {url,hash:sha256(readFileSync(path)),type:url.endsWith('.js')?'javascript':url.endsWith('.css')?'text/css':null};
  })];
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const [command,a,b]=process.argv.slice(2);
  if(command==='retain'&&a&&b)console.log(JSON.stringify(retainAssets(resolve(a),resolve(b))));
  else if(command==='verify'&&a)console.log(JSON.stringify({files:releaseFiles(a).length}));
  else throw Error('Usage: release-assets.mjs retain <source-assets> <target-assets> | verify <release>');
}
