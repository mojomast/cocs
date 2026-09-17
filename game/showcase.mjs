// The title screen loops a reel of hand-picked scenarios chosen to show the
// game off: tight infantry duels, objective pushes on the biggest maps, rolling
// armour and the two car modes. The definitions now live in demo-playlist.mjs
// (the curated rotation catalog); this module keeps the historical export
// surface that showcase-build.mjs, app/page.tsx and the tests rely on. The order
// is reshuffled every cycle (see `shuffleShowcaseReel`) so the menu never opens
// on the same scenario twice in a row, and every scenario's map list is curated
// for looks and playability.
import {vehicleSeatFor,vehicleMounted} from './vehicles.mjs';
import {CURATED_SCENARIOS,DEFAULT_SCENARIO_SECONDS,scenarioSpec,shuffleIndices} from './demo-playlist.mjs';

export const SHOWCASES=CURATED_SCENARIOS;
// Never let one scenario hog the menu: advance after this many real seconds even
// if the bot match has not finished. Kept in step with the demo settings default.
export const SHOWCASE_MAX_SECONDS=DEFAULT_SCENARIO_SECONDS;

export const wrap=(index,n)=>((Math.round(index)%n)+n)%n;

// Build a match-ready spec for a scenario definition: map pool resolution
// (preferred -> any playable -> authored fallback) and bot clamping now live in
// demo-playlist.mjs so the rotation and this index API share one implementation.
export function specFor(scenario,random=Math.random,{legacy=false}={}){
 return scenarioSpec(scenario,random,{legacy});
}

// Deterministic index-based pick, used by tests and callers that want a fixed
// scenario. `pickNext` from demo-playlist.mjs is what the rotation uses.
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
 return shuffleIndices(SHOWCASES.length,random);
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
