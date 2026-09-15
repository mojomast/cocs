import {WEAPONS} from './data.mjs';
import {CAMPAIGN_MISSION_IDS,DEFAULT_MISSION_ID} from './campaign-data.mjs';
export const GAME_MODES = [
 {id:'deathmatch',name:'Deathmatch',description:'Everyone for themselves. Start with a Pulse Rifle, scavenge the rest, first to the frag limit wins.',rules:{team:false,score:'frags',fragLimit:15,suddenDeathSeconds:12}},
  {id:'ctf',name:'Capture the Flag',description:'Steal the enemy flag and run it home while keeping your own safe. Classic, chaotic, worth it.',rules:{team:true,score:'captures',fragLimit:3,carrierSpeed:.9,suddenDeathSeconds:15}},
  {id:'koth',name:'King of the Hill',description:'Take the central hill and hold it second by second. Contest it to freeze the enemy clock.',rules:{team:true,score:'hillTime',fragLimit:100,minFragLimit:1,maxFragLimit:900,vehicles:false,rotationSeconds:30,zoneBuff:'haste',suddenDeathSeconds:15,objective:{kind:'koth',captureSeconds:5}}},
  {id:'domination',name:'Domination',description:'Capture three control zones and bleed points for every second your team owns them.',rules:{team:true,score:'zoneTime',fragLimit:100,minFragLimit:1,maxFragLimit:900,vehicles:false,zoneBuffs:{alpha:'overshield',bravo:'haste',charlie:'overcharge'},suddenDeathSeconds:15,objective:{kind:'domination',captureSeconds:5}}},
  {id:'assault',name:'Assault',description:'Attackers take sectors in order, defenders hold to the last one. Breach the final sector to win.',rules:{team:true,score:'sectors',fragLimit:3,minFragLimit:1,maxFragLimit:9,objective:{kind:'assault',captureSeconds:6}}},
 {id:'teamdeathmatch',name:'Team Deathmatch',description:'Shared team score with friendly fire off. Win together or feed together.',rules:{team:true,score:'teamFrags',fragLimit:30,suddenDeathSeconds:15}},
  {id:'instagib',name:'Instagib',description:'Rail only, unlimited ammo. One unprotected hit eliminates. No supplies, no powers, no mercy.',loadout:{weapons:[2],start:2,infinite:true,noPickups:true}},
  {id:'rockets',name:'Rocket Arena',description:'Unlimited rockets for everyone. Health and armor stay on the menu.',loadout:{weapons:[1],start:1,infinite:true}},
  {id:'arsenal',name:'Full Arsenal',description:'Every weapon unlocked with unlimited ammo from the first spawn. Choose violence, repeatedly.',loadout:{weapons:'all',start:0,infinite:true}},
  {id:'armsrace',name:'Arms Race',description:'Every kill promotes you to the next weapon in the rack. Finish the last gun to win.',rules:{team:false,score:'ladder',fragLimit:10,minFragLimit:10,maxFragLimit:10}},
  {id:'combined-arms',name:'Combined Arms',description:'Command infantry, armour and aircraft across the largest battlefields. Hold the zones together.',rules:{team:true,score:'zoneTime',fragLimit:200,minFragLimit:50,maxFragLimit:900,vehicles:true,suddenDeathSeconds:15,objective:{kind:'domination',captureSeconds:6},maxBots:16}},
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
 });
}
export const DEFAULT_CONFIG = Object.freeze({mode:'deathmatch',botCount:2,difficulty:'easy',fragLimit:15,timeLimit:300,respawn:2,speed:1,gravity:1,damage:1,fastPowers:false,lifeSteal:false,unlimitedAmmo:false,suddenDeath:false,randomLoadout:false,oneShot:false,instagib:false,mirrorLoadout:false,bounty:false,berserk:false,bigHead:false,noRecoil:false,endless:false,startingWeapon:0,playerName:'',mission:DEFAULT_MISSION_ID,loadout:null,mutators:Object.freeze([])});
export const DEFAULT_DISPLAY = Object.freeze({fov:82,crosshair:'cross',color:'#c2ffea',size:1,showFps:false,showWeapon:true,resolutionScale:.5,bloom:0,exposure:1.15,postFx:false,quality:'auto',teamPalette:'default',reducedMotion:false,invertY:false,adsSensitivity:.85,touchSensitivity:1,captions:false,showKillFeed:true,showDamageNumbers:true,showRadar:true});
const number=(v,fallback,min,max)=>typeof v==='number'&&Number.isFinite(v)?Math.max(min,Math.min(max,v)):fallback;
const choice=(v,values,fallback)=>values.includes(v)?v:fallback;
export const modeRule=mode=>GAME_MODES.find(m=>m.id===mode)?.rules||GAME_MODES[0].rules;
export const teamMode=modeOrConfig=>Boolean(modeRule(typeof modeOrConfig==='string'?modeOrConfig:modeOrConfig?.mode).team);
export function normalizeConfig(value={}){
 const c=value&&typeof value==='object'?{...value}:{};
  // A `mutators` list is folded into the canonical flags before sanitizing so
  // both spellings resolve identically. Listed mutators win over stale flags;
  // unrelated explicit flags are preserved.
  if(Array.isArray(value?.mutators)){delete c.mutators;applyMutators(c,value.mutators);}
  const mode=choice(c.mode,GAME_MODES.map(m=>m.id),'deathmatch');
  if(mode==='puma-race'||mode==='puma-soccer')Object.assign(c,{speed:1,gravity:1,damage:1,fastPowers:false,lifeSteal:false,unlimitedAmmo:false,suddenDeath:false,randomLoadout:false,oneShot:false,instagib:false,mirrorLoadout:false,bounty:false,berserk:false,bigHead:false,noRecoil:false,startingWeapon:0});
    const rules=modeRule(mode),minGoal=rules.minFragLimit??(mode==='ctf'?1:5),maxGoal=rules.maxFragLimit??50;
    const normalized={mode,botCount:Math.round(number(c.botCount,DEFAULT_CONFIG.botCount,0,rules.maxBots??8)),difficulty:choice(c.difficulty,DIFFICULTIES.map(d=>d.id),DEFAULT_CONFIG.difficulty),fragLimit:Math.round(number(c.fragLimit,rules.fragLimit??15,minGoal,maxGoal)),timeLimit:Math.round(number(c.timeLimit,300,60,900)),respawn:number(c.respawn,2,1,5),speed:choice(c.speed,[.75,1,1.25,1.5],1),gravity:choice(c.gravity,[.4,.7,1],1),damage:choice(c.damage,[.5,1,1.5,2],1),fastPowers:c.fastPowers===true,lifeSteal:c.lifeSteal===true,unlimitedAmmo:c.unlimitedAmmo===true,suddenDeath:c.suddenDeath===true,randomLoadout:c.randomLoadout===true,oneShot:c.oneShot===true,instagib:c.instagib===true,mirrorLoadout:c.mirrorLoadout===true,bounty:c.bounty===true,berserk:c.berserk===true,bigHead:c.bigHead===true,noRecoil:c.noRecoil===true,endless:c.endless===true,startingWeapon:Math.round(number(c.startingWeapon,0,0,Math.max(0,WEAPONS.length-1))),playerName:typeof c.playerName==='string'?c.playerName.replace(/[\u0000-\u001f\u007f]/g,'').trim().slice(0,20):'',mission:choice(c.mission,CAMPAIGN_MISSION_IDS,DEFAULT_MISSION_ID),loadout:normalizeLoadout(c.loadout)};
    return {...normalized,mutators:Object.freeze(activeMutators(normalized))};
}
export function normalizeDisplay(value={}){
 const c=value&&typeof value==='object'?value:{};
 return {fov:Math.round(number(c.fov,82,65,110)),crosshair:choice(c.crosshair,['cross','dot','ring','chevron','split'],'cross'),color:typeof c.color==='string'&&/^#[0-9a-f]{6}$/i.test(c.color)?c.color:'#c2ffea',size:number(c.size,1,.6,1.8),showFps:c.showFps===true,showWeapon:c.showWeapon!==false,resolutionScale:number(c.resolutionScale,.5,.5,1.5),bloom:number(c.bloom,0,0,1),exposure:number(c.exposure,1.15,.6,1.8),postFx:c.postFx===true,quality:choice(c.quality,['auto','low','medium','high'],'auto'),teamPalette:choice(c.teamPalette,['default','colorblind'],'default'),reducedMotion:c.reducedMotion===true,invertY:c.invertY===true,adsSensitivity:number(c.adsSensitivity,.85,.2,1.5),touchSensitivity:number(c.touchSensitivity,1,.3,3),captions:c.captions===true,showKillFeed:c.showKillFeed!==false,showDamageNumbers:c.showDamageNumbers!==false,showRadar:c.showRadar!==false};
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
