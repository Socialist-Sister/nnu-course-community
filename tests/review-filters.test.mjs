import {test} from 'node:test';
import assert from 'node:assert/strict';
import {notificationFixture} from './notification-fixture.mjs';

test('评价排序在分页前执行，学期筛选与教师组合且不暴露隐藏评价',async t=>{
  const f=await notificationFixture();t.after(()=>f.close());
  const original=f.db.prepare('SELECT * FROM reviews WHERE id=?').get(f.reviewId);
  f.db.prepare('INSERT OR IGNORE INTO review_terms VALUES(?,?)').run('2025-2026-2','2025–2026 学年第 2 学期');
  const terms=f.db.prepare('SELECT id FROM review_terms ORDER BY id DESC LIMIT 2').all();
  assert.equal(terms.length,2);
  for(let i=0;i<24;i++){
    const id=`filter-${String(i).padStart(2,'0')}`,user=`filter-user-${i}`,time=`2026-09-${String(i+1).padStart(2,'0')}T00:00:00.000Z`;
    f.db.prepare('INSERT INTO users VALUES(?,?,?)').run(user,user,time);
    f.db.prepare('INSERT INTO reviews VALUES(?,?,?,?,?,?,?,?,?,?)').run(id,user,original.group_id,i%2?terms[0].id:terms[1].id,4,'排序筛选测试',1,i===23?'pending':'published',time,time);
  }
  f.db.prepare('INSERT INTO review_helpful VALUES(?,?,?)').run('filter-00','notify_reporter',original.created_at);
  f.db.prepare('INSERT INTO review_helpful VALUES(?,?,?)').run('filter-01','notify_owner',original.created_at);
  f.db.prepare('INSERT INTO review_helpful VALUES(?,?,?)').run('filter-23','notify_reporter',original.created_at);
  const path='/api/courses/1000000015/reviews';
  const latest=(await f.call(null,path)).data;
  assert.equal(latest.total,24);assert.equal(latest.items.length,20);assert.equal(latest.totalPages,2);
  assert.equal(latest.items.some(r=>r.id==='filter-00'),false);
  const helpful=(await f.call(null,path+'?sort=helpful')).data;
  assert.deepEqual(helpful.items.slice(0,2).map(r=>r.id),['filter-01','filter-00']);
  const second=(await f.call(null,path+'?sort=helpful&page=2')).data;
  assert.equal(second.items.length,4);assert.equal(new Set([...helpful.items,...second.items].map(r=>r.id)).size,24);
  assert.ok(![...helpful.items,...second.items].some(r=>r.id==='filter-23'));
  const filtered=(await f.call(null,path+'?'+new URLSearchParams({sort:'helpful',semester:terms[1].id,teacher:original.group_id}))).data;
  assert.equal(filtered.total,12);assert.equal(filtered.totalPages,1);assert.equal(filtered.items[0].id,'filter-00');
  assert.ok(filtered.items.every(r=>r.semesterId===terms[1].id));
  const unspecified=(await f.call(null,path+'?semester=none')).data;
  assert.equal(unspecified.total,1);assert.equal(unspecified.items[0].id,f.reviewId);
  assert.ok(unspecified.terms.some(t=>t.id===terms[0].id));
  for(const query of ['sort=bad','semester=bad','sort=helpful&page=0'])assert.equal((await f.call(null,path+'?'+query)).status,400);
});
