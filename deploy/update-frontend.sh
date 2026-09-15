#!/usr/bin/env bash
# Frontend-only release: keep the backend process and live database untouched.
set -euo pipefail
stamp=$(date -u +%Y%m%dT%H%M%SZ)
staging="/home/azureuser/nnu-upload/frontend-$stamp"
target="$(readlink -f /opt/nnu-course/current)/dist/client"
backup="/opt/nnu-course/frontend-backups/$stamp"
install -d -m 700 "$staging" "$backup"
tar -xzf /home/azureuser/nnu-upload/frontend.tar.gz -C "$staging" --no-same-owner
test -f "$staging/index.html"
test -d "$staging/assets"
cp "$target/index.html" "$backup/index.html"
install -d -m 755 "$target/assets"
cp -a "$staging/assets/." "$target/assets/"
chmod -R a+rX "$target/assets"
install -m 644 "$staging/index.html" "$target/index.html.next"
mv -T "$target/index.html.next" "$target/index.html"
curl --fail --silent --show-error http://127.0.0.1:4180/api/health
printf '\nFrontend deployed; previous HTML: %s/index.html\n' "$backup"
