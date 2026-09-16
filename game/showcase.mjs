import {activeMaps,maxBotsFor,arenaSupportsMode} from './arenas.mjs';
import {vehicleSeatFor,vehicleMounted} from './vehicles.mjs';

// The title screen loops a reel of hand-picked scenarios chosen to show the game
// off: tight infantry duels, objective pushes on the biggest maps, rolling armour
// and the two car modes. The order is reshuffled every cycle (see
// `shuffleShowcaseReel`) so the menu never opens on the same scenario twice in a
// row, and every scenario's map list is curated for looks and playability.
export const SHOWCASES=[
 {id:'deathmatch',label:'Deathmatch',mode:'deathmatch',maps:['colosseum','forge','substation','dune-ravine','atrium','crosswire'],bots:7,difficulty:'normal',timeLimit:60,fragLimit:10,seatVehicles:0},
 {id:'teamdeathmatch',label:'Team Deathmatch',mode:'teamdeathmatch',maps:['titan-valley','warfront','atrium','riverbend','crosswire'],bots:8,difficulty:'normal',timeLimit:60,fragLimit:20,seatVehicles:0},
 {id:'ctf',label:'Capture the Flag',mode:'ctf',maps:['frost-gate','skybreak','launchpad','citadel','blood-gulch'],bots:8,difficulty:'normal',timeLimit:60,fragLimit:2,seatVehicles:0},
 {id:'koth',label:'King of the Hill',mode:'koth',maps:['colosseum','skyfall-basin','sunken-hill','forge'],bots:7,difficulty:'normal',timeLimit:60,fragLimit:60,seatVehicles:0},
 {id:'domination',label:'Domination',mode:'domination',maps:['warfront','titan-valley','convoy-line','frost-gate'],bots:8,difficulty:'normal',timeLimit:60,fragLimit:100,seatVehicles:0},
 {id:'combined-arms',label:'Combined Arms',mode:'combined-arms',maps:['warfront','skyfall-basin','titan-valley','trenchline'],bots:12,difficulty:'normal',timeLimit:75,fragLimit:100,seatVehicles:.7},
 {id:'payload',label:'Payload',mode:'payload',maps:['convoy-line','derelict-station','frost-gate','launchpad'],bots:6,difficulty:'normal',timeLimit:60,fragLimit:2,seatVehicles:0},
 {id:'juggernaut',label:'Juggernaut',mode:'juggernaut',maps:['throne'],bots:7,difficulty:'normal',timeLimit:60,fragLimit:30,seatVehicles:0},
 {id:'team-elimination',label:'Team Elimination',mode:'team-elimination',maps:['gauntlet'],bots:8,difficulty:'normal',timeLimit:60,fragLimit:8,seatVehicles:0},
 {id:'puma-race',label:'Puma Circuit',mode:'puma-race',maps:['puma-circuit'],bots:7,difficulty:'normal',timeLimit:120,fragLimit:1,seatVehicles:0},
 {id:'puma-soccer',label:'Puma Soccer',mode:'puma-soccer',maps:['puma-pitch'],bots:3,difficulty:'normal',timeLimit:90,fragLimit:2,seatVehicles:0},
];
// Never let one scenario hog the menu: advance after this many real seconds even
// if the bot match has not finished.
export const SHOWCASE_MAX_SECONDS=75;

const wrap=(index,n)=>((Math.round(index)%n)+n)%n;

// Active maps that can actually host the scenario's mode, preferring the
// curated list. Falls back to any playable map, and finally the curated list, so
// a scenario always resolves to a real match rather than an empty preview.
function mapPool(scenario,{legacy=false}={}){
 const available=activeMaps({legacy});
 const playable=available.filter(map=>arenaSupportsMode(map.id,scenario.mode));
 const preferred=playable.filter(map=>scenario.maps.includes(map.id));
 if(preferred.length)return preferred;
 if(playable.length)return playable;
 return scenario.maps.slice();
}

function specFor(scenario,random,{legacy=false}={}){
 const pool=mapPool(scenario,{legacy});
 const chosen=pool.length?pool[Math.min(pool.length-1,Math.floor(random()*pool.length))]:null;
 const mapId=chosen&&typeof chosen==='object'?chosen.id:(typeof chosen==='string'?chosen:'exchange');
 const botCount=Math.max(0,Math.min(maxBotsFor(scenario.mode),Math.round(scenario.bots)));
 return {id:scenario.id,label:scenario.label,mode:scenario.mode,mapId,botCount,difficulty:scenario.difficulty,timeLimit:scenario.timeLimit,fragLimit:scenario.fragLimit,seatVehicles:scenario.seatVehicles};
}

// Deterministic index-based pick, used by tests and callers that want a fixed
// scenario. `pickRandomShowcase` is what the live title screen uses.
export function pickShowcase(index,random=Math.random,{legacy=false}={}){
 const n=SHOWCASES.length;
 return specFor(SHOWCASES[wrap(index,n)],random,{legacy});
}

// Random cherry-pick for the menu reel. `exclude` names the previous scenario id
// so the demo never repeats back-to-back when another option exists.
export function pickRandomShowcase(random=Math.random,{legacy=false,exclude=null}={}){
 const choices=SHOWCASES.filter(scenario=>scenario.id!==exclude);
 const list=choices.length?choices:SHOWCASES;
 const scenario=list[Math.min(list.length-1,Math.floor(random()*list.length))];
 return specFor(scenario,random,{legacy});
}

// A shuffled walk over every scenario so a full cycle shows all the modes before
// repeating, but in a different order each time. Deterministic for a given rng.
export function shuffleShowcaseReel(random=Math.random){
 const reel=SHOWCASES.map((_,index)=>index);
 for(let i=reel.length-1;i>0;i--){
  const j=Math.min(i,Math.floor(random()*(i+1)));
  [reel[i],reel[j]]=[reel[j],reel[i]];
 }
 return reel;
}

// Move a share of bots straight into seats so the demo opens with rolling
// armour and aircraft instead of waiting for pathfinding to find the garage.
export function seatShowcaseVehicles(match,fraction=.7){
 if(!match?.vehicles?.length||!match.actors?.length)return 0;
 const limit=Math.max(1,Math.round(match.actors.length*Math.max(0,Math.min(1,fraction))));
 let seated=0;
 for(const actor of match.actors){
  if(seated>=limit)break;
  if(!actor.bot||actor.health<=0||actor.vehicleId!=null)continue;
  const vehicle=match.vehicles.find(candidate=>vehicleSeatFor(candidate)&&!vehicleMounted(candidate,actor.id));
  if(!vehicle)break;
  Object.assign(actor,{x:vehicle.position.x,y:vehicle.position.y,z:vehicle.position.z,grounded:true});
  if(match.enterVehicle(actor))seated++;
 }
 return seated;
}
