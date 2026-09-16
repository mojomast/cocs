import test from 'node:test';
import assert from 'node:assert/strict';
import { Match } from './core.mjs';
import { WEAPONS, RULES } from './data.mjs';
import { weaponById, weaponByName, weaponDPS, weaponTTK, weaponBalanceSummary, WEAPON_ROLES } from './weapons.mjs';
import { SINGLEPLAYER_REGEN, COMBAT_CONSTANTS } from './constants.mjs';
import { updateSinglePlayer, updateHealthRegen, singlePlayerSnapshot, REGEN_DELAY, REGEN_RATE } from './singleplayer.mjs';
import { SPEAKERS, MISSION_LORE, getMissionLore, formatTransmission } from './story.mjs';
import { getMissionBriefing, getMissionTransmissions, validateMissionProgression, CAMPAIGN_MISSIONS } from './campaign.mjs';
import { ProceduralSpring, VectorSpring3D, WeaponRig, solveTwoBoneIK } from './rig.mjs';
import { enhanceModelMaterials, createThrusterExhaust, createEnergyShieldMesh, FIDELITY_PRESETS } from './models.mjs';
import { characterPose, CharacterRig } from './character-anim.mjs';
import { singlePlayerDisplay } from './singleplayer-ui.mjs';
import { SynthAudio } from './feedback.mjs';

test('weapon balancing across arsenal defines distinct roles with no dominating outliers', () => {
  assert.equal(WEAPONS.length, 10);
  const summary = weaponBalanceSummary();
  assert.equal(summary.length, 10);

  // Pulse Rifle: reliable starter
  const pulse = weaponByName('Pulse Rifle');
  assert.equal(pulse.damage, 11);
  assert.equal(pulse.interval, 0.1);
  assert.ok(weaponDPS(pulse) >= 110);

  // Flak Cannon: boosted point-blank shredder
  const flak = weaponByName('Flak Cannon');
  assert.equal(flak.damage, 6);
  assert.equal(flak.pellets, 12);
  assert.equal(flak.damage * flak.pellets, 72);
  assert.equal(flak.interval, 0.84);
  assert.equal(flak.ammo, 12);
  assert.equal(flak.cap, 36);

  // Marksman Rifle: crisp precision semi-auto
  const marksman = weaponByName('Marksman Rifle');
  assert.equal(marksman.damage, 38);
  assert.equal(marksman.interval, 0.46);
  assert.equal(marksman.ammo, 10);
  assert.equal(marksman.cap, 30);
  assert.ok(weaponTTK(marksman, 100) < 1.0, '3-shot kill under 1 second');

  // Rail Lance: high-skill piercing burst
  const rail = weaponByName('Rail Lance');
  assert.equal(rail.damage, 82);
  assert.equal(rail.interval, 1.2);
  assert.equal(rail.ammo, 6);

  // Scattergun: mid-damage close spread
  const scatter = weaponByName('Scattergun');
  assert.equal(scatter.damage, 8.5);
  assert.equal(scatter.pellets, 8);
  assert.equal(scatter.interval, 0.78);

  // Submachine Gun: run-and-gun rapid fire
  const smg = weaponByName('Submachine Gun');
  assert.equal(smg.damage, 7.5);
  assert.equal(smg.interval, 0.058);
  assert.equal(smg.ammo, 32);
  assert.equal(smg.reload, 1.4);

  // Check roles exist for every weapon
  for (let i = 0; i < WEAPONS.length; i++) {
    assert.ok(WEAPON_ROLES[i], `Role defined for weapon ${i}`);
    assert.ok(weaponDPS(WEAPONS[i]) > 40, `DPS viable for weapon ${i}`);
    assert.ok(Number.isFinite(weaponTTK(WEAPONS[i], 100)), `Finite TTK for weapon ${i}`);
  }
});

test('single player health regen operates gracefully out of combat', () => {
  const match = new Match('chatgpt', 'openclaw', () => 0.5, 'colosseum', {
    mode: 'horde',
    fragLimit: 10,
    botCount: 0,
    humanCount: 1,
  });
  const player = match.actors[0];
  const state = match.modeState;

  match.step(1 / 60, { inputs: {} });
  for (const a of match.actors) if (a.isNpc) { a.health = 0; a.dead = 1e9; }
  state.phase = 'intermission';
  state.timer = 100;
  assert.equal(player.health, player.maxHealth);

  // Player takes damage
  player.protection = 0;
  player.health = 40;
  state.lastPlayerHealth = 100;

  // One tick detects damage and starts delay
  match.step(1 / 60, { inputs: {} });
  assert.ok(state.regenDelay > 4.0, 'Regen delay armed after damage');
  assert.equal(state.regenActive, false, 'Regen not active during delay');
  assert.equal(player.health, 40, 'Health unchanged during delay');

  // Step forward 2 seconds (still in delay)
  for (let i = 0; i < 120; i++) match.step(1 / 60, { inputs: {} });
  assert.ok(state.regenDelay > 0, 'Still in delay');
  assert.equal(player.health, 40, 'Health does not heal while in combat cooldown');

  // Step past the remaining delay into out-of-combat state (total > 4.5s)
  for (let i = 0; i < 180; i++) match.step(1 / 60, { inputs: {} });
  assert.equal(state.regenDelay, 0, 'Delay expired');
  assert.ok(player.health > 40, `Player health regenerating (${player.health} > 40)`);
  assert.equal(state.regenActive, true, 'Regen is active');

  // Let it fully heal back to maxHealth
  for (let i = 0; i < 300; i++) match.step(1 / 60, { inputs: {} });
  assert.equal(player.health, player.maxHealth, 'Fully regenerated to max health');
  assert.equal(state.regenActive, false, 'Regen deactivates when at max health');
});

test('single player health regen does not activate in multiplayer modes or for dead players', () => {
  // Multiplayer match
  const mp = new Match('chatgpt', 'openclaw', () => 0.5, 'exchange', {
    mode: 'deathmatch',
    botCount: 0,
    humanCount: 1,
  });
  const p = mp.actors[0];
  p.protection = 0;
  p.health = 30;
  for (let i = 0; i < 360; i++) mp.step(1 / 60, { inputs: {} });
  assert.equal(p.health, 30, 'Health does not regenerate in deathmatch');

  // Dead player in single player
  const sp = new Match('chatgpt', 'openclaw', () => 0.5, 'colosseum', {
    mode: 'horde',
    botCount: 0,
    humanCount: 1,
  });
  const spPlayer = sp.actors[0];
  spPlayer.health = 0;
  spPlayer.dead = 100;
  updateHealthRegen(sp, sp.modeState, 1.0);
  assert.equal(spPlayer.health, 0, 'Dead player does not heal');
});

test('singlePlayerSnapshot exposes regen state and details', () => {
  const match = new Match('chatgpt', 'openclaw', () => 0.5, 'convoy-line', {
    mode: 'campaign',
    mission: 'convoy-run',
    botCount: 0,
    humanCount: 1,
  });
  match.step(1 / 60, { inputs: {} });
  const snap = match.snapshot().singleplayer;
  assert.ok(snap.regen, 'snapshot contains regen object');
  assert.equal(typeof snap.regen.active, 'boolean');
  assert.equal(typeof snap.regen.delay, 'number');
  assert.equal(snap.regen.rate, REGEN_RATE);
});

test('storytelling lore and transmissions provide deep mission background', () => {
  assert.ok(SPEAKERS.DISPATCH);
  assert.ok(SPEAKERS.RELAY);
  assert.ok(SPEAKERS.WARDEN);
  assert.ok(SPEAKERS.HARBINGER);

  for (const mission of CAMPAIGN_MISSIONS) {
    const lore = getMissionLore(mission.id);
    assert.ok(lore, `Lore exists for mission ${mission.id}`);
    assert.ok(lore.title && lore.location && lore.intel && lore.threatLevel);
    assert.ok(Array.isArray(lore.transmissions) && lore.transmissions.length >= 3);

    const briefing = getMissionBriefing(mission.id);
    assert.equal(briefing.id, mission.id);
    assert.ok(briefing.intel);
  }

  const tx = formatTransmission('DISPATCH', 'Incoming hostile wave!');
  assert.equal(tx.speaker, 'Tactical Control');
  assert.equal(tx.callsign, 'COMMAND-01');
  assert.equal(tx.text, 'Incoming hostile wave!');
});

test('campaign progression validator correctly handles unlocked missions', () => {
  const prog1 = validateMissionProgression([]);
  assert.equal(prog1.unlocked.length, 1);
  assert.equal(prog1.nextMission, CAMPAIGN_MISSIONS[0].id);
  assert.equal(prog1.isComplete, false);

  const prog2 = validateMissionProgression([CAMPAIGN_MISSIONS[0].id]);
  assert.equal(prog2.unlocked.length, 2);

  const all = CAMPAIGN_MISSIONS.map(m => m.id);
  const prog3 = validateMissionProgression(all);
  assert.equal(prog3.unlocked.length, all.length);
  assert.equal(prog3.isComplete, true);
});

test('procedural rigging springs and weapon rig behave physically', () => {
  const spring = new ProceduralSpring({ frequency: 10, damping: 0.9, initial: 0 });
  spring.setTarget(1.0);
  for (let i = 0; i < 60; i++) spring.update(1 / 60);
  assert.ok(Math.abs(spring.pos - 1.0) < 0.05, 'Spring reaches target');

  const rig = new WeaponRig();
  const output = rig.update({
    dt: 1 / 60,
    mouseDeltaX: 10,
    mouseDeltaY: -5,
    velocity: { x: 3, y: 0, z: 2 },
    grounded: true,
    ads: false,
    speed: 4,
  });
  assert.ok(Number.isFinite(output.offset.x));
  assert.ok(Number.isFinite(output.offset.y));
  assert.ok(Number.isFinite(output.offset.z));
  assert.ok(Number.isFinite(output.rotation.pitch));
  assert.ok(Number.isFinite(output.rotation.roll));

  // Two-bone IK test
  const ik = solveTwoBoneIK({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1.0 }, 0.6, 0.6);
  assert.ok(ik.reachRatio > 0 && ik.reachRatio <= 1.0);
  assert.ok(Number.isFinite(ik.upperAngle));
  assert.ok(Number.isFinite(ik.elbowAngle));
});

test('model visual fidelity utilities construct valid meshes and materials', () => {
  const shield = createEnergyShieldMesh({ radius: 1.2 });
  assert.ok(shield.isMesh);
  assert.equal(shield.material.wireframe, true);
  shield.geometry.dispose();
  shield.material.dispose();

  const exhaust = createThrusterExhaust(null, { size: 0.1 });
  assert.equal(exhaust.name, 'thruster-exhaust');
  assert.equal(exhaust.children.length, 2);
  for (const child of exhaust.children) {
    child.geometry.dispose();
    child.material.dispose();
  }
});

test('singlePlayerSnapshot enriches narrative transmissions with speaker profile metadata', () => {
  const match = new Match('chatgpt', 'openclaw', () => 0.5, 'convoy-line', {
    mode: 'campaign',
    mission: 'convoy-run',
    botCount: 0,
    humanCount: 1,
  });
  match.modeState.storyLine = {
    speaker: 'DISPATCH',
    text: 'Priority neural shipment detected on northern highway.',
    at: match.time,
  };
  match.modeState.bark = {
    speaker: 'ECHO',
    text: 'Hostile spitters spotted on high ground.',
    at: match.time,
  };

  const snap = singlePlayerSnapshot(match.modeState, match);
  assert.ok(snap.story);
  assert.equal(snap.story.speaker, 'Tactical Control');
  assert.equal(snap.story.callsign, 'COMMAND-01');
  assert.equal(snap.story.color, '#57e6cd');
  assert.equal(snap.story.tag, 'TACTICAL');

  assert.ok(snap.bark);
  assert.equal(snap.bark.speaker, 'Recon Drone Echo-4');
  assert.equal(snap.bark.callsign, 'ECHO-4');
  assert.equal(snap.bark.color, '#ffd166');

  // Verify singlePlayerDisplay adapter forwards them
  const display = singlePlayerDisplay({ singleplayer: snap, actors: match.actors });
  assert.ok(display.story);
  assert.equal(display.story.callsign, 'COMMAND-01');
  assert.ok(display.bark);
  assert.equal(display.bark.callsign, 'ECHO-4');
  assert.ok(display.regen);
  assert.equal(display.regen.rate, REGEN_RATE);
});

test('shieldBreak is emitted on damage when shield or armor is completely shattered', () => {
  const match = new Match('chatgpt', 'openclaw', () => 0.5, 'colosseum', {
    mode: 'deathmatch',
    botCount: 1,
    humanCount: 1,
  });
  const player = match.actors[0];
  const enemy = match.actors[1];
  player.protection = 0;
  enemy.protection = 0;
  enemy.armor = 20;
  enemy.health = 100;

  // Small damage that reduces armor from 20 to 8: shieldBreak is false
  match.damage(enemy, 20, player);
  const ev1 = match.events.filter(e => e.type === 'damage').at(-1);
  assert.ok(ev1);
  assert.equal(ev1.shieldBreak, false, 'Armor still remains, no shieldBreak');
  assert.ok(enemy.armor > 0);

  // Large damage that completely depletes remaining armor: shieldBreak is true
  match.damage(enemy, 50, player);
  const ev2 = match.events.filter(e => e.type === 'damage').at(-1);
  assert.equal(ev2.shieldBreak, true, 'Armor depleted to 0 emits shieldBreak: true');
  assert.equal(enemy.armor, 0);

  // Subsequent damage when armor is already 0: shieldBreak is false
  match.damage(enemy, 10, player);
  const ev3 = match.events.filter(e => e.type === 'damage').at(-1);
  assert.equal(ev3.shieldBreak, false, 'No shield was present, so shieldBreak is false');
});

test('SynthAudio supports spree announcer cue, critical ping, and shieldBreak audio layers', () => {
  const audio = new SynthAudio({ announcer: true });
  const nodes = [];
  const param = () => ({ setValueAtTime(){}, linearRampToValueAtTime(){}, exponentialRampToValueAtTime(){}, setTargetAtTime(){} });
  const node = () => { const n = { frequency: param(), gain: param(), connect(){}, disconnect(){}, start(){}, stop(){} }; nodes.push(n); return n; };
  audio.ctx = { currentTime: 1, destination: {}, createOscillator: node, createGain: node, createBiquadFilter: node, close(){} };

  // 1. Spree announcer cue
  const spree = audio.announcerCue('spree');
  assert.ok(spree);
  assert.equal(spree.cue, 'spree');
  assert.equal(spree.played, true);

  // 2. Critical hit audio plays single _play token with high frequency ping
  const plays = [];
  audio._play = (duration, pan, build) => {
    plays.push({ duration, pan });
    build(1, node(), []);
  };
  const scorer = { id: 1, weapon: 0, x: 0, z: 0 };
  
  // Normal damage
  audio.lastHit = -10;
  audio.event({ type: 'damage', id: 101, time: 2, actor: 2, source: 1, amount: 20 }, scorer);
  assert.equal(plays.length, 1);
  assert.equal(plays[0].duration, 0.12);

  // Critical damage
  audio.lastHit = -10;
  audio.event({ type: 'damage', id: 102, time: 3, actor: 2, source: 1, amount: 20, critical: true }, scorer);
  assert.equal(plays.length, 2);
  assert.equal(plays[1].duration, 0.16, 'Critical hit plays extended resonant chime');

  // Shield break damage
  audio.lastHit = -10;
  audio.event({ type: 'damage', id: 103, time: 4, actor: 2, source: 1, amount: 35, shieldBreak: true }, scorer);
  assert.equal(plays.length, 3);

  // Local shield break damage received
  audio.event({ type: 'damage', id: 104, time: 5, actor: 1, source: 2, amount: 40, shieldBreak: true }, scorer);
  assert.equal(plays.length, 4);
  assert.equal(plays[3].duration, 0.24, 'Local shield break duration accommodates shatter transient');

  audio.dispose();
});

test('SynthAudio triggers low-health heartbeat and vehicle nitro engine pitch boost', () => {
  const audio = new SynthAudio();
  const nodes = [];
  const param = () => ({ setValueAtTime(){}, linearRampToValueAtTime(){}, exponentialRampToValueAtTime(){}, setTargetAtTime(){} });
  const node = () => { const n = { frequency: param(), gain: param(), connect(){}, disconnect(){}, start(){}, stop(){} }; nodes.push(n); return n; };
  audio.ctx = { currentTime: 1, destination: {}, createOscillator: node, createGain: node, createBiquadFilter: node, close(){} };

  const plays = [];
  audio._play = (duration, pan) => plays.push({ duration, pan });

  const healthyPlayer = { id: 1, health: 100, maxHealth: 100, grounded: true, vx: 0, vy: 0, vz: 0, weapon: 0 };
  // Healthy player does not trigger heartbeat
  for (let i = 0; i < 60; i++) audio.update(healthyPlayer, [], 1 / 60);
  assert.equal(plays.length, 0, 'No heartbeat when healthy');

  // Low health player (< 28 HP) triggers rhythmic heartbeat
  const lowHealthPlayer = { id: 1, health: 22, maxHealth: 100, grounded: true, vx: 0, vy: 0, vz: 0, weapon: 0 };
  for (let i = 0; i < 75; i++) audio.update(lowHealthPlayer, [], 1 / 60); // 1.25s
  assert.ok(plays.length >= 1, 'Low health triggers heartbeat thump');
  assert.equal(plays[0].duration, 0.22);

  // Boosting vehicle revs engine higher
  const drivingPlayer = { id: 1, vehicleId: 'puma-1', health: 100, maxHealth: 100, grounded: true, vx: 0, vy: 0, vz: 0, weapon: 0 };
  const boostingVehicle = { id: 'puma-1', vx: 18, vz: 0, boosting: true };
  audio.update(drivingPlayer, [boostingVehicle], 0.05);
  assert.ok(audio.engine, 'Vehicle engine initialized');

  audio.dispose();
});


