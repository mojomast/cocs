import test from 'node:test';
import assert from 'node:assert/strict';
import {GRAPHICS_EFFECTS,GRAPHICS_RECIPES,normalizeGraphicsLab,graphicsRecipe,graphicsLabActive,serializeGraphicsLab} from './graphics-lab.mjs';
import {GraphicsLabPass} from './graphics-lab-pass.mjs';

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
test('one GPU material supports every combination through uniforms, including independent off and resize',()=>{
 const pass=new GraphicsLabPass(),material=pass.material,s=graphicsRecipe('circuit-print');
 for(const e of GRAPHICS_EFFECTS)s.effects[e.id]={enabled:true,value:e.max};
 pass.configure(s,844,390);assert.ok(pass.enabled);assert.deepEqual(pass.uniforms.resolution.value.toArray(),[844,390]);
 for(const e of GRAPHICS_EFFECTS)assert.equal(pass.uniforms[e.id].value,e.max);
 s.effects.ink.enabled=false;pass.configure(s,390,844);assert.equal(pass.uniforms.ink.value,0);assert.equal(pass.material,material);assert.equal(pass.uniforms.neon.value,1.5);
 s.bypass=true;pass.configure(s,0,0);assert.equal(pass.enabled,false);assert.deepEqual(pass.uniforms.resolution.value.toArray(),[1,1]);
 pass.dispose();
});
