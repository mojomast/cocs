import {terrainSupportAt} from './terrain.mjs';
import {freeze,wall,cover,teamSpawns,flagSpawns} from './map-schema.mjs';

const smooth=t=>t<=0?0:t>=1?1:t*t*(3-2*t);
// Broad ridge approaches remain walkable; the outer crest is an open shelf.
const gauss=(d,s)=>Math.exp(-(d*d)/(2*s*s));

// Shared 17 x 11 heightfield vertices tile the whole playfield with no gaps.
const xs=[-80,-70,-60,-50,-40,-30,-20,-10,0,10,20,30,40,50,60,70,80];
const zs=[-35,-28,-21,-14,-7,0,7,14,21,28,35];

const heightAt=(x,z)=>{
  const r=Math.hypot(x,z);
  const hill=7*(1-smooth(r/21));
  const pad=2.5*smooth((Math.abs(x)-50)/10);
  const ridgeAxis=smooth((Math.abs(z)-12)/16);
  const ridgePeak=gauss(x-(z>0?-56:56),22);
  const ridge=ridgeAxis*(11+1.5*ridgePeak);
  let h=Math.max(0,hill,pad,ridge);
  const ditch=-1.2*Math.max(0,1-Math.pow((Math.abs(z)-14)/5,2));
  if(h<1.6)h+=ditch;
  return h;
};

const vertex=(i,j)=>[xs[i],heightAt(xs[i],zs[j]),zs[j]];
const surfaces=[];
for(let j=0;j<zs.length-1;j++)for(let i=0;i<xs.length-1;i++){
  const [ax,ay,az]=vertex(i,j),[bx,by,bz]=vertex(i,j+1),[cx,cy,cz]=vertex(i+1,j+1),[dx,dy,dz]=vertex(i+1,j);
  const material=Math.abs(zs[j])>=21||Math.abs(zs[j+1])>=21?'rock':ay<0||by<0||cy<0||dy<0?'dirt':'grass';
  surfaces.push({id:`gulch-${i}-${j}`,material,vertices:[[ax,ay,az],[bx,by,bz],[cx,cy,cz],[dx,dy,dz]]});
}

// Map-local solid architecture: chamfered footprints, battered lower armor,
// vertical upper faces and walkable roof caps share render/collision geometry.
const baseFaces=[];
const fortress=(id,x,z,w,d,top)=>{
  const ring=(inset,y)=>{
    const a=w/2-inset,b=d/2-inset,c=.65;
    return [[-a,-b+c],[-a,b-c],[-a+c,b],[a-c,b],[a,b-c],[a,-b+c],[a-c,-b],[-a+c,-b]].map(([u,v])=>[x+u,y,z+v]);
  };
  const rings=[ring(0,2.5),ring(.35,top-.6),ring(.55,top)];
  for(let tier=0;tier<rings.length-1;tier++)for(let i=0;i<8;i++){
    const next=(i+1)%8;
    baseFaces.push({id:`${id}-face-${tier}-${i}`,material:tier?'metal':'concrete',vertices:[rings[tier][i],rings[tier][next],rings[tier+1][next],rings[tier+1][i]]});
  }
  surfaces.push({id:`${id}-roof`,material:'concrete',vertices:rings[2]});
};
const rampX=(id,x0,x1,y0,y1,zHalf,material='concrete')=>({id,material,vertices:[[x0,y0,-zHalf],[x0,y0,zHalf],[x1,y1,zHalf],[x1,y1,-zHalf]]});

const bases=[-64,64].map(cx=>{
  const out=Math.sign(cx);
  const kx=cx+out*4.5;
  return {cx,out,kx};
});
for(const {cx,out,kx} of bases){
  fortress(`base-keep-${cx}`,kx,0,8,8,7);
  for(const dx of [-4.25,4.25])for(const z of [-6,6])fortress(`base-tower-${cx}-${dx}-${z}`,cx+dx,z,3.2,3.2,8.5);
  const ramp=out<0
    ?rampX(`base-ramp-${cx}`,kx-10,kx-3.45,2.5,7,2.2)
    :rampX(`base-ramp-${cx}`,kx+3.45,kx+10,7,2.5,2.2);
  surfaces.push(ramp);
  // Close the ramp sides so the access incline has visible structural depth.
  for(const sign of [-1,1]){
    const a=ramp.vertices[sign<0?0:1],b=ramp.vertices[sign<0?3:2];
    const high=a[1]>b[1]?a:b,low=a[1]>b[1]?b:a;
    baseFaces.push({id:`base-ramp-side-${cx}-${sign}`,material:'concrete',vertices:[low,high,[high[0],2.5,high[2]]]});
  }
}

const perimeterWall=(id,a,b)=>({id,material:'cliff',vertices:[[a[0],-10,a[1]],[b[0],-10,b[1]],[b[0],16,b[1]],[a[0],16,a[1]]]});
const walls=[...baseFaces];
for(let i=0;i<xs.length-1;i++){
  walls.push(perimeterWall(`rim-s-${i}`,[xs[i],-35],[xs[i+1],-35]));
  walls.push(perimeterWall(`rim-n-${i}`,[xs[i],35],[xs[i+1],35]));
}
for(let j=0;j<zs.length-1;j++){
  walls.push(perimeterWall(`rim-w-${j}`,[-80,zs[j]],[-80,zs[j+1]]));
  walls.push(perimeterWall(`rim-e-${j}`,[80,zs[j]],[80,zs[j+1]]));
}

const terrain={maxSlope:.9,surfaces,walls};

const point=(x,z)=>({x,z,y:terrainSupportAt(x,z,terrain,terrain.maxSlope).y});

const baseWalls=bases.flatMap(({cx,out})=>[
  wall(cx-4.25,6,5.5,1,5.5,'base-wall'),wall(cx+4.25,6,5.5,1,5.5,'base-wall'),
  wall(cx-4.25,-6,5.5,1,5.5,'base-wall'),wall(cx+4.25,-6,5.5,1,5.5,'base-wall'),
  wall(cx-out*7,-4.5,1.5,3,6.2,'base-gate'),
  wall(cx-out*7,4.5,1.5,3,6.2,'base-gate'),
  ...[-1,1].flatMap(sign=>[-2,2].map(dx=>wall(cx+dx,sign*6,1,2,6.2,'base-buttress')))
]);

const boost=(id,x,z,dir,power,vy)=>({id,...point(x,z),dir,power,vy,cooldown:2});
const link=(id,source,target)=>({id,source,target,traversal:id});
const roofPads=[
  boost('red-roof-tele',-66,0,[1,0],34,20),
  boost('blue-roof-tele',66,0,[-1,0],34,20)
];
const roofLinks=[
  link('red-roof-tele',point(-66,0),point(-40,0)),
  link('blue-roof-tele',point(66,0),point(40,0))
];


const bloodGulch={
  id:'blood-gulch',
  name:'Blood Gulch',
  tag:'OUTDOOR / CANYON CTF',
  description:'A warm sandstone box canyon with chamfered fortress keeps, corner towers, raised roof decks, and open high sniper ridges. Climb the exposed ridge approaches, push the big hill, or take a Warthog through the vehicle lanes.',
  color:'#c98c4e',
  background:'#8ec6df',
  bounds:{minX:-80,maxX:80,minZ:-35,maxZ:35},voidY:-10,
  terrain,
  teamSpawns:teamSpawns([[-75,5],[-75,-5],[-64,-27]],[[75,-5],[75,5],[64,27]]),
  flagSpawns:flagSpawns(-64,64),
  spawns:[[-40,0],[-20,-18],[0,18],[20,18],[40,0],[0,-18],[-20,18],[20,-18],[-48,-7],[48,7]],
  pickups:[
    ['health',-64,-9],['health',64,9],['armor',-64,9],['armor',64,-9],
    ['health',0,-18],['armor',0,18],
    ['rocket',0,0],
    ['rail',-56,28],['rail',56,-28],
    ['scatter',-34,7],['scatter',34,-7],
    ['plasma',-44,-14],['plasma',44,14],
    ['grenade',-12,0],['grenade',12,0],
    ['shock',-44,14],['shock',44,-14],
    ['flak',0,20],['flak',0,-20],
    ['haste',-30,-20],['overcharge',30,20],
    ['overshield',0,3]
  ],
  blocks:[
    ...baseWalls,
    cover(-30,0,3,2,2.0),
    cover(24,0,3,2,2.0,'rock'),
    cover(0,16,3,2,1.6,'rock'),cover(0,-16,3,2,1.6,'rock'),
    cover(-40,14,3,2,1.4,'rock'),cover(40,-14,3,2,1.4,'rock')
  ],
  traversal:{
    trampolines:[
      {id:'gulch-north-hop',...point(0,-28),power:15,cooldown:2},
      {id:'gulch-south-hop',...point(0,28),power:15,cooldown:2}
    ],
    boostLaunchers:roofPads
  },
  jumpLinks:roofLinks,
  navNodes:[
    point(-50,0),point(-40,0),point(-20,0),point(0,0),point(20,0),point(40,0),point(50,0),
    ...[-18,18].flatMap(z=>[-48,-28,-8,8,28,48].map(x=>point(x,z))),
    ...[-1,1].flatMap(sign=>[14,21,28,32].map(z=>point(-56*sign,z*sign))),
    point(-64,-27),point(64,27)
  ],
  landmarks:[
    {label:'RED BASE',...point(-64,0)},
    {label:'BLUE BASE',...point(64,0)},
    {label:'BIG HILL',...point(0,0)},
    {label:'SOUTH SNIPER RIDGE',...point(-56,28)},
    {label:'NORTH SNIPER RIDGE',...point(56,-28)}
  ],
  vehicles:[
    {id:'blood-gulch-west-puma',kind:'puma',x:-46,y:0,z:0,yaw:Math.PI/2},
    {id:'blood-gulch-east-puma',kind:'puma',x:46,y:0,z:0,yaw:-Math.PI/2}
  ]
};

export const BLOOD_GULCH=freeze(bloodGulch);
export default BLOOD_GULCH;
