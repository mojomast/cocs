import {ClampToEdgeWrapping,DataTexture,LinearFilter,NoColorSpace,RepeatWrapping,Vector2,Vector3} from 'three';
import {ShaderPass} from 'three/addons/postprocessing/ShaderPass.js';
import {GRAPHICS_EFFECTS,GRAPHICS_PALETTES,graphicsLabActive} from './graphics-lab.mjs';
import {mothEffect,mothMaterialLut,mothSurfaceOverride} from './moth-assets.mjs';

// One fused, display-referred pass AFTER OutputPass/FXAA. No additional scene
// render, depth/normal target, history buffer, clock, or shader recompilation per
// toggle. CSS-pixel patterns remain stable across DPR/dynamic-resolution changes.
const fragmentShader=/* glsl */`
uniform sampler2D tDiffuse;
uniform vec2 resolution;
uniform vec3 inkColor, midColor, paperColor;
uniform float mixAmount, splitAt, splitEnabled;
uniform float pixel, hex, glitch, chroma, glow, vignette, contrast, saturate, temperature, sharpen, solarize, toon, duotone, halftone, hatch, ink, neon, dither, crt, grain, mothgrain, mothsignal, mothcoat;
uniform sampler2D mothgrainMap, mothsignalMap, mothcoatRamp;
uniform float mothgrainMean;
uniform vec3 mothcoatMean;
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
  if(hex>0.){
    // Honeycomb cell centres: pick the nearer of the two interleaved lattices.
    vec2 hp=uv*resolution/hex;
    vec2 h=vec2(1.,1.7320508);
    vec2 ha=mod(hp,h)-h*.5;
    vec2 hb=mod(hp-h*.5,h)-h*.5;
    vec2 gv=dot(ha,ha)<dot(hb,hb)?ha:hb;
    uv=((hp-gv)*hex+hex*.5)/resolution;
  }
  if(glitch>0.){
    // Static row bands: the seed is the row index, so nothing flickers.
    float band=floor(pos.y/6.);
    float rnd=fract(sin(dot(vec2(band,7.7),vec2(12.9898,78.233)))*43758.5453);
    uv.x+=step(.7,rnd)*(fract(rnd*57.3)*2.-1.)*glitch*.04;
  }
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
  if(sharpen>0.){
    vec2 px=1./resolution;
    vec3 blur=sampleAt(uv+vec2(px.x,0.))+sampleAt(uv-vec2(px.x,0.))+sampleAt(uv+vec2(0.,px.y))+sampleAt(uv-vec2(0.,px.y));
    c+=(c-blur*.25)*sharpen;
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
  if(contrast>0.)c=(c-.5)*contrast+.5;
  if(saturate>0.){float g=lum(c);c=mix(vec3(g),c,saturate);}
  if(temperature!=0.){c.r*=1.+temperature*.16;c.g*=1.+temperature*.02;c.b*=1.-temperature*.14;}
  if(solarize>0.){
    float amount=smoothstep(solarize,1.,lum(c));
    c=mix(c,1.-c,amount*.85);
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
  if(vignette>0.){
    vec2 v=(pos/resolution-.5)*2.;
    c*=1.-vignette*smoothstep(.45,1.5,length(v));
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
  if(mothgrain>0.){
    // Two screen-space reads of the baked macro-organic tile, centred on its
    // measured mean and lifted 2.5x so the low-contrast tile reads as grain.
    vec2 gp=pos/96.;
    float ga=lum(texture2D(mothgrainMap,gp).rgb)-mothgrainMean;
    float gb=lum(texture2D(mothgrainMap,gp*.41+vec2(.31,.47)).rgb)-mothgrainMean;
    c+=(ga+gb*.6)*mothgrain*2.5;
  }
  if(mothsignal>0.){
    // One static baked effect frame, tiled with a half-tile offset on odd rows.
    // The luminance gate keeps glyphs in energetic areas; there is no playback.
    const float glyphTile=128.;
    vec2 cell=floor(pos/glyphTile);
    vec2 local=pos-cell*glyphTile+vec2(mod(cell.y,2.)*glyphTile*.5,0.);
    vec3 glyph=texture2D(mothsignalMap,fract(local/glyphTile)).rgb;
    c+=glyph*smoothstep(.38,.8,lum(c))*mothsignal*1.4;
  }
  if(mothcoat>0.){
    // A slow position-derived phase walks the baked ramp; highlights take the
    // signed tint, so the coat shifts colour without a net gain.
    vec3 ramp=texture2D(mothcoatRamp,vec2(fract(vUv.x*1.6+vUv.y*1.1),.5)).rgb-mothcoatMean;
    c*=1.+ramp*mothcoat*smoothstep(.3,.9,lum(c))*1.35;
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
        mothgrainMap:{value:null},mothsignalMap:{value:null},mothcoatRamp:{value:null},
        mothgrainMean:{value:.5},mothcoatMean:{value:new Vector3()},
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
    for(const e of GRAPHICS_EFFECTS){
      const setting=state.effects[e.id];
      let value=setting.enabled?setting.value:0;
      // A Moth accent with no baked asset is a silent no-op: force just that
      // layer to zero instead of sampling an unbound texture, and let every
      // other layer keep running. The option is always a catalogue id by the
      // time it reaches configure(); fall back to the first one for safety.
      const accent=MOTH_ACCENTS[e.id];
      if(value>0&&accent){
        const option=e.options?.find(o=>o.id===setting.option)||e.options?.[0];
        if(!option||!accent(u,option))value=0;
      }
      u[e.id].value=value;
    }
    // Palette constants are display-space values, not three.Color's linear RGB.
    const colors=GRAPHICS_PALETTES.find(p=>p.id===state.palette).colors;
    ['inkColor','midColor','paperColor'].forEach((key,i)=>{
      const hex=Number.parseInt(colors[i].slice(1),16);
      u[key].value.set(((hex>>16)&255)/255,((hex>>8)&255)/255,(hex&255)/255);
    });
  }
}

// ---- Baked Moth accents -----------------------------------------------------
// Each accent derives one small DataTexture from an asset the app already
// decoded: a 64x64 surface tile (macro-organic, dust-field, flow-field), frame 0
// of an effect sequence (arc-burst, qrc-glyphs), or a 256x1 ramp scanned out of
// an entanglement R/T LUT. They are built on the first enabled frame and cached
// at module scope under `effect:option`, so the fused pass adds no per-frame
// uploads, no render targets, and no recompiles. They are never disposed: the
// source bytes live for the session, the cache is bounded by the catalogue
// options below, and every lab pass shares the one copy.
const mothTextures=new Map();
function mothDataTexture(data,width,height,wrap){
  const texture=new DataTexture(data,width,height);
  texture.wrapS=texture.wrapT=wrap;
  texture.magFilter=texture.minFilter=LinearFilter;
  texture.colorSpace=NoColorSpace;
  texture.needsUpdate=true;
  return texture;
}
// Mean-neutral grain: the neutral is the selected tile's own mean luminance,
// measured once from its baked bytes and recomputed whenever the option changes
// (the shipped macro-organic tile reads ~0.431).
function mothGrain(option){
  const key=`mothgrain:${option.id}`,cached=mothTextures.get(key);
  if(cached)return cached;
  const source=mothSurfaceOverride(option.asset);
  if(!source?.data?.length||!(source.width>0)||!(source.height>0))return null;
  const pixels=source.width*source.height;
  let mean=0;
  for(let i=0;i<pixels;i++){
    const o=i*4;
    mean+=(.2126*source.data[o]+.7152*source.data[o+1]+.0722*source.data[o+2])/255;
  }
  const value={texture:mothDataTexture(source.data,source.width,source.height,RepeatWrapping),mean:mean/pixels};
  mothTextures.set(key,value);
  return value;
}
// The lab contract is stationary, so an effect option contributes frame 0 only.
function mothSignal(option){
  const key=`mothsignal:${option.id}`,cached=mothTextures.get(key);
  if(cached)return cached;
  const frame=mothEffect(option.asset)?.frames?.[0];
  if(!frame?.data?.length||!(frame.width>0)||!(frame.height>0))return null;
  const value={texture:mothDataTexture(frame.data,frame.width,frame.height,RepeatWrapping)};
  mothTextures.set(key,value);
  return value;
}
// A 256x1 RGBA ramp scanned row-major out of the selected LUT: R from the
// reflectance mask, G from the transmittance mask, B their mix. The measured
// per-channel mean is subtracted in the shader, so the coat stays mean-neutral
// per selected asset.
function mothCoatRamp(option){
  const key=`mothcoat:${option.id}`,cached=mothTextures.get(key);
  if(cached)return cached;
  const lut=mothMaterialLut(option.asset);
  const size=Math.floor(lut?.size)||0;
  if(!size||!lut.r?.length||!lut.t?.length||lut.r.length<size*size*3||lut.t.length<size*size*3)return null;
  const steps=256,data=new Uint8Array(steps*4),mean=new Vector3();
  for(let i=0;i<steps;i++){
    const offset=Math.min(size*size-1,Math.floor(i*size*size/steps))*3;
    const r=lut.r[offset]/255,t=lut.t[offset]/255,mix=(r+t)*.5;
    data[i*4]=Math.round(r*255);data[i*4+1]=Math.round(t*255);data[i*4+2]=Math.round(mix*255);data[i*4+3]=255;
    mean.x+=r;mean.y+=t;mean.z+=mix;
  }
  const value={texture:mothDataTexture(data,steps,1,ClampToEdgeWrapping),mean:mean.divideScalar(steps)};
  mothTextures.set(key,value);
  return value;
}
// One resolver per Moth layer: bind the texture for the chosen option when the
// bake is present, or report false so configure() zeroes only that layer.
const MOTH_ACCENTS={
  mothgrain(u,option){const grain=mothGrain(option);if(!grain)return false;u.mothgrainMap.value=grain.texture;u.mothgrainMean.value=grain.mean;return true;},
  mothsignal(u,option){const signal=mothSignal(option);if(!signal)return false;u.mothsignalMap.value=signal.texture;return true;},
  mothcoat(u,option){const coat=mothCoatRamp(option);if(!coat)return false;u.mothcoatRamp.value=coat.texture;u.mothcoatMean.value.copy(coat.mean);return true;},
};
