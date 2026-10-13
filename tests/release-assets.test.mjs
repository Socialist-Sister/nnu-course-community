import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync,symlinkSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createServer} from 'node:http';
import {retainAssets,releaseFiles} from '../deploy/release-assets.mjs';
import {checkRelease} from '../deploy/check-release.mjs';
function fixture(t){const root=mkdtempSync(join(tmpdir(),'nnu-assets-test-'));t.after(()=>rmSync(root,{recursive:true,force:true}));return root;}
function build(root,name){const base=join(root,name,'dist/client');mkdirSync(join(base,'assets'),{recursive:true});writeFileSync(join(base,'assets',`${name}-12345678.js`),`console.log('${name}');`);writeFileSync(join(base,'assets',`${name}-12345678.css`),`body{--version:${name}}`);writeFileSync(join(base,'index.html'),`<html><script src="/assets/${name}-12345678.js"></script><link href="/assets/${name}-12345678.css" rel="stylesheet"></html>`);return base;}
test('旧版哈希资源双向保留，幂等且不复制 HTML、源码映射或非哈希文件',t=>{
  const root=fixture(t),old=build(root,'old'),next=build(root,'next');
  writeFileSync(join(old,'assets','secret.txt'),'private');writeFileSync(join(old,'assets','old-12345678.js.map'),'source map');
  assert.equal(retainAssets(join(old,'assets'),join(next,'assets')).copied,2);
  assert.equal(retainAssets(join(old,'assets'),join(next,'assets')).copied,0);
  assert.equal(retainAssets(join(next,'assets'),join(old,'assets')).copied,2);
  for(const base of [old,next])for(const name of ['old','next'])assert.equal(readFileSync(join(base,'assets',`${name}-12345678.js`),'utf8'),`console.log('${name}');`);
  assert.equal(existsSync(join(next,'assets','secret.txt')),false);assert.equal(existsSync(join(next,'assets','old-12345678.js.map')),false);assert.match(readFileSync(join(old,'index.html'),'utf8'),/old-12345678/);
});
test('同名不同内容直接拒绝，避免旧页面拿到另一份脚本',t=>{
  const root=fixture(t),old=build(root,'old'),next=build(root,'next');writeFileSync(join(next,'assets','old-12345678.js'),'collision');
  assert.throws(()=>retainAssets(join(old,'assets'),join(next,'assets')),/collision/);assert.equal(existsSync(join(next,'assets','old-12345678.css')),false);
});
test('发布包缺少入口资源或试图越界引用时拒绝切换',t=>{
  const root=fixture(t),base=build(root,'old');assert.equal(releaseFiles(join(root,'old')).length,3);
  rmSync(join(base,'assets','old-12345678.js'));assert.throws(()=>releaseFiles(join(root,'old')));
  writeFileSync(join(base,'index.html'),'<script src="/assets/../private-12345678.js"></script><link href="/assets/old-12345678.css">');assert.throws(()=>releaseFiles(join(root,'old')),/Invalid/);
});
test('资源目录符号链接不能被保留脚本带入新版本',{skip:process.platform==='win32'?'Requires POSIX symlink permissions':false},t=>{
  const root=fixture(t),old=build(root,'old'),next=build(root,'next');symlinkSync(join(root,'next'),join(old,'assets','linked'));assert.throws(()=>retainAssets(join(old,'assets'),join(next,'assets')),/Symbolic/);
});
test('上线检查不仅看 health：核对 HTML、资源哈希、类型和禁长缓存',async t=>{
  const root=fixture(t),base=build(root,'old');let mode='ok';const server=createServer((req,res)=>{
    if(req.url==='/api/health'){res.setHeader('Content-Type','application/json');return res.end(JSON.stringify({status:'ok',database:mode==='empty'?'empty':'ready'}));}
    res.setHeader('Cache-Control',mode==='cached'?'max-age=3600':'no-cache');res.setHeader('Content-Type',req.url==='/'?'text/html':req.url.endsWith('.js')?'text/javascript':'text/css');
    if(mode==='bad-type')res.setHeader('Content-Type','text/html');
    if(mode==='missing'&&req.url.endsWith('.js')){res.statusCode=404;return res.end('missing');}
    res.end(mode==='stale'?'old content':readFileSync(join(base,req.url==='/'?'index.html':req.url.slice(1))));
  });await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));const url=`http://127.0.0.1:${server.address().port}`;
  assert.equal((await checkRelease(join(root,'old'),url)).htmlAndAssets,'match');
  for(mode of ['empty','cached','bad-type','missing','stale'])await assert.rejects(checkRelease(join(root,'old'),url));
});
