import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULTS,readNavigation,navigationUrl,courseShareUrl,sameFilters} from '../src/navigation.mjs';
test('列表与详情 URL 区分；刷新与后退不会把自动选中的课程误当成详情',()=>{
  const base='https://example.test/',filters={...DEFAULTS,q:'高数 吴老师',department:'大学数学教学部',sort:'rating'};
  const list=navigationUrl(base,filters,'series-math','all',false);
  assert.equal(readNavigation(new URL(list,base)).mobileDetail,false);
  assert.deepEqual(readNavigation(new URL(list,base)).filters,filters);
  const detail=navigationUrl(base,filters,'series-math','teacher-1',true);
  assert.equal(readNavigation(new URL(detail,base)).mobileDetail,true);
  assert.equal(readNavigation(new URL(detail,base)).group,'teacher-1');
  assert.equal(readNavigation('https://example.test/?course=001').mobileDetail,true);
  assert.equal(sameFilters(filters,{...filters}),true);
  assert.equal(sameFilters(filters,{...filters,view:'saved'}),false);
});
test('分享仅带课程及教师，排除本机收藏、搜索、排序、列表状态与锚点',()=>{
  const source='https://example.test/catalog?view=saved&q=高数&department=学院&topic=physics&sort=rating&panel=list&course=old#course-detail';
  assert.equal(courseShareUrl(source,'series-a','teacher-2'),'https://example.test/courses?course=series-a&teacher=teacher-2');
  assert.equal(courseShareUrl(source,'001'),'https://example.test/courses?course=001');
  assert.equal(readNavigation(courseShareUrl(source,'001')).filters.view,'courses');
});
test('旧排序、未知视图降级；移除隐藏旧筛选，分享编码完整',()=>{
  const data=readNavigation('https://example.test/?sort=credits&view=unknown&category=old&semester=old');
  assert.deepEqual(data.filters,DEFAULTS);
  assert.equal(navigationUrl('https://example.test/?old=true',data.filters,'','all',false),'/courses');
  const shared=new URL(courseShareUrl('https://example.test/','编号 / 1','教师 & 2'));
  assert.equal(shared.searchParams.get('course'),'编号 / 1');assert.equal(shared.searchParams.get('teacher'),'教师 & 2');
});
test('首页和课程库有独立地址，兼容旧课程链接',()=>{
  assert.equal(readNavigation('https://example.test/').isHome,true);
  for(const path of ['/courses','/courses?q=高数','/?course=001','/?q=高数','/?view=saved','/?panel=list'])assert.equal(readNavigation('https://example.test'+path).isHome,false);
  assert.equal(readNavigation(new URL(navigationUrl('https://example.test/',DEFAULTS,'','all',false),'https://example.test/')).isHome,false);
});
