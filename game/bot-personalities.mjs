import {operatorProfile} from './operator-profiles.mjs';
import {harnessBotHints} from './harness-profiles.mjs';

const clamp=(v,lo,hi)=>v<lo?lo:v>hi?hi:v;
const freeze=value=>Object.freeze(value);
const blend=(a,b,w=.55)=>a*w+b*(1-w);

const ROLE_ARCHETYPES=freeze({
 adaptive:  {label:'ADAPTIVE', aggression:.52, hold:.35, flank:.4,  objective:.55, supply:.5,  vehicle:.4,  strafe:.8,  range:[6,18], spacing:2.4},
 anchor:    {label:'ANCHOR',   aggression:.28, hold:.85, flank:.15, objective:.78, supply:.55, vehicle:.3,  strafe:.6,  range:[5,14], spacing:2.1},
 disruptor: {label:'DISRUPTOR',aggression:.88, hold:.18, flank:.5,  objective:.5,  supply:.4,  vehicle:.5,  strafe:.98, range:[4,12], spacing:2.8},
 connector: {label:'CONNECTOR',aggression:.45, hold:.55, flank:.35, objective:.62, supply:.72, vehicle:.42, strafe:.7,  range:[7,18], spacing:1.9},
 duelist:   {label:'DUELIST',  aggression:.72, hold:.25, flank:.45, objective:.32, supply:.35, vehicle:.4,  strafe:1,   range:[5,15], spacing:2.5},
 ambusher:  {label:'AMBUSHER', aggression:.55, hold:.5,  flank:.72, objective:.38, supply:.45, vehicle:.3,  strafe:.55, range:[3,11], spacing:3},
 flanker:   {label:'FLANKER',  aggression:.72, hold:.22, flank:.92, objective:.45, supply:.4,  vehicle:.5,  strafe:1.05,range:[5,14], spacing:2.7},
 orbiter:   {label:'ORBITER',  aggression:.5,  hold:.45, flank:.5,  objective:.42, supply:.5,  vehicle:.35, strafe:1.15,range:[9,20], spacing:3.2},
 optimizer: {label:'OPTIMIZER',aggression:.55, hold:.5,  flank:.4,  objective:.62, supply:.8,  vehicle:.55, strafe:.75, range:[7,19], spacing:2.6},
});

const PERSONALITY_ARCHETYPES=freeze({
 brawler:    {label:'BRAWLER',    aggression:.9,  hold:.2,  flank:.35, objective:.45, supply:.3,  vehicle:.35, strafe:.85, range:[3,9],  spacing:2.6},
 skirmisher: {label:'SKIRMISHER', aggression:.6,  hold:.4,  flank:.45, objective:.5,  supply:.45, vehicle:.45, strafe:.95, range:[8,18], spacing:2.6},
 suppressor: {label:'SUPPRESSOR', aggression:.35, hold:.75, flank:.3,  objective:.55, supply:.5,  vehicle:.3,  strafe:.7,  range:[9,22], spacing:3},
 sentinel:   {label:'SENTINEL',   aggression:.25, hold:.9,  flank:.2,  objective:.7,  supply:.55, vehicle:.25, strafe:.6,  range:[7,18], spacing:2.4},
 opportunist:{label:'OPPORTUNIST',aggression:.5,  hold:.55, flank:.5,  objective:.5,  supply:.6,  vehicle:.35, strafe:.7,  range:[10,24],spacing:3},
 flanker:    {label:'FLANKER',    aggression:.75, hold:.25, flank:.9,  objective:.45, supply:.4,  vehicle:.5,  strafe:1.05,range:[5,14], spacing:2.8},
 controller: {label:'CONTROLLER', aggression:.5,  hold:.6,  flank:.35, objective:.6,  supply:.5,  vehicle:.4,  strafe:.8,  range:[6,15], spacing:3.2},
});

const DEFAULT=ROLE_ARCHETYPES.adaptive;
const TAU=Math.PI*2;

// Deterministic combat archetypes layered on top of role + harness personality.
// Role and personality each vote for an archetype; a small stable per-id noise
// term breaks ties (and nudges near-ties) without ever using Math.random, so a
// given id+role+personality always resolves to the same archetype.
const ARCHETYPE_ORDER=freeze(['rusher','flanker','defender','support','sharpshooter']);
const ROLE_ARCHETYPE_WEIGHTS=freeze({
 adaptive: {rusher:1, flanker:2, defender:1, support:2, sharpshooter:1},
 anchor:    {defender:3, support:1},
 disruptor: {rusher:3, flanker:1},
 connector: {support:3, defender:1},
 duelist:   {sharpshooter:3, flanker:1},
 ambusher:  {flanker:3, sharpshooter:1},
 flanker:   {flanker:3, rusher:1},
 orbiter:   {sharpshooter:3, support:1},
 optimizer: {support:2, defender:2},
});
const PERSONALITY_ARCHETYPE_WEIGHTS=freeze({
 brawler:    {rusher:3, flanker:1},
 skirmisher: {flanker:2, rusher:2, sharpshooter:1},
 suppressor: {sharpshooter:3, defender:1},
 sentinel:   {defender:3, support:1},
 opportunist:{sharpshooter:2, flanker:1, support:1},
 flanker:    {flanker:3, rusher:1},
 controller: {support:2, defender:2},
});

// Bounded movement/engagement presets. `inner`/`outer` are fractions of the
// bot's already-jittered range band; patterns are 0 sine, 1 serpentine, 2 jitter.
const ARCHETYPE_PROFILES=freeze({
 rusher:      {strafePattern:2, strafePeriod:1.4, weaponBand:'close', innerFrac:0,   outerFrac:.35, thinkScale:.82},
 flanker:     {strafePattern:1, strafePeriod:2,   weaponBand:'mid',   innerFrac:.12, outerFrac:.55, thinkScale:.95},
 defender:    {strafePattern:0, strafePeriod:2.8, weaponBand:'mid',   innerFrac:.2,  outerFrac:.68, thinkScale:1.1},
 support:     {strafePattern:0, strafePeriod:3.4, weaponBand:'mid',   innerFrac:.3,  outerFrac:.8,  thinkScale:1.05},
 sharpshooter:{strafePattern:2, strafePeriod:3,   weaponBand:'long',  innerFrac:.45, outerFrac:1,   thinkScale:1.15},
});

// Weapon index preferences per engagement band. Core only adopts a preference
// whose ammo is still available and otherwise falls back to its distance ladder.
const WEAPON_BANDS=freeze({close:[9,7,3,4,0],mid:[0,4,1,6,9,8],long:[2,8,6,0,4]});

export function botWeaponBandPick(ammo,band){
 for(const index of WEAPON_BANDS[band]||[])if(ammo&&ammo[index]>0)return index;
 return -1;
}

export function botArchetype(role,personality,id=0){
 const roleWeights=ROLE_ARCHETYPE_WEIGHTS[role]||ROLE_ARCHETYPE_WEIGHTS.adaptive;
 const personalityWeights=PERSONALITY_ARCHETYPE_WEIGHTS[personality]||PERSONALITY_ARCHETYPE_WEIGHTS.brawler;
 const numericId=Number.isFinite(id)?id|0:0;
 let best=ARCHETYPE_ORDER[0],bestScore=-Infinity;
 ARCHETYPE_ORDER.forEach((name,index)=>{
  const score=(roleWeights[name]||0)+(personalityWeights[name]||0)+(botNoise(numericId,40+index)-.5)*.9;
  if(score>bestScore){bestScore=score;best=name;}
 });
 return best;
}

export function botNoise(id,salt=0){
 const seed=Math.imul((Number.isFinite(id)?id|0:0)+1,2654435761)+Math.imul(salt|0,40503);
 let n=seed>>>0;
 n=Math.imul(n^(n>>>15),2246822519)>>>0;
 n=Math.imul(n^(n>>>13),3266489917)>>>0;
 return (n>>>0)/4294967296;
}

export function botBehavior(actor){
 const character=actor?.character,harness=actor?.harness,id=Number.isFinite(actor?.id)?actor.id:0;
 // Harness-only AI policy override (docs/design/CLASS_OVERHAUL.md §14): the
 // balance sweep runs a policy-neutral pass where every seat shares one
 // role/personality/archetype. `Match` stores `options.botPolicy` on the bot
 // brain; nothing on the live path sets it, so default behaviour is unchanged.
 const policy=actor?.bot?.policy??null;
 const role=policy?.role??operatorProfile(character)?.role;
 const hints=harnessBotHints(harness);
 const personality=policy?.personality??hints?.personality;
 const r=ROLE_ARCHETYPES[role]||DEFAULT;
 const p=PERSONALITY_ARCHETYPES[personality]||DEFAULT;
 const jitter=(salt,amount)=>1+(botNoise(id,salt)-.5)*amount;
 const lo=blend(r.range[0],p.range[0])*jitter(1,.24);
 const hi=blend(r.range[1],p.range[1])*jitter(2,.18);
 const rangeLo=Math.max(2,Math.min(lo,hi-.5)),rangeHi=Math.max(lo+.5,hi);
 const archetype=policy?.archetype??botArchetype(role||'adaptive',personality||'adaptive',id);
 const profile=ARCHETYPE_PROFILES[archetype]||ARCHETYPE_PROFILES.support;
 const span=Math.max(.5,rangeHi-rangeLo);
 const innerFrac=clamp(profile.innerFrac+(botNoise(id,14)-.5)*.12,0,1);
 const outerFrac=clamp(profile.outerFrac+(botNoise(id,15)-.5)*.14,innerFrac,1);
 const engageOuter=clamp(rangeLo+span*outerFrac,rangeLo+.5,rangeHi);
 const engageInner=clamp(rangeLo+span*innerFrac,rangeLo,engageOuter-.5);
 return freeze({
  id,
  role:role||'adaptive',
  personality:personality||'adaptive',
  label:r.label,
  suffix:p.label,
  archetype,
  strafePattern:profile.strafePattern,
  strafePeriod:clamp(profile.strafePeriod*jitter(16,.3),.8,5),
  strafePhase:botNoise(id,17)*TAU,
  weaponBand:profile.weaponBand,
  engageBand:[engageInner,engageOuter],
  thinkScale:clamp(profile.thinkScale*jitter(18,.16),.7,1.4),
  aggression:clamp(blend(r.aggression,p.aggression)+(botNoise(id,3)-.5)*.18,0,1),
  hold:clamp(blend(r.hold,p.hold)+(botNoise(id,4)-.5)*.18,0,1),
  flank:clamp(blend(r.flank,p.flank)+(botNoise(id,5)-.5)*.2,0,1),
  objective:clamp(blend(r.objective,p.objective)+(botNoise(id,6)-.5)*.16,0,1),
  supply:clamp(blend(r.supply,p.supply)+(botNoise(id,7)-.5)*.16,0,1),
  vehicle:clamp(blend(r.vehicle,p.vehicle)+(botNoise(id,8)-.5)*.2,0,1),
  strafe:clamp(blend(r.strafe,p.strafe)*(.86+botNoise(id,9)*.28),.3,1.4),
  range:[Math.max(2,Math.min(lo,hi-.5)),Math.max(lo+.5,hi)],
  spacing:clamp(blend(r.spacing,p.spacing)+(botNoise(id,10)-.5)*.7,1.6,4.2),
  retreat:clamp((hints?.retreatHealth??.4)+(botNoise(id,11)-.5)*.22,.12,.8),
 });
}

export function botBehaviorKey(actor){
 const behavior=botBehavior(actor);
 return `${behavior.role}/${behavior.personality}`;
}

export const BOT_ROLE_COUNT=Object.keys(ROLE_ARCHETYPES).length;
export const BOT_PERSONALITY_COUNT=Object.keys(PERSONALITY_ARCHETYPES).length;
