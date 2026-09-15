import test from 'node:test';
import assert from 'node:assert/strict';
import {clientIp} from '../server/client-ip.mjs';
const req=(peer,header)=>({socket:{remoteAddress:peer},headers:{'x-real-ip':header}});
test('trusted local proxy keeps distinct visitor addresses',()=>{
  assert.equal(clientIp(req('127.0.0.1','203.0.113.1'),{TRUST_LOCAL_PROXY:'1'}),'203.0.113.1');
  assert.equal(clientIp(req('::1','203.0.113.2'),{TRUST_LOCAL_PROXY:'1'}),'203.0.113.2');
});
test('remote clients and disabled proxy trust cannot spoof their IP',()=>{
  assert.equal(clientIp(req('203.0.113.1','203.0.113.2'),{TRUST_LOCAL_PROXY:'1'}),'203.0.113.1');
  assert.equal(clientIp(req('127.0.0.1','203.0.113.2'),{}),'127.0.0.1');
});
test('malformed or multi-value proxy headers are ignored',()=>{
  for(const header of ['bad','203.0.113.1, 203.0.113.2',['203.0.113.1'],undefined])
    assert.equal(clientIp(req('127.0.0.1',header),{TRUST_LOCAL_PROXY:'1'}),'127.0.0.1');
});
