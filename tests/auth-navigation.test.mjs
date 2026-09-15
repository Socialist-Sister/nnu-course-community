import test from 'node:test';
import assert from 'node:assert/strict';
import {authHref,safeReturnPath} from '../shared/auth-navigation.mjs';

test('auth navigation retains course, teacher, filters and intended admin destination',()=>{
  const destination='/courses?course=1000000015&teacher=example&q=%E9%AB%98%E6%95%B0&sort=rating#reviews';
  for(const page of ['login','register','forgot-password']){
    const url=new URL(authHref(page,destination),'https://coursebook.local');
    assert.equal(url.pathname,'/'+page);
    assert.equal(safeReturnPath(url.searchParams.get('next')),destination);
  }
  assert.equal(safeReturnPath('/admin'),'/admin');
  assert.equal(safeReturnPath('/account'),'/account');
});
test('return links reject external URLs, auth loops and path lookalikes',()=>{
  for(const value of [null,'https://outside.example','//outside.example','/\\outside.example','/\n/outside.example','/login','/register','/forgot-password','/courses-elsewhere','/%2f%2foutside.example'])assert.equal(safeReturnPath(value),'/account');
  assert.equal(safeReturnPath(null,'/courses'),'/courses');
});
