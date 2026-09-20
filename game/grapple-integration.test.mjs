import test from 'node:test';
import assert from 'node:assert/strict';
import {PerspectiveCamera, Vector3} from 'three';
import {Match, aim, eye, obstructed, moveActor} from './core.mjs';
import {RULES} from './data.mjs';
import {NetHarness} from './net.mjs';

const DT = RULES.dt;
const bounds = {minX: -20, maxX: 20, minZ: -20, maxZ: 20};
const roof = {x: 0, z: -6, w: 6, d: 4, h: 5};
const plane = (id, y, x0, x1, z0, z1) => ({id, vertices: [[x0,y,z0],[x0,y,z1],[x1,y,z1],[x1,y,z0]]});
const arena = (extra = {}) => ({id: 'grapple-fixture', blocks: [{...roof}], bounds, spawns: [[0,4]], pickups: [], ...extra});

function setup(match, world = arena(), position = {x: 0, y: 0, z: 4}) {
  match.arena = world;
  match.pickups = [];
  match.vehicles = [];
  Object.assign(match.actors[0], {...position, vx: 0, vy: 0, vz: 0, grounded: position.y === 0,
    lastValid: {...position}, protection: 0, inputMobility: false});
  return match;
}
function rig({world = arena(), position, harness = 'openclaw', mode = 'deathmatch'} = {}) {
  return setup(new Match('chatgpt', harness, () => .5, 'exchange', {
    botCount: 0, humanCount: 1, skipNav: true, mode,
  }), world, position);
}
function aimed(actor, target = {x: 0, y: 4.8, z: -4}) {
  const origin = eye(actor), dx = target.x-origin.x, dy = target.y-origin.y, dz = target.z-origin.z;
  return {yaw: Math.atan2(-dx,-dz), pitch: Math.atan2(dy,Math.hypot(dx,dz)), mobility: true};
}
function run(match, input, count = 180) {
  const path = [];
  for (let i = 0; i < count; i++) {
    match.step(DT, input);
    const a = match.actors[0];
    assert.equal(obstructed(a.x,a.y,a.z,RULES.radius,match.arena), false, `body clear at tick ${i}`);
    path.push({x:a.x,y:a.y,z:a.z,grounded:a.grounded});
  }
  return path;
}
const releases = match => match.events.filter(e => e.type === 'grapple-release');

test('real Match.step: first-person upward aim hooks the wall, lifts, mantles and stays on the roof', () => {
  const match = rig(), a = match.actors[0], input = aimed(a);
  const camera = new PerspectiveCamera();
  camera.rotation.set(input.pitch,input.yaw,0,'YXZ');
  const forward = camera.getWorldDirection(new Vector3()), ray = aim(input.yaw,input.pitch);
  assert.ok(forward.distanceTo(new Vector3(ray.x,ray.y,ray.z)) < 1e-9);
  assert.ok(ray.y > 0, 'positive first-person pitch aims upward');
  match.step(DT,input);
  assert.ok(Math.abs(a.movement.grapple.y-4.8) < 1e-9, 'the real ray hits the aimed wall point');
  assert.equal(a.movement.grapple.z,-4);
  const path = run(match,input);
  assert.ok(path[0].y > .05, 'first reel frame leaves the ground rather than being snapped back');
  assert.ok(path.some(p => p.y > 3 && !p.grounded));
  assert.equal(a.y,5);
  assert.ok(a.z < -4-RULES.radius, 'whole body crosses the lip');
  assert.equal(a.grounded,true);
  assert.equal(a.movement.phase,'ready');
  assert.equal(releases(match)[0].reason,'arrive');
  assert.ok(a.movement.cooldown > 0 && a.movement.cooldown <= 6);
  assert.equal(releases(match).length,1,'holding the button does not reactivate');
});

test('real terrain terrace: climb reaches an elevated standable mesh surface', () => {
  const world = arena({blocks: [], terrain: {
    surfaces: [plane('ground',0,-20,20,-20,20),plane('terrace',7,-3,3,-8,-4)],
    walls: [{vertices: [[-3,0,-4],[3,0,-4],[3,7,-4],[-3,7,-4]]}],
  }});
  const match = rig({world}), a = match.actors[0];
  const path = run(match,aimed(a,{x:0,y:6.8,z:-4}));
  assert.ok(path.some(p => p.y > 5 && !p.grounded));
  assert.ok(Math.abs(a.y-7)<1e-6);
  assert.equal(a.grounded,true);
  assert.ok(a.z < -4.42);
  assert.equal(releases(match)[0].reason,'arrive');
});

test('real ray can hook a roof from above, with downward arrival supported by vertical physics', () => {
  const match = rig({position:{x:0,y:7,z:0}}), a = match.actors[0];
  run(match,aimed(a,{x:0,y:5,z:-5}));
  assert.equal(a.y,5);
  assert.equal(a.grounded,true);
  assert.equal(releases(match)[0].reason,'arrive');
});

test('release while climbing stops the lift and ordinary gravity returns the actor to ground', () => {
  const match = rig(), a = match.actors[0], input = aimed(a);
  run(match,input,20);
  const releasedY = a.y;
  assert.ok(releasedY > 1);
  match.step(DT,{...input,mobility:false});
  assert.equal(a.movement.phase,'ready');
  assert.equal(a.movement.cooldown,6);
  assert.ok(a.vy < 0 && a.y < releasedY);
  run(match,{...input,mobility:false},120);
  assert.equal(a.y,0);
  assert.equal(a.grounded,true);
  assert.equal(releases(match)[0].reason,'release');
});

test('low wall anchors and blocked headroom detach instead of hovering or phasing to a roof', () => {
  const match = rig(), a = match.actors[0];
  const path = run(match,aimed(a,{x:0,y:2,z:-4}),180);
  assert.ok(Math.max(...path.map(p=>p.y)) < 2);
  assert.equal(a.y,0);
  assert.equal(a.movement.phase,'ready');
  assert.equal(releases(match)[0].reason,'blocked');
  assert.ok(a.z > -4+RULES.radius);

  // A thin awning protrudes above the wall lip. The eye ray passes below it,
  // but the climbing body's head cannot: no snapping to the highest floor.
  const awning = arena({terrain:{surfaces:[plane('ground',0,-20,20,-20,20),plane('awning',6,-3,3,-4,-1)]}});
  const covered = rig({world:awning}), b = covered.actors[0];
  const coveredPath = run(covered,aimed(b),240);
  assert.ok(Math.max(...coveredPath.map(p=>p.y)) < 5);
  assert.equal(b.movement.phase,'ready');
  assert.equal(releases(covered)[0].reason,'blocked');
});

test('underside hooks never pull through thin ceilings; normal jumps also stop below them', () => {
  const world = arena({blocks: [], terrain:{surfaces:[plane('ground',0,-20,20,-20,20),plane('ceiling',4,-5,5,-8,1)]}});
  const match = rig({world,position:{x:0,y:0,z:0}}), a = match.actors[0];
  const path = run(match,aimed(a,{x:0,y:4,z:-1}),180);
  assert.ok(path.every(p=>p.y+RULES.height <= 4+1e-6));
  assert.equal(a.y,0);
  assert.equal(a.movement.phase,'ready');
  assert.equal(releases(match)[0].reason,'blocked');
  // Strong launch under the same ceiling, exercising ordinary vertical physics
  // after the hook has ended rather than trusting only the verb's sweep.
  a.vy=20;a.grounded=false;
  for(let i=0;i<90;i++){
    moveActor(a,{},DT,world,match.config);
    assert.ok(a.y+RULES.height<=4+1e-6,'head cannot cross an underside');
  }
  assert.equal(a.y,0,'floor below a roof is selected without snapping up through it');
});

test('range, miss cooldown, arena ceiling and carrier restrictions survive the climb path', () => {
  const far = rig({position:{x:0,y:0,z:12}}), a = far.actors[0];
  far.step(DT,aimed(a));
  assert.equal(a.movement.grapple,null);
  assert.equal(a.movement.cooldown,2.5);

  const capped = rig({world:arena({ceiling:2})}), b = capped.actors[0];
  const cappedPath = run(capped,aimed(b));
  assert.ok(cappedPath.every(p=>p.y<=2));
  assert.equal(b.movement.phase,'ready');

  for(const harness of ['openclaw','hermes']){
    const match = rig({harness,mode:'ctf'}), carrier = match.actors[0];
    match.flags[1].carrier=carrier.id;carrier.carryingFlag=true;match._refreshCarrier(carrier);
    const path = run(match,aimed(carrier));
    assert.ok(path.every(p=>p.y===0),`${harness} carrier gets no lift or roof snap`);
    assert.equal(carrier.movement.enabled,harness==='hermes');
    if(harness==='hermes')assert.ok(releases(match).some(e=>e.reason==='blocked'));
  }
  const normal = rig(), normalActor = normal.actors[0];
  run(normal,aimed(normalActor));
  assert.equal(normalActor.y,5,'carrier rules do not leak into another actor/match');
});

test('prediction, delta snapshots and reconciliation preserve the in-flight climb and arrival', () => {
  const harness = new NetHarness({mapId:'exchange',config:{mode:'deathmatch',skipNav:true},
    loadout:{character:'chatgpt',harness:'openclaw'},latency:3,delta:true,seed:8});
  setup(harness.server);
  setup(harness.client.shadow);
  const a = harness.server.actors[0], input = aimed(a);
  harness.client.resync(harness.server.snapshot().actors[0]);
  for(let i=0;i<150;i++){
    harness.step(input);
    assert.ok(harness.divergence()<1e-8,`prediction matches authoritative height at ${i}`);
    if(i===25){
      const shadow = harness.client.shadow.actors[0];
      assert.ok(shadow.y>1);
      assert.deepEqual(shadow.movement.grappleLanding,a.movement.grappleLanding);
      // A real correction followed by replay must restore the same route/timer.
      shadow.x+=2;shadow.y-=1;
    }
  }
  harness.flush();
  assert.equal(a.y,5);
  assert.equal(harness.client.shadow.actors[0].y,5);
  assert.ok(harness.stats.deltaFrames>0);
  assert.equal(harness.client.shadow.actors[0].movement.grappleLanding,null);
});

test('carrier pickup during a hook cancels default lift and keeps the spent cooldown', () => {
  const match = rig({mode:'ctf'}), a = match.actors[0], input = aimed(a);
  run(match,input,20);
  const y = a.y;
  assert.ok(y > 1);
  match.flags[1].carrier=a.id;a.carryingFlag=true;match._refreshCarrier(a);
  assert.equal(a.movement.grapple,null);
  assert.equal(a.movement.grappleLanding,null);
  assert.equal(a.movement.cooldown,6);
  const path = run(match,input,90);
  assert.ok(path.every(p=>p.y<y),'the canceled hook cannot finish the mantle');
  assert.equal(a.y,0);
});

test('Juggernaut reels upward more slowly at x0.7 lift but can still finish a climb', () => {
  const normal = rig(), jug = rig({mode:'juggernaut'});
  const a = normal.actors[0], b = jug.actors[0];
  jug.setJuggernaut(b.id);
  const input = aimed(a);
  run(normal,input,20);run(jug,input,20);
  assert.ok(b.y>0 && b.y<a.y*.85);
  run(jug,input,160);
  assert.equal(b.y,5);
  assert.equal(b.grounded,true);
});
