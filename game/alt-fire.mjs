// Alt-fire modes: exactly one per weapon index. The simulation reads the
// behaviour fields from `Match.altFire`; presentation, HUD and audio read the
// identity fields (`id`/`label`/`summary`/`tracer`/`sound`) so every surface
// names the same mode. Pure data and pure helpers: no engine imports, no
// clock, no randomness, so the table stays deterministic and testable.

const spec = (index, fields) => Object.freeze({
  index,
  // Short HUD/identity fields.
  id: fields.id,
  label: fields.label,
  summary: fields.summary,
  appearance: fields.appearance,
  tracer: fields.tracer,
  sound: fields.sound,
  // Behaviour fields consumed by the simulation.
  kind: fields.kind, // 'hitscan' | 'projectile'
  damage: fields.damage ?? 0, // per pellet for hitscan, direct hit for projectile
  shots: fields.shots ?? 1,
  spread: fields.spread ?? 0,
  interval: fields.interval, // seconds between alt triggers (shares shotWait)
  cost: fields.cost ?? 1, // ammo spent per trigger
  kick: fields.kick ?? 0,
  falloff: fields.falloff ?? null, // {start,end,min} override
  speed: fields.speed ?? 0,
  gravity: fields.gravity ?? 0,
  bounce: fields.bounce ?? 0,
  life: fields.life ?? 4,
  radius: fields.radius ?? 0,
  splash: fields.splash ?? 0,
  pierce: fields.pierce ?? 0,
  chain: fields.chain ?? 0,
  chainScale: fields.chainScale ?? .5,
  chainRange: fields.chainRange ?? 6,
  mine: fields.mine === true,
  arm: fields.arm ?? 0,
  triggerRadius: fields.triggerRadius ?? 0,
  maxMines: fields.maxMines ?? 0,
  bomblets: fields.bomblets ?? 0,
  bombletDamage: fields.bombletDamage ?? 0,
  bombletSplash: fields.bombletSplash ?? 0,
  bombletRadius: fields.bombletRadius ?? 0,
  flak: fields.flak ?? 0,
  flakDamage: fields.flakDamage ?? 0,
  flakSpread: fields.flakSpread ?? 0,
});

// Indexed by weapon id so lookups never depend on names. Keep the table in the
// same order as WEAPONS in data.mjs; alt-fire.test.mjs pins the coverage.
export const ALT_FIRE = Object.freeze([
  spec(0, {id: 'salvo', label: 'SALVO', kind: 'hitscan', shots: 3, damage: 9, spread: .03, interval: .5, kick: .018,
    summary: 'Three-round pulse fan for peeking burst damage.', appearance: 'The barrel splits into three prongs with heat fins.',
    tracer: '#7de8ff', sound: 'salvo'}),
  spec(1, {id: 'cluster', label: 'CLUSTER', kind: 'projectile', speed: 17, damage: 15, splash: 26, radius: 3.2, interval: 1,
    bomblets: 3, bombletDamage: 8, bombletSplash: 12, bombletRadius: 2, kick: .05,
    summary: 'A slower rocket that shatters into three bomblets.', appearance: 'A tri-tube cluster pod unfolds over the muzzle.',
    tracer: '#ffb066', sound: 'cluster'}),
  spec(2, {id: 'overload', label: 'OVERLOAD', kind: 'hitscan', damage: 68, pierce: 3, interval: 1.5, kick: .07,
    summary: 'A piercing overcharged lance beam.', appearance: 'The rail coils separate and glow white.',
    tracer: '#fff2c4', sound: 'overload'}),
  spec(3, {id: 'slug', label: 'SLUG', kind: 'hitscan', damage: 38, spread: .008, interval: 1.1, kick: .09,
    falloff: {start: 30, end: 60, min: .75},
    summary: 'A single dense slug that holds damage at range.', appearance: 'The choke extends into a long single bore.',
    tracer: '#ffffff', sound: 'slug'}),
  spec(4, {id: 'mortar', label: 'MORTAR', kind: 'projectile', speed: 20, gravity: .45, damage: 20, splash: 30, radius: 3, interval: .8, kick: .02,
    summary: 'A lobbed plasma orb with a wider blast.', appearance: 'The emitter dome tilts up and rounds out.',
    tracer: '#c9a6ff', sound: 'mortar'}),
  spec(5, {id: 'mine', label: 'PROXIMITY MINE', kind: 'projectile', speed: 10, gravity: .8, bounce: .1, damage: 60, splash: 34, radius: 3.2,
    interval: .9, life: 7, mine: true, arm: .45, triggerRadius: 2.6, maxMines: 2, kick: .03,
    summary: 'A drifting mine that arms and triggers on nearby enemies.', appearance: 'The drum seals and a sensor eye blinks blue.',
    tracer: '#8fd9ff', sound: 'mine'}),
  spec(6, {id: 'chain', label: 'CHAIN', kind: 'hitscan', damage: 32, chain: 3, chainScale: .55, chainRange: 7, interval: .8, kick: .025,
    summary: 'Lightning that arcs to three nearby enemies.', appearance: 'Antenna prongs rise and crackle.',
    tracer: '#a8f0ff', sound: 'chain'}),
  spec(7, {id: 'bomb', label: 'FLAK BOMB', kind: 'projectile', speed: 16, gravity: .5, damage: 14, splash: 20, radius: 2.6, interval: 1.1,
    flak: 8, flakDamage: 6, flakSpread: .5, kick: .06,
    summary: 'A lobbed shell that bursts into shrapnel.', appearance: 'The bore opens into a wide flak funnel.',
    tracer: '#ff9a7a', sound: 'bomb'}),
  spec(8, {id: 'double', label: 'DOUBLE TAP', kind: 'hitscan', shots: 2, damage: 26, spread: .006, interval: .75, kick: .03,
    summary: 'Two precise shots on one trigger pull.', appearance: 'The scope folds aside for canted iron sights.',
    tracer: '#ffd9a0', sound: 'double'}),
  spec(9, {id: 'twin', label: 'TWIN', kind: 'hitscan', shots: 2, damage: 4.5, spread: .014, interval: .07, cost: 2, kick: .01,
    summary: 'Twin barrels: faster shred, double ammo.', appearance: 'A second barrel and foregrip fold out.',
    tracer: '#b7ff9a', sound: 'twin'}),
]);

export function altSpecFor(index) {
  const i = Number(index);
  return Number.isInteger(i) && i >= 0 && i < ALT_FIRE.length ? ALT_FIRE[i] : null;
}

export const hasAltFire = index => altSpecFor(index) !== null;

// HUD/arsenal label: "SALVO" or an empty string when the index is unknown.
export function altModeLabel(index) {
  return altSpecFor(index)?.label || '';
}
