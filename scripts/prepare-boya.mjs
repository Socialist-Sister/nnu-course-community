// Read-only workbook extraction is in ../course-data/read-boya-workbooks.py.
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {commonCategories} from '../server/taxonomy.mjs';
const sources=JSON.parse(readFileSync(new URL('../../course-data/2026-autumn/boya-workbooks-source.json',import.meta.url),'utf8'));
const categories=new Map(commonCategories.filter(c=>c.kind==='liberal').map(c=>[c.name,c.id]));
const courses=new Map();
for(const [sourceIndex,source] of sources.entries())for(const sheet of source.sheets){
  const offline=sourceIndex===0,alliance=sheet.name==='校际联盟网博';
  const categoryColumn=offline?3:alliance?9:6;
  if(!sheet.rows.find(r=>r.row===2).cells[categoryColumn].includes('24版'))throw Error('Missing 24-version header');
  for(const {row,cells:c} of sheet.rows.filter(r=>r.row>2)){
    const record={code:String(c[1]).trim(),name:c[2].trim(),categoryId:categories.get(c[categoryColumn].trim()),mode:offline?'offline':alliance?'interuniversity':'online',platform:alliance?c[6].trim():offline?'':'超星',school:alliance?c[7].trim():'',source:sourceIndex,sheet:sheet.name,rows:[row]};
    if(!record.categoryId)throw Error('Unrecognized category at row '+row);
    if(courses.has(record.code)){
      const existing=courses.get(record.code);
      if(JSON.stringify({...existing,rows:[]})!==JSON.stringify({...record,rows:[]}))throw Error('Conflicting sections: '+record.code);
      existing.rows.push(row);
    }else courses.set(record.code,record);
  }
}
const manifest={semester:'2026-2027-1',basis:'2024',sources:sources.map(({file,sha256})=>({file,sha256})),courses:[...courses.values()].sort((a,b)=>a.code.localeCompare(b.code))};
const out=new URL('../server/data/',import.meta.url);mkdirSync(out,{recursive:true});
writeFileSync(new URL('boya-2026-autumn.json',out),JSON.stringify(manifest,null,2)+'\n');
console.log({courses:manifest.courses.length,modes:Object.fromEntries(['offline','online','interuniversity'].map(mode=>[mode,manifest.courses.filter(c=>c.mode===mode).length]))});
