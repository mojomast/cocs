# DESTINATIONS — authored map collection and field interface

## Design brief

Build nine distinct destinations covering every registered mode, with purposeful
route complexity and recognizable places. The collection uses original layouts:
transit exchange, overgrown reliquary, volcanic works, frozen fortress, canyon
convoy route, orbital relay, forest processing complex, technical race circuit,
and an open-air stadium. Buildings, arches, tunnels, causeways, columns, natural
props and machinery form coherent districts rather than uniform random scatter.

The field interface pairs this larger world scale with an on-demand tactical
map and explicit squad management. Essential combat information stays visible;
secondary information uses bounded panels and deliberate disclosure.

## Research informing the layouts

Research was delegated independently from implementation. These sources inform
principles; the shipped layouts are original, not reproductions of their maps.

- [Riot — The Creation of Split](https://playvalorant.com/en-us/news/dev/the-creation-of-split/):
  avoid a single elevated position dominating every encounter. Give overlooks
  local purpose and accessible counter-routes.
- [Valve — Well developer commentary](https://wiki.teamfortress.com/wiki/Well_developer_commentary)
  (developer transcript): alternate routes trade travel time for a safer approach;
  reinforcement pressure depends on spawn delay plus travel time.
- [Aaron Keller — Overwatch's Rialto](https://www.arstechnica.com/video/watch/the-inside-story-of-overwatch-s-rialto-map):
  recognizable main routes, local branches, readable elevation and architectural
  view breaks give sequential objective maps distinct phases.
- [Halo — Season 3 Maps & Modes](https://www.halowaypoint.com/news/echoes-within-maps-modes-preview):
  vehicle routes need risk/reward choices, capture sites need different tactical
  identities, and competitive CTF benefits from rotational gameplay symmetry.
- [Riot — Map Environment Art](https://playvalorant.com/en-us/news/dev/the-art-of-valorant-map-environments/):
  preserve collision and combat readability, put rich detail on facades/skyline,
  and reuse materials and instanced props.
- [Psyonix arena standardization, reported with developer quotations](https://www.pcgamer.com/rocket-league-is-dropping-non-standard-arenas-for-competitive-season-6/):
  use the soccer venue for visual identity while keeping the playfield predictable.

## Collection

| Destination | Identity | Primary uses |
| --- | --- | --- |
| Meridian Exchange | multi-exit transit halls, market loops, civic platforms | infantry arena and rotating objectives |
| Verdant Reliquary | root cloister, multi-portal cavern, aqueduct and sun altar | infantry, Horde, The Verdant Signal campaign mission |
| Ember Crucible | furnace courts, workshops, crossing ramps | rockets, arsenal and infantry objectives |
| Tidal Citadel | mirrored coastal forts, ice galleries and tide engine | CTF, assault, elimination and team combat |
| Sunscar Convoy | weighbridge, twin retorts and sun gate | payload, combined arms, assault and VIP escort |
| Asterion Relay | orbital archive, oculus, transmitter fields and meridian galleries | LATTICE PvP and Operations |
| Monsoon Foundry | forest dam, filter houses and turbine courts | LATTICE PvP and Operations |
| Ion Speedway | asymmetric dogleg road course, pit garages and grandstands | Puma Race |
| Aurora Stadium | symmetric open-air pitch, canopied stands and broadcast arches | Puma Soccer |

Exact eligibility lives in each map's `arena.play` and is checked against all
23 registered modes. Existing map defaults and saved IDs remain valid.

The infantry pass includes 14 authored route polylines across six Meridian
buildings, 12 through Verdant's archives/court/cavern, and 17 across Ember's six
buildings and furnace courts. These polylines are swept for ground support,
capsule clearance and forward/return walking, in addition to the registry-wide
placement tests. Static collision counts range from 52 (stadium) to 388
(speedway); the complexity comes from composition and connected districts, not
an unbounded prop scatter pass.

Destination-only construction adds clipped facade skins, masonry, vents, ribs,
coping, route paint and fitted signs. Hard limits are 2,884 batched boxes, eight
sign textures and four new construction materials per arena. No cladding changes
simulation geometry. Floor paint requires complete flat triangle support and
avoids interiors, door approaches, ramps and the sports play surfaces.

## Field controls

- **J** opens the tactical map; **L** opens squad management. Both are remappable,
  preserving the existing **M** GO-order binding.
- Tactical map terrain/footprints are cached by immutable map; snapshot-driven
  markers are bounded. Supply-graph links remain visually distinct from lanes.
- Map orders use the existing legal node target set and confirmed commander
  seat. A terrain click chooses the nearest legal node, not a fabricated free-form
  command destination.
- Squads contain up to four player operators. Create/join/leave/promote/remove
  commands are checked on both enqueue and application. Leaders manage their
  squad, commanders can manage allied squads, and enemy squad state stays private.
- Player squads are separate from AI reinforcement THREADS. Existing team stance
  and routes remain explicitly team-wide. Membership is displayed only after an
  authoritative snapshot confirms it.
- Dialogs own focus and suspend held combat/touch inputs. They use the shared
  cursor lifecycle for pointer-lock release and return to play.

## Engine constraints

- A block occupies ground through its top height; it cannot be used as a floating
  floor with an assumed walkable underpass. Upper routes need real ground ramps.
- Navigation must connect placements to a bidirectional runtime component, not
  merely contain an authored node at each location.
- Payload derives its walking route from team spawn anchors. Objective labels
  alone do not force a cart to visit an authored sequence.
- New sports maps must opt into exactly their vehicle mode and stay out of combat,
  Horde and Campaign selection. Race and soccer metadata are not interchangeable.
- Campaign coverage requires a real mission bound to the new map, with supported
  anchors; a generic mode-support label is insufficient.
- Tactical enemy markers must use revealed information. Commander and squad
  controls submit through the existing authoritative command channel.

## Verification policy

Intensive tests, builds and browser/performance runs are serialized. Placement,
traversal, objective, LATTICE, vehicle and campaign gates remain authoritative.
Visual inspection supplements them with map overview and ground-level views.
HUD checks include desktop, portrait, landscape and enlarged UI, aiming-corridor
clearance, modal keyboard focus, pointer-lock handoff and touch hit testing.
Geometry/draw accounting and software-renderer evidence are not hardware FPS
claims.
