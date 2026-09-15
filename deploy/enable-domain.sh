#!/usr/bin/env bash
set -euo pipefail
/opt/certbot/bin/certbot certonly --non-interactive --agree-tos --register-unsafely-without-email \
  --webroot -w /var/www/acme -d nnucr.cn -d www.nnucr.cn --cert-name nnu-domain
backup="/etc/nginx/sites-available/nnu-course.before-domain-$(date -u +%Y%m%dT%H%M%SZ)"
cp /etc/nginx/sites-available/nnu-course "$backup"
install -m 644 /home/azureuser/nnu-upload/nginx-domain.conf /etc/nginx/sites-available/nnu-course
if ! nginx -t; then
  cp "$backup" /etc/nginx/sites-available/nnu-course
  exit 1
fi
systemctl reload nginx
curl --fail --silent --show-error https://nnucr.cn/api/health
printf '\n'
systemctl is-active nnu-course nginx nnu-cert-renew.timer
