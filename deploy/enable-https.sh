#!/usr/bin/env bash
set -euo pipefail
/opt/certbot/bin/certbot certonly --staging --non-interactive --agree-tos --register-unsafely-without-email \
  --required-profile shortlived --webroot -w /var/www/acme --ip-address 20.2.136.131 \
  --cert-name nnu-ip --config-dir /etc/letsencrypt-staging --work-dir /var/lib/letsencrypt-staging --logs-dir /var/log/letsencrypt-staging
/opt/certbot/bin/certbot certonly --non-interactive --agree-tos --register-unsafely-without-email \
  --required-profile shortlived --webroot -w /var/www/acme --ip-address 20.2.136.131 --cert-name nnu-ip
install -m 644 /opt/nnu-course/current/deploy/nginx-https.conf /etc/nginx/sites-available/nnu-course
nginx -t
systemctl reload nginx
systemctl enable --now nnu-cert-renew.timer
curl --fail --silent --show-error https://20.2.136.131/api/health
printf '\n'
