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
before_commit=""
before_commit_full=""
before_branch=""
previous_commit=""
previous_build_id=""
previous_commit_full=""
previous_release=""
previous_codename=""
previous_web_release=""
previous_web_codename=""
previous_web_commit=""
previous_web_build_id=""

cleanup_backup() {
  rm -rf "${backup_dir}"
}
trap cleanup_backup EXIT

# --- identified candidate -----------------------------------------------------
# A recoverable deploy must name the code it ships. Refuse to start from a dirty
# or unreadable tree unless the operator explicitly accepts that the recorded
# commit and build ID will not describe the working tree.
if ! git status --porcelain > "${backup_dir}/git-status.txt" 2>/dev/null; then
  printf 'Could not read git status; refusing an unidentified deploy.\n' >&2
  exit 1
fi
if [[ -s "${backup_dir}/git-status.txt" && "${ALLOW_DIRTY_DEPLOY:-}" != "1" ]]; then
  printf 'Working tree is dirty; refusing to deploy. Commit or stash first, or set ALLOW_DIRTY_DEPLOY=1 to deploy HEAD anyway.\n' >&2
  cat "${backup_dir}/git-status.txt" >&2
  exit 1
fi
if [[ -s "${backup_dir}/git-status.txt" ]]; then
  printf 'WARNING: ALLOW_DIRTY_DEPLOY=1; the commit and build ID describe HEAD only and cannot prove the running source.\n' >&2
fi
before_commit="$(git rev-parse --short HEAD)"
before_commit_full="$(git rev-parse HEAD)"
before_branch="$(git symbolic-ref --quiet --short HEAD || true)"

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

# --- previous identified release ---------------------------------------------
# The services that are already running are the previous release. Record their
# reported identity so a failed cutover can go back to the exact artifacts and
# SHA that were serving before this deploy, and so a rollback never leaves the
# failed candidate's SHA advertised by restored code.
server_base="${GAME_SERVER_URL:-http://127.0.0.1:4000}"
deploy_url="${DEPLOY_URL:-https://arena.ussyco.de}"

read_service_identity() {
  node --input-type=module -e '
const [base, path] = process.argv.slice(1);
try {
 const response = await fetch(new URL(path, base), {signal: AbortSignal.timeout(4000), cache: "no-store"});
 const body = await response.json();
 const safe = (value, max) => typeof value === "string" && value.length > 0 && value.length <= max ? value.replace(/[\t\r\n]+/g, "-") : "";
 process.stdout.write(`${safe(body.release ?? body.version, 32)}\t${safe(body.codename, 32)}\t${safe(body.commit, 64)}\t${safe(body.buildId, 128)}\n`);
} catch { process.stdout.write("\t\t\t\n"); }
' "$1" "$2"
}

previous_web_identity="$(read_service_identity "${deploy_url}" "/api/version" || true)"
IFS=$'\t' read -r previous_web_release previous_web_codename previous_web_commit previous_web_build_id <<< "${previous_web_identity}"

if [[ "${with_game_server}" == "--with-game-server" ]]; then
  previous_identity="$(read_service_identity "${server_base}" "/" || true)"
  IFS=$'\t' read -r previous_release previous_codename previous_commit previous_build_id <<< "${previous_identity}"
  # The first identified cutover has no previous identity to read. The operator
  # can name the SHA that is actually serving so rollback is still exact:
  #   PREVIOUS_SERVER_COMMIT=<sha> npm run deploy -- --with-game-server
  if [[ -z "${previous_commit}" && -n "${PREVIOUS_SERVER_COMMIT:-}" ]]; then
    previous_commit="${PREVIOUS_SERVER_COMMIT}"
    previous_build_id="${PREVIOUS_SERVER_BUILD_ID:-}"
    printf 'Using operator-provided previous game server commit %s.\n' "${previous_commit}"
  fi
  if [[ -n "${previous_commit}" ]]; then
    previous_commit_full="$(git rev-parse --verify --quiet "${previous_commit}^{commit}" || true)"
  fi
  if [[ -n "${previous_commit_full}" ]]; then
    printf 'Previous deployed game server: %s (%s).\n' "${previous_commit}" "${previous_build_id:-no build ID}"
  else
    printf 'Previous deployed game server identity is unavailable; rollback will restore commit %s.\n' "${before_commit}" >&2
  fi
fi

# --- build identity -----------------------------------------------------------
# One identity drives the web bundle, the game server process and the post-
# restart gate. The systemd user manager receives the same variables before the
# services restart, which is how both processes see this deploy's exact SHA.
unset TOKEN_ARENA_RELEASE TOKEN_ARENA_CODENAME TOKEN_ARENA_COMMIT TOKEN_ARENA_BUILD_ID
deploy_codename="$(node scripts/echo-build-identity.mjs codename)"
export TOKEN_ARENA_RELEASE="${deploy_version}"
export TOKEN_ARENA_CODENAME="${deploy_codename}"
export TOKEN_ARENA_COMMIT="${before_commit}"
deploy_build_id="$(node scripts/echo-build-identity.mjs buildId)"
export TOKEN_ARENA_BUILD_ID="${deploy_build_id}"
printf 'Build identity: %s\n' "$(node scripts/echo-build-identity.mjs)"

import_identity_env() {
  # The running services only see these after the import; a restart is what
  # binds the identity to the process that reports it. The import lives in the
  # systemd user manager, not in the unit files, so after a reboot (or any
  # manager restart) both services fall back to their baked/unknown identity
  # until the next deploy re-imports it.
  if ! systemctl --user import-environment TOKEN_ARENA_RELEASE TOKEN_ARENA_CODENAME TOKEN_ARENA_COMMIT TOKEN_ARENA_BUILD_ID; then
    printf 'Could not import TOKEN_ARENA_* build identity into the systemd user manager.\n' >&2
    return 1
  fi
}

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

restored_field() {
  node --input-type=module -e "import {${1}} from './game/changelog.mjs'; process.stdout.write(String(${1}))" 2>/dev/null || true
}

restore_rollback_identity() {
  # The restored artifacts must never keep advertising the failed candidate's
  # SHA. A game-server rollback returns to the previous server identity; a
  # web-only rollback returns to the previous web identity. When neither was
  # reported by the old services, the import is cleared so each process falls
  # back to its own baked/unknown identity.
  if [[ "${with_game_server}" == "--with-game-server" && "${restored_server:-0}" == "1" && -n "${previous_commit_full}" ]]; then
    export TOKEN_ARENA_RELEASE="${previous_release:-$(restored_field RELEASE_VERSION)}"
    export TOKEN_ARENA_CODENAME="${previous_codename:-$(restored_field RELEASE_CODENAME)}"
    export TOKEN_ARENA_COMMIT="${previous_commit}"
    if [[ -n "${previous_build_id}" ]]; then
      export TOKEN_ARENA_BUILD_ID="${previous_build_id}"
    else
      export TOKEN_ARENA_BUILD_ID="${TOKEN_ARENA_RELEASE}-${TOKEN_ARENA_COMMIT}"
    fi
  elif [[ -n "${previous_web_commit}" ]]; then
    export TOKEN_ARENA_RELEASE="${previous_web_release:-$(restored_field RELEASE_VERSION)}"
    export TOKEN_ARENA_CODENAME="${previous_web_codename:-$(restored_field RELEASE_CODENAME)}"
    export TOKEN_ARENA_COMMIT="${previous_web_commit}"
    if [[ -n "${previous_web_build_id}" ]]; then
      export TOKEN_ARENA_BUILD_ID="${previous_web_build_id}"
    else
      export TOKEN_ARENA_BUILD_ID="${TOKEN_ARENA_RELEASE}-${TOKEN_ARENA_COMMIT}"
    fi
  else
    if ! systemctl --user unset-environment TOKEN_ARENA_RELEASE TOKEN_ARENA_CODENAME TOKEN_ARENA_COMMIT TOKEN_ARENA_BUILD_ID; then
      printf 'Could not clear the failed build identity from the systemd user manager.\n' >&2
    fi
    return 0
  fi
  if ! import_identity_env; then
    printf 'Could not import the restored build identity.\n' >&2
  fi
}

rollback() {
  printf '%s\n' "$1" >&2
  if restore_dist; then
    printf 'Restored the previous dist/ web bundle.\n' >&2
  else
    printf 'No previous dist/ backup is available to restore.\n' >&2
  fi
  local restored_server=0
  if [[ "${with_game_server}" == "--with-game-server" ]]; then
    if [[ -n "${previous_commit_full}" ]]; then
      restore_commit="${previous_commit_full}"
      restore_label="${previous_commit}"
    else
      restore_commit="${before_commit_full}"
      restore_label="${before_commit}"
    fi
    if git checkout --quiet "${restore_commit}"; then
      restored_server=1
      printf 'Restored server source to commit %s.\n' "${restore_label}" >&2
      if [[ -n "${before_branch}" ]]; then
        printf 'HEAD is now detached; run "git checkout %s" to return to a branch.\n' "${before_branch}" >&2
      fi
    else
      printf 'Could not restore commit %s; the server source remains the failed candidate.\n' "${restore_label}" >&2
    fi
  fi
  restore_rollback_identity
  if ! restart_services; then
    printf 'Failed to restart services during rollback.\n' >&2
  fi
  printf 'Rollback is not zero-downtime: services restart, active matches disconnect and clients must reconnect.\n' >&2
  exit 1
}

# A running vinext process retains its old asset manifest after dist is rebuilt.
# Never separate a successful deployment build from the web restart.
if [[ -d "${dist_dir}" ]]; then
  cp -a "${dist_dir}" "${backup_dir}/dist"
  had_dist=1
fi

if ! npm run build; then
  printf 'Build failed.\n' >&2
  if restore_dist; then
    printf 'Restored the previous dist/.\n' >&2
  else
    printf 'No previous dist/ backup is available.\n' >&2
  fi
  exit 1
fi

if ! import_identity_env; then
  rollback 'Could not identify the services before restart.'
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

# --- exact identity gate ------------------------------------------------------
# The HTML/asset check still runs. Identity checks then compare the served
# commit/buildId/protocol against this build with exact equality. A web-only
# release may retain the previous game server only while it declares the same
# protocol major (--compatible-server); a server-changing release must match
# both services exactly.
verify_args=(--identities --server "${server_base}")
if [[ "${with_game_server}" != "--with-game-server" ]]; then
  verify_args+=(--compatible-server)
fi

verified=0
for attempt in {1..10}; do
  if node scripts/verify-deployment.mjs "${deploy_url}" "${deploy_version}" "${verify_args[@]}"; then
    verified=1
    break
  fi
  sleep 2
done

if [[ "${verified}" != "1" ]]; then
  rollback 'Deployment failed HTML/asset/identity verification.'
fi

printf 'Deployed %s (%s) at commit %s.\n' "${deploy_version}" "${TOKEN_ARENA_BUILD_ID}" "${TOKEN_ARENA_COMMIT}"
exit 0
