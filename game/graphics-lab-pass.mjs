import {Vector2,Vector3} from 'three';
import {ShaderPass} from 'three/addons/postprocessing/ShaderPass.js';
import {GRAPHICS_EFFECTS,GRAPHICS_PALETTES,graphicsLabActive} from './graphics-lab.mjs';

// One fused, display-referred pass AFTER OutputPass/FXAA. No additional scene
// render, depth/normal target, history buffer, clock, or shader recompilation per
// toggle. CSS-pixel patterns remain stable across DPR/dynamic-resolution changes.
const fragmentShader=/* glsl */`
uniform sampler2D tDiffuse;
uniform vec2 resolution;
uniform vec3 inkColor, midColor, paperColor;
uniform float mixAmount, splitAt, splitEnabled;
uniform float pixel, chroma, glow, toon, duotone, halftone, hatch, ink, neon, dither, crt, grain;
varying vec2 vUv;
float lum(vec3 c){return dot(c,vec3(.2126,.7152,.0722));}
vec3 sampleAt(vec2 uv){return texture2D(tDiffuse,clamp(uv,vec2(0.),vec2(1.))).rgb;}
float bayer2(vec2 p){p=mod(floor(p),2.);return 2.*p.x+3.*p.y-4.*p.x*p.y;}
float bayer4(vec2 p){return (4.*bayer2(p)+bayer2(floor(p/2.))+.5)/16.-.5;}
float linePattern(float p){float d=abs(fract(p)-.5);float a=max(fwidth(p),.025);return 1.-smoothstep(.10,.10+a,d);}
void main(){
  vec3 original=sampleAt(vUv);
  vec2 pos=vUv*resolution;
  vec2 uv=vUv;
  if(pixel>0.)uv=(floor(pos/pixel)+.5)*pixel/resolution;
  vec3 c=sampleAt(uv);
  if(chroma>0.){
    vec2 radial=(vUv-.5)*2.;
    vec2 shift=radial*dot(radial,radial)*chroma/resolution;
    c.r=sampleAt(uv+shift).r;c.b=sampleAt(uv-shift).b;
  }
  if(glow>0.){
    vec3 halo=vec3(0.);
    for(int i=0;i<8;i++){
      float a=float(i)*.785398;
      vec3 tap=sampleAt(uv+vec2(cos(a),sin(a))*5./resolution);
      halo+=tap*smoothstep(.55,1.,lum(tap));
    }
    c+=halo*(glow/8.);
  }
  float edge=0.;
  if(ink>0.||neon>0.){
    vec2 d=vec2(max(1.,pixel))/resolution;
    float tl=lum(sampleAt(uv+vec2(-d.x,d.y))),tc=lum(sampleAt(uv+vec2(0.,d.y))),tr=lum(sampleAt(uv+d));
    float ml=lum(sampleAt(uv+vec2(-d.x,0.))),mr=lum(sampleAt(uv+vec2(d.x,0.)));
    float bl=lum(sampleAt(uv-d)),bc=lum(sampleAt(uv+vec2(0.,-d.y))),br=lum(sampleAt(uv+vec2(d.x,-d.y)));
    float gx=-tl-2.*ml-bl+tr+2.*mr+br,gy=tl+2.*tc+tr-bl-2.*bc-br;
    edge=smoothstep(.13,.65,length(vec2(gx,gy)));
  }
  if(toon>0.)c=floor(clamp(c,0.,1.)*(toon-1.)+.5)/(toon-1.);
  if(duotone>0.){
    float l=clamp(lum(c),0.,1.);
    vec3 mapped=mix(inkColor,midColor,smoothstep(0.,.55,l));
    mapped=mix(mapped,paperColor,smoothstep(.45,1.,l));
    c=mix(c,mapped,duotone);
  }
  if(halftone>0.){
    vec2 grid=mat2(.866,-.5,.5,.866)*pos/halftone;
    float radius=sqrt(clamp(1.-lum(c),0.,1.))*.61;
    float dist=length(fract(grid)-.5),aa=max(fwidth(dist),.025);
    float dots=1.-smoothstep(radius-aa,radius+aa,dist);
    c=mix(c*.92+paperColor*.08,c*.32+inkColor*.12,dots*.7);
  }
  if(hatch>0.){
    float shadow=1.-clamp(lum(c),0.,1.);
    float strokes=linePattern((pos.x+pos.y)/7.)*smoothstep(.15,.65,shadow);
    strokes=max(strokes,linePattern((pos.x-pos.y)/7.)*smoothstep(.5,.95,shadow));
    c=mix(c,inkColor,strokes*hatch*.85);
  }
  if(ink>0.)c=mix(c,inkColor,clamp(edge*ink,0.,1.));
  if(neon>0.){
    vec3 trace=mix(midColor,paperColor,clamp(lum(c),0.,1.));
    c=mix(c,c*.12+trace*edge*1.6,clamp(neon,0.,1.));
    c+=trace*edge*max(0.,neon-1.);
  }
  if(dither>0.){
    vec2 cell=floor(pos/max(pixel,2.));
    c=floor(clamp(c+bayer4(cell)/(dither-1.),0.,1.)*(dither-1.)+.5)/(dither-1.);
  }
  if(crt>0.){
    float scan=.5+.5*cos(pos.y*3.141593);
    vec3 grille=.82+.18*cos(pos.x*2.094395+vec3(0.,2.094395,4.188790));
    c*=mix(vec3(1.),grille*(1.-.3*scan),crt);
  }
  if(grain>0.){
    float noise=fract(sin(dot(floor(pos),vec2(12.9898,78.233)))*43758.5453)-.5;
    c+=noise*grain;
  }
  c=mix(original,clamp(c,0.,1.),mixAmount);
  if(splitEnabled>.5){
    if(vUv.x<splitAt)c=original;
    if(abs(pos.x-resolution.x*splitAt)<1.)c=vec3(.45,1.,.82);
  }
  gl_FragColor=vec4(c,1.);
}`;

export class GraphicsLabPass extends ShaderPass {
  constructor(){
    super({
      name:'GraphicsLab',
      uniforms:{tDiffuse:{value:null},resolution:{value:new Vector2(1,1)},mixAmount:{value:1},splitAt:{value:.5},splitEnabled:{value:0},
        inkColor:{value:new Vector3()},midColor:{value:new Vector3()},paperColor:{value:new Vector3()},
        ...Object.fromEntries(GRAPHICS_EFFECTS.map(e=>[e.id,{value:0}]))},
      vertexShader:'varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
      fragmentShader,
    });
    this.name='graphics-lab';
    this.material.toneMapped=false;
  }
  configure(state,width,height){
    this.enabled=graphicsLabActive(state);
    const u=this.uniforms;
    u.resolution.value.set(Math.max(1,width),Math.max(1,height));
    u.mixAmount.value=state.mix;u.splitEnabled.value=state.split?1:0;u.splitAt.value=state.splitAt;
    for(const e of GRAPHICS_EFFECTS)u[e.id].value=state.effects[e.id].enabled?state.effects[e.id].value:0;
    // Palette constants are display-space values, not three.Color's linear RGB.
    const colors=GRAPHICS_PALETTES.find(p=>p.id===state.palette).colors;
    ['inkColor','midColor','paperColor'].forEach((key,i)=>{
      const hex=Number.parseInt(colors[i].slice(1),16);
      u[key].value.set(((hex>>16)&255)/255,((hex>>8)&255)/255,(hex&255)/255);
    });
  }
}
