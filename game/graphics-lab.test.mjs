import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {ClampToEdgeWrapping,LinearFilter,RepeatWrapping} from 'three';
import {GRAPHICS_EFFECTS,GRAPHICS_LAB_DEFAULT,GRAPHICS_LAB_TARGETS,GRAPHICS_LAB_VERSION,GRAPHICS_RECIPES,defaultGraphicsLab,normalizeGraphicsLab,normalizeGraphicsLabTarget,graphicsRecipe,graphicsLabActive,graphicsLabTargetActive,serializeGraphicsLab,randomGraphicsLab,describeGraphicsLab} from './graphics-lab.mjs';
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

test('the normalizer still defaults stale/corrupt saves off and cannot inject shader values',()=>{
 for(const raw of [undefined,null,[],{version:99,enabled:true},{enabled:true}])assert.equal(graphicsLabActive(normalizeGraphicsLab(raw)),false);
 const s=normalizeGraphicsLab({version:1,enabled:true,mix:Infinity,splitAt:9,palette:'bad',effects:{ink:{enabled:true,value:NaN},glow:{enabled:true,value:900},injected:{enabled:true}}});
 assert.equal(s.mix,1);assert.equal(s.splitAt,.9);assert.equal(s.palette,'circuit');assert.equal(s.effects.glow.value,1.5);assert.equal(s.effects.ink.value,.9);assert.equal(s.effects.injected,undefined);
});
// The shipped look: an empty save hydrates to exactly this recipe, so pin its
// shape, its exact values and the targets it styles.
test('the shipped default is the electric contrast/hatch world with a circuit weapon and ink bots',()=>{
 const d=defaultGraphicsLab();
 assert.equal(d.version,GRAPHICS_LAB_VERSION);
 assert.equal(d.enabled,true);assert.equal(d.bypass,false);assert.equal(d.split,false);assert.equal(d.splitAt,.5);
 assert.equal(d.palette,'electric');
 assert.equal(d.mix,0.825057562220778,'the shipped mix keeps its exact saved value');
 assert.deepEqual(d,GRAPHICS_LAB_DEFAULT,'the shipped constant is already a normalized state');
 assert.notEqual(d,GRAPHICS_LAB_DEFAULT,'the helper hands out a fresh copy, not the frozen constant');
 const on=settings=>Object.entries(settings).filter(([,setting])=>setting.enabled).map(([id])=>id);
 // World: exactly three layers at their exact recipe values.
 assert.deepEqual(on(d.effects),['contrast','saturate','hatch']);
 assert.equal(d.effects.contrast.value,1.6);assert.equal(d.effects.saturate.value,.6);assert.equal(d.effects.hatch.value,.3);
 for(const e of GRAPHICS_EFFECTS){
  if(['contrast','saturate','hatch'].includes(e.id))continue;
  assert.equal(d.effects[e.id].enabled,false,`world ${e.id} ships off`);
  assert.equal(d.effects[e.id].value,e.value,`world ${e.id} keeps the catalogue value`);
 }
 // Weapon: a circuit stack with ink contours, halftone, phosphor screen and grain.
 const weapon=d.targets.weapon;
 assert.equal(weapon.enabled,true);assert.equal(weapon.mix,1);assert.equal(weapon.palette,'circuit');
 assert.deepEqual(on(weapon.effects),['pixel','hex','contrast','sharpen','halftone','ink','neon','crt','grain']);
 for(const [id,value] of Object.entries({pixel:2,hex:4,contrast:1.15,sharpen:1.5,halftone:3,ink:.5,neon:.1,crt:.45,grain:.05}))assert.equal(weapon.effects[id].value,value,`weapon ${id} keeps its exact value`);
 assert.deepEqual(weapon.effects.mothcoat,{enabled:false,value:1,option:'entanglement'},'the weapon coat slider remembers 1 while off');
 // Bots: one ink layer over the all-off stack.
 const bots=d.targets.bots;
 assert.equal(bots.enabled,true);assert.equal(bots.mix,1);assert.equal(bots.palette,'circuit');
 assert.deepEqual(on(bots.effects),['ink']);
 assert.equal(bots.effects.ink.value,1.5);
 for(const e of GRAPHICS_EFFECTS){
  if(e.id==='ink')continue;
  assert.equal(bots.effects[e.id].enabled,false,`bots ${e.id} ships off`);
  assert.equal(bots.effects[e.id].value,e.value,`bots ${e.id} keeps the catalogue value`);
 }
 assert.ok(graphicsLabActive(d));assert.ok(graphicsLabTargetActive(weapon));assert.ok(graphicsLabTargetActive(bots));
 // Only catalogue ids survive in the shipped state.
 assert.deepEqual(Object.keys(d.effects),GRAPHICS_EFFECTS.map(e=>e.id));
 assert.deepEqual(Object.keys(d.targets),['weapon','bots']);
 assert.deepEqual(Object.keys(weapon.effects),GRAPHICS_EFFECTS.map(e=>e.id));
 const injected=JSON.parse(JSON.stringify(GRAPHICS_LAB_DEFAULT));
 injected.effects.injected={enabled:true,value:1};
 injected.targets.injected={enabled:true};
 injected.targets.weapon.effects.injected={enabled:true,value:1};
 assert.deepEqual(normalizeGraphicsLab(injected),d,'injected effect and target ids are dropped');
 assert.deepEqual(normalizeGraphicsLab(JSON.parse(serializeGraphicsLab(d))),d,'the shipped default round-trips through the v1 export');
 // The constant is deeply frozen; the helper returns editable copies.
 assert.ok(Object.isFrozen(GRAPHICS_LAB_DEFAULT)&&Object.isFrozen(GRAPHICS_LAB_DEFAULT.effects)&&Object.isFrozen(GRAPHICS_LAB_DEFAULT.effects.ink));
 assert.ok(Object.isFrozen(GRAPHICS_LAB_DEFAULT.targets)&&Object.isFrozen(GRAPHICS_LAB_DEFAULT.targets.weapon.effects.mothcoat));
 d.effects.ink.enabled=true;d.targets.weapon.enabled=false;
 assert.equal(GRAPHICS_LAB_DEFAULT.effects.ink.enabled,false,'editing a copy never touches the frozen constant');
 assert.equal(defaultGraphicsLab().targets.weapon.enabled,true,'each call starts from the shipped state');
});
test('normalizeGraphicsLab({}) still hydrates to the all-off state RESET ALL / OFF restores',()=>{
 const s=normalizeGraphicsLab();
 assert.equal(s.enabled,false);assert.equal(s.bypass,false);assert.equal(s.split,false);assert.equal(s.mix,1);assert.equal(s.splitAt,.5);assert.equal(s.palette,'circuit');
 for(const e of GRAPHICS_EFFECTS)assert.equal(s.effects[e.id].enabled,false,`${e.id} stays off`);
 for(const id of ['weapon','bots'])assert.equal(s.targets[id].enabled,false,`${id} stays off`);
 assert.notDeepEqual(s,defaultGraphicsLab(),'the all-off state is not the shipped look');
 assert.deepEqual(normalizeGraphicsLab(GRAPHICS_LAB_DEFAULT),defaultGraphicsLab(),'the shipped default is a valid v1 save');
});
// The hook hydrates browser storage after SSR; a DOM test cannot run effects in
// this suite, so pin the empty/unreadable-save path at the source level.
test('useGraphicsLab hydrates an empty or unreadable save to the shipped default, not all-off',async()=>{
 const source=await readFile(new URL('../app/ui/useGraphicsLab.ts',import.meta.url),'utf8');
 assert.ok(source.includes("import {GRAPHICS_LAB_KEY,defaultGraphicsLab,normalizeGraphicsLab,serializeGraphicsLab} from '../../game/graphics-lab.mjs'"),'the hook imports the default helper');
 assert.ok(source.includes('useState(()=>defaultGraphicsLab())'),'the first render already shows the shipped default');
 assert.ok(source.includes('const parsed=stored===null?null:JSON.parse(stored);'),'empty storage is not parsed as the string "null"');
 assert.ok(source.includes('parsed===null||parsed===undefined?defaultGraphicsLab():normalizeGraphicsLab(parsed)'),'empty saves hydrate to the default while readable saves still win');
 assert.ok(source.includes('catch{return defaultGraphicsLab();}'),'an unreadable save falls back to the default');
 assert.ok(source.includes('localStorage.getItem(GRAPHICS_LAB_KEY)'),'storage is still read through the shared key');
 assert.ok(source.includes('localStorage.setItem(GRAPHICS_LAB_KEY,serializeGraphicsLab(value))'),'the save path is unchanged');
 assert.ok(source.includes('storageNotice'),'the storage notice behavior stays');
});
test('the drawer restores the shipped default through the existing message line',async()=>{
 const panel=await readFile(new URL('../app/ui/screens/GraphicsLabPanel.tsx',import.meta.url),'utf8');
 assert.ok(panel.includes('defaultGraphicsLab')&&panel.includes('update(defaultGraphicsLab())'),'RESTORE DEFAULT LOOK applies the shipped state');
 assert.ok(panel.includes('>RESTORE DEFAULT LOOK</Btn>'),'the restore action sits in the actions row beside RESET ALL / OFF');
 assert.ok(panel.includes("setMessage('Default look restored: electric world with contrast and crosshatch, circuit weapon, ink bots.')"),'the confirmation is worded copy, not a bare reset');
 assert.ok(panel.includes('electric world with contrast and crosshatch, a circuit weapon stack, and ink-styled bots'),'the drawer names the shipped default stack');
 assert.equal((panel.match(/role="status"/g)||[]).length,1,'the confirmation reuses the one existing live region');
});
test('all recipes are valid independently editable stacks; bypass and zero mix preserve the recipe',()=>{
 for(const r of GRAPHICS_RECIPES){const s=graphicsRecipe(r.id);assert.deepEqual(s,normalizeGraphicsLab(s));assert.ok(graphicsLabActive(s));assert.ok(Object.values(s.effects).filter(e=>e.enabled).length>=3);assert.equal(graphicsLabActive({...s,bypass:true}),false);assert.equal(graphicsLabActive({...s,mix:0}),false);}
 const a=graphicsRecipe('circuit-print'),b=graphicsRecipe('circuit-print');a.effects.ink.enabled=false;assert.equal(b.effects.ink.enabled,true);
});
test('targets default all-off for v1 saves and reject injected or corrupt data',()=>{
 assert.deepEqual(GRAPHICS_LAB_TARGETS,['world','weapon','bots']);
 const legacy=normalizeGraphicsLab({version:1,enabled:true,effects:{ink:{enabled:true,value:1}}});
 assert.deepEqual(Object.keys(legacy.targets),['weapon','bots']);
 for(const id of ['weapon','bots']){
  const target=legacy.targets[id];
  assert.equal(target.enabled,false,`${id} starts off`);
  assert.equal(target.mix,1,`${id} starts at full mix`);
  assert.equal(target.palette,'circuit',`${id} starts on the default palette`);
  assert.deepEqual(Object.keys(target.effects),GRAPHICS_EFFECTS.map(e=>e.id));
  assert.equal(GRAPHICS_EFFECTS.some(e=>target.effects[e.id].enabled),false,`${id} starts with no layers`);
 }
 const corrupt=normalizeGraphicsLab({version:1,targets:{
  weapon:{enabled:true,mix:Infinity,palette:'bad',effects:{ink:{enabled:true,value:NaN},glow:{enabled:true,value:900},mothcoat:{enabled:true,value:.5,option:'nope'},injected:{enabled:true,value:1}},injected:true},
  bots:'nope',world:{enabled:true},injected:{enabled:true},
 }});
 assert.deepEqual(Object.keys(corrupt.targets),['weapon','bots']);
 const weapon=corrupt.targets.weapon;
 assert.equal(weapon.mix,1);assert.equal(weapon.palette,'circuit');assert.equal(weapon.injected,undefined);
 assert.equal(weapon.effects.ink.value,.9);assert.equal(weapon.effects.glow.value,1.5);
 assert.equal(weapon.effects.mothcoat.option,'entanglement');assert.equal(weapon.effects.injected,undefined);
 assert.equal(corrupt.targets.world,undefined);assert.equal(corrupt.targets.injected,undefined);
 assert.equal(corrupt.targets.bots.enabled,false);assert.equal(corrupt.targets.bots.mix,1);
 assert.deepEqual(normalizeGraphicsLab(corrupt),corrupt,'corrupt targets normalize stably');
 const fresh=normalizeGraphicsLabTarget();fresh.effects.ink.enabled=true;
 assert.equal(normalizeGraphicsLabTarget().effects.ink.enabled,false,'each normalizer call returns a fresh target');
 assert.equal(normalizeGraphicsLabTarget('weapon').enabled,false);
 assert.equal(normalizeGraphicsLabTarget({effects:'nope'}).effects.ink.enabled,false);
});
test('graphicsLabTargetActive is a pure truth table over master, mix and layers',()=>{
 const base=normalizeGraphicsLabTarget();
 assert.equal(graphicsLabTargetActive(undefined),false);
 assert.equal(graphicsLabTargetActive(null),false);
 assert.equal(graphicsLabTargetActive('weapon'),false);
 assert.equal(graphicsLabTargetActive([]),false);
 assert.equal(graphicsLabTargetActive({...base,enabled:true}),false,'master on but no layers is inactive');
 assert.equal(graphicsLabTargetActive({...base,enabled:true,effects:{ink:{enabled:false}}}),false);
 assert.equal(graphicsLabTargetActive({...base,enabled:true,effects:{ink:{enabled:true,value:1}}}),true);
 assert.equal(graphicsLabTargetActive({...base,enabled:false,effects:{ink:{enabled:true,value:1}}}),false);
 assert.equal(graphicsLabTargetActive({...base,enabled:true,mix:0,effects:{ink:{enabled:true,value:1}}}),false);
 assert.equal(graphicsLabTargetActive({...base,enabled:true,mix:-1,effects:{ink:{enabled:true,value:1}}}),false);
 assert.equal(graphicsLabTargetActive({...base,enabled:true,mix:.25,effects:{ink:{enabled:true,value:1}}}),true);
 assert.equal(graphicsLabTargetActive({...base,enabled:true,mix:1,effects:null}),false);
 assert.equal(graphicsLabTargetActive({enabled:true,mix:1,effects:{injected:{enabled:true}}}),false,'unknown effect ids never count');
 assert.equal(graphicsLabTargetActive({...base,enabled:true,effects:{ink:{enabled:true}}}),true,'only the switch gates a layer, not its value');
 const normalized=normalizeGraphicsLabTarget({enabled:true,effects:{mothcoat:{enabled:true,value:.5,option:'entanglement-void'}}});
 assert.equal(normalized.effects.mothcoat.option,'entanglement-void');
 assert.equal(graphicsLabTargetActive(normalized),true);
});
test('export round-trips target stacks and still omits transient comparison state',()=>{
 const s=graphicsRecipe('ghost-rivals');
 s.bypass=true;s.split=true;
 s.targets.weapon.enabled=true;
 s.targets.weapon.effects.ink={...s.targets.weapon.effects.ink,enabled:true,value:1};
 const saved=JSON.parse(serializeGraphicsLab(s));
 assert.equal(saved.bypass,false);assert.equal(saved.split,false);
 assert.deepEqual(Object.keys(saved.targets),['weapon','bots']);
 assert.deepEqual(saved.targets,s.targets,'both target stacks round-trip');
 assert.equal('bypass' in saved.targets.weapon,false);assert.equal('split' in saved.targets.bots,false);
 assert.equal(serializeGraphicsLab(saved),serializeGraphicsLab(s),'a round-tripped state is stable');
 const legacy=JSON.parse(serializeGraphicsLab(normalizeGraphicsLab({version:1,enabled:true})));
 assert.deepEqual(legacy.targets,normalizeGraphicsLab().targets,'old saves export all-off targets');
});
test('pocket-ink reproduces the saved roll and ghost-rivals styles bots with a crisp weapon',()=>{
 const pocket=graphicsRecipe('pocket-ink');
 assert.equal(pocket.mix,0.7353712838244059,'the stored mix is not rounded');
 assert.equal(pocket.palette,'pocket');
 const world={pixel:3,vignette:.5,contrast:1.2,saturate:2,temperature:0,duotone:.15,ink:.9,mothcoat:1};
 for(const [id,value] of Object.entries(world)){
  assert.equal(pocket.effects[id].enabled,true,`${id} is enabled`);
  assert.equal(pocket.effects[id].value,value,`${id} keeps its exact value`);
 }
 assert.equal(pocket.effects.mothcoat.option,'entanglement');
 assert.equal(Object.values(pocket.effects).filter(e=>e.enabled).length,Object.keys(world).length,'only the saved roll is on');
 assert.deepEqual(pocket,normalizeGraphicsLab(pocket));
 assert.deepEqual(pocket.targets,normalizeGraphicsLab().targets,'pocket-ink leaves both targets off');
 const ghost=graphicsRecipe('ghost-rivals');
 assert.deepEqual(ghost,normalizeGraphicsLab(ghost));
 assert.equal(ghost.palette,'electric');
 for(const [id,value] of Object.entries({duotone:.85,crt:.5,chroma:2,grain:.1})){
  assert.equal(ghost.effects[id].enabled,true,`world ${id} is enabled`);
  assert.equal(ghost.effects[id].value,value,`world ${id} matches Ghost Signal`);
 }
 assert.equal(ghost.targets.weapon.enabled,false,'the weapon stays crisp');
 assert.equal(ghost.targets.bots.enabled,true);assert.equal(ghost.targets.bots.palette,'ember');
 for(const [id,value] of Object.entries({neon:1.1,glow:.7,chroma:1.2})){
  assert.equal(ghost.targets.bots.effects[id].enabled,true,`bots ${id} is enabled`);
  assert.equal(ghost.targets.bots.effects[id].value,value,`bots ${id} keeps its exact value`);
 }
 assert.equal(Object.values(ghost.targets.bots.effects).filter(e=>e.enabled).length,3);
 assert.equal(graphicsLabTargetActive(ghost.targets.bots),true);
 assert.equal(graphicsLabTargetActive(ghost.targets.weapon),false);
});
test('export is round-trippable, bounded, and omits temporary comparison state',()=>{
 const s={...graphicsRecipe('field-sketch'),bypass:true,split:true};
 const saved=JSON.parse(serializeGraphicsLab(s));assert.equal(saved.bypass,false);assert.equal(saved.split,false);assert.deepEqual(saved.effects,s.effects);assert.equal(serializeGraphicsLab(saved),serializeGraphicsLab(s));
});
test('randomizer rolls valid, varied, deterministic stacks from a seeded source',()=>{
 const rng=seeded(7),palettes=new Set(),counts=new Set();
 // A roll never exceeds the largest starting recipe now that Pocket Ink stacks eight layers.
 const recipeSized=Math.max(...GRAPHICS_RECIPES.map(r=>Object.keys(r.effects).length));
 for(let i=0;i<60;i++){
  const s=randomGraphicsLab(rng);
  assert.deepEqual(s,normalizeGraphicsLab(s),'roll stays normalized');
  assert.equal(graphicsLabActive(s),true,'roll is an active, enabled mix');
  const layers=GRAPHICS_EFFECTS.filter(e=>s.effects[e.id].enabled).length;
  assert.ok(layers>=2,`roll enables at least two layers (got ${layers})`);
  assert.ok(layers<=recipeSized,'roll stays within a recipe-sized stack');
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
test('randomizer leaves both target stacks off, exactly like the original world-only rolls',()=>{
 const rng=seeded(31),defaults=normalizeGraphicsLab().targets;
 for(let i=0;i<40;i++){
  const s=randomGraphicsLab(rng);
  assert.deepEqual(s.targets,defaults,'a roll never enables a target stack');
  assert.equal(s.targets.weapon.enabled,false);
  assert.equal(s.targets.bots.enabled,false);
 }
});
test('configure switches layers by options and keeps one program across world, weapon and bots',()=>{
 configureMothAssets(mothFixture());
 const pass=new GraphicsLabPass(),material=pass.material;
 const world=graphicsRecipe('ghost-rivals');
 pass.configure(world,640,360);
 assert.equal(pass.enabled,true,'the world stack runs by default');
 assert.equal(pass.uniforms.keepAlpha.value,0);assert.equal(pass.uniforms.depthTest.value,0);
 assert.equal(pass.uniforms.depthCompare.value,0);assert.equal(pass.uniforms.tWorldDepth.value,null);
 pass.configure(world,640,360,{active:false});
 assert.equal(pass.enabled,false,'an explicit active:false wins over the world stack');
 const weapon=world.targets.weapon;
 pass.configure(weapon,640,360,{active:false});
 assert.equal(pass.enabled,false,'a target stays off even while the world stack is on');
 pass.configure(weapon,640,360,{active:true});
 assert.equal(pass.enabled,true,'an explicit active:true enables regardless of the world fields');
 pass.configure(normalizeGraphicsLab(),640,360,{active:true});
 assert.equal(pass.enabled,true,'active:true enables an all-off world too');
 const weaponState={...weapon,enabled:true,mix:.5,effects:{...weapon.effects,ink:{...weapon.effects.ink,enabled:true,value:1}}};
 pass.configure(weaponState,640,360,{active:graphicsLabTargetActive(weaponState),keepAlpha:true,depthTest:true});
 assert.equal(pass.enabled,true);
 assert.equal(pass.uniforms.mixAmount.value,.5,'a target stack uses its own mix');
 assert.equal(pass.uniforms.ink.value,1);
 assert.equal(pass.uniforms.keepAlpha.value,1);
 assert.equal(pass.uniforms.depthTest.value,1);
 assert.equal(pass.uniforms.depthCompare.value,0,'the compare waits for both depth textures');
 assert.equal(pass.uniforms.tWorldDepth.value,null);assert.equal(pass.uniforms.tBotDepth.value,null);
 const worldDepth={isTexture:true},botDepth={isTexture:true};
 pass.configure(weaponState,640,360,{keepAlpha:true,depthTest:true,worldDepth,botDepth});
 assert.equal(pass.uniforms.depthCompare.value,1);
 assert.equal(pass.uniforms.tWorldDepth.value,worldDepth);assert.equal(pass.uniforms.tBotDepth.value,botDepth);
 const bots=world.targets.bots;
 assert.equal(graphicsLabTargetActive(bots),true);
 pass.configure(bots,640,360,{active:graphicsLabTargetActive(bots),keepAlpha:true,depthTest:true,worldDepth,botDepth});
 assert.equal(pass.enabled,true);
 assert.equal(pass.uniforms.neon.value,1.1);assert.equal(pass.uniforms.glow.value,.7);assert.equal(pass.uniforms.chroma.value,1.2);
 assert.ok(Math.abs(pass.uniforms.paperColor.value.z-164/255)<1e-9,'the bots stack uses its own ember palette');
 pass.configure(bots,640,360,{keepAlpha:false,depthTest:false});
 assert.equal(pass.uniforms.keepAlpha.value,0);assert.equal(pass.uniforms.depthTest.value,0);
 assert.equal(pass.uniforms.depthCompare.value,0);assert.equal(pass.uniforms.tBotDepth.value,null);
 assert.equal(pass.material,material,'world, weapon and bots configurations reuse the one program');
 pass.dispose();
});

test('weapon overlays reject exactly empty alpha before styling without enabling world-depth tests',t=>{
 const pass=new GraphicsLabPass();t.after(()=>pass.dispose());
 pass.configure(defaultGraphicsLab().targets.weapon,640,360,{active:true,keepAlpha:true,depthTest:false});
 assert.equal(pass.uniforms.keepAlpha.value,1);assert.equal(pass.uniforms.depthTest.value,0);assert.equal(pass.uniforms.depthCompare.value,0);
 // Shader contract: the no-depth weapon path must reach the empty-alpha guard,
 // while faint nonzero pixels and the existing bot depth rejection survive.
 const shader=pass.material.fragmentShader,guard='if(keepAlpha>.5&&source.a==0.)discard;';
 assert.ok(shader.indexOf(guard)>shader.indexOf('vec4 source=texture2D(tDiffuse,vUv);'));
 assert.ok(shader.indexOf(guard)<shader.indexOf('if(depthTest>.5)'));
 assert.ok(shader.indexOf(guard)<shader.indexOf('if(glow>0.)'));
 assert.match(shader,/if\(source\.a<\.004\)discard;/);
 assert.match(shader,/if\(depthCompare>\.5&&texture2D\(tBotDepth,vUv\)\.r>texture2D\(tWorldDepth,vUv\)\.r\+\.0008\)discard;/);
 assert.match(shader,/keepAlpha>\.5\?source\.a:1\./);
 pass.configure(defaultGraphicsLab(),640,360,{keepAlpha:false,depthTest:false});
 assert.equal(pass.uniforms.keepAlpha.value,0,'the opaque world never takes the new rejection path');
});
