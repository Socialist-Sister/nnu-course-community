#!/usr/bin/env bash
# Full release or --rollback. No database import, environment rewrite or DB rollback.
set -Eeuo pipefail
root=${NNU_DEPLOY_ROOT:-/opt/nnu-course}
upload=${NNU_DEPLOY_UPLOAD:-/home/azureuser/nnu-upload}
service=${NNU_DEPLOY_SERVICE:-nnu-course}
backup_service=${NNU_DEPLOY_BACKUP_SERVICE:-nnu-backup.service}
origin=${NNU_DEPLOY_ORIGIN:-http://127.0.0.1:4180}
attempts=${NNU_DEPLOY_ATTEMPTS:-6}
delay=${NNU_DEPLOY_DELAY:-2}
[[ "$root" = /* && "$root" != / && "$attempts" =~ ^[1-9][0-9]?$ && "$delay" =~ ^[0-9]+$ ]] || exit 64
root=$(realpath -e "$root")
exec 9>"$root/.deploy.lock"
flock -n 9 || { echo 'Another deployment is running.' >&2; exit 75; }
previous=$(readlink -f "$root/current")
[[ "$previous" == "$root/releases/"* && -d "$previous" ]] || { echo 'Current release is invalid.' >&2; exit 1; }
switched=0
atomic_link(){
  local target=$1 link=$2 temp="$2.next.$$"
  ln -s "$target" "$temp"
  mv -Tf "$temp" "$link"
}
check_release(){
  local target=$1
  for ((i=1;i<=attempts;i++)); do
    if node "$checker" "$target" "$origin"; then return 0; fi
    if ((i<attempts)); then sleep "$delay"; fi
  done
  return 1
}
recover(){
  local code=$1
  trap - ERR INT TERM
  if ((switched)); then
    echo 'Release failed; restoring previous code. Database is not rolled back.' >&2
    if atomic_link "$previous" "$root/current" && systemctl restart "$service" && check_release "$previous"; then
      echo "Rollback verified: $previous" >&2
    else
      echo "ROLLBACK FAILED: inspect $service and $root/current immediately; database was not restored." >&2
    fi
  else
    echo 'Preparation failed; current release was not switched.' >&2
  fi
  exit "$code"
}
trap 'recover $?' ERR
trap 'recover 130' INT
trap 'recover 143' TERM
if [[ $# == 1 && "$1" == --rollback ]]; then
  release=$(readlink -f "$root/previous")
  [[ "$release" == "$root/releases/"* && -d "$release" && "$release" != "$previous" ]]
  tool_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
  checker="$tool_dir/check-release.mjs"
  asset_tool="$tool_dir/release-assets.mjs"
elif [[ $# == 0 ]]; then
  release="$root/releases/$(date -u +%Y%m%dT%H%M%SZ)-$$"
  mkdir -m 755 "$release"
  tar -xzf "$upload/app.tar.gz" -C "$release" --no-same-owner --no-same-permissions
  test -f "$release/server/index.mjs"
  cd "$release"
  npm ci --omit=dev --ignore-scripts --no-audit --no-fund
  node --input-type=module -e 'import sharp from "sharp"; await sharp({create:{width:1,height:1,channels:3,background:"white"}}).webp().toBuffer(); console.log("Avatar image runtime ready");'
  checker="$release/deploy/check-release.mjs"
  asset_tool="$release/deploy/release-assets.mjs"
  chmod -R go-w "$release"
else
  echo 'Usage: update-release.sh [--rollback]' >&2
  exit 64
fi
node "$asset_tool" verify "$release"
node "$asset_tool" verify "$previous"
# Both directions protect tabs that loaded either HTML version, including during rollback.
node "$asset_tool" retain "$previous/dist/client/assets" "$release/dist/client/assets"
node "$asset_tool" retain "$release/dist/client/assets" "$previous/dist/client/assets"
systemctl start "$backup_service"
switched=1
atomic_link "$release" "$root/current"
systemctl restart "$service"
check_release "$release"
atomic_link "$previous" "$root/previous"
switched=0
trap - ERR INT TERM
printf '\nRelease active and verified: %s\nRollback target: %s\n' "$release" "$previous"
