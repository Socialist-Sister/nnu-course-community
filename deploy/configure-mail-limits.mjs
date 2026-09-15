// Add defaults without printing, replacing or transmitting SMTP credentials.
// Run as root on the existing VM, then restart nnu-course.
import {readFileSync,writeFileSync,renameSync,chmodSync,existsSync} from 'node:fs';
const path='/etc/nnu-course/app.env';
if(!existsSync(path))throw Error('Existing application environment is required');
const defaults={MAIL_REQUEST_IP_PER_MINUTE:120,MAIL_REQUEST_IP_BURST:30,MAIL_REQUEST_VISITOR_PER_MINUTE:20,REGISTRATION_REQUEST_IP_PER_MINUTE:120,MAIL_CODE_COOLDOWN_SECONDS:60,MAIL_VISITOR_PER_HOUR:10,MAIL_EMAIL_PER_HOUR:10,MAIL_GLOBAL_PER_HOUR:200,MAIL_GLOBAL_PER_DAY:1000};
let text=readFileSync(path,'utf8'),added=[];
for(const [key,value]of Object.entries(defaults))if(!new RegExp('^'+key+'=','m').test(text)){text+='\n'+key+'='+value;added.push(key);}
if(added.length){const temporary=path+'.limits.tmp';writeFileSync(temporary,text+'\n',{mode:0o600});chmodSync(temporary,0o600);renameSync(temporary,path);}
console.log(JSON.stringify({added,credentials:'preserved'}));
