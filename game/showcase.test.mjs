import assert from 'node:assert/strict';
import test from 'node:test';
import {Match} from './core.mjs';
import {pickShowcase,seatShowcaseVehicles,SHOWCASES,SHOWCASE_DEMO_CAMERA} from './showcase.mjs';
import {raceDemoMode,raceDemoPose} from './race-camera.mjs';
import {maxBotsFor} from './arenas.mjs';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
import {DEFAULT_CONFIG,normalizeConfig} from './config.mjs';
import {RULES} from './data.mjs';
import {CinematicDirector} from './director.mjs';

test('showcase reel cycles through every scenario', () => {
  assert.equal(SHOWCASES.length,1);
  for(const legacy of [false,true])for(const index of [-10,-1,0,1,20]){
    const spec=pickShowcase(index,()=>.99,{legacy});
    assert.equal(spec.id,'puma-race');assert.equal(spec.mode,'puma-race');assert.equal(spec.mapId,'puma-circuit');
    assert.equal(spec.botCount,7);assert.equal(spec.fragLimit,2);assert.equal(spec.timeLimit,180);
  }
  SHOWCASES.forEach((scenario, index) => {
    const spec = pickShowcase(index, () => 0);
    assert.equal(spec.mode, scenario.mode);
    assert.ok(spec.botCount <= maxBotsFor(scenario.mode));
    assert.ok(spec.botCount >= 4);
  });
  assert.equal(pickShowcase(SHOWCASES.length, () => 0).mode, SHOWCASES[0].mode);
  assert.equal(pickShowcase(-1, () => 0).mode, SHOWCASES[SHOWCASES.length - 1].mode);
});

test('puma showcase opts into the cycling demo camera with a rotating featured car', () => {
  assert.equal(SHOWCASES[0].mode, 'puma-race');
  assert.equal(SHOWCASE_DEMO_CAMERA.cycleSeconds, 7);
  assert.deepEqual(SHOWCASE_DEMO_CAMERA.modes, ['chase', 'orbit', 'flyover', 'trackside']);
  assert.deepEqual(
    [0, 7, 14, 21].map(elapsed => raceDemoMode(elapsed)),
    SHOWCASE_DEMO_CAMERA.modes,
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

test('menu builder warms eight bots, progresses through two laps and restarts the full race',async()=>{
  const source=await readFile(new URL('../app/page.tsx',import.meta.url),'utf8');
  const ast=ts.createSourceFile('page.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);let builder,restart;
  const visit=node=>{
    if(ts.isVariableDeclaration(node)&&node.name.getText(ast)==='buildShowcase')builder=node.initializer.getText(ast);
    if(ts.isIfStatement(node)&&node.expression.getText(ast)==='sc.match.over')restart=node.getText(ast);
    ts.forEachChild(node,visit);
  };visit(ast);assert.ok(builder);assert.ok(restart);
  const r={},view={setMatch(){},setPlayerId(){},setDirector(){},setCinema(){},setShowcase(snapshot){this.showcase=snapshot;}};
  const deps={r,view,showcaseOk:()=>true,makeRng:()=>()=>.25,pickShowcase,normalizeConfig,DEFAULT_CONFIG,Match,seatShowcaseVehicles,RULES,CinematicDirector,reducedMotion:()=>false,setShowcaseLive(){}};
  const buildShowcase=Function(...Object.keys(deps),`return (${builder});`)(...Object.values(deps));
  const update=Function('sc','buildShowcase','view',restart);
  buildShowcase();
  for(let loop=0;loop<2;loop++){
    const m=r.showcase.match;
    assert.equal(m.arena.id,'puma-circuit');assert.equal(m.actors.length,8);assert.ok(m.actors.every(a=>a.bot));
    assert.equal(m.config.botCount,7);assert.equal(m.config.timeLimit,180);assert.equal(m.race.laps,2);
    assert.ok(Math.abs(m.time-4)<1e-8);assert.equal(m.race.phase,'racing');
    assert.ok(m.vehicles.every(v=>v.speed>0));assert.equal(view.showcase.race.phase,'racing');
    const start=m.vehicles[0].position.x;
    for(let tick=0;tick<Math.round(5/RULES.dt);tick++)m.step(RULES.dt,{inputs:{}});
    assert.notEqual(m.vehicles[0].position.x,start);
    assert.ok(m.race.racers.every(racer=>racer.nextGate>0));
    for(let tick=0;tick<Math.ceil(180/RULES.dt)&&!m.over;tick++)m.step(RULES.dt,{inputs:{}});
    assert.equal(m.overReason,'race-finish');assert.equal(m.snapshot().race.standings[0].completedLaps,2);
    update(r.showcase,buildShowcase,view);
    assert.notEqual(r.showcase.match,m);assert.equal(r.showcase.match.over,false);assert.equal(r.showcase.time,0);
  }
  assert.equal(r.showcaseIndex,3);
});
