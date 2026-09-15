import {openDatabase} from './database.mjs';
import {syncCoursePages} from './taxonomy.mjs';
import {importBoya} from './boya.mjs';
const check=process.argv.includes('--check'),db=openDatabase(undefined,{readOnly:check});
try{if(!check)syncCoursePages(db);console.log(JSON.stringify(importBoya(db,undefined,{check}),null,2));}finally{db.close();}
