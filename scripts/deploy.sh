#!/usr/bin/env bash
set -euo pipefail

if [[ $# -gt 1 || ( $# -eq 1 && "$1" != "--with-game-server" ) ]]; then
  printf 'Usage: npm run deploy -- [--with-game-server]\n' >&2
  exit 64
fi

with_game_server="${1:-}"
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${repo_root}"

dist_dir="${repo_root}/dist"
backup_dir="$(mktemp -d "${TMPDIR:-/tmp}/token-arena-dist.XXXXXX")"
had_dist=0

cleanup_backup() {
  rm -rf "${backup_dir}"
}
trap cleanup_backup EXIT

restore_dist() {
  if [[ "${had_dist}" != "1" || ! -d "${backup_dir}/dist" ]]; then
    return 1
  fi
  rm -rf "${dist_dir}"
  cp -a "${backup_dir}/dist" "${dist_dir}"
}

restart_services() {
  local failed=0
  if ! systemctl --user restart token-arena-web.service; then
    failed=1
  fi
  if [[ "${with_game_server}" == "--with-game-server" ]]; then
    if ! systemctl --user restart token-arena-server.service; then
      failed=1
    fi
  fi
  return "${failed}"
}

wait_for_active() {
  local service="$1"
  local attempt
  for attempt in {1..10}; do
    if systemctl --user is-active --quiet "${service}"; then
      return 0
    fi
    sleep 1
  done
  return 1
}

rollback() {
  printf '%s\n' "$1" >&2
  if restore_dist; then
    printf 'Restored the previous dist/ and restarting services.\n' >&2
    if ! restart_services; then
      printf 'Failed to restart services during rollback.\n' >&2
    fi
  else
    printf 'No previous dist/ backup is available to restore.\n' >&2
  fi
  exit 1
}

deploy_version="${DEPLOY_VERSION:-}"
if [[ -z "${deploy_version}" ]]; then
  if ! deploy_version="$(node scripts/read-version.mjs)"; then
    printf 'Could not read the release version from app/page.tsx via scripts/read-version.mjs.\n' >&2
    exit 1
  fi
  if [[ -z "${deploy_version}" ]]; then
    printf 'Release version footer is missing from app/page.tsx.\n' >&2
    exit 1
  fi
fi

if [[ -d "${dist_dir}" ]]; then
  cp -a "${dist_dir}" "${backup_dir}/dist"
  had_dist=1
fi

# A running vinext process retains its old asset manifest after dist is rebuilt.
# Never separate a successful deployment build from the web restart.
if ! npm run build; then
  printf 'Build failed.\n' >&2
  if restore_dist; then
    printf 'Restored the previous dist/.\n' >&2
  else
    printf 'No previous dist/ backup is available.\n' >&2
  fi
  exit 1
fi

if ! restart_services; then
  rollback 'Failed to restart services after the build.'
fi

if ! wait_for_active token-arena-web.service; then
  rollback 'token-arena-web.service did not become active after restart.'
fi

if [[ "${with_game_server}" == "--with-game-server" ]] && ! wait_for_active token-arena-server.service; then
  rollback 'token-arena-server.service did not become active after restart.'
fi

verified=0
for attempt in {1..10}; do
  if node scripts/verify-deployment.mjs "${DEPLOY_URL:-https://arena.ussyco.de}" "${deploy_version}"; then
    verified=1
    break
  fi
  sleep 2
done

if [[ "${verified}" != "1" ]]; then
  rollback 'Deployment failed HTML/asset verification.'
fi

exit 0
