import test from 'node:test';
import assert from 'node:assert/strict';
import {ClampToEdgeWrapping,LinearFilter,RepeatWrapping} from 'three';
import {GRAPHICS_EFFECTS,GRAPHICS_RECIPES,normalizeGraphicsLab,graphicsRecipe,graphicsLabActive,serializeGraphicsLab,randomGraphicsLab,describeGraphicsLab} from './graphics-lab.mjs';
import {GraphicsLabPass} from './graphics-lab-pass.mjs';
import {configureMothAssets,resetMothAssets} from './moth-assets.mjs';

// Small deterministic LCG standing in for Math.random.
function seeded(seed){let value=seed>>>0;return()=>{value=(value*1664525+1013904223)>>>0;return value/4294967296;};}
const b64=bytes=>Buffer.from(bytes).toString('base64');
// Tiny synthetic Moth bake: a 2x2 mid-grey tile, one 2x2 effect frame, and a
// 2x2 R/T LUT. `lut:false` models a bake whose material never shipped.
function mothFixture({lut=true}={}){
  return {version:1,
    textures:{'macro-organic':{width:2,height:2,data:b64(new Uint8Array([0,0,0,255,85,85,85,255,170,170,170,255,255,255,255,255]))}},
    effects:{'arc-burst':{fps:10,frames:[{width:2,height:2,data:b64(new Uint8Array([255,0,0,255,0,255,0,255,0,0,255,255,255,255,0,255]))}]}},
    ...(lut?{materials:{entanglement:{size:2,r:b64(new Uint8Array([0,0,0,255,0,0,0,0,0,128,0,0])),t:b64(new Uint8Array([0,0,0,0,0,0,0,0,0,64,0,0]))}}}:{}),
  };
}

test('preview defaults off; stale/corrupt settings cannot turn it on or inject shader values',()=>{
 for(const raw of [undefined,null,[],{version:99,enabled:true},{enabled:true}])assert.equal(graphicsLabActive(normalizeGraphicsLab(raw)),false);
 const s=normalizeGraphicsLab({version:1,enabled:true,mix:Infinity,splitAt:9,palette:'bad',effects:{ink:{enabled:true,value:NaN},glow:{enabled:true,value:900},injected:{enabled:true}}});
 assert.equal(s.mix,1);assert.equal(s.splitAt,.9);assert.equal(s.palette,'circuit');assert.equal(s.effects.glow.value,1.5);assert.equal(s.effects.ink.value,.9);assert.equal(s.effects.injected,undefined);
});
test('all recipes are valid independently editable stacks; bypass and zero mix preserve the recipe',()=>{
 for(const r of GRAPHICS_RECIPES){const s=graphicsRecipe(r.id);assert.deepEqual(s,normalizeGraphicsLab(s));assert.ok(graphicsLabActive(s));assert.ok(Object.values(s.effects).filter(e=>e.enabled).length>=3);assert.equal(graphicsLabActive({...s,bypass:true}),false);assert.equal(graphicsLabActive({...s,mix:0}),false);}
 const a=graphicsRecipe('circuit-print'),b=graphicsRecipe('circuit-print');a.effects.ink.enabled=false;assert.equal(b.effects.ink.enabled,true);
});
test('export is round-trippable, bounded, and omits temporary comparison state',()=>{
 const s={...graphicsRecipe('field-sketch'),bypass:true,split:true};
 const saved=JSON.parse(serializeGraphicsLab(s));assert.equal(saved.bypass,false);assert.equal(saved.split,false);assert.deepEqual(saved.effects,s.effects);assert.equal(serializeGraphicsLab(saved),serializeGraphicsLab(s));
});
test('randomizer rolls valid, varied, deterministic stacks from a seeded source',()=>{
 const rng=seeded(7),palettes=new Set(),counts=new Set();
 for(let i=0;i<60;i++){
  const s=randomGraphicsLab(rng);
  assert.deepEqual(s,normalizeGraphicsLab(s),'roll stays normalized');
  assert.equal(graphicsLabActive(s),true,'roll is an active, enabled mix');
  const layers=GRAPHICS_EFFECTS.filter(e=>s.effects[e.id].enabled).length;
  assert.ok(layers>=2,`roll enables at least two layers (got ${layers})`);
  assert.ok(layers<=6,'roll stays within a recipe-sized stack');
  for(const e of GRAPHICS_EFFECTS){const v=s.effects[e.id].value;assert.ok(v>=e.min&&v<=e.max,`${e.id} stays in range`);}
  palettes.add(s.palette);counts.add(layers);
  assert.ok(s.mix>=.7&&s.mix<=1,'overall mix stays usable');
 }
 assert.ok(palettes.size>=3,'rolls vary the palette');
 assert.ok(counts.size>=2,'rolls vary the layer count');
 const a=randomGraphicsLab(seeded(11)),b=randomGraphicsLab(seeded(11));
 assert.deepEqual(a,b,'same seed, same roll');
 const c=randomGraphicsLab(seeded(12));
 assert.notDeepEqual(a,c,'different seed, different roll');
});
test('describeGraphicsLab names the off state and the palette/layer mix',()=>{
 assert.equal(describeGraphicsLab(normalizeGraphicsLab()),'Graphics lab off');
 const on=describeGraphicsLab(graphicsRecipe('field-sketch'));
 assert.match(on,/^Graphics lab · 4 layers · Paper$/);
 const idle={...normalizeGraphicsLab(),enabled:true};
 assert.equal(describeGraphicsLab(idle),'Graphics lab on · no layers yet');
});
test('the baked-Moth accents are catalogue effects with bounded sliders and a showcase recipe',()=>{
 const ids=['mothgrain','mothsignal','mothcoat'];
 for(const id of ids){
  const e=GRAPHICS_EFFECTS.find(effect=>effect.id===id);
  assert.ok(e,`${id} is a catalogue effect`);
  assert.ok(e.min>0&&e.min<e.max&&e.step>0&&e.value>=e.min&&e.value<=e.max,`${id} has workable slider bounds`);
  assert.match(e.description,/baked Moth/);
 }
 const raw=normalizeGraphicsLab({version:1,enabled:true,effects:Object.fromEntries(ids.map(id=>[id,{enabled:true,value:99}]))});
 for(const id of ids)assert.equal(raw.effects[id].value,GRAPHICS_EFFECTS.find(e=>e.id===id).max,`${id} clamps to its max`);
 const recipe=GRAPHICS_RECIPES.find(r=>r.id==='moth-print');
 assert.ok(recipe&&ids.every(id=>recipe.effects[id]>0),'Moth Print stacks all three accents');
});
test('Moth accents are a silent zero without a bake and never block other layers',()=>{
 resetMothAssets();
 const pass=new GraphicsLabPass();
 const s=normalizeGraphicsLab({version:1,enabled:true,effects:{mothgrain:{enabled:true,value:.25},mothsignal:{enabled:true,value:.7},mothcoat:{enabled:true,value:.9},ink:{enabled:true,value:1}}});
 pass.configure(s,320,200);
 assert.ok(pass.enabled);
 for(const id of ['mothgrain','mothsignal','mothcoat'])assert.equal(pass.uniforms[id].value,0,`${id} drops to zero without its bake`);
 assert.equal(pass.uniforms.mothgrainMap.value,null);
 assert.equal(pass.uniforms.mothsignalMap.value,null);
 assert.equal(pass.uniforms.mothcoatRamp.value,null);
 assert.equal(pass.uniforms.ink.value,1,'other layers keep running');
 // A partial bake binds what exists and zeroes only the missing layer.
 configureMothAssets(mothFixture({lut:false}));
 pass.configure(s,320,200);
 assert.equal(pass.uniforms.mothgrain.value,.25);
 assert.equal(pass.uniforms.mothsignal.value,.7);
 assert.equal(pass.uniforms.mothcoat.value,0);
 assert.ok(pass.uniforms.mothgrainMap.value?.isTexture&&pass.uniforms.mothsignalMap.value?.isTexture);
 assert.equal(pass.uniforms.mothcoatRamp.value,null);
 pass.dispose();
});
test('injected Moth assets bind sampled textures, measured means, and slider values',()=>{
 configureMothAssets(mothFixture());
 const pass=new GraphicsLabPass();
 const s=normalizeGraphicsLab({version:1,enabled:true,effects:{mothgrain:{enabled:true,value:.4},mothsignal:{enabled:true,value:.6},mothcoat:{enabled:true,value:.8}}});
 pass.configure(s,320,200);
 assert.equal(pass.uniforms.mothgrain.value,.4);
 assert.equal(pass.uniforms.mothsignal.value,.6);
 assert.equal(pass.uniforms.mothcoat.value,.8);
 const grain=pass.uniforms.mothgrainMap.value,signal=pass.uniforms.mothsignalMap.value,ramp=pass.uniforms.mothcoatRamp.value;
 assert.equal(grain.wrapS,RepeatWrapping);assert.equal(grain.wrapT,RepeatWrapping);
 assert.equal(signal.wrapS,RepeatWrapping);assert.equal(signal.minFilter,LinearFilter);
 assert.equal(ramp.wrapS,ClampToEdgeWrapping);assert.equal(ramp.image.width,256);assert.equal(ramp.image.height,1);
 assert.equal(pass.uniforms.mothgrainMean.value,.5,'the grain neutral is measured from the baked tile');
 assert.ok(pass.uniforms.mothcoatMean.value.x>0&&pass.uniforms.mothcoatMean.value.y>0,'the ramp mean is measured, not assumed');
 // Disabling one layer returns it to zero without disturbing the others.
 s.effects.mothgrain.enabled=false;
 pass.configure(s,320,200);
 assert.equal(pass.uniforms.mothgrain.value,0);
 assert.equal(pass.uniforms.mothsignal.value,.6);
 pass.dispose();
});
test('one GPU material supports every combination through uniforms, including independent off and resize',()=>{
 configureMothAssets(mothFixture());
 const pass=new GraphicsLabPass(),material=pass.material,s=graphicsRecipe('circuit-print');
 for(const e of GRAPHICS_EFFECTS)s.effects[e.id]={enabled:true,value:e.max};
 pass.configure(s,844,390);assert.ok(pass.enabled);assert.deepEqual(pass.uniforms.resolution.value.toArray(),[844,390]);
 for(const e of GRAPHICS_EFFECTS)assert.equal(pass.uniforms[e.id].value,e.max);
 s.effects.ink.enabled=false;pass.configure(s,390,844);assert.equal(pass.uniforms.ink.value,0);assert.equal(pass.material,material);assert.equal(pass.uniforms.neon.value,1.5);
 s.bypass=true;pass.configure(s,0,0);assert.equal(pass.enabled,false);assert.deepEqual(pass.uniforms.resolution.value.toArray(),[1,1]);
 pass.dispose();
});
