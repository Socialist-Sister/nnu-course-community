#!/usr/bin/env bash
# Upload app.tar.gz to the private nnu-upload directory before running as root.
# This updates code only; it never imports a local database or changes mail config.
set -euo pipefail
previous=$(readlink -f /opt/nnu-course/current)
release="/opt/nnu-course/releases/$(date -u +%Y%m%dT%H%M%SZ)"
test -f /home/azureuser/nnu-upload/app.tar.gz
install -d -m 755 "$release"
tar -xzf /home/azureuser/nnu-upload/app.tar.gz -C "$release" --no-same-owner
cd "$release"
npm ci --omit=dev --ignore-scripts --no-audit --no-fund
node --input-type=module -e 'import sharp from "sharp"; await sharp({create:{width:1,height:1,channels:3,background:"white"}}).webp().toBuffer(); console.log("Avatar image runtime ready");'
chmod -R go-w "$release"
systemctl start nnu-backup.service
ln -sfn "$release" /opt/nnu-course/current
systemctl restart nnu-course
if ! curl --fail --silent --show-error --retry 5 --retry-connrefused --retry-delay 2 http://127.0.0.1:4180/api/health; then
  ln -sfn "$previous" /opt/nnu-course/current
  systemctl restart nnu-course
  echo 'Health check failed; previous code restored. Database was not rolled back.' >&2
  exit 1
fi
printf '\nRelease active: %s\n' "$release"
