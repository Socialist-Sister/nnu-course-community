import test from 'node:test';
import assert from 'node:assert/strict';
import {buildHandbook,renderHandbook} from '../scripts/build-admin-handbook.mjs';
import {notificationFixture} from './notification-fixture.mjs';

test('handbook renders readable sections and excludes unsafe or unavailable links',()=>{
  const html=renderHandbook('# 手册\n\n## 处理举报\n\n| 操作 | 结果 |\n|---|---|\n| 下架 | 通知 |\n\n[协作约定](CONTRIBUTING.md)\n\n[危险](javascript:alert%281%29)\n\n<script>alert(1)</script>');
  assert.match(html,/<a href="#section-2">处理举报<\/a>/);
  assert.match(html,/class="table-scroll"/);
  assert.match(html,/&lt;script&gt;/);
  assert.doesNotMatch(html,/<script|href="(?:javascript:|CONTRIBUTING)/);
});

test('handbook requires a current administrator and supports both scoped roles',async()=>{
  buildHandbook();const f=await notificationFixture();
  try{
    const read=(name,method='GET')=>fetch(f.url+'/admin/handbook',{method,headers:{Cookie:f.clients[name]?.cookie||''}});
    assert.equal((await read()).status,401);
    assert.equal((await read('notify_author')).status,403);
    for(const role of [{id:'notify_author',content:false,courses:true},{id:'notify_reporter',content:true,courses:false}]){
      assert.equal((await f.call('notify_owner','/api/admin/members','POST',{action:'grant',...role})).status,200);
    }
    for(const id of Object.keys(f.clients)){
      const res=await read(id);
      assert.equal(res.status,200);
      assert.match(res.headers.get('cache-control'),/private, no-store/);
      assert.match(res.headers.get('content-security-policy'),/frame-ancestors 'none'/);
      assert.match(await res.text(),/南师选课簿：管理员操作与处置手册/);
    }
    const head=await read('notify_author','HEAD');assert.equal(head.status,200);assert.equal(await head.text(),'');
    assert.equal((await f.call('notify_author','/api/admin/reports')).status,403);
    assert.equal((await f.call('notify_owner','/api/admin/members','POST',{action:'revoke',id:'notify_author'})).status,200);
    assert.equal((await read('notify_author')).status,403);
  }finally{await f.close();}
});
