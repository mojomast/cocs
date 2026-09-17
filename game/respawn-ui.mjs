// Team-mode respawn overlay view model (Phase 4, docs/design/CLASS_OVERHAUL.md
// §3.7 and §6.2). Pure: no DOM, no React, no side effects. The page composes
// this from the live HUD snapshot so the overlay screen stays a pure render of
// one record and the gate is unit-testable without a browser.
import {teamMode} from './config.mjs';
import {isSinglePlayerMode} from './singleplayer.mjs';
import {movementModeRule} from './movement.mjs';

// Where respawn switching is legal. Mirrors server/room.mjs `setLoadout`: team
// modes only, minus puma race/soccer (the movement rule disables kits there),
// minus horde/campaign (single-player; `teamMode` would otherwise admit them).
// FFA and the other locked modes are already excluded because `teamMode` is
// false. `null`/unknown modes are rejected rather than guessed.
export function respawnSwitchAllowed(mode) {
  return Boolean(mode) && teamMode(mode) && !isSinglePlayerMode(mode) && !movementModeRule(mode).disabled;
}

// Compose the overlay's gate and header data from the HUD snapshot. `open` is
// exactly "team mode + dead + not sudden death + not the VIP + match not over".
export function respawnOverlayView(hud, player) {
  const mode = hud?.config?.mode ?? null;
  const allowed = respawnSwitchAllowed(mode);
  const suddenDeath = hud?.suddenDeath === true || hud?.objectives?.suddenDeath === true;
  const over = hud?.over === true;
  const isVip = player?.isVip === true;
  const health = Number(player?.health);
  const dead = Boolean(player) && Number.isFinite(health) && health <= 0;
  const feed = Array.isArray(hud?.feed) ? hud.feed.slice(0, 3) : [];
  return Object.freeze({
    open: allowed && dead && !suddenDeath && !over && !isVip,
    allowed,
    suddenDeath,
    over,
    isVip,
    mode,
    character: player?.character ?? null,
    harness: player?.harness ?? null,
    health: Number.isFinite(health) ? health : null,
    // `dead` on the actor snapshot is the respawn countdown in seconds.
    respawnIn: Number.isFinite(Number(player?.dead)) ? Math.max(0, Number(player.dead)) : null,
    feed,
  });
}
