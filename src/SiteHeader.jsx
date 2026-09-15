import {PolicyLinks} from './PolicyLinks.jsx';
import {useCallback,useEffect,useRef,useState} from 'react';
import {ArrowUpRight,X} from '@phosphor-icons/react';

export {readSaved} from './bookmarks.js';
import {useBookmarks} from './bookmarks.js';
export function AboutDialog({onClose,firstVisit=false}){
  const ref=useRef(null);
  useEffect(()=>{const d=ref.current;d.showModal();const close=e=>{e.preventDefault();onClose();};d.addEventListener('cancel',close);return()=>{d.removeEventListener('cancel',close);d.close();};},[onClose]);
  return <dialog className="about-dialog" ref={ref} aria-labelledby="about-title" onClick={e=>{if(e.target===ref.current)onClose();}}><div className="dialog-head"><h2 id="about-title">关于南师选课簿</h2><button className="icon-button" aria-label="关闭说明" onClick={onClose}><X size={22}/></button></div><div className="info-content">
    <p>南师选课簿是学生自发建设的选课经验交流工具，非南京师范大学官方网站，也不代表学校或教师立场。我们希望让同学了解课程的教学方式、学习投入与收获，帮助彼此作出适合自己的选择。</p>
    <h3>交流经历，尊重彼此</h3><p>欢迎真实、具体的正面和负面评价。请区分亲身经历、个人感受与推测，围绕教学、作业、考核和反馈展开；不要辱骂、曝光私人信息、编造指控或号召围攻。评价代表作者在特定学期的体验，不是对教师个人的全面判断，也不是学校官方评价。</p>
    <h3>课程与评分如何参考？</h3><p>目录来自学校选课系统“全校课程查询”：以 2026 年 9 月 6 日快照为基础，9 月 14 日补入新增课程并保留旧记录。范围为采集账号可见的 2026–2027 学年第 1 学期课程，不保证覆盖全部课程或反映实时调整。实际开课、教师、考核与选课资格，以学校和任课教师最新通知为准。</p><p>本学期博雅课程按开课一览表核对，共 113 门，暂按 24 版培养方案归入六类；“网络博雅”“校际博雅”仅区分授课类型。高数、大物同单位、同版本的上下册共用页面，原课程号和教学班保留。评分是已公开评价的汇总，样本较少或修读学期不同时，请结合正文判断。</p>
    <h3>公开署名与使用方式</h3><p>无需登录即可浏览。发布评价需登录并验证校园邮箱；验证只确认邮箱使用权，不代表学校背书。评价显示当前昵称，不公开邮箱和登录用户名，但正文中的经历仍可能使他人认出作者，请谨慎填写个人信息。未登录收藏保存在浏览器，登录后支持跨设备同步。</p>
    <h3>纠错、投诉与回应</h3><p>同学和教师均可通过“联系与反馈”提出事实纠错、隐私投诉或补充说明；登录后也可举报评价。维护者按具体内容核查，必要时隐藏争议内容，并接受复核请求。不会仅因评价为负面或有人提出投诉就认定作者违规，也不会把投诉者来信自动公开。</p>
    <a className="source-link about-school-link" href="https://xsxk.nnu.edu.cn/" target="_blank" rel="noreferrer">前往学校选课系统 <ArrowUpRight size={16}/></a><PolicyLinks/>
    {firstVisit&&<p className="about-first-note">本说明在此浏览器首次访问时自动展示，之后可从“关于选课簿”再次查看。关闭说明不代表同意额外收集个人信息。</p>}
    <button className="review-primary about-continue" onClick={onClose}>开始浏览</button>
  </div></dialog>;
}
// Remember presentation per browser, not consent or account identity. Never version the key to force repeat popups.
const aboutSeenKey='nnu:about-seen';
let aboutSeenInMemory=false;
function hasSeenAbout(){if(aboutSeenInMemory)return true;for(const storage of ['localStorage','sessionStorage']){try{if(window[storage].getItem(aboutSeenKey)==='1')return true;}catch{}}return false;}
export function FirstVisitAbout(){
  const [open,setOpen]=useState(()=>!hasSeenAbout());
  useEffect(()=>{if(!open)return;aboutSeenInMemory=true;for(const storage of ['localStorage','sessionStorage']){try{window[storage].setItem(aboutSeenKey,'1');}catch{}}},[open]);
  const close=useCallback(()=>setOpen(false),[]);
  return open?<AboutDialog onClose={close} firstVisit/>:null;
}
export function SiteHeader({active='',onHome=()=>location.assign('/'),onNavigate=view=>location.assign(view==='saved'?'/courses?view=saved':'/courses'),onAbout,accountEntry,savedCount}){
  const [about,setAbout]=useState(false);const bookmarks=useBookmarks();
  const closeAbout=useCallback(()=>setAbout(false),[]);

  const count=savedCount??bookmarks.codes.length;
  return <><header className="topbar site-header"><button className="wordmark" onClick={onHome} aria-label="南师选课簿，返回首页">南师选课簿</button><nav aria-label="主导航"><button className={`nav-home ${active==='home'?'active':''}`} onClick={onHome}>首页</button><button className={active==='courses'?'active':''} onClick={()=>onNavigate('courses')}>课程库</button><button className={active==='saved'?'active':''} onClick={()=>onNavigate('saved')} aria-label="我的收藏"><span className="nav-saved-long">我的收藏</span><span className="nav-saved-short">收藏</span>{count>0&&<span className="nav-count">{count}</span>}</button></nav><div className="header-account-area"><button className="about-link" onClick={onAbout||(()=>setAbout(true))}>关于选课簿 <ArrowUpRight size={15}/></button>{accountEntry}</div></header>{about&&<AboutDialog onClose={closeAbout}/>}</>;
}
