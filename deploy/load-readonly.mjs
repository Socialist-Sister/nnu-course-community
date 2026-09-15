// Fixed public GET routes only. No sessions, accounts, email or review writes.
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {setTimeout as sleep} from 'node:timers/promises';
const base=process.env.LOAD_BASE||'http://127.0.0.1:4180';
const duration=Number(process.env.LOAD_SECONDS||45),cap=25;
const users=(process.env.LOAD_USERS||'5,10,20,50').split(',').map(Number);
assert.ok(duration>0&&duration<=60&&users.every(n=>n>0&&n<=50));
const first=await fetch(base+'/api/courses?pageSize=1',{signal:AbortSignal.timeout(10000)}).then(r=>r.json());
assert.ok(first.items?.[0]);
const code=encodeURIComponent(first.items[0].code);
const paths=['/','/api/home','/api/courses?q='+encodeURIComponent('高数'),'/api/courses?sort=teachers','/api/courses?sort=rating','/api/courses?topic=liberal-science','/api/courses/'+code,'/api/courses/'+code+'/reviews'];
const reports=[];let stopped=false;
for(const concurrency of users){
  const started=Date.now(),end=started+duration*1000,results=[];let next=Date.now(),seq=0,consecutiveErrors=0,consecutiveSlow=0;
  await Promise.all(Array.from({length:concurrency},async()=>{
    while(Date.now()<end&&!stopped){
      const slot=Math.max(Date.now(),next);next=slot+1000/cap;if(slot>=end)break;await sleep(Math.max(0,slot-Date.now()));if(stopped)break;
      const path=paths[seq++%paths.length],t=performance.now();let status=0;
      try{const r=await fetch(base+path,{signal:AbortSignal.timeout(5000),headers:{'User-Agent':'NNUCR-authorized-readonly-test'}});status=r.status;const body=await r.text();if(status===200&&path.startsWith('/api/'))JSON.parse(body);}catch{status=0;}
      const ms=performance.now()-t;results.push({path,status,ms});consecutiveErrors=status===200?0:consecutiveErrors+1;consecutiveSlow=ms>2000?consecutiveSlow+1:0;
      if(consecutiveErrors>=3||consecutiveSlow>=10||(results.length>=50&&results.filter(r=>r.status!==200).length/results.length>.02))stopped=true;
      await sleep(1000);
    }
  }));
  const elapsed=(Date.now()-started)/1000,sorted=results.map(r=>r.ms).sort((a,b)=>a-b),pct=p=>Math.round(sorted[Math.max(0,Math.ceil(sorted.length*p)-1)]||0);
  const report={users:concurrency,requests:results.length,seconds:+elapsed.toFixed(1),rps:+(results.length/elapsed).toFixed(2),errors:results.filter(r=>r.status!==200).length,p50Ms:pct(.5),p95Ms:pct(.95),p99Ms:pct(.99),maxMs:pct(1),stopped};reports.push(report);console.log(JSON.stringify(report));if(stopped)break;
  await sleep(3000);
}
if(process.env.LOAD_OUTPUT)writeFileSync(process.env.LOAD_OUTPUT,JSON.stringify({base,capRps:cap,thinkTimeMs:1000,durationPerStage:duration,reports},null,2));
if(stopped)process.exitCode=2;
