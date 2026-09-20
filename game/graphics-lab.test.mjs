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
// 2x2 R/T LUT. `lut:false` models a bake whose material never shipped; the
// `fields`/`qrc`/`voidLut` flags ship the optional catalogue assets.
function mothFixture({lut=true,fields=false,qrc=false,voidLut=false}={}){
  const textures={'macro-organic':{width:2,height:2,data:b64(new Uint8Array([0,0,0,255,85,85,85,255,170,170,170,255,255,255,255,255]))}};
  if(fields){
    textures['dust-field']={width:2,height:2,data:b64(new Uint8Array([255,255,255,255,0,0,0,255,128,128,128,255,64,64,64,255]))};
    textures['flow-field']={width:2,height:2,data:b64(new Uint8Array([10,10,10,255,200,200,200,255,30,30,30,255,240,240,240,255]))};
  }
  const effects={'arc-burst':{fps:10,frames:[{width:2,height:2,data:b64(new Uint8Array([255,0,0,255,0,255,0,255,0,0,255,255,255,255,0,255]))}]}};
  if(qrc)effects['qrc-glyphs']={fps:8,frames:[{width:2,height:2,data:b64(new Uint8Array([0,255,0,255,255,255,255,255,255,0,255,255,0,0,0,255]))}]};
  const materials=lut?{entanglement:{size:2,r:b64(new Uint8Array([0,0,0,255,0,0,0,0,0,128,0,0])),t:b64(new Uint8Array([0,0,0,0,0,0,0,0,0,64,0,0]))}}:{};
  if(voidLut)materials['entanglement-void']={size:2,r:b64(new Uint8Array([0,0,0,255,255,255,255,255,0,255,0,0])),t:b64(new Uint8Array([0,0,0,0,255,255,255,255,0,128,0,0]))};
  return {version:1,textures,effects,materials};
}
// Grayscale means of the synthetic field tiles above, used to prove the pass
// measures each selected asset rather than assuming the default.
const DUST_MEAN=447/1020,FLOW_MEAN=480/1020;

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
test('optioned layers normalize to a valid catalogue asset and drop unknown ids',()=>{
 const defaults={mothgrain:'macro-organic',mothsignal:'arc-burst',mothcoat:'entanglement'};
 for(const e of GRAPHICS_EFFECTS){
  if(!e.options)continue;
  assert.ok(e.options.length>=2,`${e.id} offers a choice`);
  assert.ok(typeof e.assetLabel==='string'&&e.assetLabel.endsWith(' asset'),`${e.id} names its asset select`);
  for(const o of e.options){
   assert.equal(o.asset,o.id,`${e.id}:${o.id} reads its own registry key`);
   assert.ok(o.label&&['surface','effect','lut'].includes(o.kind),`${e.id}:${o.id} is a complete descriptor`);
  }
 }
 for(const [id,fallback] of Object.entries(defaults)){
  const e=GRAPHICS_EFFECTS.find(effect=>effect.id===id);
  assert.equal(e.options[0].id,fallback,`${id} ships ${fallback} as its default`);
  const missing=normalizeGraphicsLab({version:1,enabled:true,effects:{[id]:{enabled:true,value:e.value}}});
  assert.equal(missing.effects[id].option,fallback,'a save without options fills in the default');
  const stale=normalizeGraphicsLab({version:1,enabled:true,effects:{[id]:{enabled:true,value:e.value,option:'nope'}}});
  assert.equal(stale.effects[id].option,fallback,'an unknown option id falls back to the default');
  assert.deepEqual(normalizeGraphicsLab(stale),stale,'the fallback stays normalized');
 }
 assert.equal(normalizeGraphicsLab({version:1,effects:{ink:{enabled:true,value:1,option:'dust-field'}}}).effects.ink.option,undefined,'optionless layers never grow an option');
 const picked=normalizeGraphicsLab({version:1,effects:{mothcoat:{enabled:true,value:.4,option:'entanglement-void'}}});
 assert.equal(picked.effects.mothcoat.option,'entanglement-void','a known option survives normalization');
});
test('exported and copied recipes carry the chosen option',()=>{
 const s=graphicsRecipe('moth-print');
 s.effects.mothgrain.option='flow-field';
 s.effects.mothsignal.option='qrc-glyphs';
 s.effects.mothcoat.option='entanglement-ceramic';
 const saved=JSON.parse(serializeGraphicsLab(s));
 assert.equal(saved.effects.mothgrain.option,'flow-field');
 assert.equal(saved.effects.mothsignal.option,'qrc-glyphs');
 assert.equal(saved.effects.mothcoat.option,'entanglement-ceramic');
 assert.deepEqual(saved.effects,s.effects,'each layer round-trips with its option');
 assert.equal(serializeGraphicsLab(saved),serializeGraphicsLab(s),'a round-tripped recipe is stable');
 // A recipe stored before options existed hydrates to the defaults.
 const legacy=JSON.parse(serializeGraphicsLab(graphicsRecipe('moth-print')));
 for(const id of ['mothgrain','mothsignal','mothcoat'])delete legacy.effects[id].option;
 const hydrated=normalizeGraphicsLab(legacy);
 assert.equal(hydrated.effects.mothgrain.option,'macro-organic');
 assert.equal(hydrated.effects.mothsignal.option,'arc-burst');
 assert.equal(hydrated.effects.mothcoat.option,'entanglement');
});
test('randomizer rolls only catalogue options and keeps every stack normalized',()=>{
 const rng=seeded(23),seen=new Set();
 for(let i=0;i<80;i++){
  const s=randomGraphicsLab(rng);
  assert.deepEqual(s,normalizeGraphicsLab(s),'an option roll stays normalized');
  for(const e of GRAPHICS_EFFECTS){
   if(!e.options)continue;
   const setting=s.effects[e.id];
   assert.ok(e.options.some(o=>o.id===setting.option),`${e.id} stays inside the catalogue`);
   if(setting.enabled)seen.add(`${e.id}:${setting.option}`);
  }
 }
 assert.ok(seen.size>=2,'rolls vary Moth assets, not just slider values');
});
test('a missing option asset zeroes only its layer; switching options rebinds from the cache',()=>{
 resetMothAssets();
 configureMothAssets(mothFixture());
 const pass=new GraphicsLabPass();
 const s=normalizeGraphicsLab({version:1,enabled:true,effects:{
  mothgrain:{enabled:true,value:.3,option:'dust-field'},
  mothsignal:{enabled:true,value:.5,option:'qrc-glyphs'},
  mothcoat:{enabled:true,value:.7,option:'entanglement-void'},
  ink:{enabled:true,value:1},
 }});
 pass.configure(s,320,200);
 for(const id of ['mothgrain','mothsignal','mothcoat'])assert.equal(pass.uniforms[id].value,0,`${id} drops to zero when its chosen asset is missing`);
 assert.equal(pass.uniforms.mothgrainMap.value,null);
 assert.equal(pass.uniforms.mothsignalMap.value,null);
 assert.equal(pass.uniforms.mothcoatRamp.value,null);
 assert.equal(pass.uniforms.ink.value,1,'other layers keep running');
 // Ship the optional assets: the same selection binds and measures each tile.
 configureMothAssets(mothFixture({fields:true,qrc:true,voidLut:true}));
 const material=pass.material;
 pass.configure(s,320,200);
 assert.equal(pass.uniforms.mothgrain.value,.3);
 assert.equal(pass.uniforms.mothsignal.value,.5);
 assert.equal(pass.uniforms.mothcoat.value,.7);
 const dust=pass.uniforms.mothgrainMap.value,arc=pass.uniforms.mothsignalMap.value;
 assert.ok(dust?.isTexture&&arc?.isTexture,'the selected surface and effect frame bind');
 assert.ok(pass.uniforms.mothcoatRamp.value?.isTexture,'the selected LUT ramp binds');
 assert.ok(Math.abs(pass.uniforms.mothgrainMean.value-DUST_MEAN)<1e-9,'the grain mean is measured from the selected tile');
 // Switching the option only changes uniforms; the texture follows the cache.
 s.effects.mothgrain.option='flow-field';
 s.effects.mothsignal.option='arc-burst';
 pass.configure(s,320,200);
 const flow=pass.uniforms.mothgrainMap.value;
 assert.ok(flow?.isTexture&&flow!==dust,'another option binds a different texture');
 assert.notEqual(pass.uniforms.mothsignalMap.value,arc,'another effect option binds a different frame');
 assert.ok(Math.abs(pass.uniforms.mothgrainMean.value-FLOW_MEAN)<1e-9,'the mean follows the selected tile');
 assert.equal(pass.material,material,'option switches never recompile the pass');
 s.effects.mothgrain.option='dust-field';
 s.effects.mothsignal.option='qrc-glyphs';
 pass.configure(s,320,200);
 assert.equal(pass.uniforms.mothgrainMap.value,dust,'switching back rebinds the cached texture');
 assert.ok(Math.abs(pass.uniforms.mothgrainMean.value-DUST_MEAN)<1e-9,'the mean follows the option back');
 assert.equal(pass.uniforms.mothsignalMap.value,arc,'the cached frame rebinds too');
 pass.dispose();
});
