# COCS — deployment on ussy.host (arena.ussyco.de)

Public URL: https://arena.ussyco.de (nginx + wildcard TLS for `*.ussyco.de`).
Source: https://github.com/mojomast/tokenarena (linked from the in-game top bar, settings dialog and pause menu).

## Layout

- `deploy/arena.ussyco.de.nginx` — nginx vhost: `/` → vinext app on `127.0.0.1:3000`,
  `/ws` → game server WebSocket on `127.0.0.1:4000`. Installed at
  `/etc/nginx/sites-available/arena.ussyco.de` (+ sites-enabled symlink).
- `deploy/systemd/token-arena-server.service` — game server (`node server/game-server.mjs`,
  port 4000, history persisted to `server/history.json`).
- `deploy/systemd/token-arena-web.service` — production web app (`vinext start`, port 3000;
  runs with Node 22 from `/home/mojo/.local/bin/node`).

Both are user units under `~/.config/systemd/user/` with linger enabled for `mojo`.

## Redeploy after code changes

The running web service loads its server bundle and asset manifest at startup.
Rebuilding `dist/` does not reload it: old HTML can reference deleted CSS and
JavaScript assets, leaving the public site unstyled or unable to initialize.
Use the deployment command so a successful build is immediately followed by a
web restart and public HTML/CSS/JavaScript verification:

```
npm run deploy
```

Restart the game server only when deploying server changes; doing so disconnects
active multiplayer clients:

```
npm run deploy -- --with-game-server
```

`npm test` also rebuilds `dist/`. Run build/test work in a separate checkout when
the live service must remain uninterrupted. If run in this deployment checkout,
the web service must be restarted after the build before considering verification
complete. Verify the public URL and its linked assets, not just the local dev server.

`DEPLOY_VERSION` is optional: the deploy script reads it from the `app/page.tsx`
footer (via `scripts/read-version.mjs`) when unset, and the check rejects an old
HTML release even when its assets still work. Set it explicitly to verify a
specific release. `DEPLOY_URL` defaults to `https://arena.ussyco.de`.
To check an already-running deployment without building or restarting anything:

```
npm run verify:deployment -- https://arena.ussyco.de
```

The verifier requires HTTP 200 and the correct content type for every CSS and JS
asset referenced by HTML, including preload and streamed RSC references. This
catches stale manifest failures that an HTML-only smoke test misses. The rendered
HTML test also verifies that every referenced asset exists in the build directory.

## Notes

- The browser client defaults the server URL to `wss://<host>/ws` when served from a
  remote host (falls back to `ws://localhost:4000` for local development).
- `server/history.json` is runtime state (gitignored).
