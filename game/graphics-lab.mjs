// Preview-only presentation recipes. No simulation state or dependencies.
export const GRAPHICS_LAB_KEY = 'token-arena-graphics-lab-v1';
export const GRAPHICS_LAB_VERSION = 1;
export const GRAPHICS_EFFECTS = Object.freeze([
  {id:'pixel', name:'Pixel mosaic', label:'Block size', min:2, max:12, step:1, value:4, unit:'px', cost:'1 sample', description:'Chunky screen-space pixels; pair with dithering for a handheld look.'},
  {id:'chroma', name:'Prism split', label:'Separation', min:.5, max:6, step:.5, value:2, unit:'px', cost:'+2 samples', description:'Radial red/blue misregistration toward the edges; the aiming center stays aligned.'},
  {id:'glow', name:'Light bleed', label:'Glow', min:.1, max:1.5, step:.1, value:.6, unit:'×', cost:'+8 samples', description:'Soft local halos around bright surfaces. A compact glow, layered over the existing bloom.'},
  {id:'toon', name:'Color bands', label:'Levels', min:2, max:12, step:1, value:5, unit:'', cost:'arithmetic', description:'Posterize rendered colors into bold bands. Lower levels make a more graphic image.'},
  {id:'duotone', name:'Palette remap', label:'Palette mix', min:.1, max:1, step:.05, value:1, unit:'×', cost:'arithmetic', description:'Map luminance to the selected ink, midtone, and paper colors.'},
  {id:'halftone', name:'Print dots', label:'Dot spacing', min:3, max:12, step:1, value:6, unit:'px', cost:'arithmetic', description:'Antialiased halftone ink dots grow in shadow, like a printed comic.'},
  {id:'hatch', name:'Crosshatch', label:'Ink density', min:.1, max:1, step:.05, value:.65, unit:'×', cost:'arithmetic', description:'Diagonal pencil strokes layer up in darker regions.'},
  {id:'ink', name:'Ink contours', label:'Line strength', min:.1, max:1.5, step:.1, value:.9, unit:'×', cost:'+8 shared samples', description:'Sobel contrast outlines pick up silhouettes and texture edges; this is not a depth outline.'},
  {id:'neon', name:'Neon contours', label:'Emission', min:.1, max:1.5, step:.1, value:1, unit:'×', cost:'shares ink samples', description:'Darken surfaces and trace contrast edges with luminous palette colors.'},
  {id:'dither', name:'Ordered dither', label:'Color levels', min:2, max:8, step:1, value:3, unit:'', cost:'arithmetic', description:'A stable 4×4 Bayer pattern trades smooth gradients for a retro texture.'},
  {id:'crt', name:'Phosphor screen', label:'Screen texture', min:.1, max:1, step:.05, value:.45, unit:'×', cost:'arithmetic', description:'Static scanlines and an RGB grille. No screen bend, flashing, or camera distortion.'},
  {id:'grain', name:'Paper grain', label:'Texture', min:.05, max:.5, step:.025, value:.15, unit:'×', cost:'arithmetic', description:'Fine stationary grain gives flat areas a tactile finish without temporal shimmer.'},
].map(effect=>Object.freeze(effect)));
export const GRAPHICS_PALETTES = Object.freeze([
  {id:'circuit', name:'Circuit · violet / coral / mint', colors:['#160f32','#e87583','#c2ffe0']},
  {id:'electric', name:'Electric · midnight / cyan / ice', colors:['#04091f','#06bcca','#e0fcff']},
  {id:'paper', name:'Paper · graphite / ochre / ivory', colors:['#24202b','#a89173','#f5e5c6']},
  {id:'pocket', name:'Pocket · pine / moss / lime', colors:['#102b2a','#65834a','#dcf3a0']},
  {id:'ember', name:'Ember · plum / vermilion / gold', colors:['#1e112c','#ec643e','#ffe2a4']},
].map(p=>Object.freeze({...p,colors:Object.freeze(p.colors)})));
export const GRAPHICS_RECIPES = Object.freeze([
  {id:'circuit-print', name:'Circuit Print', palette:'circuit', description:'An electric comic book. My first pick for a distinctive COCS identity.', effects:{toon:5,duotone:.65,halftone:6,ink:.8,grain:.075}},
  {id:'neon-cathedral', name:'Neon Cathedral', palette:'electric', description:'A luminous schematic carved out of darkness.', effects:{neon:1.1,glow:.8,chroma:1.5}},
  {id:'pocket-arena', name:'Pocket Arena', palette:'pocket', description:'A lost handheld shooter with chunky pixels and a four-tone spirit.', effects:{pixel:4,duotone:1,dither:3}},
  {id:'field-sketch', name:'Field Sketch', palette:'paper', description:'A moving field notebook: warm stock, pencil shading, and ink contours.', effects:{duotone:1,hatch:.7,ink:.7,grain:.125}},
  {id:'ghost-signal', name:'Ghost Signal', palette:'electric', description:'A surveillance feed from an abandoned future.', effects:{duotone:.85,crt:.5,chroma:2,grain:.1}},
  {id:'ember-press', name:'Ember Press', palette:'ember', description:'A sunburned science-fiction paperback cover.', effects:{toon:4,duotone:.85,halftone:8,ink:.6,glow:.4}},
].map(p=>Object.freeze({...p,effects:Object.freeze(p.effects)})));

const clamp=(v,min,max,fallback)=>typeof v==='number'&&Number.isFinite(v)?Math.min(max,Math.max(min,v)):fallback;
export function normalizeGraphicsLab(input={}) {
  const s=input&&typeof input==='object'&&input.version===GRAPHICS_LAB_VERSION?input:{};
  return {
    version:GRAPHICS_LAB_VERSION, enabled:s.enabled===true, bypass:s.bypass===true,
    mix:clamp(s.mix,0,1,1), split:s.split===true, splitAt:clamp(s.splitAt,.1,.9,.5),
    palette:GRAPHICS_PALETTES.some(p=>p.id===s.palette)?s.palette:'circuit',
    effects:Object.fromEntries(GRAPHICS_EFFECTS.map(e=>[e.id,{
      enabled:s.effects?.[e.id]?.enabled===true,
      value:clamp(s.effects?.[e.id]?.value,e.min,e.max,e.value),
    }])),
  };
}
export function graphicsRecipe(id) {
  const recipe=GRAPHICS_RECIPES.find(p=>p.id===id);
  const state=normalizeGraphicsLab();
  if(!recipe)return state;
  state.enabled=true;state.palette=recipe.palette;
  for(const [id,value] of Object.entries(recipe.effects))state.effects[id]={enabled:true,value};
  return state;
}
export function graphicsLabActive(state) {
  return state?.enabled===true&&state.bypass!==true&&state.mix>0&&GRAPHICS_EFFECTS.some(e=>state.effects?.[e.id]?.enabled);
}
export function serializeGraphicsLab(state) {
  // Compare controls are transient; exported recipes always show their effect.
  return JSON.stringify({...normalizeGraphicsLab(state),bypass:false,split:false},null,2);
}
