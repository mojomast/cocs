import {WEAPONS} from './data.mjs';
import {CAMPAIGN_MISSION_IDS,DEFAULT_MISSION_ID} from './campaign-data.mjs';
import {configuredDirectorTier,coopRoster,coopWaveSummary,directorTierCopy,normalizeCocsTier} from './cocs-difficulty.mjs';
// ---------------------------------------------------------------------------
// LATTICE STRIKE population ladder (PvP-1). Section 3.1 publishes the 4v4 and
// 8v8 `cocs` rungs; `cocs-coop` (OPERATIONS) is a single human team and never
// consults a rung. This table is the single data source for a rung's seat
// count, live-node floor, role allow-list and opening economy. The role
// allow-list is load-bearing: `cocsRoleAllowed` gates which subagent roles the
// duty board / policy may spawn, so 4v4 can never field SCOUT or SABOTEUR.
//
// The economy numbers mirror `cocs-economy.mjs` (FLUX start 80 / cap 240,
// base THREADS 3) exactly; `cocs-economy.test.mjs` pins the cross-module
// equality so the two tables cannot drift.
// ---------------------------------------------------------------------------
export const COCS_RUNGS=Object.freeze({
 '4v4':Object.freeze({
  id:'4v4',name:'Skirmish-lite',variant:'cocs',humans:8,perTeam:4,total:8,minHumans:8,
  roles:Object.freeze(['fighter','harvester','builder']),
  live:Object.freeze({opening:3,max:5,endgame:5}),
  dominance:Object.freeze({hold:90,fast:45}),
  threads:3,fluxStart:80,fluxCap:240,depotsPerTeam:1,vehiclesPerTeam:1,
 }),
 '8v8':Object.freeze({
  id:'8v8',name:'Skirmish',variant:'cocs',humans:16,perTeam:8,total:16,minHumans:8,
  roles:Object.freeze(['fighter','harvester','builder','scout','saboteur']),
  live:Object.freeze({opening:3,max:5,endgame:5}),
  dominance:Object.freeze({hold:120,fast:60}),
  threads:3,fluxStart:80,fluxCap:240,depotsPerTeam:2,vehiclesPerTeam:2,
 }),
});
export const COCS_RUNG_IDS=Object.freeze(Object.keys(COCS_RUNGS));
/** Resolve a rung id (case-insensitive) to its frozen table entry, or null. */
export function cocsRung(id){
 const key=String(id??'').trim().toLowerCase();
 return COCS_RUNGS[key]??null;
}
/** Infer the rung from the intended actor count (humans + bots). <=8 is 4v4,
 * <=16 is 8v8; above the published ladder there is no rung (12v12 is gated). */
export function cocsRungForPlayers(players){
 const n=Math.max(0,Math.round(Number(players)||0));
 if(n<=0)return null;
 if(n<=COCS_RUNGS['4v4'].total)return '4v4';
 if(n<=COCS_RUNGS['8v8'].total)return '8v8';
 return null;
}
/** The rung a config resolves to, or null for a legacy (ungated) practice match. */
export function cocsRungOf(config){
 return cocsRung(config?.rung)?.id??null;
}
/** Bot seats needed to fill a rung to its published total (stable ratio). */
export function cocsRungFill(rung,humans){
 const table=cocsRung(rung);
 if(!table)return 0;
 const present=Math.max(0,Math.min(table.total,Math.round(Number(humans)||0)));
 return table.total-present;
}
/** `true` when `humans` clears the rung's below-minimum floor (section 3.1). */
export function cocsRungMeetsMinimum(rung,humans){
 const table=cocsRung(rung);
 if(!table)return false;
 const floor=Math.max(1,Number.isFinite(Number(table.minHumans))?Number(table.minHumans):table.humans);
 return Math.round(Number(humans)||0)>=floor;
}
/** `true` when `role` is on `rung`'s allow-list. A null/unknown rung allows
 * every role so existing practice matches keep the full launch set. */
export function cocsRoleAllowed(rung,role){
 const table=cocsRung(rung);
 if(!table)return true;
 return table.roles.includes(String(role??'').trim().toLowerCase());
}
// ---------------------------------------------------------------------------
// Lobby/queue plan (section 3.1). A rung is only entered when its human floor
// is met; below the floor the queue falls back to the rung below (and below
// 4v4 the room routes to OPERATIONS or the practice sandbox). This is the one
// serializable descriptor the server publishes to the lobby and the matchmaker
// so the UI can say exactly why a rung is (or is not) open. `botFill` is the
// stable bot ratio used to top a started match up to the rung's total; it is
// only applied once `meetsMinimum` is true so a rung is never silently
// auto-started on a bot majority. Pure, frozen, no clock.
// ---------------------------------------------------------------------------
export function cocsRungPlan(rung,humans){
 const table=cocsRung(rung);
 if(!table)return null;
 const present=Math.max(0,Math.min(table.total,Math.round(Number(humans)||0)));
 const meetsMinimum=cocsRungMeetsMinimum(table.id,present);
 return Object.freeze({
  id:table.id,
  name:table.name,
  variant:table.variant,
  perTeam:table.perTeam,
  total:table.total,
  humans:present,
  minHumans:table.minHumans,
  meetsMinimum,
  belowMinimum:!meetsMinimum,
  botFill:cocsRungFill(table.id,present),
  roleAllow:Object.freeze([...table.roles]),
 });
}
/** The rung below `rung` in the published ladder, or null at the floor. */
export function cocsRungBelow(rung){
 const table=cocsRung(rung);
 if(!table)return null;
 const index=COCS_RUNG_IDS.indexOf(table.id);
 return index>0?COCS_RUNG_IDS[index-1]:null;
}
/** The role allow-list for a rung (all five when the rung is unknown). */
export function cocsRungRoles(rung){
 return [...(cocsRung(rung)?.roles??COCS_RUNGS['8v8'].roles)];
}
export const GAME_MODES = [
 {id:'deathmatch',name:'Deathmatch',description:'Everyone for themselves. Start with a Pulse Rifle, scavenge the rest, first to the frag limit wins.',rules:{team:false,score:'frags',fragLimit:15,suddenDeathSeconds:12}},
  {id:'ctf',name:'Capture the Flag',description:'Steal the enemy flag and run it home while keeping your own safe. Classic, chaotic, worth it.',rules:{team:true,score:'captures',fragLimit:3,carrierSpeed:.9,suddenDeathSeconds:15}},
  {id:'koth',name:'King of the Hill',description:'Take the central hill and hold it second by second. Contest it to freeze the enemy clock.',rules:{team:true,score:'hillTime',fragLimit:100,minFragLimit:1,maxFragLimit:900,vehicles:false,rotationSeconds:30,zoneBuff:'haste',suddenDeathSeconds:15,objective:{kind:'koth',captureSeconds:5}}},
  {id:'domination',name:'Domination',description:'Capture three control zones and bleed points for every second your team owns them.',rules:{team:true,score:'zoneTime',fragLimit:100,minFragLimit:1,maxFragLimit:900,vehicles:false,zoneBuffs:{alpha:'overshield',bravo:'haste',charlie:'overcharge'},suddenDeathSeconds:15,objective:{kind:'domination',captureSeconds:5}}},
  {id:'assault',name:'Assault',description:'Attackers take sectors in order, defenders hold to the last one. Breach the final sector to win.',rules:{team:true,score:'sectors',fragLimit:3,minFragLimit:1,maxFragLimit:9,objective:{kind:'assault',captureSeconds:6}}},
 {id:'teamdeathmatch',name:'Team Deathmatch',description:'Shared team score with friendly fire off. Win together or feed together.',rules:{team:true,score:'teamFrags',fragLimit:30,suddenDeathSeconds:15}},
  {id:'instagib',name:'Instagib',description:'Rail only, unlimited ammo. One unprotected hit eliminates. No supplies, no powers, no mercy.',loadout:{weapons:[2],start:2,infinite:true,noPickups:true},rules:{team:false,score:'frags',fragLimit:15,suddenDeathSeconds:12}},
  {id:'rockets',name:'Rocket Arena',description:'Unlimited rockets for everyone. Health and armor stay on the menu.',loadout:{weapons:[1],start:1,infinite:true},rules:{team:false,score:'frags',fragLimit:15,suddenDeathSeconds:12}},
  {id:'arsenal',name:'Full Arsenal',description:'Every weapon unlocked with unlimited ammo from the first spawn. Choose violence, repeatedly.',loadout:{weapons:'all',start:0,infinite:true},rules:{team:false,score:'frags',fragLimit:15,suddenDeathSeconds:12}},
  {id:'armsrace',name:'Arms Race',description:'Every kill promotes you to the next weapon in the rack. Finish the last gun to win.',rules:{team:false,score:'ladder',fragLimit:10,minFragLimit:10,maxFragLimit:10}},
  {id:'combined-arms',name:'Combined Arms',description:'Command infantry, armour and aircraft across the largest battlefields. Hold the zones together.',rules:{team:true,score:'zoneTime',fragLimit:200,minFragLimit:50,maxFragLimit:900,vehicles:true,suddenDeathSeconds:15,objective:{kind:'domination',captureSeconds:6},maxBots:16}},
  // LATTICE STRIKE (V0a): linked objective nodes where a node can only be
  // captured next to one you already own, and only pays while connected back to
  // HQ. `score:'cocs'` keeps the objective-first ranking in outcome.mjs; the
  // node/income tuning lives under `objective` and is read by cocs.mjs.
  {id:'cocs',name:'Lattice Strike',description:'Capture linked lattice nodes. You can only take a node next to one you own, and a node only pays while a supply line links it back to your HQ. Hold the lattice, not the frag count.',rules:{team:true,score:'cocs',fragLimit:5,minFragLimit:1,maxFragLimit:7,vehicles:false,maxBots:16,suddenDeathSeconds:15,rungs:COCS_RUNGS,objective:{kind:'cocs',captureSeconds:5,liveOpening:3,liveMax:5,endgameLive:5,dominanceHold:90,dominanceFast:45}}},
  // LATTICE STRIKE: OPERATIONS (O1a) — the co-op, Director-driven siege. It
  // shares the `cocs` objective kind and the lattice/FLUX/REQ/strip systems but
  // branches on `coop:true`: all humans are team 0, team 1 is the persistent
  // Director garrison + non-respawning wave force, and the run is one 5-wave
  // operation (win on Wave 5 clear; lose to dominance, the clock or the HQ siege).
  {id:'cocs-coop',name:'Lattice Strike: Operations',description:'Hold the lattice against a Director-driven siege. Five waves, one team, no enemy commander. Clear the operation with your HQ intact.',rules:{team:true,score:'cocs',coop:true,fragLimit:0,minFragLimit:0,maxFragLimit:0,vehicles:false,maxBots:16,timeLimit:900,suddenDeathSeconds:0,objective:{kind:'cocs',captureSeconds:5,liveOpening:3,liveMax:5,endgameLive:5,dominanceCount:3,dominanceHold:120,dominanceFast:60}}},
  {id:'payload',name:'Payload',description:'Escort the payload cart down the track to the final point. Checkpoints bank progress; defenders stall it and roll it back. Attackers win on delivery, defenders on the clock.',rules:{team:true,score:'payload',fragLimit:3,minFragLimit:1,maxFragLimit:6,objective:{kind:'payload',captureSeconds:5}}},
  {id:'puma-race',name:'Puma Circuit',description:'Race Pumas around the circuit. Cross every gate in order and finish the lap target first.',rules:{team:false,score:'laps',fragLimit:3,minFragLimit:1,maxFragLimit:10,maxBots:7,vehicles:true}},
  {id:'puma-soccer',name:'Puma Soccer',description:'Team car soccer on the circuit infield. Fling the ball into the enemy goal while defending your own.',rules:{team:true,score:'goals',fragLimit:5,minFragLimit:1,maxFragLimit:15,maxBots:3,vehicles:true}},
  {id:'horde',name:'Horde',description:'Lone-wolf survival: hold out against escalating waves of hostile NPCs. Pick any combat arena and see how many waves you last.',rules:{team:true,score:'waves',fragLimit:10,minFragLimit:1,maxFragLimit:30}},
 {id:'campaign',name:'Campaign',description:'Scripted single-player missions with NPC assaults, objectives and set-piece events, built on the existing arenas.',rules:{team:true,score:'missions',fragLimit:6,minFragLimit:1,maxFragLimit:6}},
 {id:'juggernaut',name:'Juggernaut',description:'One powered operator carries a health buffer and a damage aura while everyone hunts them. Hold the role to bank points; killing the juggernaut takes their place.',rules:{team:false,score:'juggernaut',fragLimit:30,minFragLimit:1,maxFragLimit:99,juggernaut:true,juggernautShield:125,juggernautDamage:1.4,juggernautRate:.75,juggernautKillBonus:2,juggernautBounty:3,juggernautTransferShield:50,suddenDeathSeconds:20,objective:{kind:'juggernaut'}}},
  {id:'team-elimination',name:'Team Elimination',description:'Shared team lives and no free respawns: every death burns a ticket for your side. The first team out of lives loses the round.',rules:{team:true,score:'elimination',fragLimit:10,minFragLimit:1,maxFragLimit:99,elimination:true,eliminationRespawn:3,eliminationAttritionStart:45,eliminationAttritionEvery:9,suddenDeathSeconds:20,objective:{kind:'elimination'}}},
  {id:'vip-escort',name:'VIP Escort',description:'Escort a lone VIP to the extraction beacon while the other squad hunts them. Move the VIP to the pad and hold it; lose the VIP and the round.',rules:{team:true,score:'extraction',fragLimit:1,minFragLimit:1,maxFragLimit:1,objective:{kind:'extraction',captureSeconds:4,escortRadius:7}}},
  // Holdout is a Domination variant: instead of bleeding points per owned zone,
  // a team must hold a quorum of the zones at once for a sustained window. The
  // objective kind stays `domination` so the shared capture loop, HUD zone
  // readout and arena rendering all apply; `holdCount`/`holdSeconds` add the
  // quorum win condition on top.
  {id:'holdout',name:'Holdout',description:'Capture a quorum of the control zones and hold them together. A team that keeps the majority for the full window takes the round.',rules:{team:true,score:'zoneTime',fragLimit:100,minFragLimit:1,maxFragLimit:900,vehicles:false,zoneBuffs:{alpha:'overshield',bravo:'haste',charlie:'overcharge'},suddenDeathSeconds:15,objective:{kind:'domination',captureSeconds:6,holdCount:2,holdSeconds:30}}},
  // Uplink is a King-of-the-Hill variant with a sequential, moving capture
  // point: the hill must be taken at each authored stage in turn, and the first
  // team to capture every stage wins. The kind stays `koth` so the rotation and
  // single-hill rendering are reused; `sequence` adds the stage race.
  {id:'uplink',name:'Uplink',description:'A single relay moves between uplink nodes. Capture the active node to bank a stage and push the relay onward; first team through every stage wins.',rules:{team:true,score:'hillTime',fragLimit:100,minFragLimit:1,maxFragLimit:900,vehicles:false,rotationSeconds:30,suddenDeathSeconds:15,objective:{kind:'koth',captureSeconds:4,sequence:3}}},
];
export const DIFFICULTIES = [
 {id:'easy',name:'Easy',description:'Relaxed reactions, loose aim and plenty of breathing room.',reaction:1.2,think:.5,error:.3,fireDelay:.48},
 {id:'normal',name:'Normal',description:'Measured reactions and forgiving aim. The house default.',reaction:.65,think:.3,error:.12,fireDelay:.2},
 {id:'hard',name:'Hard',description:'Quicker reactions and tighter aim. Bring a plan.',reaction:.16,think:.14,error:.023,fireDelay:0},
 {id:'nightmare',name:'Nightmare',description:'Very fast reactions and precise aim. They already know where you spawned.',reaction:.08,think:.1,error:.01,fireDelay:0},
];
// ---------------------------------------------------------------------------
// Mutators. A mutator is a small, composable rule layered on top of any mode.
// The canonical MUTATORS order below is the deterministic combination order:
// `activeMutators` always reports ids in this order and `mutatorEffects` folds
// them left-to-right, so two configs with the same flags always resolve to the
// same effect set. Legacy flags (speed/gravity/damage/fastPowers/...) remain
// first-class config fields; they are simply surfaced through this unified set
// so UI, bots and the sim can reason about one documented list.
//
// `field` maps a mutator to the boolean config flag that enables it. The three
// continuous mutators (turbo, lowGravity, doubleDamage) derive from the numeric
// speed/gravity/damage presets instead of a boolean.
// ---------------------------------------------------------------------------
export const MUTATORS = Object.freeze([
 Object.freeze({id:'turbo',name:'Turbo',field:'speed',description:'Movement speed above 1×. Everything happens sooner.'}),
 Object.freeze({id:'lowGravity',name:'Low Gravity',field:'gravity',description:'Gravity below 1×. Longer arcs, floatier duels.'}),
 Object.freeze({id:'doubleDamage',name:'Damage Boost',field:'damage',description:'Damage above 1×. Fights end faster.'}),
 Object.freeze({id:'fastPowers',name:'Fast Powers',field:'fastPowers',description:'Harness ability cooldowns are halved.'}),
 Object.freeze({id:'lifeSteal',name:'Life Steal',field:'lifeSteal',description:'Heal for 25% of damage actually dealt.'}),
 Object.freeze({id:'unlimitedAmmo',name:'Unlimited Ammo',field:'unlimitedAmmo',description:'The starting weapon never runs dry.'}),
 Object.freeze({id:'oneShot',name:'One Shot',field:'oneShot',description:'Any unprotected hit is lethal.'}),
 Object.freeze({id:'instagib',name:'Instagib',field:'instagib',description:'Rail only, infinite ammo, one-shot kills and no powers — on any mode.'}),
 Object.freeze({id:'randomLoadout',name:'Random Loadout',field:'randomLoadout',description:'Respawn with a random weapon and matching ammo.'}),
 Object.freeze({id:'mirrorLoadout',name:'Mirrored Loadout',field:'mirrorLoadout',description:'Every actor spawns with the configured starting weapon.'}),
 Object.freeze({id:'bounty',name:'Bounty',field:'bounty',description:'Killing a 3+ streak heals and pays a bonus frag.'}),
 Object.freeze({id:'berserk',name:'Berserk',field:'berserk',description:'+20% damage once a killer reaches a 3 streak.'}),
 Object.freeze({id:'bigHead',name:'Big Head',field:'bigHead',description:'Larger hitboxes. Aim is a suggestion.'}),
 Object.freeze({id:'noRecoil',name:'No Recoil',field:'noRecoil',description:'Weapons kick and bloom no more.'}),
 Object.freeze({id:'suddenDeath',name:'Sudden Death',field:'suddenDeath',description:'A tied match enters a final sudden-death window before the clock runs out.'}),
 Object.freeze({id:'endless',name:'Endless',field:'endless',description:'Horde runs never stop at the wave target. Survive as long as you can.'}),
]);
export const MUTATOR_IDS=Object.freeze(MUTATORS.map(m=>m.id));
// Applying a mutator id sets its canonical flag. Continuous mutators pick a
// documented preset so a bare `mutators:['turbo']` is unambiguous.
const MUTATOR_APPLY=Object.freeze({
 turbo:config=>{config.speed=1.25;},
 lowGravity:config=>{config.gravity=.4;},
 doubleDamage:config=>{config.damage=1.5;},
 fastPowers:config=>{config.fastPowers=true;},
 lifeSteal:config=>{config.lifeSteal=true;},
 unlimitedAmmo:config=>{config.unlimitedAmmo=true;},
 oneShot:config=>{config.oneShot=true;},
 instagib:config=>{config.instagib=true;},
 randomLoadout:config=>{config.randomLoadout=true;},
 mirrorLoadout:config=>{config.mirrorLoadout=true;},
 bounty:config=>{config.bounty=true;},
 berserk:config=>{config.berserk=true;},
 bigHead:config=>{config.bigHead=true;},
 noRecoil:config=>{config.noRecoil=true;},
 suddenDeath:config=>{config.suddenDeath=true;},
 endless:config=>{config.endless=true;},
});
export function applyMutators(config,ids){
 const out=config&&typeof config==='object'?config:{};
 if(!Array.isArray(ids))return out;
 for(const id of MUTATOR_IDS)if(ids.includes(id))MUTATOR_APPLY[id](out);
 return out;
}
export function activeMutators(config={}){
 const c=config&&typeof config==='object'?config:{};
 return MUTATORS.filter(mutator=>{
  if(mutator.id==='turbo')return Number(c.speed)>1;
  if(mutator.id==='lowGravity')return Number(c.gravity)<1;
  if(mutator.id==='doubleDamage')return Number(c.damage)>1;
  return c[mutator.field]===true;
 }).map(mutator=>mutator.id);
}
// Resolved, read-only effect view. Numeric multipliers are the raw config
// presets; booleans are the union of the legacy flag and any mutator alias
// (instagib implies one-shot). Fold order is the canonical MUTATORS order.
export function mutatorEffects(config={}){
 const c=config&&typeof config==='object'?config:{};
 // The Instagib mode is itself the instagib mutator, so a mode-only config
 // resolves exactly like an explicit flag.
 const modeInstagib=c.mode==='instagib';
 const set=new Set(activeMutators(c));
 if(modeInstagib)set.add('instagib');
 const active=MUTATOR_IDS.filter(id=>set.has(id));
 return Object.freeze({
  active:Object.freeze(active),
  speedMultiplier:set.has('turbo')?Number(c.speed)||1:1,
  gravityMultiplier:set.has('lowGravity')?Number(c.gravity)||1:1,
  damageMultiplier:set.has('doubleDamage')?Number(c.damage)||1:1,
  fastPowers:set.has('fastPowers'),
  lifeSteal:set.has('lifeSteal'),
  unlimitedAmmo:set.has('unlimitedAmmo'),
  oneShot:set.has('oneShot')||set.has('instagib')||modeInstagib,
  instagib:modeInstagib||set.has('instagib'),
  randomLoadout:set.has('randomLoadout'),
  mirrorLoadout:set.has('mirrorLoadout'),
  bounty:set.has('bounty'),
  berserk:set.has('berserk'),
  bigHead:set.has('bigHead'),
  noRecoil:set.has('noRecoil'),
  suddenDeath:set.has('suddenDeath'),
  endless:set.has('endless'),
 });
}
export const DEFAULT_CONFIG = Object.freeze({mode:'deathmatch',botCount:2,difficulty:'easy',fragLimit:15,timeLimit:300,respawn:2,speed:1,gravity:1,damage:1,fastPowers:false,lifeSteal:false,unlimitedAmmo:false,suddenDeath:false,randomLoadout:false,oneShot:false,instagib:false,mirrorLoadout:false,bounty:false,berserk:false,bigHead:false,noRecoil:false,endless:false,startingWeapon:0,playerName:'',mission:DEFAULT_MISSION_ID,loadout:null,mutators:Object.freeze([]),checkpoint:null});
// Frame-rate caps published to the settings UI. 0 means uncapped; the value is
// persisted now and consumed by the view in a later wave, so the accepted set is
// explicit here rather than derived from a device probe.
export const FPS_CAPS = Object.freeze([0,30,60,120]);
// Shadow quality levels, from full arena shadows down to off. Persisted with
// the rest of the display object; `game/view.mjs` consumes the value later.
export const SHADOW_LEVELS = Object.freeze(['high','low','off']);
// Crosshair depth (additive): outline, base gap, arm thickness, a centre dot
// and the ADS reticle colour. Every default reproduces the shipped reticle, so
// a saved display object without these keys renders exactly as before.
export const DEFAULT_DISPLAY = Object.freeze({fov:82,crosshair:'cross',color:'#c2ffea',size:1,crosshairOutline:true,crosshairGap:0,crosshairThickness:1,crosshairDot:false,adsColor:'#c2ffea',showFps:false,showWeapon:true,resolutionScale:.5,resolutionCap:'auto',bloom:0,exposure:1.15,postFx:false,quality:'auto',effectsQuality:'auto',cameraShake:1,weaponBob:1,teamPalette:'default',reducedMotion:false,invertY:false,adsSensitivity:.85,adsSensitivityNear:1,adsSensitivityHolo:1,adsSensitivityScope:1,touchSensitivity:1,touchScale:1,touchOpacity:1,touchLeftHanded:false,fpsCap:0,shadows:'high',captions:false,captionScale:1,captionBackground:'dim',captionPosition:'bottom',showKillFeed:true,showDamageNumbers:true,showRadar:true,uiScale:1,adsToggle:false,crouchToggle:false,sprintToggle:false});
const number=(v,fallback,min,max)=>typeof v==='number'&&Number.isFinite(v)?Math.max(min,Math.min(max,v)):fallback;
const choice=(v,values,fallback)=>values.includes(v)?v:fallback;
export const modeRule=mode=>GAME_MODES.find(m=>m.id===mode)?.rules||GAME_MODES[0].rules;
export const teamMode=modeOrConfig=>Boolean(modeRule(typeof modeOrConfig==='string'?modeOrConfig:modeOrConfig?.mode).team);
// LATTICE STRIKE family: both the PvPvE `cocs` and the co-op `cocs-coop` share
// `score:'cocs'`. Engine/UI seams that used to test `mode==='cocs'` use this so
// adding OPERATIONS never changes the original mode's behaviour.
export const isCocsMode=modeOrConfig=>modeRule(typeof modeOrConfig==='string'?modeOrConfig:modeOrConfig?.mode??modeOrConfig?.id).score==='cocs';
export function normalizeConfig(value={}){
 const c=value&&typeof value==='object'?{...value}:{};
  // A `mutators` list is folded into the canonical flags before sanitizing so
  // both spellings resolve identically. Listed mutators win over stale flags;
  // unrelated explicit flags are preserved.
  if(Array.isArray(value?.mutators)){delete c.mutators;applyMutators(c,value.mutators);}
  const mode=choice(c.mode,GAME_MODES.map(m=>m.id),'deathmatch');
  if(mode==='puma-race'||mode==='puma-soccer')Object.assign(c,{speed:1,gravity:1,damage:1,fastPowers:false,lifeSteal:false,unlimitedAmmo:false,suddenDeath:false,randomLoadout:false,oneShot:false,instagib:false,mirrorLoadout:false,bounty:false,berserk:false,bigHead:false,noRecoil:false,startingWeapon:0});
    const rules=modeRule(mode),minGoal=rules.minFragLimit??(mode==='ctf'?1:5),maxGoal=rules.maxFragLimit??50;
    const checkpointValue=c.checkpoint===null||c.checkpoint===undefined?null:(Number.isFinite(Number(c.checkpoint))&&Number(c.checkpoint)>=0?Math.round(Number(c.checkpoint)):null);
    const normalized={mode,botCount:Math.round(number(c.botCount,DEFAULT_CONFIG.botCount,0,rules.maxBots??8)),difficulty:choice(c.difficulty,DIFFICULTIES.map(d=>d.id),DEFAULT_CONFIG.difficulty),fragLimit:Math.round(number(c.fragLimit,rules.fragLimit??15,minGoal,maxGoal)),timeLimit:Math.round(number(c.timeLimit,rules.timeLimit??300,60,900)),respawn:number(c.respawn,2,1,5),speed:choice(c.speed,[.75,1,1.25,1.5],1),gravity:choice(c.gravity,[.4,.7,1],1),damage:choice(c.damage,[.5,1,1.5,2],1),fastPowers:c.fastPowers===true,lifeSteal:c.lifeSteal===true,unlimitedAmmo:c.unlimitedAmmo===true,suddenDeath:c.suddenDeath===true,randomLoadout:c.randomLoadout===true,oneShot:c.oneShot===true,instagib:c.instagib===true,mirrorLoadout:c.mirrorLoadout===true,bounty:c.bounty===true,berserk:c.berserk===true,bigHead:c.bigHead===true,noRecoil:c.noRecoil===true,endless:c.endless===true,startingWeapon:Math.round(number(c.startingWeapon,0,0,Math.max(0,WEAPONS.length-1))),playerName:typeof c.playerName==='string'?c.playerName.replace(/[\u0000-\u001f\u007f]/g,'').trim().slice(0,20):'',mission:choice(c.mission,CAMPAIGN_MISSION_IDS,DEFAULT_MISSION_ID),loadout:normalizeLoadout(c.loadout),checkpoint:checkpointValue};
    // The LATTICE `objective` override is an authored seam (node/income tuning +
    // the opt-in `traversalBotUse` flag). It is preserved only when supplied, so
    // `normalizeConfig(null)` still deep-equals `DEFAULT_CONFIG`. Pure data; a
    // non-object override is dropped like every other malformed field. For
    // OPERATIONS the Director tier is validated here: the engine reads
    // `objective.tier`, `coopTier` stays a legacy fallback, and an absent value
    // resolves to the new-player D1 default without inventing an override key.
    let objective=c.objective&&typeof c.objective==='object'&&!Array.isArray(c.objective)?{...c.objective}:null;
    if(mode==='cocs-coop'&&(objective||c.coopTier!==undefined)){
     objective=objective??{};
     objective.tier=normalizeCocsTier(objective.tier??c.coopTier);
    }
    // The PvPvE rung (section 3.1) rides the config only when explicitly asked
    // for on `cocs`; `cocs-coop` and every other mode stay rung-free, so
    // `normalizeConfig(null)` still deep-equals the frozen default.
    const rung=mode==='cocs'?cocsRung(c.rung)?.id??null:null;
    return {...normalized,...(objective?{objective}:{}),...(rung?{rung}:{}),mutators:Object.freeze(activeMutators(normalized))};
}
// ---------------------------------------------------------------------------
// Launch views (F06). One deterministic description of what a config starts:
// the selection cards, the setup screen and the launch path all read the same
// `normalizeConfig` output plus GAME_MODES metadata, so a displayed promise can
// never drift from the match. Maps are deliberately absent: `arenas.mjs`
// imports this module, so the screens resolve the arena and pass the same
// `plan.rules` into `start()`.
// ---------------------------------------------------------------------------
const secondsLabel=seconds=>{const total=Math.max(0,Math.round(Number(seconds)||0));const minutes=Math.floor(total/60),rest=total%60;return rest?`${minutes}M ${String(rest).padStart(2,'0')}S`:`${minutes} MIN`;};
// Continuous mutators carry their resolved multiplier so the preview names the
// actual value, not only the preset.
const MUTATOR_VALUE={turbo:config=>`${config.speed}× speed`,lowGravity:config=>`${config.gravity}× gravity`,doubleDamage:config=>`${config.damage}× damage`};
export function mutatorView(config={}){
 const c=config&&typeof config==='object'?config:{};
 return Object.freeze(activeMutators(c).map(id=>{
  const mutator=MUTATORS.find(entry=>entry.id===id);
  return Object.freeze({id,name:mutator?.name??id,detail:MUTATOR_VALUE[id]?.(c)??''});
 }));
}
/** The exact rules a quick-start activity composes: saved rules, then the
 * activity's launch defaults, then explicit overrides — the page's historical
 * spread order. Kept here so the selection preview and the launch path share
 * one composition instead of duplicated copy. */
export function quickStartRules(saved={},activity,defaults={},overrides={}){
 const base=saved&&typeof saved==='object'?saved:{};
 const activityDefaults=defaults&&typeof defaults==='object'?defaults:{};
 const explicit=overrides&&typeof overrides==='object'?overrides:{};
 return normalizeConfig({...base,mode:activity,...activityDefaults,...explicit});
}
// Non-co-op team seats alternate `id % 2` from the human seats (core.mjs
// seatTeam), so a local roster split is a pure function of the bot count.
const seatSplit=(humans,bots)=>{let team0=humans,team1=0;for(let id=humans;id<humans+bots;id++)id%2===0?team0++:team1++;return {team0,team1};};
function rosterLabel(rules,meta,roster){
 if(meta.rules?.coop===true)return `SQUAD ${roster.allies} · GARRISON ${roster.garrisonBots}`;
 if(rules.mode==='puma-soccer')return '2 v 2';
 if(rules.mode==='puma-race')return rules.botCount>0?`1 + ${rules.botCount} RACERS`:'SOLO TIME TRIAL';
 if(meta.rules?.team===true&&rules.botCount>0){const split=seatSplit(1,rules.botCount);return `${split.team0} v ${split.team1}`;}
 return rules.botCount>0?`YOU + ${rules.botCount} BOTS`:'SOLO OPERATOR';
}
function fillView(rules,meta,roster,waves){
 if(meta.rules?.coop===true)return Object.freeze({auto:true,note:`Bot seats fill your squad to the ${roster.teamFloor}-operator floor first, then crew the Director garrison. The ${waves.count}-wave operation spawns whether or not you add bots.`});
 if(rules.mode==='puma-soccer')return Object.freeze({auto:true,note:'Empty seats are always filled by bots: it is 2 v 2 even with 0 bot seats. Combat modifiers, weapons and harness powers are disabled.'});
 if(rules.mode==='puma-race')return Object.freeze({auto:true,note:'0 rivals is a solo time trial: nothing starts compulsory combat. In online races, human drivers replace excess bots to cap the grid at 8 racers. Combat modifiers, weapons and harness powers are disabled.'});
 if(rules.mode==='cocs'){const rung=cocsRung(rules.rung);return Object.freeze({auto:true,note:rung?`Bots fill the ${rung.perTeam} v ${rung.perTeam} rung to ${rung.total} seats; online humans take seats first.`:'Bots fill the opposing team seats. At 0 bot seats the opposing team stays empty in local practice.'});}
 return Object.freeze({auto:false,note:null});
}
/** Effective launch description for one config. `humans` is the local human
 * seat count; `roster`/`tier`/`waves` are OPERATIONS-only. Frozen and
 * deterministic: the same config always yields the same plan. */
export function matchPlan(value={},{humans=1}={}){
 const rules=normalizeConfig(value);
 const meta=GAME_MODES.find(entry=>entry.id===rules.mode)??GAME_MODES[0];
 const coop=meta.rules?.coop===true;
 const humanSeats=Math.max(1,Math.round(Number(humans)||1));
 const roster=coop?coopRoster({humans:humanSeats,bots:rules.botCount}):null;
 const tier=coop?directorTierCopy(configuredDirectorTier(rules)):null;
 const waves=coop?coopWaveSummary(tier.id):null;
 const modifiers=mutatorView(rules);
 const difficulty=DIFFICULTIES.find(entry=>entry.id===rules.difficulty);
 return Object.freeze({
  mode:Object.freeze({id:meta.id,name:meta.name,description:meta.description,team:meta.rules?.team===true,coop,score:meta.rules?.score??'frags'}),
  rules,
  team:meta.rules?.team===true,
  coop,
  difficulty:Object.freeze({id:rules.difficulty,name:difficulty?.name??rules.difficulty}),
  humans:humanSeats,
  bots:rules.botCount,
  actors:humanSeats+rules.botCount,
  seconds:rules.timeLimit,
  duration:secondsLabel(rules.timeLimit),
  roster,
  rosterLabel:rosterLabel(rules,meta,roster),
  fill:fillView(rules,meta,roster,waves),
  tier:coop?Object.freeze({id:tier.id,label:tier.label,copy:tier.copy,modifiers:Object.freeze([...tier.modifiers]),band:Object.freeze([...tier.band])}):null,
  waves,
  modifiers,
  modifierLabel:modifiers.length?modifiers.map(entry=>entry.name).join(' · '):'NO MODIFIERS',
 });
}
export const CAPTION_SCALE_MIN=.8;
export const CAPTION_SCALE_MAX=1.6;
export const CAPTION_BACKGROUNDS=Object.freeze(['solid','dim','transparent']);
export const CAPTION_POSITIONS=Object.freeze(['bottom','top']);
// Per-sight ADS sensitivity multipliers (additive). The scalar `adsSensitivity`
// stays the base; a bucket only scales it while that sight is live, so a save
// without the keys resolves to exactly the shipped single scalar.
export const ADS_SENSITIVITY_MULT_MIN=.4;
export const ADS_SENSITIVITY_MULT_MAX=1.6;
export const ADS_SIGHT_MULTIPLIER_KEYS=Object.freeze({near:'adsSensitivityNear',holo:'adsSensitivityHolo',scope:'adsSensitivityScope'});
// Which multiplier bucket a resolved sight belongs to. The live sight's own
// kind wins; a sight without one falls back to its magnification so a future
// optic still buckets (<=1× near, <2× holo, otherwise scope). A missing sight
// returns null and the caller keeps the scalar untouched.
export function adsSightBucket(sight){
 const kind=typeof sight?.kind==='string'?sight.kind:null;
 if(kind==='iron')return 'near';
 if(kind==='holo')return 'holo';
 if(kind==='scope')return 'scope';
 const mag=Number(sight?.magnification);
 if(!Number.isFinite(mag))return null;
 if(mag<=1.05)return 'near';
 return mag<2?'holo':'scope';
}
// The multiplier that scales `display.adsSensitivity` for the active sight.
// Unknown sights, absent display objects and legacy saves return 1, so the
// effective ADS gain stays the documented scalar until a bucket is tuned.
export function adsSensitivityMultiplier(display={},sight=null){
 const bucket=adsSightBucket(sight);
 if(!bucket)return 1;
 const source=display&&typeof display==='object'?display:null;
 return number(source?.[ADS_SIGHT_MULTIPLIER_KEYS[bucket]],1,ADS_SENSITIVITY_MULT_MIN,ADS_SENSITIVITY_MULT_MAX);
}
export function normalizeDisplay(value={}){
 const c=value&&typeof value==='object'?value:{};
 return {fov:Math.round(number(c.fov,82,65,110)),crosshair:choice(c.crosshair,['cross','dot','ring','chevron','split'],'cross'),color:typeof c.color==='string'&&/^#[0-9a-f]{6}$/i.test(c.color)?c.color:'#c2ffea',size:number(c.size,1,.6,1.8),crosshairOutline:c.crosshairOutline!==false,crosshairGap:number(c.crosshairGap,0,0,4),crosshairThickness:number(c.crosshairThickness,1,.6,2),crosshairDot:c.crosshairDot===true,adsColor:typeof c.adsColor==='string'&&/^#[0-9a-f]{6}$/i.test(c.adsColor)?c.adsColor:'#c2ffea',showFps:c.showFps===true,showWeapon:c.showWeapon!==false,resolutionScale:number(c.resolutionScale,.5,.5,1.5),resolutionCap:choice(c.resolutionCap,['auto','1080p','1440p','native'],'auto'),bloom:number(c.bloom,0,0,1),exposure:number(c.exposure,1.15,.6,1.8),postFx:c.postFx===true,quality:choice(c.quality,['auto','low','medium','high'],'auto'),effectsQuality:choice(c.effectsQuality,['auto','low','medium','high'],'auto'),cameraShake:number(c.cameraShake,1,0,1.5),weaponBob:number(c.weaponBob,1,0,1.5),teamPalette:choice(c.teamPalette,['default','colorblind'],'default'),reducedMotion:c.reducedMotion===true,invertY:c.invertY===true,adsSensitivity:number(c.adsSensitivity,.85,.2,1.5),adsSensitivityNear:number(c.adsSensitivityNear,1,ADS_SENSITIVITY_MULT_MIN,ADS_SENSITIVITY_MULT_MAX),adsSensitivityHolo:number(c.adsSensitivityHolo,1,ADS_SENSITIVITY_MULT_MIN,ADS_SENSITIVITY_MULT_MAX),adsSensitivityScope:number(c.adsSensitivityScope,1,ADS_SENSITIVITY_MULT_MIN,ADS_SENSITIVITY_MULT_MAX),touchSensitivity:number(c.touchSensitivity,1,.3,3),touchScale:number(c.touchScale,1,.8,1.3),touchOpacity:number(c.touchOpacity,1,.4,1),touchLeftHanded:c.touchLeftHanded===true,fpsCap:choice(c.fpsCap,[...FPS_CAPS],0),shadows:choice(c.shadows,[...SHADOW_LEVELS],'high'),captions:c.captions===true,captionScale:number(c.captionScale,1,CAPTION_SCALE_MIN,CAPTION_SCALE_MAX),captionBackground:choice(c.captionBackground,[...CAPTION_BACKGROUNDS],'dim'),captionPosition:choice(c.captionPosition,[...CAPTION_POSITIONS],'bottom'),showKillFeed:c.showKillFeed!==false,showDamageNumbers:c.showDamageNumbers!==false,showRadar:c.showRadar!==false,uiScale:number(c.uiScale,1,.8,1.4),adsToggle:c.adsToggle===true,crouchToggle:c.crouchToggle===true,sprintToggle:c.sprintToggle===true};
}
// ---------------------------------------------------------------------------
// Mode loadouts. A mode may pin starting weapons, allowed weapons, infinite
// ammo, pickup availability and ADS via a top-level `loadout` on its GAME_MODES
// entry. `loadoutFor` merges that rule with an explicit per-match override (a
// preset id or a validated object) so the same resolver drives spawning, bots
// and the sim. Modes without a `loadout` keep the classic free arsenal.
// ---------------------------------------------------------------------------
export const LOADOUT_PRESETS=Object.freeze({
 sniperOnly:Object.freeze({id:'sniperOnly',name:'Sniper Only',weapons:Object.freeze([2,8]),start:2,infinite:true,noAds:true}),
 pistols:Object.freeze({id:'pistols',name:'Pistols',weapons:Object.freeze([0,9]),start:0,infinite:true,noAds:true}),
});
const weaponIndexes=value=>Array.isArray(value)?[...new Set(value.filter(index=>Number.isInteger(index)&&index>=0&&index<WEAPONS.length))].sort((a,b)=>a-b):null;
function normalizeLoadout(value){
 if(typeof value==='string'){const preset=LOADOUT_PRESETS[value];return preset?{...preset,weapons:[...preset.weapons]}:null;}
 if(!value||typeof value!=='object')return null;
 const weapons=value.weapons==='all'||value.weapons==='ladder'?value.weapons:weaponIndexes(value.weapons);
 if(weapons!==null&&weapons!=='all'&&weapons!=='ladder'&&!weapons.length)return null;
 const out={};
 if(weapons!==undefined&&weapons!==null)out.weapons=weapons;
 if(Number.isInteger(value.start)&&value.start>=0&&value.start<WEAPONS.length)out.start=value.start;
 if(value.infinite===true)out.infinite=true;
 if(value.noAds===true)out.noAds=true;
 if(value.noPickups===true)out.noPickups=true;
 if(!Object.keys(out).length)return null;
 if(out.start===undefined&&Array.isArray(out.weapons))out.start=out.weapons[0];
 return out;
}
// Resolve the effective loadout for a mode plus optional override. The override
// wins field-by-field; arrays are copied so callers can never mutate the tables.
export function loadoutFor(mode,override){
 const base=loadoutRule(mode),extra=normalizeLoadout(override);
 if(!base&&!extra)return null;
 const merged={...(base||{}),...(extra||{})};
 if(Array.isArray(merged.weapons))merged.weapons=[...merged.weapons];
 if(merged.start===undefined&&Array.isArray(merged.weapons))merged.start=merged.weapons[0];
 return merged;
}
export const loadoutRule=mode=>GAME_MODES.find(m=>m.id===mode)?.loadout??null;
export const loadoutAllows=(loadout,index)=>!loadout||loadout.weapons===undefined||loadout.weapons==='all'||loadout.weapons==='ladder'||loadout.weapons.includes(index);
export function modeWeapon(c,resolved){const loadout=resolved??loadoutFor(c?.mode,c?.loadout);if(loadout&&Array.isArray(loadout.weapons)&&loadout.weapons.length===1)return loadout.start??loadout.weapons[0];return null;}
// The weapon an actor should hold on spawn: a pinned single-weapon mode wins,
// then the loadout's chosen start, then the configured starting weapon.
export function loadoutStart(c,resolved){const loadout=resolved??loadoutFor(c?.mode,c?.loadout),pinned=modeWeapon(c,loadout);if(pinned!==null)return pinned;if(loadout&&Number.isInteger(loadout.start))return loadout.start;return Number.isInteger(c?.startingWeapon)?c.startingWeapon:0;}
export function spawnInventory(c,resolved){const loadout=resolved??loadoutFor(c?.mode,c?.loadout),locked=modeWeapon(c,loadout),start=loadoutStart(c,loadout),ammo=[Infinity,6,5,10,24,6,8,10,8,30];return ammo.map((amount,i)=>{if(locked!==null)return i===locked?Infinity:0;if(loadout&&!loadoutAllows(loadout,i))return 0;if(loadout?.weapons==='all'||c.mode==='arsenal')return Infinity;if(i===0)return Infinity;if((loadout?.infinite===true||c.unlimitedAmmo)&&i===start)return Infinity;return i===start?amount:0;});}
// Convenience resolver used by core: one call yields the pinned weapon, the full
// ammo belt and the merged loadout rule.
export function spawnLoadout(c,resolved){const loadout=resolved??loadoutFor(c?.mode,c?.loadout);return {loadout,weapon:loadoutStart(c,loadout),ammo:spawnInventory(c,loadout)};}
