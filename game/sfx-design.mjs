// Pure sound design data and deterministic helpers for the gameplay synth in
// game/feedback.mjs. Everything here is original procedural design: surface
// profiles for footsteps and bullet impacts, per-family report tails and a
// bounded hash used for per-shot variation. No assets, no audio nodes, no
// dependencies, no randomness — the same seed always resolves the same values
// so tests and replays hear identical synthesis.

// Canonical surface families. Arena terrain and platform materials use a small,
// drifting vocabulary, so aliases normalise everything the maps actually author.
export const SURFACE_KINDS=Object.freeze(['default','concrete','metal','grass','sand','gravel','wood','snow','stone','dirt','water']);

const SURFACE_ALIASES=Object.freeze({
 metal:'metal',steel:'metal',iron:'metal',alloy:'metal',grate:'metal',grating:'metal',mesh:'metal',
 'diamond_plate':'metal','diamond-plate':'metal',diamondplate:'metal','corrugated_metal':'metal',
 'hazard_stripes':'metal','industrial_mesh':'metal','riveted_armour':'metal','riveted-armour':'metal',
 concrete:'concrete',tarmac:'concrete',asphalt:'concrete',road:'concrete',pad:'concrete',slab:'concrete',cement:'concrete',
 grass:'grass',turf:'grass',meadow:'grass',moss:'grass',forest:'grass',vegetation:'grass',scrub:'grass',
 sand:'sand',beach:'sand',dune:'sand',
 gravel:'gravel',rubble:'gravel',debris:'gravel',shale:'gravel',scree:'gravel',
 wood:'wood',timber:'wood',plank:'wood',deck:'wood',boardwalk:'wood',
 snow:'snow',ice:'snow',frost:'snow',frozen:'snow',glacier:'snow',
 stone:'stone',rock:'stone',cliff:'stone',granite:'stone',basalt:'stone',marble:'stone',
 dirt:'dirt',mud:'dirt',soil:'dirt',earth:'dirt',ground:'dirt',
 water:'water',puddle:'water',wet:'water',shallow:'water',stream:'water',
});

// Resolve any authored material string to a canonical surface family. Unknown or
// missing material falls back to 'default', whose profiles reproduce the
// pre-phase-2 footstep/landing numbers exactly.
export function surfaceKind(surface){
 if(typeof surface!=='string')return 'default';
 const key=surface.trim().toLowerCase();
 if(SURFACE_ALIASES[key])return SURFACE_ALIASES[key];
 return FOOTSTEP_SURFACES[key]?key:'default';
}

const step=(bright,body,gain,q,ring=0,extra=null)=>Object.freeze({bright,body,gain,q,ring,...(extra||{})});

// Footstep / landing profiles. `bright` scales the noise band, `body` scales the
// thump tone, `ring` adds a metallic/short resonance, `scatter` adds debris
// ticks and `splash` adds a wet burst. default's values are the phase-1 numbers.
export const FOOTSTEP_SURFACES=Object.freeze({
 default:step(1,1,1,1),
 concrete:step(1.05,.95,1,.85),
 metal:step(1.9,1.5,1.05,1.75,2400),
 grass:step(.62,.55,.8,.6),
 sand:step(.5,.4,.72,.5),
 gravel:step(1.5,.7,.95,1.1,0,{scatter:3}),
 wood:step(.85,1.2,.95,1.4,760),
 snow:step(.42,.32,.7,.45),
 water:step(.88,.5,.9,.5,0,{splash:1}),
 stone:step(1.25,1.05,1,1.1),
 dirt:step(.62,.65,.85,.7),
});

export function footstepProfile(surface){
 return FOOTSTEP_SURFACES[surfaceKind(surface)]||FOOTSTEP_SURFACES.default;
}

// Bullet impact / ricochet profiles. `type`/`freq`/`q` shape the transient,
// `tone`/`end` the material tick, `ring` a ricochet whine and `debris` the
// number of secondary chips.
const hit=(type,freq,q,gain,tone,end,ring=0,extra=null)=>Object.freeze({type,freq,q,gain,tone,end,ring,...(extra||{})});

export const IMPACT_SURFACES=Object.freeze({
 default:hit('highpass',1600,1.2,.3,900,420,0,{decay:1}),
 concrete:hit('bandpass',1400,1,.3,600,220,0,{decay:1,debris:2}),
 metal:hit('bandpass',2600,2.2,.34,1500,3000,3200,{decay:1.4}),
 grass:hit('lowpass',600,.7,.16,260,120,0,{decay:.7}),
 sand:hit('lowpass',520,.6,.15,220,100,0,{decay:.65}),
 gravel:hit('bandpass',1100,.9,.22,340,150,0,{decay:.85,debris:3}),
 wood:hit('bandpass',980,1.6,.26,620,300,520,{decay:1.05}),
 snow:hit('lowpass',480,.6,.14,200,90,0,{decay:.6}),
 water:hit('bandpass',900,.6,.2,300,120,0,{decay:.9,splash:1}),
 stone:hit('bandpass',1800,1.3,.3,900,320,0,{decay:1.1,debris:2}),
 dirt:hit('lowpass',640,.7,.17,240,110,0,{decay:.7}),
});

export function impactProfile(surface){
 return IMPACT_SURFACES[surfaceKind(surface)]||IMPACT_SURFACES.default;
}

// Per-gunshot-family report shape. `transient`/`body` scale the noise layers,
// `sub` the low thump, `tail`/`tailFreq`/`tailDecay` the decaying reverb-ish
// tail, `layers` picks one extra family-specific layer.
const report=(transient,body,sub,tail,tailFreq,layers)=>Object.freeze({pitch:1,transient,body,sub,tail,tailFreq,layers});

export const REPORT_STYLES=Object.freeze({
 rifle:report(1,.9,.16,.55,1100,'supersonic'),
 heavy:report(1.15,1.25,.34,1.05,300,'double'),
 zap:report(.8,.7,.12,.7,2200,'sizzle'),
 burst:report(.95,1,.2,.9,700,'bloom'),
 plasma:report(.9,1.05,.26,.8,1500,'bloom'),
 sharp:report(1.2,.85,.14,.35,2600,'crack'),
 rapid:report(.85,.75,.1,.3,1800,'tight'),
});

export function reportStyle(style){
 return REPORT_STYLES[style]||REPORT_STYLES.rifle;
}

// Bounded deterministic hash in [0,1). Used for per-shot variation and debris
// scheduling so two identical events always synthesize identically.
export function mixUnit(seed){
 let x=((Number(seed)||0)>>>0)+0x9e3779b9;
 x^=x<<13;x>>>=0;x^=x>>>17;x^=x<<5;x>>>=0;
 return (x>>>0)/4294967296;
}

// Per-shot variation: pitch/brightness/tail multipliers with bounded ranges so
// automatic fire never sounds like one repeated sample, and never drifts into a
// different weapon family. Deterministic in `seed` (event id/time/weapon hash).
export function reportVariation(style,seed){
 const s=REPORT_STYLES[style]?style:'rifle',s0=(Number(seed)||0)>>>0;
 const u1=mixUnit(s0*3+1),u2=mixUnit(s0*3+2),u3=mixUnit(s0*3+3);
 return Object.freeze({
  style:s,
  pitch:1+(u1-.5)*.09,
  bright:.9+u2*.22,
  tail:.75+u3*.5,
 });
}

// Stable seed for a shot/impact event: id if the stream provides one, else the
// event time quantised to milliseconds, mixed with the weapon.
export function eventSeed(e){
 if(!e||typeof e!=='object')return 0;
 const id=Number(e.id),time=Number(e.time),weapon=Number(e.weapon);
 const a=Number.isFinite(id)?id:0,b=Number.isFinite(time)?Math.round(time*1000):0,c=Number.isFinite(weapon)?weapon+1:1;
 return ((a*2654435761)^(b*40503)^(c*2246822519))>>>0;
}
