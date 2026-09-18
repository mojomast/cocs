# M0 — Performance foundation migration

Status: **integration landed (W9, `feat/m0-integration`).**
Wave W2 produced two pure, additive modules and their equivalence/perf gates:

- `game/floor-lattice.mjs` — baked, triangle-exact terrain floor query.
- `game/spatial.mjs` — static AABB block broadphase + collision hashing.

Nothing in `core.mjs`/`terrain.mjs` is edited by this wave. This document is the
exact switch plan for the integration wave (M1), plus the cache/versioning
contract and the client `skipNav` requirement.

Measured on the W2 worktree (Ryzen-class CI box, Node 22):

| query | before | after (lattice/broadphase) |
| --- | --- | --- |
| `terrainSupportAt` p50 | 21–71 µs (map dependent) | `floorHeightAtLattice` p50 0.17–0.20 µs |
| `terrainSupportAt` p95 | 23–85 µs | p95 0.30–0.52 µs |
| `obstructed` block half p50 | 10–17 µs | `blockObstructed` p50 0.16–0.28 µs |
| `obstructed` block half p95 | 12–20 µs | p95 0.38–0.52 µs |

Equivalent: `floorAtLattice` is byte-identical (IEEE double, ≤1e-6 asserted)
with `terrainSupportAt` on every terrain map, plus authored/stamped floors and
the 0.25/0.30/0.35 m step-up/landing heights. The broadphase returns the same
`obstructed`/`supportAt`/ray results as brute force on all 41 maps.

---

## 1. Floor lattice

### API

```js
import {
  bakeFloorLattice, ensureFloorLattice, invalidateFloorLattice,
  floorAtLattice, floorHeightAtLattice, latticeHash,
  makeFloorQuery, FLOOR_LATTICE_VERSION, DEFAULT_FLOOR_CELL,
} from './floor-lattice.mjs';

const lattice = ensureFloorLattice(arena.terrain, DEFAULT_FLOOR_CELL, {bounds: arena.playBounds ?? arena.bounds});
lattice.hash;                       // '1:deadbeef'
floorAtLattice(lattice, x, z, maxSlope);   // {y, normal, surfaceId, material} | null
floorHeightAtLattice(lattice, x, z, maxSlope); // number | null, allocation-free
```

- `bakeFloorLattice(terrain, cell, {bounds})` rasterizes **walkable triangles
  with `normal[1] > 0`** into an `Int32Array` cell → triangle-index lattice. It
  stores the **raw Float64 triangle vertices** and re-runs `terrainSupportAt`'s
  exact barycentric interpolation, so it is triangle-exact (same
  `(00,01,11)/(00,11,10)` diagonal split as `terrainField`). Do **not** replace
  it with a bilinear height field: bilinear diverges up to ~0.48 m on steep
  cells.
- `cell` is in metres. Default `1`; a 90×90 map is ~8k cells / ~30–40k
  triangle-cell pairs. It is part of the hash, so it is also part of any
  serialized cache.
- `bounds` is the `playBounds` hint. Coverage is the **union** of the hint and
  the actual triangle extents, so shrinking coverage can never miss a triangle;
  `playBounds` is surfaced on the lattice for chunked nav baking.
- `maxSlope` is applied at lookup time (identical filter/order to
  `terrainSupportAt`), so one bake serves every slope budget.
- `floorAtLattice` returns the full `{y,normal,surfaceId,material}` record.
  Hot movement/nav paths should use `floorHeightAtLattice` to avoid the
  per-call normal/result allocation.
- `latticeHash(lattice)` folds the raw component bytes (cell, bounds, indices,
  Float64 vertices/normals) into a stable FNV-1a string, cached on the lattice.

### Switch points

`core.mjs`:

1. **`floorAt` (line 78).** Keep the signature. Build the query once per arena
   and reuse it:
   ```js
   const floorQueryCache = new WeakMap();
   function floorQueryOf(arena) {
     let q = floorQueryCache.get(arena);
     if (!q) {
       q = makeFloorQuery(arena, {bake: true});     // bakes after generation
       floorQueryCache.set(arena, q);
     }
     return q;
   }
   function floorAtTerrain(x, z, arena) {
     const q = floorQueryOf(arena);
     return q.source === 'lattice' ? floorHeightAtLattice(q.lattice, x, z, q.maxSlope)
                                   : q(x, z)?.y ?? null;
   }
   ```
   Replace the terrain branch `terrainSupportAt(x,z,arena.terrain,arena.terrain.maxSlope??.9)?.y??null`
   with `floorAtTerrain(x,z,arena)`. Non-terrain arenas keep the existing block
   branch untouched.
2. **`supportAt` (line 79).** Replace the `for(const b of arena.blocks)` loop
   with `blockSupportTop(arena, x, z, RULES.radius)`. `blockSupportTop` excludes
   `kind==='deck'` and keeps the inclusive `<=` radius, exactly as today.
3. **`presentationSupportAt` (lines 82–86).** Same substitution is **not**
   valid as-is: this variant applies `b.h <= referenceY + .45` to *all* blocks
   (decks included) and uses an inclusive radius. Either keep the brute loop
   here (it is a presentation-only path) or add a `maxH`/`includeDeck` option to
   `blockSupportTop`. Do not silently drop the `referenceY` filter.
4. **`canStand` (line 96).** Same predicate as `obstructed` with an upper Y
   bound; warm the same index and iterate `candidates(x,z,r)`. Keep the
   `b.h < y + MOVE.baseHeight` condition exact.
5. **`obstructed` (line 89).** Replace the block half with
   `blockObstructed(arena, x, y, z, r)` and keep
   `|| terrainObstructed(...)` unchanged:
   ```js
   export function obstructed(x, y, z, r = RULES.radius, arena = MAPS[0]) {
     return blockObstructed(arena, x, y, z, r) || terrainObstructed(x, y, z, r, arena);
   }
   ```
   The y-range checks (`y < b.h-1e-6`, `y+RULES.height > 0`) live in
   `blockObstructed`, so semantics are preserved.
6. **`moveActor` (lines 105–109, 172–175, 178–182).** These inline block loops
   are the other hot call sites:
   - line 105 recovery scan → `candidates(a.x, a.z, RULES.radius)`.
   - line 172 top scan → `candidates(nx, nz, RULES.radius)` + the existing
     `kind!=='deck'` filter and `top<.35` step-up rule.
   - line 174 deck ramp scan → `candidates(nx, nz, RULES.radius)` filtered to
     `kind==='deck'` (keep `Math.abs(b.h-a.y)<.25`).
   - line 180 landing scan → `candidates(a.x, a.z, RULES.radius)`.
   `floorAt` inside `moveActor` becomes `floorAtTerrain`.
7. **`rayWorld` (lines 202–208).** Replace the block loop with
   `rayCandidates(arena, o, d, best)` and keep `boxHit` + the terrain/floor
   branches. Terrain ray cost (`terrainRayHit` scanning all surface + wall
   triangles) is **out of scope for W2**; M1 should bake a triangle BVH. The
   broadphase helper only narrows static blocks.
8. **`walkEdge` (line 214).** Replace `for(const block of arena.blocks)` with
   `candidates(x, z, .52)` filtered to `kind==='deck'`; `floorAt` and
   `obstructed` calls go through the lattice/broadphase versions.
9. **`navigation` (lines 237–244).** The 0.1 m flood calls `floorAt` and
   `obstructed` per sample; those become the lattice/broadphase versions
   automatically. Additionally bake the lattice **before** the flood
   (`ensureFloorLattice(arena.terrain, ...)`) so the 5.7–23.5 s flood is not the
   first query. `navigationEdges`/`pruneToLargestComponent` are unchanged.
10. **`matchNavigation` (lines 246–253).** Key the cache by the nav contract in
    §3 instead of `navigationCache.has(arena)`, and accept a `skipNav` flag
    (see §4).

`movement.mjs` probes: all four translation probes (lines 725–726, 746–747,
774–780, 803–804) consume `ctx.floorAt`/`ctx.obstructed`; no code change is
needed there. Wire the ctx providers instead:

- `core.mjs` lines 814–815 (verb world ctx) → `floorAt:(x,z)=>floorQueryOf(this.arena)(...)`, `obstructed`.
- `director.mjs` lines 337–338 (director world ctx) → same.
- `payload.mjs` line 8 `groundAt` uses `terrainSupportAt` directly → use
  `ensureFloorLattice` + `floorHeightAtLattice`. `payloadTemplate` already takes
  injected `floorAt`/`walkEdge`/`obstructed` (line 295), so once core passes the
  fast versions the payload route builder inherits them; its internal
  `floorAt(x,z,arena)` calls (lines 36, 69) stay as the injected function
  signature.

Generation stamping:

- `levelgen.mjs`/`nextgen-maps.mjs` call `stampTerrainFloor` and
  `terrain.height(...)` during construction only. Bake **after** generation:
  `Match` builds its first query in the constructor, which runs after
  `createLevel`/`stampTerrainFloor`. Never bake mid-stamp.
- `stampTerrainFloor` (terrain.mjs line 234) clears the triangle caches. The
  lattice must be invalidated the same way: add
  `invalidateFloorLattice(terrain)` next to those `*Cache.delete(terrain)` calls
  (import at the top of `terrain.mjs`). This is the only terrain.mjs edit the
  integration needs.
- `terrain.height` (terrain.mjs line 235) can keep calling `terrainSupportAt`;
  it is a generation-time closure. Optionally repoint it at the baked lattice
  once generation ends.

---

## 2. Block broadphase

### API

```js
import {
  makeBlockIndex, candidates, rayCandidates,
  blockObstructed, blockSupportTop,
  blockHash, collisionHash, invalidateBlockIndex, NAV_BAKE_VERSION,
} from './spatial.mjs';

const index = makeBlockIndex(arena);         // WeakMap-cached per arena
index.candidates(x, z, r);                   // superset of blocks within r in XZ
index.rayCandidates(origin, dir, max);       // superset of blocks a ray can hit
candidates(arena, x, z, r);                  // convenience wrappers
rayCandidates(arena, origin, dir, max);
blockObstructed(arena, x, y, z, r);          // exact block half of core.obstructed
blockSupportTop(arena, x, z, r);             // exact block half of supportAt (deck excluded)
```

- The grid is a **loose uniform grid** whose cell size is the **measured max
  half-extent** on the map (min 1 m), so the largest block spans ≤2 cells per
  axis. The index is cached in a `WeakMap` because `MAPS` is frozen and cannot
  carry a property.
- Insertion uses each block's XZ AABB; the exact predicates (`deck`, `NEXTGEN_PROXY`
  proxies, y ranges) stay in the callers. `NEXTGEN_PROXY` blocks (`cave`,
  `tunnel`, `rock`, `tree`, `crate`, `column`) are **invisible but collidable**,
  and are registered like any other block.
- `candidates` is a strict superset: every block passing
  `|x-b.x| < b.w/2+r && |z-b.z| < b.d/2+r` is returned. `rayCandidates` walks
  the XZ projection with an Amanatides–Woo traversal after clipping to the grid
  rectangle (handles zero-length XZ rays, vertical rays, rays from outside the
  bounds and `max === Infinity`).
- `blockObstructed` and `blockSupportTop` are drop-in replacements so the
  integration cannot drift from core's predicates.

### Switch points

1. `obstructed`, `supportAt`, `canStand`, `moveActor`, `walkEdge`, `rayWorld`,
   `presentationSupportAt` — as in §1. Use `blockSupportTop` for `supportAt`,
   `blockObstructed` for `obstructed`/`canStand`.
2. `bots.mjs`/`objectives.mjs`/`director.mjs`/`review.mjs` import `floorAt`,
   `obstructed`, `walkEdge` from `core.mjs`, so they inherit the change with no
   code edits.
3. If a runtime arena is ever mutated (not true for frozen `MAPS`), call
   `invalidateBlockIndex(arena)`.

---

## 3. Nav serialization + versioning contract

A nav graph may only be reused when **all** of these match:

```
navCacheKey = (mapId, generationSeed, collisionHash(arena), NAV_BAKE_VERSION)
```

- `mapId`: `arena.id` (templates are frozen; the id pins geometry identity).
- `generationSeed`: the seed that produced authored stamps/levelgen terrain
  (`options.seed` in `createLevel`, `map.seed`/`map.genSeed` if present).
  Procedural maps bake their `Match` from the same seed, so a seed change means
  a different mesh and thus a different `collisionHash`; still include it so a
  seed-only change is not hidden by a hash collision.
- `collisionHash(arena)` (`spatial.mjs`): FNV-1a over
  `blockHash(arena)` + `latticeHash(floor lattice)` + `terrain.maxSlope` +
  every `terrainWallSegments` endpoint. It captures terrain floors, cliff/wall
  segments and static blocks in one 32-bit signature. Bump the hash algorithm
  only with `NAV_BAKE_VERSION`.
- `NAV_BAKE_VERSION` (`spatial.mjs`, currently `1`): bump whenever navigation
  **construction** changes (grid step, radius, node/edge rules, component
  pruning). Independent of `FLOOR_LATTICE_VERSION`; the lattice version is
  already folded into `latticeHash` because it is part of the hash string.

Serialization: cache the raw `navigation()` output (`nodes:[{x,y,z}]`,
`edges:number[][]`), plus the key tuple. Re-hydrate with a validity check:
`stored.key === navCacheKey(arena, seed)`. Server-authoritative maps can ship a
prebaked graph per `(mapId, seed)`; clients validate against their locally
computed `collisionHash` (see §4).

Perf note: `navigation()` is 5.7–23.5 s because it floods a 0.1 m grid with
per-sample `floorAt`/`obstructed`. With the lattice + broadphase this drops by
~100–200× on the query side; M1 should still cache the resulting graph via the
key above, and consider a coarser authored `navNodes` seed for the next-gen
maps.

---

## 4. Client `skipNav` requirement

`NetClient.createShadow` (`game/net.mjs` lines 412–420) constructs a full
`Match`, which calls `matchNavigation(this.arena)` (`core.mjs` line 277) → the
5.7–23.5 s `navigation()` flood, on the client, every time a shadow is created
(respawn/reconnect included). The client prediction shadow never pathfinds with
the graph: it only needs `moveActor`, which uses `floorAt`/`obstructed`/rays.

Required change (M1):

1. Add an opt-in `options.skipNav` to the `Match` constructor. When true:
   - set `this.nav=[]`, `this.edges=[]` and skip `matchNavigation` entirely;
   - guard the spawn-from-nav fallbacks (lines 284–289), the objective-zone
     snapping (lines 297, 305–308) and any `this.nav` reads in `spawn` (line 588)
     so an empty graph falls back to authored spawns/floors (the existing
     `nodes.length` guards mostly handle this; the KOTH zone snap must skip when
     `this.nav.length === 0`).
2. `createShadow` (`net.mjs` line 414) passes `skipNav: true` in the config
   object. The server/harness still builds the full graph.
3. The shadow still bakes the **floor lattice** (`makeFloorQuery(arena,{bake:true})`)
   — required for correct `moveActor` — but that is a one-time raster of the
   frozen mesh (tens of ms), not a 0.1 m flood.
4. Server snapshots drive NPC movement; the client shadow is a single actor, so
   skipping nav cannot change observed behaviour. Add a net test that a shadow
   with `skipNav` predicts the same local actor state as one without it for a
   fixed input sequence.

Until `skipNav` lands, the lattice/broadphase alone do not help
`createShadow`, because the graph construction is what stalls.
