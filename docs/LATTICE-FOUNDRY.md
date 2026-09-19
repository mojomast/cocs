# Lattice Foundry

`lattice-slice` is now **Lattice Foundry**. The stable queue ID, seven-node
strategic graph and five capturable objectives are preserved. The playable
footprint is 240 × 144 m, concentrating the old square slice's empty margins
into a three-route industrial theatre.

## Layout and coordinate convention

World **north is −Z**, south is +Z, west is −X, east is +X. Each node authors
a unique `label` for the field coach. The old `econ-n`/`econ-s` coordinates are
corrected to match their actual cardinal directions.

| Node ID | Coach label | Centre `(x, y, z)` | Physical identity |
|---|---|---|---|
| `hq-0` | West Command | `(-108, 4, 0)` | Shielded command court, offset blast screen, service-wing roof |
| `front-0` | West Bastion | `(-54, 4, 0)` | Buttressed gate court, lateral entrances, rail-reward roof |
| `econ-n` | North Siphon | `(0, 1, -25)` | Sunken pump court, copper exchanger towers, covered approaches |
| `relay-0` | Foundry Relay | `(0, 4, 0)` | Four-entry furnace court and four 17 m chimney solids |
| `econ-s` | South Siphon | `(0, 1, 25)` | Rotational twin of North Siphon |
| `front-1` | East Bastion | `(54, 4, 0)` | Rotational twin of West Bastion |
| `hq-1` | East Command | `(108, 4, 0)` | Rotational twin of West Command |

Four drive-through depots have actual collision piers and service sheds:
HQ depots `(-100, 4, -50)` / `(100, 4, 50)`, forward depots
`(-70, 4, -50)` / `(70, 4, 50)`. Every HQ, front, siphon, relay and depot has
an authored compound, rather than a marker standing on an empty floor.

## Routes and height choices

- **CQC spine:** offset HQ blast screens, gate courts and two freight chicanes.
  Centre teleporters cross one chicane; a broad, ordinary walking dogleg is
  available alongside each one.
- **Freight loop:** the named `north-road` has a north outbound route and a
  rotational south return variant. Both teams get identical depot, launcher
  and covered arrival access. Road waypoints follow the actual bends around
  freight baffles. The test checks 1.8 m radial vehicle clearance and the
  declared slope cap along both routes.
- **Siphon flank:** separated north/south routes offer economy contests and
  cuttable one-way ziplines. Jump pads sit beside the reachable roof terraces.
  A disabled device never removes the underlying walking route.
- **Eight service roofs:** HQ, bastion, freight and flank roof pairs rise 4 m
  above the work floor. Every roof has two ordinary walking ramps. These are
  ground-replacement wings with real triangle floors/retaining faces and
  inset solid cores; they do not pretend to provide walk-under interiors.
- **Four slag ridges:** raised shoulders between HQ and front provide exposed
  overlooks, two symmetric armor rewards and denser local bot navigation.
- **Siphon basins:** 3 m below the relay court, with descending terrain
  approaches. The outer embankment rises to 9 m; the central transit swales
  dip to 3.2 m. Elevated routes are optional advantages.

Collision, render and ray geometry share the same deterministic 2 m triangle
surface. The existing triangle-exact floor lattice is reused for fast queries.
No random or wall-clock generation, external downloads or new dependencies
are required. Roof-foundation cores are inset from ramp lips so a capsule can
complete its last step onto the roof.

## Art and objective readability

The palette is slate, ceramic, copper and mint, with amber siphon heat
exchangers. A dedicated batched kit pass adds coping, shutters, seams, roof
traction marks, road paint, device plates and zip cables. It replaces the
generic full-height wall cladding on this map. Decorative scatter is disabled
so vegetation cannot obscure gates or device anchors.

The map explicitly selects **fixed daylight**, a lighter sky and ground bounce,
and reduced fog throughout the match. LATTICE capture areas, depots and arrival markers use thin
terrain-following perimeter rings rather than opaque full-radius disks.
Compact traversal snapshots omit height, so their markers recover their real
floor height from the map. Dynamic rings leave ground detail visible even
when a node is owned or contested.

## Validation and measurements

Focused commands, run serially to limit memory use:

```sh
node --test --test-concurrency=1 \
  game/lattice-foundry.test.mjs game/lattice-foundry-view.test.mjs \
  game/lattice-maps.test.mjs game/cocs-traversal.test.mjs \
  game/cocs-traversal-w20.test.mjs game/lattice-interact.test.mjs
```

The checks cover:

- Every spawn, pickup, node, terminal, depot and device anchor is clear,
  supported at the correct height and connected to the same ground nav graph
  by a **physically checked** edge. A nearest-node lookup cannot mask a
  disconnected roof or room.
- Every graph edge is checked against authoritative walking collision.
  All eight roof spines are traversed both ways by actual `moveActor` calls
  without jumping, grappling or class-specific abilities.
- Both variants of all three lanes are checked along their full paths.
- Rotational parity includes terrain samples, solid blocks, identical pickup
  types, depots, device endpoints and device powers; rebuilding geometry
  preserves the collision hash. Baked heights match render triangles.
- Spawn screens prevent direct fire to enemy/shared objectives and enemy
  depots. Sampled axial sightlines in the three principal corridors are
  limited to 120 m. This is a corridor regression gate, not an exhaustive
  claim about every possible diagonal ray.
- An actual 24-seat COCS match runs for 30 simulated seconds twice with the
  same seed, comparing snapshots throughout. Bots leave their compounds,
  fight, score kills and contest multiple objectives simultaneously.
- Real scene construction checks terrain fidelity, bounded batches, thin
  objective rings, marker height and exactly-once disposal on rebuild.

Latest local focused run (seed `7619`; timings depend on host load):

| Measurement | Result |
|---|---:|
| Collision solids | 104 |
| Terrain/retaining triangles | 17,954 |
| Connected nav nodes | 1,103 |
| Static map mesh submissions before culling | 85 |
| Static map triangles before culling | 49,280 |
| 24-seat Match construction | 166 ms |
| 24-seat simulation step p95 | 3.89 ms |
| First contested objective | 11.10 s |
| Time with ≥2 simultaneously contested objectives in the 30 s sample | 10.8 s |

Static rendering counts exclude sky, live actors and dynamic objective
markers. The fixed smoke is a deterministic playable-route regression, not
a multi-seed competitive win-rate study. The test has a tolerant 50 ms p95
shared-host regression ceiling and a 2 s Match construction ceiling.

## Preview positions

Camera position → look-at target, all in `(x, y, z)`:

| View | Camera | Target |
|---|---|---|
| Whole theatre | `(125, 125, 150)` | `(0, 0, 0)` |
| West Bastion / roof ramps | `(-80, 22, 24)` | `(-54, 5, 0)` |
| Relay and siphon separation | `(30, 22, 38)` | `(0, 5, 0)` |
| South Siphon ground approaches | `(26, 14, 49)` | `(0, 3, 25)` |
| West Command compound | `(-90, 17, 28)` | `(-108, 5, 0)` |
| HQ first-person eye | `(-108, 5.5, 0)` | `(-96, 5.5, -7)` |

Useful player footholds: west bastion roof `(-54, 8, -16)`, its ramp toes
`(-80, 4, -16)` / `(-28, 4, -16)`, north siphon `(0, 1, -25)`,
west flank terrace `(-54, 8, 62)`, west zip entry `(-40, 4, 50)`.

Implementation is confined to `lattice-maps.mjs`, the two
`lattice-foundry*.mjs` modules, localized arena/objective presentation in
`view.mjs`, and map-related tests. Existing interaction fixtures now derive
their floor height rather than pinning actors below the new terrain at Y=0.
