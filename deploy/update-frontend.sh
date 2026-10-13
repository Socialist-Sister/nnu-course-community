#!/usr/bin/env bash
# Avoid mutable releases and a second deployment path without rollback checks.
set -euo pipefail
echo 'Frontend-only in-place updates are retired. Build and upload app.tar.gz, then run update-release.sh.' >&2
echo 'This command made no changes.' >&2
exit 64
