// Pure evaluation shared by the timer and isolated tests. No email or shell effects.
export function dateDays(value,now){
  if(!value)return null;
  if(!/^\d{4}-\d{2}-\d{2}(?:T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:Z|\+08:00))?$/.test(value))throw Error('Invalid reminder date');
  const day=value.slice(0,10),iso=new Date(day+'T12:00:00Z').toISOString().slice(0,10);if(iso!==day)throw Error('Invalid reminder date');
  const timestamp=Date.parse(value.includes('T')?value:value+'T23:59:59+08:00');if(!Number.isFinite(timestamp))throw Error('Invalid reminder date');
  return Math.ceil((timestamp-now)/86400000)||0;
}
export function evaluateOps(sample,config={},now=Date.now()){
  const issues=[];const add=(id,level,message,immediate=false)=>issues.push({id,level,message,immediate});
  if(sample.checkErrors?.length)add('monitor-check','critical','部分运维检查无法执行：'+sample.checkErrors.join('、'),true);
  for(const service of ['nnu-course','nginx'])if(sample.services[service]?.active!=='active')add('service:'+service,'critical',service+' 服务未运行');
  if(!sample.appHealthy)add('app-health','critical','应用健康检查未通过');
  if(!sample.httpsHealthy)add('https-health','critical','本机 HTTPS 入口健康检查未通过，请检查 Nginx、证书和应用');
  if(sample.diskPercent>=80)add('disk',sample.diskPercent>=90?'critical':'warning',`数据库所在磁盘已使用 ${sample.diskPercent}%`,sample.diskPercent>=90);
  if(!sample.latestBackupAt||now-sample.latestBackupAt>30*3600000)add('backup-age','critical','最近一次数据库备份已超过30小时，或未找到备份',true);
  for(const service of ['nnu-backup','nnu-cert-renew',...(sample.services.logrotate?['logrotate']:[])]){
    if(sample.services[service]?.timer!=='active')add(service+':timer','warning',service+' 定时器未启用',true);
    if(sample.services[service]?.result&&sample.services[service].result!=='success')add(service+':failed','critical',service+' 最近一次执行失败',true);
  }
  if(sample.certExpiresAt&&sample.certExpiresAt-now<14*86400000)add('certificate',sample.certExpiresAt-now<3*86400000?'critical':'warning',`网站证书将在 ${Math.ceil((sample.certExpiresAt-now)/86400000)} 天内到期`,true);
  for(const [id,key,label]of [['domain','domainExpiresOn','域名'],['azure','azureExpiresOn','Azure 学生额度/订阅']]){
    const days=dateDays(config[key],now);
    if(days!==null&&days<=30)add('expiry:'+id,days<=7?'critical':'warning',`${label}登记到期日 ${config[key]}，剩余约 ${days} 天；请核对控制台并处理续费/迁移`,true);
  }
  if(!config.domainExpiresOn||!config.azureExpiresOn)add('expiry-config','warning','域名或 Azure 到期日尚未登记；日期提醒不完整，请补充运维配置',true);
  return issues;
}
export function planNotifications(previous={},issues,now=Date.now(),billingReviewDays=30){
  if(!Number.isInteger(billingReviewDays)||billingReviewDays<1||billingReviewDays>90)throw Error('Invalid billing review interval');
  const next={...previous,issues:{},billingReviewAt:previous.billingReviewAt||now},notify=[];
  const old=previous.issues||{};
  for(const issue of issues){
    const p=old[issue.id]||{},entry={...issue,count:(p.count||0)+1,lastSent:p.lastSent||0,sentLevel:p.sentLevel||null};
    const ready=issue.immediate||entry.count>=2;
    if(ready&&(!entry.lastSent||entry.sentLevel!==issue.level||now-entry.lastSent>=86400000))notify.push({...issue,kind:'problem'});
    next.issues[issue.id]=entry;
  }
  for(const [id,p]of Object.entries(old))if(!next.issues[id]&&p.lastSent)notify.push({id,level:'info',kind:'recovery',message:p.message+'：现已恢复正常'});
  if(now-next.billingReviewAt>=billingReviewDays*86400000)notify.push({id:'billing-review',level:'info',kind:'review',message:'请检查 Azure 100 美元学生额度的剩余金额、实际费用及邮件服务用量。额度可能早于订阅到期日耗尽；本提醒不读取或保证云账户余额。'});
  return {next,notify};
}
export function markNotified(plan,now){
  for(const item of plan.notify){const entry=plan.next.issues[item.id];if(entry){entry.lastSent=now;entry.sentLevel=item.level;}if(item.kind==='review')plan.next.billingReviewAt=now;}
  return plan.next;
}
