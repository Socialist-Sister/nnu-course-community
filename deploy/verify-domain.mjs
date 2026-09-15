import assert from 'node:assert/strict';
const base='https://nnucr.cn';
const path='/courses?course=1000000015&teacher=test';
for (const origin of ['http://nnucr.cn','http://www.nnucr.cn','https://www.nnucr.cn','http://20.2.136.131','https://20.2.136.131']) {
  const response=await fetch(origin+path,{redirect:'manual'});
  assert.equal(response.status,308,origin);
  assert.equal(response.headers.get('location'),base+path,origin);
}
for(const route of ['/','/login','/register','/forgot-password','/api/health','/api/courses?q='+encodeURIComponent('高数')]) {
  const response=await fetch(base+route);
  assert.equal(response.status,200,route);
}
const response=await fetch(base+'/api/session');
const cookie=response.headers.get('set-cookie');
assert.match(cookie,/; Secure/);
const session=await response.json();
// Invalid credentials exercise the legitimate domain's CSRF/origin path
// without creating an account or sending email.
const rejected=await fetch(base+'/api/account/login',{method:'POST',headers:{Origin:base,'Content-Type':'application/json',Cookie:cookie.split(';')[0],'X-CSRF-Token':session.csrf},body:JSON.stringify({identifier:'',password:''})});
assert.ok([400,401].includes(rejected.status),'same-origin request must reach login validation');
const crossOrigin=await fetch(base+'/api/account/login',{method:'POST',headers:{Origin:'https://example.invalid','Content-Type':'application/json',Cookie:cookie.split(';')[0],'X-CSRF-Token':session.csrf},body:'{}'});
assert.equal(crossOrigin.status,403);
console.log('PASS: trusted HTTPS; 5 redirects preserve path/query; all pages and search; Secure cookies; same-origin login; cross-origin rejection.');
