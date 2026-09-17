import * as T from 'three';
import {mothSurfaceOverride,mothNormalOverride,mothMaterialLut,mothSky,mothEffect} from './moth-assets.mjs';

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
// Periodic variants. Surface maps are sampled with RepeatWrapping, so a field
// whose integer lattice wraps at the tile edge tiles without a visible seam.
// `px`/`py` are the lattice periods (cells per tile) along each axis; fbm
// octaves double both, so the period stays integral.
const pnoise=(x,y,px,py,seed)=>{
 const xi=Math.floor(x),yi=Math.floor(y),xf=x-xi,yf=y-yi;
 const x0=((xi%px)+px)%px,x1=((xi+1)%px+px)%px,y0=((yi%py)+py)%py,y1=((yi+1)%py+py)%py;
 const a=hash(x0,y0,seed),b=hash(x1,y0,seed),c=hash(x0,y1,seed),d=hash(x1,y1,seed);
 const u=smooth(xf),v=smooth(yf);
 return (a*(1-u)+b*u)*(1-v)+(c*(1-u)+d*u)*v;
};
const pfbm=(x,y,px,py,seed,octaves=4)=>{
 let total=0,amp=.5,freq=1,periodX=px,periodY=py,norm=0;
 for(let i=0;i<octaves;i++){total+=pnoise(x*freq,y*freq,periodX,periodY,seed+i*131)*amp;norm+=amp;amp*=.5;freq*=2;periodX*=2;periodY*=2;}
 return total/norm;
};

const LAYERS={
 // `stain` darkens water/dirt patches, `streak` adds vertical wash marks,
 // `dust` lifts dry deposits and `temperature` drifts the channels warm/cool
 // across the tile. All are driven by the same field family as the height, so
 // weathering reads as part of the surface instead of a decal layer.
 concrete:{scale:5,contrast:.24,rough:[.6,.95],hue:[1,1,1],grain:.5,stain:.2,streak:.28,temperature:.04},
 tile:{scale:7,contrast:.3,rough:[.45,.8],hue:[1,1,1],grain:.4,stain:.14,streak:.14,temperature:.035},
 metal:{scale:11,contrast:.16,rough:[.25,.55],hue:[.98,1,1],grain:.7,stain:.08,streak:.1,temperature:.025},
 sand:{scale:9,contrast:.2,rough:[.82,1],hue:[1.05,1,.92],grain:.3,stain:.06,dust:.12,temperature:.07},
 grass:{scale:13,contrast:.28,rough:[.72,1],hue:[.95,1.05,.86],grain:.5,stain:.16,temperature:.1},
 rock:{scale:6,contrast:.34,rough:[.78,1],hue:[1.03,.99,.94],grain:.6,stain:.24,streak:.12,temperature:.05},
 ice:{scale:8,contrast:.2,rough:[.15,.4],hue:[.96,1,1.06],grain:.4,streak:.26,stain:.05,temperature:.05},
 carbon_fiber:{scale:8,contrast:.3,rough:[.18,.4],hue:[.2,.22,.25],grain:.8,type:'carbon_fiber'},
 metal_grating:{scale:6,contrast:.45,rough:[.28,.88],hue:[.55,.58,.62],grain:.9,type:'metal_grating'},
 hex_paneling:{scale:5,contrast:.35,rough:[.26,.75],hue:[.6,.65,.72],grain:.75,type:'hex_paneling'},
 hazard_stripes:{scale:6,contrast:.5,rough:[.35,.7],hue:[.9,.75,.15],grain:.6,type:'hazard_stripes'},
 weathered_concrete:{scale:5.5,contrast:.38,rough:[.65,.98],hue:[.88,.86,.82],grain:.8,type:'weathered_concrete'},
 holographic_grid:{scale:4,contrast:.6,rough:[.12,.35],hue:[.2,.95,.88],grain:.5,type:'holographic_grid'},
 diamond_plate:{scale:6,contrast:.42,rough:[.22,.75],hue:[.95,1,1.05],grain:.85,type:'diamond_plate'},
 riveted_armor:{scale:6,contrast:.38,rough:[.25,.85],hue:[.72,.76,.82],grain:.8,type:'riveted_armor'},
 circuit_board:{scale:5,contrast:.55,rough:[.18,.72],hue:[.18,.85,.55],grain:.6,type:'circuit_board'},
 brushed_metal:{scale:8,contrast:.25,rough:[.22,.48],hue:[.96,1,1.02],grain:.9,type:'brushed_metal'},
 corrugated_metal:{scale:5,contrast:.48,rough:[.28,.86],hue:[.88,.92,.96],grain:.75,type:'corrugated_metal'},
 alien_chitin:{scale:6,contrast:.52,rough:[.14,.62],hue:[.35,.82,.75],grain:.7,type:'alien_chitin'},
 rough_stucco:{scale:7,contrast:.4,rough:[.72,.98],hue:[.98,.95,.9],grain:.95,type:'rough_stucco'},
 industrial_mesh:{scale:6.5,contrast:.6,rough:[.26,.92],hue:[.82,.86,.9],grain:.9,type:'industrial_mesh'},
};
// Aliases for intuitive API usage
LAYERS.carbon = LAYERS.carbonFiber = LAYERS.carbon_fiber;
LAYERS.grating = LAYERS.metalGrating = LAYERS.industrial_grating = LAYERS.metal_grating;
LAYERS.hex = LAYERS.hexPaneling = LAYERS.hex_panel = LAYERS.hex_paneling;
LAYERS.hazard = LAYERS.hazardStripes = LAYERS.hazard_stripes;
LAYERS.weatheredConcrete = LAYERS.weathered_concrete;
LAYERS.hologrid = LAYERS.holographicGrid = LAYERS.holographic_grid;
LAYERS.diamond = LAYERS.diamondPlate = LAYERS.diamond_tread = LAYERS.tread_metal = LAYERS.diamond_plate;
LAYERS.riveted = LAYERS.rivetedArmor = LAYERS.bolted_plates = LAYERS.armor_plates = LAYERS.rivet = LAYERS.riveted_armor;
LAYERS.circuit = LAYERS.circuitBoard = LAYERS.etched_circuit = LAYERS.cyber_grid = LAYERS.pcb = LAYERS.circuit_board;
LAYERS.brushed = LAYERS.brushedMetal = LAYERS.brushed_steel = LAYERS.anisotropic_metal = LAYERS.brushed_metal;
LAYERS.corrugated = LAYERS.corrugatedMetal = LAYERS.corrugated_siding = LAYERS.corrugated_iron = LAYERS.corrugated_metal;
LAYERS.chitin = LAYERS.alienChitin = LAYERS.chitin_scales = LAYERS.bio_scale = LAYERS.carapace = LAYERS.alien_chitin;
LAYERS.stucco = LAYERS.roughStucco = LAYERS.stucco_plaster = LAYERS.plaster = LAYERS.coarse_masonry = LAYERS.rough_stucco;
LAYERS.mesh = LAYERS.industrialMesh = LAYERS.wire_mesh = LAYERS.expanded_metal = LAYERS.industrial_mesh;

export const TEXTURE_KINDS = Object.freeze([
  'concrete', 'tile', 'metal', 'sand', 'grass', 'rock', 'ice',
  'carbon_fiber', 'metal_grating', 'hex_paneling', 'hazard_stripes', 'weathered_concrete', 'holographic_grid',
  'diamond_plate', 'riveted_armor', 'circuit_board', 'brushed_metal', 'corrugated_metal', 'alien_chitin', 'rough_stucco', 'industrial_mesh',
]);

const ALIAS_MAP = {
  carbon: 'carbon_fiber',
  carbonFiber: 'carbon_fiber',
  carbon_fiber: 'carbon_fiber',
  grating: 'metal_grating',
  metalGrating: 'metal_grating',
  industrial_grating: 'metal_grating',
  metal_grating: 'metal_grating',
  hex: 'hex_paneling',
  hexPaneling: 'hex_paneling',
  hex_panel: 'hex_paneling',
  hex_paneling: 'hex_paneling',
  hazard: 'hazard_stripes',
  hazardStripes: 'hazard_stripes',
  hazard_stripes: 'hazard_stripes',
  weatheredConcrete: 'weathered_concrete',
  weathered_concrete: 'weathered_concrete',
  hologrid: 'holographic_grid',
  holographicGrid: 'holographic_grid',
  holographic_grid: 'holographic_grid',
  diamond: 'diamond_plate',
  diamondPlate: 'diamond_plate',
  diamond_tread: 'diamond_plate',
  tread_metal: 'diamond_plate',
  diamond_plate: 'diamond_plate',
  riveted: 'riveted_armor',
  rivetedArmor: 'riveted_armor',
  bolted_plates: 'riveted_armor',
  armor_plates: 'riveted_armor',
  rivet: 'riveted_armor',
  riveted_armor: 'riveted_armor',
  circuit: 'circuit_board',
  circuitBoard: 'circuit_board',
  etched_circuit: 'circuit_board',
  cyber_grid: 'circuit_board',
  pcb: 'circuit_board',
  circuit_board: 'circuit_board',
  brushed: 'brushed_metal',
  brushedMetal: 'brushed_metal',
  brushed_steel: 'brushed_metal',
  anisotropic_metal: 'brushed_metal',
  brushed_metal: 'brushed_metal',
  corrugated: 'corrugated_metal',
  corrugatedMetal: 'corrugated_metal',
  corrugated_siding: 'corrugated_metal',
  corrugated_iron: 'corrugated_metal',
  corrugated_metal: 'corrugated_metal',
  chitin: 'alien_chitin',
  alienChitin: 'alien_chitin',
  chitin_scales: 'alien_chitin',
  bio_scale: 'alien_chitin',
  carapace: 'alien_chitin',
  alien_chitin: 'alien_chitin',
  stucco: 'rough_stucco',
  roughStucco: 'rough_stucco',
  stucco_plaster: 'rough_stucco',
  plaster: 'rough_stucco',
  coarse_masonry: 'rough_stucco',
  rough_stucco: 'rough_stucco',
  mesh: 'industrial_mesh',
  industrialMesh: 'industrial_mesh',
  wire_mesh: 'industrial_mesh',
  expanded_metal: 'industrial_mesh',
  industrial_mesh: 'industrial_mesh',
};

export function canonicalTextureKind(kind) {
  if (!kind || typeof kind !== 'string') return 'concrete';
  if (TEXTURE_KINDS.includes(kind)) return kind;
  if (ALIAS_MAP[kind]) return ALIAS_MAP[kind];
  if (LAYERS[kind]?.type) return LAYERS[kind].type;
  return 'concrete';
}

const cache=new Map();

// One coherent multi-scale height/wear field per surface tile. Albedo,
// roughness and the tangent-space normal are all derived from it, so a pit in
// the albedo has matching relief and roughness rather than three unrelated
// noise stacks. The field is periodic at the tile edge (see pnoise) and costs
// one bounded pass per surface kind, reused by every requested channel.
const SURFACE_RELIEF_GAIN=2.1;   // macro/meso contrast on the albedo
const SURFACE_MICRO_GAIN=.12;    // per-pixel tooth on top of the smooth field
const SURFACE_NORMAL_GAIN=15;    // one-texel slope -> tangent deflection

function buildSurfaceField(layer,seed,size){
 const count=size*size,height=new Float32Array(count),macro=new Float32Array(count),wear=new Float32Array(count),streak=new Float32Array(count);
 const period=Math.max(2,Math.round(layer.scale));
 const macroPeriod=Math.max(2,Math.round(period*.24));
 const warpPeriod=Math.max(2,Math.round(period*.4));
 // Cap the fine grain at two texels per cell so it stays a material tooth
 // instead of aliasing into white noise at 96 px tiles.
 const toothPeriod=Math.max(2,Math.min(period*6,Math.floor(size/2)));
 const wearPeriod=Math.max(2,Math.round(period*.5));
 const streakPeriodX=Math.max(3,period*2),streakPeriodY=Math.max(2,Math.round(period*.34));
 for(let y=0;y<size;y++){
  const ty=(y+.5)/size;
  for(let x=0;x<size;x++){
   const tx=(x+.5)/size,index=y*size+x;
   const macroValue=pfbm(tx*macroPeriod,ty*macroPeriod,macroPeriod,macroPeriod,seed+211,3);
   // Domain warp: midsize features bend around the broad weathering instead of
   // marching across the tile in straight noise rows.
   const warpX=(pfbm(tx*warpPeriod+5.2,ty*warpPeriod+1.7,warpPeriod,warpPeriod,seed+53,2)-.5)*.7;
   const warpY=(pfbm(tx*warpPeriod+9.1,ty*warpPeriod-3.4,warpPeriod,warpPeriod,seed+419,2)-.5)*.7;
   const base=pfbm(tx*period+warpX,ty*period+warpY,period,period,seed,4);
   const tooth=pfbm(tx*toothPeriod+warpX*.4,ty*toothPeriod+warpY*.4,toothPeriod,toothPeriod,seed+17,3);
   height[index]=base*.5+tooth*.24+macroValue*.18;
   macro[index]=macroValue;
   // Exposure follows the relief: raised faces take traffic and weather while
   // hollows shelter dirt, so wear nudges roughness in the same direction as
   // the albedo relief instead of reading as an unrelated stain layer.
   wear[index]=height[index]*.6+pfbm(tx*wearPeriod+2.3,ty*wearPeriod-1.9,wearPeriod,wearPeriod,seed+601,3)*.4;
   streak[index]=pfbm(tx*streakPeriodX+1.1,ty*streakPeriodY+4.7,streakPeriodX,streakPeriodY,seed+907,3);
  }
 }
 return {height,macro,wear,streak};
}

function generatePatternPixel(kind, u, v, seed, channel, edge, layerScale = 1) {
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
    // One height field for the tile: broad pour variation, fine aggregate and a
    // thin fissure network carved out of it. Albedo stains and vertical wash
    // marks ride the same weathering so the surface reads as one aged material.
    const wcHeight = (pu, pv) => {
      const base = fbm(pu, pv, seed, 4);
      const fine = fbm(pu * 4.2, pv * 4.2, seed + 17, 3);
      const grit = noise(pu * 24, pv * 24, seed + 101);
      const fissure = Math.abs(noise(pu * 3.5, pv * 3.5, seed + 307) - 0.5);
      const crack = fissure < 0.024 ? 1 - fissure / 0.024 : 0;
      return { base, fine, grit, crack, h: base * 0.52 + fine * 0.28 + grit * 0.14 - crack * 0.42 };
    };
    const sample = wcHeight(u, v);
    if (channel === 0) {
      const damp = fbm(u * 0.4 + 2.1, v * 0.4 - 1.3, seed + 601, 3);
      const stain = Math.max(0, damp - 0.52) * 1.7;
      const streak = Math.max(0, fbm(u * 7.4 + 1.1, v * 0.5 + 4.7, seed + 907, 3) - 0.58) * 2.2;
      if (sample.crack > 0.55) return [52, 49, 46];
      const lum = 0.52 + sample.h * 0.46 - stain * 0.18 - streak * 0.2;
      return [clamp255(lum * 255 * 0.97), clamp255(lum * 255 * 0.95), clamp255(lum * 255 * 0.91)];
    } else if (channel === 1) {
      const damp = Math.max(0, fbm(u * 0.4 + 2.1, v * 0.4 - 1.3, seed + 601, 3) - 0.52) * 1.2;
      const r = clamp255((0.6 + sample.h * 0.3 + sample.crack * 0.2 + damp * 0.12) * 255);
      return [r, r, r];
    } else {
      const dx = (wcHeight(u + edge, v).h - sample.h) * layerScale * 5;
      const dy = (wcHeight(u, v + edge).h - sample.h) * layerScale * 5;
      return [clamp255(128 - dx * 128), clamp255(128 - dy * 128), 255];
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

  if (kind === 'diamond_plate') {
    const cu = u * 2, cv = v * 2;
    const bx = Math.floor(cu), by = Math.floor(cv);
    const fx = cu - bx, fy = cv - by;
    const isAlt = ((bx + by) & 1) === 0;
    const cx = fx - 0.5, cy = fy - 0.5;
    const rx = isAlt ? (cx + cy) * 0.7071 : (cx - cy) * 0.7071;
    const ry = isAlt ? (-cx + cy) * 0.7071 : (cx + cy) * 0.7071;
    const edx = rx / 0.14, edy = ry / 0.36;
    const dSq = edx * edx + edy * edy;
    const inTread = dSq < 1.0;
    const height = inTread ? Math.sqrt(Math.max(0, 1.0 - dSq)) : 0;
    const wear = (noise(u * 8, v * 8, seed) - 0.5) * 0.15;
    if (channel === 0) {
      if (inTread) {
        const lum = 0.58 + height * 0.28 + wear;
        return [clamp255(lum * 255 * 0.94), clamp255(lum * 255 * 0.98), clamp255(lum * 255 * 1.04)];
      }
      const rim = dSq < 1.4 ? 0.32 : 0.44;
      const baseLum = rim + wear * 0.5;
      return [clamp255(baseLum * 255 * 0.88), clamp255(baseLum * 255 * 0.92), clamp255(baseLum * 255 * 0.98)];
    } else if (channel === 1) {
      const r = inTread ? (0.2 + (1 - height) * 0.22) * 255 : (dSq < 1.4 ? 200 : 130);
      return [clamp255(r), clamp255(r), clamp255(r)];
    } else {
      let nx = 0, ny = 0;
      if (inTread) {
        const gradX = isAlt ? (edx * 0.7071 - edy * 0.7071) : (edx * 0.7071 + edy * 0.7071);
        const gradY = isAlt ? (edx * 0.7071 + edy * 0.7071) : (-edx * 0.7071 + edy * 0.7071);
        nx = -gradX * 0.55;
        ny = -gradY * 0.55;
      }
      return [clamp255(128 + nx * 128), clamp255(128 + ny * 128), 255];
    }
  }

  if (kind === 'riveted_armor') {
    const pu = ((u * 1.5) % 1 + 1) % 1;
    const pv = ((v * 1.5) % 1 + 1) % 1;
    const seamDistX = Math.min(pu, 1 - pu);
    const seamDistY = Math.min(pv, 1 - pv);
    const edgeDist = Math.min(seamDistX, seamDistY);
    const inSeam = edgeDist < 0.04;
    const isBevel = !inSeam && edgeDist < 0.12;
    const rx = pu < 0.5 ? pu - 0.2 : pu - 0.8;
    const ry = pv < 0.5 ? pv - 0.2 : pv - 0.8;
    const rDist = Math.hypot(rx, ry);
    const inRivet = rDist < 0.075;
    const rivetHeight = inRivet ? Math.sqrt(Math.max(0, 0.075 * 0.075 - rDist * rDist)) / 0.075 : 0;
    const wear = fbm(u * 3, v * 3, seed, 2) * 0.16;
    if (channel === 0) {
      if (inSeam) return [24, 28, 34];
      if (inRivet) {
        const rLum = 0.65 + rivetHeight * 0.25;
        return [clamp255(rLum * 255 * 0.95), clamp255(rLum * 255 * 0.98), clamp255(rLum * 255 * 1.05)];
      }
      if (isBevel) {
        const bLum = 0.38 + wear;
        return [clamp255(bLum * 255), clamp255(bLum * 255 * 1.02), clamp255(bLum * 255 * 1.06)];
      }
      const pLum = 0.46 + wear;
      return [clamp255(pLum * 255 * 0.88), clamp255(pLum * 255 * 0.92), clamp255(pLum * 255 * 0.98)];
    } else if (channel === 1) {
      const r = inSeam ? 235 : (inRivet ? 60 : (isBevel ? 160 : 95));
      return [r, r, r];
    } else {
      let nx = 0, ny = 0;
      if (inRivet) {
        nx = (rx / 0.075) * 0.75;
        ny = (ry / 0.075) * 0.75;
      } else if (isBevel) {
        if (seamDistX < seamDistY) nx = (pu < 0.5 ? -1 : 1) * (0.12 - seamDistX) * 5.0;
        else ny = (pv < 0.5 ? -1 : 1) * (0.12 - seamDistY) * 5.0;
      }
      return [clamp255(128 + nx * 128), clamp255(128 + ny * 128), 255];
    }
  }

  if (kind === 'circuit_board') {
    const cu = ((u * 3) % 1 + 1) % 1;
    const cv = ((v * 3) % 1 + 1) % 1;
    const gridX = Math.abs(cu - 0.5);
    const gridY = Math.abs(cv - 0.5);
    const centerDist = Math.hypot(cu - 0.5, cv - 0.5);
    const cornerDist = Math.min(
      Math.hypot(cu, cv), Math.hypot(cu - 1, cv),
      Math.hypot(cu, cv - 1), Math.hypot(cu - 1, cv - 1)
    );
    const isPad = centerDist < 0.15 || cornerDist < 0.15;
    const isVia = centerDist < 0.06 || cornerDist < 0.06;
    const isTraceX = gridY < 0.045 && (cu > 0.15 && cu < 0.85);
    const isTraceY = gridX < 0.045 && (cv > 0.15 && cv < 0.85);
    const diagDist = Math.abs(cu - cv);
    const isTraceD = diagDist < 0.04 && cu > 0.18 && cu < 0.82;
    const isCopper = (isPad || isTraceX || isTraceY || isTraceD) && !isVia;

    if (channel === 0) {
      if (isVia) return [12, 14, 18];
      if (isCopper) {
        const padAccent = isPad ? 1.15 : 1.0;
        return [clamp255(225 * padAccent), clamp255(182 * padAccent), clamp255(72 * padAccent)];
      }
      const grain = noise(u * 12, v * 12, seed) * 18;
      return [clamp255(16 + grain * 0.6), clamp255(38 + grain), clamp255(32 + grain * 0.8)];
    } else if (channel === 1) {
      const r = isVia ? 240 : (isCopper ? (isPad ? 42 : 55) : 175);
      return [r, r, r];
    } else {
      let nx = 0, ny = 0;
      if (isVia) {
        const isCenter = centerDist < 0.1;
        const dx = isCenter ? (cu - 0.5) : (cu < 0.5 ? cu : cu - 1);
        const dy = isCenter ? (cv - 0.5) : (cv < 0.5 ? cv : cv - 1);
        nx = (dx / 0.06) * 0.8;
        ny = (dy / 0.06) * 0.8;
      } else if (isPad) {
        const d = centerDist < 0.2 ? centerDist : cornerDist;
        if (d > 0.11) {
          const dx = centerDist < 0.2 ? (cu - 0.5) : (cu < 0.5 ? cu : cu - 1);
          const dy = centerDist < 0.2 ? (cv - 0.5) : (cv < 0.5 ? cv : cv - 1);
          nx = (dx / 0.15) * 0.6;
          ny = (dy / 0.15) * 0.6;
        }
      } else if (isTraceX) {
        ny = Math.sign(cv - 0.5) * 0.5;
      } else if (isTraceY) {
        nx = Math.sign(cu - 0.5) * 0.5;
      } else if (isTraceD) {
        const sign = (cu - cv) > 0 ? 1 : -1;
        nx = sign * 0.38;
        ny = -sign * 0.38;
      }
      return [clamp255(128 + nx * 128), clamp255(128 + ny * 128), 255];
    }
  }

  if (kind === 'brushed_metal') {
    const streak = noise(u * 1.5, v * 64, seed) * 0.65 + noise(u * 6, v * 160, seed + 41) * 0.35;
    const streakGrad = (noise(u * 1.5, (v + edge) * 64, seed) - noise(u * 1.5, v * 64, seed)) * 18.0;
    const micro = (hash(Math.floor(u * 128), Math.floor(v * 128), seed) - 0.5) * 0.08;
    if (channel === 0) {
      const lum = 0.68 + (streak - 0.5) * 0.24 + micro;
      return [clamp255(lum * 255 * 0.96), clamp255(lum * 255 * 0.99), clamp255(lum * 255 * 1.04)];
    } else if (channel === 1) {
      const r = clamp255((0.26 + streak * 0.22) * 255);
      return [r, r, r];
    } else {
      const ny = Math.max(-0.8, Math.min(0.8, streakGrad * 0.6));
      const nx = micro * 0.5;
      return [clamp255(128 + nx * 128), clamp255(128 + ny * 128), 255];
    }
  }

  if (kind === 'corrugated_metal') {
    const waveU = ((u * 3) % 1 + 1) % 1;
    const sinWave = Math.sin(waveU * Math.PI * 2);
    const cosWave = Math.cos(waveU * Math.PI * 2);
    const isTrough = sinWave < -0.65;
    // Rain runs into the troughs and sits there, so rust blooms there while the
    // exposed crests polish smooth: the two extremes describe different weather.
    const crest = Math.max(0, sinWave);
    const rust = isTrough ? fbm(u * 4, v * 4, seed + 109, 3) : 0;
    const isRust = rust > 0.45;
    if (channel === 0) {
      if (isRust) {
        return [clamp255(145 * (0.8 + rust * 0.4)), clamp255(68 * (0.8 + rust * 0.4)), 32];
      }
      const ridgeLum = 0.55 + sinWave * 0.25 + crest * 0.07;
      return [clamp255(ridgeLum * 255 * 0.92), clamp255(ridgeLum * 255 * 0.96), clamp255(ridgeLum * 255)];
    } else if (channel === 1) {
      const r = isRust ? 220 : clamp255((0.34 - sinWave * 0.13 - crest * 0.08) * 255);
      return [r, r, r];
    } else {
      const nx = cosWave * 0.72;
      const ny = isRust ? (noise(u * 16, v * 16, seed) - 0.5) * 0.35 : 0;
      return [clamp255(128 + nx * 128), clamp255(128 + ny * 128), 255];
    }
  }

  if (kind === 'alien_chitin') {
    const su = ((u * 2.5) % 1 + 1) % 1;
    const sv = ((v * 2.5) % 1 + 1) % 1;
    const row = Math.floor(((v * 2.5) % 2 + 2) % 2);
    const shiftU = (su + (row === 1 ? 0.5 : 0)) % 1;
    const cdist = Math.hypot(shiftU - 0.5, (sv - 0.35) * 1.2);
    const isSeam = sv > 0.88 || cdist > 0.52;
    const striation = Math.sin(Math.atan2(sv - 0.35, shiftU - 0.5) * 12) * 0.08;
    const slope = (1.0 - Math.min(1.0, cdist / 0.52));
    if (channel === 0) {
      if (isSeam) return [18, 22, 28];
      const bioLum = 0.28 + slope * 0.35 + striation;
      return [clamp255(bioLum * 180), clamp255(bioLum * 245), clamp255(bioLum * 220)];
    } else if (channel === 1) {
      const r = isSeam ? 190 : clamp255((0.16 + (1 - slope) * 0.25) * 255);
      return [r, r, r];
    } else {
      let nx = 0, ny = 0;
      if (isSeam) {
        ny = -0.75;
      } else {
        nx = (shiftU - 0.5) * 0.9 + striation * 0.3;
        ny = (sv - 0.35) * 0.9;
      }
      return [clamp255(128 + nx * 128), clamp255(128 + ny * 128), 255];
    }
  }

  if (kind === 'rough_stucco') {
    // Pebble relief plus broad trowel patches. The patch term breaks up the
    // uniform pebble field so large walls get regional tone/roughness drift.
    const stuccoHeight = (pu, pv) => {
      const pebble1 = fbm(pu * 2.5, pv * 2.5, seed, 4);
      const pebble2 = noise(pu * 14, pv * 14, seed + 67);
      const pebble3 = noise(pu * 32, pv * 32, seed + 149);
      const patch = fbm(pu * 0.3 + 3.7, pv * 0.3 - 2.9, seed + 311, 3);
      return { pebble1, pebble2, pebble3, patch, h: (pebble1 * 0.6 + pebble2 * 0.28 + pebble3 * 0.12) * 0.82 + patch * 0.18 };
    };
    const sample = stuccoHeight(u, v);
    const isPit = sample.h < 0.34;
    if (channel === 0) {
      if (isPit) return [74, 69, 62];
      const temp = (sample.patch - 0.5) * 0.12;
      const lum = 0.54 + (sample.h - 0.5) * 0.46;
      return [clamp255(lum * 240 * (1 + temp)), clamp255(lum * 228 * (1 + temp * 0.2)), clamp255(lum * 210 * (1 - temp * 1.4))];
    } else if (channel === 1) {
      const r = isPit ? 250 : clamp255((0.72 + (1 - sample.h) * 0.24) * 255);
      return [r, r, r];
    } else {
      const gain = layerScale * 3;
      const dx = (stuccoHeight(u + edge, v).h - sample.h) * gain;
      const dy = (stuccoHeight(u, v + edge).h - sample.h) * gain;
      return [clamp255(128 - dx * 128), clamp255(128 - dy * 128), 255];
    }
  }

  if (kind === 'industrial_mesh') {
    const mu = ((u * 4) % 1 + 1) % 1;
    const mv = ((v * 4) % 1 + 1) % 1;
    const wireU = Math.abs(mu - 0.5);
    const wireV = Math.abs(mv - 0.5);
    const onWireX = wireV > 0.36;
    const onWireY = wireU > 0.36;
    const inHole = !onWireX && !onWireY;
    const isWeaveOver = (Math.floor(u * 4) + Math.floor(v * 4)) % 2 === 0;

    if (channel === 0) {
      if (inHole) return [14, 16, 20];
      const highlight = (onWireX && isWeaveOver) || (onWireY && !isWeaveOver) ? 1.15 : 0.95;
      const lum = 0.58 * highlight;
      return [clamp255(lum * 255 * 0.92), clamp255(lum * 255 * 0.96), clamp255(lum * 255 * 1.02)];
    } else if (channel === 1) {
      const r = inHole ? 245 : 75;
      return [r, r, r];
    } else {
      let nx = 0, ny = 0;
      if (!inHole) {
        if (onWireX) ny = Math.sign(mv - 0.5) * (wireV - 0.36) * 6.5;
        if (onWireY) nx = Math.sign(mu - 0.5) * (wireU - 0.36) * 6.5;
      }
      return [clamp255(128 + nx * 128), clamp255(128 + ny * 128), 255];
    }
  }

  return null;
}

export function clearSurfaceTextures(){for(const textures of cache.values())for(const texture of Object.values(textures))texture?.dispose?.();cache.clear();try{macroCache?.dispose?.();}catch{}macroCache=null;for(const sky of skyCache.values())try{sky.texture?.dispose?.();}catch{}skyCache.clear();for(const effect of effectCache.values())for(const texture of effect.textures)try{texture?.dispose?.();}catch{}effectCache.clear();for(const texture of lutCache.values())try{texture?.dispose?.();}catch{}lutCache.clear();clearWetSheenTextures();}
// Explicit PBR material presets for the surfaces that recur across the scene.
// Callers spread these onto a MeshStandardMaterial so painted armour, exposed
// steel, rubber, stone/concrete and energy read as physically distinct instead
// of sharing one generic metallic value.
export const MATERIAL_PRESETS=Object.freeze({
 // Paint is a dielectric layer over metal: very low metalness, moderate
 // roughness. Exposed steel is the opposite: near-bare metal with a tight
 // roughness to catch a sharp highlight. Rubber and stone are both dielectric
 // but rubber stays glossier than unpolished stone. Energy is a dielectric
 // emissive core; entanglement is the quantum LUT's sharp metallic film.
 paintedArmor:Object.freeze({metalness:.08,roughness:.58}),
 exposedSteel:Object.freeze({metalness:.95,roughness:.3}),
 rubber:Object.freeze({metalness:.03,roughness:.94}),
 stone:Object.freeze({metalness:.01,roughness:.96}),
 energy:Object.freeze({metalness:.08,roughness:.32,emissiveIntensity:1.3}),
 // Backed by the Moth entanglement-shader LUTs (mothMaterialLutTexture): a
 // sharp, high-metalness surface for the quantum arena's iridescent panels.
 entanglement:Object.freeze({metalness:.68,roughness:.1,emissiveIntensity:.8}),
});
export function materialPreset(name){return MATERIAL_PRESETS[name]||MATERIAL_PRESETS.paintedArmor;}

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

export function surfaceTextures(kind='concrete',{size=96,seed=1,repeat=[1,1],normal=true,roughness=true,bump=false}={}){
 const canonical=canonicalTextureKind(kind);
 const key=`${canonical}|${size}|${seed}|${repeat[0]},${repeat[1]}|${normal?1:0}|${roughness?1:0}|${bump?1:0}`;
 const cached=cache.get(key);
 if(cached)return cached;
 if(typeof document==='undefined'||!document.createElement)return null;
 const layer=LAYERS[canonical]||LAYERS.concrete;
 const patternType=layer.type||(generatePatternPixel(canonical,0,0,seed,0,1/size)?canonical:null);
 const make=channel=>{
  const canvas=document.createElement('canvas');
  canvas.width=size;canvas.height=size;
  const ctx=canvas.getContext('2d');
  if(!ctx?.createImageData||!ctx.putImageData)return null;
  const image=ctx.createImageData(size,size),data=image.data,edge=1/size;
  if(patternType){
   for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const i=(y*size+x)*4,u=(x/size)*layer.scale,v=(y/size)*layer.scale,pix=generatePatternPixel(patternType,u,v,seed,channel,edge,layer.scale);
    if(pix){data[i]=pix[0];data[i+1]=pix[1];data[i+2]=pix[2];}
    else data[i]=data[i+1]=data[i+2]=128;
    data[i+3]=255;
   }
  }else{
   const field=sharedField??=buildSurfaceField(layer,seed,size);
   const {height,macro,wear,streak}=field;
   const stain=layer.stain||0,wash=layer.streak||0,dust=layer.dust||0,temperature=layer.temperature||0;
   for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const i=(y*size+x)*4,index=y*size+x,h=height[index];
    if(channel===0){
     // Albedo relief rides the same field as roughness and the normal. The only
     // extra term is a per-pixel grain, which reads as material tooth rather
     // than another noise scale.
     const micro=hash(x,y,seed+1009)-.5;
     let lum=1+layer.contrast*((h-.5)*SURFACE_RELIEF_GAIN+micro*SURFACE_MICRO_GAIN);
     if(stain)lum-=stain*Math.max(0,wear[index]-.5)*1.5;
     if(dust)lum+=dust*Math.max(0,.5-wear[index])*.5;
     if(wash)lum-=wash*Math.max(0,streak[index]-.58)*.55;
     const temp=(macro[index]-.5)*temperature*2;
     data[i]=clamp255(lum*255*layer.hue[0]*(1+temp));
     data[i+1]=clamp255(lum*255*layer.hue[1]*(1+temp*.25));
     data[i+2]=clamp255(lum*255*layer.hue[2]*(1-temp*1.25));
    }else if(channel===1){
     const rough=layer.rough[0]+(layer.rough[1]-layer.rough[0])*(h*.85+wear[index]*.15);
     const r=clamp255(rough*255);
     data[i]=data[i+1]=data[i+2]=r;
    }else{
     // One-texel forward difference of the same field, wrapped for seamlessness.
     const hx=height[y*size+((x+1)%size)],hy=height[((y+1)%size)*size+x];
     const dx=(hx-h)*layer.grain*SURFACE_NORMAL_GAIN,dy=(hy-h)*layer.grain*SURFACE_NORMAL_GAIN;
     data[i]=clamp255(128-dx*128);
     data[i+1]=clamp255(128-dy*128);
     data[i+2]=255;
    }
    data[i+3]=255;
   }
  }
  ctx.putImageData(image,0,0);
  const map=new T.CanvasTexture(canvas);
  map.wrapS=map.wrapT=T.RepeatWrapping;
  map.repeat.set(repeat[0],repeat[1]);
  map.colorSpace=channel===0?T.SRGBColorSpace:T.NoColorSpace;
  map.needsUpdate=true;
  map.userData.surfaceKind=canonical;
  return map;
 };
 let sharedField=null;
 const result={map:bakedAlbedoTexture(canonical,repeat)||make(0)};
 if(roughness)result.roughnessMap=make(1);
 if(normal)result.normalMap=bakedNormalTexture(canonical,repeat)||make(2);
 if(bump)result.bumpMap=make(2);
 cache.set(key,result);
 return result;
}

// A baked Moth tile, uploaded as a DataTexture. Returns null when no override
// is configured, so the procedural generator stays the default.
function bakedAlbedoTexture(canonical,repeat){
 const baked=mothSurfaceOverride(canonical);
 if(!baked)return null;
 const texture=new T.DataTexture(baked.data,baked.width,baked.height,T.RGBAFormat,T.UnsignedByteType);
 texture.wrapS=texture.wrapT=T.RepeatWrapping;
 texture.repeat.set(repeat[0],repeat[1]);
 texture.colorSpace=T.SRGBColorSpace;
 texture.needsUpdate=true;
 texture.userData.surfaceKind=canonical;
 texture.userData.source='moth';
 texture.userData.mothShared=true;
 return texture;
}

// A baked tangent-space normal map (derived offline from a quantum-blurred
// height grid), or null for the procedural normal.
function bakedNormalTexture(canonical,repeat){
 const baked=mothNormalOverride(canonical);
 if(!baked)return null;
 const texture=new T.DataTexture(baked.data,baked.width,baked.height,T.RGBAFormat,T.UnsignedByteType);
 texture.wrapS=texture.wrapT=T.RepeatWrapping;
 texture.repeat.set(repeat[0],repeat[1]);
 texture.colorSpace=T.NoColorSpace;
 texture.needsUpdate=true;
 texture.userData.surfaceKind=canonical;
 texture.userData.source='moth';
 texture.userData.mothShared=true;
 return texture;
}

// A single low-frequency macro-variation tile the anti-tiling shader multiplies
// over natural surfaces so the world never repeats. Returns null without a bake.
let macroCache=null;
export function mothMacroTexture(){
 if(macroCache)return macroCache;
 const baked=mothSurfaceOverride('macro-organic');
 if(!baked)return null;
 const texture=new T.DataTexture(baked.data,baked.width,baked.height,T.RGBAFormat,T.UnsignedByteType);
 texture.wrapS=texture.wrapT=T.RepeatWrapping;
 texture.colorSpace=T.NoColorSpace;
 texture.needsUpdate=true;
 texture.userData.mothMacro=true;
 texture.userData.mothShared=true;
 macroCache=texture;
 return texture;
}

// An equirectangular sky/nebula baked through a Moth image engine. Cached per
// name+repeat and disposed with the surface cache.
const skyCache=new Map();
export function mothSkyTexture(name,{repeat=[1,1]}={}){
 const key=`${name}|${repeat[0]},${repeat[1]}`;
 const cached=skyCache.get(key);
 if(cached)return cached;
 const sky=mothSky(name);
 if(!sky)return null;
 const texture=new T.DataTexture(sky.data,sky.width,sky.height,T.RGBAFormat,T.UnsignedByteType);
 texture.wrapS=repeat[0]>1?T.RepeatWrapping:T.ClampToEdgeWrapping;
 texture.wrapT=T.ClampToEdgeWrapping;
 texture.repeat.set(repeat[0],repeat[1]);
 texture.colorSpace=T.SRGBColorSpace;
 texture.needsUpdate=true;
 texture.userData.mothSky=name;
 texture.userData.mothShared=true;
 if(sky.equirect)texture.mapping=T.EquirectangularReflectionMapping;
 const result={texture,equirect:Boolean(sky.equirect),width:sky.width,height:sky.height};
 skyCache.set(key,result);
 return result;
}

// An animated effect sequence baked from a series of quantum-blurred grids.
// Cached per name: the frames are shared by every player of the same effect and
// released exactly once by clearSurfaceTextures, so callers must never dispose
// a frame they did not create (see `userData.mothShared`).
const effectCache=new Map();
export function mothEffectTextures(name){
 const key=String(name);
 const cached=effectCache.get(key);
 if(cached)return cached;
 const effect=mothEffect(name);
 if(!effect)return null;
 const textures=effect.frames.map((frame,index)=>{
  const texture=new T.DataTexture(frame.data,frame.width,frame.height,T.RGBAFormat,T.UnsignedByteType);
  texture.wrapS=texture.wrapT=T.ClampToEdgeWrapping;
  texture.colorSpace=T.SRGBColorSpace;
  texture.needsUpdate=true;
  texture.userData.mothEffect=`${name}:${index}`;
  texture.userData.mothShared=true;
  return texture;
 });
 const result={name,fps:effect.fps,textures};
 effectCache.set(key,result);
 return result;
}

// The reflectance LUT from the entanglement shader engine, as a DataTexture for
// a custom iridescent material. Returns null unless the material was baked.
// Cached per name+repeat and shared by every material that samples it, so the
// view's disposal traversal skips it (`userData.mothShared`).
const lutCache=new Map();
export function mothMaterialLutTexture(name,{repeat=[1,1]}={}){
 const key=`${name}|${repeat[0]},${repeat[1]}`;
 const cached=lutCache.get(key);
 if(cached)return cached;
 const lut=mothMaterialLut(name);
 if(!lut)return null;
 const texture=new T.DataTexture(lut.r,lut.size,lut.size,T.RGBFormat,T.UnsignedByteType);
 texture.wrapS=texture.wrapT=T.RepeatWrapping;
 texture.repeat.set(repeat[0],repeat[1]);
 texture.colorSpace=T.NoColorSpace;
 texture.needsUpdate=true;
 texture.userData.mothLut=name;
 texture.userData.mothShared=true;
 lutCache.set(key,texture);
 return texture;
}

if (typeof globalThis !== 'undefined') {
  globalThis.__tokenarena_textures = surfaceTextures;
}

