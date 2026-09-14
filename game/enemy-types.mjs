import {botBehavior} from './bot-personalities.mjs';

// Single-player enemies are a deliberately different class from multiplayer
// bots: fragile, themed "husks" that die fast. They reuse the whole bot brain
// for pathing/aim, but swap in a per-type behaviour profile and a fixed stat
// block that bypasses the normal CHARACTERS health pool.
export const ENEMY_TYPES = Object.freeze({
 husk: Object.freeze({
  id:'husk', name:'Husk', role:'SWARM',
  health:30, armor:0, speedMult:1.1, damageMult:.55,
  kind:'swarmer', meleeOnly:true, meleeRange:2.5, meleeDamage:11,
  range:[1.4,3], hold:.05, aggression:1,
  scale:.72, color:'#ff5c7a', accent:'#3a0d18', points:1,
  character:'chatgpt', harness:'openclaw',
 }),
 spitter: Object.freeze({
  id:'spitter', name:'Spitter', role:'RANGED',
  health:45, armor:5, speedMult:.95, damageMult:.8,
  kind:'ranged', range:[14,28], hold:.62, aggression:.42,
  scale:.9, color:'#ffb03e', accent:'#3a2407', points:1,
  character:'meta', harness:'openclaw',
 }),
 brute: Object.freeze({
  id:'brute', name:'Brute', role:'HEAVY',
  health:140, armor:40, speedMult:.62, damageMult:1.35,
  kind:'heavy', range:[6,16], hold:.55, aggression:.72,
  scale:1.32, color:'#b060ff', accent:'#2a1140', points:3,
  character:'deepseek', harness:'openclaw',
 }),
 warden: Object.freeze({
  id:'warden', name:'WARDEN', role:'BOSS', boss:true,
  health:450, armor:100, speedMult:.85, damageMult:1.55,
  kind:'heavy', range:[6,18], hold:.5, aggression:.8,
  scale:1.6, color:'#ff3b3b', accent:'#2a0808', points:10,
  character:'grok', harness:'openclaw',
 }),
});
export const ENEMY_TYPE_IDS = Object.keys(ENEMY_TYPES);
export const DEFAULT_ENEMY_ID = 'spitter';
export const enemyById = id => ENEMY_TYPES[id] || ENEMY_TYPES[DEFAULT_ENEMY_ID];

// Mutates an actor into a specific enemy class. Call BEFORE match.spawn so the
// profile survives every respawn (the player is the only actor that respawns in
// single player, but this keeps the contract honest).
export function applyEnemyFields(actor, typeOrId){
 const type=typeof typeOrId==='string'?enemyById(typeOrId):typeOrId;
 actor.npcType=type.id;actor.name=type.name;actor.enemyRole=type.role;
 actor.npcProfile={health:type.health,armor:type.armor,speedMult:type.speedMult,damageMult:type.damageMult,scale:type.scale,color:type.color,accent:type.accent,points:type.points};
 if(type.meleeOnly===true)actor.meleeDamage=type.meleeDamage;
 if(type.boss===true)actor.isBoss=true;
 return actor;
}

// Shape-compatible with botBehavior(): start from the normal brain and override
// only the knobs that make an enemy class feel different.
export function enemyBehavior(actor){
 const base=botBehavior(actor), type=enemyById(actor.npcType);
 return Object.freeze({...base,
  kind:type.kind, meleeOnly:type.meleeOnly===true, meleeRange:type.meleeRange??2.2,
  range:type.range, aggression:type.aggression, hold:type.hold,
  weaponBand:type.kind==='swarmer'?'close':type.kind==='heavy'?'mid':'long',
  engageBand:type.kind==='swarmer'?[1.2,2.4]:type.kind==='heavy'?[6,14]:[14,26],
  thinkScale:type.kind==='swarmer'?(base.thinkScale??1)*.7:base.thinkScale,
 });
}
