# Deployment

COCS is served from this host at **https://arena.ussyco.de** (nginx + wildcard TLS for
`*.ussyco.de`). Source: https://github.com/mojomast/tokenarena. The canonical
quick-reference that ships next to the configs is [`deploy/README.md`](../deploy/README.md).

## What runs where

| Piece | Command | Port |
|---|---|---|
| Web app | `vinext start` (`token-arena-web.service`) | `127.0.0.1:3000` |
| Game server | `node server/game-server.mjs` (`token-arena-server.service`) | `127.0.0.1:4000` |
| Reverse proxy | nginx vhost `deploy/arena.ussyco.de.nginx` | 443 |

nginx routes `/` to the web app and `/ws` to the game server. Both services are
user units under `~/.config/systemd/user/` with linger enabled for `mojo`; the
game server persists match history to `server/history.json`.

## The one rule that matters

The running web service loads its server bundle and **asset manifest at startup**.
Rebuilding `dist/` does **not** reload it, so old HTML can reference deleted CSS/JS
and the public site goes unstyled or fails to boot (a dead title screen with 502s
on `/assets/*`). Always follow a build with a restart:

```
npm run deploy                      # web only
npm run deploy -- --with-game-server   # web + authoritative game server
```

`scripts/deploy.sh` copies the current `dist/` to a temporary backup, builds,
restarts the service(s), gates on `systemctl --user is-active`, then runs the
HTML/asset verifier against `DEPLOY_URL`. On any failure it restores the backup,
restarts the services and exits non-zero. Without a previous `dist/` there is
nothing to restore, so a first deploy reports the failure only.

Restarting the game server disconnects active multiplayer clients. Only pass
`--with-game-server` when server code changed.

## Release discipline

Every deployment bumps the running version, and these move together in the same
commit:

- `app/page.tsx` `title-footer` — the source of truth, parsed by `scripts/read-version.mjs`
- `game/changelog.mjs` — `RELEASE_VERSION`/`RELEASE_CODENAME` plus the digest entry
- `docs/CHANGELOG.md`, the README release list and `docs/VERIFICATION.md`

`game/changelog.test.mjs` fails if the newest digest entry and the footer literal
disagree, and `scripts/deploy.sh` verifies the served HTML against the footer, so
a stale or unbumped release cannot pass verification.

## Verifying a deployment

`DEPLOY_VERSION` is optional: the script reads it from the `app/page.tsx`
`title-footer` via `scripts/read-version.mjs` when unset, and the check rejects a
stale HTML release even when its assets still work. `DEPLOY_URL` defaults to
`https://arena.ussyco.de`.

To check a running deployment without building or restarting anything:

```
npm run verify:deployment -- https://arena.ussyco.de
```

The verifier requires HTTP 200 **and** the correct content type for every CSS and
JS asset referenced by the HTML, including `preload`/`modulepreload` and streamed
RSC references — and it fails if the document itself is cacheable. This catches
stale-manifest failures that an HTML-only smoke test would miss.

**Document cache policy.** `next.config.ts` sends `Cache-Control: no-cache,
must-revalidate` for `/` while content-hashed `/assets/*` keep `public,
max-age=31536000, immutable`. The browser therefore always revalidates the HTML
and can never keep running a bundle whose files were deleted by the next deploy.
The rendered-HTML test also checks that every referenced asset exists in the build
directory.

## Local development

Requires Node.js 22.13+ and npm.

```
npm ci
npm run dev        # Vite dev server, prints its URL
npm run build      # production build
npm run start      # serve the production build
npm run server     # game server on ws://localhost:4000 (PORT overrides)
npm run demo       # headless client: joins, hosts and reports snapshots
```

No API key, downloaded art or inference service is used. All match logic and bot
decisions run in the browser; dependencies are bundled by the build.

## Notes

- The browser client defaults its server URL to `wss://<host>/ws` when served from
  a remote host, falling back to `ws://localhost:4000` locally.
- `server/history.json` is runtime state (gitignored).
- `npm test` rebuilds `dist/`. Run build/test work in a separate checkout when the
  live service must stay uninterrupted; if you build in this checkout, restart the
  web service before calling verification complete.
- Verify the public URL and its linked assets, not just the local dev server.
