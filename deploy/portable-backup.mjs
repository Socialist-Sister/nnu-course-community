// Standalone Node.js 24 tool; no npm packages or Windows identity required.
import {constants, createCipheriv, createDecipheriv, createHash, createPublicKey, generateKeyPairSync, privateDecrypt, publicEncrypt, randomBytes} from 'node:crypto';
import {copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const magic = Buffer.from('NNUCR-PORTABLE-1\n');
const fingerprint = key => createHash('sha256').update(createPublicKey(key).export({type:'spki',format:'der'})).digest('hex');
const rsaOptions = key => ({key, padding:constants.RSA_PKCS1_OAEP_PADDING, oaepHash:'sha256'});

export function encryptBackup(plain, publicKey) {
  const key = randomBytes(32), iv = randomBytes(12);
  try {
    const header = Buffer.from(JSON.stringify({keyId:fingerprint(publicKey), iv:iv.toString('base64'), wrappedKey:publicEncrypt(rsaOptions(publicKey),key).toString('base64')}));
    const length = Buffer.alloc(4); length.writeUInt32BE(header.length);
    const prefix = Buffer.concat([magic,length,header]);
    const cipher = createCipheriv('aes-256-gcm',key,iv); cipher.setAAD(prefix);
    return Buffer.concat([prefix,cipher.update(plain),cipher.final(),cipher.getAuthTag()]);
  } finally { key.fill(0); }
}

export function decryptBackup(encrypted, privateKey) {
  if (encrypted.length < magic.length+4+16 || !encrypted.subarray(0,magic.length).equals(magic)) throw Error('Unknown or truncated backup format.');
  const size = encrypted.readUInt32BE(magic.length), end = magic.length+4+size;
  if (size > 8192 || end > encrypted.length-16) throw Error('Invalid backup header.');
  const header = JSON.parse(encrypted.subarray(magic.length+4,end).toString('utf8'));
  if (header.keyId !== fingerprint(privateKey)) throw Error('This recovery key belongs to a different backup set.');
  const iv = Buffer.from(header.iv,'base64'), wrapped = Buffer.from(header.wrappedKey,'base64');
  if (iv.length !== 12 || wrapped.length !== 384) throw Error('Invalid encryption parameters.');
  const key = privateDecrypt(rsaOptions(privateKey),wrapped);
  try {
    const decipher = createDecipheriv('aes-256-gcm',key,iv);
    decipher.setAAD(encrypted.subarray(0,end)); decipher.setAuthTag(encrypted.subarray(-16));
    // Authenticate everything before returning/writing any plaintext.
    return Buffer.concat([decipher.update(encrypted.subarray(end,-16)),decipher.final()]);
  } finally { key.fill(0); }
}

export function writeNew(path, bytes) { writeFileSync(path,bytes,{flag:'wx',mode:0o600}); }

export function initializeRecoveryKit(folder) {
  if (existsSync(folder)) throw Error('Recovery kit already exists; refusing to replace keys.');
  mkdirSync(dirname(folder),{recursive:true,mode:0o700});
  const staging = mkdtempSync(join(dirname(folder),'.recovery-kit-'));
  try {
    const {publicKey,privateKey} = generateKeyPairSync('rsa',{modulusLength:3072,publicKeyEncoding:{type:'spki',format:'pem'},privateKeyEncoding:{type:'pkcs8',format:'pem'}});
    const sample = randomBytes(4096);
    if (!decryptBackup(encryptBackup(sample,publicKey),privateKey).equals(sample)) throw Error('Recovery self-test failed.');
    writeNew(join(staging,'public.pem'),publicKey);
    writeNew(join(staging,'recovery-private.pem'),privateKey);
    copyFileSync(fileURLToPath(import.meta.url),join(staging,'portable-backup.mjs'));
    writeNew(join(staging,'README.txt'),`南师选课簿备份恢复工具\n\n密钥编号：${fingerprint(publicKey)}\n\n将整个文件夹另存到加密 U 盘或密码管理器。不要发到群里、GitHub 或普通共享网盘。\nrecovery-private.pem 是解密钥匙，拿到它和备份的人可以读取数据库。请与备份分开保管。\n\n换电脑：安装 Node.js 24，准备 .nnu-backup 文件，然后在此目录运行：\nnode portable-backup.mjs decrypt \"备份文件.nnu-backup\" recovery-private.pem \"restored.sqlite\"\n\n输出必须是尚不存在的文件。该命令只解密，不覆盖线上数据库。\n恢复后先用项目 deploy/restore-drill.mjs --source 检查，再决定正式恢复。\n日常备份只需 public.pem；确认离线保存后可移走本机 recovery-private.pem。不要删除 public.pem。\n旧 .dpapi 备份仍需要原 Windows 账号，不能用本钥匙解密。\n`);
    renameSync(staging,folder);
    return {keyId:fingerprint(publicKey)};
  } finally { if (existsSync(staging)) rmSync(staging,{recursive:true}); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [command,input,keyFile,output] = process.argv.slice(2);
    if (command === 'init' && input && !keyFile) console.log(JSON.stringify(initializeRecoveryKit(resolve(input))));
    else if (['encrypt','decrypt'].includes(command) && input && keyFile && output && process.argv.length === 6) {
      const result = command === 'encrypt' ? encryptBackup(readFileSync(input),readFileSync(keyFile)) : decryptBackup(readFileSync(input),readFileSync(keyFile));
      writeNew(output,result); console.log(command === 'decrypt' ? 'Backup authenticated and decrypted to a new file.' : 'Portable backup created.');
    } else throw Error('Usage: node portable-backup.mjs init <private-kit-directory> | encrypt|decrypt <input> <key.pem> <new-output>');
  } catch(error) { console.error(error.message); process.exitCode=1; }
}
