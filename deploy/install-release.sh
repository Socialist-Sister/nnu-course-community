#!/usr/bin/env bash
set -euo pipefail
bundle=/home/azureuser/nnu-upload
release="/opt/nnu-course/releases/$(date -u +%Y%m%dT%H%M%SZ)"
install -d -m 755 "$release"
tar -xzf "$bundle/app.tar.gz" -C "$release" --no-same-owner
cd "$release"
npm ci --omit=dev --ignore-scripts --no-audit --no-fund
chmod -R go-w "$release"
if [ ! -e /var/lib/nnu-course/catalog.sqlite ]; then
  install -o nnu-app -g nnu-app -m 600 "$bundle/catalog.sqlite" /var/lib/nnu-course/catalog.sqlite
  if [ -f "$bundle/admin-setup-code.txt" ]; then
    install -o nnu-app -g nnu-app -m 600 "$bundle/admin-setup-code.txt" /var/lib/nnu-course/admin-setup-code.txt
  fi
else
  echo 'Existing database preserved.'
fi
install -m 600 "$bundle/app.env" /etc/nnu-course/app.env
ln -sfn "$release" /opt/nnu-course/current
for unit in nnu-course.service nnu-backup.service nnu-backup.timer nnu-cert-renew.service nnu-cert-renew.timer; do
  install -m 644 "deploy/$unit" "/etc/systemd/system/$unit"
done
install -m 644 deploy/nginx-http.conf /etc/nginx/sites-available/nnu-course
if [ -L /etc/nginx/sites-enabled/default ]; then unlink /etc/nginx/sites-enabled/default; fi
ln -sfn /etc/nginx/sites-available/nnu-course /etc/nginx/sites-enabled/nnu-course
nginx -t
systemctl daemon-reload
systemctl enable --now nnu-course.service nnu-backup.timer
systemctl restart nnu-course.service
systemctl reload nginx
systemctl start nnu-backup.service
curl --fail --silent --show-error --retry 5 --retry-connrefused --retry-delay 2 http://127.0.0.1:4180/api/health
printf '\n'
# Only remove the temporary uploaded secret copies, leaving app/data snapshots.
rm -f "$bundle/app.env" "$bundle/admin-setup-code.txt"
