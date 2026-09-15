// Run as root with a private JSON file containing confirmed contact/alert settings.
import {readFileSync,writeFileSync,renameSync,chmodSync} from 'node:fs';
import {dateDays} from './ops-checks.mjs';
const config=JSON.parse(readFileSync(process.argv[2],'utf8'));
const email=value=>typeof value==='string'&&/^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/.test(value);
if(!email(config.contactEmail)||!email(config.alertTo))throw Error('Confirmed public contact and private alert email are required');
for(const key of ['domainExpiresOn','azureExpiresOn'])dateDays(config[key],Date.now());
const reviewDays=config.billingReviewDays??30;if(!Number.isInteger(reviewDays)||reviewDays<1||reviewDays>90)throw Error('Invalid billing review interval');
const path='/etc/nnu-course/app.env';let app=readFileSync(path,'utf8');
app=app.replace(/^PUBLIC_CONTACT_EMAIL=.*\r?\n?/gm,'');app+='\nPUBLIC_CONTACT_EMAIL='+config.contactEmail+'\n';
function writePrivate(path,text){const tmp=path+'.ops.tmp';writeFileSync(tmp,text,{mode:0o600});chmodSync(tmp,0o600);renameSync(tmp,path);}
writePrivate(path,app);
writePrivate('/etc/nnu-course/ops.env',`OPS_ALERT_TO=${config.alertTo}\nOPS_DOMAIN_EXPIRES_ON=${config.domainExpiresOn||''}\nOPS_AZURE_EXPIRES_ON=${config.azureExpiresOn||''}\nOPS_BILLING_REVIEW_DAYS=${reviewDays}\n`);
console.log(JSON.stringify({configured:true,domainDateConfigured:!!config.domainExpiresOn,azureDateConfigured:!!config.azureExpiresOn,credentials:'preserved'}));
