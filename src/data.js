// Illustrative data only. Keep course, offering and review identities separate
// so a future web API and WeChat client can consume the same domain model.
export const courses = [
  { id: 'math', code: 'DEMO-MATH101', name: '线性代数', college: '数学科学学院', type: '专业必修', teacher: '陈老师', count: 28, score: 4.6 },
  { id: 'english', code: 'DEMO-ENG102', name: '大学英语（进阶）', college: '外国语学院', type: '通识必修', teacher: '李老师', count: 43, score: 4.2 },
  { id: 'psych', code: 'DEMO-PSY101', name: '心理学导论', college: '教育科学学院', type: '通识选修', teacher: '周老师', count: 28, score: 4.6 },
  { id: 'literature', code: 'DEMO-LIT201', name: '中国古代文学', college: '文学院', type: '专业必修', teacher: '王老师', count: 21, score: 4.7 },
  { id: 'python', code: 'DEMO-CS101', name: 'Python 程序设计', college: '计算机与电子信息学院', type: '通识选修', teacher: '赵老师', count: 12, score: 4.4 },
];
export const semesters = ['2026秋', '2026春', '2025秋', '2025春'];
const comments = {
  psych: [
    '周老师讲得非常清晰，把很多心理学经典概念用生活中的例子讲明白了，课堂氛围很轻松，会引导大家思考和讨论。课程内容覆盖面广，对入门很友好。每周的小测和作业量不大，但能帮助巩固知识。\n期末是开卷论文，给了足够的选题空间，建议尽早确定主题并多结合案例，收获会更大。',
    '老师很亲切，PPT 和补充资料都很完整。课堂互动比较多，节奏不紧。\n内容讲得特别深入，但作为通识课很合适，能引发兴趣。作业主要是读书报告和小组展示，小组任务需要花一些时间协调，可以提前分工。',
    '印象最深的是课堂案例讨论。课前花一点时间阅读材料，上课就更容易跟上。评价基于我修读时的安排，后续考核方式请以老师最新说明为准。',
  ],
  math: ['板书清晰，逻辑严谨，例题会从基础讲到进阶。每周需要留出时间做题，建议把错题重新整理一遍。期末复习时课堂笔记很有帮助。', '课程节奏比较快，矩阵部分最好提前预习。老师答疑很耐心，小测能帮助发现理解上的漏洞，认真跟下来收获很大。'],
  english: ['课堂有较多口语讨论和平时展示，需要主动参与。每周有阅读和听力练习，积累下来能感觉到进步，建议尽早准备小组展示。', '对写作结构的讲解很实用，会给作业反馈。课前预习能让课堂讨论更顺畅，考核安排以当学期教学要求为准。'],
  literature: ['阅读量比较大，但课堂讲解很有启发。老师会把作品放回时代背景里分析，建议边读边做笔记，期末论文需要提前准备。', '喜欢文学的同学应该会有收获。课堂不仅分析文本，也会讨论不同的解读。每周预留阅读时间，期末就不会太仓促。'],
  python: ['从基础语法逐渐过渡到小项目，没有编程基础也能跟上。建议作业自己动手完成，调试时学到的东西比只看示例多很多。', '上机练习很实用，老师会讲常见报错的排查方法。最后的课程项目要提前开始，和同学讨论思路也很有帮助。'],
};
export const offerings = courses.flatMap(c => [
  { id: `${c.id}-spring`, courseId: c.id, teacher: c.teacher, semester: '2026春' },
  { id: `${c.id}-old`, courseId: c.id, teacher: c.teacher, semester: '2025秋' },
  { id: `${c.id}-other`, courseId: c.id, teacher: '林老师', semester: '2025春' },
]);
export const initialReviews = courses.flatMap(c => [
  ...Array.from({ length: c.count }, (_, i) => ({
    id: `${c.id}-${i}`, offeringId: `${c.id}-spring`,
    rating: c.id === 'psych' && i === 0 ? 4.5 : c.id === 'psych' && i === 1 ? 4 : i < Math.round((c.score - 4) * c.count) ? 5 : 4,
    gain: i % 3 === 2 ? 4 : 5, difficulty: '适中', workload: '适中',
    content: comments[c.id][i % comments[c.id].length],
    date: i === 0 ? '2026-09-05' : i === 1 ? '2026-09-03' : `2026-08-${String(30 - (i % 28)).padStart(2, '0')}`,
    helpful: i === 0 ? 12 : i === 1 ? 8 : i % 7, author: '匿名同学', mine: false,
  })),
  { id: `${c.id}-archive`, offeringId: `${c.id}-old`, rating: 4, gain: 4, difficulty: '偏难', workload: '较多', content: '这条评价来自较早的修读学期。当时的课程需要每周完成阅读和小组练习，建议先了解本学期的课程安排，再结合自己的时间决定。', date: '2025-12-20', helpful: 3, author: '匿名同学', mine: false },
  { id: `${c.id}-alternate`, offeringId: `${c.id}-other`, rating: 3.5, gain: 4, difficulty: '适中', workload: '较多', content: '老师讲解很细致，但课后需要花时间整理笔记。这是我在2025春的体验，授课内容和考核方式可能已经调整，请结合近期评价判断。', date: '2025-06-28', helpful: 2, author: '匿名同学', mine: false },
]);
export function summarize(reviews) {
  const average = key => reviews.length ? (reviews.reduce((n, r) => n + r[key], 0) / reviews.length).toFixed(1) : null;
  const mode = key => reviews.length ? Object.entries(reviews.reduce((a, r) => ({ ...a, [r[key]]: (a[r[key]] || 0) + 1 }), {})).sort((a, b) => b[1] - a[1])[0][0] : '暂无';
  return { count: reviews.length, score: average('rating'), gain: average('gain'), difficulty: mode('difficulty'), workload: mode('workload'), latest: reviews.map(r => r.date).sort().at(-1) };
}
