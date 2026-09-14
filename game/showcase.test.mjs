import assert from 'node:assert/strict';
import test from 'node:test';
import {Match} from './core.mjs';
import {pickShowcase,seatShowcaseVehicles,SHOWCASES} from './showcase.mjs';
import {raceDemoMode,raceDemoPose} from './race-camera.mjs';
import {maxBotsFor,arenaSupportsMode} from './arenas.mjs';
import {DEFAULT_CONFIG,normalizeConfig} from './config.mjs';
import {RULES} from './data.mjs';
import {CinematicDirector} from './director.mjs';
import {buildShowcase as buildShowcaseFactory} from './showcase-build.mjs';

test('showcase reel cycles through a variety of modes and valid maps', () => {
 assert.ok(SHOWCASES.length >= 6, 'the demo should show a variety of modes');
 assert.equal(new Set(SHOWCASES.map(s => s.mode)).size, SHOWCASES.length, 'each scenario demonstrates a distinct mode');
 for (const legacy of [false, true]) for (const index of [-10, -1, 0, 1, 20, 999]) {
  const spec = pickShowcase(index, () => .99, {legacy});
  const scenario = SHOWCASES[((Math.round(index) % SHOWCASES.length) + SHOWCASES.length) % SHOWCASES.length];
  assert.equal(spec.mode, scenario.mode);
  assert.equal(spec.label, scenario.label);
  assert.ok(arenaSupportsMode(spec.mapId, spec.mode), `${spec.mode} must be playable on ${spec.mapId}`);
  assert.ok(spec.botCount >= 4, `${spec.mode} should field a crowd`);
  assert.ok(spec.botCount <= maxBotsFor(spec.mode), `${spec.mode} must respect its bot cap`);
 }
 assert.equal(pickShowcase(SHOWCASES.length, () => 0).mode, SHOWCASES[0].mode);
 assert.equal(pickShowcase(-1, () => 0).mode, SHOWCASES[SHOWCASES.length - 1].mode);
});

test('the reel includes both car modes with their demo cameras', () => {
 const modes = SHOWCASES.map(s => s.mode);
 assert.ok(modes.includes('puma-race'));
 assert.ok(modes.includes('puma-soccer'));
 assert.deepEqual(
   [0, 7, 14, 21].map(elapsed => raceDemoMode(elapsed)),
   ['chase', 'orbit', 'flyover', 'trackside'],
 );
  const centerline = [{ x: 0, z: -40 }, { x: 40, z: -40 }, { x: 40, z: 40 }, { x: 0, z: 40 }];
  const vehicles = Array.from({ length: 8 }, (_, id) => ({ id, kind: 'puma', x: id * 3, y: 0, z: 0, yaw: 0 }));
  const first = raceDemoPose({ mode: 'chase', centerline, vehicles, elapsed: 0 });
  const later = raceDemoPose({ mode: 'chase', centerline, vehicles, elapsed: 14 });
  assert.notEqual(first.carId, later.carId, 'the menu demo features different Pumas over time');
  for (const pose of [first, later]) for (const key of ['x', 'y', 'z', 'lookX', 'lookY', 'lookZ']) assert.ok(Number.isFinite(pose[key]));
});

test('combined arms showcase seats bots inside vehicles', () => {
  const spec = {mapId:'skyfall-basin',mode:'combined-arms',botCount:16,difficulty:'normal',seatVehicles:.7};
  const match = new Match('chatgpt', 'openclaw', () => .5, spec.mapId, {mode: spec.mode, botCount: spec.botCount, difficulty: spec.difficulty});
  assert.ok(match.vehicles.length > 0);
  const seated = seatShowcaseVehicles(match, spec.seatVehicles);
  assert.ok(seated > 0, 'at least one bot should be seated');
  assert.ok(match.actors.some(actor => actor.vehicleId != null));
  assert.ok(match.actors.some(actor => actor.vehicleId == null), 'some bots should stay on foot');
});

const showcaseDeps=()=>{
 const r={},view={setMatch(){},setPlayerId(){},setDirector(){},setCinema(){},setShowcase(snapshot){this.showcase=snapshot;}};
 return {r,view,deps:{r,view,showcaseOk:()=>true,makeRng:()=>()=>.25,pickShowcase,normalizeConfig,DEFAULT_CONFIG,Match,seatShowcaseVehicles,RULES,CinematicDirector,reducedMotion:()=>false,setShowcaseLive(){}}};
};

test('menu builder produces a valid match for every scenario and rotates modes',()=>{
 const {r,deps}=showcaseDeps();
 const buildShowcase=buildShowcaseFactory(deps);
 const seen=new Set();
 for(let i=0;i<SHOWCASES.length;i++){
  buildShowcase();
  const m=r.showcase.match;
  seen.add(m.config.mode);
  assert.ok(m.actors.length>=4,`${m.config.mode} should field bots`);
  assert.ok(Number.isFinite(m.time));
  assert.ok(arenaSupportsMode(m.arena.id,m.config.mode),`${m.arena.id} should support ${m.config.mode}`);
  assert.ok(r.showcase.director,'a director is installed for the combat camera');
  assert.equal(r.showcase.mapId,m.arena.id);
  assert.doesNotThrow(()=>JSON.stringify(m.snapshot()));
 }
 assert.ok(seen.size>=6,'the reel rotates through several modes');
 assert.equal(r.showcaseIndex,SHOWCASES.length);
});

test('menu race scenario runs a full race and the next build restarts the reel',()=>{
 const {r,deps}=showcaseDeps();
 const buildShowcase=buildShowcaseFactory(deps);
 buildShowcase();
 const m=r.showcase.match;
 assert.equal(m.config.mode,'puma-race');
 assert.equal(m.arena.id,'puma-circuit');
 assert.equal(m.actors.length,8);
 assert.ok(m.actors.every(a=>a.bot));
 assert.equal(m.race.laps,2);
 assert.equal(m.race.phase,'racing');
 assert.ok(m.vehicles.every(v=>v.speed>0));
 for(let tick=0;tick<Math.ceil(180/RULES.dt)&&!m.over;tick++)m.step(RULES.dt,{inputs:{}});
 assert.equal(m.overReason,'race-finish');
 assert.equal(m.snapshot().race.standings[0].completedLaps,2);
 buildShowcase();
 assert.notEqual(r.showcase.match,m);
 assert.equal(r.showcase.match.over,false);
 assert.equal(r.showcase.time,0);
});
