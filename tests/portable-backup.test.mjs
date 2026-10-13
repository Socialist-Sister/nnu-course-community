import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,randomBytes} from 'node:crypto';
import {mkdtempSync,readFileSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {encryptBackup,decryptBackup,initializeRecoveryKit,writeNew} from '../deploy/portable-backup.mjs';
const keys=()=>generateKeyPairSync('rsa',{modulusLength:3072,publicKeyEncoding:{type:'spki',format:'pem'},privateKeyEncoding:{type:'pkcs8',format:'pem'}});
const {publicKey,privateKey}=keys();
test('portable backup preserves binary bytes and uses fresh encryption',()=>{
  const plain=randomBytes(65536),first=encryptBackup(plain,publicKey),second=encryptBackup(plain,publicKey);
  assert.notDeepEqual(first,second);assert.deepEqual(decryptBackup(first,privateKey),plain);
  assert.deepEqual(decryptBackup(encryptBackup(Buffer.alloc(0),publicKey),privateKey),Buffer.alloc(0));
});
test('wrong recovery keys and altered/truncated ciphertext are rejected',()=>{
  const original=encryptBackup(randomBytes(5000),publicKey);
  assert.throws(()=>decryptBackup(original,keys().privateKey),/different backup set/);
  for(const position of [0,20,original.length-20,original.length-1]){
    const bad=Buffer.from(original);bad[position]^=1;assert.throws(()=>decryptBackup(bad,privateKey));
  }
  for(const size of [0,10,30,original.length-1])assert.throws(()=>decryptBackup(original.subarray(0,size),privateKey));
});
test('recovery kit is standalone, never overwrites keys or outputs, and writes no unauthenticated plaintext',()=>{
  const root=mkdtempSync(join(tmpdir(),'nnu-portable-test-'));
  try{
    const kit=join(root,'kit');initializeRecoveryKit(kit);
    const keyFile=join(kit,'recovery-private.pem'),saved=readFileSync(keyFile);
    assert.throws(()=>initializeRecoveryKit(kit),/already exists/);assert.deepEqual(readFileSync(keyFile),saved);
    const input=join(root,'input'),encrypted=join(root,'backup'),restored=join(root,'restored');
    writeNew(input,randomBytes(10000));
    const cli=join(kit,'portable-backup.mjs');
    const run=(...args)=>spawnSync(process.execPath,[cli,...args],{encoding:'utf8',cwd:root});
    assert.equal(run('encrypt',input,join(kit,'public.pem'),encrypted).status,0);
    assert.equal(run('decrypt',encrypted,keyFile,restored).status,0);
    assert.deepEqual(readFileSync(input),readFileSync(restored));
    assert.notEqual(run('decrypt',encrypted,keyFile,restored).status,0);
    const tampered=readFileSync(encrypted);tampered[tampered.length-1]^=1;writeNew(join(root,'bad'),tampered);
    assert.notEqual(run('decrypt',join(root,'bad'),keyFile,join(root,'should-not-exist')).status,0);
    assert.equal(existsSync(join(root,'should-not-exist')),false);
  }finally{rmSync(root,{recursive:true,force:true});}
});
