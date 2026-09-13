import test from 'node:test';
import assert from 'node:assert/strict';
import {radarContacts, radarPalette, radarBlipColor, radarBlip, RADAR_COLORS, NEUTRAL} from './radar.mjs';
import {TEAM_PALETTE, TEAM_PALETTE_COLORBLIND, NEUTRAL as SHARED_NEUTRAL} from './team-presentation.mjs';

const player = {id: 0, x: 0, z: 0, yaw: 0, team: 0};
const hud = {actors: [{id: 0, x: 0, z: 0, health: 100, team: 0}, {id: 1, x: 10, z: 0, health: 100, team: 1}, {id: 2, x: 0, z: -10, health: 0, team: 0, vehicleId: 3}]};

test('radarContacts maps world offsets into a yaw-relative unit circle', () => {
  const {contacts} = radarContacts(hud, player, {range: 20});
  const by = id => contacts.find(c => c.kind === 'actor' && c.id === id);
  assert.ok(Math.abs(by(1).x - .5) < 1e-9);
  assert.ok(Math.abs(by(1).y) < 1e-9);
  assert.ok(by(2).y > .49 && by(2).y < .51);
  assert.equal(by(0).self, true);
  assert.equal(by(2).dead, true);
  assert.equal(by(2).vehicle, true);
});

test('radarContacts rotates with the player yaw and drops out-of-range contacts', () => {
  const turned = radarContacts(hud, {...player, yaw: Math.PI / 2}, {range: 20}).contacts;
  const behind = turned.find(c => c.kind === 'actor' && c.id === 1);
  assert.ok(behind.y < -.49, `facing -x should put +x contacts behind, got ${behind.y}`);
  const near = radarContacts(hud, player, {range: 8}).contacts.filter(c => c.kind === 'actor');
  assert.deepEqual(near.map(c => c.id), [0]);
});

test('radarContacts carries objectives and flags without inventing positions', () => {
  const {contacts} = radarContacts({actors: [], objectives: {zones: [{id: 'A', x: 5, z: 5, owner: 1, contested: false}]}, flags: [{team: 0, x: -5, z: 5, state: 'dropped', carrier: null}]}, player, {range: 20});
  assert.equal(contacts.filter(c => c.kind === 'zone').length, 1);
  assert.equal(contacts.filter(c => c.kind === 'flag').length, 1);
  assert.equal(contacts.find(c => c.kind === 'flag').carried, false);
  assert.deepEqual(radarContacts(null, player).contacts, []);
  assert.deepEqual(radarContacts(hud, null).contacts, []);
});

test('radar team colors derive from the canonical palettes and share one neutral color', () => {
  assert.equal(RADAR_COLORS.default.red, TEAM_PALETTE[0].color);
  assert.equal(RADAR_COLORS.default.blue, TEAM_PALETTE[1].color);
  assert.equal(RADAR_COLORS.colorblind.red, TEAM_PALETTE_COLORBLIND[0].color);
  assert.equal(RADAR_COLORS.colorblind.blue, TEAM_PALETTE_COLORBLIND[1].color);
  assert.equal(RADAR_COLORS.default.neutral, NEUTRAL);
  assert.equal(RADAR_COLORS.colorblind.neutral, NEUTRAL);
  assert.equal(NEUTRAL, SHARED_NEUTRAL);
});

test('radarPalette swaps hostile reds for colorblind amber and blip colors follow teams', () => {
  assert.equal(radarPalette('colorblind').red, '#ff9d2e');
  assert.equal(radarPalette('default').red, '#ed514b');
  assert.equal(radarPalette(undefined), RADAR_COLORS.default);
  assert.equal(radarBlipColor({kind: 'actor', self: true}, player), RADAR_COLORS.default.self);
  assert.equal(radarBlipColor({kind: 'actor', self: false, team: 1}, player), RADAR_COLORS.default.blue);
  assert.equal(radarBlipColor({kind: 'actor', self: false, team: 0}, player), RADAR_COLORS.default.teammate);
  assert.equal(radarBlipColor({kind: 'actor', self: false, team: undefined}, player), RADAR_COLORS.default.hostile);
  assert.equal(radarBlipColor({kind: 'zone', owner: null}, player), RADAR_COLORS.default.neutral);
  assert.equal(radarBlipColor({kind: 'zone', owner: 0, contested: true}, player), RADAR_COLORS.default.contested);
  assert.equal(radarBlipColor({kind: 'flag', team: 1}, player), RADAR_COLORS.default.blue);
});

test('recon reveals distant enemies while it is active',()=>{
  const hud={actors:[{id:0,x:0,z:0,health:100,team:0},{id:1,x:200,z:0,health:100,team:1}]};
  const player={id:0,x:0,z:0,team:0,yaw:0};
  assert.equal(radarContacts(hud,player,{range:55}).contacts.some(c=>c.kind==='actor'&&c.id===1),false,'far enemy hidden by default');
  player.powerups={recon:5};
  const revealed=radarContacts(hud,player,{range:55}).contacts.find(c=>c.kind==='actor'&&c.id===1);
  assert.ok(revealed,'far enemy revealed');
  assert.equal(revealed.revealed,true);
  assert.ok(revealed.x>=-1.01&&revealed.x<=1.01&&revealed.y>=-1.01&&revealed.y<=1.01,'revealed contact is clamped to the radar rim');
});

test('cloaked enemies drop off radar except up close',()=>{
  const player={id:0,x:0,z:0,team:0,yaw:0};
  const near={actors:[{id:0,x:0,z:0,health:100,team:0},{id:1,x:5,z:0,health:100,team:1,powerups:{cloak:5}}]};
  assert.ok(radarContacts(near,player,{range:55}).contacts.some(c=>c.id===1),'a close cloak stays visible');
  const far={actors:[{id:0,x:0,z:0,health:100,team:0},{id:1,x:30,z:0,health:100,team:1,powerups:{cloak:5}}]};
  assert.equal(radarContacts(far,player,{range:55}).contacts.some(c=>c.id===1),false,'a distant cloak is hidden');
  player.powerups={recon:5};
  assert.ok(radarContacts(far,player,{range:55}).contacts.some(c=>c.id===1),'recon reveals cloaked enemies');
});

test('radar preserves the requested range even when the player is invalid',()=>{
  assert.equal(radarContacts({actors:[]},{x:NaN,z:0},{range:120}).range,120);
  assert.equal(radarContacts(null,null,{range:90}).range,90);
});

test('domination and koth zones carry A/B/C labels while the payload becomes its own clamped contact',()=>{
  const zones={actors:[],objectives:{zones:[{id:'alpha',x:5,z:0,owner:0},{id:'bravo',x:0,z:5,owner:1},{id:'hill',x:-5,z:0,owner:null,contested:true}]}};
  const labelled=radarContacts(zones,player,{range:20}).contacts.filter(c=>c.kind==='zone');
  assert.deepEqual(labelled.map(c=>c.label),['A','B','K']);
  assert.equal(labelled[2].contested,true);
  const payloadHud={actors:[],objectives:{kind:'payload',payload:{position:{x:200,z:0},contested:true,pushing:1,progress:42}}};
  const payload=radarContacts(payloadHud,player,{range:55}).contacts.find(c=>c.kind==='payload');
  assert.ok(payload,'payload emits a dedicated contact');
  assert.equal(payload.label,'PAY');assert.equal(payload.icon,'payload');
  assert.equal(payload.clamped,true,'far payload is clamped to the rim so it stays findable');
  assert.equal(payload.progress,42);assert.equal(payload.delivered,false);
  assert.equal(radarBlipColor(payload,player),RADAR_COLORS.default.contested);
  assert.equal(radarBlipColor({kind:'payload',contested:false},player),RADAR_COLORS.default.payload);
  const rawPayload={actors:[],objectives:{kind:'payload',position:{x:3,z:4},contested:false}};
  assert.ok(radarContacts(rawPayload,player,{range:20}).contacts.some(c=>c.kind==='payload'&&c.contested===false),'raw objectiveState payload renders too');
});

test('radarBlip surfaces zone labels and the payload icon/progress/clamp state for the SVG',()=>{
 const zone=radarBlip({kind:'zone',id:'alpha',label:'A',x:.25,y:-.5,owner:1},player);
 assert.equal(zone.shape,'rect');
 assert.equal(zone.label,'A');
 assert.equal(zone.cx,.25);
 assert.equal(zone.cy,.5);
 assert.equal(zone.fill,RADAR_COLORS.default.blue);
 const actor=radarBlip({kind:'actor',self:true,x:0,y:0,dead:false,revealed:true},player);
 assert.equal(actor.shape,'circle');assert.equal(actor.r,.07);assert.equal(actor.revealed,true);
 const dead=radarBlip({kind:'actor',self:false,team:1,x:0,y:0,dead:true},player);
 assert.equal(dead.r,.05);assert.equal(dead.dead,true);
 const flag=radarBlip({kind:'flag',team:0,index:2,x:-.4,y:.2,carried:true},player);
 assert.equal(flag.shape,'triangle');assert.equal(flag.carried,true);assert.equal(flag.team,0);
 assert.match(flag.points,/,-?[\d.]+/);
 const payload=radarBlip({kind:'payload',label:'PAY',icon:'payload',x:.6,y:-.2,progress:42,delivered:false,clamped:true,contested:false},player);
 assert.equal(payload.shape,'payload');assert.equal(payload.icon,'payload');assert.equal(payload.label,'PAY');
 assert.equal(payload.progress,42);assert.equal(payload.progressRatio,.42);
 assert.equal(payload.delivered,false);assert.equal(payload.clamped,true);
 assert.equal(payload.fill,RADAR_COLORS.default.payload);
 assert.equal(payload.ring.progress,42);
 const delivered=radarBlip({kind:'payload',x:0,y:0,progress:null,delivered:true},player);
 assert.equal(delivered.progress,null);assert.equal(delivered.progressRatio,null);assert.equal(delivered.delivered,true);
});
