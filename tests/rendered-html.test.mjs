import assert from "node:assert/strict";
import test from "node:test";
import { GAME_MODES } from "../game/config.mjs";
import {readFile} from 'node:fs/promises';
import {linkedAssets} from '../scripts/verify-deployment.mjs';

const developmentPreviewMeta =
  /<meta(?=[^>]*\bname=["']codex-preview["'])(?=[^>]*\bcontent=["']development["'])[^>]*>/i;

test("serves the game selection screen without starter metadata", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  const response = await worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );

  assert.equal(response.status, 200);
  assert.match(
    response.headers.get("content-type") ?? "",
    /^text\/html\b/i,
  );
  const html = await response.text();
  const assets = linkedAssets(html);
  assert.ok(assets.some(path => path.endsWith('.css')));
  assert.ok(assets.some(path => path.endsWith('.js')));
  for (const path of assets) {
    const content = await readFile(new URL(`../dist/client${path}`, import.meta.url), 'utf8');
    assert.ok(content.length, `${path} exists in this build`);
  }
  assert.doesNotMatch(html, developmentPreviewMeta);
  assert.match(html, /Colosseum Of Competitive Slop|COCS/);
  assert.match(html, /Choose your intelligence/);
  assert.match(html, /Claude Code/);
  assert.match(html, /github\.com\/mojomast\/tokenarena/);
  for (const label of ["MATCH SETUP", "Bot count", "Bot difficulty", "Your callsign", "Movement speed", "Casual Skirmish", "Warmup", "Rocket Party", "SHUFFLE LOADOUT / MAP"]) assert.ok(html.includes(label), label);
  assert.ok(GAME_MODES.filter((mode) => html.includes(mode.name)).length >= 4);
  const soccer = GAME_MODES.find((mode) => mode.id === "puma-soccer");
  if (soccer) assert.ok(html.includes(soccer.name), `${soccer.name} mode is listed`);
  if (GAME_MODES.some((mode) => html.includes(mode.name) && /ctf|capture/i.test(`${mode.id} ${mode.objective ?? ""}`))) {
    assert.match(html, /Capture the enemy flag|captures/i);
  }
});
