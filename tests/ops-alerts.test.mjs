import {test} from 'node:test';
import assert from 'node:assert/strict';
import {evaluateOps,planNotifications,markNotified,dateDays} from '../deploy/ops-checks.mjs';
import {siteInfo} from '../server/site-info.mjs';
const now=Date.parse('2026-09-10T00:00:00+08:00'),config={domainExpiresOn:'2027-09-10',azureExpiresOn:'2027-09-10'};
const healthy=()=>({services:{'nnu-course':{active:'active'},nginx:{active:'active'},'nnu-backup':{timer:'active',result:'success'},'nnu-cert-renew':{timer:'active',result:'success'}},appHealthy:true,httpsHealthy:true,diskPercent:15,latestBackupAt:now-3600000,certExpiresAt:now+60*86400000});
test('健康状态不发信；短暂故障连续两次才通知并在恢复后通知一次',()=>{
  assert.deepEqual(evaluateOps(healthy(),config,now),[]);
  const s=healthy();s.appHealthy=false;const issues=evaluateOps(s,config,now);
  const first=planNotifications({},issues,now);assert.equal(first.notify.length,0);
  const second=planNotifications(first.next,issues,now+300000);assert.equal(second.notify.length,1);const state=markNotified(second,now+300000);
  assert.equal(planNotifications(state,issues,now+600000).notify.length,0);
  const recovery=planNotifications(state,[],now+900000);assert.equal(recovery.notify[0].kind,'recovery');
  assert.equal(planNotifications(markNotified(recovery,now+900000),[],now+1200000).notify.length,0);
});
test('持续故障24小时才重复提醒，数值小变动不刷屏，严重程度升级立即通知',()=>{
  const s=healthy();s.diskPercent=81;let issue=evaluateOps(s,config,now);let p=planNotifications({},issue,now);p=planNotifications(p.next,issue,now+300000);const state=markNotified(p,now+300000);
  s.diskPercent=82;issue=evaluateOps(s,config,now);assert.equal(planNotifications(state,issue,now+600000).notify.length,0);
  assert.equal(planNotifications(state,issue,now+86400000+300000).notify.length,1);
  s.diskPercent=92;assert.equal(planNotifications(state,evaluateOps(s,config,now),now+600000).notify[0].level,'critical');
});
test('备份过期、任务失败、定时器关闭、证书临期以及检查失败均可发现',()=>{
  const s=healthy();s.latestBackupAt=now-31*3600000;s.services['nnu-backup'].result='exit-code';s.services['nnu-cert-renew'].timer='inactive';s.certExpiresAt=now+2*86400000;s.checkErrors=['disk'];
  const issues=evaluateOps(s,config,now),ids=issues.map(i=>i.id);
  for(const id of ['backup-age','nnu-backup:failed','nnu-cert-renew:timer','certificate','monitor-check'])assert.ok(ids.includes(id));
  assert.equal(planNotifications({},issues,now).notify.length,issues.length);
});
test('到期按上海日期计算，不猜测缺失日期；月度检查提醒不声称读取余额',()=>{
  assert.equal(dateDays('2026-09-10',now),1);assert.throws(()=>dateDays('2026-02-30',now));
  assert.equal(dateDays('2027-09-08T18:58:03+08:00',Date.parse('2027-09-08T18:58:04+08:00')),0);
  assert.throws(()=>dateDays('2027-09-08T25:58:03+08:00',now));
  const near=evaluateOps(healthy(),{domainExpiresOn:'2026-09-15',azureExpiresOn:'2026-10-01'},now);assert.ok(near.some(i=>i.id==='expiry:domain'&&i.level==='critical'));assert.ok(near.some(i=>i.id==='expiry:azure'));
  assert.ok(evaluateOps(healthy(),{},now).some(i=>i.id==='expiry-config'));
  const p=planNotifications({billingReviewAt:now-31*86400000},[],now);assert.equal(p.notify[0].kind,'review');assert.equal(planNotifications(markNotified(p,now),[],now+600000).notify.length,0);
  assert.equal(planNotifications({billingReviewAt:now-8*86400000},[],now,7).notify[0].kind,'review');
});
test('未成功投递不推进通知状态，后续会重试',()=>{
  const issues=[{id:'backup-age',immediate:true,level:'critical',message:'过期'}];const state={};
  assert.equal(planNotifications(state,issues,now).notify.length,1);assert.equal(planNotifications(state,issues,now+300000).notify.length,1);
});
test('公开联系接口严格白名单，不泄露提醒收件人或SMTP信息',()=>{
  assert.deepEqual(siteInfo({PUBLIC_CONTACT_EMAIL:'help@example.test',OPS_ALERT_TO:'private@example.test',SMTP_PASS:'secret'}),{contactEmail:'help@example.test',policyUpdatedAt:'2026-09-15'});
  assert.equal(siteInfo({OPS_ALERT_TO:'private@example.test'}).contactEmail,null);
  assert.equal(siteInfo({PUBLIC_CONTACT_EMAIL:'bad\nBcc:x@example.test'}).contactEmail,null);
});

test('日志轮转定时器关闭与执行失败触发运维提醒',()=>{
 const s=healthy();s.services.logrotate={timer:'active',result:'success'};assert.deepEqual(evaluateOps(s,config,now),[]);
 s.services.logrotate.timer='inactive';assert.ok(evaluateOps(s,config,now).some(i=>i.id==='logrotate:timer'));
 s.services.logrotate={timer:'active',result:'exit-code'};assert.ok(evaluateOps(s,config,now).some(i=>i.id==='logrotate:failed'));
});
