import {botBehavior} from './bot-personalities.mjs';

// Single-player enemies are a deliberately different class from multiplayer
// bots: fragile, themed "husks" that die fast. They reuse the whole bot brain
// for pathing/aim, but swap in a per-type behaviour profile and a fixed stat
// block that bypasses the normal CHARACTERS health pool.
export const ENEMY_TYPES = Object.freeze({
 husk: Object.freeze({
  id:'husk', name:'Husk', role:'SWARM',
  health:30, armor:0, speedMult:1.1, damageMult:.32,
  kind:'swarmer', meleeOnly:true, meleeRange:2.5, meleeDamage:8,
  range:[1.4,3], hold:.05, aggression:1, leash:10,
  scale:.72, color:'#ff5c7a', accent:'#3a0d18', points:1,
  character:'chatgpt', harness:'openclaw',
 }),
 spitter: Object.freeze({
  id:'spitter', name:'Spitter', role:'RANGED',
  health:45, armor:5, speedMult:.95, damageMult:.4,
  kind:'ranged', range:[14,28], hold:.62, aggression:.42, leash:18,
  scale:.9, color:'#ffb03e', accent:'#3a2407', points:1,
  character:'meta', harness:'openclaw',
 }),
 brute: Object.freeze({
  id:'brute', name:'Brute', role:'HEAVY',
  health:140, armor:40, speedMult:.62, damageMult:.75,
  kind:'heavy', range:[6,16], hold:.55, aggression:.72, leash:14,
  scale:1.32, color:'#b060ff', accent:'#2a1140', points:3,
  character:'deepseek', harness:'openclaw',
 }),
 warden: Object.freeze({
  id:'warden', name:'WARDEN', role:'BOSS', boss:true,
  health:450, armor:100, speedMult:.85, damageMult:1,
  kind:'heavy', range:[6,18], hold:.5, aggression:.8, leash:26,
  scale:1.6, color:'#ff3b3b', accent:'#2a0808', points:10,
  character:'grok', harness:'openclaw',
  // Multi-phase boss overlay. Each phase is a labelled combat profile: the
  // runtime reads `bossPhaseProfile()` from the campaign `bossPhase` counter and
  // rewrites speed/damage plus the telegraphed ground-slam attack. Phases are
  // pure data so the fight stays deterministic and snapshot-friendly.
  phases: Object.freeze([
   Object.freeze({phase:1,name:'WARDEN',speedMult:1,damageMult:1,stomp:Object.freeze({radius:6.5,damage:28,telegraph:1.1,cooldown:7,minRange:0,maxRange:15})}),
   Object.freeze({phase:2,name:'OVERCLOCKED',speedMult:1.12,damageMult:1.2,stomp:Object.freeze({radius:7.5,damage:38,telegraph:.95,cooldown:5.5,minRange:0,maxRange:17})}),
   Object.freeze({phase:3,name:'LEGION',speedMult:1.28,damageMult:1.45,stomp:Object.freeze({radius:9,damage:50,telegraph:.8,cooldown:4.2,minRange:0,maxRange:19})}),
  ]),
 }),
 mender: Object.freeze({
  id:'mender', name:'Mender', role:'SUPPORT',
  health:55, armor:10, speedMult:.86, damageMult:.25,
  kind:'ranged', range:[11,22], hold:.8, aggression:.22, leash:16,
  scan:26, scale:.86, color:'#7dffa8', accent:'#0d3a1c', points:2,
  character:'gemini', harness:'openclaw',
  support:Object.freeze({radius:9, heal:8, interval:2.6, damageBonus:.15, telegraph:.7, cooldown:2.6}),
 }),
 sapper: Object.freeze({
  id:'sapper', name:'Sapper', role:'SABOTEUR',
  health:40, armor:0, speedMult:1.5, damageMult:.5,
  kind:'swarmer', meleeOnly:true, meleeRange:2.6, meleeDamage:12,
  range:[1.2,2.6], hold:0, aggression:1, leash:13,
  scan:20, scale:.78, color:'#ff7a45', accent:'#3a1607', points:2,
  character:'mistral', harness:'openclaw',
  sapper:Object.freeze({radius:5.5, damage:72, fuse:.8, trigger:3.4, telegraph:.8, cooldown:1.2}),
 }),
 overseer: Object.freeze({
  id:'overseer', name:'Overseer', role:'LEADER',
  health:90, armor:25, speedMult:.8, damageMult:.45,
  kind:'ranged', range:[10,24], hold:.6, aggression:.5, leash:22,
  scan:32, scale:1.08, color:'#ffd166', accent:'#3a2a07', points:4,
  character:'qwen', harness:'openclaw',
  leader:Object.freeze({radius:12, damageBonus:.3, speedBonus:.12, interval:4, cooldown:4, telegraph:.6}),
 }),
 // Armoured breacher: a slow, high-armour shock unit whose front plate eats
 // fire. Players must break the shield by shooting from behind, so the fight is
 // about angles rather than raw damage. Deterministic, no per-frame state.
 bulwark: Object.freeze({
  id:'bulwark', name:'Bulwark', role:'TANK',
  health:230, armor:85, speedMult:.5, damageMult:.6,
  kind:'heavy', range:[5,13], hold:.68, aggression:.86, leash:15,
  scan:24, scale:1.5, color:'#5ad1ff', accent:'#0a2a3a', points:5,
  character:'kimi', harness:'openclaw',
  shield:Object.freeze({arc:.6, reduction:.7, flankBonus:1.4, front:.35}),
 }),
 // Siege battery: a fragile, slow artillery piece that lobs a telegraphed AoE
 // at the player's last known position. It hangs far back and punishes a static
 // defence, so it must be pushed rather than out-shot.
 mortar: Object.freeze({
  id:'mortar', name:'Mortar', role:'ARTILLERY',
  health:70, armor:15, speedMult:.72, damageMult:.4,
  kind:'ranged', range:[22,42], hold:.9, aggression:.28, leash:24,
  scan:36, scale:1.15, color:'#c98bff', accent:'#241040', points:3,
  character:'claude', harness:'openclaw',
  artillery:Object.freeze({radius:5.5, damage:36, telegraph:1.2, cooldown:5.5, interval:5.5, minRange:9, maxRange:46}),
 }),
});
// The zone vocabulary shared by the campaign authoring side and the bot brain.
// `spawn` is soft (a group may break its leash to chase a nearby player), while
// `patrol` and `hold` are hard: the actor is never allowed to leave its leash.
export const NPC_ZONE_KINDS = Object.freeze(['spawn','patrol','hold']);
// Every enemy carries a default leash for places that spawn it with a location
// but no explicit radius. Ranged and boss classes are allowed a longer tether.
export const enemyLeash = typeOrId => {
 const type = typeof typeOrId === 'string' ? enemyById(typeOrId) : typeOrId;
 return Number.isFinite(type?.leash) ? type.leash : 12;
};
// Every enemy rolls a small speed spread on deploy, so a wave is never a
// uniform herd: some rush, some lag. Health stays fixed for predictability.
export const ENEMY_SPEED_VARIANCE = .22;
export const ENEMY_TYPE_IDS = Object.keys(ENEMY_TYPES);
export const DEFAULT_ENEMY_ID = 'spitter';
export const enemyById = id => ENEMY_TYPES[id] || ENEMY_TYPES[DEFAULT_ENEMY_ID];
// Boss phases are authored on the enemy class; the campaign drives the counter
// (`bossPhase`) and the runtime resolves the matching stat/attack overlay. A
// non-boss or a boss without phases resolves to null so callers can skip cheaply.
export const isBossType = typeOrId => {
 const type = typeof typeOrId === 'string' ? enemyById(typeOrId) : typeOrId;
 return type?.boss === true;
};
export const bossMaxPhase = typeOrId => {
 const type = typeof typeOrId === 'string' ? enemyById(typeOrId) : typeOrId;
 return Array.isArray(type?.phases) && type.phases.length ? type.phases.length : 1;
};
export const bossPhaseProfile = (typeOrId, phase = 1) => {
 const type = typeof typeOrId === 'string' ? enemyById(typeOrId) : typeOrId;
 if (type?.boss !== true || !Array.isArray(type.phases) || !type.phases.length) return null;
 const index = Math.min(type.phases.length - 1, Math.max(0, Math.round(Number(phase) || 1) - 1));
 return type.phases[index] || type.phases[0];
};

// Mutates an actor into a specific enemy class. Call BEFORE match.spawn so the
// profile survives every respawn (the player is the only actor that respawns in
// single player, but this keeps the contract honest).
export function applyEnemyFields(actor, typeOrId){
 const type=typeof typeOrId==='string'?enemyById(typeOrId):typeOrId;
 actor.npcType=type.id;actor.name=type.name;actor.enemyRole=type.role;
 actor.npcProfile={health:type.health,armor:type.armor,speedMult:type.speedMult,damageMult:type.damageMult,scale:type.scale,color:type.color,accent:type.accent,points:type.points};
 if(type.meleeOnly===true)actor.meleeDamage=type.meleeDamage;
 if(type.boss===true){actor.isBoss=true;actor.bossPhase=1;actor.bossPhaseMax=bossMaxPhase(type);}
 if(Number.isFinite(type.scan))actor.botScan=type.scan;
 if(type.support)actor.npcSupport={...type.support};
 if(type.sapper)actor.npcSapper={...type.sapper};
 if(type.leader)actor.npcLeader={...type.leader};
 if(type.shield)actor.npcShield={...type.shield};
 if(type.artillery)actor.npcArtillery={...type.artillery};
 return actor;
}

// True when an enemy class carries a role ability (aura/detonation) that the
// single-player runtime ticks each frame.
export const hasEnemyRole = typeOrId => {
 const type=typeof typeOrId==='string'?enemyById(typeOrId):typeOrId;
 return Boolean(type?.support||type?.sapper||type?.leader||type?.shield||type?.artillery);
};

// Shape-compatible with botBehavior(): start from the normal brain and override
// only the knobs that make an enemy class feel different.
export function enemyBehavior(actor){
 const base=botBehavior(actor), type=enemyById(actor.npcType);
 const close=type.kind==='swarmer'||Boolean(type.sapper);
 return Object.freeze({...base,
  kind:type.kind, role:type.role, meleeOnly:type.meleeOnly===true, meleeRange:type.meleeRange??2.2,
  range:type.range, aggression:type.aggression, hold:type.hold,
  scan:Number.isFinite(type.scan)?type.scan:base.scan,
  leash:Number.isFinite(type.leash)?type.leash:base.leash,
  support:Boolean(type.support), sapper:Boolean(type.sapper), leader:Boolean(type.leader),
  shield:Boolean(type.shield), artillery:Boolean(type.artillery),
  weaponBand:close?'close':type.kind==='heavy'?'mid':'long',
  engageBand:close?[1.2,2.4]:type.artillery?[Math.max(18,type.range[0]-2),Math.min(type.range[1],40)]:type.kind==='heavy'?[6,14]:[14,26],
  spacing:type.artillery?Math.max(base.spacing??2.4,3.4):base.spacing,
  thinkScale:close?(base.thinkScale??1)*.7:type.leader?(base.thinkScale??1)*.9:base.thinkScale,
  retreat:type.support?Math.max(base.retreat??.4,.7):base.retreat,
 });
}
