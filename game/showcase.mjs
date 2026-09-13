import {activeMaps,maxBotsFor} from './arenas.mjs';
import {vehicleSeatFor,vehicleMounted} from './vehicles.mjs';

// The title screen loops a full eight-driver Puma Circuit race.
export const SHOWCASES=[
 {id:'puma-race',label:'Puma Circuit',mode:'puma-race',maps:['puma-circuit'],bots:7,difficulty:'normal',timeLimit:180,fragLimit:2,seatVehicles:0},
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
