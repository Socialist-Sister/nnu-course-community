// Linux integration drill: real bash/flock/tar/link swaps and HTTP checks, stub services only.
// No production directories, service calls, database writes or dependency downloads.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,copyFileSync,existsSync,realpathSync,rmSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn,execFileSync} from 'node:child_process';
import {createServer} from 'node:http';
const deploy=fileURLToPath(new URL('../deploy/',import.meta.url));
const linux={skip:process.platform!=='linux'?'Run deployment drill on Linux (no real services)':false};
const quote=s=>"'"+s.replaceAll("'","'\\''")+"'";
async function fixture(t,mode='ok'){
  const temp=mkdtempSync(join(tmpdir(),'nnu-deploy-test-')),root=join(temp,'site'),upload=join(temp,'upload'),bin=join(temp,'bin'),old=join(root,'releases/old'),next=join(temp,'bundle');
  t.after(()=>rmSync(temp,{recursive:true,force:true}));for(const dir of [root,upload,bin,old,next])mkdirSync(dir,{recursive:true});
  function build(dir,name){mkdirSync(join(dir,'dist/client/assets'),{recursive:true});mkdirSync(join(dir,'server'));mkdirSync(join(dir,'deploy'));writeFileSync(join(dir,'server/index.mjs'),'// test fixture');writeFileSync(join(dir,'dist/client/index.html'),`<script src="/assets/${name}-12345678.js"></script><link href="/assets/${name}-12345678.css">`);writeFileSync(join(dir,'dist/client/assets',`${name}-12345678.js`),`console.log('${name}')`);writeFileSync(join(dir,'dist/client/assets',`${name}-12345678.css`),`body{--v:${name}}`);for(const name of ['check-release.mjs','release-assets.mjs'])copyFileSync(join(deploy,name),join(dir,'deploy',name));}
  build(old,'old');build(next,'next');symlinkSync(old,join(root,'current'));writeFileSync(join(root,'database-sentinel'),'do not alter');
  for(const name of ['update-release.sh','check-release.mjs','release-assets.mjs'])copyFileSync(join(deploy,name),join(upload,name));
  const command=(name,body)=>writeFileSync(join(bin,name),'#!/bin/bash\n'+body+'\n',{mode:0o755});
  command('npm','exit 0');command('node',`if [[ "$1" == --input-type=module ]]; then exit 0; fi\nexec ${quote(process.execPath)} "$@"`);
  command('systemctl',`printf '%s\\n' "$*" >> "$NNU_DEPLOY_ROOT/commands"\nmode=$(cat "$NNU_DEPLOY_ROOT/mode")\nif [[ "$1" == start && "$mode" == backup-fail ]]; then exit 1; fi\nif [[ "$1" == restart && "$mode" == restart-fail && "$(readlink -f "$NNU_DEPLOY_ROOT/current")" != "$NNU_DEPLOY_ROOT/releases/old" ]]; then exit 1; fi\nexit 0`);
  writeFileSync(join(root,'mode'),mode);
  const server=createServer((req,res)=>{
    const current=realpathSync(join(root,'current')),isNew=current!==old,fail=readFileSync(join(root,'mode'),'utf8');
    if(req.url==='/api/health'){res.setHeader('Content-Type','application/json');if(fail==='both-unhealthy'||(isNew&&fail==='unhealthy')){res.statusCode=503;return res.end('{}');}return res.end('{"status":"ok","database":"ready"}');}
    res.setHeader('Cache-Control','no-cache');res.setHeader('Content-Type',req.url==='/'?'text/html':req.url.endsWith('.js')?'text/javascript':'text/css');
    if(isNew&&fail==='stale-html'&&req.url==='/')return res.end(readFileSync(join(old,'dist/client/index.html')));
    if(isNew&&fail==='missing-asset'&&req.url.endsWith('.js')){res.statusCode=404;return res.end('missing');}
    const path=join(current,'dist/client',req.url==='/'?'index.html':req.url.slice(1));if(!existsSync(path)){res.statusCode=404;return res.end('missing');}res.end(readFileSync(path));
  });await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
  const pack=()=>execFileSync('tar',['-czf',join(upload,'app.tar.gz'),'-C',next,'.']);pack();
  const env={...process.env,PATH:bin+':'+process.env.PATH,NNU_DEPLOY_ROOT:root,NNU_DEPLOY_UPLOAD:upload,NNU_DEPLOY_SERVICE:'fake-app',NNU_DEPLOY_BACKUP_SERVICE:'fake-backup',NNU_DEPLOY_ORIGIN:`http://127.0.0.1:${server.address().port}`,NNU_DEPLOY_ATTEMPTS:'2',NNU_DEPLOY_DELAY:'0'};
  const run=(args=[])=>new Promise((resolve,reject)=>{const p=spawn('bash',[join(upload,'update-release.sh'),...args],{env});let output='';p.stdout.on('data',b=>output+=b);p.stderr.on('data',b=>output+=b);p.on('error',reject);p.on('exit',code=>resolve({code,output}));});
  return {root,old,next,pack,run,env,url:env.NNU_DEPLOY_ORIGIN,setMode(value){writeFileSync(join(root,'mode'),value);},current:()=>realpathSync(join(root,'current'))};
}
test('成功发布及手动回滚：两代页面的 JS/CSS 均可访问，数据库不改动',linux,async t=>{
  const f=await fixture(t),result=await f.run();assert.equal(result.code,0,result.output);const deployed=f.current();assert.notEqual(deployed,f.old);assert.equal(realpathSync(join(f.root,'previous')),f.old);
  const oldJs=await fetch(f.url+'/assets/old-12345678.js');assert.equal(oldJs.status,200);assert.equal(await oldJs.text(),"console.log('old')");
  let rollback=await f.run(['--rollback']);assert.equal(rollback.code,0,rollback.output);assert.equal(f.current(),f.old);assert.equal((await fetch(f.url+'/assets/next-12345678.js')).status,200);
  rollback=await f.run(['--rollback']);assert.equal(rollback.code,0,rollback.output);assert.equal(f.current(),deployed);
  assert.equal(readFileSync(join(f.root,'database-sentinel'),'utf8'),'do not alter');
});
for(const mode of ['restart-fail','unhealthy','stale-html','missing-asset'])test(`${mode} 自动回退并核验旧版本`,linux,async t=>{
  const f=await fixture(t,mode),result=await f.run();assert.notEqual(result.code,0);assert.equal(f.current(),f.old);assert.match(result.output,/Rollback verified/);assert.equal((await fetch(f.url+'/assets/old-12345678.js')).status,200);assert.equal((await fetch(f.url+'/assets/next-12345678.js')).status,200);
});
test('备份失败或资源冲突时不切换也不重启服务',linux,async t=>{
  const f=await fixture(t,'backup-fail');let result=await f.run();assert.notEqual(result.code,0);assert.equal(f.current(),f.old);assert.doesNotMatch(readFileSync(join(f.root,'commands'),'utf8'),/restart/);
  f.setMode('ok');writeFileSync(join(f.next,'dist/client/assets/old-12345678.js'),'collision');f.pack();result=await f.run();assert.notEqual(result.code,0);assert.match(result.output,/collision/);assert.equal(f.current(),f.old);
});
test('回退后仍不可用时明确报告失败，不能宣称恢复成功',linux,async t=>{
  const f=await fixture(t,'both-unhealthy'),result=await f.run();assert.notEqual(result.code,0);assert.match(result.output,/ROLLBACK FAILED/);assert.doesNotMatch(result.output,/Rollback verified/);assert.equal(f.current(),f.old);
});
test('部署锁拒绝并发发布，避免两个版本交叉覆盖',linux,async t=>{
  const f=await fixture(t),lock=spawn('flock',[join(f.root,'.deploy.lock'),'bash','-c','echo locked; cat'],{stdio:['pipe','pipe','pipe']});await new Promise(r=>lock.stdout.once('data',r));
  try{const result=await f.run();assert.equal(result.code,75,result.output);assert.equal(f.current(),f.old);}finally{lock.stdin.end();await new Promise(r=>lock.once('exit',r));}
});
