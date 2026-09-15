#!/usr/bin/env python3
"""Read-only production checks; forced rotation is limited to synthetic temp files."""
import gzip,json,os,pathlib,subprocess,tempfile,time,urllib.request,uuid
marker='nnu-log-check-'+uuid.uuid4().hex
with urllib.request.urlopen('https://nnucr.cn/api/health?retention_check='+marker,timeout=15) as r:
 assert r.status==200
with open('/var/log/nginx/access.log','rb') as f:
 f.seek(0,2);f.seek(max(0,f.tell()-65536));lines=f.read().decode(errors='replace').splitlines()
records=[]
for line in lines:
 try:records.append(json.loads(line))
 except ValueError:pass
assert records and records[-1]['path']=='/api/health'
assert marker not in json.dumps(records)
assert set(records[-1])=={'time','ip','method','path','status','bytes','duration'}
print('Public health and query-free access logging: PASS')
with tempfile.TemporaryDirectory(prefix='nnu-logrotate-check-') as directory:
 p=pathlib.Path(directory);active=p/'sample.log';active.write_text('active\n');os.utime(active,(time.time()-2*86400,)*2)
 for suffix,age,value in [('1.gz',199,'recent'),('2.gz',201,'expired')]:
  target=p/('sample.log.'+suffix)
  with gzip.open(target,'wt') as f:f.write(value)
  os.utime(target,(time.time()-age*86400,)*2)
 config=p/'rotate.conf';config.write_text(str(active)+' {\n daily\n rotate -1\n maxage 200\n minage 1\n compress\n missingok\n notifempty\n}\n');config.chmod(0o600)
 subprocess.run(['logrotate','--force','--state',str(p/'state'),str(config)],check=True,capture_output=True)
 contents=[]
 for target in p.glob('sample.log*.gz'):
  with gzip.open(target,'rt') as f:contents.append(f.read())
 assert 'recent' in contents and 'expired' not in contents, contents
 print('Isolated retention: 199-day archive preserved; 201-day archive removed: PASS')
for service in ['nginx.service','rsyslog.service','logrotate.timer']:
 subprocess.run(['systemctl','is-active','--quiet',service],check=True)
for name in ['/var/log/nginx/access.log','/var/log/nginx/error.log','/var/log/auth.log','/var/log/syslog']:
 assert pathlib.Path(name).stat().st_mode & 0o007 == 0,name
print('Services, rotation timer and non-public log permissions: PASS')
