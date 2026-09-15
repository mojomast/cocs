# Deployment assets

This directory holds the live-deployment configuration for **https://arena.ussyco.de**:

- `arena.ussyco.de.nginx` — nginx vhost. `/` → vinext app on `127.0.0.1:3000`,
  `/ws` → game server on `127.0.0.1:4000`. Installed at
  `/etc/nginx/sites-available/arena.ussyco.de` (+ sites-enabled symlink).
- `systemd/token-arena-web.service` — production web app (`vinext start`, port 3000).
- `systemd/token-arena-server.service` — game server (`node server/game-server.mjs`, port 4000).

Both are user units under `~/.config/systemd/user/` with linger enabled for `mojo`.

**Full procedure, the build/restart rule and verification commands live in
[`../docs/DEPLOYMENT.md`](../docs/DEPLOYMENT.md).** In short: never rebuild without
an immediate `npm run deploy` (optionally `-- --with-game-server`), because the
running web service caches its asset manifest.
