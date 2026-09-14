import {activeMaps,maxBotsFor} from './arenas.mjs';
import {vehicleSeatFor,vehicleMounted} from './vehicles.mjs';

// The title screen loops a reel of distinct modes so the menu shows off combat,
// objective play, armour and the two car modes. Every few minutes (or when the
// current match ends) the next scenario is built and the camera switches rigs.
export const SHOWCASES=[
 {id:'puma-race',label:'Puma Circuit',mode:'puma-race',maps:['puma-circuit'],bots:7,difficulty:'normal',timeLimit:180,fragLimit:2,seatVehicles:0},
 {id:'puma-soccer',label:'Puma Soccer',mode:'puma-soccer',maps:['puma-pitch'],bots:7,difficulty:'normal',timeLimit:120,fragLimit:3,seatVehicles:0},
 {id:'deathmatch',label:'Deathmatch',mode:'deathmatch',maps:['colosseum','forge','substation','atrium','crosswire'],bots:7,difficulty:'normal',timeLimit:75,fragLimit:15,seatVehicles:0},
 {id:'teamdeathmatch',label:'Team Deathmatch',mode:'teamdeathmatch',maps:['warfront','titan-valley','atrium','riverbend','crosswire'],bots:8,difficulty:'normal',timeLimit:75,fragLimit:30,seatVehicles:0},
 {id:'ctf',label:'Capture the Flag',mode:'ctf',maps:['skybreak','frost-gate','launchpad','citadel','blood-gulch'],bots:8,difficulty:'normal',timeLimit:90,fragLimit:3,seatVehicles:0},
 {id:'koth',label:'King of the Hill',mode:'koth',maps:['colosseum','sunken-hill','skyfall-basin','forge'],bots:7,difficulty:'normal',timeLimit:75,fragLimit:100,seatVehicles:0},
 {id:'combined-arms',label:'Combined Arms',mode:'combined-arms',maps:['warfront','skyfall-basin','titan-valley','trenchline'],bots:12,difficulty:'normal',timeLimit:90,fragLimit:200,seatVehicles:.7},
 {id:'payload',label:'Payload',mode:'payload',maps:['frost-gate','derelict-station','convoy-line','launchpad','citadel'],bots:6,difficulty:'normal',timeLimit:90,fragLimit:3,seatVehicles:0},
];

export function pickShowcase(index,random=Math.random,{legacy=false}={}){
 const n=SHOWCASES.length;
 const scenario=SHOWCASES[((Math.round(index)%n)+n)%n];
 const available=new Set(activeMaps({legacy}).map(map=>map.id));
 const preferred=scenario.maps.filter(id=>available.has(id));
 const pool=preferred.length?preferred:[...available];
 const mapId=pool.length?pool[Math.min(pool.length-1,Math.floor(random()*pool.length))]:'exchange';
 const botCount=Math.max(4,Math.min(maxBotsFor(scenario.mode),Math.round(scenario.bots)));
 return {id:scenario.id,label:scenario.label,mode:scenario.mode,mapId,botCount,difficulty:scenario.difficulty,timeLimit:scenario.timeLimit,fragLimit:scenario.fragLimit,seatVehicles:scenario.seatVehicles};
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
