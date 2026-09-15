#!/usr/bin/env bash
set -euo pipefail
# Configure /etc/nnu-course/ops.env before installation. SMTP stays in app.env.
test -s /etc/nnu-course/ops.env
chmod 600 /etc/nnu-course/ops.env
install -o nnu-app -g nnu-app -m 700 -d /var/lib/nnu-ops
install -m 644 /opt/nnu-course/current/deploy/nnu-ops.service /etc/systemd/system/nnu-ops.service
install -m 644 /opt/nnu-course/current/deploy/nnu-ops.timer /etc/systemd/system/nnu-ops.timer
systemctl daemon-reload
systemctl enable --now nnu-ops.timer
systemctl start nnu-ops.service
systemctl is-active nnu-ops.timer
