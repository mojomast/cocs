import {Vector2} from 'three';
import {ShaderPass} from 'three/addons/postprocessing/ShaderPass.js';

// The last full-screen pass when post-processing runs: static dithering for
// 8-bit gradients, then a small contrast-adaptive unsharp to recover the detail
// FXAA softens. It runs in display space (after OutputPass) where the 8-bit
// quantisation actually happens, and it is deterministic: no time uniform, no
// history, so reduced-motion users and still captures see the same pixels.
//
// Cost: five texture reads and two hashes; one pass, no render targets.
export const FINISH_SHARPEN_LIMIT = 0.32;
export const FINISH_DITHER_MAX = 1 / 255;

const vertexShader='varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}';

const fragmentShader=/* glsl */`
uniform sampler2D tDiffuse;
uniform vec2 resolution;
uniform float dither;
uniform float sharpen;
varying vec2 vUv;
float lum(vec3 c){return dot(c,vec3(.2126,.7152,.0722));}
// Cheap static hash: two reads make a triangular distribution, which dithers
// banding without the visible cross-hatch of an ordered pattern.
float finishHash(vec2 p){return fract(sin(dot(p,vec2(12.9898,78.233)))*43758.5453123);}
void main(){
  vec3 c=texture2D(tDiffuse,vUv).rgb;
  if(sharpen>0.){
    vec2 px=1./resolution;
    vec3 n=texture2D(tDiffuse,vUv+vec2(0.,px.y)).rgb;
    vec3 s=texture2D(tDiffuse,vUv-vec2(0.,px.y)).rgb;
    vec3 e=texture2D(tDiffuse,vUv+vec2(px.x,0.)).rgb;
    vec3 w=texture2D(tDiffuse,vUv-vec2(px.x,0.)).rgb;
    vec3 detail=c-(n+s+e+w)*.25;
    // High-contrast edges (HUD-like overlays, silhouettes) get less boost so
    // the filter cannot ring; flat gradients keep the full amount.
    float edge=smoothstep(.06,.5,abs(lum(detail)));
    c+=clamp(detail,-.32,.32)*sharpen*(1.-edge*.85);
  }
  if(dither>0.){
    vec2 p=gl_FragCoord.xy;
    float a=finishHash(p)-.5,b=finishHash(p+vec2(19.19,7.7))-.5;
    c+=(a+b)*dither*.0078;
  }
  gl_FragColor=vec4(clamp(c,0.,1.),1.);
}`;

export class FinishPass extends ShaderPass {
  constructor(){
    super({
      name:'Finish',
      uniforms:{tDiffuse:{value:null},resolution:{value:new Vector2(1,1)},dither:{value:1},sharpen:{value:.3}},
      vertexShader,
      fragmentShader,
    });
    this.name='finish';
    // The pass writes display-referred pixels; OutputPass already converted.
    this.material.toneMapped=false;
  }
  // dither/sharpen are 0..1; non-finite values fall back to the current setting
  // so a bad caller cannot disable the pass or inject shader values.
  configure({dither,sharpen}={},width,height){
    const u=this.uniforms;
    u.resolution.value.set(Math.max(1,width),Math.max(1,height));
    if(Number.isFinite(dither))u.dither.value=Math.min(1,Math.max(0,dither));
    if(Number.isFinite(sharpen))u.sharpen.value=Math.min(1,Math.max(0,sharpen));
  }
}
