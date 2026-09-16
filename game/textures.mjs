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
 carbon_fiber:{scale:8,contrast:.3,rough:[.18,.4],hue:[.2,.22,.25],grain:.8,type:'carbon_fiber'},
 metal_grating:{scale:6,contrast:.45,rough:[.28,.88],hue:[.55,.58,.62],grain:.9,type:'metal_grating'},
 hex_paneling:{scale:5,contrast:.35,rough:[.26,.75],hue:[.6,.65,.72],grain:.75,type:'hex_paneling'},
 hazard_stripes:{scale:6,contrast:.5,rough:[.35,.7],hue:[.9,.75,.15],grain:.6,type:'hazard_stripes'},
 weathered_concrete:{scale:5.5,contrast:.38,rough:[.65,.98],hue:[.88,.86,.82],grain:.8,type:'weathered_concrete'},
 holographic_grid:{scale:4,contrast:.6,rough:[.12,.35],hue:[.2,.95,.88],grain:.5,type:'holographic_grid'},
};
// Aliases for intuitive API usage
LAYERS.carbon = LAYERS.carbonFiber = LAYERS.carbon_fiber;
LAYERS.grating = LAYERS.metalGrating = LAYERS.industrial_grating = LAYERS.metal_grating;
LAYERS.hex = LAYERS.hexPaneling = LAYERS.hex_panel = LAYERS.hex_paneling;
LAYERS.hazard = LAYERS.hazardStripes = LAYERS.hazard_stripes;
LAYERS.weatheredConcrete = LAYERS.weathered_concrete;
LAYERS.hologrid = LAYERS.holographicGrid = LAYERS.holographic_grid;

export const TEXTURE_KINDS = Object.freeze([
  'concrete', 'tile', 'metal', 'sand', 'grass', 'rock', 'ice',
  'carbon_fiber', 'metal_grating', 'hex_paneling', 'hazard_stripes', 'weathered_concrete', 'holographic_grid',
]);

const cache=new Map();

function generatePatternPixel(kind, u, v, seed, channel, edge) {
  if (kind === 'carbon_fiber') {
    const cu = u * 4, cv = v * 4;
    const bx = Math.floor(cu), by = Math.floor(cv);
    const fx = cu - bx, fy = cv - by;
    const twill = ((bx + by) & 1) === 0;
    const thread = twill ? Math.sin(fy * Math.PI * 6) : Math.sin(fx * Math.PI * 6);
    const threadN = thread * 0.5 + 0.5;
    const grain = (fbm(u * 2, v * 2, seed, 2) - 0.5) * 0.12;
    if (channel === 0) {
      const lum = (0.13 + (twill ? 0.04 : 0) + threadN * 0.05 + grain);
      return [clamp255(lum * 255 * 0.94), clamp255(lum * 255 * 0.98), clamp255(lum * 255 * 1.05)];
    } else if (channel === 1) {
      const r = (0.18 + (twill ? 0.08 : 0) + (1 - threadN) * 0.15) * 255;
      return [clamp255(r), clamp255(r), clamp255(r)];
    } else {
      const nx = twill ? (fx - 0.5) * 0.35 : thread * 0.45;
      const ny = twill ? thread * 0.45 : (fy - 0.5) * 0.35;
      return [clamp255(128 + nx * 128), clamp255(128 + ny * 128), 255];
    }
  }

  if (kind === 'metal_grating') {
    const gu = ((u * 2.5) % 1 + 1) % 1;
    const gv = ((v * 2.5) % 1 + 1) % 1;
    const row = Math.floor(((v * 2.5) % 2 + 2) % 2);
    const shiftedU = (gu + (row === 1 ? 0.5 : 0)) % 1;
    const dx = Math.abs(shiftedU - 0.5) * 2;
    const dy = Math.abs(gv - 0.5) * 2;
    const inHole = dx < 0.62 && dy < 0.62;
    const isBevel = !inHole && (dx < 0.82 && dy < 0.82);
    if (channel === 0) {
      if (inHole) return [18, 22, 26];
      if (isBevel) return [178, 185, 195];
      const n = fbm(u * 4, v * 4, seed, 2) * 24;
      return [clamp255(118 + n), clamp255(124 + n), clamp255(134 + n)];
    } else if (channel === 1) {
      const r = inHole ? 245 : (isBevel ? 65 : 95);
      return [r, r, r];
    } else {
      let nx = 0, ny = 0;
      if (isBevel) {
        nx = Math.sign(shiftedU - 0.5) * (0.82 - dx) * 2.5;
        ny = Math.sign(gv - 0.5) * (0.82 - dy) * 2.5;
      }
      return [clamp255(128 + nx * 128), clamp255(128 + ny * 128), 255];
    }
  }

  if (kind === 'hex_paneling') {
    const scale = 2.2;
    const hx = u * scale, hy = v * scale;
    const s3 = 1.7320508;
    const q = (s3 / 3 * hx - 1 / 3 * hy);
    const r = (2 / 3 * hy);
    let rx = Math.round(q), rz = Math.round(r), ry = Math.round(-q - r);
    const dq = Math.abs(rx - q), dr = Math.abs(rz - r), ds = Math.abs(ry - (-q - r));
    if (dq > dr && dq > ds) rx = -ry - rz;
    else if (dr > ds) rz = -rx - ry;
    else ry = -rx - rz;
    const cx = s3 * (rx + rz * 0.5);
    const cy = 1.5 * rz;
    const dist = Math.hypot(hx - cx, hy - cy);
    const hexRadius = 0.95;
    const seam = dist > hexRadius * 0.86;
    const centerDot = dist < hexRadius * 0.16;
    if (channel === 0) {
      if (seam) return [28, 34, 42];
      if (centerDot) return [185, 200, 215];
      const n = fbm(u * 3, v * 3, seed, 2) * 25;
      const c = 115 + (1 - dist / hexRadius) * 45 + n;
      return [clamp255(c * 0.86), clamp255(c * 0.92), clamp255(c)];
    } else if (channel === 1) {
      const rVal = seam ? 230 : (centerDot ? 55 : 85);
      return [rVal, rVal, rVal];
    } else {
      let nx = 0, ny = 0;
      if (seam) { nx = (hx - cx) * 0.85; ny = (hy - cy) * 0.85; }
      else { nx = (cx - hx) * 0.28; ny = (cy - hy) * 0.28; }
      return [clamp255(128 + nx * 128), clamp255(128 + ny * 128), 255];
    }
  }

  if (kind === 'hazard_stripes') {
    const stripeCoord = (u + v) * 3.5;
    const stripeFrac = ((stripeCoord % 1) + 1) % 1;
    const isYellow = stripeFrac < 0.5;
    const wear = fbm(u * 5.5, v * 5.5, seed + 89, 3);
    const chip = wear > 0.72;
    if (channel === 0) {
      if (chip) return [68, 72, 76];
      if (isYellow) {
        const yLum = (1 - (wear - 0.5) * 0.24);
        return [clamp255(238 * yLum), clamp255(182 * yLum), clamp255(24 * yLum)];
      }
      const bLum = (1 + (wear - 0.5) * 0.3);
      return [clamp255(28 * bLum), clamp255(32 * bLum), clamp255(36 * bLum)];
    } else if (channel === 1) {
      const r = chip ? 185 : (isYellow ? 100 : 130);
      return [r, r, r];
    } else {
      const edgeDist = Math.abs(stripeFrac - 0.5);
      let nx = 0, ny = 0;
      if (edgeDist < 0.05) {
        const sign = stripeFrac < 0.5 ? 1 : -1;
        nx = sign * 0.4; ny = sign * 0.4;
      }
      if (chip) {
        nx += (noise(u * 16, v * 16, seed) - 0.5) * 0.3;
        ny += (noise(u * 16, v * 16, seed + 1) - 0.5) * 0.3;
      }
      return [clamp255(128 + nx * 128), clamp255(128 + ny * 128), 255];
    }
  }

  if (kind === 'weathered_concrete') {
    const base = fbm(u, v, seed, 4);
    const fine = fbm(u * 4.2, v * 4.2, seed + 17, 3);
    const grit = noise(u * 24, v * 24, seed + 101);
    const fissure = Math.abs(noise(u * 3.5, v * 3.5, seed + 307) - 0.5);
    const isCrack = fissure < 0.024;
    if (channel === 0) {
      if (isCrack) return [44, 42, 40];
      const lum = 0.55 + base * 0.3 + fine * 0.15 + (grit - 0.5) * 0.1;
      return [clamp255(lum * 255 * 0.96), clamp255(lum * 255 * 0.94), clamp255(lum * 255 * 0.90)];
    } else if (channel === 1) {
      const r = isCrack ? 245 : clamp255((0.68 + base * 0.28 + (grit - 0.5) * 0.12) * 255);
      return [r, r, r];
    } else {
      const dx = (fbm(u + edge, v, seed, 4) - base) * 5;
      const dy = (fbm(u, v + edge, seed, 4) - base) * 5;
      const cnx = isCrack ? (fissure - 0.012) * 20 : 0;
      return [clamp255(128 - (dx + cnx) * 128), clamp255(128 - (dy + cnx) * 128), 255];
    }
  }

  if (kind === 'holographic_grid') {
    const gu = Math.abs(((u * 4) % 1 + 1) % 1 - 0.5) * 2;
    const gv = Math.abs(((v * 4) % 1 + 1) % 1 - 0.5) * 2;
    const isLine = gu > 0.88 || gv > 0.88;
    const isDot = gu > 0.88 && gv > 0.88;
    const scan = Math.sin(v * 36) * 0.08 + 0.92;
    if (channel === 0) {
      if (isDot) return [195, 255, 248];
      if (isLine) return [48, 235, 215];
      const bg = 24 * scan;
      return [clamp255(bg * 0.7), clamp255(bg * 1.1), clamp255(bg * 1.5)];
    } else if (channel === 1) {
      const r = isDot ? 20 : (isLine ? 38 : 75);
      return [r, r, r];
    } else {
      let nx = 0, ny = 0;
      if (isLine) { nx = (gu - 0.88) * 3.8; ny = (gv - 0.88) * 3.8; }
      return [clamp255(128 + nx * 128), clamp255(128 + ny * 128), 255];
    }
  }

  return null;
}

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
 const patternType=layer.type||(generatePatternPixel(kind,0,0,seed,0,1/size)?kind:null);
 const make=channel=>{
  const canvas=document.createElement('canvas');
  canvas.width=size;canvas.height=size;
  const ctx=canvas.getContext('2d');
  if(!ctx?.createImageData||!ctx.putImageData)return null;
  const image=ctx.createImageData(size,size),data=image.data,edge=1/size;
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
   const i=(y*size+x)*4,u=(x/size)*layer.scale,v=(y/size)*layer.scale;
   if(patternType){
    const pix=generatePatternPixel(patternType,u,v,seed,channel,edge);
    if(pix){
     data[i]=pix[0];data[i+1]=pix[1];data[i+2]=pix[2];data[i+3]=255;
     continue;
    }
   }
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

if (typeof globalThis !== 'undefined') {
  globalThis.__tokenarena_textures = surfaceTextures;
}

