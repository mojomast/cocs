const freeze=value=>{
  if(value&&typeof value==='object'&&!Object.isFrozen(value)){
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
};
const platform=(x,z,w,d,route,y=0)=>({x,z,w,d,y,thickness:.7,kind:'platform',route});
const cover=(x,z,w=3,d=2,h=2.5,kind='cover')=>({x,z,w,d,h,kind});
const teams=(west,east)=>({0:west,1:east,red:west,blue:east});
const flags=(west,east)=>({0:{x:west,z:0},1:{x:east,z:0},red:{x:west,z:0},blue:{x:east,z:0}});
const point=(x,z,y=0)=>({x,z,y});
const launcher=(id,x,z,dir,target,y=0,vy=11)=>({id,x,z,y,dir,power:26,vy,cooldown:2,target});
const link=(id,source,target,route)=>({id,source,target,traversal:id,route});

// A long valley floor feeds two high shelves through climbable, authored ramps.
const canyonTerrain={
  maxSlope:.9,
  surfaces:[
    {id:'canyon-floor',material:'grass',vertices:[[-56,0,-12],[-56,0,12],[56,0,12],[56,0,-12]]},
    {id:'north-ramp',material:'dirt',vertices:[[-56,0,-12],[56,0,-12],[56,6,-18],[-56,6,-18]]},
    {id:'south-ramp',material:'dirt',vertices:[[-56,0,12],[-56,6,18],[56,6,18],[56,0,12]]},
    {id:'north-shelf',material:'grass',vertices:[[-56,6,-18],[56,6,-18],[56,6,-27],[-56,6,-27]]},
    {id:'south-shelf',material:'grass',vertices:[[-56,6,18],[-56,6,27],[56,6,27],[56,6,18]]}
  ],
  walls:[
    {id:'north-cliff',material:'cliff',vertices:[[-56,0,-27],[56,0,-27],[56,6,-27],[-56,6,-27]]},
    {id:'south-cliff',material:'cliff',vertices:[[-56,0,27],[-56,6,27],[56,6,27],[56,0,27]]}
  ]
};
const canyonWest=point(-50,0),canyonEast=point(50,0);
const canyonLaunchers=[
  launcher('canyon-north-west',-35,-20,[1,0],point(-5,-20,6),6),
  launcher('canyon-north-east',35,-20,[-1,0],point(5,-20,6),6),
  launcher('canyon-south-west',-35,20,[1,0],point(-5,20,6),6),
  launcher('canyon-south-east',35,20,[-1,0],point(5,20,6),6),
  launcher('canyon-drop-west',-5,-20,[0,1],point(-5,0),6),
  launcher('canyon-drop-east',5,20,[0,-1],point(5,0),6)
];
const canyon={
  id:'sunscar-canyon',name:'Sunscar Canyon',tag:'OUTDOOR / VERTICAL CANYON CTF',
  description:'An outdoor vertical canyon CTF arena with a contested valley, high shelves, ramp routes, and launchable cliff crossings.',
  color:'#e6a45d',background:'#7bb8c4',bounds:{minX:-58,maxX:58,minZ:-29,maxZ:29},voidY:-8,terrain:canyonTerrain,
  teamSpawns:teams([[-50,-4],[-50,4]],[[50,-4],[50,4]]),flagSpawns:flags(-53,53),
  spawns:[[-50,-4],[-50,4],[50,-4],[50,4],[-28,-22],[28,-22],[-28,22],[28,22],[0,-5],[0,5]],
  objectiveZones:[point(-28,0,0),point(0,0,0),point(28,0,0)],
  blocks:[cover(-42,0,5,4,3.5,'base-bunker'),cover(42,0,5,4,3.5,'base-bunker'),cover(-10,0,4,2.5,2.5),cover(10,0,4,2.5,2.5),cover(0,-21,5,2.5,3,'cliff-outpost'),cover(0,21,5,2.5,3,'cliff-outpost')],
  pickups:[['health',-46,-8],['health',46,8],['armor',-32,-22],['armor',32,22],['rocket',-18,0],['rocket',18,0],['rail',0,-22],['rail',0,22],['scatter',-5,5],['plasma',5,-5],['grenade',-35,0],['shock',35,0],['flak',0,-8],['haste',-24,-22],['overcharge',24,22],['overshield',0,0]],
  traversal:{trampolines:[{id:'canyon-north-hop',x:0,z:-22,y:6,power:15,cooldown:2},{id:'canyon-south-hop',x:0,z:22,y:6,power:15,cooldown:2}],boostLaunchers:canyonLaunchers},
  jumpLinks:canyonLaunchers.map(p=>link(p.id,point(p.x,p.z,p.y),p.target,p.y?'high-shelf':'valley')),
  navNodes:[point(-53,0),point(-28,-22,6),point(0,-20,6),point(28,-22,6),point(53,0),point(0,0),point(-28,22,6),point(0,20,6),point(28,22,6)],
  landmarks:[{label:'WEST SUNFALL',x:-50,z:0,y:3},{label:'EAST SUNFALL',x:50,z:0,y:3},{label:'THE SCAR',x:0,z:0,y:3}]
};

const megaLaunchers=[launcher('ironfall-north-west',-29,-21,[1,0],point(-6,-21,10),7,14),launcher('ironfall-north-east',29,-21,[-1,0],point(6,-21,10),7,14),launcher('ironfall-south-west',-29,21,[1,0],point(-6,21,10),7,14),launcher('ironfall-south-east',29,21,[-1,0],point(6,21,10),7,14),launcher('ironfall-mid-west',-6,5,[-1,0],point(-35,5),0),launcher('ironfall-mid-east',6,-5,[1,0],point(35,-5),0),launcher('ironfall-return-west',-37,0,[1,0],point(-6.75,0),0),launcher('ironfall-return-east',37,0,[-1,0],point(6.75,0),0),launcher('ironfall-up-north-west',-47,-10,[.928,-.371],point(-22,-20,7),0,20),launcher('ironfall-up-north-east',47,-10,[-.928,-.371],point(22,-20,7),0,20),launcher('ironfall-up-south-west',-47,10,[.928,.371],point(-22,20,7),0,20),launcher('ironfall-up-south-east',47,10,[-.928,.371],point(22,20,7),0,20),launcher('ironfall-down-north',0,-23,[0,1],point(0,-3),10,14),launcher('ironfall-down-south',0,23,[.287,-.958],point(6,3),10,14)];
const megastructure={
  id:'ironfall-megastructure',name:'Ironfall Megastructure',tag:'INDUSTRIAL / BROKEN VERTICAL CTF',
  description:'A broken industrial megastructure CTF arena of staggered decks, reactor towers, exposed service gaps, and three brutal approach routes.',
  color:'#d77b63',background:'#111923',bounds:{minX:-52,maxX:52,minZ:-34,maxZ:34},voidY:-10,
  platforms:[platform(-43,0,16,24,'west',0),platform(43,0,16,24,'east',0),platform(0,0,18,12,'middle',0),platform(-22,-23,18,9,'upper',7),platform(22,-23,18,9,'upper',7),platform(-22,23,18,9,'lower',7),platform(22,23,18,9,'lower',7),platform(0,-23,12,6,'upper',10),platform(0,23,12,6,'lower',10)],
  teamSpawns:teams([[-47,-5],[-47,5]],[[47,-5],[47,5]]),flagSpawns:flags(-49,49),
  spawns:[[-47,-5],[-47,5],[47,-5],[47,5],[-22,-23],[22,-23],[-22,23],[22,23],[0,-23],[0,23]],
  blocks:[cover(0,4,3,2,2,'cover'),cover(-43,0,5,5,4,'base-core'),cover(43,0,5,5,4,'base-core'),cover(-9,0,3,5,5,'reactor'),cover(9,0,3,5,5,'reactor'),cover(-22,-23,4,2,3,'machinery'),cover(22,23,4,2,3,'machinery'),cover(-22,23,4,2,3,'machinery'),cover(22,-23,4,2,3,'machinery')],
  objectiveZones:[point(-43,-8,0),point(0,0,0),point(43,8,0)],
  pickups:[['health',-47,-10],['health',47,10],['armor',-22,-23],['armor',22,23],['rocket',-22,23],['rocket',22,-23],['rail',0,-23],['rail',0,23],['scatter',-6.75,0],['scatter',6.75,0],['plasma',-3,0],['plasma',3,0],['grenade',-30,-23],['shock',30,23],['flak',0,0],['haste',-40,8],['overcharge',40,-8],['overshield',0,0]],
  traversal:{trampolines:[{id:'ironfall-west-lift',x:-35,z:-8,power:16,cooldown:2},{id:'ironfall-east-lift',x:35,z:8,power:16,cooldown:2}],boostLaunchers:megaLaunchers},
  jumpLinks:megaLaunchers.map(p=>link(p.id,point(p.x,p.z,p.y),p.target,p.y?'upper':'middle')),
  navNodes:[point(-49,0),point(-35,0),point(-22,-23,7),point(0,-23,10),point(22,-23,7),point(49,0),point(22,23,7),point(0,23,10),point(-22,23,7),point(0,0)],
  landmarks:[{label:'WEST CORE',x:-43,z:0,y:5},{label:'EAST CORE',x:43,z:0,y:5},{label:'IRONFALL REACTOR',x:0,z:0,y:6}]
};

const plateauLaunchers=[launcher('longreach-north-west',-35,-30,[1,0],point(-10,-34),0),launcher('longreach-north-east',35,-30,[-1,0],point(10,-34),0),launcher('longreach-south-west',-35,30,[1,0],point(-10,34),0),launcher('longreach-south-east',35,30,[-1,0],point(10,34),0),launcher('longreach-west-middle',-42,0,[1,0],point(-20,0),0),launcher('longreach-east-middle',42,0,[-1,0],point(20,0),0),launcher('longreach-return-west',-20,0,[-1,0],point(-45,0),0),launcher('longreach-return-east',20,0,[1,0],point(45,0),0),launcher('longreach-up-north-west',-52,-13,[.846,-.533],point(-25,-30),0,14),launcher('longreach-up-north-east',52,-13,[-.846,-.533],point(25,-30),0,14),launcher('longreach-up-south-west',-52,13,[.846,.533],point(-25,30),0,14),launcher('longreach-up-south-east',52,13,[-.846,.533],point(25,30),0,14),launcher('longreach-down-north',6,-34,[.128,.992],point(10,-3),0,14),launcher('longreach-down-south',6,34,[.128,-.992],point(10,3),0,14)];
const plateau={
  id:'longreach-plateau',name:'Longreach Plateau',tag:'OUTDOOR / WIDE ISLAND ROUTES CTF',
  description:'A wide outdoor island and plateau route map for CTF, with a broad central table, twin flank causeways, and long sightlines.',
  color:'#77c99b',background:'#547f9c',bounds:{minX:-64,maxX:64,minZ:-42,maxZ:42},voidY:-10,
  platforms:[platform(-52,0,20,30,'west'),platform(52,0,20,30,'east'),platform(0,0,48,18,'middle'),platform(-25,-30,24,10,'north'),platform(0,-34,20,7,'north'),platform(25,-30,24,10,'north'),platform(-25,30,24,10,'south'),platform(0,34,20,7,'south'),platform(25,30,24,10,'south')],
  teamSpawns:teams([[-58,-6],[-58,6]],[[58,-6],[58,6]]),flagSpawns:flags(-61,61),
  spawns:[[-58,-6],[-58,6],[58,-6],[58,6],[-25,-30],[25,-30],[-25,30],[25,30],[0,-34],[0,34]],
  blocks:[cover(-52,0,6,6,4,'base-bunker'),cover(52,0,6,6,4,'base-bunker'),cover(-17,0,4,3,3),cover(17,0,4,3,3),cover(0,-7,5,2,2.7,'lookout'),cover(0,7,5,2,2.7,'lookout'),cover(0,-31,4,2,2.5,'lookout'),cover(0,31,4,2,2.5,'lookout')],
  objectiveZones:[point(-52,-10,0),point(0,0,0),point(52,10,0)],
  pickups:[['health',-56,-12],['health',56,12],['armor',-25,-30],['armor',25,30],['rocket',-25,30],['rocket',25,-30],['rail',0,-34],['rail',0,34],['scatter',-10,0],['scatter',10,0],['plasma',-3,0],['plasma',3,0],['grenade',-35,-30],['shock',35,30],['flak',0,0],['haste',-45,10],['overcharge',45,-10],['overshield',0,0]],
  traversal:{trampolines:[{id:'longreach-north-hop',x:0,z:-34,power:16,cooldown:2},{id:'longreach-south-hop',x:0,z:34,power:16,cooldown:2}],boostLaunchers:plateauLaunchers},
  jumpLinks:plateauLaunchers.map(p=>link(p.id,point(p.x,p.z,p.y),p.target,p.z?'flank':'middle')),
  navNodes:[point(-61,0),point(-52,0),point(-25,-30),point(0,-34),point(25,-30),point(61,0),point(25,30),point(0,34),point(-25,30),point(0,0)],
  landmarks:[{label:'WEST TABLELAND',x:-52,z:0,y:4},{label:'EAST TABLELAND',x:52,z:0,y:4},{label:'LONGREACH',x:0,z:0,y:3}]
};

export const EXPANSION_MAPS=freeze([canyon,megastructure,plateau]);
export default EXPANSION_MAPS;
