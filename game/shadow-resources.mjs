const shadowTextureKeys=['map','alphaMap','displacementMap'];
const installed=new WeakSet();

// Three reuses depth/distance materials between shadow casters. Its uniform
// refresh only assigns non-null maps, so an untextured caster can upload a
// previous arena's disposed texture through a stale sampler. Synchronize at
// the submission boundary, after WebGLShadowMap has selected the caster maps.
export function installShadowTextureSync(renderer){
 if(renderer?.isWebGLRenderer!==true||typeof renderer.renderBufferDirect!=='function'||typeof renderer.properties?.get!=='function'||installed.has(renderer))return false;
 const renderBufferDirect=renderer.renderBufferDirect;
 renderer.renderBufferDirect=function(camera,scene,geometry,material,object,group){
  if(material?.isMeshDepthMaterial||material?.isMeshDistanceMaterial){
   const uniforms=this.properties.get(material).uniforms;
   if(uniforms)for(const key of shadowTextureKeys)if(uniforms[key])uniforms[key].value=material[key]??null;
  }
  return renderBufferDirect.call(this,camera,scene,geometry,material,object,group);
 };
 installed.add(renderer);
 return true;
}
