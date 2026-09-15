import {readFileSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {setTimeout as sleep} from 'node:timers/promises';
const samples=[];let previous;
for(let i=0;i<115;i++){
  const mem=Object.fromEntries([...readFileSync('/proc/meminfo','utf8').matchAll(/^(\w+):\s+(\d+)/gm)].map(m=>[m[1],Number(m[2])]));
  const cpu=readFileSync('/proc/stat','utf8').split('\n')[0].trim().split(/\s+/).slice(1,9).map(Number),total=cpu.reduce((a,b)=>a+b,0),idle=cpu[3]+cpu[4];
  const service=Object.fromEntries(execFileSync('systemctl',['show','nnu-course','-p','NRestarts','-p','MemoryCurrent','-p','ActiveState'],{encoding:'utf8'}).trim().split('\n').map(l=>l.split('=')));
  const swap=Object.fromEntries([...readFileSync('/proc/vmstat','utf8').matchAll(/^(pswpin|pswpout) (\d+)/gm)].map(m=>[m[1],Number(m[2])]));
  const sample={at:new Date().toISOString(),availableMiB:Math.round(mem.MemAvailable/1024),swapUsedMiB:Math.round((mem.SwapTotal-mem.SwapFree)/1024),cpuBusyPercent:previous?Math.round(100*(1-(idle-previous.idle)/(total-previous.total))):null,...swap,...service};samples.push(sample);previous={total,idle};
  writeFileSync('/home/azureuser/nnu-upload/load-monitor-result.json',JSON.stringify(samples));
  if(i%15===0)console.log(JSON.stringify(sample));
  if(sample.availableMiB<80||service.ActiveState!=='active'||Number(service.NRestarts)>Number(samples[0].NRestarts)){console.log('STOP: resource threshold reached');process.exitCode=2;break;}
  await sleep(2000);
}
console.log(JSON.stringify({samples:samples.length,minAvailableMiB:Math.min(...samples.map(s=>s.availableMiB)),maxCpuBusyPercent:Math.max(...samples.map(s=>s.cpuBusyPercent||0)),maxServiceMiB:Math.round(Math.max(...samples.map(s=>Number(s.MemoryCurrent)))/1048576),swapPagesIn:samples.at(-1).pswpin-samples[0].pswpin,swapPagesOut:samples.at(-1).pswpout-samples[0].pswpout,restartDelta:Number(samples.at(-1).NRestarts)-Number(samples[0].NRestarts)}));
