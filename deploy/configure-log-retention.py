#!/usr/bin/env python3
"""Review a retention change; --apply validates and reloads without deleting logs.

Run as root on the existing Ubuntu host. Backups contain configuration only.
No count or size limit is allowed to discard archives before 200 days.
"""
import argparse
import datetime
import pathlib
import re
import shutil
import subprocess

FORMAT = '''    # nnu-minimal-access: never log args, cookies, referrer or request bodies.
    log_format nnu_minimal escape=json '{"time":"$time_iso8601","ip":"$remote_addr","method":"$request_method","path":"$uri","status":$status,"bytes":$body_bytes_sent,"duration":$request_time}';
'''

def rotation_config(text):
    # Preserve distro ownership, filenames and postrotate/reopen hooks.
    if len(re.findall(r'^\s*(?:daily|weekly|monthly)\s*$', text, re.M)) != 1:
        raise ValueError('Expected one distro rotation stanza; inspect configuration manually')
    if len(re.findall(r'^\s*rotate\s+-?\d+\s*$', text, re.M)) != 1:
        raise ValueError('Expected one rotate directive')
    if re.search(r'^\s*(?:size|maxsize|minsize|hourly|minutes|dateext)\b', text, re.M):
        raise ValueError('Unexpected size/frequency/date rule; inspect before changing')
    text = re.sub(r'^[ \t]*(?:daily|weekly|monthly)[ \t]*$', '\tdaily', text, flags=re.M)
    text = re.sub(r'^[ \t]*rotate[ \t]+-?\d+[ \t]*$', '\trotate -1', text, flags=re.M)
    text = re.sub(r'^[ \t]*(?:maxage|minage)[ \t]+\d+[ \t]*\n?', '', text, flags=re.M)
    text = text.replace('\trotate -1', '\trotate -1\n\tmaxage 200\n\tminage 1')
    if not re.search(r'^\s*compress\s*$', text, re.M):
        text = text.replace('\trotate -1', '\tcompress\n\trotate -1')
    return text

def nginx_config(text):
    pattern = r'^[ \t]*access_log\s+/var/log/nginx/access\.log(?:\s+\w+)?\s*;'
    if len(re.findall(pattern, text, re.M)) != 1:
        raise ValueError('Expected one global access_log directive')
    if 'log_format nnu_minimal ' not in text:
        text = re.sub(pattern, lambda m: FORMAT + m.group(), text, count=1, flags=re.M)
    return re.sub(pattern, '    access_log /var/log/nginx/access.log nnu_minimal;', text, flags=re.M)

def rsyslog_config(text):
    marker = '# NNU security logs: 200 days\n'
    if marker in text:
        original, protected = text.split(marker, 1)
        return original + marker + rotation_config(protected)
    header, body = text.split('{', 1)
    files = header.split()
    security = ['/var/log/syslog', '/var/log/kern.log', '/var/log/auth.log']
    if not all(f in files for f in security) or any(not f.startswith('/var/log/') for f in files):
        raise ValueError('Unexpected rsyslog file list')
    remaining = [f for f in files if f not in security]
    original = '\n'.join(remaining) + '\n{' + body if remaining else ''
    protected = rotation_config('\n'.join(security) + '\n{' + body)
    return original.rstrip() + '\n\n' + marker + protected

def run(*args):
    return subprocess.run(args, check=True, capture_output=True, text=True).stdout

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    paths = [pathlib.Path(p) for p in ['/etc/nginx/nginx.conf', '/etc/logrotate.d/nginx', '/etc/logrotate.d/rsyslog']]
    before = {p: p.read_text() for p in paths}
    # Site-level overrides would escape the global minimal format.
    effective = subprocess.run(['nginx', '-T'], check=True, capture_output=True, text=True).stdout
    directives = re.findall(r'^\s*access_log\s+[^;]+;', effective, re.M)
    if len(directives) != 1 or '/var/log/nginx/access.log' not in directives[0]:
        raise ValueError('Unexpected access_log overrides; inspect live sites before applying')
    if '/var/log/auth.log' not in before[paths[2]] or '/var/log/syslog' not in before[paths[2]]:
        raise ValueError('Expected authentication and system log files in rsyslog rotation')
    run('systemctl', 'is-active', 'rsyslog.service')
    run('systemctl', 'is-active', 'logrotate.timer')
    after = {paths[0]: nginx_config(before[paths[0]]), paths[1]: rotation_config(before[paths[1]]), paths[2]: rsyslog_config(before[paths[2]])}
    print('Scope: nginx access/error and rsyslog system/authentication logs; daily, compressed, maxage 200, rotate -1.')
    print('Access fields: time, IP, method, path without query, status, bytes, duration. No raw log content printed.')
    if not args.apply:
        print('DRY RUN: configuration parsed, no changes made.'); return
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    backup = pathlib.Path('/etc/nnu-course/log-config-backups') / stamp
    backup.mkdir(parents=True, mode=0o700)
    backup.parent.chmod(0o700)
    for p in paths:
        shutil.copy2(p, backup / p.name)
    try:
        for p, content in after.items():
            p.write_text(content)
        run('nginx', '-t')
        run('logrotate', '--debug', '/etc/logrotate.conf')
        run('systemctl', 'reload', 'nginx')
    except Exception:
        for p in paths:
            shutil.copy2(backup / p.name, p)
        run('nginx', '-t')
        run('systemctl', 'reload', 'nginx')
        raise
    print('Applied and validated. No forced rotation or deletion. Configuration backup:', backup)

if __name__ == '__main__':
    main()
