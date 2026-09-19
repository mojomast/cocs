# LATTICE operator and weapon geometry

Implemented against `dd7e66c`, in `feat/lattice-models`. All art is generated from
committed Three.js geometry code; there are no downloaded models or textures.

## Operator identities

The construction hook in `game/models.mjs` now sculpts the actual articulated
operator, including the menu preview and live match actors:

| Operator | Helmet language |
| --- | --- |
| ChatGPT / Surveyor | Rounded survey helmet, paired horizontal optics, compact chin guard |
| Claude / Warden | Tall squared helmet, broad mandibular armor, continuous visor slit |
| Grok / Outrider | Narrow tapered jaw, offset crown rail, tilted monocular slit and sensor |
| Meta / Bulwark | Broad low helmet, heavy cheek/chin armor, split optics |
| Gemini / Duplex | Tall crown, binocular optics, narrow cheek guards |
| DeepSeek / Bathys | Deep diver faceplate, paired rectangular windows, forward respirator |
| Mistral / Slipstream | Swept crown rails, tapered jaw, angled optics |
| Kimi / Orbital | Round orbital shell, panoramic faceplate, three unequal sensors |
| Qwen / Lamellar | Squared shell, stepped crown armor, three optical segments |

Each identity has its own shell contour, visor proportions and assembled helmet
hardware. Existing operator crests, rings, fins and wing/harness silhouettes are
retained. The shared body now has a contoured cuirass and abdomen, split beveled
sternum plates, rounded forearm/shin plating, smoother capsule limbs, and a
single-mesh articulated glove with three finger segments. Collar clasps and
recessed vent slits are batched into one optional close-range mesh.

Armor remains the existing **per-actor team material**. Identity glow, wing
accents, non-color team bars, base/outline, and shield status remain separate.
All hand sockets, public head/torso/brow/nub references, joints, grounded sole
dimensions, carry mount, bind capture and animation ownership remain live.

## Weapon silhouettes

`game/weapon-models/chassis.mjs` uses a shared hard-surface vocabulary from
`game/model-geometry.mjs`. Rounded boxes are indexed after construction. The
large receivers receive two-segment bevels with per-function corner radii;
smaller components use one-segment bevels. Turned barrels have 24 radial
segments, rolled collars, recessed inner walls and genuinely open bores.

- Pulse: compact beveled carbine and ribbed barrel saddle.
- Rocket: broad rounded launch housing and large tube collars.
- Rail: straight accelerator rails with rectangular yokes and a scoped receiver.
- Scatter: two separate bores and ribbed break-action saddle.
- Plasma: broad-radius chamber and closely spaced cooling rings.
- Grenade: 24-segment indexed drum with six machined flute strips.
- Shock: open C-shaped induction yokes around the electrical fork.
- Flak: heavy breech, broad bore collars and offset ammunition box.
- Marksman: slim receiver, precision barrel ferrules and existing open scope.
- SMG: short receiver, compact saddle, straight magazine and telescoping stock.

Receiver inlays/fasteners are **one mesh**, and barrel hardware (or drum flutes)
is **one mesh**. These add only two body draw objects per detailed weapon.
The latter follows its actual barrel hinge or feed assembly during reloads.

World weapons still use exactly **five visible meshes**. They now have beveled
body components, ten-segment open barrels, an actual twin-bore scatter barrel
merged into one mesh, and a cylindrical grenade drum. World models do not build
and discard a detailed model.

The muzzle coordinate table, muzzle/flash parenting, dual scatter muzzles,
iron/scope/attachment sight geometry and anchors, ADS solver, receiver grip
contacts, reload pivots, bolt motion, finishes and preview builder contract are
unchanged. No map or `game/view.mjs` edit is required.

## LOD and resource ownership

Native `THREE.LOD` selects reduced-subdivision mesh leaves at **18 world units**,
with **15% hysteresis**. It leaves the articulated joints and original mesh
references intact and shares each level's material. Low meshes are retained as
hidden children, so uncached preview disposal can find every geometry. The
software renderer starts on the low level and disables automatic switching;
it does not implement Three's automatic LOD traversal.

The existing quality/distance policy also hides the tagged close-range details.
High quality retains those details even at distance, but still gets the new
geometry LOD. There are no dynamic mesh builds, per-frame geometry allocations,
global resource caches or new lights. Cached geometries/materials belong to the
active `ModelAssets`; duplicate builds allocate no new shared resources.

## Measured geometry costs

Reproduce with:

```sh
node scripts/measure-lattice-models.mjs
```

Numbers below count **visible geometry submissions**, without frustum/occlusion
culling. Vertices include UV/normal seam duplicates. Each visible mesh uses one
material/draw object; renderer shadow and postprocessing passes are excluded.
Inactive flashes and shields are excluded. These are scene-assembly costs,
**not GPU timing or FPS results**.

Neutral operators include the held world Pulse Rifle:

| Operator | Near vertices | Near triangles | Near draws | Distant low vertices | Distant low triangles | Distant low draws |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| ChatGPT | 9,069 | 12,364 | 63 | 5,070 | 6,508 | 47 |
| Claude | 8,861 | 12,024 | 65 | 4,968 | 6,268 | 51 |
| Grok | 8,936 | 12,124 | 63 | 4,963 | 6,320 | 47 |
| Meta | 9,226 | 12,660 | 64 | 5,333 | 6,904 | 50 |
| Gemini | 9,083 | 12,376 | 64 | 5,110 | 6,572 | 48 |
| DeepSeek | 8,827 | 11,972 | 63 | 4,934 | 6,216 | 49 |
| Mistral | 9,053 | 12,252 | 64 | 5,080 | 6,448 | 48 |
| Kimi | 9,344 | 12,820 | 63 | 5,345 | 6,964 | 47 |
| Qwen | 9,465 | 12,808 | 65 | 5,304 | 6,688 | 49 |

Before this upgrade, the same neutral operators submitted 4,504–4,903 vertices,
5,892–6,580 triangles and **the same 63–65 visible draw objects**. The increased
polygon budget is concentrated in the near model. Allocated operator meshes
now number 100–105 including inactive LOD leaves, shield, flash and team marks;
only one leaf per LOD is visible.

| Weapon | Detailed vertices | Detailed triangles | Detailed draws | World vertices | World triangles | World draws |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Pulse | 3,093 | 3,704 | 29 | 478 | 612 | 5 |
| Rocket | 3,280 | 4,340 | 27 | 478 | 612 | 5 |
| Rail | 4,899 | 6,284 | 40 | 478 | 612 | 5 |
| Scatter | 3,390 | 4,304 | 28 | 588 | 792 | 5 |
| Plasma | 4,302 | 5,792 | 33 | 478 | 612 | 5 |
| Grenade | 3,517 | 4,124 | 30 | 462 | 552 | 5 |
| Shock | 3,718 | 4,640 | 34 | 478 | 612 | 5 |
| Flak | 3,167 | 3,956 | 29 | 478 | 612 | 5 |
| Marksman | 4,163 | 5,420 | 35 | 478 | 612 | 5 |
| SMG | 3,185 | 3,812 | 30 | 478 | 612 | 5 |

Previous detailed weapons were 708–2,388 triangles in 25–38 visible meshes;
previous world weapons were 60–80 triangles in five meshes. Detailed bodies
remain a local first-person/preview expense, rather than a 32-actor multiplier.

A round-robin **32-actor roster**, with alternating teams and active team
marks/outline, measures:

| Scenario | Vertices | Triangles | Visible draw objects |
| --- | ---: | ---: | ---: |
| All near | 294,927 | 398,692 | 2,169 |
| All distant, high-quality details | 220,361 | 271,948 | 2,169 |
| All distant, low-quality details | 167,925 | 212,180 | 1,679 |
| Eight near / 24 distant low | 199,521 | 258,572 | 1,801 |

The roster has 3,266 allocated meshes, including inactive LOD/effect leaves.
The combined shared cache for the roster and all ten detailed/world weapons is
324 geometries / 47 materials, with **1,878,256 bytes (~1.79 MiB)** of geometry
attribute/index arrays. Unique actor armor/status materials are additional.

### Capsule-dimension correction

The parent WebGL gallery exposed stretched limbs in the initial implementation.
Three r185's `CapsuleGeometry.parameters` names its straight middle section
`height`, not `length`. Both the near refinement and distance-LOD reconstruction
now preserve `height` in the constructor and cache key. This also separates the
upper-arm and shin geometries, which share radius `.082` but have different
middle-section heights (`.20` and `.23`). Forearms retain `.19`, and thighs `.25`.

The added regression first failed against the original implementation with
`height 1 !== 0.2`. It now checks all nine operators, both arm/leg sides, near/far
levels and software mode: authored radius/height, actual full capsule bounds,
unit mesh scale, independent cache entries for same-radius/different-height
limbs, and whole-body standing bounds above the soles and below 2.1 units.
The other added reconstruction parameter reads were audited: Three's sphere
and box fields, and the explicitly authored contour/bevel metadata, match their
constructors. No equivalent primitive-parameter mismatch was found.

Remeasurement after this correction leaves every vertex, triangle, visible draw
and allocated mesh count in the tables unchanged. The two correctly separated
cache entries add 9,376 bytes, reflected in the updated cache totals above.

Correction verification: **35 focused checks passed**, run serially:

```sh
node --test --test-concurrency=1 \
  game/lattice-models.test.mjs game/phase1-characters.test.mjs \
  game/phase1-grips.test.mjs game/phase1-character-integration.test.mjs
node scripts/measure-lattice-models.mjs
```

## Verification and remaining limits

`game/lattice-models.test.mjs` exercises actual scene assembly, team ownership,
outward visor normals, distinct shell data, native and software LOD, cache reuse,
hidden-level disposal, 32-actor budgets, open bores, exact barrel-tip/muzzle
agreement, world transforms, and the actual preview builder.

The existing focused character, grip, lifecycle, team/wing, weapon geometry,
runtime, presentation, rig, sights and ADS tests cover the retained contracts.
Tests run serially (`--test-concurrency=1`); no full build or full suite is needed
for this isolated geometry change.

Initial upgrade verification: **84 passing checks total** before the added
capsule regression: 80 across the focused files and four named model checks
selected from `view.test.mjs`. The commands below now include the new regression:

```sh
node --test --test-concurrency=1 \
  game/lattice-models.test.mjs \
  game/phase1-characters.test.mjs game/phase1-character-integration.test.mjs \
  game/phase1-grips.test.mjs game/team-presentation.test.mjs \
  game/class-presentation.test.mjs game/weapon-presentation.test.mjs \
  game/phase1-weapons-geometry.test.mjs game/phase1-weapons-runtime.test.mjs \
  game/phase1-weapons-ads.test.mjs game/weapon-rig.test.mjs game/sights.test.mjs

node --test --test-concurrency=1 \
  --test-name-pattern='shared model assets reuse robot|operator model adds shoulder|software actors and vehicles carry|muzzle flash keeps its indexed' \
  game/view.test.mjs
```

GPU visual/timing validation remains outstanding: this worker had no connected
desktop browser or installed browser executable. CPU-projected contact sheets
were inspected for the nine heads and ten weapons, but are not substitutes for
the final lit WebGL scene. In particular, the all-visible software-renderer
scenario can exceed its existing frame triangle ceiling; it uses the low meshes
but still relies on the existing budget/culling behavior. A crowded 32-near
WebGL view should be profiled with the final LATTICE map, shadows and effects.
