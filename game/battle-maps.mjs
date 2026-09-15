import {freeze,wall,cover,pad,tp,zone,teamSpawns,flagSpawns} from './map-schema.mjs';

const ceiling=(x,z,w,d,y=9,h=.6)=>({x,z,w,d,y,h});
const launch=(id,x,z,dir,power,target,y=0,vy=19)=>({id,x,z,y,dir,power,vy,cooldown:2,target});
const zip=(id,from,to,speed=15)=>({id,from,to,speed,cooldown:1.2});

const neonVertical={
 id:'neon-vertical',name:'Neon Vertical',tag:'URBAN / ROOFTOPS + ZIPLINES',
 description:'A neon city block with jump pads, rooftop ziplines and teleporters threading dense vertical firefights.',
 color:'#7fb2ff',background:'#0a0f1e',bounds:{minX:-48,maxX:48,minZ:-36,maxZ:36},
 teamSpawns:teamSpawns([[-44,-6],[-44,6],[-40,0]],[[44,-6],[44,6],[40,0]]),flagSpawns:flagSpawns(-46,46),
 spawns:[[-44,0],[44,0],[0,-32],[0,32],[-22,0],[22,0],[-40,-30],[40,30]],
 blocks:[
  wall(0,0,14,14,8,'tower'),
  wall(-30,-22,12,12,6,'building'),wall(30,-22,12,12,6,'building'),
  wall(-30,22,12,12,6,'building'),wall(30,22,12,12,6,'building'),
  wall(-12,-24,8,8,5,'building'),wall(12,24,8,8,5,'building'),
  cover(-16,0,4,2,1.8),cover(16,0,4,2,1.8),cover(0,-14,3,2,1.6),cover(0,14,3,2,1.6),
  cover(-24,8,3,2,2),cover(24,-8,3,2,2),cover(-8,-12,2,2,1.7),cover(8,12,2,2,1.7),
 ],
 pickups:[
  ['health',-42,-14],['health',42,14],['armor',-42,14],['armor',42,-14],
  ['rocket',-18,-18],['rocket',18,18],['rail',18,-18],['rail',-18,18],
  ['scatter',-10,0],['scatter',10,0],['plasma',-10,10],['plasma',10,-10],
  ['grenade',-34,-34],['shock',34,34],['flak',0,-20],['haste',-30,0],['overcharge',30,0],['overshield',0,10],
 ],
 objectiveZones:[zone(-30,0),zone(0,-16),zone(30,0)],
 traversal:{
  jumpPads:[pad('nv-hop-w',-40,0,16),pad('nv-hop-e',40,0,16),pad('nv-hop-n',0,-30,16),pad('nv-hop-s',0,30,16)],
  boostLaunchers:[
   launch('nv-up-nw',-38,-16,[1,0],26,{x:-30,y:6,z:-22},0,19),
   launch('nv-up-ne',38,-16,[-1,0],26,{x:30,y:6,z:-22},0,19),
   launch('nv-up-sw',-38,16,[1,0],26,{x:-30,y:6,z:22},0,19),
   launch('nv-up-se',38,16,[-1,0],26,{x:30,y:6,z:22},0,19),
  ],
  ziplines:[
   zip('nv-zip-nw',{x:-30,y:6,z:-26},{x:-6,y:0,z:-32}),
   zip('nv-zip-ne',{x:30,y:6,z:-26},{x:6,y:0,z:-32}),
   zip('nv-zip-sw',{x:-30,y:6,z:26},{x:-6,y:0,z:32}),
   zip('nv-zip-se',{x:30,y:6,z:26},{x:6,y:0,z:32}),
  ],
  teleporters:[tp('nv-tp-n',0,-30,0,30),tp('nv-tp-s',0,30,0,-30),tp('nv-tp-w',-44,0,44,0),tp('nv-tp-e',44,0,-44,0)],
 },
 navNodes:[[-40,0],[-30,0],[-16,0],[0,-16],[16,0],[30,0],[40,0],[0,16],[0,-30],[0,30],[-22,22],[22,-22]],
 landmarks:[{label:'NEON SPIRE',x:0,z:0,y:9},{label:'WEST BLOCK',x:-30,z:-22,y:7},{label:'EAST BLOCK',x:30,z:22,y:7}],
};

const substation={
 id:'substation',name:'Substation 7',tag:'INDOOR / BULKHEADS',
 description:'An enclosed substation of pillars, bulkheads and crates under a low ceiling, linked by service teleporters.',
 color:'#8fe0c4',background:'#0c1713',bounds:{minX:-44,maxX:44,minZ:-30,maxZ:30},
 teamSpawns:teamSpawns([[-38,-6],[-38,6],[-34,0]],[[38,-6],[38,6],[34,0]]),flagSpawns:flagSpawns(-40,40),
 spawns:[[-38,0],[38,0],[0,-25],[0,25],[-22,22],[22,-22],[-22,-22],[22,22]],
 blocks:[
  wall(0,-29,88,2,10),wall(0,29,88,2,10),wall(-43,0,2,58,10),wall(43,0,2,58,10),
  wall(-20,0,3,3,6,'pillar'),wall(20,0,3,3,6,'pillar'),wall(0,-14,3,3,6,'pillar'),wall(0,14,3,3,6,'pillar'),
  wall(-20,-16,3,3,6,'pillar'),wall(20,16,3,3,6,'pillar'),
  wall(-32,-8,10,2,3,'bulkhead'),wall(32,8,10,2,3,'bulkhead'),wall(-8,22,2,10,3,'bulkhead'),wall(8,-22,2,10,3,'bulkhead'),
  cover(-30,10,4,4,2.2,'crate'),cover(30,-10,4,4,2.2,'crate'),cover(0,-20,6,3,2.4,'crate'),cover(0,20,6,3,2.4,'crate'),
  cover(-14,-20,3,2,1.8),cover(14,20,3,2,1.8),cover(-14,20,3,2,1.8),cover(14,-20,3,2,1.8),
 ],
 ceilings:[ceiling(0,0,84,56,9,.5)],
 pickups:[
  ['health',-38,-14],['health',38,14],['armor',-38,14],['armor',38,-14],
  ['rocket',-20,4],['rocket',20,-4],['rail',0,-8],['rail',0,8],
  ['scatter',-10,-8],['scatter',10,8],['plasma',-10,8],['plasma',10,-8],
  ['grenade',-30,-20],['shock',30,20],['flak',0,0],['haste',-30,20],['overcharge',30,-20],['overshield',14,0],
 ],
 objectiveZones:[zone(-36,0),zone(0,0),zone(36,0)],
 traversal:{teleporters:[tp('sub-tp-w',-30,0,30,0),tp('sub-tp-e',30,0,-30,0),tp('sub-tp-nw',-30,-20,30,20),tp('sub-tp-se',30,20,-30,-20)],jumpPads:[pad('sub-hop-w',-40,0,16),pad('sub-hop-e',40,0,16)]},
 navNodes:[[-38,0],[-20,0],[-8,0],[0,0],[8,0],[20,0],[38,0],[0,-20],[0,20],[-20,-16],[20,16],[-30,10],[30,-10]],
 landmarks:[{label:'WEST BUS',x:-38,z:0,y:4},{label:'CORE',x:0,z:0,y:4},{label:'EAST BUS',x:38,z:0,y:4}],
};

const warfront={
 id:'warfront',name:'Warfront Delta',tag:'COMBINED ARMS / ARMOUR',
 description:'A wide combined-arms battlefield of fortified bases, a central reactor and armour lanes built for large battles.',
 color:'#e6b56a',background:'#1a1408',bounds:{minX:-64,maxX:64,minZ:-44,maxZ:44},
 teamSpawns:teamSpawns([[-58,-6],[-58,6],[-56,0]],[[58,-6],[58,6],[56,0]]),flagSpawns:flagSpawns(-60,60),
 spawns:[[-58,0],[58,0],[0,-38],[0,38],[-30,-34],[30,34],[-30,34],[30,-34],[-44,0],[44,0]],
 blocks:[
  wall(-50,0,10,18,5,'base-core'),wall(50,0,10,18,5,'base-core'),
  wall(0,0,20,16,6,'fort'),wall(0,-30,10,4,4,'bulkhead'),wall(0,30,10,4,4,'bulkhead'),
  cover(-36,0,4,2,1.8),cover(36,0,4,2,1.8),cover(0,-24,4,2,1.6),cover(0,24,4,2,1.6),
  cover(-18,-18,3,2,2),cover(18,18,3,2,2),cover(-18,18,3,2,2),cover(18,-18,3,2,2),
  cover(-50,-30,5,3,2.2,'base-wall'),cover(50,30,5,3,2.2,'base-wall'),cover(-50,30,5,3,2.2,'base-wall'),cover(50,-30,5,3,2.2,'base-wall'),
 ],
 vehicles:[
  {id:'wf-puma-w',kind:'puma',x:-40,y:0,z:24,yaw:Math.PI/2},
  {id:'wf-puma-e',kind:'puma',x:40,y:0,z:-24,yaw:-Math.PI/2},
  {id:'wf-puma-w2',kind:'puma',x:-40,y:0,z:-24,yaw:Math.PI/2},
  {id:'wf-puma-e2',kind:'puma',x:40,y:0,z:24,yaw:-Math.PI/2},
  {id:'wf-titan-w',kind:'titan',x:-30,y:0,z:0,yaw:Math.PI/2},
  {id:'wf-titan-e',kind:'titan',x:30,y:0,z:0,yaw:-Math.PI/2},
  {id:'wf-transport-w',kind:'transport',x:-34,y:0,z:12,yaw:Math.PI/2},
  {id:'wf-transport-e',kind:'transport',x:34,y:0,z:-12,yaw:-Math.PI/2},
  {id:'wf-scout-w',kind:'scout',x:-34,y:0,z:-12,yaw:Math.PI/2},
  {id:'wf-scout-e',kind:'scout',x:34,y:0,z:12,yaw:-Math.PI/2},
 ],
 pickups:[
  ['health',-60,-20],['health',60,20],['armor',-60,20],['armor',60,-20],
  ['rocket',-40,14],['rocket',40,-14],['rail',0,-26],['rail',0,26],
  ['scatter',-24,0],['scatter',24,0],['plasma',-12,-12],['plasma',12,12],
  ['grenade',-52,36],['shock',52,-36],['flak',-20,36],['haste',-60,8],['overcharge',60,-8],['overshield',0,16],['marksman',0,-14],['smg',0,14],
 ],
 objectiveZones:[zone(-40,0),zone(0,-22),zone(40,0)],
 traversal:{jumpPads:[pad('wf-hop-w',-58,0,16),pad('wf-hop-e',58,0,16),pad('wf-hop-n',0,-38,16),pad('wf-hop-s',0,38,16)],teleporters:[tp('wf-tp-w',-42,0,42,0),tp('wf-tp-e',42,0,-42,0)]},
 navNodes:[[-58,0],[-40,0],[-20,0],[0,0],[20,0],[40,0],[58,0],[0,-38],[0,38],[-30,-34],[30,34],[-30,34],[30,-34],[0,20],[0,-20]],
 landmarks:[{label:'WEST BASE',x:-58,z:0,y:6},{label:'REACTOR',x:0,z:0,y:7},{label:'EAST BASE',x:58,z:0,y:6}],
};

const skyfallBasin={
 id:'skyfall-basin',name:'Skyfall Basin',tag:'COMBINED ARMS / AIR SUPERIORITY',
 description:'The largest combined-arms basin: fortified bases, a central mesa, armour lanes and two Hornet air pads per side.',
 color:'#9fd0ff',background:'#0a1622',bounds:{minX:-72,maxX:72,minZ:-52,maxZ:52},
 teamSpawns:teamSpawns([[-70,-8],[-70,8]],[[70,-8],[70,8]]),flagSpawns:flagSpawns(-70,70),
 spawns:[[-70,0],[70,0],[0,-42],[0,42],[-30,-40],[30,40],[-30,40],[30,-40],[-44,0],[44,0]],
 blocks:[
  wall(-60,0,14,24,6,'base-core'),wall(60,0,14,24,6,'base-core'),
  wall(0,0,24,20,8,'fort'),
  wall(-34,-30,6,6,7,'tower'),wall(34,30,6,6,7,'tower'),wall(-34,30,6,6,7,'tower'),wall(34,-30,6,6,7,'tower'),
  cover(-20,0,4,2,1.8),cover(20,0,4,2,1.8),cover(0,-28,4,2,1.6),cover(0,28,4,2,1.6),
  cover(-40,-40,5,3,2.2,'base-wall'),cover(40,40,5,3,2.2,'base-wall'),cover(-40,40,5,3,2.2,'base-wall'),cover(40,-40,5,3,2.2,'base-wall'),
 ],
 vehicles:[
  {id:'sf-puma-w',kind:'puma',x:-50,y:0,z:28,yaw:Math.PI/2},
  {id:'sf-puma-e',kind:'puma',x:50,y:0,z:-28,yaw:-Math.PI/2},
  {id:'sf-hornet-w',kind:'hornet',x:-50,y:0,z:-28,yaw:Math.PI/2},
  {id:'sf-hornet-e',kind:'hornet',x:50,y:0,z:28,yaw:-Math.PI/2},
  {id:'sf-titan-w',kind:'titan',x:-44,y:0,z:0,yaw:Math.PI/2},
  {id:'sf-titan-e',kind:'titan',x:44,y:0,z:0,yaw:-Math.PI/2},
  {id:'sf-transport-w',kind:'transport',x:-44,y:0,z:16,yaw:Math.PI/2},
  {id:'sf-transport-e',kind:'transport',x:44,y:0,z:-16,yaw:-Math.PI/2},
  {id:'sf-scout-w',kind:'scout',x:-36,y:0,z:-16,yaw:Math.PI/2},
  {id:'sf-scout-e',kind:'scout',x:36,y:0,z:16,yaw:-Math.PI/2},
 ],
 pickups:[
  ['health',-70,-20],['health',70,20],['armor',-70,20],['armor',70,-20],
  ['rocket',-44,-12],['rocket',44,12],['rail',0,-34],['rail',0,34],
  ['scatter',-24,0],['scatter',24,0],['plasma',-14,-14],['plasma',14,14],
  ['grenade',-58,40],['shock',58,-40],['flak',-22,40],['haste',-70,10],['overcharge',70,-10],['overshield',0,18],['marksman',-30,-20],['smg',30,20],
 ],
 objectiveZones:[zone(-44,0),zone(0,-22),zone(44,0)],
 traversal:{jumpPads:[pad('sf-hop-w',-64,0,16),pad('sf-hop-e',64,0,16),pad('sf-hop-n',0,-46,16),pad('sf-hop-s',0,46,16)],teleporters:[tp('sf-tp-w',-56,0,56,0),tp('sf-tp-e',56,0,-56,0)]},
 navNodes:[[-70,0],[-50,0],[-30,0],[0,0],[30,0],[50,0],[70,0],[0,-42],[0,42],[-34,-30],[34,30],[-34,30],[34,-30],[0,24],[0,-24],[-50,28],[50,-28],[-50,-28],[50,28]],
 landmarks:[{label:'WEST BASE',x:-60,z:0,y:7},{label:'THE MESA',x:0,z:0,y:9},{label:'EAST BASE',x:60,z:0,y:7}],
};

export const BATTLE_MAPS=freeze([neonVertical,substation,warfront,skyfallBasin]);
export default BATTLE_MAPS;
