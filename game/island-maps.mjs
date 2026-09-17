import {freeze,coverBuilder,platform,teamSpawns,flagSpawns} from './map-schema.mjs';

const cover=coverBuilder({h:2.2});
const point=(x,z)=>({x,z,y:0});
const boost=(id,x,z,dir,power,vy)=>({id,x,z,y:0,dir,power,vy,cooldown:2});
const link=(id,source,target,traversal,route)=>({id,source:point(...source),target:point(...target),traversal,route});

const alignLauncherDirections=map=>{
  const links=new Map((map.jumpLinks||[]).map(value=>[value.traversal,value]));
  map.traversal.boostLaunchers=map.traversal.boostLaunchers.map(launcher=>{
    const jump=links.get(launcher.id);
    if(!jump)return launcher;
    const dx=jump.target.x-jump.source.x,dz=jump.target.z-jump.source.z,length=Math.hypot(dx,dz);
    return {...launcher,dir:[dx/length,dz/length]};
  });
  return map;
};

const skybreakTrampolines=[
 {id:'skybreak-west-hop-n',x:-42,z:-7,y:0,power:15,cooldown:2},{id:'skybreak-east-hop-n',x:42,z:-7,y:0,power:15,cooldown:2},
 {id:'skybreak-west-hop-s',x:-42,z:7,y:0,power:15,cooldown:2},{id:'skybreak-east-hop-s',x:42,z:7,y:0,power:15,cooldown:2},
];
const skybreakBoosts=[
 boost('skybreak-mid-west',-34,0,[1,0],29,12),boost('skybreak-mid-east',34,0,[-1,0],29,12),boost('skybreak-mid-return-west',-5.5,0,[-1,0],29,12),boost('skybreak-mid-return-east',5.5,0,[1,0],29,12),
 boost('skybreak-north-out-west',-34,-8,[.707,-.707],18,10),boost('skybreak-north-cross-west',-12.5,-18,[1,0],25,12),
 boost('skybreak-north-cross-east',12.5,-18,[-1,0],25,12),boost('skybreak-north-in-east',23.5,-18,[.896,.443],19,10),
 boost('skybreak-north-out-east',34,-8,[-.707,-.707],18,10),boost('skybreak-north-in-west',-23.5,-18,[-.896,.443],19,10),
 boost('skybreak-south-out-west',-34,8,[.707,.707],18,10),boost('skybreak-south-cross-west',-12.5,18,[1,0],25,12),
 boost('skybreak-south-cross-east',12.5,18,[-1,0],25,12),boost('skybreak-south-in-east',23.5,18,[.896,-.443],19,10),
 boost('skybreak-south-out-east',34,8,[-.707,.707],18,10),boost('skybreak-south-in-west',-23.5,18,[-.896,-.443],19,10),
];

const skybreak={
 id:'skybreak',name:'Skybreak Isles',tag:'ISLES / THREE ROUTES',
 description:'An outdoor high-speed CTF skyway where three island routes cross an open void.',
 color:'#69d6e8',background:'#071b2b',bounds:{minX:-48,maxX:48,minZ:-30,maxZ:30},voidY:-8,
 platforms:[
  platform(-39,0,16,22,'middle'),platform(39,0,16,22,'middle'),platform(0,0,24,10,'middle'),
  platform(-18,-18,14,9,'north'),platform(18,-18,14,9,'north'),platform(-18,18,14,9,'south'),platform(18,18,14,9,'south'),
 ],
 blocks:[cover(-39,-7,4,2.5,2.8,'landmark'),cover(39,7,4,2.5,2.8,'landmark'),cover(-34,4,3,2),cover(34,-4,3,2),cover(-18,-18,2.5,2),cover(18,-18,2.5,2),cover(-18,18,2.5,2),cover(18,18,2.5,2),cover(0,0,3,2.5,2.6,'landmark')],
 teamSpawns:teamSpawns([[-42,-4],[-42,4]],[[42,-4],[42,4]]),flagSpawns:flagSpawns(-43,43),
 spawns:[[-42,-4],[-42,4],[42,-4],[42,4],[-18,-20],[18,-20],[-18,20],[18,20]],
 pickups:[['health',-43,-8],['health',43,8],['armor',-34,8],['armor',34,-8],['rocket',-18,-16],['rocket',18,16],['rail',18,-16],['rail',-18,16],['scatter',-4,0],['scatter',4,0],['plasma',-2,2],['plasma',2,-2],['grenade',-21,-18],['grenade',21,18],['shock',-21,18],['shock',21,-18],['flak',-8,-3],['flak',8,3],['haste',-34,-2],['overcharge',34,2],['overshield',0,3]],
 traversal:{trampolines:skybreakTrampolines,boostLaunchers:skybreakBoosts},
 jumpLinks:[
  link('skybreak-mid-west-link',[-34,0],[-5.5,0],'skybreak-mid-west','middle'),link('skybreak-mid-east-link',[34,0],[5.5,0],'skybreak-mid-east','middle'),link('skybreak-mid-return-west-link',[-5.5,0],[-34,0],'skybreak-mid-return-west','middle'),link('skybreak-mid-return-east-link',[5.5,0],[34,0],'skybreak-mid-return-east','middle'),
  link('skybreak-north-out-west-link',[-34,-8],[-23.4,-18.6],'skybreak-north-out-west','north'),link('skybreak-north-cross-link',[-12.5,-18],[12.5,-18],'skybreak-north-cross-west','north'),link('skybreak-north-cross-return',[12.5,-18],[-12.5,-18],'skybreak-north-cross-east','north'),link('skybreak-north-in-east-link',[23.5,-18],[34,-8],'skybreak-north-in-east','north'),
  link('skybreak-north-out-east-link',[34,-8],[23.4,-18.6],'skybreak-north-out-east','north'),link('skybreak-north-in-west-link',[-23.5,-18],[-34,-8],'skybreak-north-in-west','north'),
  link('skybreak-south-out-west-link',[-34,8],[-23.4,18.6],'skybreak-south-out-west','south'),link('skybreak-south-cross-link',[-12.5,18],[12.5,18],'skybreak-south-cross-west','south'),link('skybreak-south-cross-return',[12.5,18],[-12.5,18],'skybreak-south-cross-east','south'),link('skybreak-south-in-east-link',[23.5,18],[34,8],'skybreak-south-in-east','south'),
  link('skybreak-south-out-east-link',[34,8],[23.4,18.6],'skybreak-south-out-east','south'),link('skybreak-south-in-west-link',[-23.5,18],[-34,8],'skybreak-south-in-west','south'),
 ],
 navNodes:[point(-43,0),point(43,0),point(-18,-18),point(18,-18),point(0,0),point(-18,18),point(18,18)],
 landmarks:[{label:'WEST KEEP',x:-39,z:0,y:3.2},{label:'EAST KEEP',x:39,z:0,y:3.2},{label:'SKYBREAK',x:0,z:0,y:3.2}],
};

const aetherTrampolines=[
 {id:'aether-west-hop-n',x:-34,z:-6,y:0,power:15,cooldown:2},{id:'aether-east-hop-n',x:34,z:-6,y:0,power:15,cooldown:2},
 {id:'aether-west-hop-s',x:-34,z:6,y:0,power:15,cooldown:2},{id:'aether-east-hop-s',x:34,z:6,y:0,power:15,cooldown:2},
];
const aetherBoosts=[
 boost('aether-mid-west',-33,0,[1,0],27,12),boost('aether-mid-east',33,0,[-1,0],27,12),
 boost('aether-mid-return-west',-5.5,0,[-1,0],27,12),boost('aether-mid-return-east',5.5,0,[1,0],27,12),
 boost('aether-north-out-west',-33,-7,[.68,-.73],16,10),boost('aether-north-out-east',33,-7,[-.68,-.73],16,10),
 boost('aether-north-west-mid',-13.5,-18,[.914,-.406],14.5,8),boost('aether-north-east-mid',13.5,-18,[-.914,-.406],14.5,8),
 boost('aether-north-mid-west',-4.5,-22,[-.914,.406],14.5,8),boost('aether-north-mid-east',4.5,-22,[.914,.406],14.5,8),
 boost('aether-north-in-west',-24,-18,[-.68,.73],16,10),boost('aether-north-in-east',24,-18,[.68,.73],16,10),
 boost('aether-south-out-west',-33,7,[.68,.73],16,10),boost('aether-south-out-east',33,7,[-.68,.73],16,10),
 boost('aether-south-west-mid',-13.5,18,[.914,.406],14.5,8),boost('aether-south-east-mid',13.5,18,[-.914,.406],14.5,8),
 boost('aether-south-mid-west',-4.5,22,[-.914,-.406],14.5,8),boost('aether-south-mid-east',4.5,22,[.914,-.406],14.5,8),
 boost('aether-south-in-west',-24,18,[-.68,-.73],16,10),boost('aether-south-in-east',24,18,[.68,-.73],16,10),
];

const aether={
 id:'aether',name:'Aether Ring',tag:'RING / OPEN VOID',
 description:'An outdoor high-speed CTF ring of floating islands, diagonal routes, and a lethal void.',
 color:'#b28cff',background:'#130d2b',bounds:{minX:-40,maxX:40,minZ:-30,maxZ:30},voidY:-8,
 platforms:[
  platform(-32,0,14,20,'middle'),platform(32,0,14,20,'middle'),platform(0,0,24,10,'middle'),
  platform(-19,-18,12,8,'north'),platform(0,-22,10,6,'north'),platform(19,-18,12,8,'north'),
  platform(-19,18,12,8,'south'),platform(0,22,10,6,'south'),platform(19,18,12,8,'south'),
 ],
  blocks:[cover(-35,-2,2.5,2.5,2.8,'landmark'),cover(35,2,2.5,2.5,2.8,'landmark'),cover(-34,4,2.5,2),cover(34,-4,2.5,2),cover(-19,-18,2.5,2),cover(19,-18,2.5,2),cover(-19,18,2.5,2),cover(19,18,2.5,2),cover(0,0,3,3,2.5,'landmark')],
 teamSpawns:teamSpawns([[-37,-4],[-37,4]],[[37,-4],[37,4]]),flagSpawns:flagSpawns(-36,36),
 spawns:[[-37,-4],[-37,4],[37,-4],[37,4],[-19,-20],[19,-20],[-19,20],[19,20]],
 pickups:[['health',-34,-8],['health',34,8],['armor',-34,8],['armor',34,-8],['rocket',-19,-16],['rocket',19,16],['rail',19,-16],['rail',-19,16],['scatter',-4,0],['scatter',4,0],['plasma',-2,2.25],['plasma',2,-2.25],['grenade',-2,-22],['grenade',2,22],['shock',-2,22],['shock',2,-22],['flak',0,-24],['flak',0,24],['haste',-29,0],['overcharge',29,0],['overshield',0,3]],
 traversal:{trampolines:aetherTrampolines,boostLaunchers:aetherBoosts},
 jumpLinks:[
  link('aether-mid-west-link',[-33,0],[-5.5,0],'aether-mid-west','middle'),link('aether-mid-east-link',[33,0],[5.5,0],'aether-mid-east','middle'),
  link('aether-mid-return-west',[-5.5,0],[-33,0],'aether-mid-return-west','middle'),link('aether-mid-return-east',[5.5,0],[33,0],'aether-mid-return-east','middle'),
  link('aether-north-out-west',[-33,-7],[-23.7,-17.3],'aether-north-out-west','north'),link('aether-north-out-east',[33,-7],[23.7,-17.3],'aether-north-out-east','north'),
  link('aether-north-west-mid',[-13.5,-18],[-4.5,-22],'aether-north-west-mid','north'),link('aether-north-east-mid',[13.5,-18],[4.5,-22],'aether-north-east-mid','north'),
  link('aether-north-mid-west',[-4.5,-22],[-13.5,-18],'aether-north-mid-west','north'),link('aether-north-mid-east',[4.5,-22],[13.5,-18],'aether-north-mid-east','north'),
   link('aether-north-in-west',[-24,-18],[-33,-7],'aether-north-in-west','north'),link('aether-north-in-east',[24,-18],[33,-7],'aether-north-in-east','north'),
   link('aether-south-out-west',[-33,7],[-23.7,17.3],'aether-south-out-west','south'),link('aether-south-out-east',[33,7],[23.7,17.3],'aether-south-out-east','south'),
  link('aether-south-west-mid',[-13.5,18],[-4.5,22],'aether-south-west-mid','south'),link('aether-south-east-mid',[13.5,18],[4.5,22],'aether-south-east-mid','south'),
  link('aether-south-mid-west',[-4.5,22],[-13.5,18],'aether-south-mid-west','south'),link('aether-south-mid-east',[4.5,22],[13.5,18],'aether-south-mid-east','south'),
   link('aether-south-in-west',[-24,18],[-33,7],'aether-south-in-west','south'),link('aether-south-in-east',[24,18],[33,7],'aether-south-in-east','south'),
 ],
 navNodes:[point(-36,0),point(36,0),point(-19,-18),point(0,-22),point(19,-18),point(0,0),point(-19,18),point(0,22),point(19,18)],
 landmarks:[{label:'WEST RING',x:-32,z:0,y:3.2},{label:'EAST RING',x:32,z:0,y:3.2},{label:'AETHER HUB',x:0,z:0,y:3.2}],
};

alignLauncherDirections(skybreak);
alignLauncherDirections(aether);

export const ISLAND_MAPS=freeze([skybreak,aether]);
