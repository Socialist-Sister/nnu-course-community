#!/usr/bin/env bash
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq nginx ca-certificates curl xz-utils python3-venv sqlite3
if ! swapon --show=NAME --noheadings | grep -q .; then
  if [ ! -e /swapfile ]; then
    fallocate -l 1G /swapfile
    chmod 600 /swapfile
    mkswap /swapfile
    swapon /swapfile
    printf '\n/swapfile none swap sw 0 0\n' >> /etc/fstab
  fi
fi
if ! /usr/local/bin/node --version 2>/dev/null | grep -q '^v24\.'; then
  work=$(mktemp -d)
  cd "$work"
  curl --fail --silent --show-error https://nodejs.org/dist/index.json -o index.json
  version=$(python3 -c 'import json; print(next(v["version"] for v in json.load(open("index.json")) if v["version"].startswith("v24.")))')
  archive="node-${version}-linux-x64.tar.xz"
  curl --fail --silent --show-error "https://nodejs.org/dist/${version}/${archive}" -o "$archive"
  curl --fail --silent --show-error "https://nodejs.org/dist/${version}/SHASUMS256.txt" -o SHASUMS256.txt
  grep " ${archive}$" SHASUMS256.txt | sha256sum -c -
  tar -xJf "$archive" -C /usr/local --strip-components=1
fi
if [ ! -x /opt/certbot/bin/certbot ]; then
  python3 -m venv /opt/certbot
  /opt/certbot/bin/pip install --quiet 'certbot>=5.4,<6'
fi
id nnu-app >/dev/null 2>&1 || useradd --system --home-dir /var/lib/nnu-course --shell /usr/sbin/nologin nnu-app
install -d -m 755 /opt/nnu-course/releases /var/www/acme/.well-known/acme-challenge
install -d -o nnu-app -g nnu-app -m 700 /var/lib/nnu-course /var/lib/nnu-course/backups
install -d -o root -g root -m 700 /etc/nnu-course
node --version
/opt/certbot/bin/certbot --version
