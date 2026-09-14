import {ISLAND_MAPS} from './island-maps.mjs';
import BLOOD_GULCH from './blood-gulch.mjs';
import {EXPANSION_MAPS} from './expansion-maps.mjs';
import {CTF_MAPS} from './ctf-maps.mjs';
import {BATTLE_MAPS} from './battle-maps.mjs';
import {ARSENAL_MAPS} from './arsenal-maps.mjs';
import {NEXTGEN_MAPS} from './nextgen-maps.mjs';
import {RACE_MAPS} from './race-maps.mjs';
import {PUMA_PITCH} from './soccer-maps.mjs';
import {freeze,wall,cover} from './map-schema.mjs';

// Map definitions are immutable templates. Each Match owns its own collision and navigation context.
const shell=[wall(-14.5,0,1,30),wall(14.5,0,1,30),wall(0,14.5,30,1),wall(0,-14.5,30,1)];
const deck=[wall(0,-12,28,6,3.8,'deck'),wall(-8.05,-3,.25,12,4.4,'rampwall'),wall(8.05,-3,.25,12,4.4,'rampwall')];
const upperSpawns=[[-11,10],[11,10],[0,12],[-11,-12],[11,-12],[0,-12],[-4,9],[4,9]];
const upperTeamSpawns={0:[[-11,10],[-11,-12],[-4,9]],1:[[11,10],[11,-12],[4,9]]};
// CTF metadata uses teamSpawns: {team:[[x,z],...]} and flagSpawns: {team:{x,z}}.
const launchpadShell=[wall(-23.5,0,1,32),wall(23.5,0,1,32),wall(0,15.5,48,1),wall(0,-15.5,48,1)];
const launchpadSpawns={red:[[-19,-11],[-19,11]],blue:[[19,-11],[19,11]]};
const launchpadFlags={red:{x:-20,z:0},blue:{x:20,z:0}};
const launchpadLaunchers=[[-12,0,[1,0]],[12,0,[-1,0]],[0,-13,[0,1]],[0,13,[0,-1]]].map(([x,z,dir],i)=>({id:`launchpad-boost-${i}`,x,z,y:0,dir,power:30,vy:14,cooldown:2,target:{x:-x||0,z:-z||0,y:0}}));
const launchpad={id:'launchpad',name:'Launchpad',tag:'CTF / LONG RANGE',description:'A broad symmetric flight deck with protected bases and cross-arena launch routes.',color:'#68c8ff',background:'#07131f',raised:false,bounds:{minX:-24,maxX:24,minZ:-16,maxZ:16},teamSpawns:launchpadSpawns,flagSpawns:launchpadFlags,flags:launchpadFlags,blocks:[cover(-14,-6,4,1.5,2.3),cover(14,6,4,1.5,2.3),cover(-7,7,3,2,2.2),cover(7,-7,3,2,2.2),cover(0,0,3,3,3),...launchpadShell],spawns:[...launchpadSpawns.red,...launchpadSpawns.blue,[0,12],[0,-5]],pickups:[['health',-17,7],['health',17,-7],['armor',-12,2],['armor',12,-2],['rocket',-4,12],['rocket',4,-12],['rail',0,8],['rail',0,4],['scatter',-16,-2],['scatter',16,2],['plasma',-4,-2],['plasma',4,2],['grenade',-20,5],['shock',20,-5],['flak',0,6],['haste',-13,10],['overcharge',13,-10],['overshield',0,2.25],['megahealth',0,10],['ammo',-12,5]],traversal:{trampolines:[{x:-16,z:-8,power:15,cooldown:2},{x:16,z:-8,power:15,cooldown:2},{x:-16,z:8,power:15,cooldown:2},{x:16,z:8,power:15,cooldown:2}],boostLaunchers:launchpadLaunchers},jumpLinks:launchpadLaunchers.map(p=>({id:p.id,source:{x:p.x,z:p.z,y:p.y},target:p.target,traversal:p.id}))};
const citadelShell=[wall(-19.5,0,1,28),wall(19.5,0,1,28),wall(0,13.5,40,1),wall(0,-13.5,40,1)];
const citadel={id:'citadel',name:'Citadel',tag:'LANES / FORTRESS',description:'Twin fortress lanes wrap around a central keep with long and short routes.',color:'#d9a35f',background:'#17100c',raised:false,bounds:{minX:-20,maxX:20,minZ:-14,maxZ:14},teamSpawns:{0:[[-16,-9],[-16,9],[-12,0]],1:[[16,-9],[16,9],[12,0]]},flagSpawns:{0:{x:-16,z:0},1:{x:16,z:0}},blocks:[wall(-6,0,3,8,6,'reactor'),wall(6,0,3,8,6,'reactor'),cover(-13,5,3,2,2.5),cover(13,-5,3,2,2.5),cover(-13,-5,3,2,2.5),cover(13,5,3,2,2.5),cover(0,0,3,2,2),...citadelShell],spawns:[[-16,-9],[16,-9],[-16,9],[16,9],[-12,0],[12,0],[0,-11],[0,11]],pickups:[['health',-16,0],['health',16,0],['armor',-11,10],['armor',11,-10],['rocket',-2,11],['rocket',2,-11],['rail',0,5],['rail',0,-5],['scatter',-11,-10],['scatter',11,10],['plasma',-2,3],['plasma',2,-3],['grenade',-15.25,4],['shock',15.25,-4],['flak',0,6],['haste',-10,-10],['overcharge',10,10],['overshield',0,-5],['megahealth',0,11],['ammo',-15,0]]};
export const MAPS=[
 {id:'exchange',name:'The Exchange',tag:'REACTOR / VERTICAL',description:'Twin ramps, a raised gantry, and a central reactor. Control the high ground.',color:'#5dcbbc',background:'#090f17',raised:true,blocks:[wall(0,0,4,4,5.4,'reactor'),cover(-6,5,3,1.4,1.9),cover(6,5,3,1.4,1.9),cover(-5,-5,2.2,1.4,2.1),cover(5,-5,2.2,1.4,2.1),...deck,...shell],spawns:upperSpawns,teamSpawns:upperTeamSpawns,pickups:[['health',-11,7],['health',11,7],['armor',0,7],['rocket',-4,0],['plasma',4,0],['rail',0,-12],['health',-6,-12],['armor',6,-12],['scatter',0,11],['megahealth',0,11],['ammo',-11,-7]]},
 {id:'crosswire',name:'Crosswire',tag:'CROSSROADS / CLOSE QUARTERS',description:'Four staggered bunkers split an open crossroads. Cut corners and ambush with the scattergun.',color:'#a998ff',background:'#101020',raised:false,blocks:[cover(-5,-5,5,3,3.3),cover(5,5,5,3,3.3),cover(-5,5,3,5,3.3),cover(5,-5,3,5,3.3),cover(0,0,1.4,1.4,1.7),...shell],spawns:[[-11,11],[11,11],[-11,-11],[11,-11],[0,12],[0,-12],[-12,0],[12,0]],teamSpawns:{0:[[-11,11],[-11,-11],[-12,0]],1:[[11,11],[11,-11],[12,0]]},pickups:[['health',-11,0],['health',11,0],['armor',0,10],['rocket',-10,-10],['rail',0,-11],['scatter',0,4],['plasma',10,10],['health',-10,10],['armor',10,-10],['megahealth',0,-4],['ammo',-11,4]]},
  {id:'foundry',name:'The Foundry',tag:'TWIN CORES / LONG SIGHTLINES',description:'Orange furnace towers divide three firing lanes. Take the gantry or push through the center.',color:'#ffab65',background:'#1b1210',raised:true,blocks:[wall(-4,0,2.8,5,5.7,'reactor'),wall(4,0,2.8,5,5.7,'reactor'),cover(-4,7,3,1.3,1.8),cover(4,7,3,1.3,1.8),cover(0,-5,2,1.3,1.8),...deck,...shell],spawns:upperSpawns,teamSpawns:upperTeamSpawns,pickups:[['health',-11,7],['health',11,7],['armor',0,5],['rocket',0,0],['rail',-5,-12],['plasma',5,-12],['scatter',0,11],['health',0,-12],['armor',-6,-5],['megahealth',0,11],['ammo',-11,-7]]},
  launchpad,
 citadel,
  BLOOD_GULCH,
  ...ISLAND_MAPS,
  ...EXPANSION_MAPS,
  ...CTF_MAPS,
  ...BATTLE_MAPS,
  ...ARSENAL_MAPS,
   ...NEXTGEN_MAPS,
   ...RACE_MAPS,
   PUMA_PITCH,
];
freeze(MAPS);
export const getMap=id=>MAPS.find(m=>m.id===id)||MAPS[0];
export const pickupWeapon=kind=>({rocket:1,rail:2,scatter:3,plasma:4,grenade:5,shock:6,flak:7,marksman:8,smg:9})[kind];
// Non-weapon supply pickups. `ammo` refills the actor's current weapon (its
// `weapon` field names which), `megahealth` overcharges health and armor.
export const SUPPLY_KINDS=Object.freeze(['health','armor','ammo','megahealth']);
