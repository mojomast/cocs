// Arsenal maps are immutable templates matching the MAPS schema. They are
// authored independently so no existing map module is imported here.
import {freeze,wall,cover,pad,tp,zone} from './map-schema.mjs';
const zip=(id,from,to,speed=15)=>({id,from,to,speed,cooldown:1.2});
const vehicle=(id,kind,x,z,yaw)=>({id,kind,x,z,yaw});

const trenchline={
 id:'trenchline',name:'Trenchline',tag:'COMBINED ARMS / TRENCH WARFARE',
 description:'A sprawling combined-arms trench battlefield of zig-zag lines, fortified bases and armoured lanes.',
 color:'#c9a15a',background:'#171208',raised:false,bounds:{minX:-75,maxX:75,minZ:-50,maxZ:50},
 teamSpawns:{0:[[-70,-10],[-70,10],[-70,-30],[-70,30]],1:[[70,10],[70,-10],[70,30],[70,-30]]},flagSpawns:{0:{x:-70,z:0},1:{x:70,z:0}},
 spawns:[[-70,0],[70,0],[-70,-38],[70,-38],[-70,38],[70,38],[-35,-44],[35,44],[-35,44],[35,-44],[0,-44],[0,44]],
 blocks:[
  wall(-62,0,10,22,5,'base-core'),wall(62,0,10,22,5,'base-core'),wall(0,0,14,12,5.5,'fort'),
  cover(-48,-24,10,2,1.5,'trench'),cover(-32,-24,10,2,1.5,'trench'),cover(-16,-24,10,2,1.5,'trench'),cover(16,-24,10,2,1.5,'trench'),cover(32,-24,10,2,1.5,'trench'),cover(48,-24,10,2,1.5,'trench'),
  cover(-48,24,10,2,1.5,'trench'),cover(-32,24,10,2,1.5,'trench'),cover(-16,24,10,2,1.5,'trench'),cover(16,24,10,2,1.5,'trench'),cover(32,24,10,2,1.5,'trench'),cover(48,24,10,2,1.5,'trench'),
  cover(-40,-8,8,2,1.5,'trench'),cover(-20,-8,8,2,1.5,'trench'),cover(20,-8,8,2,1.5,'trench'),cover(40,-8,8,2,1.5,'trench'),
  cover(-40,8,8,2,1.5,'trench'),cover(-20,8,8,2,1.5,'trench'),cover(20,8,8,2,1.5,'trench'),cover(40,8,8,2,1.5,'trench'),
  cover(-51,-6,4,3,1.8),cover(51,6,4,3,1.8),cover(0,-40,6,2,1.8),cover(0,40,6,2,1.8),
 ],
 pickups:[
  ['health',-70,-30],['health',70,30],['armor',-70,30],['armor',70,-30],
  ['rocket',-50,14],['rocket',50,-14],['rail',0,-36],['rail',0,36],
  ['scatter',-34,0],['scatter',34,0],['plasma',-14,-14],['plasma',14,14],
  ['grenade',-60,-40],['shock',60,40],['flak',-16,20],['marksman',16,-20],
 ],
 vehicles:[vehicle('tr-puma-w','puma',-40,30,Math.PI/2),vehicle('tr-puma-e','puma',40,-30,-Math.PI/2),vehicle('tr-hornet','hornet',0,46,0),vehicle('tr-titan-w','titan',-50,0,Math.PI/2),vehicle('tr-titan-e','titan',50,0,-Math.PI/2),vehicle('tr-transport-w','transport',-50,14,Math.PI/2),vehicle('tr-transport-e','transport',50,-14,-Math.PI/2),vehicle('tr-scout-w','scout',-50,-14,Math.PI/2),vehicle('tr-scout-e','scout',50,14,-Math.PI/2)],
 traversal:{
  jumpPads:[pad('tr-hop-w',-72,-16,16),pad('tr-hop-e',72,16,16),pad('tr-hop-n',0,-47,16),pad('tr-hop-s',0,47,16)],
  teleporters:[tp('tr-tp-w',-72,0,72,0)],
 },
 objectiveZones:[zone(-46,0,4.5,'alpha'),zone(0,-14,4.5,'bravo'),zone(46,0,4.5,'charlie')],
 navNodes:[{x:-70,z:0},{x:-52,z:0},{x:-30,z:0},{x:0,z:-14},{x:0,z:14},{x:30,z:0},{x:52,z:0},{x:70,z:0},{x:-30,z:-34},{x:30,z:34},{x:-30,z:34},{x:30,z:-34},{x:0,z:-30},{x:0,z:30}],
};

const signalRidge={
 id:'signal-ridge',name:'Signal Ridge',tag:'COMBINED ARMS / HIGH GROUND',
 description:'A long combined-arms ridge line where elevated decks, armour and a cross-map zipline decide the fight.',
 color:'#8fb6e8',background:'#0d1420',raised:false,bounds:{minX:-70,maxX:70,minZ:-50,maxZ:50},
 teamSpawns:{0:[[-66,-12],[-66,12],[-66,-30],[-66,30]],1:[[66,12],[66,-12],[66,30],[66,-30]]},flagSpawns:{0:{x:-66,z:0},1:{x:66,z:0}},
 spawns:[[-66,0],[66,0],[-66,-42],[66,42],[-66,42],[66,-42],[-34,-44],[34,44],[-34,44],[34,-44],[0,-48],[0,48]],
 blocks:[
  wall(-60,0,8,16,5,'base-core'),wall(60,0,8,16,5,'base-core'),wall(0,0,20,8,4,'ridge'),
  wall(-30,-30,12,8,3.5,'deck'),wall(30,30,12,8,3.5,'deck'),wall(-30,30,12,8,3.5,'deck'),wall(30,-30,12,8,3.5,'deck'),
  wall(0,-42,14,6,3,'deck'),wall(0,42,14,6,3,'deck'),
  cover(-24,0,4,2,1.8),cover(24,0,4,2,1.8),
 ],
 pickups:[
  ['health',-66,-30],['health',66,30],['armor',-66,30],['armor',66,-30],
  ['rocket',-42,-16],['rocket',42,16],['rail',0,-38],['rail',0,38],
  ['scatter',-30,0],['scatter',30,0],['plasma',-14,-14],['plasma',14,14],
  ['grenade',-54,42],['shock',54,-42],['flak',-16,26],['marksman',16,-26],
 ],
 vehicles:[vehicle('sr-puma','puma',-48,34,Math.PI/2),vehicle('sr-hornet-w','hornet',-20,-44,0),vehicle('sr-hornet-e','hornet',20,44,Math.PI),vehicle('sr-titan-w','titan',-30,-20,Math.PI/2),vehicle('sr-titan-e','titan',30,20,-Math.PI/2),vehicle('sr-scout-w','scout',-40,-20,Math.PI/2),vehicle('sr-scout-e','scout',40,20,-Math.PI/2)],
 traversal:{
  jumpPads:[pad('sr-hop-w',-68,0,16),pad('sr-hop-e',68,0,16),pad('sr-hop-n',0,-38,16),pad('sr-hop-s',0,38,16)],
  ziplines:[zip('sr-zip-long',{x:-46,y:0,z:30},{x:46,y:0,z:-30},18)],
 },
 objectiveZones:[zone(-46,0,4.5,'alpha'),zone(0,-24,4.5,'bravo'),zone(46,0,4.5,'charlie')],
 navNodes:[{x:-66,z:0},{x:-48,z:0},{x:-20,z:0},{x:20,z:0},{x:48,z:0},{x:66,z:0},{x:0,z:-12},{x:0,z:12},{x:-30,z:-38},{x:30,z:38},{x:0,z:-48},{x:0,z:48},{x:-30,z:38},{x:30,z:-38}],
};

const rampart={
 id:'rampart',name:'Rampart',tag:'ASSAULT / URBAN STREETS',
 description:'A tight assault district of shattered buildings, alleyways and barricades leading to three ordered capture points.',
 color:'#d98a5c',background:'#1a120c',raised:false,bounds:{minX:-60,maxX:60,minZ:-42,maxZ:42},
 spawns:[[-56,0],[-56,-34],[-56,34],[56,0],[56,-34],[56,34],[0,-38],[-28,-38],[28,-38],[0,38],[-28,38],[28,38]],
 blocks:[
  wall(-40,-22,14,14,7,'building'),wall(-40,22,14,14,7,'building'),wall(40,-22,14,14,7,'building'),wall(40,22,14,14,7,'building'),
  wall(-16,0,3,24,5,'wall'),wall(16,0,3,24,5,'wall'),
  wall(-30,-8,14,2,4,'wall'),wall(30,8,14,2,4,'wall'),wall(-30,8,14,2,4,'wall'),wall(30,-8,14,2,4,'wall'),
  cover(-8,-16,4,2,1.8),cover(8,16,4,2,1.8),cover(-8,16,4,2,1.8),cover(8,-16,4,2,1.8),
  cover(-52,-10,4,3,2),cover(52,10,4,3,2),cover(-20,20,3,2,1.8),cover(20,-20,3,2,1.8),
 ],
 pickups:[
  ['health',-56,-14],['health',56,14],['armor',-56,14],['armor',56,-14],
  ['rocket',-30,-34],['rocket',30,34],['rail',0,-22],['rail',0,22],
  ['scatter',-24,24],['scatter',24,-24],['plasma',-20,-20],['plasma',20,20],
  ['grenade',0,0],['shock',-48,-38],['flak',48,38],
 ],
 objectiveZones:[zone(-46,0,4.5,'alpha'),zone(0,0,4.5,'bravo'),zone(46,0,4.5,'charlie')],
 navNodes:[{x:-56,z:0},{x:-40,z:0},{x:-24,z:0},{x:-8,z:0},{x:8,z:0},{x:24,z:0},{x:40,z:0},{x:56,z:0},{x:0,z:-30},{x:-28,z:-30},{x:28,z:-30},{x:0,z:30},{x:-28,z:30},{x:28,z:30}],
};

const catwalkBreach={
 id:'catwalk-breach',name:'Catwalk Breach',tag:'ASSAULT / VERTICAL INDUSTRY',
 description:'A vertical industrial assault arena of catwalk decks and launch pads stacked over three ordered breach points.',
 color:'#9ad0c8',background:'#0c1516',raised:false,bounds:{minX:-55,maxX:55,minZ:-40,maxZ:40},
 spawns:[[-50,0],[50,0],[-50,-34],[50,34],[-50,34],[50,-34],[0,-38],[-20,-38],[20,-38],[0,38],[-20,38],[20,38]],
 blocks:[
  wall(-30,-26,16,8,3.5,'deck'),wall(30,26,16,8,3.5,'deck'),wall(-30,26,16,8,3.5,'deck'),wall(30,-26,16,8,3.5,'deck'),
  wall(0,-32,20,6,3,'deck'),wall(0,32,20,6,3,'deck'),
  cover(-16,0,4,2,1.8),cover(16,0,4,2,1.8),cover(0,-20,6,2,1.8),cover(0,20,4,2,1.8),
 ],
 pickups:[
  ['health',-50,-16],['health',50,16],['armor',-50,16],['armor',50,-16],
  ['rocket',-40,-36],['rocket',40,36],['rail',0,-24],['rail',0,24],
  ['scatter',-30,0],['scatter',30,0],['plasma',-12,-26],['plasma',12,26],
  ['grenade',-30,34],['shock',30,-34],['flak',-16,20],['marksman',16,-20],
 ],
 traversal:{
  jumpPads:[pad('cb-hop-w',-52,0,18),pad('cb-hop-e',52,0,18),pad('cb-hop-n',0,-37,18),pad('cb-hop-s',0,37,18)],
 },
 objectiveZones:[zone(-42,0,4.5,'alpha'),zone(0,-14,4.5,'bravo'),zone(42,0,4.5,'charlie')],
 navNodes:[{x:-50,z:0},{x:-36,z:0},{x:-20,z:0},{x:-10,z:0},{x:10,z:0},{x:20,z:0},{x:36,z:0},{x:50,z:0},{x:0,z:-25},{x:0,z:26},{x:-30,z:-34},{x:30,z:34},{x:0,z:-37},{x:0,z:37}],
};

export const ARSENAL_MAPS=freeze([trenchline,signalRidge,rampart,catwalkBreach]);
export default ARSENAL_MAPS;
