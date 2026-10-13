import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {Marked} from 'marked';

const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function renderHandbook(markdown){
  const contents=[];let section=0;
  const parser=new Marked({renderer:{
    html({text}){return escape(text);},
    heading({tokens,depth,text}){
      const id=`section-${++section}`;
      if(depth===2)contents.push(`<li><a href="#${id}">${escape(text)}</a></li>`);
      return `<h${depth} id="${id}">${this.parser.parseInline(tokens)}</h${depth}>`;
    },
    link({href,tokens}){
      const label=this.parser.parseInline(tokens);
      return /^(https?:\/\/|mailto:|#)/i.test(href)?`<a href="${escape(href)}" rel="noreferrer">${label}</a>`:label;
    },
    image({text}){return escape(text);},
    table(token){return `<div class="table-scroll" role="region" aria-label="手册对照表" tabindex="0">${this.constructor.prototype.table.call(this,token)}</div>`;}
  }});
  const body=parser.parse(markdown);
  const start=body.indexOf('<h2 ');
  const toc=`<nav aria-label="手册目录"><strong>快速查阅</strong><ul style="list-style:none;padding-left:0">${contents.join('')}</ul></nav>`;
  const article=start<0?body:body.slice(0,start)+toc+body.slice(start);
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>操作与处置手册 · 南师选课簿</title><style>
*{box-sizing:border-box}html{scroll-padding-top:24px}body{margin:0;background:#f6f8f6;color:#29382f;font:16px/1.85 system-ui,"Microsoft YaHei",sans-serif}main{max-width:1000px;margin:32px auto;padding:32px 40px;background:#fff;border:1px solid #dce6df;border-radius:16px}a{color:#386f55;text-underline-offset:4px}a:hover{color:#254e3b}a:focus-visible,.table-scroll:focus-visible{outline:1px solid #386f55;outline-offset:4px}header{padding-bottom:20px;border-bottom:1px solid #dce6df}h1{font-size:28px;line-height:1.5;margin:28px 0 16px}h2{font-size:22px;margin:40px 0 16px;padding-bottom:10px;border-bottom:1px solid #dce6df}h3{font-size:18px;margin-top:28px}p{margin:14px 0}li{margin:7px 0}ul,ol{padding-left:26px}nav{background:#edf4ef;border-radius:10px;padding:18px 22px;margin:24px 0}nav strong{font-size:18px}nav ol{margin-bottom:0}nav a{text-decoration:none}blockquote{margin:18px 0;padding:6px 20px;border-left:3px solid #7d9e89;background:#f6f8f6}code{font-size:.92em;overflow-wrap:anywhere}.table-scroll{overflow-x:auto;margin:20px 0}table{border-collapse:collapse;width:100%;font-size:14px}th,td{border:1px solid #dce6df;padding:10px 12px;text-align:left;vertical-align:top;min-width:100px}th{background:#edf4ef}hr{border:0;border-top:1px solid #dce6df;margin:28px 0}p,li{overflow-wrap:anywhere}@media(max-width:640px){main{margin:0;padding:20px 18px;border:0;border-radius:0}body{font-size:15px}h1{font-size:24px}h2{font-size:20px}nav{padding:16px}th,td{padding:8px}blockquote{padding:4px 14px}}@media print{body{background:#fff}main{margin:0;border:0;padding:0}header,nav{display:none}h2,h3{break-after:avoid}.table-scroll{overflow:visible}}
</style></head><body><main><header><a href="/admin">← 返回管理员后台</a></header><article>${article}</article></main></body></html>`;
}
export function buildHandbook(){
  const target=new URL('../server/data/admin-handbook.html',import.meta.url);
  mkdirSync(new URL('../server/data/',import.meta.url),{recursive:true});
  writeFileSync(target,renderHandbook(readFileSync(new URL('../ADMIN-HANDBOOK.md',import.meta.url),'utf8')));
  console.log('管理员手册已生成');
  return fileURLToPath(target);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)buildHandbook();
