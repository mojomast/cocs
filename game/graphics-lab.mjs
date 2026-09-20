// Preview-only presentation recipes. No simulation state or dependencies.
export const GRAPHICS_LAB_KEY = 'token-arena-graphics-lab-v1';
export const GRAPHICS_LAB_VERSION = 1;
// Physical codes, not printed keys, so the shortcut survives layout changes.
export const GRAPHICS_LAB_HOTKEY = 'Backquote';
export const GRAPHICS_LAB_HOTKEY_LABEL = '`';
// Styling targets a graphics-lab state can stack independently. `world` keeps
// the original top-level fields; `weapon` and `bots` live under `targets`.
/** @typedef {'world'|'weapon'|'bots'} GraphicsLabTargetId */
/** @type {readonly GraphicsLabTargetId[]} */
export const GRAPHICS_LAB_TARGETS = Object.freeze(['world','weapon','bots']);
// A baked asset a layer can choose at runtime. `asset` is the registry key read
// through moth-assets.mjs; `kind` picks the resolver in the fused pass.
const assetOption=(id,label,kind,asset=id)=>Object.freeze({id,label,asset,kind});
export const GRAPHICS_EFFECTS = Object.freeze([
  {id:'pixel', name:'Pixel mosaic', label:'Block size', min:2, max:12, step:1, value:4, unit:'px', cost:'1 sample', description:'Chunky screen-space pixels; pair with dithering for a handheld look.'},
  {id:'hex', name:'Hex mosaic', label:'Cell size', min:3, max:14, step:1, value:7, unit:'px', cost:'1 sample', description:'Honeycomb cells instead of squares; a rounder handheld mosaic.'},
  {id:'glitch', name:'Row glitch', label:'Displacement', min:.05, max:1, step:.05, value:.35, unit:'×', cost:'arithmetic', description:'Static horizontal band displacement, seeded by the row. No time-based flicker or strobing.'},
  {id:'chroma', name:'Prism split', label:'Separation', min:.5, max:6, step:.5, value:2, unit:'px', cost:'+2 samples', description:'Radial red/blue misregistration toward the edges; the aiming center stays aligned.'},
  {id:'glow', name:'Light bleed', label:'Glow', min:.1, max:1.5, step:.1, value:.6, unit:'×', cost:'+8 samples', description:'Soft local halos around bright surfaces. A compact glow, layered over the existing bloom.'},
  {id:'vignette', name:'Vignette', label:'Corner falloff', min:.1, max:1, step:.05, value:.5, unit:'×', cost:'arithmetic', description:'Darken the corners, like a viewed screen or a printed page.'},
  {id:'contrast', name:'Contrast', label:'Punch', min:.5, max:2, step:.05, value:1.15, unit:'×', cost:'arithmetic', description:'An S-curve around mid grey; adds punch before the print layers.'},
  {id:'saturate', name:'Saturation', label:'Color', min:.25, max:2, step:.05, value:1.15, unit:'×', cost:'arithmetic', description:'Boost color without changing brightness. Drain fully with a palette remap.'},
  {id:'temperature', name:'White balance', label:'Warm ↔ cool', min:-1, max:1, step:.05, value:0, unit:'', cost:'arithmetic', description:'Shift toward amber (right) or ice (left); the middle is neutral.'},
  {id:'sharpen', name:'Sharpen', label:'Detail', min:.1, max:1.5, step:.05, value:.6, unit:'×', cost:'+4 samples', description:'Unsharp mask that lifts edges without another full pass.'},
  {id:'solarize', name:'Solarize', label:'Threshold', min:.3, max:.95, step:.05, value:.65, unit:'', cost:'arithmetic', description:'Invert highlights above the threshold for a screen-print exposure look.'},
  {id:'toon', name:'Color bands', label:'Levels', min:2, max:12, step:1, value:5, unit:'', cost:'arithmetic', description:'Posterize rendered colors into bold bands. Lower levels make a more graphic image.'},
  {id:'duotone', name:'Palette remap', label:'Palette mix', min:.1, max:1, step:.05, value:1, unit:'×', cost:'arithmetic', description:'Map luminance to the selected ink, midtone, and paper colors.'},
  {id:'halftone', name:'Print dots', label:'Dot spacing', min:3, max:12, step:1, value:6, unit:'px', cost:'arithmetic', description:'Antialiased halftone ink dots grow in shadow, like a printed comic.'},
  {id:'hatch', name:'Crosshatch', label:'Ink density', min:.1, max:1, step:.05, value:.65, unit:'×', cost:'arithmetic', description:'Diagonal pencil strokes layer up in darker regions.'},
  {id:'ink', name:'Ink contours', label:'Line strength', min:.1, max:1.5, step:.1, value:.9, unit:'×', cost:'+8 shared samples', description:'Sobel contrast outlines pick up silhouettes and texture edges; this is not a depth outline.'},
  {id:'neon', name:'Neon contours', label:'Emission', min:.1, max:1.5, step:.1, value:1, unit:'×', cost:'shares ink samples', description:'Darken surfaces and trace contrast edges with luminous palette colors.'},
  {id:'dither', name:'Ordered dither', label:'Color levels', min:2, max:8, step:1, value:3, unit:'', cost:'arithmetic', description:'A stable 4×4 Bayer pattern trades smooth gradients for a retro texture.'},
  {id:'crt', name:'Phosphor screen', label:'Screen texture', min:.1, max:1, step:.05, value:.45, unit:'×', cost:'arithmetic', description:'Static scanlines and an RGB grille. No screen bend, flashing, or camera distortion.'},
  {id:'grain', name:'Paper grain', label:'Texture', min:.05, max:.5, step:.025, value:.15, unit:'×', cost:'arithmetic', description:'Fine stationary grain gives flat areas a tactile finish without temporal shimmer.'},
  {id:'mothgrain', name:'Moth grain', assetLabel:'Moth grain asset', label:'Texture', min:.05, max:.5, step:.025, value:.15, unit:'×', cost:'2 samples · baked Moth tile', description:'A baked Moth surface tile read at two screen-space scales as a mean-neutral print field. Static; no clock.', options:Object.freeze([
    assetOption('macro-organic','Macro organic','surface'),
    assetOption('dust-field','Dust field','surface'),
    assetOption('flow-field','Flow field','surface'),
  ])},
  {id:'mothsignal', name:'Signal glyphs', assetLabel:'Moth signal asset', label:'Glyph strength', min:.1, max:1, step:.05, value:.5, unit:'×', cost:'1 sample · baked Moth effect frame', description:'One baked Moth effect frame stamped in a tiled, row-offset pattern and gated to bright areas. Static frame only; reduced-motion safe.', options:Object.freeze([
    assetOption('arc-burst','Arc burst','effect'),
    assetOption('qrc-glyphs','QRC glyphs','effect'),
  ])},
  {id:'mothcoat', name:'Spectral coat', assetLabel:'Moth coat asset', label:'Coat strength', min:.1, max:1, step:.05, value:.5, unit:'×', cost:'1 sample · baked Moth LUT ramp', description:'Highlights take a mean-neutral iridescent tint from a ramp scanned out of a baked Moth entanglement R/T LUT. Static position-derived phase.', options:Object.freeze([
    assetOption('entanglement','Entanglement','lut'),
    assetOption('entanglement-arcane','Entanglement arcane','lut'),
    assetOption('entanglement-ember','Entanglement ember','lut'),
    assetOption('entanglement-ceramic','Entanglement ceramic','lut'),
    assetOption('entanglement-void','Entanglement void','lut'),
  ])},
].map(effect=>Object.freeze(effect)));
export const GRAPHICS_PALETTES = Object.freeze([
  {id:'circuit', name:'Circuit · violet / coral / mint', colors:['#160f32','#e87583','#c2ffe0']},
  {id:'electric', name:'Electric · midnight / cyan / ice', colors:['#04091f','#06bcca','#e0fcff']},
  {id:'paper', name:'Paper · graphite / ochre / ivory', colors:['#24202b','#a89173','#f5e5c6']},
  {id:'pocket', name:'Pocket · pine / moss / lime', colors:['#102b2a','#65834a','#dcf3a0']},
  {id:'ember', name:'Ember · plum / vermilion / gold', colors:['#1e112c','#ec643e','#ffe2a4']},
  {id:'blueprint', name:'Blueprint · navy / steel / white', colors:['#08172e','#5f93c9','#eaf4ff']},
  {id:'infrared', name:'Infrared · black / magenta / amber', colors:['#140a18','#ff3d81','#ffd166']},
  {id:'sodium', name:'Sodium · black / amber / parchment', colors:['#100d08','#e8a13c','#ffeccc']},
].map(p=>Object.freeze({...p,colors:Object.freeze(p.colors)})));
export const GRAPHICS_RECIPES = Object.freeze([
  {id:'circuit-print', name:'Circuit Print', palette:'circuit', description:'An electric comic book. My first pick for a distinctive COCS identity.', effects:{toon:5,duotone:.65,halftone:6,ink:.8,grain:.075}},
  {id:'neon-cathedral', name:'Neon Cathedral', palette:'electric', description:'A luminous schematic carved out of darkness.', effects:{neon:1.1,glow:.8,chroma:1.5}},
  {id:'pocket-arena', name:'Pocket Arena', palette:'pocket', description:'A lost handheld shooter with chunky pixels and a four-tone spirit.', effects:{pixel:4,duotone:1,dither:3}},
  {id:'field-sketch', name:'Field Sketch', palette:'paper', description:'A moving field notebook: warm stock, pencil shading, and ink contours.', effects:{duotone:1,hatch:.7,ink:.7,grain:.125}},
  {id:'ghost-signal', name:'Ghost Signal', palette:'electric', description:'A surveillance feed from an abandoned future.', effects:{duotone:.85,crt:.5,chroma:2,grain:.1}},
  {id:'ember-press', name:'Ember Press', palette:'ember', description:'A sunburned science-fiction paperback cover.', effects:{toon:4,duotone:.85,halftone:8,ink:.6,glow:.4}},
  {id:'blueprint', name:'Blueprint', palette:'blueprint', description:'A drafting-table technical readout: navy field, steel lines, white annotations.', effects:{duotone:1,ink:1,sharpen:.8,vignette:.5,grain:.06}},
  {id:'thermal', name:'Thermal', palette:'infrared', description:'A thermal recon image: hot edges, cold shadows, video gain.', effects:{duotone:.9,glow:1.1,solarize:.7,saturate:1.3,temperature:.3,grain:.12}},
  {id:'moth-print', name:'Moth Print', palette:'electric', description:'A pressed quantum plate: baked Moth grain, signal glyphs, and a spectral highlight coat over electric ink.', effects:{duotone:.85,vignette:.45,mothgrain:.2,mothsignal:.5,mothcoat:.6}},
  {id:'pocket-ink', name:'Pocket Ink', palette:'pocket', description:'Your saved roll: chunky mint pixels, ink contours and a faint coat at a 3/4 mix.', mix:0.7353712838244059, effects:{pixel:3,vignette:.5,contrast:1.2,saturate:2,temperature:0,duotone:.15,ink:.9,mothcoat:{value:1,option:'entanglement'}}},
  {id:'ghost-rivals', name:'Ghost Rivals', palette:'electric', description:'Ghost-signal world, neon rivals, crisp weapon: a demo of per-target stacks.', effects:{duotone:.85,crt:.5,chroma:2,grain:.1}, targets:{bots:{enabled:true,palette:'ember',effects:{neon:1.1,glow:.7,chroma:1.2}}}},
].map(p=>Object.freeze({...p,effects:Object.freeze(p.effects),...(p.targets?{targets:Object.freeze(p.targets)}:{})})));

const clamp=(v,min,max,fallback)=>typeof v==='number'&&Number.isFinite(v)?Math.min(max,Math.max(min,v)):fallback;
const isRecord=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const validPalette=id=>GRAPHICS_PALETTES.some(p=>p.id===id)?id:'circuit';
// One catalogue-shaped effect table; unknown ids are dropped and every slider
// is clamped. Optioned layers keep a valid catalogue id, falling back to the
// entry's default asset for older saves and unknown ids.
function normalizeGraphicsEffects(raw){
  const s=isRecord(raw)?raw:{};
  return Object.fromEntries(GRAPHICS_EFFECTS.map(e=>{
    const setting=s[e.id];
    return [e.id,{
      enabled:setting?.enabled===true,
      value:clamp(setting?.value,e.min,e.max,e.value),
      ...(e.options?.length?{option:e.options.some(o=>o.id===setting?.option)?setting.option:e.options[0].id}:{}),
    }];
  }));
}
// A per-target stack carries everything the world has except bypass/split: its
// own master, mix, palette and effect table. Always returns a fresh object.
export function normalizeGraphicsLabTarget(input){
  const s=isRecord(input)?input:{};
  return {
    enabled:s.enabled===true,
    mix:clamp(s.mix,0,1,1),
    palette:validPalette(s.palette),
    effects:normalizeGraphicsEffects(s.effects),
  };
}
export function normalizeGraphicsLab(input={}) {
  const s=isRecord(input)&&input.version===GRAPHICS_LAB_VERSION?input:{};
  return {
    version:GRAPHICS_LAB_VERSION, enabled:s.enabled===true, bypass:s.bypass===true,
    mix:clamp(s.mix,0,1,1), split:s.split===true, splitAt:clamp(s.splitAt,.1,.9,.5),
    palette:validPalette(s.palette),
    effects:normalizeGraphicsEffects(s.effects),
    // v1 saves without targets hydrate to two all-off stacks; injected target
    // keys are dropped exactly like injected effect ids.
    targets:{
      weapon:normalizeGraphicsLabTarget(s.targets?.weapon),
      bots:normalizeGraphicsLabTarget(s.targets?.bots),
    },
  };
}
// True when a target would contribute any styling: master on, mix above zero
// and at least one layer enabled. Pure and tolerant of malformed input.
export function graphicsLabTargetActive(target){
  return target?.enabled===true&&target.mix>0&&GRAPHICS_EFFECTS.some(e=>target.effects?.[e.id]?.enabled===true);
}
// Recipe effect entries are either the original numeric shorthand or an object
// with an explicit option; both enable the layer.
function applyRecipeEffects(settings,raw){
  if(!isRecord(raw))return;
  for(const [id,entry] of Object.entries(raw)){
    if(!settings[id])continue;
    if(typeof entry==='number'){settings[id]={...settings[id],enabled:true,value:entry};continue;}
    if(!isRecord(entry))continue;
    settings[id]={
      ...settings[id],
      enabled:entry.enabled!==false,
      ...(entry.value!==undefined?{value:entry.value}:{}),
      ...(entry.option!==undefined?{option:entry.option}:{}),
    };
  }
}
export function graphicsRecipe(id) {
  const recipe=GRAPHICS_RECIPES.find(p=>p.id===id);
  const state=normalizeGraphicsLab();
  if(!recipe)return state;
  state.enabled=true;state.palette=recipe.palette;
  if(typeof recipe.mix==='number')state.mix=recipe.mix;
  applyRecipeEffects(state.effects,recipe.effects);
  if(isRecord(recipe.targets)){
    for(const targetId of ['weapon','bots']){
      const partial=recipe.targets[targetId];
      if(!isRecord(partial))continue;
      const effects={...state.targets[targetId].effects};
      applyRecipeEffects(effects,partial.effects);
      state.targets[targetId]=normalizeGraphicsLabTarget({...state.targets[targetId],...partial,effects});
    }
  }
  return state;
}
export function graphicsLabActive(state) {
  return state?.enabled===true&&state.bypass!==true&&state.mix>0&&GRAPHICS_EFFECTS.some(e=>state.effects?.[e.id]?.enabled);
}
export function serializeGraphicsLab(state) {
  // Compare controls are transient; exported recipes always show their effect.
  return JSON.stringify({...normalizeGraphicsLab(state),bypass:false,split:false},null,2);
}
// One short human line for the in-game hotkey notice and status copy.
export function describeGraphicsLab(state) {
  const s=normalizeGraphicsLab(state);
  if(!s.enabled)return 'Graphics lab off';
  const layers=GRAPHICS_EFFECTS.filter(e=>s.effects[e.id].enabled).length;
  const palette=(GRAPHICS_PALETTES.find(p=>p.id===s.palette)?.name||'Palette').split(' · ')[0];
  return layers>0?`Graphics lab · ${layers} layer${layers===1?'':'s'} · ${palette}`:'Graphics lab on · no layers yet';
}
// Server-independent toy RNG so rolls are testable; callers pass Math.random.
function graphicsUnit(random){
  const value=Number(typeof random==='function'?random():0);
  return Number.isFinite(value)?Math.min(.999999,Math.max(0,value)):0;
}
function snapToStep(effect,value){
  const step=Number(effect.step)>0?Number(effect.step):1;
  const snapped=Math.round(value/step)*step;
  return Math.min(effect.max,Math.max(effect.min,Number(snapped.toFixed(4))));
}
// A "Surprise me" roll: sometimes a jittered starting recipe, sometimes a fresh
// freeform stack. Every result is a valid, enabled, independently editable mix.
export function randomGraphicsLab(random=Math.random) {
  const state=normalizeGraphicsLab();
  state.enabled=true;state.bypass=false;state.split=false;
  const roll=()=>graphicsUnit(random);
  // Enabled optioned layers may roll another catalogue asset; only valid ids win.
  const rollOptions=effects=>{
    for(const e of GRAPHICS_EFFECTS){
      if(!e.options?.length||!effects[e.id].enabled)continue;
      if(roll()<.5)effects[e.id].option=e.options[Math.floor(roll()*e.options.length)].id;
    }
  };
  if(roll()<.45){
    const recipe=GRAPHICS_RECIPES[Math.min(GRAPHICS_RECIPES.length-1,Math.floor(roll()*GRAPHICS_RECIPES.length))];
    const built=graphicsRecipe(recipe.id);
    if(roll()<.4)built.palette=GRAPHICS_PALETTES[Math.floor(roll()*GRAPHICS_PALETTES.length)].id;
    for(const e of GRAPHICS_EFFECTS){
      const setting=built.effects[e.id];
      if(!setting.enabled)continue;
      setting.value=snapToStep(e,setting.value+(roll()*2-1)*.12*(e.max-e.min));
    }
    rollOptions(built.effects);
    built.mix=.75+roll()*.25;
    // Rolls stay world-only so a surprise never silently styles the weapon or
    // the bots; target stacks are opt-in through the drawer's target controls.
    built.targets=normalizeGraphicsLab().targets;
    return normalizeGraphicsLab(built);
  }
  state.palette=GRAPHICS_PALETTES[Math.floor(roll()*GRAPHICS_PALETTES.length)].id;
  const pool=[...GRAPHICS_EFFECTS],picked=2+Math.floor(roll()*4);
  for(let i=0;i<picked&&pool.length;i++){
    const e=pool.splice(Math.floor(roll()*pool.length),1)[0];
    state.effects[e.id]={...state.effects[e.id],enabled:true,value:snapToStep(e,e.min+(e.max-e.min)*(.18+roll()*.64))};
  }
  rollOptions(state.effects);
  state.mix=.7+roll()*.3;
  return normalizeGraphicsLab(state);
}
