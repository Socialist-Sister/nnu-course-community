import { spawn } from 'node:child_process';
import { importCatalog, readCatalog } from '../server/import-catalog.mjs';
import { openDatabase, root } from '../server/database.mjs';
import { importAvailableLiberal } from '../server/import-liberal.mjs';
const db=openDatabase();try{console.log(importCatalog(db,readCatalog()));console.log(importAvailableLiberal(db));}finally{db.close();}
const children=[spawn(process.execPath,['server/index.mjs'],{cwd:root,stdio:'inherit'}),spawn(process.execPath,['node_modules/vite/bin/vite.js'],{cwd:root,stdio:'inherit'})];
let stopping=false;
function stop(code=0){if(stopping)return;stopping=true;for(const child of children)child.kill();process.exitCode=code;}
for(const child of children){child.on('error',e=>{console.error(e);stop(1);});child.on('exit',code=>stop(code||0));}
process.on('SIGINT',()=>stop());process.on('SIGTERM',()=>stop());
