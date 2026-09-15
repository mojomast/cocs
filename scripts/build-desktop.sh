#!/usr/bin/env bash
set -euo pipefail

# Produce dist-desktop/: a client-only, network-free static bundle for the
# Electron/Steam build (docs/STEAM_RELEASE_PLAN.md section 4.4). The bundle is
# served later by Electron through a custom `app://` protocol and must not
# require worker/, Wrangler bindings or SSR at runtime.
#
# Strategy: run the normal `vinext build`, copy its content-hashed client tree
# into dist-desktop/, then render the root document once with the built server
# bundle and inline it as index.html with root-absolute asset references
# rewritten to relative ones. The result is plain files: no server, no
# bindings, no network.
#
# `vinext build` always writes to <root>/dist. Any pre-existing dist/ (for
# example a live web build) is moved aside and restored on exit, so running the
# desktop build never mutates an existing dist/ tree. Run it from a dedicated
# worktree as well: the trade-off is that the restore still swaps dist/ aside
# for the duration of the build.

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ "${SITES_ENV_READY:-}" != "1" ]]; then
  exec "${script_dir}/sites-env.sh" -- "$0" "$@"
fi

project_root="${SITES_PROJECT_ROOT}"
dist_dir="${project_root}/dist"
client_dir="${dist_dir}/client"
out_dir="${project_root}/dist-desktop"

command -v timeout || {
  echo "build-desktop.sh requires GNU timeout." >&2
  exit 69
}

vinext="${project_root}/node_modules/.bin/vinext"
if [[ ! -x "${vinext}" ]]; then
  echo "vinext is unavailable. Run npm run install:ci and wait for it to finish before building." >&2
  exit 69
fi

# Preserve any existing dist/ so this script is non-destructive to a web build.
dist_backup=""
dist_built=0
restore_dist() {
  local status=$?
  trap - EXIT
  if [[ -n "${dist_backup}" ]]; then
    rm -rf "${dist_dir}"
    mv "${dist_backup}" "${dist_dir}"
  elif [[ "${dist_built}" == "1" ]]; then
    rm -rf "${dist_dir}"
  fi
  exit "${status}"
}
trap restore_dist EXIT
if [[ -e "${dist_dir}" ]]; then
  dist_backup="${project_root}/.dist-desktop-backup.$$"
  rm -rf "${dist_backup}"
  mv "${dist_dir}" "${dist_backup}"
fi

echo "Assembling desktop client bundle (${out_dir})..."

# Start from a clean output tree so stale content hashes can never survive.
rm -rf "${out_dir}"
mkdir -p "${out_dir}"

echo "Running vinext build for the desktop source tree..."
dist_built=1
timeout \
  --signal=TERM \
  --kill-after="${SITES_BUILD_KILL_AFTER:-10s}" \
  "${SITES_BUILD_TIMEOUT:-3m}" \
  "${vinext}" build

if [[ ! -f "${dist_dir}/server/index.js" || ! -d "${client_dir}/assets" ]]; then
  echo "Desktop build needs dist/server/index.js and dist/client/assets from vinext build." >&2
  exit 1
fi

# Copy the hashed client tree, skipping Wrangler/Cloudflare-specific metadata
# that the Electron protocol never serves.
cp -R "${client_dir}/." "${out_dir}/"
rm -rf \
  "${out_dir}/.vite" \
  "${out_dir}/_headers" \
  "${out_dir}/.assetsignore"

# Render the single app route to static HTML with the built server bundle. Its
# RSC payload is embedded in the document, so the client hydrates offline with
# no server request. Asset references are made relative so every link resolves
# next to index.html under dist-desktop/, independent of the document URL.
node --input-type=module -e '
import { writeFileSync } from "node:fs";

const [serverBundle, outDir] = process.argv.slice(1);

const { default: worker } = await import(new URL(serverBundle, "file://" + process.cwd() + "/").href);
const response = await worker.fetch(
  new Request("http://localhost/", { headers: { accept: "text/html" } }),
  { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
  { waitUntil() {}, passThroughOnException() {} },
);

if (response.status !== 200) {
  throw new Error(`root route rendered ${response.status}`);
}

let html = await response.text();

// Keep every /assets/ reference root-absolute: the RSC client resolves its
// chunk map against the document origin, and only absolute URLs work there.
// The Electron app:// protocol maps its root to dist-desktop/, so "/" still
// lands next to index.html. Only the site-origin metadata is made relative.
// The origin is matched only when it ends a quoted URL ([\"/]) so the escaped
// \" terminator in the embedded RSC payload is preserved.
html = html.replace(/https:\/\/arena\.ussyco\.de\/(?=["\\])/g, "./");
html = html.replaceAll("https://arena.ussyco.de/favicon.svg", "./favicon.svg");
html = html.replaceAll("https://arena.ussyco.de/manifest.webmanifest", "./manifest.webmanifest");

if (!html.includes("/assets/")) {
  throw new Error("vinext output has no root-absolute asset references; layout changed");
}

writeFileSync(`${outDir}/index.html`, html);
' "${dist_dir}/server/index.js" "${out_dir}"

# Fail the build if the document points at anything outside the bundle or at a
# file that does not exist. This is the offline-loadability gate.
node --input-type=module -e '
import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";

const outDir = resolve(process.argv[1]);
const html = readFileSync(join(outDir, "index.html"), "utf8");
const refs = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map(match => match[1]);
const external = /^(?:[a-z]+:)?\/\//i;
const local = refs.filter(ref => !external.test(ref) && !ref.startsWith(String.fromCharCode(35)));
const missing = [];

// "/assets/..." and "./assets/..." both resolve inside dist-desktop/ because
// Electron maps the app:// root there.
for (const ref of local) {
  const rel = ref.replace(/^\.?\//, "").split(/[?#]/, 1)[0];
  const target = resolve(outDir, rel);
  const inside = relative(outDir, target);
  if (inside === "" || inside.startsWith("..") || isAbsolute(inside)) {
    missing.push(`${ref} (escapes bundle)`);
  } else if (!existsSync(target)) {
    missing.push(`${ref} (missing)`);
  }
}

if (missing.length > 0) {
  console.error("dist-desktop/index.html references unresolved files:");
  for (const item of missing) console.error(`  ${item}`);
  process.exit(1);
}

console.log(`Verified ${local.length} local document reference(s) under dist-desktop/.`);
' "${out_dir}"

echo "Desktop bundle ready: ${out_dir}"
