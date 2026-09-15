import * as T from 'three';

// Deterministic value-noise / FBM surface maps. Everything is procedural and
// cached per build; callers clearSurfaceTextures() before rebuilding a world so
// disposed GPU textures are never handed out again.

const clamp255=value=>value<0?0:value>255?255:value;
const smooth=t=>t*t*(3-2*t);
const hash=(x,y,seed)=>{
 let h=(Math.imul(x|0,374761393)+Math.imul(y|0,668265263)+Math.imul(seed|0,2246822519))|0;
 h=Math.imul(h^(h>>>13),1274126177);
 h^=h>>>16;
 return (h>>>0)/4294967295;
};
const noise=(x,y,seed)=>{
 const xi=Math.floor(x),yi=Math.floor(y),xf=x-xi,yf=y-yi;
 const a=hash(xi,yi,seed),b=hash(xi+1,yi,seed),c=hash(xi,yi+1,seed),d=hash(xi+1,yi+1,seed);
 const u=smooth(xf),v=smooth(yf);
 return (a*(1-u)+b*u)*(1-v)+(c*(1-u)+d*u)*v;
};
const fbm=(x,y,seed,octaves=4)=>{
 let total=0,amp=.5,freq=1,norm=0;
 for(let i=0;i<octaves;i++){total+=noise(x*freq,y*freq,seed+i*131)*amp;norm+=amp;amp*=.5;freq*=2;}
 return total/norm;
};

const LAYERS={
 concrete:{scale:5,contrast:.22,rough:[.6,.95],hue:[1,1,1],grain:.5},
 tile:{scale:7,contrast:.3,rough:[.45,.8],hue:[1,1,1],grain:.4},
 metal:{scale:11,contrast:.16,rough:[.25,.55],hue:[.98,1,1],grain:.7},
 sand:{scale:9,contrast:.18,rough:[.82,1],hue:[1.05,1,.92],grain:.3},
 grass:{scale:13,contrast:.26,rough:[.72,1],hue:[.95,1.05,.86],grain:.5},
 rock:{scale:6,contrast:.34,rough:[.78,1],hue:[1.03,.99,.94],grain:.6},
 ice:{scale:8,contrast:.2,rough:[.15,.4],hue:[.96,1,1.06],grain:.4},
};

const cache=new Map();

export function clearSurfaceTextures(){for(const textures of cache.values())for(const texture of Object.values(textures))texture?.dispose?.();cache.clear();clearWetSheenTextures();}

// A single shared puddle/wet-sheen overlay: a soft, low-contrast blotch map the
// view blends over wet floor materials. It is cached once (keyed only by size
// and seed) and released by clearSurfaceTextures alongside the surface maps, so
// exactly-once disposal still holds. Returns null without a document.
const wetCache=new Map();
export function wetSheenTexture({size=128,seed=1}={}){
 const key=`wet|${size}|${seed}`;
 const cached=wetCache.get(key);
 if(cached)return cached;
 if(typeof document==='undefined'||!document.createElement)return null;
 const canvas=document.createElement('canvas');canvas.width=size;canvas.height=size;
 const ctx=canvas.getContext('2d');
 if(!ctx?.createImageData||!ctx.putImageData)return null;
 const image=ctx.createImageData(size,size),data=image.data;
 for(let y=0;y<size;y++)for(let x=0;x<size;x++){
  const i=(y*size+x)*4,u=x/size*3.1,v=y/size*3.1;
  const blotch=fbm(u,v,seed+411,4),edge=fbm(u*2.7,v*2.7,seed+913,3),n=Math.max(0,Math.min(1,(blotch*.75+edge*.25-.4)*1.7));
  const shade=clamp255(255*(1-n*.18));
  data[i]=data[i+1]=data[i+2]=shade;data[i+3]=clamp255(n*210);
 }
 ctx.putImageData(image,0,0);
 const map=new T.CanvasTexture(canvas);
 map.wrapS=map.wrapT=T.RepeatWrapping;
 map.colorSpace=T.NoColorSpace;
 map.needsUpdate=true;
 map.userData.surfaceKind='wet';
 wetCache.set(key,map);
 return map;
}
export function clearWetSheenTextures(){for(const texture of wetCache.values())texture?.dispose?.();wetCache.clear();}

export function surfaceTextures(kind='concrete',{size=96,seed=1,repeat=[1,1],normal=true,roughness=true}={}){
 const key=`${kind}|${size}|${seed}|${repeat[0]},${repeat[1]}|${normal?1:0}|${roughness?1:0}`;
 const cached=cache.get(key);
 if(cached)return cached;
 if(typeof document==='undefined'||!document.createElement)return null;
 const layer=LAYERS[kind]||LAYERS.concrete;
 const make=channel=>{
  const canvas=document.createElement('canvas');
  canvas.width=size;canvas.height=size;
  const ctx=canvas.getContext('2d');
  if(!ctx?.createImageData||!ctx.putImageData)return null;
  const image=ctx.createImageData(size,size),data=image.data,edge=1/size;
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
   const i=(y*size+x)*4,u=(x/size)*layer.scale,v=(y/size)*layer.scale;
   const base=fbm(u,v,seed+channel*997,4),fine=fbm(u*3.1,v*3.1,seed+channel*997+17,3),n=base*.72+fine*.28;
   if(channel===0){
    const lum=(1-layer.contrast*.5)+layer.contrast*n;
    data[i]=clamp255(lum*255*layer.hue[0]);
    data[i+1]=clamp255(lum*255*layer.hue[1]);
    data[i+2]=clamp255(lum*255*layer.hue[2]);
   }else if(channel===1){
    const r=(layer.rough[0]+(layer.rough[1]-layer.rough[0])*n)*255;
    data[i]=data[i+1]=data[i+2]=clamp255(r);
   }else{
    const dx=fbm(u+edge,v,seed+channel*997,4)-base,dy=fbm(u,v+edge,seed+channel*997,4)-base,strength=layer.grain*6;
    data[i]=clamp255(128-dx*strength*128);
    data[i+1]=clamp255(128-dy*strength*128);
    data[i+2]=255;
   }
   data[i+3]=255;
  }
  ctx.putImageData(image,0,0);
  const map=new T.CanvasTexture(canvas);
  map.wrapS=map.wrapT=T.RepeatWrapping;
  map.repeat.set(repeat[0],repeat[1]);
  map.colorSpace=channel===0?T.SRGBColorSpace:T.NoColorSpace;
  map.needsUpdate=true;
  map.userData.surfaceKind=kind;
  return map;
 };
 const result={map:make(0)};
 if(roughness)result.roughnessMap=make(1);
 if(normal)result.normalMap=make(2);
 cache.set(key,result);
 return result;
}
