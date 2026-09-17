# Phase 1 classic maps — lead review

Individual geometric/layout review, not visual or balance approval. Registry IDs, modes, blocks and legacy collision semantics retained.

## Exchange
Retains central reactor, two exterior ramps and raised northern gantry. Earlier megahealth relocation to (0,-7.5) separates it from scatter at (0,11), making the south and north routes offer different rewards. Corrected newly added inspection anchors: approach points are now (+/-11,4), ramp points (+/-11,-4), matching actual floorAt ramp lanes instead of pointing into interior cover at x=+/-6. Named gantry remains (0,-12). All anchors have supported clearance, exact graph connectors, bidirectional graph reachability and local actual movement. Neither this nor unchanged spawns establish fair high-ground control; visual ramp readability and spawn exposure still need play review.

## Crosswire
Retained staggered bunkers and small central cover, corner weapons and opposed northern/southern resources. No pickup collection-sphere overlaps found; every spawn/reward has supported, clear, bidirectionally connected local movement. No arbitrary geometry added simply to mark it changed. Close-quarters sightlines, corner camping and time-to-power remain playtest questions.

## Foundry
Retains two furnace cores, separated ground lanes and northern gantry. Shares corrected real ramp inspection anchors with Exchange. Earlier megahealth at (0,-7.5) rewards the northern approach independently of southern scatter. Exact graph, local movement and nonoverlapping pickup checks pass. Furnace visibility and gantry control need human play review; legacy ground-to-top deck behavior was not reinterpreted.

## Launchpad
Found overlapping collection spheres (runtime radius 1.05 each): rail/flak/megahealth cluster along positive Z and rail/overshield pair near center. Kept opposite bases, cover and four authored launcher links. Rails now occupy opposing (0,+/-8) lanes; flak (8,0), megahealth (-8,-2). Overshield moved from (0,2.25) beside reactor to (0,3.5), giving a less cramped local approach. No reward-count/weapon changes. Exact graph and actual movement tests pass, and all collection spheres are separated. This is resource separation, not proof of equal team race times; flak/megahealth differ by side. Existing launcher-flight checks remain relevant.

## Citadel
Retains twin keep solids and outer lanes. Separated health/ammo, rail/flak, and scatter/power overlaps. Ammo (-15,-3); flak (8,9); haste (-4,-7); overcharge (4,7). Existing overshield (0,9) and megahealth (0,-9) remain opposite route incentives. Exact graph/local movement and collection separation pass. Flak side advantage and power timing need human review; no symmetry/balance certification.

## Verification
`node --test --test-timeout=30000 game/phase1-classic-review.test.mjs` — 5 passed, 0 failed. Each map checks every free spawn, pickup and named anchor: actor clearance, exact bidirectional walking connector, shared reachable graph, and real moveActor approach/exit. Every reward pair is >=2.1 in 3D, avoiding overlapping pickup spheres. The initial check caught Launchpad's cramped overshield approach; revised placement passes without weakening assertions. Separate live inspection caught the incorrect newly authored ramp anchors; they are now included in regression coverage.

No full suites, production deployment or phase2 work. Screenshots are compatibility evidence, not visual approval. Team spawn pools and objective/traversal metadata also have existing classic-layout tests; those should be retained, not replaced by this focused file.
