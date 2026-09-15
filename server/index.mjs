import { createServer } from 'node:http';
import {loadEnvFile} from 'node:process';
import {createMailer} from './mailer.mjs';
import {emailDomains} from './email-verification.mjs';
import {siteInfo} from './site-info.mjs';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { resolve, extname, sep, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { openDatabase, root,defaultDbPath } from './database.mjs';
import { ApiError, metadata, listCourses, courseDetail } from './catalog.mjs';
import {session,authorizeWrite,jsonBody,writeReview,withdrawReview,deleteReview,readReviews} from './reviews.mjs';
import {homeFeed} from './home.mjs';
import {readBookmarks,writeBookmarks} from './bookmarks.mjs';
import {currentPerson,requireAccount,requireVerified,accountAction,accountDeletionInfo,ensureAdminSetup} from './accounts.mjs';
import {myReviews,reportReview,adminRead,adminWrite} from './community.mjs';
export function createApp(db, { staticDir = resolve(root, 'dist/client'), mailer=createMailer() } = {}) {
  return createServer({ maxHeaderSize: 65536 }, async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    const json = (status, body) => { res.writeHead(status, { 'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store' }); res.end(JSON.stringify(body)); };
    try {
      const url = new URL(req.url, 'http://localhost');
      if(req.method==='GET'&&url.pathname==='/api/site-info')return json(200,siteInfo());
      const accountWrite=()=>requireAccount(authorizeWrite(db,req));
      if(url.pathname==='/api/bookmarks'){
        if(req.method==='GET')return json(200,readBookmarks(db,currentPerson(db,req)));
        if(req.method==='POST')return json(200,writeBookmarks(db,accountWrite(),await jsonBody(req,180000)));
      }
      if(url.pathname.startsWith('/api/account/')&&req.method==='POST')return json(200,await accountAction(db,req,res,authorizeWrite(db,req),url.pathname.slice(13),await jsonBody(req,url.pathname==='/api/account/profile'?360000:20000),mailer));
      if(url.pathname==='/api/account/avatar'&&req.method==='GET'){
        const person=requireAccount(currentPerson(db,req)),avatar=db.prepare('SELECT avatar FROM account_profiles WHERE user_id=?').get(person.userId)?.avatar;
        if(!avatar)return json(404,{error:'尚未设置头像'});
        res.writeHead(200,{'Content-Type':'image/webp','Cache-Control':'private, no-store','Content-Length':avatar.length});return res.end(Buffer.from(avatar));
      }
      if(url.pathname==='/api/account/deletion'&&req.method==='GET')return json(200,accountDeletionInfo(db,currentPerson(db,req)));
      if(url.pathname==='/api/my/reviews'&&req.method==='GET')return json(200,myReviews(db,currentPerson(db,req),url.searchParams));
      if(url.pathname.startsWith('/api/admin/')){
        const path=url.pathname.slice(11);
        if(req.method==='GET')return json(200,adminRead(db,currentPerson(db,req),path,url.searchParams));
        if(req.method==='POST')return json(200,adminWrite(db,accountWrite(),path,await jsonBody(req)));
      }
      const reportMatch=url.pathname.match(/^\/api\/reviews\/([a-zA-Z0-9-]+)\/report$/);
      if(reportMatch&&req.method==='POST')return json(201,reportReview(db,accountWrite(),reportMatch[1],await jsonBody(req)));
      const reviewMatch=url.pathname.match(/^\/api\/reviews\/([a-zA-Z0-9-]+)$/);
      const permanentMatch=url.pathname.match(/^\/api\/reviews\/([a-zA-Z0-9-]+)\/permanent$/);
      if(permanentMatch&&req.method==='DELETE')return json(200,deleteReview(db,accountWrite(),permanentMatch[1]));
      if(req.method==='POST'&&url.pathname==='/api/reviews'){
        const person=requireVerified(accountWrite()),data=await jsonBody(req),result=writeReview(db,person,data);
        return json(result.replayed?200:201,result);
      }
      if(reviewMatch&&['PUT','DELETE'].includes(req.method)){
        const person=accountWrite();if(req.method==='PUT')requireVerified(person);
        return json(200,req.method==='DELETE'?withdrawReview(db,person,reviewMatch[1]):writeReview(db,person,await jsonBody(req),reviewMatch[1]));
      }
      if (!['GET','HEAD'].includes(req.method)) { res.setHeader('Allow','GET, HEAD'); return json(405, { error:'此接口不支持该操作' }); }
      if (url.pathname.startsWith('/api/')) {
        if(url.pathname==='/api/session'&&req.method==='GET')return json(200,{...session(db,req,res),mailReady:mailer.ready,emailDomains});
        const feed=url.pathname.match(/^\/api\/courses\/([^/]+)\/reviews$/);
        if(feed){let code;try{code=decodeURIComponent(feed[1]);}catch{throw new ApiError(400,'课程编号无效');}return json(200,readReviews(db,req,code,url.searchParams));}
        if (url.pathname === '/api/health') return json(200, { status:'ok', database: db.prepare('SELECT COUNT(*) AS n FROM courses').get().n ? 'ready':'empty' });
        if (url.pathname === '/api/meta') return json(200, metadata(db));
        if (url.pathname === '/api/home') return json(200, homeFeed(db));
        if (url.pathname === '/api/courses') return json(200, listCourses(db, url.searchParams));
        const match = url.pathname.match(/^\/api\/courses\/([^/]+)$/);
        if (match) {
          let code;
          try { code=decodeURIComponent(match[1]); } catch { throw new ApiError(400,'课程编号无效'); }
          return json(200, courseDetail(db, code));
        }
        return json(404, { error:'接口不存在' });
      }
      let pathname;
      try { pathname = decodeURIComponent(url.pathname); } catch { return json(400, {error:'路径无效'}); }
      const base = resolve(staticDir), file = resolve(base, '.' + pathname);
      if (file !== base && !file.startsWith(base + sep)) return json(403, {error:'路径无效'});
      const target = existsSync(file) && statSync(file).isFile() ? file : (!extname(pathname) ? resolve(base,'index.html') : null);
      if (!target || !existsSync(target)) return json(404, {error:'页面不存在，请先构建前端'});
      const types = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon'};
      res.writeHead(200, {'Content-Type':types[extname(target)] || 'application/octet-stream', 'Cache-Control':extname(target)==='.html'?'no-cache':'public, max-age=3600'});
      if (req.method === 'HEAD') return res.end();
      createReadStream(target).on('error',()=>res.destroy()).pipe(res);
    } catch (error) {
      if(Number.isInteger(error.retryAfter)&&error.retryAfter>0)res.setHeader('Retry-After',String(error.retryAfter));
      if (!(error instanceof ApiError)) console.error('Request failed:', error.message);
      json(error.status || 500, {error: error instanceof ApiError ? error.message : '服务暂时不可用，请稍后重试',...(error instanceof ApiError&&error.code?{code:error.code}:{}),...(Number.isInteger(error.retryAfter)&&error.retryAfter>0?{retryAfter:error.retryAfter}:{})});
    }
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const envPath=resolve(root,'.env');if(existsSync(envPath))loadEnvFile(envPath);
  const db = openDatabase();
  ensureAdminSetup(db,resolve(dirname(process.env.DATABASE_PATH||defaultDbPath),'admin-setup-code.txt'));
  const port = Number(process.env.PORT || 4180), host = process.env.HOST || '127.0.0.1';
  const server = createApp(db);
  server.listen(port, host, () => console.log(`南师选课簿 http://${host}:${port}`));
  const stop=()=>server.close(()=>{db.close();process.exit(0);});
  process.on('SIGINT',stop);process.on('SIGTERM',stop);
}
