import {createHash} from 'node:crypto';
import {boyaMap} from './boya.mjs';

// A public feed only: withdrawn/pending reviews and visitor identities never appear here.
export function homeFeed(db){
  const boya=boyaMap(db);
  const rows=db.prepare(`SELECT ap.nickname AS author_nickname,r.id,r.rating,r.content,r.created_at,g.teachers_raw,g.id AS group_id,
    c.code AS course_code,c.name AS original_name,p.id AS page_id,p.name AS page_name,p.is_series,t.label AS semester_label
    FROM reviews r LEFT JOIN account_members am ON am.user_id=r.user_id LEFT JOIN account_profiles ap ON ap.user_id=am.account_id JOIN effective_groups g ON g.id=r.group_id JOIN effective_courses c ON c.code=g.course_code
    JOIN course_page_members m ON m.course_code=c.code JOIN course_pages p ON p.id=m.page_id
    LEFT JOIN review_terms t ON t.id=r.semester_id
    WHERE r.status='published' ORDER BY r.created_at DESC,r.id DESC LIMIT 8`).all();
  return {reviews:rows.map(r=>({id:r.id,courseId:r.page_id,courseName:r.page_name,
    originalName:r.is_series?r.original_name:null,teacher:r.teachers_raw,boya:boya.get(r.course_code)||null,
    teacherId:r.is_series?'teacher-'+createHash('sha256').update(r.page_id+r.teachers_raw).digest('hex').slice(0,24):r.group_id,
    author:r.author_nickname||'已注销用户',rating:r.rating,excerpt:r.content.length>220?r.content.slice(0,220)+'…':r.content,
    semesterLabel:r.semester_label,createdAt:r.created_at}))};
}
