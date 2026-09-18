// ---------------------------------------------------------------------------
// Attract-demo playlist: catalog, rotation and settings for the title-screen
// reel. Two rotation flavours share one state machine:
//   curated  — the hand-picked scenarios exported by showcase.mjs, chosen for
//              looks, mode variety and map spread;
//   complete — every mode/map pair the authoritative registry allows
//              (game/maps.mjs + game/arenas.mjs), including legacy arenas when
//              the caller enables them, minus modes that cannot run as an
//              autonomous demo (see DEMO_MODE_EXCLUSIONS).
// `pickNext` never mutates the state it is given and is fully deterministic for
// an injected RNG, so a fixed seed always replays the same reel. Settings are
// plain data with validate/normalize/reset and serialize/parse helpers so a page
// can round-trip them through localStorage and recover from malformed values.
// ---------------------------------------------------------------------------
import {GAME_MODES,DIFFICULTIES,modeRule} from './config.mjs';
import {MAPS} from './maps.mjs';
import {activeMaps,arenaMeta,arenaSupportsMode,mapsForMode,maxBotsFor,recommendedBots} from './arenas.mjs';

export const ROTATIONS=Object.freeze(['curated','complete']);
export const DEFAULT_SCENARIO_SECONDS=75;
export const DEMO_SETTINGS_KEY='token-arena-demo-settings';
// The coverage categories a demo pass is expected to hit. A mode maps to
// exactly one of these so a rotation can balance a pass by category as well as
// by mode and map.
export const SCENARIO_CATEGORIES=Object.freeze(['infantry','objectives','vehicles','racing','soccer']);

const DIFFICULTY_IDS=Object.freeze(DIFFICULTIES.map(difficulty=>difficulty.id));
const MODE_IDS=Object.freeze(GAME_MODES.map(mode=>mode.id));
const MAP_IDS=Object.freeze(MAPS.map(map=>map.id));
const MAP_ID_SET=new Set(MAP_IDS);

// Every registered mode is classified once. `survival` and `campaign` never
// reach a catalog because those modes are excluded (see DEMO_MODE_EXCLUSIONS);
// the labels stay here so the UI can explain what was dropped.
export const DEMO_CATEGORY_BY_MODE=Object.freeze({
 deathmatch:'infantry',teamdeathmatch:'infantry',instagib:'infantry',rockets:'infantry',arsenal:'infantry',armsrace:'infantry',juggernaut:'infantry','team-elimination':'infantry',
 ctf:'objectives',koth:'objectives',domination:'objectives',assault:'objectives',payload:'objectives',holdout:'objectives',uplink:'objectives','vip-escort':'objectives',cocs:'objectives','cocs-coop':'objectives',
 'combined-arms':'vehicles','puma-race':'racing','puma-soccer':'soccer',
 horde:'survival',campaign:'campaign',
});

// ---------------------------------------------------------------------------
// Curated catalog. Field-for-field the scenarios the title screen has always
// shipped plus a coverage `category` and `source`; ids/labels/modes/maps are
// deliberately frozen so `modeId` lookups and saved pins keep working.
// ---------------------------------------------------------------------------
export const CURATED_SCENARIOS=Object.freeze([
 Object.freeze({id:'deathmatch',label:'Deathmatch',category:'infantry',source:'curated',mode:'deathmatch',maps:Object.freeze(['colosseum','forge','substation','dune-ravine','atrium','crosswire']),bots:7,difficulty:'normal',timeLimit:60,fragLimit:10,seatVehicles:0}),
 Object.freeze({id:'teamdeathmatch',label:'Team Deathmatch',category:'infantry',source:'curated',mode:'teamdeathmatch',maps:Object.freeze(['titan-valley','warfront','atrium','riverbend','crosswire']),bots:8,difficulty:'normal',timeLimit:60,fragLimit:20,seatVehicles:0}),
 Object.freeze({id:'ctf',label:'Capture the Flag',category:'objectives',source:'curated',mode:'ctf',maps:Object.freeze(['frost-gate','skybreak','launchpad','citadel','blood-gulch']),bots:8,difficulty:'normal',timeLimit:60,fragLimit:2,seatVehicles:0}),
 Object.freeze({id:'koth',label:'King of the Hill',category:'objectives',source:'curated',mode:'koth',maps:Object.freeze(['colosseum','skyfall-basin','sunken-hill','forge']),bots:7,difficulty:'normal',timeLimit:60,fragLimit:60,seatVehicles:0}),
 Object.freeze({id:'domination',label:'Domination',category:'objectives',source:'curated',mode:'domination',maps:Object.freeze(['warfront','titan-valley','convoy-line','frost-gate']),bots:8,difficulty:'normal',timeLimit:60,fragLimit:100,seatVehicles:0}),
 Object.freeze({id:'combined-arms',label:'Combined Arms',category:'vehicles',source:'curated',mode:'combined-arms',maps:Object.freeze(['warfront','skyfall-basin','titan-valley','trenchline']),bots:12,difficulty:'normal',timeLimit:75,fragLimit:100,seatVehicles:.7}),
 Object.freeze({id:'payload',label:'Payload',category:'objectives',source:'curated',mode:'payload',maps:Object.freeze(['convoy-line','derelict-station','frost-gate','launchpad']),bots:6,difficulty:'normal',timeLimit:60,fragLimit:2,seatVehicles:0}),
 Object.freeze({id:'juggernaut',label:'Juggernaut',category:'infantry',source:'curated',mode:'juggernaut',maps:Object.freeze(['throne']),bots:7,difficulty:'normal',timeLimit:60,fragLimit:30,seatVehicles:0}),
 Object.freeze({id:'team-elimination',label:'Team Elimination',category:'infantry',source:'curated',mode:'team-elimination',maps:Object.freeze(['gauntlet']),bots:8,difficulty:'normal',timeLimit:60,fragLimit:8,seatVehicles:0}),
 Object.freeze({id:'puma-race',label:'Puma Circuit',category:'racing',source:'curated',mode:'puma-race',maps:Object.freeze(['puma-circuit']),bots:7,difficulty:'normal',timeLimit:120,fragLimit:1,seatVehicles:0}),
 Object.freeze({id:'puma-soccer',label:'Puma Soccer',category:'soccer',source:'curated',mode:'puma-soccer',maps:Object.freeze(['puma-pitch']),bots:3,difficulty:'normal',timeLimit:90,fragLimit:2,seatVehicles:0}),
]);

// ---------------------------------------------------------------------------
// Settings model.
// ---------------------------------------------------------------------------
export const DEMO_SETTINGS_DEFAULTS=Object.freeze({rotation:'curated',autoRotate:true,scenarioSeconds:DEFAULT_SCENARIO_SECONDS,botCount:null,difficulty:null});
export const DEMO_SETTINGS_LIMITS=Object.freeze({
 scenarioSeconds:Object.freeze({min:15,max:300}),
 botCount:Object.freeze({min:0,max:16}),
});

const clampNumber=(value,fallback,{min,max})=>typeof value==='number'&&Number.isFinite(value)?Math.max(min,Math.min(max,Math.round(value))):fallback;

export function normalizeDemoSettings(value={}){
 const c=value&&typeof value==='object'&&!Array.isArray(value)?value:{};
 const defaults=DEMO_SETTINGS_DEFAULTS;
 return {
  rotation:ROTATIONS.includes(c.rotation)?c.rotation:defaults.rotation,
  autoRotate:typeof c.autoRotate==='boolean'?c.autoRotate:defaults.autoRotate,
  scenarioSeconds:clampNumber(c.scenarioSeconds,defaults.scenarioSeconds,DEMO_SETTINGS_LIMITS.scenarioSeconds),
  botCount:typeof c.botCount==='number'&&Number.isFinite(c.botCount)?clampNumber(c.botCount,null,DEMO_SETTINGS_LIMITS.botCount):null,
  difficulty:DIFFICULTY_IDS.includes(c.difficulty)?c.difficulty:null,
 };
}

// Reports every field that had to be repaired while still returning a usable,
// normalized settings object so callers can continue with the safe values.
export function validateDemoSettings(value){
 if(!value||typeof value!=='object'||Array.isArray(value))return {ok:false,settings:resetDemoSettings(),errors:[{field:'settings',message:'settings must be an object'}]};
 const errors=[],fail=(field,message)=>errors.push({field,message});
 if(value.rotation!==undefined&&!ROTATIONS.includes(value.rotation))fail('rotation',`rotation must be one of ${ROTATIONS.join(' | ')}`);
 if(value.autoRotate!==undefined&&typeof value.autoRotate!=='boolean')fail('autoRotate','autoRotate must be a boolean');
 const seconds=value.scenarioSeconds,secondsLimit=DEMO_SETTINGS_LIMITS.scenarioSeconds;
 if(seconds!==undefined&&!(typeof seconds==='number'&&Number.isFinite(seconds)&&seconds>=secondsLimit.min&&seconds<=secondsLimit.max))fail('scenarioSeconds',`scenarioSeconds must be a number between ${secondsLimit.min} and ${secondsLimit.max}`);
 const bots=value.botCount,botLimit=DEMO_SETTINGS_LIMITS.botCount;
 if(bots!==undefined&&bots!==null&&!(typeof bots==='number'&&Number.isFinite(bots)&&bots>=botLimit.min&&bots<=botLimit.max))fail('botCount',`botCount must be null or a number between ${botLimit.min} and ${botLimit.max}`);
 if(value.difficulty!==undefined&&value.difficulty!==null&&!DIFFICULTY_IDS.includes(value.difficulty))fail('difficulty',`difficulty must be null or one of ${DIFFICULTY_IDS.join(' | ')}`);
 return {ok:errors.length===0,settings:normalizeDemoSettings(value),errors};
}

export function resetDemoSettings(overrides={}){
 const extra=overrides&&typeof overrides==='object'&&!Array.isArray(overrides)?overrides:{};
 return normalizeDemoSettings({...DEMO_SETTINGS_DEFAULTS,...extra});
}

export function serializeDemoSettings(value){
 return JSON.stringify(normalizeDemoSettings(value));
}

// Never throws: a missing, empty, malformed or non-object payload always comes
// back as reset-to-defaults. Only the known keys are read, so hostile
// `__proto__` payloads cannot leak into the returned object.
export function parseDemoSettings(text){
 if(text&&typeof text==='object'&&!Array.isArray(text))return normalizeDemoSettings(text);
 if(typeof text!=='string'||!text.trim())return resetDemoSettings();
 try{
  const parsed=JSON.parse(text);
  return parsed&&typeof parsed==='object'&&!Array.isArray(parsed)?normalizeDemoSettings(parsed):resetDemoSettings();
 }catch{return resetDemoSettings();}
}

// ---------------------------------------------------------------------------
// Eligibility. `pairEligibility` is the single explanation gate: every drop is
// attributed to a reason with a human-readable detail instead of vanishing.
// ---------------------------------------------------------------------------
export const EXCLUSION_REASONS=Object.freeze({
 'single-player-survival':'Horde is a lone-wolf survival run; it is not an autonomous bot match.',
 'single-player-scripted':'Campaign is a scripted single-player sequence; it is not an autonomous bot match.',
 'mode-map-incompatible':'game/arenas.mjs does not author this mode for the map.',
 'legacy-disabled':'Legacy arenas are disabled by the current settings.',
 'unknown-map':'The map id is not in the map registry.',
 'unknown-mode':'The mode id is not in GAME_MODES.',
 'no-eligible-mode':'No demo-eligible mode is compatible with this map.',
});

export const DEMO_MODE_EXCLUSIONS=Object.freeze({
 horde:Object.freeze({
  reason:'single-player-survival',
  detail:'Horde builds escalating NPC waves around a lone human survivor (game/singleplayer.mjs initializeSinglePlayer drops every rival and forces botCount 0), so with no participating player there is no match to demo.',
 }),
 campaign:Object.freeze({
  reason:'single-player-scripted',
  detail:'Campaign missions are a scripted, story-driven single-player sequence with mission drivers and checkpoints (game/singleplayer.mjs + game/campaign-data.mjs); a bot-only preview never advances the script.',
 }),
 'cocs-coop':Object.freeze({
  reason:'co-op-operation',
  detail:'OPERATIONS is a Director-driven co-op siege: an idle bot preview has no human team to clear waves and would only demonstrate the Director spawner, not the mode.',
 }),
});

export const demoModeEligible=mode=>typeof mode==='string'&&!DEMO_MODE_EXCLUSIONS[mode]&&MODE_IDS.includes(mode)&&mapsForMode(mode).length>0;

// `legacy` defaults to true for the catalog/eligibility helpers (the full
// registry view); `pickNext` and `scenarioSpec` default to false to match the
// app's active-arena default. Callers that know the player's setting pass it.
export function pairEligibility(mode,mapId,{legacy=true}={}){
 if(!MODE_IDS.includes(mode))return {eligible:false,reason:'unknown-mode',detail:`'${String(mode)}' is not a registered game mode.`};
 if(DEMO_MODE_EXCLUSIONS[mode])return {eligible:false,reason:DEMO_MODE_EXCLUSIONS[mode].reason,detail:DEMO_MODE_EXCLUSIONS[mode].detail};
 if(!MAP_ID_SET.has(mapId))return {eligible:false,reason:'unknown-map',detail:`'${String(mapId)}' is not in the map registry.`};
 if(!arenaSupportsMode(mapId,mode))return {eligible:false,reason:'mode-map-incompatible',detail:`${EXCLUSION_REASONS['mode-map-incompatible']} (${mode} on ${mapId})`};
 if(!legacy&&arenaMeta(mapId)?.legacy===true)return {eligible:false,reason:'legacy-disabled',detail:`${EXCLUSION_REASONS['legacy-disabled']} (${mapId})`};
 return {eligible:true,reason:null,detail:`${mode} can run autonomously on ${mapId}.`};
}

// Every drop with a reason: excluded modes, maps no eligible mode can host, and
// every rejected (mode, map) pair. `legacy` follows the same default as
// pairEligibility: true means legacy arenas are part of the world.
export function exclusionReport({legacy=true}={}){
 const modes=GAME_MODES.filter(mode=>DEMO_MODE_EXCLUSIONS[mode.id]).map(mode=>({mode:mode.id,reason:DEMO_MODE_EXCLUSIONS[mode.id].reason,detail:DEMO_MODE_EXCLUSIONS[mode.id].detail}));
 const maps=MAPS.filter(map=>!GAME_MODES.some(mode=>!DEMO_MODE_EXCLUSIONS[mode.id]&&arenaSupportsMode(map.id,mode.id))).map(map=>({mapId:map.id,reason:'no-eligible-mode',detail:`${EXCLUSION_REASONS['no-eligible-mode']} (${map.id})`}));
 const pairs=[];
 for(const mode of GAME_MODES)for(const map of MAPS){
  const verdict=pairEligibility(mode.id,map.id,{legacy});
  if(!verdict.eligible)pairs.push({mode:mode.id,mapId:map.id,reason:verdict.reason,detail:verdict.detail});
 }
 const catalog=completeCatalog({legacy});
 return {
  legacy,
  modes,
  maps,
  pairs,
  summary:{
   modes:GAME_MODES.length,
   eligibleModes:GAME_MODES.length-modes.length,
   excludedModes:modes.length,
   maps:MAPS.length,
   mapsWithoutEligibleMode:maps.length,
   allPairs:GAME_MODES.length*MAPS.length,
   eligiblePairs:catalog.length,
   excludedPairs:pairs.length,
  },
 };
}

// ---------------------------------------------------------------------------
// Catalogs.
// ---------------------------------------------------------------------------
const COMPLETE_PROFILES=Object.freeze({
 'puma-race':Object.freeze({timeLimit:120}),
 'puma-soccer':Object.freeze({timeLimit:90}),
 'combined-arms':Object.freeze({timeLimit:75,seatVehicles:.7}),
});
const COMPLETE_TIME_LIMIT=60;
const CATALOG_CACHE=new Map();

// One scenario per compatible (mode, map) pair, in GAME_MODES then MAPS order so
// the catalog is stable. Legacy arenas are included by default; pass
// `legacy:false` to derive only the active rotation.
export function completeCatalog({legacy=true}={}){
 const key=`complete|${legacy?'legacy':'active'}`;
 if(CATALOG_CACHE.has(key))return CATALOG_CACHE.get(key);
 const scenarios=[];
 for(const mode of GAME_MODES){
  if(!demoModeEligible(mode.id))continue;
  const profile=COMPLETE_PROFILES[mode.id]??null;
  for(const map of mapsForMode(mode.id,{legacy})){
   scenarios.push(Object.freeze({
    id:`${mode.id}:${map.id}`,
    label:`${mode.name} · ${map.name}`,
    category:DEMO_CATEGORY_BY_MODE[mode.id]??'infantry',
    source:'complete',
    mode:mode.id,
    maps:Object.freeze([map.id]),
    bots:profile?.bots??recommendedBots(mode.id,map.id),
    difficulty:'normal',
    timeLimit:profile?.timeLimit??COMPLETE_TIME_LIMIT,
    fragLimit:modeRule(mode.id).fragLimit??15,
    seatVehicles:profile?.seatVehicles??0,
   }));
  }
 }
 const catalog=Object.freeze(scenarios);
 CATALOG_CACHE.set(key,catalog);
 return catalog;
}

export function demoCatalog(rotation='curated',{legacy=false}={}){
 return rotation==='complete'?completeCatalog({legacy}):CURATED_SCENARIOS;
}

// ---------------------------------------------------------------------------
// Scenario specs. `scenarioSpec` is the one place a scenario definition becomes
// a match-ready spec, preserving the original showcase behaviour (map pool
// preferred -> any playable -> authored fallback, bots clamped to the mode cap)
// while accepting optional settings overrides and coverage hints.
// ---------------------------------------------------------------------------
export const scenarioMaps=scenario=>Array.isArray(scenario?.maps)?scenario.maps:(typeof scenario?.mapId==='string'?[scenario.mapId]:[]);

export function mapEligible(mapId,mode,{legacy=false}={}){
 if(!arenaSupportsMode(mapId,mode))return false;
 return legacy||arenaMeta(mapId)?.legacy!==true;
}

export function curatedMapPool(scenario,{legacy=false}={}){
 const authored=scenarioMaps(scenario),mode=scenario?.mode;
 if(!mode||!authored.length)return authored.slice();
 const playable=activeMaps({legacy}).filter(map=>arenaSupportsMode(map.id,mode));
 const preferred=playable.filter(map=>authored.includes(map.id));
 if(preferred.length)return preferred.map(map=>map.id);
 if(playable.length)return playable.map(map=>map.id);
 return authored.slice();
}

export function chooseScenarioMap(scenario,rng=Math.random,{legacy=false,usedMaps=null,avoidMap=null}={}){
 const authored=scenarioMaps(scenario);
 const pool=scenario?.source==='complete'?authored.filter(mapId=>mapEligible(mapId,scenario.mode,{legacy})):curatedMapPool(scenario,{legacy});
 if(!pool.length)return authored[0]??null;
 if(!usedMaps&&!avoidMap)return pool[Math.min(pool.length-1,Math.floor(rng()*pool.length))];
 const usage=usedMaps||{};
 let candidates=avoidMap?pool.filter(mapId=>mapId!==avoidMap):pool.slice();
 if(!candidates.length)candidates=pool.slice();
 let least=Infinity;
 for(const mapId of candidates)least=Math.min(least,usage[mapId]||0);
 const tier=candidates.filter(mapId=>(usage[mapId]||0)===least);
 return tier[Math.min(tier.length-1,Math.floor(rng()*tier.length))];
}

export function scenarioSpec(scenario,rng=Math.random,{legacy=false,settings=null,usedMaps=null,avoidMap=null,forceMapId=null}={}){
 if(!scenario||typeof scenario!=='object')throw new Error('scenarioSpec needs a scenario definition');
 const authored=scenarioMaps(scenario);
 const forced=typeof forceMapId==='string'&&authored.includes(forceMapId)?forceMapId:null;
 const mapId=forced??chooseScenarioMap(scenario,rng,{legacy,usedMaps,avoidMap})??'exchange';
 const resolved=settings?normalizeDemoSettings(settings):null;
 const cap=maxBotsFor(scenario.mode);
 const rawBots=resolved&&resolved.botCount!==null?resolved.botCount:scenario.bots;
 const botCount=Math.max(0,Math.min(cap,Math.round(Number.isFinite(rawBots)?rawBots:0)));
 const difficulty=resolved?.difficulty??(DIFFICULTY_IDS.includes(scenario.difficulty)?scenario.difficulty:'normal');
 return {
  id:scenario.id,
  label:scenario.label,
  mode:scenario.mode,
  mapId,
  botCount,
  difficulty,
  timeLimit:scenario.timeLimit,
  fragLimit:scenario.fragLimit,
  seatVehicles:scenario.seatVehicles??0,
  category:scenario.category??DEMO_CATEGORY_BY_MODE[scenario.mode]??null,
  source:scenario.source??'curated',
 };
}

// ---------------------------------------------------------------------------
// RNG helpers. `seededRng` (mulberry32) makes a fixed reel reproducible in
// tests and dev builds without pulling in a dependency.
// ---------------------------------------------------------------------------
export function seededRng(seed=1){
 let a=(Math.round(Number(seed))||0)>>>0;
 return function(){
  a=(a+0x6D2B79F5)>>>0;
  let t=a;
  t=Math.imul(t^(t>>>15),1|t);
  t=(t+Math.imul(t^(t>>>7),61|t))^t;
  return ((t^(t>>>14))>>>0)/4294967296;
 };
}

function shuffleInPlace(list,rng){
 for(let i=list.length-1;i>0;i--){
  const j=Math.min(i,Math.floor(rng()*(i+1)));
  const swap=list[i];list[i]=list[j];list[j]=swap;
 }
 return list;
}

export function shuffleIndices(length,rng=Math.random){
 return shuffleInPlace(Array.from({length:Math.max(0,Math.round(length))},(_,index)=>index),rng);
}

// ---------------------------------------------------------------------------
// Rotation state. Plain JSON-safe data; every exported mutator returns a fresh
// copy. `pending` holds the shuffled ids left in the current pass, `passCounts`
// tracks what the current pass has shown (including pinned/requested picks) so
// choices stay balanced, and `totals` keeps lifetime coverage for the record.
// ---------------------------------------------------------------------------
function emptyCounts(){return {modes:{},maps:{},categories:{}};}
function cloneCounts(counts){
 return {modes:{...(counts?.modes??{})},maps:{...(counts?.maps??{})},categories:{...(counts?.categories??{})}};
}
function bumpCounts(counts,scenario,mapId){
 counts.modes[scenario.mode]=(counts.modes[scenario.mode]||0)+1;
 counts.maps[mapId]=(counts.maps[mapId]||0)+1;
 if(scenario.category)counts.categories[scenario.category]=(counts.categories[scenario.category]||0)+1;
}

function normalizePin(pin){
 if(!pin||typeof pin!=='object')return null;
 const scenarioId=typeof pin.scenarioId==='string'&&pin.scenarioId?pin.scenarioId:null;
 const mode=typeof pin.mode==='string'&&pin.mode?pin.mode:null;
 const mapId=typeof pin.mapId==='string'&&pin.mapId?pin.mapId:null;
 return scenarioId||mode||mapId?{scenarioId,mode,mapId}:null;
}

const describePin=pin=>pin.scenarioId??[pin.mode,pin.mapId].filter(Boolean).join(' · ');

function cloneRotationState(state,rotation=null){
 const base=state&&typeof state==='object'?state:{};
 const resolved=ROTATIONS.includes(rotation)?rotation:(ROTATIONS.includes(base.rotation)?base.rotation:'curated');
 return {
  version:1,
  rotation:resolved,
  pin:normalizePin(base.pin),
  catalogKey:typeof base.catalogKey==='string'?base.catalogKey:null,
  pass:Number.isFinite(base.pass)?Math.max(0,Math.round(base.pass)):0,
  pending:Array.isArray(base.pending)?base.pending.filter(id=>typeof id==='string'):[],
  passCounts:cloneCounts(base.passCounts),
  totals:cloneCounts(base.totals),
  lastId:typeof base.lastId==='string'?base.lastId:null,
  lastMap:typeof base.lastMap==='string'?base.lastMap:null,
  picks:Number.isFinite(base.picks)?Math.max(0,Math.round(base.picks)):0,
  pinPicks:Number.isFinite(base.pinPicks)?Math.max(0,Math.round(base.pinPicks)):0,
  requestPicks:Number.isFinite(base.requestPicks)?Math.max(0,Math.round(base.requestPicks)):0,
  resumed:base.resumed===true,
 };
}

export function createRotationState({rotation='curated',pin=null}={}){
 return cloneRotationState({rotation,pin});
}

export function setRotationMode(state,rotation){
 const next=cloneRotationState(state,ROTATIONS.includes(rotation)?rotation:null);
 return next;
}

export function pinScenario(state,pin){
 const next=cloneRotationState(state);
 next.pin=normalizePin(pin);
 next.resumed=false;
 return next;
}

export function releasePin(state){
 const next=cloneRotationState(state);
 next.pin=null;
 next.resumed=true;
 return next;
}

function startPass(state,catalog,key,rng){
 const ids=catalog.map(scenario=>scenario.id);
 shuffleInPlace(ids,rng);
 // A fresh pass should not open on the scenario that just played when another
 // candidate exists, so the "never repeats back-to-back" rule survives the
 // pass boundary too.
 if(ids.length>1&&ids[0]===state.lastId){
  const swapAt=ids.findIndex((id,index)=>index>0&&id!==state.lastId);
  if(swapAt>0){const swap=ids[0];ids[0]=ids[swapAt];ids[swapAt]=swap;}
 }
 state.catalogKey=key;
 state.pending=ids;
 state.pass+=1;
 state.passCounts=emptyCounts();
 return state;
}

const scoreOrder=(a,b)=>{const length=Math.max(a.length,b.length);for(let i=0;i<length;i++){const delta=(a[i]??0)-(b[i]??0);if(delta)return delta;}return 0;};

function candidateScore(scenario,passCounts,index,{lastId=null,lastMap=null}={}){
 const maps=scenarioMaps(scenario);
 let mapUse=0;
 if(maps.length){mapUse=Math.min(...maps.map(mapId=>passCounts.maps[mapId]||0));}
 const repeatId=scenario.id===lastId?1:0;
 const repeatMap=maps.length&&lastMap&&maps.every(mapId=>mapId===lastMap)?1:0;
 return [passCounts.modes[scenario.mode]||0,repeatId,repeatMap,mapUse,index];
}

// Coverage-aware choice: least-used mode first, because a pass must show every
// mode before any repeat (full-pass mode coverage). Within that tier the last
// scenario and last map are avoided as tie-breaks, then least-used map, then the
// shuffled pass order. Filtering the avoid-last rules *before* scoring could
// hide the last unseen mode behind a repeated one, so they stay in the key.
function chooseEntry(entries,state){
 let best=null,bestScore=null;
 entries.forEach((entry,index)=>{
  const score=candidateScore(entry.scenario,state.passCounts,index,{lastId:state.lastId,lastMap:state.lastMap});
  if(!bestScore||scoreOrder(score,bestScore)<0){best=entry;bestScore=score;}
 });
 return best;
}

function pinEntries(pin,catalog){
 if(pin.scenarioId)return catalog.filter(scenario=>scenario.id===pin.scenarioId).map(scenario=>({scenario,forceMapId:null}));
 if(pin.mode&&pin.mapId)return catalog.filter(scenario=>scenario.mode===pin.mode&&scenarioMaps(scenario).includes(pin.mapId)).map(scenario=>({scenario,forceMapId:pin.mapId}));
 if(pin.mode)return catalog.filter(scenario=>scenario.mode===pin.mode).map(scenario=>({scenario,forceMapId:null}));
 if(pin.mapId)return catalog.filter(scenario=>scenarioMaps(scenario).includes(pin.mapId)).map(scenario=>({scenario,forceMapId:pin.mapId}));
 return [];
}

function coverageRecord(state,{rotation,legacy,catalog,current,resumed,afterEnd}){
 return {
  rotation,
  legacy,
  pass:state.pass,
  catalogSize:catalog.length,
  remaining:state.pending.length,
  picks:state.picks,
  pinPicks:state.pinPicks,
  requestPicks:state.requestPicks,
  current:current?{id:current.id,mode:current.mode,mapId:current.mapId,category:current.category}:null,
  totals:cloneCounts(state.totals),
  passCounts:cloneCounts(state.passCounts),
  pending:state.pending.slice(),
  lastId:state.lastId,
  lastMap:state.lastMap,
  afterEnd:afterEnd===true,
  pin:state.pin?{...state.pin}:null,
  resumed:resumed===true,
 };
}

function describePick(reason,spec,{invalidPin=null,invalidRequest=null}={}){
 const target=`${spec.mode} on ${spec.mapId}`;
 if(reason==='first')return `Opening the reel with ${target}.`;
 if(reason==='advance')return `Previous scenario finished; advancing to ${target}.`;
 if(reason==='skip')return `Skipping ahead to ${target}.`;
 if(reason==='pin')return `Manual pin held on ${target}.`;
 if(reason==='request')return `Manual request served: ${target}.`;
 if(reason==='pin-invalid')return `${invalidPin?.detail??'The pinned scenario is unavailable.'} Continuing with ${target}.`;
 if(reason==='request-invalid')return `${invalidRequest?.detail??'The requested scenario is unavailable.'} Continuing with ${target}.`;
 return target;
}

// ---------------------------------------------------------------------------
// The public pick API. Options:
//   rng          injected random source (default Math.random)
//   rotation     'curated' | 'complete'; `mode` is accepted as an alias
//   mode         rotation alias when 'curated'/'complete', otherwise a one-shot
//                game-mode request (e.g. 'ctf')
//   mapId        one-shot map request
//   scenarioId   one-shot exact-scenario request
//   legacy       include legacy arenas in the catalog
//   afterEnd     true when the previous scenario ran to completion
//   settings     normalized demo settings (botCount/difficulty override)
// Returns {scenario, reason, details, scenarioSeconds, coverage, invalidPin,
// invalidRequest, state}; the input state is never mutated.
// ---------------------------------------------------------------------------
export function pickNext(state,options={}){
 const rng=typeof options.rng==='function'?options.rng:Math.random;
 const legacy=options.legacy===true;
 const rotationOption=ROTATIONS.includes(options.rotation)?options.rotation:(ROTATIONS.includes(options.mode)?options.mode:null);
 const gameModeRequest=typeof options.mode==='string'&&!ROTATIONS.includes(options.mode)?options.mode:null;
 const settings=normalizeDemoSettings(options.settings);
 let next=cloneRotationState(state,rotationOption);
 const catalog=demoCatalog(next.rotation,{legacy});
 if(!catalog.length){
  return {scenario:null,reason:'no-scenarios',details:`No ${next.rotation} scenarios are eligible with legacy arenas ${legacy?'enabled':'disabled'}.`,scenarioSeconds:settings.scenarioSeconds,coverage:coverageRecord(next,{rotation:next.rotation,legacy,catalog,current:null,resumed:next.resumed,afterEnd:options.afterEnd===true}),invalidPin:null,invalidRequest:null,state:next};
 }
 const catalogKey=`${next.rotation}|${legacy?'legacy':'active'}`;
 if(next.catalogKey!==catalogKey||!next.pending.length)startPass(next,catalog,catalogKey,rng);

 const pin=normalizePin(next.pin);
 const request=normalizePin({scenarioId:options.scenarioId,mode:gameModeRequest,mapId:options.mapId});
 let entry=null,reason=null,invalidPin=null,invalidRequest=null;
 let fromPass=false,viaPin=false,viaRequest=false;
 if(pin){
  const entries=pinEntries(pin,catalog);
  if(entries.length){entry=chooseEntry(entries,next);reason='pin';viaPin=true;}
  else invalidPin={pin:{...pin},reason:'pin-invalid',detail:`'${describePin(pin)}' is not eligible in the ${next.rotation} catalog${legacy?'':' with legacy arenas disabled'}; the rotation falls back until it becomes valid again.`};
 }
 if(!entry&&request){
  const entries=pinEntries(request,catalog);
  if(entries.length){entry=chooseEntry(entries,next);reason='request';viaRequest=true;}
  else invalidRequest={request:{...request},reason:'request-invalid',detail:`'${describePin(request)}' is not eligible in the ${next.rotation} catalog${legacy?'':' with legacy arenas disabled'}.`};
 }
 if(!entry){
  const byId=new Map(catalog.map(scenario=>[scenario.id,scenario]));
  const pending=next.pending.map(id=>byId.get(id)).filter(Boolean);
  const entries=(pending.length?pending:catalog).map(scenario=>({scenario,forceMapId:null}));
  entry=chooseEntry(entries,next);
  fromPass=true;
  if(invalidPin)reason='pin-invalid';
  else if(invalidRequest)reason='request-invalid';
  else if(next.picks===0)reason='first';
  else reason=options.afterEnd===true?'advance':'skip';
 }

 const spec=scenarioSpec(entry.scenario,rng,{legacy,settings,usedMaps:next.passCounts.maps,avoidMap:fromPass?next.lastMap:null,forceMapId:entry.forceMapId});
 if(fromPass)next.pending=next.pending.filter(id=>id!==entry.scenario.id);
 bumpCounts(next.passCounts,entry.scenario,spec.mapId);
 bumpCounts(next.totals,entry.scenario,spec.mapId);
 next.lastId=entry.scenario.id;
 next.lastMap=spec.mapId;
 if(fromPass)next.picks+=1;
 else if(viaPin)next.pinPicks+=1;
 else if(viaRequest)next.requestPicks+=1;
 const resumed=next.resumed;
 next.resumed=false;
 const coverage=coverageRecord(next,{rotation:next.rotation,legacy,catalog,current:spec,resumed,afterEnd:options.afterEnd===true});
 return {scenario:spec,reason,details:describePick(reason,spec,{invalidPin,invalidRequest}),scenarioSeconds:settings.scenarioSeconds,coverage,invalidPin,invalidRequest,state:next};
}
