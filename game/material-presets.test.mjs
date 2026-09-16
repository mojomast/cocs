import test from 'node:test';
import assert from 'node:assert/strict';
import {surfaceTextures,clearSurfaceTextures,MATERIAL_PRESETS,materialPreset} from './textures.mjs';

// Capture the pixel buffers surfaceTextures writes so the channel relationship
// can be measured without a real 2D canvas.
const recordingDocument=t=>{
 const previous=Object.getOwnPropertyDescriptor(globalThis,'document'),images=[];
 const ctx={createImageData:(w,h)=>{const image={width:w,height:h,data:new Uint8ClampedArray(w*h*4)};images.push(image);return image;},putImageData(){}};
 Object.defineProperty(globalThis,'document',{configurable:true,value:{createElement:()=>({width:0,height:0,getContext:()=>ctx})}});
 t.after(()=>{if(previous)Object.defineProperty(globalThis,'document',previous);else delete globalThis.document;});
 return images;
};
const luminance=data=>{const out=[];for(let i=0;i<data.length;i+=4)out.push(.2126*data[i]+.7152*data[i+1]+.0722*data[i+2]);return out;};
const correlation=(a,b)=>{const n=Math.min(a.length,b.length),ma=a.slice(0,n).reduce((s,v)=>s+v,0)/n,mb=b.slice(0,n).reduce((s,v)=>s+v,0)/n;let cov=0,va=0,vb=0;for(let i=0;i<n;i++){const da=a[i]-ma,db=b[i]-mb;cov+=da*db;va+=da*da;vb+=db*db;}return cov/Math.sqrt(va*vb||1);};

test('albedo, roughness and normal share one height/wear field',t=>{
 const images=recordingDocument(t);
 const maps=surfaceTextures('concrete',{seed:5,size:48,repeat:[1,1]});
 assert.ok(maps.map&&maps.roughnessMap&&maps.normalMap);
 const albedo=luminance(images[0].data),roughness=luminance(images[1].data);
 const r=correlation(albedo,roughness);
 assert.ok(r>.75,`visible albedo relief tracks roughness instead of using an independent seed (r=${r.toFixed(3)})`);
 clearSurfaceTextures();
});

test('material presets describe distinct surfaces',()=>{
 assert.ok(Object.isFrozen(MATERIAL_PRESETS));
 const {paintedArmor,exposedSteel,rubber,stone,energy}=MATERIAL_PRESETS;
 assert.ok(paintedArmor.metalness<.3&&paintedArmor.roughness>=.4&&paintedArmor.roughness<=.8,'painted armour is mostly nonmetallic and moderately rough');
 assert.ok(exposedSteel.metalness>.7&&exposedSteel.roughness<.5,'exposed steel is metallic with controlled roughness');
 assert.ok(rubber.metalness<.2&&rubber.roughness>.85,'rubber is nonmetallic and very rough');
 assert.ok(stone.metalness<.1&&stone.roughness>.9,'stone is nonmetallic and rough');
 assert.ok(energy.emissiveIntensity>0&&energy.roughness<.5,'energy is a localized emissive surface');
 assert.equal(materialPreset('exposedSteel'),exposedSteel);
 assert.equal(materialPreset('missing'),paintedArmor,'an unknown preset falls back to painted armour');
});
