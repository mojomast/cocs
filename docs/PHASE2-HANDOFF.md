# Next agent: deploy phase 1, then implement phase 2

## Authorization and starting point
The user reviewed the Tailscale preview, said it was awesome, and explicitly requested this work be committed/pushed with labeled map screenshots, followed by a prompt for the next agent to deploy the changes live and begin phase 2. This supersedes the historical phase-2 approval block in older notes. This checkpoint is not a claim that human combat balance, every visual detail, or hardware performance has been approved.

Repository: https://github.com/mojomast/cocs.git
Branch: improvement/phase1-spatial. Use the commit containing this handoff as the phase-1 checkpoint; the user's final response supplies its exact SHA. Fetch and inspect current HEAD, remote branches and dirty state first. Preserve newer changes. Do not force-push, reset unrelated work, or blindly replay integration patches.

Local checkout used: /home/mojo/.hermes-instances/fresh/workspace/cocs. Original baseline: e79fcc048d7d97e7418d2e6fdbdd304b69362fa0.

## First: discover and deploy safely
Read README.md, package.json, docs/DEPLOYMENT.md, deploy/README.md, docs/TESTING.md, scripts/deploy.sh, scripts/build-verified.sh and scripts/sites-env.sh. Deployment documentation names https://arena.ussyco.de, but also references an older tokenarena repository. Verify the actual host, live checkout, nginx vhost, systemd units, ports, current deployed revision and authoritative multiplayer process before changing anything. In this session, a query of token-arena-web.service returned inactive with no WorkingDirectory; do not assume this workspace is the live installation.

Deploy the pushed phase-1 checkpoint to the verified production target using repository instructions and a tested rollback plan. Inspect current remote changes and use a non-destructive integration workflow if the live checkout is on a different branch. Avoid development/build commands rewriting the live dist directory behind a running server. The web server caches its asset manifest at startup: restart it after replacing a build. Determine whether the game server imports changed shared game/core, map, terrain or campaign modules; absence of changes under server/ alone does not prove a server restart is unnecessary. Coordinate any restart because it disconnects multiplayer clients, preserve runtime history/progression, and keep client/server simulation versions consistent.

Verify the actual public URL, HTML and referenced JS/CSS content types/cache policy, deployed revision or artifact identity, browser console, a playable arena, campaign entry/checkpoint and multiplayer connectivity where configured. Use repository deployment verification plus bounded browser smoke. Report actual command results and a live URL; do not call a local preview a production deployment. If deployment fails, roll back and explain the blocker. Do not proceed on the fiction that it succeeded.

## Then: phase 2
Implement and integrate natural/credible materials, cinematic music, substantial gameplay sound, and a restrained HUD. Preserve the phase-1 map, weapon/ADS, character, spawn, campaign and authoritative simulation work. These four areas are the known phase-2 scope; do not invent missing acceptance criteria from the older, truncated conversation.

Use a lead integrator and at most three implementation subagents concurrently, with bounded assignments and one writer per file. The lead owns shared runtime integration, especially game/view.mjs. Integrate into the actual game, not only the review harness. Use appropriately licensed or original assets with provenance. Preserve existing settings, mute/volume controls, accessibility and reduced motion. Maintain 100% render-scale usability: do not disguise regressions by lowering resolution/quality or adding blur. No new weapons, maps, modes or major dependencies unless genuinely necessary and explained. Keep development isolated from live production after the initial authorized deployment.

Run focused changed-behavior tests, necessary type/lint checks and bounded smoke during development. Do NOT run the full required suites during phase-2 development. Run the full required suites only after both phases are implemented and integrated; derive the exact commands from current repository testing instructions. Do not weaken tests to conceal regressions. After that, provide actual test output, playable evidence, baseline/current comparisons and remaining limitations. Initial phase-1 deployment is explicitly authorized before phase 2; it must not be represented as full-suite-certified.

## Evidence and known limitations to carry forward
- docs/PHASE1-PROGRESS.md: consolidated latest status supersedes older worker-in-progress paragraphs.
- docs/PHASE1-MAP-COVERAGE.md and docs/phase1-*-handoff.md: map/character/weapon/campaign decisions and caveats.
- docs/evidence/phase1/maps/README.md: 41 labeled original screenshots, stable IDs, display names, companion metrics and manifest.json with SHA-256 hashes. These files are committed for future comparison, not just host-local links.
- Causeways replace 19 broken bridge descriptors with ground-supported ramps, not overhead bridges with underpasses.
- Frost Gate portal clearance and Catacombs tunnel collision were corrected. Catacombs' tested center-avoiding route uses the central chamber annulus; there is no demonstrated independent outer flank.
- Campaign defenders were predeployed rather than spawned on triggers. Scripted placement/progression/checkpoint checks pass, but human combat pacing and balance remain unverified.
- Character lifecycle/grip/foot checks pass. Persistent stance locking, slope-normal alignment, pelvis compensation, extreme-aim grip reach and reload hand behavior remain limitations. Neutral screenshots are not complete motion/close-contact approval.
- Built preview weapon smoke passed all ten hip/ADS transitions at 100% scale, including reload/reversal/reduced motion and a caught-render-error regression. Built preview death/settled/respawn smoke passed both motion modes after removing a dev-only module import from the capture script.
- Build passed with bundle-size warnings. Software captures use Chromium SwiftShader at 1280×720 DPR 1, pinned high quality, no auto-quality. They are compatibility evidence only, not hardware FPS. Embedded zero lastFrameMs/medianFrameMs/p95FrameMs are invalid; separate RAF timings are software-only and require controlled, matched conditions.
- Ground-level visual/play review, attachment combinations, detailed foot/grip motion and qualified hardware performance evidence remain open. Repair real regressions if discovered; do not silently mark these complete.
- Historical integration/proposal patches are already applied or selectively integrated. The portal test defaults to integrated production checks; its PORTAL_INTEGRATED=0 mode is historical pre-patch diagnosis, not a supported current-source run.

Last-known preview URLs (check liveness, not permanent hosting): http://100.125.104.79:4321/review?reticle=1 and http://100.125.104.79:4322/ for the host-local full gallery. Extra weapon/character/video evidence is in the sibling cocs-evidence directory and is not all committed. The committed map atlas is portable. No production deployment or phase-2 implementation occurred before this handoff.
