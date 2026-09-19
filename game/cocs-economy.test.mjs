// LATTICE STRIKE (`cocs`) battle economy — table and invariant tests.
// Spec: docs/design/COCS-MODE-SPEC.md §3, §6.5–6.6, §6A, §9.
// Covers objective-first score weighting, REQ pacing, the NEGLECT anti-grief
// meter, traversal parameter sanity, the COMMENDATIONS conversion and the
// gear/REQ cap seam. Pure data only; no engine `Match` is constructed here.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {CHARACTERS,HARNESSES} from './data.mjs';
import {GEAR_CAPS as PROGRESSION_GEAR_CAPS} from './progression.mjs';
import {
 ARCHETYPE_WEIGHTS,
 ARRAY_CAPTURE,
 COMBINED_CAPS,
 COMMENDATION_PACING,
 DEVICE_PARAMS,
 GEAR_CAPS,
 LANE_IDENTITIES,
 LANE_IDENTITY_KINDS,
 MATCH_REQ,
 META_DEFAULTS,
 NEGLECT,
 ORDER_REWARD,
 REQ_CAPS,
 REQ_COSTS,
 REQ_EARN,
 REQ_FORBIDDEN,
 REQ_ITEMS,
 SCORE_EVENTS,
 SUPPLY_CUT,
 TEAM_WIDE_REQ_IDS,
 TRAVERSAL,
 arrivalProtection,
 canTraverse,
 composeCaps,
 convertReq,
 convertReqBreakdown,
 deepFreeze,
 isReqForbidden,
 matchMultiplier,
 neglectEffect,
 neglectPassiveFlux,
 neglectState,
 neglectTick,
 perfMultiplier,
 purchaseCost,
 reqEarn,
 reqEarnBreakdown,
 reqPurchase,
 resolveSpawnLoadout,
 scoreEvent,
 tallyScores,
 tickArrival,
 validateLane,
 validateTraversal,
 withinCombinedCaps,
} from './cocs-economy.mjs';

const deepFrozen=value=>!value||typeof value!=='object'||(Object.isFrozen(value)&&Object.values(value).every(deepFrozen));
const idsOf=list=>list.map(entry=>entry.id);

// ---------------------------------------------------------------------------
// Scoring (§6A.4 / §9.1)
// ---------------------------------------------------------------------------
test('archetype weights and every fixed score event match the spec',()=>{
 assert.deepEqual({...ARCHETYPE_WEIGHTS},{front:1.0,economy:1.2,array:1.5});
 assert.deepEqual({...SCORE_EVENTS.capture},{teamOP:25,personalOP:10,req:8});
 assert.deepEqual({...SCORE_EVENTS.neutralize},{teamOP:10,personalOP:5,req:4});
 assert.deepEqual({...SCORE_EVENTS.prime},{teamOP:15,personalOP:8,req:10});
 assert.deepEqual({...SCORE_EVENTS.killPlayer},{teamOP:3,personalOP:3,req:1});
 assert.deepEqual({...SCORE_EVENTS.killSubagent},{teamOP:2,personalOP:2,req:1});
 assert.deepEqual({...SCORE_EVENTS.assist},{teamOP:1,personalOP:1,req:0});
 assert.deepEqual({...ORDER_REWARD},{teamOP:20,issuerPersonalOP:10,contributorPersonalOP:5,reqPerContributor:15,contributorCap:6});
 assert.deepEqual({...ARRAY_CAPTURE},{teamOP:'win',personalOP:50,req:30,decisive:true});
 assert.equal(scoreEvent({kind:'array'}).win,true);
});

test('hold scores weighted node-seconds, splits personal OP by holders and drips 0.25 REQ/s',()=>{
 assert.equal(scoreEvent({kind:'hold',archetype:'front',seconds:100,holders:1}).teamOP,100);
 assert.equal(scoreEvent({kind:'hold',archetype:'economy',seconds:100,holders:1}).teamOP,120);
 assert.equal(scoreEvent({kind:'hold',archetype:'array',seconds:100,holders:1}).teamOP,150);
 const split=scoreEvent({kind:'hold',archetype:'front',seconds:100,holders:4});
 assert.equal(split.personalOP,10); // 0.4 × 1.0 × 100 / 4
 assert.equal(split.req,25);
 assert.equal(scoreEvent({kind:'hold',archetype:'array-relay',seconds:10}).teamOP,15);
});

test('cut supply pays 20 + 5×denied and order completion pays the issuer/contributor split',()=>{
 assert.equal(scoreEvent({kind:'cut',deniedNodes:0}).teamOP,20);
 assert.equal(scoreEvent({kind:'cut',deniedNodes:3}).teamOP,35);
 assert.deepEqual({...scoreEvent({kind:'cut',deniedNodes:3})},{kind:'cut',teamOP:35,personalOP:8,req:6,win:false});
 const issuer=scoreEvent({kind:'order',role:'issuer'});
 const contributor=scoreEvent({kind:'order'});
 assert.equal(issuer.personalOP,10);assert.equal(contributor.personalOP,5);
 assert.equal(issuer.req,15);assert.equal(contributor.req,15);
 assert.equal(scoreEvent({kind:'nonsense'}).teamOP,0);
});

test('a representative winning profile decomposes objectives ≥65%, orders 8–15%, kills+assists ≤20%, assists < kills',()=>{
 const events=[
  {kind:'hold',archetype:'front',seconds:240},
  {kind:'hold',archetype:'economy',seconds:120},
  {kind:'hold',archetype:'array',seconds:80},
  ...Array.from({length:24},()=>({kind:'capture'})),
  ...Array.from({length:6},()=>({kind:'neutralize'})),
  ...Array.from({length:8},()=>({kind:'prime'})),
  {kind:'cut',deniedNodes:3},{kind:'cut',deniedNodes:3},
  ...Array.from({length:10},()=>({kind:'order'})),
  ...Array.from({length:40},()=>({kind:'killPlayer'})),
  ...Array.from({length:25},()=>({kind:'killSubagent'})),
  ...Array.from({length:55},()=>({kind:'assist'})),
 ];
 const totals={objectives:0,orders:0,kills:0,assists:0};
 for(const event of events){
  const score=scoreEvent(event);
  if(score.kind==='order')totals.orders+=score.teamOP;
  else if(score.kind==='assist')totals.assists+=score.teamOP;
  else if(score.kind==='killPlayer'||score.kind==='killSubagent')totals.kills+=score.teamOP;
  else if(typeof score.teamOP==='number')totals.objectives+=score.teamOP;
 }
 const sum=tallyScores(events);
 const total=totals.objectives+totals.orders+totals.kills+totals.assists;
 assert.equal(sum.teamOP,total);
 assert.ok(totals.objectives/total>=0.65,`objectives ${(100*totals.objectives/total).toFixed(1)}%`);
 assert.ok(totals.orders/total>=0.08&&totals.orders/total<=0.15,`orders ${(100*totals.orders/total).toFixed(1)}%`);
 assert.ok((totals.kills+totals.assists)/total<=0.20,`kills+assists ${(100*(totals.kills+totals.assists)/total).toFixed(1)}%`);
 assert.ok(totals.assists<totals.kills,'assists are worth less than kills');
});

// ---------------------------------------------------------------------------
// REQ earn & costs (§6A.5)
// ---------------------------------------------------------------------------
const pacingProfile=overrides=>({minutes:22,inZoneFraction:0.5,captures:10,neutralizes:3,primes:2,cuts:1,orders:1,playerKills:4,assists:0,...overrides});
const earnedFor=profile=>reqEarn({
 objectiveSeconds:profile.minutes*60*profile.inZoneFraction,
 captures:profile.captures,neutralizes:profile.neutralizes,primes:profile.primes,
 cuts:profile.cuts,orders:profile.orders,playerKills:profile.playerKills,assists:profile.assists,
});

test('REQ earn table and breakdown are exact',()=>{
 assert.deepEqual({...REQ_EARN},{objectivePresencePerSecond:0.25,capture:8,neutralize:4,prime:10,supplyCut:6,orderContributor:15,playerKill:1,assist:0});
 const breakdown=reqEarnBreakdown({objectiveSeconds:400,captures:2,neutralizes:1,primes:1,cuts:1,orders:1,playerKills:3,assists:9});
 assert.equal(breakdown.parts.objectivePresence,100);
 assert.equal(breakdown.parts.capture,16);
 assert.equal(breakdown.parts.neutralize,4);
 assert.equal(breakdown.parts.prime,10);
 assert.equal(breakdown.parts.supplyCut,6);
 assert.equal(breakdown.parts.order,15);
 assert.equal(breakdown.parts.playerKill,3);
 assert.equal(breakdown.parts.assist,0);
 assert.equal(breakdown.total,Object.values(breakdown.parts).reduce((a,b)=>a+b,0));
 assert.equal(reqEarn({captures:-5,playerKills:-2}),0);
});

test('the median 22–25 min REQ earn lands in the 250–400 band',()=>{
 const profiles=[
  pacingProfile({inZoneFraction:0.20,captures:2,neutralizes:1,primes:0,cuts:0,orders:0,playerKills:1}),
  pacingProfile({inZoneFraction:0.35,captures:5,neutralizes:2,primes:1,cuts:0,orders:0,playerKills:2}),
  pacingProfile({inZoneFraction:0.50,captures:9,neutralizes:3,primes:2,cuts:1,orders:1,playerKills:4}),
  pacingProfile({inZoneFraction:0.65,captures:13,neutralizes:4,primes:3,cuts:2,orders:2,playerKills:6}),
  pacingProfile({inZoneFraction:0.80,captures:18,neutralizes:5,primes:4,cuts:3,orders:3,playerKills:8}),
 ];
 const values=profiles.map(earnedFor).sort((a,b)=>a-b);
 const median=values[Math.floor(values.length/2)];
 assert.ok(median>=MATCH_REQ.medianMin&&median<=MATCH_REQ.medianMax,`median ${median} in [${MATCH_REQ.medianMin},${MATCH_REQ.medianMax}]`);
 const medianEarn=earnedFor(profiles[2]);
 assert.ok(medianEarn>=250&&medianEarn<=400,`median profile ${medianEarn}`);
 // A 2–4 item kit fits the median earn; a five-item heavy kit does not.
 const kitCost=ids=>ids.reduce((sum,id)=>sum+purchaseCost(id),0);
 const firstKit=['forward-depot','supply-drop'];
 const secondKit=['forward-depot','sentry','haste'];
 const thirdKit=['sentry','repair-tool','haste','barrier'];
 const heavyKit=['forward-depot','supply-drop','fortify-doctrine','sentry','overshield'];
 for(const kit of [firstKit,secondKit,thirdKit])assert.ok(kitCost(kit)<=medianEarn,`${kit.length}-item kit affordable at ${medianEarn}`);
 assert.ok(kitCost(heavyKit)>medianEarn,'the median cannot buy every big item at once');
});

test('the REQ cost table matches the spec and REQ can never buy a respawn/RESERVE/FLUX',()=>{
 const expected={ 'field-repair':40,'ammo-crate':25,haste:35,overshield:50,'at-mine':35,smoke:20,'repair-tool':30,'spot-drone':45,barrier:30,sentry:60,'forward-depot':120,'supply-drop':80,'recon-pulse':60,'fortify-doctrine':100,puma:150,'tier-upgrade':25,'oracle-unlock':120 };
 assert.deepEqual({...REQ_COSTS},expected);
 for(const [id,cost] of Object.entries(expected))assert.equal(purchaseCost(id),cost);
 assert.equal(purchaseCost('respawn'),null);
 for(const forbidden of REQ_FORBIDDEN)assert.equal(isReqForbidden(forbidden),true);
 assert.ok(REQ_FORBIDDEN.every(forbidden=>!Object.hasOwn(REQ_COSTS,forbidden)));
 assert.ok(REQ_FORBIDDEN.every(forbidden=>!idsOf(REQ_ITEMS).includes(forbidden)));
 // Team-wide abilities are commander-only; one personal buff at a time.
 assert.ok(TEAM_WIDE_REQ_IDS.every(id=>reqPurchase(id,{balance:1000,isCommander:false}).reason==='commander-only'));
 assert.equal(reqPurchase('supply-drop',{balance:1000,isCommander:true}).ok,true);
 assert.equal(reqPurchase('haste',{balance:1000,activeBuffId:'overshield'}).reason,'one-active-buff');
 assert.equal(reqPurchase('haste',{balance:20}).reason,'insufficient-req');
 assert.equal(reqPurchase('respawn',{balance:1000}).reason,'unknown-item');
 const purchase=reqPurchase('field-repair',{balance:100});
 assert.equal(purchase.ok,true);assert.equal(purchase.balanceAfter,60);
 assert.ok(!Object.hasOwn(purchase,'flux')&&!Object.hasOwn(purchase,'reserve'),'purchases never touch FLUX/RESERVE');
});

// ---------------------------------------------------------------------------
// NEGLECT anti-grief (§6A.6)
// ---------------------------------------------------------------------------
test('NEGLECT never rises without a seated human commander',()=>{
 let bot=neglectState();
 for(let i=0;i<60*60;i++)bot=neglectTick(bot,1/60,{humanCommander:false,activeOrder:true});
 assert.equal(bot.value,0);
 const chiefOnly=neglectTick(neglectState(),600,{activeOrder:true,contributed:false});
 assert.equal(chiefOnly.value,0);
 assert.equal(neglectEffect(chiefOnly).multiplier,1);
});

test('NEGLECT waits out the 45 s grace, then rises +1/s and caps at 100',()=>{
 let state=neglectState();
 for(let i=0;i<45;i++)state=neglectTick(state,1,{humanCommander:true,activeOrder:true});
 assert.equal(state.value,0,'still inside the grace window');
 state=neglectTick(state,1,{humanCommander:true,activeOrder:true});
 assert.equal(state.value,1,'one second past grace');
 for(let i=0;i<500;i++)state=neglectTick(state,1,{humanCommander:true,activeOrder:true});
 assert.equal(state.value,NEGLECT.max);
});

test('NEGLECT falls −2/s on contribution and resets to 0 within 30 s of completion/expiry/cancel',()=>{
 let state=neglectState();
 for(let i=0;i<100;i++)state=neglectTick(state,1,{humanCommander:true,activeOrder:true});
 assert.equal(state.value,55);
 state=neglectTick(state,10,{humanCommander:true,activeOrder:true,contributed:true});
 assert.equal(state.value,35);
 for(let i=0;i<100;i++)state=neglectTick(state,1,{humanCommander:true,activeOrder:true});
 const beforeReset=state.value;
 state=neglectTick(state,15,{humanCommander:true,activeOrder:false,cancelled:true});
 assert.ok(state.value>0&&state.value<beforeReset,'mid-reset');
 state=neglectTick(state,15,{humanCommander:true,activeOrder:false,cancelled:true});
 assert.equal(state.value,0,'reset completes inside 30 s');
 let expired=neglectState();
 for(let i=0;i<80;i++)expired=neglectTick(expired,1,{humanCommander:true,activeOrder:true});
 expired=neglectTick(expired,30,{humanCommander:true,activeOrder:false,expired:true});
 assert.equal(expired.value,0);
});

test('NEGLECT effects are bounded, non-stacking and touch only the passive FLUX term',()=>{
 assert.deepEqual({...neglectEffect({value:49})},{value:49,multiplier:1,reduction:0,tier:'none',capped:false,timeLimited:true});
 assert.equal(neglectEffect({value:50}).multiplier,0.9);
 assert.equal(neglectEffect({value:74}).multiplier,0.9);
 assert.equal(neglectEffect({value:75}).multiplier,0.8);
 assert.equal(neglectEffect({value:100}).multiplier,0.8);
 assert.equal(neglectEffect({value:100}).capped,true);
 assert.equal(neglectPassiveFlux(1,{value:75}),0.8);
 assert.equal(neglectPassiveFlux(3,{value:75}),2.4,'node-style income is passed through by the caller');
 assert.equal(neglectPassiveFlux(1,neglectState()),1);
});

// ---------------------------------------------------------------------------
// Traversal (§6A.1–6A.3)
// ---------------------------------------------------------------------------
const validZipline=()=>({kind:'zipline',id:'zip-1',from:{x:0,z:0},to:{x:80,z:0},cuttable:true,speed:TRAVERSAL.ziplineSpeed,arrival:{x:80,z:0,r:5,seconds:1.5,enemySpawnDistanceMeters:20}});

test('traversal parameters match the spec table',()=>{
 assert.equal(TRAVERSAL.sharedCooldown,2.5);
 assert.equal(TRAVERSAL.cutSeconds,45);
 assert.equal(TRAVERSAL.lockSeconds,30);
 assert.equal(TRAVERSAL.arrivalSeconds,1.5);
 assert.equal(TRAVERSAL.arrivalDamageReduction,0.5);
 assert.equal(TRAVERSAL.depotApronMeters,6);
 assert.equal(TRAVERSAL.depotVehicleImmunitySeconds,3);
 assert.equal(DEVICE_PARAMS.zipline.sharedCooldown,2.5);
 assert.equal(DEVICE_PARAMS['jump-pad'].lockSeconds,30);
 assert.equal(DEVICE_PARAMS.launcher.lockSeconds,30);
 assert.equal(DEVICE_PARAMS.teleporter.cooldown,1);
 assert.equal(DEVICE_PARAMS.depot.apronMeters,6);
 assert.equal(DEVICE_PARAMS.depot.vehicleRespawnSeconds,25);
 assert.equal(DEVICE_PARAMS.depot.captureSeconds,10);
 assert.equal(canTraverse(0),true);
 assert.equal(canTraverse(2.5),false);
});

test('device validators accept spec-shaped devices and reject bypass/dead-end/vehicle abuse',()=>{
 assert.equal(validateTraversal(validZipline()).ok,true);
 assert.equal(validateTraversal({...validZipline(),cuttable:false}).ok,false);
 assert.equal(validateTraversal({...validZipline(),vehiclesAllowed:true}).ok,false);
 assert.equal(validateTraversal({...validZipline(),arrival:{x:80,z:0,r:4,seconds:1.5}}).ok,false);
 assert.equal(validateTraversal({...validZipline(),arrival:{x:80,z:0,r:5,seconds:0.9}}).ok,false);
 assert.equal(validateTraversal({...validZipline(),arrival:{x:80,z:0,r:5,seconds:1.5,enemySpawnDistanceMeters:10}}).ok,false);
 assert.equal(validateTraversal({...validZipline(),bypassFraction:0.20}).ok,false);
 assert.equal(validateTraversal({...validZipline(),bypassFraction:0.50}).ok,true);
 assert.equal(validateTraversal({kind:'jump-pad',id:'pad-1',power:15,lockable:true}).ok,true);
 assert.equal(validateTraversal({kind:'jump-pad',id:'pad-1',power:0,lockable:true}).ok,false);
 assert.equal(validateTraversal({kind:'launcher',id:'l-1',target:{x:10,z:10},lockable:true,arrival:{x:10,z:10,r:5,seconds:1.5}}).ok,true);
 assert.equal(validateTraversal({kind:'teleporter',id:'t-1',to:{x:10,z:10},lockable:true}).ok,true);
 assert.equal(validateTraversal({kind:'depot',id:'d-1',exits:2,nodeDistanceMeters:40,chokepointDistanceMeters:15}).ok,true);
 assert.equal(validateTraversal({kind:'depot',id:'d-1',exits:1}).ok,false);
 assert.equal(validateTraversal({kind:'depot',id:'d-1',exits:2,hq:false,capturable:false}).ok,false);
 assert.equal(validateTraversal({kind:'depot',id:'d-1',exits:2,hq:true,capturable:false}).ok,true);
 assert.equal(validateTraversal({kind:'depot',id:'d-1',exits:2,nodeDistanceMeters:10}).ok,false);
 assert.equal(validateTraversal(null).ok,false);
});

test('three lanes carry distinct identities and vehicle permissions',()=>{
 assert.equal(LANE_IDENTITIES.length,3);
 assert.equal(new Set(idsOf(LANE_IDENTITIES)).size,3);
 assert.equal(new Set(LANE_IDENTITIES.map(lane=>lane.identity)).size,3);
 assert.deepEqual(LANE_IDENTITIES.map(lane=>lane.identity),LANE_IDENTITY_KINDS);
 for(const lane of LANE_IDENTITIES){
  assert.equal(lane.vehicles, lane.identity==='vehicle-road');
  assert.ok(lane.chokepoints>=1&&lane.chokepoints<=2);
  assert.equal(validateLane({...lane,traversal:{kind:lane.identity},bypassFraction:0.5}).ok,true);
 }
 assert.equal(validateLane({id:'x',identity:'vehicle-road',vehicles:false,traversal:{kind:'vehicle-road'},chokepoints:1,landmark:'road',bypassFraction:0.5}).ok,false);
 assert.equal(validateLane({id:'x',identity:'cqc',vehicles:false,traversal:{kind:'zipline-flank'},chokepoints:1,landmark:'tunnel',bypassFraction:0.5}).ok,false);
});

test('arrival protection lasts 1.5 s at 50% DR and is applied once',()=>{
 let protection=arrivalProtection();
 assert.equal(protection.remaining,1.5);assert.equal(protection.damageReduction,0.5);assert.equal(protection.telegraph,true);
 protection=tickArrival(protection,0.5);
 assert.equal(protection.active,true);assert.equal(protection.remaining,1);
 protection=tickArrival(protection,2);
 assert.equal(protection.active,false);assert.equal(protection.damageReduction,0);
});

// ---------------------------------------------------------------------------
// Cap seam (§6A.8)
// ---------------------------------------------------------------------------
test('GEAR_CAPS flows from progression, REQ_CAPS adds bounded headroom and COMBINED_CAPS clamps',()=>{
 assert.equal(GEAR_CAPS,PROGRESSION_GEAR_CAPS,'one source of truth for GEAR_CAPS');
 assert.deepEqual({...REQ_CAPS},{offense:1.05,mobility:1.06,ehp:8,spread:0.94});
 assert.deepEqual({...COMBINED_CAPS},{offense:1.20,mobility:1.16,ehp:23,spread:0.79});
 const gear=resolveSpawnLoadout(['heavy-barrel','plating','stim'],{damage:REQ_CAPS.offense,speed:REQ_CAPS.mobility,armor:REQ_CAPS.ehp,spread:REQ_CAPS.spread});
 assert.ok(gear.modifiers.damage<=COMBINED_CAPS.offense+1e-9,`damage ${gear.modifiers.damage}`);
 assert.ok(gear.modifiers.speed<=COMBINED_CAPS.mobility+1e-9,`mobility ${gear.modifiers.speed}`);
 assert.ok(gear.modifiers.health+gear.modifiers.armor<=COMBINED_CAPS.ehp+1e-9,`ehp ${gear.modifiers.health+gear.modifiers.armor}`);
 assert.ok(gear.modifiers.spread>=COMBINED_CAPS.spread-1e-9,`spread ${gear.modifiers.spread}`);
 assert.ok(withinCombinedCaps(gear.modifiers));
 assert.ok(gear.clamped.offense&&gear.clamped.mobility&&gear.clamped.ehp&&gear.clamped.spread);
 const over=composeCaps({damage:1.15,speed:1.10,health:15},{damage:1.5,speed:1.5,armor:50,spread:0.10});
 assert.ok(over.modifiers.damage<=COMBINED_CAPS.offense+1e-9,`over damage ${over.modifiers.damage}`);
 assert.ok(over.modifiers.speed<=COMBINED_CAPS.mobility+1e-9,`over mobility ${over.modifiers.speed}`);
 assert.ok(over.modifiers.health+over.modifiers.armor<=COMBINED_CAPS.ehp+1e-9,`over ehp ${over.modifiers.health+over.modifiers.armor}`);
 assert.ok(over.modifiers.spread>=COMBINED_CAPS.spread-1e-9,`over spread ${over.modifiers.spread}`);
 assert.equal(withinCombinedCaps({damage:1.5,speed:1,health:0,armor:0,spread:1}),false);
});

// ---------------------------------------------------------------------------
// COMMENDATIONS (§6A.9)
// ---------------------------------------------------------------------------
test('perf and match multipliers are bounded and objective-weighted (kills excluded)',()=>{
 assert.equal(perfMultiplier(0),0.5);
 assert.equal(perfMultiplier(1),1);
 assert.equal(perfMultiplier(1.5),1.25);
 assert.equal(perfMultiplier(2),1.5);
 assert.equal(perfMultiplier(5),1.5,'clamped to PERF_MAX');
 assert.equal(matchMultiplier(false,false),1);
 assert.equal(matchMultiplier(true,true),1.5);
 assert.equal(matchMultiplier(0.5,0.25),1.1875);
 assert.equal(convertReq(180,1,0.5,0.25),213,'spec formula: floor(180 × 1.0 × 1.1875)');
 assert.equal(convertReq(180,1,0.5,0.26),214,'the spec displays the rounded match_mult 1.19');
});

test('no-cap is the launch default; enabling the caps reproduces the capped formula',()=>{
 const uncapped=convertReqBreakdown(180,1,0.5,0.25);
 assert.equal(META_DEFAULTS.REQ_TRANSFER_CAP,0);
 assert.equal(uncapped.cappedPool,180);
 assert.equal(uncapped.overflow,0);
 assert.equal(uncapped.commendations,213);
 const capped=convertReqBreakdown(180,1,true,true,{REQ_TRANSFER_CAP:100,OVERFLOW_RATE:0.1});
 assert.equal(capped.cappedPool,100);
 assert.equal(capped.overflow,80);
 assert.equal(capped.base,100*1*1.5+8); // floor(80 × 0.10)
 assert.equal(capped.commendations,158);
 assert.equal(capped.transferCapApplied,true);
 const weekly=convertReqBreakdown(180,1,true,true,{WEEKLY_CAP:50});
 assert.equal(weekly.commendations,50);
 assert.equal(weekly.weeklyCapApplied,true);
 const used=convertReqBreakdown(180,1,true,true,{WEEKLY_CAP:200,weeklyUsed:180});
 assert.equal(used.commendations,20);
});

test('SEASONAL_BONUS is inert at 1.0 and the spec worked examples reproduce',()=>{
 assert.equal(META_DEFAULTS.SEASONAL_BONUS,1.0);
 assert.equal(convertReq(180,1,0.5,0.25,{SEASONAL_BONUS:1.0}),213);
 assert.equal(convertReq(180,1,0.5,0.25,{SEASONAL_BONUS:1.25}),Math.floor(213.75*1.25));
 assert.equal(convertReq(260,1.5,true,true),487,'strong objective player');
 assert.equal(convertReq(140,0.4,false,false),98,'passive loser');
 assert.ok(COMMENDATION_PACING.tiers[0].min<=300&&COMMENDATION_PACING.tiers[0].matchesMax<=1,'first unlock inside one match');
 assert.equal(COMMENDATION_PACING.tiers.at(-1).hoursMin,20);
 assert.equal(COMMENDATION_PACING.tiers.at(-1).hoursMax,35);
});

// ---------------------------------------------------------------------------
// Purity & id-free conventions
// ---------------------------------------------------------------------------
test('every exported table is deeply frozen and deterministic',()=>{
 for(const table of [ARCHETYPE_WEIGHTS,SCORE_EVENTS,ORDER_REWARD,ARRAY_CAPTURE,SUPPLY_CUT,REQ_EARN,REQ_ITEMS,REQ_COSTS,REQ_FORBIDDEN,NEGLECT,REQ_CAPS,COMBINED_CAPS,TRAVERSAL,DEVICE_PARAMS,LANE_IDENTITIES,META_DEFAULTS,MATCH_REQ,COMMENDATION_PACING]){
  assert.ok(deepFrozen(table),'table deeply frozen');
 }
 assert.ok(deepFrozen(scoreEvent({kind:'hold',archetype:'front',seconds:1})));
 assert.ok(deepFrozen(neglectState()));
 assert.ok(Object.isFrozen(deepFreeze({a:{b:1}}).a));
});

test('no operator or harness id leaks into the economy module',()=>{
 const source=readFileSync(new URL('./cocs-economy.mjs',import.meta.url),'utf8');
 const ids=[...CHARACTERS.map(entry=>entry.id),...HARNESSES.map(entry=>entry.id)];
 for(const id of ids){
  const escaped=id.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  assert.ok(!new RegExp(`['"\`]${escaped}['"\`]`).test(source),`${id} must not appear in cocs-economy logic`);
 }
});
