#!/usr/bin/env bash
set -euo pipefail

if [[ $# -gt 1 || ( $# -eq 1 && "$1" != "--with-game-server" ) ]]; then
  printf 'Usage: npm run deploy -- [--with-game-server]\n' >&2
  exit 64
fi

# A running vinext process retains its old asset manifest after dist is rebuilt.
# Never separate a successful deployment build from the web restart.
npm run build
systemctl --user restart token-arena-web.service
if [[ "${1:-}" == "--with-game-server" ]]; then
  systemctl --user restart token-arena-server.service
fi

for attempt in {1..10}; do
  if node scripts/verify-deployment.mjs "${DEPLOY_URL:-https://arena.ussyco.de}" "${DEPLOY_VERSION:-}"; then
    exit 0
  fi
  sleep 2
done
printf 'Deployment failed HTML/asset verification. Inspect the web service logs.\n' >&2
exit 1
