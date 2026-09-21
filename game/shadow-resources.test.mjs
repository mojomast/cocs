import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import {WebGLMaterials} from 'three/src/renderers/webgl/WebGLMaterials.js';
import {installShadowTextureSync} from './shadow-resources.mjs';

const keys=['map','alphaMap','displacementMap'];
for(const [Material,shader] of [[T.MeshDepthMaterial,'depth'],[T.MeshDistanceMaterial,'distance']]){
 test(`${Material.name} cannot reupload retired arena textures through stale uniforms`,()=>{
  const material=new Material(),uniforms=T.UniformsUtils.clone(T.ShaderLib[shader].uniforms);
  const state={uniforms,light:new T.PointLight()},submitted=[],args=[{},null,{},material,{},null],result={};
  const renderer={isWebGLRenderer:true,properties:{get:m=>{assert.equal(m,material);return state;}},
   renderBufferDirect(...actual){
    assert.equal(this,renderer);assert.deepEqual(actual,args);
    // Exercise Three's actual non-null-only refresh before the simulated upload.
    refresh.refreshMaterialUniforms(uniforms,material,1,1,null);
    submitted.push(keys.map(key=>uniforms[key].value));return result;
   }};
  const refresh=WebGLMaterials(renderer,renderer.properties);
  assert.equal(installShadowTextureSync(renderer),true);
  const wrapped=renderer.renderBufferDirect;
  assert.equal(installShadowTextureSync(renderer),false);assert.equal(renderer.renderBufferDirect,wrapped);
  for(let cycle=0;cycle<3;cycle++){
   const textures=keys.map(()=>new T.Texture()),disposed=textures.map(()=>0);
   textures.forEach((texture,i)=>texture.addEventListener('dispose',()=>disposed[i]++));
   keys.forEach((key,i)=>{material[key]=textures[i];});
   material.alphaTest=.5;material.displacementScale=.35;
   const version=material.version;
   assert.equal(renderer.renderBufferDirect(...args),result);
   assert.deepEqual(submitted.at(-1),textures,'live cutout and displacement maps reach the shadow pass');
   assert.equal(material.version,version,'mapped submissions do not force shader recompilation');
   keys.forEach(key=>{material[key]=null;});
   material.alphaTest=0;
   textures.forEach(texture=>texture.dispose());
   assert.deepEqual(keys.map(key=>uniforms[key].value),textures,'the renderer still holds the retired samplers');
   const untexturedVersion=material.version;
   renderer.renderBufferDirect(...args);
   assert.deepEqual(submitted.at(-1),[null,null,null],'no disposed texture reaches uniform upload');
   assert.equal(material.version,untexturedVersion,'synchronization does not force shader recompilation');
   assert.deepEqual(disposed,[1,1,1],'the surface cache remains the sole texture disposer');
  }
  material.dispose();
 });
}

test('shadow synchronization leaves ordinary draws and uncompiled materials alone',()=>{
 const ordinary=new T.MeshStandardMaterial(),depth=new T.MeshDepthMaterial(),stale=new T.Texture();
 const uniform={value:stale},state=new Map([[ordinary,{uniforms:{map:uniform}}],[depth,{}]]);
 let calls=0;
 const renderer={isWebGLRenderer:true,properties:{get:m=>state.get(m)},renderBufferDirect(){calls++;}};
 installShadowTextureSync(renderer);
 renderer.renderBufferDirect(null,null,null,ordinary,null,null);
 renderer.renderBufferDirect(null,null,null,depth,null,null);
 assert.equal(uniform.value,stale);assert.equal(calls,2);
 assert.equal(installShadowTextureSync({isSoftware:true}),false);
 ordinary.dispose();depth.dispose();stale.dispose();
});
