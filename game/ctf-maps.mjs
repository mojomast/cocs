import {terrainSupportAt} from './terrain.mjs';
import {freeze,wall,teamSpawns,flagSpawns} from './map-schema.mjs';

const smooth=t=>t<=0?0:t>=1?1:t*t*(3-2*t);
const clamp01=t=>Math.max(0,Math.min(1,t));
const cave=(x,z,cx,cz,r)=>{
  const wx=1-Math.pow((x-cx)/r,2),wz=1-Math.pow((z-cz)/r,2);
  return clamp01(wx)*clamp01(wz);
};

const flat=(id,x0,x1,z0,z1,y,material='concrete')=>({id,material,vertices:[[x0,y,z0],[x0,y,z1],[x1,y,z1],[x1,y,z0]]});
const wallX=(id,z,x0,x1,bottom,top)=>({id,material:'cliff',vertices:[[x0,bottom,z],[x1,bottom,z],[x1,top,z],[x0,top,z]]});
const wallZ=(id,x,z0,z1,bottom,top)=>({id,material:'cliff',vertices:[[x,bottom,z0],[x,bottom,z1],[x,top,z1],[x,top,z0]]});

const grid=(xs,zs,height,material,skip=()=>false)=>{
  const surfaces=[];
  for(let j=0;j<zs.length-1;j++)for(let i=0;i<xs.length-1;i++){
    if(skip((xs[i]+xs[i+1])/2,(zs[j]+zs[j+1])/2))continue;
    const vertices=[
      [xs[i],height(xs[i],zs[j]),zs[j]],
      [xs[i],height(xs[i],zs[j+1]),zs[j+1]],
      [xs[i+1],height(xs[i+1],zs[j+1]),zs[j+1]],
      [xs[i+1],height(xs[i+1],zs[j]),zs[j]]
    ];
    surfaces.push({id:`t-${i}-${j}`,material:material(vertices),vertices});
  }
  return surfaces;
};

const rimWalls=(bounds,{bottom=-12,top=20,gaps=[]}={})=>{
  const segs=[];
  for(let x=bounds.minX;x<bounds.maxX;x+=10){
    const x2=Math.min(x+10,bounds.maxX);
    segs.push({id:`s-${x}`,axis:'z',side:bounds.minZ,x0:x,x1:x2});
    segs.push({id:`n-${x}`,axis:'z',side:bounds.maxZ,x0:x,x1:x2});
  }
  for(let z=bounds.minZ;z<bounds.maxZ;z+=10){
    const z2=Math.min(z+10,bounds.maxZ);
    segs.push({id:`w-${z}`,axis:'x',side:bounds.minX,z0:z,z1:z2});
    segs.push({id:`e-${z}`,axis:'x',side:bounds.maxX,z0:z,z1:z2});
  }
  return segs.filter(seg=>!gaps.some(g=>g.axis===seg.axis&&g.side===seg.side&&(seg.axis==='z'?(seg.x0+seg.x1)/2>g.min&&(seg.x0+seg.x1)/2<g.max:(seg.z0+seg.z1)/2>g.min&&(seg.z0+seg.z1)/2<g.max))).map(seg=>seg.axis==='z'?wallX(seg.id,seg.side,seg.x0,seg.x1,bottom,top):wallZ(seg.id,seg.side,seg.z0,seg.z1,bottom,top));
};

const compound=(cx,out,pad=2.5)=>[
  wall(cx-4.25,6,5.5,1,pad+3,'base-wall'),wall(cx+4.25,6,5.5,1,pad+3,'base-wall'),
  wall(cx-4.25,-6,5.5,1,pad+3,'base-wall'),wall(cx+4.25,-6,5.5,1,pad+3,'base-wall'),
  wall(cx-out*7,0,1,12,pad+3,'deck'),
  wall(cx+out*7,0,1,12,pad+3,'deck'),
  wall(cx+out*4,0,4,4,pad+2,'deck')
];

const boost=(id,terrain,x,z,dir,power,vy)=>({id,...pointFor(terrain,x,z),dir,power,vy,cooldown:2});
const link=(id,source,target)=>({id,source,target,traversal:id});
const pointFor=(terrain,x,z)=>({x,z,y:terrainSupportAt(x,z,terrain,terrain.maxSlope).y});

/* ---------------- Frostline ---------------- */
const frostXs=[-100,-80,-60,-40,-30,-20,-10,-6,0,6,10,20,30,40,60,80,100];
const frostZs=[-40,-30,-20,-10,0,10,20,30,40];
const frostHeight=(x,z)=>{
  const ridge=5.5*smooth((Math.abs(z)-24)/12);
  const pad=2.5*smooth((Math.abs(x)-78)/10);
  let h=Math.max(0,ridge,pad);
  const river=-0.9*clamp01(1-Math.pow(Math.abs(z)/9,2));
  if(h<0.6)h+=river;
  const carve=Math.max(cave(x,z,-60,30,12),cave(x,z,60,-30,12));
  return h*(1-carve);
};
const frostMaterial=v=>Math.abs(v[0][2])>=24?'rock':(v[0][1]<0||v[2][1]<0?'dirt':'grass');
const frostSurfaces=grid(frostXs,frostZs,frostHeight,frostMaterial,(x,z)=>Math.abs(x)<6&&Math.abs(z)>5);
frostSurfaces.push(flat('frost-bridge',-6,6,-10,10,0));
const frostWalls=[...rimWalls({minX:-100,maxX:100,minZ:-40,maxZ:40},{bottom:-12,top:18})];
for(const x of [-69,-51])frostWalls.push(wallZ(`frost-ice-a-${x}`,x,20,40,-2,9));
for(const x of [51,69])frostWalls.push(wallZ(`frost-ice-b-${x}`,x,-40,-20,-2,9));
const frostTerrain={maxSlope:.9,surfaces:frostSurfaces,walls:frostWalls};
const frostPoint=(x,z)=>pointFor(frostTerrain,x,z);
const frostBoosts=[
  boost('frost-west-launch',frostTerrain,-76,0,[1,0],30,16),
  boost('frost-east-launch',frostTerrain,76,0,[-1,0],30,16),
  boost('frost-north-flank',frostTerrain,-30,30,[1,0],24,12),
  boost('frost-south-flank',frostTerrain,30,-30,[-1,0],24,12)
];
const frostLinks=[
  link('frost-west-launch',frostPoint(-76,0),frostPoint(-40,0)),
  link('frost-east-launch',frostPoint(76,0),frostPoint(40,0)),
  link('frost-north-flank',frostPoint(-30,30),frostPoint(10,30)),
  link('frost-south-flank',frostPoint(30,-30),frostPoint(-10,-30))
];
const frostline={
  id:'frostline',name:'Frostline',tag:'SNOW CANYON / CTF',
  description:'A frozen canyon CTF map with twin forts, a frozen river mid lane, ice-cave flanks, and a crevasse bridge holding the rocket.',
  color:'#9fd4ff',background:'#cfe9f7',
  bounds:{minX:-100,maxX:100,minZ:-40,maxZ:40},voidY:-12,terrain:frostTerrain,
  teamSpawns:teamSpawns([[-88,-4],[-88,4],[-60,30]],[[88,-4],[88,4],[60,-30]]),
  flagSpawns:flagSpawns(-88,88),
  spawns:[[-88,-4],[-88,4],[88,-4],[88,4],[-60,30],[60,-30],[-40,0],[40,0],[0,0],[12,18],[12,-18]],
  pickups:[
    ['health',-88,-9],['health',88,9],['armor',-88,9],['armor',88,-9],
    ['rocket',0,0],['rail',-40,32],['rail',40,-32],
    ['scatter',-30,0],['scatter',30,0],['plasma',-15,-18],['plasma',15,18],
    ['grenade',-50,20],['grenade',50,-20],['shock',-20,30],['shock',20,-30],
    ['flak',12,20],['flak',12,-20],['haste',-70,20],['overcharge',70,-20],['overshield',0,8]
  ],
  blocks:[
    ...compound(-88,-1,2.5),...compound(88,1,2.5),
    wall(-20,15,3,2,1.8,'cover'),wall(20,0,3,2,1.8,'rock'),
    wall(0,28,3,2,1.6,'rock'),wall(0,-28,3,2,1.6,'rock'),
    wall(-45,-20,3,2,1.4,'rock'),wall(45,20,3,2,1.4,'rock')
  ],
  traversal:{trampolines:[
    {id:'frost-north-hop',...frostPoint(12,30),power:15,cooldown:2},
    {id:'frost-south-hop',...frostPoint(12,-30),power:15,cooldown:2}
  ],boostLaunchers:frostBoosts},
  jumpLinks:frostLinks,
  navNodes:[
    frostPoint(-88,0),frostPoint(-60,0),frostPoint(-30,0),frostPoint(12,0),frostPoint(30,0),frostPoint(60,0),frostPoint(88,0),
    frostPoint(-60,30),frostPoint(60,-30),frostPoint(-40,20),frostPoint(40,-20),frostPoint(12,20),frostPoint(12,-20)
  ],
  landmarks:[
    {label:'WEST FORT',...frostPoint(-88,0)},
    {label:'EAST FORT',...frostPoint(88,0)},
    {label:'CREVASSE BRIDGE',...frostPoint(0,0)}
  ],
  vehicles:[
    {id:'frostline-west-puma',kind:'puma',x:-50,y:0,z:12,yaw:Math.PI/2},
    {id:'frostline-east-puma',kind:'puma',x:50,y:0,z:-12,yaw:-Math.PI/2}
  ]
};

/* ---------------- Derelict Station ---------------- */
const derelictXs=[-85,-70,-55,-40,-20,-10,0,10,20,40,55,70,85];
const derelictZs=[-45,-30,-20,-12,0,12,20,30,45];
const derelictHeight=(x,z)=>{
  const north=5*smooth((z-14)/6);
  const south=-4*smooth((-z-14)/6);
  return north+south;
};
const derelictMaterial=v=>v[0][1]<-1?'dirt':'concrete';
const derelictSurfaces=grid(derelictXs,derelictZs,derelictHeight,derelictMaterial);
const derelictWalls=[...rimWalls({minX:-85,maxX:85,minZ:-45,maxZ:45},{bottom:-14,top:16})];
const derelictTerrain={maxSlope:.9,surfaces:derelictSurfaces,walls:derelictWalls};
const derelictPoint=(x,z)=>pointFor(derelictTerrain,x,z);
const derelictBoosts=[
  boost('station-west-lift',derelictTerrain,-62,0,[1,0],26,12),
  boost('station-east-lift',derelictTerrain,62,0,[-1,0],26,12),
  boost('station-north-lift',derelictTerrain,-20,20,[1,0],24,14),
  boost('station-south-lift',derelictTerrain,20,-20,[-1,0],24,14)
];
const derelictLinks=[
  link('station-west-lift',derelictPoint(-62,0),derelictPoint(-40,0)),
  link('station-east-lift',derelictPoint(62,0),derelictPoint(40,0)),
  link('station-north-lift',derelictPoint(-20,20),derelictPoint(20,20)),
  link('station-south-lift',derelictPoint(20,-20),derelictPoint(-20,-20))
];
const derelict={
  id:'derelict-station',name:'Derelict Station',tag:'ORBITAL HANGAR / CTF',
  description:'An infantry-focused orbital CTF station with three deck lanes at different heights linked by boost lifts and hangar strongpoints.',
  color:'#8fe3d0',background:'#0b1a24',
  bounds:{minX:-85,maxX:85,minZ:-45,maxZ:45},voidY:-14,terrain:derelictTerrain,
  teamSpawns:teamSpawns([[-74,-4],[-74,4],[-70,20]],[[74,-4],[74,4],[70,-20]]),
  flagSpawns:flagSpawns(-74,74),
  spawns:[[-74,-4],[-74,4],[74,-4],[74,4],[-70,20],[70,-20],[-40,0],[40,0],[0,0],[0,20],[0,-20],[-20,20],[20,-20]],
  pickups:[
    ['health',-74,-10],['health',74,10],['armor',-74,10],['armor',74,-10],
    ['rocket',0,20],['rail',-40,20],['rail',40,-20],
    ['scatter',-30,0],['scatter',30,0],['plasma',-15,0],['plasma',15,0],
    ['grenade',-50,20],['grenade',50,-20],['shock',-50,-20],['shock',50,20],
    ['flak',12,0],['flak',12,-20],['flak',12,20],['haste',-70,-20],['overcharge',70,20],['overshield',0,0]
  ],
  blocks:[
    ...compound(-74,-1,0),...compound(74,1,0),
    wall(-46,8,3,2,2.0,'cover'),wall(46,-10,3,2,2.0,'rock'),
    wall(-30,20,3,2,1.8,'rock'),wall(30,-20,3,2,1.8,'rock'),
    wall(-30,-20,3,2,1.8,'rock'),wall(30,20,3,2,1.8,'rock'),
    wall(0,10,6,1,3,'bulkhead'),wall(0,-10,6,1,3,'bulkhead'),
    wall(-60,20,4,1,3,'bulkhead'),wall(60,-20,4,1,3,'bulkhead')
  ],
  traversal:{trampolines:[
    {id:'station-north-hop',...derelictPoint(0,30),power:15,cooldown:2},
    {id:'station-south-hop',...derelictPoint(0,-30),power:15,cooldown:2}
  ],boostLaunchers:derelictBoosts},
  jumpLinks:derelictLinks,
  navNodes:[
    derelictPoint(-74,0),derelictPoint(-40,0),derelictPoint(0,0),derelictPoint(40,0),derelictPoint(74,0),
    derelictPoint(-20,20),derelictPoint(20,20),derelictPoint(-20,-20),derelictPoint(20,-20),derelictPoint(0,30),derelictPoint(0,-30)
  ],
  landmarks:[
    {label:'WEST HANGAR',...derelictPoint(-74,0)},
    {label:'EAST HANGAR',...derelictPoint(74,0)},
    {label:'CENTRAL REACTOR',...derelictPoint(0,0)}
  ],
  vehicles:[]
};

/* ---------------- Ashen Rift ---------------- */
const ashenXs=[-95,-80,-60,-50,-40,-20,-10,-6,0,6,10,20,40,50,60,80,95];
const ashenZs=[-45,-35,-25,-15,-6,0,6,15,25,35,45];
const ashenHeight=(x,z)=>{
  const west=8*smooth((-x-55)/25);
  const ridge=4*smooth((Math.abs(z)-30)/12);
  let h=Math.max(0,west,ridge);
  const carve=Math.max(cave(x,z,-20,-32,11),cave(x,z,20,32,11));
  return h*(1-carve);
};
const ashenMaterial=v=>Math.abs(v[0][2])>=30?'rock':(v[0][1]>4?'rock':'dirt');
const ashenSurfaces=grid(ashenXs,ashenZs,ashenHeight,ashenMaterial,(x,z)=>Math.abs(x)<6&&Math.abs(z)>6);
ashenSurfaces.push(flat('ashen-bridge',-6,6,-6,6,0));
const ashenWalls=[...rimWalls({minX:-95,maxX:95,minZ:-45,maxZ:45},{bottom:-12,top:20})];
for(const x of [-29,-11])ashenWalls.push(wallZ(`ashen-tunnel-a-${x}`,x,-43,-21,-2,10));
for(const x of [11,29])ashenWalls.push(wallZ(`ashen-tunnel-b-${x}`,x,21,43,-2,10));
const ashenTerrain={maxSlope:.9,surfaces:ashenSurfaces,walls:ashenWalls};
const ashenPoint=(x,z)=>pointFor(ashenTerrain,x,z);
const ashenBoosts=[
  boost('ashen-west-launch',ashenTerrain,-80,0,[1,0],28,16),
  boost('ashen-east-launch',ashenTerrain,80,0,[-1,0],28,16),
  boost('ashen-north-flank',ashenTerrain,-30,30,[1,0],22,12),
  boost('ashen-south-flank',ashenTerrain,30,-30,[-1,0],22,12)
];
const ashenLinks=[
  link('ashen-west-launch',ashenPoint(-80,0),ashenPoint(-46,0)),
  link('ashen-east-launch',ashenPoint(80,0),ashenPoint(46,0)),
  link('ashen-north-flank',ashenPoint(-30,30),ashenPoint(10,30)),
  link('ashen-south-flank',ashenPoint(30,-30),ashenPoint(-10,-30))
];
const ashen={
  id:'ashen-rift',name:'Ashen Rift',tag:'VOLCANIC / ASYMMETRIC CTF',
  description:'An asymmetric volcanic CTF rift: a high western fortress overlooks a low eastern refinery across a lava bridge and collapsed tunnel lanes.',
  color:'#e0704a',background:'#2a1208',
  bounds:{minX:-95,maxX:95,minZ:-45,maxZ:45},voidY:-12,terrain:ashenTerrain,
  teamSpawns:teamSpawns([[-80,-4],[-80,4],[-20,-32]],[[80,-4],[80,4],[20,32]]),
  flagSpawns:flagSpawns(-80,80),
  spawns:[[-80,-4],[-80,4],[80,-4],[80,4],[-20,-32],[20,32],[-46,0],[46,0],[0,0],[12,15],[12,-15]],
  pickups:[
    ['health',-80,-10],['health',80,10],['armor',-80,10],['armor',80,-10],
    ['rocket',0,0],['rail',-20,-32],['rail',20,32],
    ['scatter',-30,0],['scatter',30,0],['plasma',-15,-15],['plasma',15,15],
    ['grenade',-50,15],['grenade',50,-15],['shock',-50,-15],['shock',50,15],
    ['flak',12,15],['flak',12,-15],['haste',-70,10],['overcharge',70,-10],['overshield',0,6]
  ],
  blocks:[
    ...compound(-80,-1,8),...compound(80,1,0),
    wall(-40,0,3,2,1.8,'cover'),wall(40,0,3,2,1.8,'rock'),
    wall(-30,20,3,2,1.6,'rock'),wall(30,-20,3,2,1.6,'rock'),
    wall(0,22,3,2,2.2,'rock'),wall(0,-22,3,2,2.2,'rock')
  ],
  traversal:{trampolines:[
    {id:'ashen-north-hop',...ashenPoint(12,30),power:15,cooldown:2},
    {id:'ashen-south-hop',...ashenPoint(12,-30),power:15,cooldown:2}
  ],boostLaunchers:ashenBoosts},
  jumpLinks:ashenLinks,
  navNodes:[
    ashenPoint(-80,0),ashenPoint(-55,0),ashenPoint(-30,0),ashenPoint(0,0),ashenPoint(30,0),ashenPoint(55,0),ashenPoint(80,0),
    ashenPoint(-20,-32),ashenPoint(20,32),ashenPoint(12,20),ashenPoint(12,-20),ashenPoint(-45,20),ashenPoint(45,-20)
  ],
  landmarks:[
    {label:'WEST FORTRESS',...ashenPoint(-80,0)},
    {label:'EAST REFINERY',...ashenPoint(80,0)},
    {label:'LAVA BRIDGE',...ashenPoint(0,0)}
  ],
  vehicles:[
    {id:'ashen-rift-puma',kind:'puma',x:-46,y:0,z:12,yaw:Math.PI/2},
    {id:'ashen-rift-puma-2',kind:'puma',x:46,y:0,z:-12,yaw:-Math.PI/2}
  ]
};

export const CTF_MAPS=freeze([frostline,derelict,ashen]);
export default CTF_MAPS;
