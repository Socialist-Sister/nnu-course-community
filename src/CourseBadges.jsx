import './course-badges.css';
export function CourseBadges({boya}){
  const label=boya?.mode==='online'?'网络博雅':boya?.mode==='interuniversity'?'校际博雅':null;
  return label?<span className="course-mode-badge" title={`${boya.semester} · ${boya.platform}${boya.school?' · '+boya.school:''}`}>{label}</span>:null;
}
export function BoyaSource({boya}){
  if(!boya)return null;
  return <p className="reference-note">2026–2027 学年第一学期博雅开课表 · 按 24 版培养方案分类。{boya.mode==='interuniversity'?`校际联盟网络课 · ${boya.school} · ${boya.platform}。`:boya.mode==='online'?`${boya.platform}网络课。`:'线下博雅课程表。'}<br/>来源：{boya.sourceFile}</p>;
}
