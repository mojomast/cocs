// LATTICE STRIKE (`cocs`) battle economy: traversal, objective-first scoring,
// personal REQUISITION (`REQ`), the anti-grief NEGLECT meter, the gear/REQ cap
// seam and the `COMMENDATIONS` conversion. Spec authority:
// docs/design/COCS-MODE-SPEC.md §3, §6.5–6.6, §6A and §9.
//
// Pure, deterministic and **id-free**: every table is frozen, every helper is a
// function of its arguments, and no operator/harness/spec id ever appears in
// logic. `game/cocs-economy.test.mjs` pins the numbers; W1 owns `cocs.mjs` and
// the mode registry and wires these helpers in.
import {GEAR_CAPS, resolveGear} from './progression.mjs';

export {GEAR_CAPS};

const clamp=(value,min,max)=>Math.max(min,Math.min(max,Number.isFinite(Number(value))?Number(value):min));
const num=(value,fallback=0)=>{const n=Number(value);return Number.isFinite(n)?n:fallback;};
const count=value=>Math.max(0,Math.floor(num(value,0)));
const round=(value,places=3)=>{const scale=10**places;return Math.round(num(value,0)*scale)/scale;};

/** Deep-freeze a table (objects + arrays) so callers cannot mutate shared data. */
export function deepFreeze(value){
 if(!value||typeof value!=='object')return value;
 if(Object.isFrozen(value))return value;
 for(const entry of Object.values(value))deepFreeze(entry);
 return Object.freeze(value);
}

// ===========================================================================
// §6A.4 / §9.1 Objective-first scoring
// ===========================================================================
// The one number is objective points (`OP`). `teamScores[team]` is `OP`; kills
// are a small tempo term. Node-seconds are weighted by archetype.
export const ARCHETYPE_WEIGHTS=deepFreeze({front:1.0,economy:1.2,array:1.5});
export const NODE_SECONDS_PERSONAL_SHARE=0.4; // personal OP = 0.4 × weight /s
export const HOLD_REQ_PER_SECOND=0.25;        // REQ presence drip, per player in radius

// Fixed-cost events. `hold`, `cut` and `order` are parameterised below.
export const SCORE_EVENTS=deepFreeze({
 capture:{teamOP:25,personalOP:10,req:8},
 neutralize:{teamOP:10,personalOP:5,req:4},
 prime:{teamOP:15,personalOP:8,req:10},
 killPlayer:{teamOP:3,personalOP:3,req:1},
 killSubagent:{teamOP:2,personalOP:2,req:1},
 assist:{teamOP:1,personalOP:1,req:0},
});

export const SUPPLY_CUT=deepFreeze({teamBase:20,teamPerDenied:5,personalOP:8,req:6});
export const ORDER_REWARD=deepFreeze({
 teamOP:20,
 issuerPersonalOP:10,
 contributorPersonalOP:5,
 reqPerContributor:15,
 contributorCap:6,
});
export const ARRAY_CAPTURE=deepFreeze({teamOP:'win',personalOP:50,req:30,decisive:true});
export const ARRAY_WIN='win';

const ARCHETYPE_ALIASES=deepFreeze({
 front:'front',frontline:'front',fort:'front',
 economy:'economy',siphon:'economy',extractor:'economy',
 array:'array','array-relay':'array',relay:'array',uplink:'array',
});

/** Normalise an archetype label to `front | economy | array`, or null. */
export function archetypeKey(archetype){
 if(typeof archetype!=='string')return null;
 const key=ARCHETYPE_ALIASES[archetype.trim().toLowerCase()];
 return key||null;
}

/** §9.1 archetype node-seconds weight (`front 1.0`, `economy 1.2`, `array 1.5`). */
export function archetypeWeight(archetype){
 const key=archetypeKey(archetype);
 return key?ARCHETYPE_WEIGHTS[key]:0;
}

const EVENT_ALIASES=deepFreeze({
 hold:'hold','node-seconds':'hold',nodeseconds:'hold',nodes:'hold',
 capture:'capture',neutralize:'neutralize',neutralise:'neutralize',
 prime:'prime','prime-complete':'prime',
 cut:'cut','supply-cut':'cut',supplycut:'cut',
 order:'order','order-complete':'order',ordercomplete:'order',
 kill:'killPlayer','kill-player':'killPlayer',killplayer:'killPlayer',
 'kill-subagent':'killSubagent',killsubagent:'killSubagent',subagent:'killSubagent',
 assist:'assist',
 array:'array','array-capture':'array',arraycapture:'array',
});

/** Normalise an event label to a canonical score kind, or null. */
export function scoreKind(kind){
 if(typeof kind!=='string')return null;
 return EVENT_ALIASES[kind.trim().toLowerCase()]||null;
}

/**
 * Score one event from one actor's perspective.
 *
 * `event.kind`:
 *  - `hold`  — `{archetype, seconds, holders?}` → weighted node-seconds.
 *  - `cut`   — `{deniedNodes}` → `20 + 5×denied`.
 *  - `order` — `{role:'issuer'|'contributor'}` → issuer +10 personal OP,
 *              contributor +5; +15 REQ to each; contributor payout capped at 6.
 *  - fixed kinds: `capture, neutralize, prime, killPlayer, killSubagent, assist`.
 *  - `array` — decisive capture; `teamOP` is the string `'win'`.
 *
 * @returns {{kind:string|null,teamOP:number|string,personalOP:number,req:number,win:boolean}}
 */
export function scoreEvent(event={}){
 const kind=scoreKind(event&&event.kind!=null?event.kind:event&&event.type);
 if(kind==='hold'){
  const weight=archetypeWeight(event.archetype);
  const seconds=Math.max(0,num(event.seconds,0));
  const holders=Math.max(1,count(event.holders)||1);
  return deepFreeze({
   kind,teamOP:round(weight*seconds),personalOP:round(NODE_SECONDS_PERSONAL_SHARE*weight*seconds/holders),
   req:round(HOLD_REQ_PER_SECOND*seconds),win:false,
  });
 }
 if(kind==='cut'){
  const denied=count(event.deniedNodes);
  return deepFreeze({
   kind,teamOP:SUPPLY_CUT.teamBase+SUPPLY_CUT.teamPerDenied*denied,
   personalOP:SUPPLY_CUT.personalOP,req:SUPPLY_CUT.req,win:false,
  });
 }
 if(kind==='order'){
  const issuer=event.role==='issuer'||event.issuer===true;
  return deepFreeze({
   kind,teamOP:ORDER_REWARD.teamOP,
   personalOP:issuer?ORDER_REWARD.issuerPersonalOP:ORDER_REWARD.contributorPersonalOP,
   req:ORDER_REWARD.reqPerContributor,win:false,
  });
 }
 if(kind==='array'){
  return deepFreeze({kind,teamOP:ARRAY_CAPTURE.teamOP,personalOP:ARRAY_CAPTURE.personalOP,req:ARRAY_CAPTURE.req,win:true});
 }
 const base=SCORE_EVENTS[kind];
 if(!base)return deepFreeze({kind:null,teamOP:0,personalOP:0,req:0,win:false});
 return deepFreeze({kind,teamOP:base.teamOP,personalOP:base.personalOP,req:base.req,win:false});
}

/** Sum a list of scored events. `teamOP` skips the decisive Array win term. */
export function tallyScores(events=[]){
 let teamOP=0,personalOP=0,req=0;
 for(const event of Array.isArray(events)?events:[]){
  const score=scoreEvent(event);
  if(typeof score.teamOP==='number')teamOP+=score.teamOP;
  personalOP+=score.personalOP;req+=score.req;
 }
 return deepFreeze({teamOP:round(teamOP),personalOP:round(personalOP),req:round(req)});
}

// ===========================================================================
// §6A.5 Personal REQUISITION (`REQ`)
// ===========================================================================
export const REQ_EARN=deepFreeze({
 objectivePresencePerSecond:0.25,
 capture:8,
 neutralize:4,
 prime:10,
 supplyCut:6,
 orderContributor:15,
 playerKill:1,
 assist:0,
});

/**
 * `REQ` earned by one player in one match.
 * @param {{objectiveSeconds?:number,captures?:number,neutralizes?:number,primes?:number,cuts?:number,orders?:number,playerKills?:number,assists?:number}} [profile]
 */
export function reqEarn(profile={}){
 return reqEarnBreakdown(profile).total;
}

/** `REQ` earn with the per-source breakdown, so the deployment menu can show it. */
export function reqEarnBreakdown(profile={}){
 const p=profile&&typeof profile==='object'?profile:{};
 const objectiveSeconds=Math.max(0,num(p.objectiveSeconds,0));
 const parts=deepFreeze({
  objectivePresence:round(objectiveSeconds*REQ_EARN.objectivePresencePerSecond),
  capture:count(p.captures)*REQ_EARN.capture,
  neutralize:count(p.neutralizes)*REQ_EARN.neutralize,
  prime:count(p.primes)*REQ_EARN.prime,
  supplyCut:count(p.cuts)*REQ_EARN.supplyCut,
  order:count(p.orders)*REQ_EARN.orderContributor,
  playerKill:count(p.playerKills)*REQ_EARN.playerKill,
  assist:count(p.assists)*REQ_EARN.assist,
 });
 const total=round(Object.values(parts).reduce((sum,value)=>sum+value,0));
 return deepFreeze({total,objectiveSeconds,parts});
}

// §6A.5 launch list. `launch:false` items are the later V1/V1.5 column.
export const REQ_ITEMS=deepFreeze([
 {id:'field-repair',name:'Field Repair',category:'buff',cost:40,launch:true,teamWide:false,personalBuff:true},
 {id:'ammo-crate',name:'Ammo Crate',category:'buff',cost:25,launch:true,teamWide:false,personalBuff:true},
 {id:'haste',name:'Haste',category:'buff',cost:35,launch:true,teamWide:false,personalBuff:true},
 {id:'overshield',name:'Overshield',category:'buff',cost:50,launch:true,teamWide:false,personalBuff:true},
 {id:'at-mine',name:'AT Mine',category:'equipment',cost:35,launch:true,teamWide:false,personalBuff:false},
 {id:'smoke',name:'Smoke Marker',category:'equipment',cost:20,launch:true,teamWide:false,personalBuff:false},
 {id:'repair-tool',name:'Repair Tool',category:'equipment',cost:30,launch:true,teamWide:false,personalBuff:false},
 {id:'spot-drone',name:'Spot Drone',category:'equipment',cost:45,launch:true,teamWide:false,personalBuff:false},
 {id:'barrier',name:'Barrier',category:'fortification',cost:30,launch:true,teamWide:false,personalBuff:false},
 {id:'sentry',name:'Sentry',category:'fortification',cost:60,launch:true,teamWide:false,personalBuff:false},
 {id:'forward-depot',name:'Forward Depot',category:'fortification',cost:120,launch:true,teamWide:false,personalBuff:false},
 {id:'supply-drop',name:'Supply Drop',category:'team',cost:80,launch:true,teamWide:true,personalBuff:false,commanderOnly:true},
 {id:'recon-pulse',name:'Recon Pulse',category:'team',cost:60,launch:true,teamWide:true,personalBuff:false,commanderOnly:true},
 {id:'fortify-doctrine',name:'Fortify Doctrine',category:'team',cost:100,launch:true,teamWide:true,personalBuff:false,commanderOnly:true},
 {id:'puma',name:'Puma Light Transport',category:'vehicle',cost:150,launch:false,teamWide:false,personalBuff:false},
 {id:'tier-upgrade',name:'Agent Tier Upgrade',category:'agent',cost:25,launch:false,teamWide:false,personalBuff:false},
 {id:'oracle-unlock',name:'Oracle Unlock',category:'agent',cost:120,launch:false,teamWide:false,personalBuff:false,requiresRelay:true},
]);

export const REQ_COSTS=deepFreeze(Object.fromEntries(REQ_ITEMS.map(item=>[item.id,item.cost])));
export const PERSONAL_BUFF_IDS=deepFreeze(REQ_ITEMS.filter(item=>item.personalBuff).map(item=>item.id));
export const TEAM_WIDE_REQ_IDS=deepFreeze(REQ_ITEMS.filter(item=>item.teamWide).map(item=>item.id));
export const LAUNCH_REQ_IDS=deepFreeze(REQ_ITEMS.filter(item=>item.launch).map(item=>item.id));

// Hard firewall: `REQ` is personal and may never buy a respawn, debit the team
// `RESERVE` budget, or create team `FLUX`. §6.2 / §6A.5 / §6A.8.
export const REQ_FORBIDDEN=deepFreeze(['respawn','reserve','respawn-ticket','team-flux','flux']);

/** Cost of a `REQ` item, or null when the id is unknown. */
export function purchaseCost(id){
 return Object.hasOwn(REQ_COSTS,id)?REQ_COSTS[id]:null;
}

/** The item descriptor for a `REQ` id, or null. */
export function reqItem(id){
 const found=REQ_ITEMS.find(item=>item.id===id);
 return found?{...found}:null;
}

/**
 * Validate a `REQ` purchase against the §6A.5 rules. Pure; callers own state.
 * @param {string} itemId
 * @param {{balance?:number,isCommander?:boolean,activeBuffId?:string|null,relayOwned?:boolean}} [state]
 * @returns {{ok:boolean,itemId:string,cost:number|null,balanceAfter:number,reason:string|null}}
 */
export function reqPurchase(itemId,state={}){
 const item=reqItem(itemId);
 const balance=Math.max(0,num(state.balance,0));
 if(!item)return deepFreeze({ok:false,itemId,cost:null,balanceAfter:balance,reason:'unknown-item'});
 if(item.commanderOnly===true&&state.isCommander!==true){
  return deepFreeze({ok:false,itemId,cost:item.cost,balanceAfter:balance,reason:'commander-only'});
 }
 if(item.personalBuff===true&&typeof state.activeBuffId==='string'&&state.activeBuffId&&state.activeBuffId!==itemId){
  return deepFreeze({ok:false,itemId,cost:item.cost,balanceAfter:balance,reason:'one-active-buff'});
 }
 if(item.requiresRelay===true&&state.relayOwned!==true){
  return deepFreeze({ok:false,itemId,cost:item.cost,balanceAfter:balance,reason:'requires-relay'});
 }
 if(balance<item.cost)return deepFreeze({ok:false,itemId,cost:item.cost,balanceAfter:balance,reason:'insufficient-req'});
 return deepFreeze({ok:true,itemId,cost:item.cost,balanceAfter:balance-item.cost,reason:null});
}

/** True when a purchase id is outside the `REQ` catalogue entirely. */
export function isReqForbidden(id){
 return REQ_FORBIDDEN.includes(String(id||'').trim().toLowerCase());
}

// ===========================================================================
// §6A.6 NEGLECT — the anti-grief team meter
// ===========================================================================
export const NEGLECT=deepFreeze({
 max:100,
 graceSeconds:45,
 risePerSecond:1,
 contributionFallPerSecond:2,
 resetSeconds:30,
 reissueCooldownSeconds:60,
 degradeThreshold:50,
 capThreshold:75,
 degradePenalty:0.1,
 capPenalty:0.2,
});
export const NEGLECT_EFFECTS=deepFreeze({
 none:1,
 degrade:1-NEGLECT.degradePenalty,
 cap:1-NEGLECT.capPenalty,
});

/** Fresh NEGLECT state. */
export function neglectState(){
 return deepFreeze({value:0,activeSeconds:0,resetSeconds:0,resetFrom:0,contributing:false});
}

function normalizeNeglect(state){
 const s=state&&typeof state==='object'?state:{};
 return {
  value:clamp(s.value,0,NEGLECT.max),
  activeSeconds:Math.max(0,num(s.activeSeconds,0)),
  resetSeconds:Math.max(0,num(s.resetSeconds,0)),
  resetFrom:clamp(s.resetFrom,0,NEGLECT.max),
 };
}

/**
 * Advance the team `NEGLECT` meter one fixed step.
 *
 * ctx: `{humanCommander,activeOrder,contributed?,completed?,expired?,cancelled?}`.
 *  - zero without a seated human commander (bot/Chief-only matches never punish);
 *  - +1/s only while an order is active, after the 45 s grace;
 *  - −2/s whenever a contributor touches the order;
 *  - resets to 0 within 30 s of completion/expiry/cancel (or no active order).
 */
export function neglectTick(state,dt,ctx={}){
 const step=Math.max(0,num(dt,0));
 const s=normalizeNeglect(state);
 if(!(step>0))return deepFreeze({...s,contributing:ctx.contributed===true});
 if(ctx.humanCommander!==true)return neglectState();
 const active=ctx.activeOrder===true;
 const ended=ctx.completed===true||ctx.expired===true||ctx.cancelled===true;
 let {value,activeSeconds,resetSeconds,resetFrom}=s;
 const contributing=ctx.contributed===true;
 if(active&&!ended){
  activeSeconds+=step;
  if(contributing){
   value=Math.max(0,value-NEGLECT.contributionFallPerSecond*step);
  }else if(resetSeconds<=0&&activeSeconds>NEGLECT.graceSeconds){
   value=Math.min(NEGLECT.max,value+NEGLECT.risePerSecond*step);
  }
 }
 if(ended||!active||resetSeconds>0){
  if(resetSeconds<=0&&value<=0)return deepFreeze({value:0,activeSeconds:0,resetSeconds:0,resetFrom:0,contributing});
  const entering=resetSeconds<=0;
  const from=entering?value:resetFrom;
  const next=Math.max(0,(entering?NEGLECT.resetSeconds:resetSeconds)-step);
  value=next<=0?0:from*(next/NEGLECT.resetSeconds);
  resetSeconds=next;resetFrom=from;
  if(entering)activeSeconds=0;
 }
 return deepFreeze({value,activeSeconds,resetSeconds,resetFrom,contributing});
}

/**
 * The current NEGLECT effect. Non-stacking: the threshold is a max, not a sum.
 * Only the passive `+1/s` `FLUX` term is multiplied.
 */
export function neglectEffect(state){
 const s=normalizeNeglect(state);
 if(s.value>=NEGLECT.capThreshold){
  return deepFreeze({value:s.value,multiplier:NEGLECT_EFFECTS.cap,reduction:NEGLECT.capPenalty,tier:'cap',capped:true,timeLimited:true});
 }
 if(s.value>=NEGLECT.degradeThreshold){
  return deepFreeze({value:s.value,multiplier:NEGLECT_EFFECTS.degrade,reduction:NEGLECT.degradePenalty,tier:'degrade',capped:false,timeLimited:true});
 }
 return deepFreeze({value:s.value,multiplier:NEGLECT_EFFECTS.none,reduction:0,tier:'none',capped:false,timeLimited:true});
}

/** Apply NEGLECT to the passive income term only; node income is untouched. */
export function neglectPassiveFlux(passiveRate,state){
 return round(Math.max(0,num(passiveRate,0))*neglectEffect(state).multiplier);
}

// ===========================================================================
// §6A.8 Gear → REQ → combined cap seam
// ===========================================================================
// GEAR_CAPS is re-exported from progression.mjs (one source of truth).
export const REQ_CAPS=deepFreeze({offense:1.05,mobility:1.06,ehp:8,spread:0.94});
export const COMBINED_CAPS=deepFreeze({offense:1.20,mobility:1.16,ehp:23,spread:0.79});

function poolEhp(health,armor,cap){
 const total=health+armor;
 if(!(total>cap))return {health:round(health),armor:round(armor)};
 const scale=cap/total;let h=round(health*scale),a=round(armor*scale);
 const drift=round(h+a-cap);
 if(drift>0){if(a>=h)a=round(Math.max(0,a-drift));else h=round(Math.max(0,h-drift));}
 return {health:h,armor:a};
}

function gearModifiers(value){
 if(!value)return null;
 if(value.modifiers&&typeof value.modifiers==='object')return value.modifiers;
 return typeof value==='object'?value:null;
}

/**
 * Compose resolved gear (from `resolveGear`) with `REQ` modifiers and clamp the
 * result to `COMBINED_CAPS`. Gear runs first, `REQ` second; the combined clamp
 * is asserted last so no caller can bypass it. Modifier shape matches
 * `resolveGear`: `{health,armor,speed,damage,spread}` where speed/damage/spread
 * are multipliers and health/armor are flat pools.
 *
 * @returns {{modifiers:object,clamped:object}}
 */
export function composeCaps(gear,req={}){
 const g=gearModifiers(gear)||{};
 const r=req&&typeof req==='object'?req:{};
 const modifiers={
  health:num(g.health,0)+num(r.health,0),
  armor:num(g.armor,0)+num(r.armor,0),
  speed:num(g.speed,1)*num(r.speed,1),
  damage:num(g.damage,1)*num(r.damage,1),
  spread:num(g.spread,1)*num(r.spread,1),
 };
 modifiers.speed=Math.min(modifiers.speed,COMBINED_CAPS.mobility);
 modifiers.damage=Math.min(modifiers.damage,COMBINED_CAPS.offense);
 modifiers.spread=Math.max(modifiers.spread,COMBINED_CAPS.spread);
 modifiers.health=Math.max(0,modifiers.health);
 modifiers.armor=Math.max(0,modifiers.armor);
 const pooled=poolEhp(modifiers.health,modifiers.armor,COMBINED_CAPS.ehp);
 modifiers.health=pooled.health;modifiers.armor=pooled.armor;
 const clamped=deepFreeze({
  offense:round(modifiers.damage)<=COMBINED_CAPS.offense,
  mobility:round(modifiers.speed)<=COMBINED_CAPS.mobility,
  ehp:round(modifiers.health+modifiers.armor)<=COMBINED_CAPS.ehp,
  spread:round(modifiers.spread)>=COMBINED_CAPS.spread,
 });
 return deepFreeze({modifiers:deepFreeze({...modifiers}),clamped});
}

/** True when a resolved modifier set already sits inside `COMBINED_CAPS`. */
export function withinCombinedCaps(modifiers){
 if(!modifiers||typeof modifiers!=='object')return true;
 return num(modifiers.damage,1)<=COMBINED_CAPS.offense
  &&num(modifiers.speed,1)<=COMBINED_CAPS.mobility
  &&num(modifiers.health,0)+num(modifiers.armor,0)<=COMBINED_CAPS.ehp
  &&num(modifiers.spread,1)>=COMBINED_CAPS.spread;
}

/**
 * The spawn-loadout seam: resolve persistent gear ids first, then layer `REQ`
 * modifiers and clamp to `COMBINED_CAPS`. `movement.mjs`/weapon spread read the
 * returned `modifiers` (the combined `gearSpeed`/`gearSpread` values).
 */
export function resolveSpawnLoadout(gearIds,reqModifiers={}){
 const resolved=resolveGear(gearIds);
 return deepFreeze({gear:resolved.items,...composeCaps(resolved.modifiers,reqModifiers)});
}

// ===========================================================================
// §6A.1–6A.3 Traversal toolkit, lane identity and validators
// ===========================================================================
export const TRAVERSAL_KINDS=deepFreeze(['zipline','jump-pad','launcher','teleporter','depot']);

const KIND_ALIASES=deepFreeze({
 zipline:'zipline','zip-line':'zipline',
 pad:'jump-pad',trampoline:'jump-pad','jump-pad':'jump-pad',jumppad:'jump-pad',
 launcher:'launcher','boost-launcher':'launcher','boost-pad':'launcher',launchpad:'launcher',
 teleporter:'teleporter',teleport:'teleporter',
 depot:'depot','forward-depot':'depot',
});

/** Normalise a traversal device kind to its canonical id, or null. */
export function traversalKind(kind){
 if(typeof kind!=='string')return null;
 return KIND_ALIASES[kind.trim().toLowerCase()]||null;
}

// Shared, neutral-device parameters from §6A.1. Per-actor 2.5 s cooldown is
// shared across every device type, so no launcher→zipline→pad chain exists.
export const DEVICE_PARAMS=deepFreeze({
 zipline:{kind:'zipline',onFootOnly:true,vehiclesAllowed:false,cuttable:true,lockable:false,cutSeconds:45,cutChannelSeconds:3,repairSeconds:6,sharedCooldown:2.5,speed:9,arrivalProtection:true},
 'jump-pad':{kind:'jump-pad',onFootOnly:true,vehiclesAllowed:false,cuttable:true,lockable:true,cutSeconds:45,lockSeconds:30,lockChannelSeconds:2.5,repairSeconds:4,sharedCooldown:2.5,speed:null,arrivalProtection:false},
 launcher:{kind:'launcher',onFootOnly:true,vehiclesAllowed:false,cuttable:true,lockable:true,cutSeconds:45,lockSeconds:30,lockChannelSeconds:2.5,repairSeconds:4,sharedCooldown:2.5,targetLocked:true,arrivalProtection:true},
 teleporter:{kind:'teleporter',onFootOnly:true,vehiclesAllowed:false,cuttable:true,lockable:true,cutSeconds:45,lockSeconds:30,lockChannelSeconds:2.5,repairSeconds:4,cooldown:1,sharedCooldown:2.5,arrivalProtection:true},
 depot:{kind:'depot',onFootOnly:false,vehiclesAllowed:true,capturable:true,captureSeconds:10,apronMeters:6,apronOwnerOnly:true,vehicleRespawnSeconds:25,vehicleSpawnImmunitySeconds:3,minExits:2,refundRate:0.5,nodeClearanceMeters:30,chokepointClearanceMeters:12,lostDepotStopsSpawn:true},
});

export const TRAVERSAL=deepFreeze({
 sharedCooldown:2.5,
 cutSeconds:45,
 cutChannelSeconds:3,
 repairSeconds:6,
 lockSeconds:30,
 padRepairSeconds:4,
 arrivalSeconds:1.5,
 arrivalDamageReduction:0.5,
 arrivalTelegraph:true,
 arrivalMinRadius:5,
 enemySpawnClearanceMeters:15,
 anchorReachMeters:0.9,
 anchorContestMeters:6,
 cutScoreCooldownSeconds:60,
 bypassMin:0.34,
 bypassMax:0.75,
 depotApronMeters:6,
 depotVehicleImmunitySeconds:3,
 depotCaptureSeconds:10,
 depotRespawnSeconds:25,
 vehicleDespawnWarningSeconds:15,
 vehicleDespawnSeconds:45,
 ziplineSpeed:9,
 teleporterDefaultCooldown:1,
 transportSeats:4,
 transportHp:300,
 transportSpeed:20,
 transportBoost:26,
 travelMedianSeconds:30,
 travelP90Seconds:45,
 firstContactSeconds:45,
});

export const DEVICE_STATES=deepFreeze(['live','cut','locked']);

// §6A.2 Three lanes, three fixed traversal identities. The set is closed at
// three: `vehicle-road` (North), `cqc` (Centre), `zipline-flank` (South).
export const LANE_IDENTITIES=deepFreeze([
 {id:'north',name:'North',identity:'vehicle-road',traversalKind:'vehicle-road',vehicles:true,primary:'transport-road',secondary:'launcher',chokepoints:2,landmark:'gantry',counterplay:['at-mine','road-chokepoint','launcher-lock']},
 {id:'centre',name:'Centre',identity:'cqc',traversalKind:'cqc',vehicles:false,primary:'teleporter',secondary:'trampoline',chokepoints:2,landmark:'foundry-chimney',counterplay:['grenade','suppression','barrier']},
 {id:'south',name:'South',identity:'zipline-flank',traversalKind:'zipline-flank',vehicles:false,primary:'zipline',secondary:'jump-pad',chokepoints:1,landmark:'relay-spire',counterplay:['cut-line','hold-arrival','overwatch-terrace']},
]);
export const LANE_IDENTITY_KINDS=deepFreeze(['vehicle-road','cqc','zipline-flank']);

/** Arrival-protection state applied once on device arrival. */
export function arrivalProtection(){
 return deepFreeze({active:true,remaining:TRAVERSAL.arrivalSeconds,damageReduction:TRAVERSAL.arrivalDamageReduction,telegraph:TRAVERSAL.arrivalTelegraph});
}

/** Tick arrival protection down; returns inert state once it expires. */
export function tickArrival(state,dt){
 const remaining=Math.max(0,num(state&&state.remaining,TRAVERSAL.arrivalSeconds)-Math.max(0,num(dt,0)));
 if(!(remaining>0))return deepFreeze({active:false,remaining:0,damageReduction:0,telegraph:false});
 return deepFreeze({active:true,remaining,damageReduction:TRAVERSAL.arrivalDamageReduction,telegraph:TRAVERSAL.arrivalTelegraph});
}

/** True when an actor's shared traversal cooldown has elapsed. */
export function canTraverse(cooldownRemaining){
 return num(cooldownRemaining,0)<=0;
}

const anchorOk=anchor=>anchor&&typeof anchor==='object'&&Number.isFinite(num(anchor.x,NaN))&&Number.isFinite(num(anchor.z,NaN));

/**
 * Validate a traversal device against §6A.1/§6A.2.1. Pure; returns
 * `{ok,kind,errors[]}`. Depot entries use `{kind:'depot',hq?,exits,...}`.
 */
export function validateTraversal(device){
 const errors=[];
 if(!device||typeof device!=='object'){
  return deepFreeze({ok:false,kind:null,errors:['device must be an object']});
 }
 const kind=traversalKind(device.kind);
 if(!kind)errors.push('unknown kind');
 if(typeof device.id!=='string'||!device.id.trim())errors.push('id required');
 if(device.arrival!=null){
  const arrival=device.arrival;
  if(!anchorOk(arrival))errors.push('arrival needs {x,z}');
  else{
   if(num(arrival.r,0)<TRAVERSAL.arrivalMinRadius)errors.push('arrival.r must be >= 5');
   if(num(arrival.seconds,0)<1)errors.push('arrival.seconds must be >= 1.0');
   if(Number.isFinite(num(arrival.enemySpawnDistanceMeters,NaN))&&arrival.enemySpawnDistanceMeters<TRAVERSAL.enemySpawnClearanceMeters){
    errors.push('arrival must be >= 15 m from enemy spawns');
   }
  }
 }
 const cuttable=device.cuttable===true,lockable=device.lockable===true;
 if(kind==='zipline'){
  if(!anchorOk(device.from)||!anchorOk(device.to))errors.push('zipline needs from and to anchors');
  if(!cuttable)errors.push('zipline must be cuttable');
  if(!(num(device.speed,DEVICE_PARAMS.zipline.speed)>0))errors.push('zipline speed must be > 0');
  if(device.vehiclesAllowed===true)errors.push('vehicles cannot use ziplines');
 }else if(kind==='jump-pad'){
  if(!(num(device.power,0)>0))errors.push('jump-pad power must be > 0');
  if(!lockable&&!cuttable)errors.push('jump-pad must be cuttable or lockable');
  if(device.vehiclesAllowed===true)errors.push('vehicles cannot use jump pads');
 }else if(kind==='launcher'){
  if(!anchorOk(device.to)&&!anchorOk(device.target))errors.push('launcher needs a target');
  if(!lockable&&!cuttable)errors.push('launcher must be cuttable or lockable');
  if(device.vehiclesAllowed===true)errors.push('vehicles cannot use launchers');
 }else if(kind==='teleporter'){
  if(!anchorOk(device.to))errors.push('teleporter needs a destination');
  if(!lockable&&!cuttable)errors.push('teleporter must be cuttable or lockable');
  if(device.vehiclesAllowed===true)errors.push('vehicles cannot use teleporters');
 }else if(kind==='depot'){
  if(!Number.isFinite(num(device.exits,NaN))||num(device.exits,0)<DEVICE_PARAMS.depot.minExits)errors.push('depot needs >= 2 exits');
  if(device.hq!==true&&device.capturable===false)errors.push('only the HQ depot may be non-capturable');
  if(Number.isFinite(num(device.nodeDistanceMeters,NaN))&&num(device.nodeDistanceMeters,0)<DEVICE_PARAMS.depot.nodeClearanceMeters){
   errors.push('depot must be >= 30 m from a node capture centre');
  }
  if(Number.isFinite(num(device.chokepointDistanceMeters,NaN))&&num(device.chokepointDistanceMeters,0)<DEVICE_PARAMS.depot.chokepointClearanceMeters){
   errors.push('depot must be >= 12 m from a chokepoint');
  }
 }
 if(Number.isFinite(num(device.bypassFraction,NaN))&&(device.bypassFraction<TRAVERSAL.bypassMin||device.bypassFraction>TRAVERSAL.bypassMax)){
  errors.push('bypass fraction must be in [0.34,0.75]');
 }
 return deepFreeze({ok:errors.length===0,kind,errors:deepFreeze(errors)});
}

/** Validate one lane descriptor against the §6A.2 identity table. */
export function validateLane(lane){
 const errors=[];
 if(!lane||typeof lane!=='object')return deepFreeze({ok:false,errors:['lane must be an object']});
 if(typeof lane.id!=='string'||!lane.id.trim())errors.push('lane id required');
 if(!LANE_IDENTITY_KINDS.includes(lane.identity))errors.push('identity must be vehicle-road, cqc or zipline-flank');
 const expected=LANE_IDENTITIES.find(entry=>entry.identity===lane.identity);
 if(expected&&lane.vehicles!==expected.vehicles)errors.push(`${lane.identity} vehicle permission must be ${expected.vehicles}`);
 const traversalKind=lane.traversal&&lane.traversal.kind;
 if(traversalKind!=null&&!LANE_IDENTITY_KINDS.includes(traversalKind))errors.push('traversal.kind must be a lane identity kind');
 if(traversalKind!=null&&lane.identity!=null&&traversalKind!==lane.identity)errors.push('traversal.kind must match the lane identity');
 if(Number.isFinite(num(lane.bypassFraction,NaN))&&(lane.bypassFraction<TRAVERSAL.bypassMin||lane.bypassFraction>TRAVERSAL.bypassMax)){
  errors.push('bypass fraction must be in [0.34,0.75]');
 }
 if(Number.isFinite(num(lane.chokepoints,NaN))&&(num(lane.chokepoints,0)<1||num(lane.chokepoints,0)>2))errors.push('lanes keep 1-2 chokepoints');
 if(typeof lane.landmark!=='string'||!lane.landmark.trim())errors.push('landmark required');
 return deepFreeze({ok:errors.length===0,errors:deepFreeze(errors)});
}

// ===========================================================================
// §6A.9 COMMENDATIONS conversion
// ===========================================================================
// Remote-config-shaped launch constants. All of the anti-inflation levers ship
// built and inert: no transfer cap, no weekly cap, overflow inert at 1.0 and
// no seasonal bonus. Owners flip these live without a client build.
export const REQ_TRANSFER_CAP=0;
export const WEEKLY_CAP=0;
export const OVERFLOW_RATE=1.0;
export const SEASONAL_BONUS=1.0;
export const PERF_SLOPE=0.5;
export const PERF_MIN=0.5;
export const PERF_MAX=1.5;
export const WIN_BONUS=0.25;
export const MVP_BONUS=0.25;

export const META_DEFAULTS=deepFreeze({
 REQ_TRANSFER_CAP,WEEKLY_CAP,OVERFLOW_RATE,SEASONAL_BONUS,
 PERF_SLOPE,PERF_MIN,PERF_MAX,WIN_BONUS,MVP_BONUS,
 weeklyUsed:0,
});

/** §6A.9.2 objective/performance multiplier (`0.5×–1.5×`). Kills are excluded. */
export function perfMultiplier(objShare,cfg={}){
 const c={...META_DEFAULTS,...(cfg||{})};
 const share=clamp(objShare,0,2);
 return round(clamp(c.PERF_SLOPE+c.PERF_SLOPE*share,c.PERF_MIN,c.PERF_MAX),4);
}

/** §6A.9.2 win/MVP multiplier (`1.00×–1.50×`). Booleans or [0,1] fractions. */
export function matchMultiplier(win,mvp,cfg={}){
 const c={...META_DEFAULTS,...(cfg||{})};
 const winValue=win===true?1:win===false?0:clamp(win,0,1);
 const mvpValue=mvp===true?1:mvp===false?0:clamp(mvp,0,1);
 return round(1+c.WIN_BONUS*winValue+c.MVP_BONUS*mvpValue,4);
}

/**
 * Full §6A.9.2 conversion for one player in one match.
 * `leftover` is `max(0, REQ_earned − REQ_spent)`; `objShare` is clamped [0,2].
 * @returns {{commendations:number,cappedPool:number,overflow:number,perfMult:number,matchMult:number,base:number,weeklyCapApplied:boolean,transferCapApplied:boolean,seasonalBonus:number,config:object}}
 */
export function convertReqBreakdown(leftover,objShare,win,mvp,cfg={}){
 const c={...META_DEFAULTS,...(cfg||{})};
 const left=Math.max(0,num(leftover,0));
 const cap=Math.max(0,num(c.REQ_TRANSFER_CAP,0));
 const cappedPool=cap>0?Math.min(left,cap):left;
 const overflow=cap>0?Math.max(0,left-cap):0;
 const perfMult=perfMultiplier(objShare,c);
 const matchMult=matchMultiplier(win,mvp,c);
 const base=cappedPool*perfMult*matchMult+Math.floor(overflow*Math.max(0,num(c.OVERFLOW_RATE,0)));
 const seasonalBonus=Math.max(0,num(c.SEASONAL_BONUS,1));
 let commendations=Math.floor(base*seasonalBonus);
 let weeklyCapApplied=false;
 const weeklyCap=Math.max(0,num(c.WEEKLY_CAP,0));
 if(weeklyCap>0){
  const room=Math.max(0,weeklyCap-Math.max(0,num(c.weeklyUsed,0)));
  if(commendations>room){commendations=room;weeklyCapApplied=true;}
 }
 return deepFreeze({
  commendations,cappedPool,overflow,perfMult,matchMult,base,
  weeklyCapApplied,transferCapApplied:cap>0,seasonalBonus,config:deepFreeze({...c}),
 });
}

/** `COMMENDATIONS` transferred for one player/match (§6A.9.2). */
export function convertReq(leftover,objShare,win,mvp,cfg={}){
 return convertReqBreakdown(leftover,objShare,win,mvp,cfg).commendations;
}

// §6A.9.4 pacing targets, calibrated to the §6A.5 median `REQ` earn.
export const MATCH_REQ=deepFreeze({minutesMin:22,minutesMax:25,medianMin:250,medianMax:400});
export const COMMENDATION_PACING=deepFreeze({
 matchesPerHour:2.2,
 perMatchMin:200,
 perMatchMax:300,
 tiers:[
  {id:'first-unlock',min:150,max:300,matchesMin:1,matchesMax:1,hoursMin:0.5,hoursMax:0.5},
  {id:'early-unlocks',min:400,max:900,matchesMin:2,matchesMax:5,hoursMin:1,hoursMax:2.5},
  {id:'convenience',min:1200,max:3000,matchesMin:6,matchesMax:15,hoursMin:3,hoursMax:7},
  {id:'sidegrade',min:1200,max:3000,matchesMin:6,matchesMax:15,hoursMin:3,hoursMax:7},
  {id:'core-epic',min:4000,max:8000,matchesMin:20,matchesMax:40,hoursMin:9,hoursMax:18},
  {id:'marquee',min:12000,max:15000,matchesMin:40,matchesMax:75,hoursMin:20,hoursMax:35},
 ],
});

const cocsEconomy={
 ARCHETYPE_WEIGHTS,SCORE_EVENTS,ORDER_REWARD,SUPPLY_CUT,ARRAY_CAPTURE,
 REQ_EARN,REQ_ITEMS,REQ_COSTS,REQ_FORBIDDEN,
 NEGLECT,NEGLECT_EFFECTS,
 GEAR_CAPS,REQ_CAPS,COMBINED_CAPS,
 TRAVERSAL,DEVICE_PARAMS,LANE_IDENTITIES,
 META_DEFAULTS,MATCH_REQ,COMMENDATION_PACING,
 scoreEvent,tallyScores,reqEarn,reqEarnBreakdown,purchaseCost,reqPurchase,
 neglectState,neglectTick,neglectEffect,neglectPassiveFlux,
 composeCaps,withinCombinedCaps,resolveSpawnLoadout,
 validateTraversal,validateLane,arrivalProtection,tickArrival,canTraverse,
 convertReq,convertReqBreakdown,perfMultiplier,matchMultiplier,
};
export default cocsEconomy;
