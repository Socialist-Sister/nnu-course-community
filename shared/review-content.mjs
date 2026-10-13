// User-requested light-touch review screening: explicit abuse and narrow harmful
// promotions, not a general sensitive-word list. Keep ordinary criticism available.
// No third-party service, historical sweep, server storage of rejections or account penalty.
const gap = '[ \\t._*·-]{0,3}';
const literal = word => [...word].join(gap);
const words = list => new RegExp(list.map(literal).join('|'), 'iu');
const rules = [
  {category:'辱骂', pattern:words([
    '傻逼','傻屄','煞笔','傻叉','脑残玩意','脑残东西',
    '操你妈','草你妈','艹你妈','日你妈','去你妈的','他妈的','妈了个逼',
    '狗娘养的','狗杂种','狗东西','婊子','贱人','畜生不如',
    '死全家','全家死光','你妈死了',
  ])},
  // Ambiguous words/abbreviations only match direct personal insults. USB/SB
  // notation, 垃圾分类/垃圾课程, 变态反应 and disability-related study remain valid.
  {category:'辱骂', pattern:/(?:你|他|她|您|老师|教師|教师|教授|助教)(?:就是个?|是个?|真是个?|这个|这|個|个|真|太)?[ \t]*(?:垃圾|废物|廢物|人渣|智障|脑残|腦殘|畜生|蠢货|蠢貨|s[ ._*·-]{0,3}b)(?=$|[\s\p{P}]|[啊呀吧吗嗎呢]|玩意|东西|東西)/iu},
  {category:'辱骂', pattern:/(?:垃圾|废物|廢物|人渣|脑残|腦殘|傻逼|蠢货)(?:老师|教師|教师|教授|助教)/u},
  {category:'辱骂', pattern:/(?:fuck[ \t]+you|son[ \t]+of[ \t]+a[ \t]+bitch)(?![a-z])/iu},
  {category:'暴力威胁', pattern:/(?:杀了|殺了|杀死|殺死|弄死|砍死|捅死|打死)(?:你们|你|妳|您|全家)|(?:你|妳|您)(?:怎么|怎麼)?(?:还不|還不|赶紧|趕緊|给我|給我|去)(?:去)?死/u},
  {category:'血腥暴力传播', pattern:/(?:出售|售卖|售賣|购买|購買|求购|求購)(?:真实|真實|真人)?(?:虐杀|虐殺|肢解|斩首|斬首)(?:视频|視頻|录像|錄像|图片|圖片)/u},
  {category:'色情招揽', pattern:/(?:出售|售卖|售賣|购买|購買|求购|求購|提供)(?:无码|無碼|高清|未成年)?(?:黄片|黃片|色情视频|色情視頻|色情资源|色情資源)|(?:加我|联系我|聯繫我|私聊我|扫码|掃碼)(?:看|领|領|获取|獲取)?(?:黄片|黃片|色情资源|色情資源|裸聊|约炮|約炮)/u},
  {category:'疑似诈骗招揽', pattern:/(?:加我|联系我|聯繫我|私聊我)(?:做|参与|參與)?(?:刷单返利|刷單返利|刷单兼职|刷單兼職|跑分洗钱|跑分洗錢)|(?:刷单返利|刷單返利|跑分洗钱|跑分洗錢)(?:请|請)?(?:加我|联系我|聯繫我|私聊我)|(?:保证|保證|承诺|承諾)稳赚不赔(?:[，, ]{0,2})(?:加我|联系我|私聊我)/u},
];

export function reviewContentIssue(content){
  if(typeof content!=='string')return null;
  // Width/case and invisible-character normalization catch simple evasions without
  // stripping all punctuation or joining unrelated sentences into banned words.
  const text=content.normalize('NFKC').replace(/[\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/gu,'');
  for(const {category,pattern} of rules){
    const match=pattern.exec(text);
    if(match)return {category,fragment:match[0].slice(0,60)};
  }
  return null;
}

export function reviewContentMessage(issue){
  return `检测到疑似${issue.category}内容：“${issue.fragment}”。请修改后再发布；如有误判，可通过“联系与反馈”告知维护者。填写内容已保留。`;
}
