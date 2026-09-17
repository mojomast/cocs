import * as T from 'three';
import {WEAPONS} from './data.mjs';
import {precipParticleAdds} from './environment.mjs';
import {MusicEngine,HALO_THEME} from './music.mjs';
import {footstepProfile,impactProfile,reportStyle,reportVariation,eventSeed,mixUnit} from './sfx-design.mjs';

// Presentation only: these offsets must never be applied to the aiming camera.
const KICKS=WEAPONS.map(w=>w.feel?.kick||[.04,.04,16]);
// Shared zero channel set so a hidden/reduced weapon never allocates per frame.
const ZERO_CHANNEL=Object.freeze({pitch:0,roll:0});
export const EMPTY_CHANNELS=Object.freeze({recoil:ZERO_CHANNEL,punch:ZERO_CHANNEL,reload:ZERO_CHANNEL,swap:ZERO_CHANNEL,movement:ZERO_CHANNEL});
export class WeaponFeedback{
 constructor(){this.reset();}
 reset(){this.kick=0;this.landing=0;this.phase=0;this.bob=0;this.sway=0;this.grounded=undefined;this.vy=0;this.weapon=-1;this.lastShot=null;this.channels=EMPTY_CHANNELS;}
 shot(weapon,stamp){if(stamp!=null&&stamp===this.lastShot&&weapon===this.weapon)return;this.lastShot=stamp;this.weapon=weapon;this.kick=Math.min(1.4,this.kick+1);}
 update(player,dt,reduced=false,visible=true,bobScale=1){dt=Math.max(0,Math.min(dt||0,.1));const bobAmp=Math.max(0,Math.min(1.5,Number(bobScale)||0));const profile=KICKS[player.weapon]||KICKS[0];
  if(this.weapon!==player.weapon){this.kick=0;this.weapon=player.weapon;}
  if(this.grounded===false&&player.grounded)this.landing=Math.min(.035,Math.max(0,-this.vy)*.003);
  this.grounded=player.grounded;this.vy=player.vy||0;
  this.kick*=Math.exp(-profile[2]*dt);this.landing*=Math.exp(-14*dt);
  const speed=Math.min(1,Math.hypot(player.vx||0,player.vz||0)/7),blend=1-Math.exp(-12*dt);
  this.phase+=dt*10*speed;this.bob+=((player.grounded?speed:0)-this.bob)*blend;
  const lateral=(player.vx||0)*Math.cos(player.yaw||0)-(player.vz||0)*Math.sin(player.yaw||0);
  this.sway+=(Math.max(-.012,Math.min(.012,-lateral*.002))-this.sway)*blend;
  this.idleTime=(this.idleTime||0)+dt;
  const idle=(1-speed)*Math.sin(this.idleTime*1.8)*.0022;
  const idleY=(1-speed)*(Math.cos(this.idleTime*3.6)+Math.sin(this.idleTime*1.8)*.25)*.0016;
  const strafeRoll=Math.max(-.05,Math.min(.05,-lateral*.006));
  const lookSway=(player.punchYaw||0)*.02;
  if(reduced||!visible){this.kick=0;this.landing=0;this.bob=0;this.sway=0;this.channels=EMPTY_CHANNELS;return {x:0,y:0,z:0,pitch:0,roll:0};}
  const reloadT=player.reloading?Math.sin(Math.max(0,Math.min(1,1-(player.reloadTimer||0)/(player.reloadDuration||1)))*Math.PI):0;
  const reloadDipY=-0.045*reloadT,reloadPitch=-0.04*reloadT,reloadRoll=0.05*reloadT;
  const swapT=(player.weaponSwitch||0)>0?Math.sin(Math.min(1,Math.max(0,(player.weaponSwitch||0)/.45))*Math.PI):0;
  const swapDipY=-0.07*swapT,swapPitch=-0.04*swapT;
  // Named channels so the renderer can compose movement sway, recoil, reload and
  // weapon-switch transforms independently. `pitch`/`roll` stay the exact sums so
  // existing consumers keep their numbers.
  const recoilPitch=this.kick*profile[1],recoilRoll=this.kick*Number(profile[3]||0);
  const punchPitch=(player.punchPitch||0)*.015;
  const movementRoll=((this.sway+lookSway)*.7+strafeRoll)*bobAmp;
  this.channels={recoil:{pitch:recoilPitch,roll:recoilRoll},punch:{pitch:punchPitch,roll:0},reload:{pitch:reloadPitch,roll:reloadRoll},swap:{pitch:swapPitch,roll:0},movement:{pitch:0,roll:movementRoll}};
  return {x:(Math.sin(this.phase)*.007*this.bob+this.sway+idle+lookSway)*bobAmp,y:(Math.cos(this.phase*2)*.006*this.bob+idleY)*bobAmp-this.landing+reloadDipY+swapDipY,z:this.kick*profile[0],pitch:recoilPitch+punchPitch+reloadPitch+swapPitch,roll:movementRoll+reloadRoll};
 }
}

// Fixed-size reusable slots: bursts and pellets cannot grow GPU resources.
export class EffectPool{
  constructor(scene,limit=96){
    this.scene=scene;this.limit=limit;this.slots=[];this.serial=0;
    this.line=new T.CylinderGeometry(.5,.5,1,6).rotateX(Math.PI/2).translate(0,0,.5);
    this.sphere=new T.IcosahedronGeometry(1,0);
    this.axis=new T.Vector3(0,0,1);
    this.direction=new T.Vector3();
    this.scratchColor=new T.Color();
  }
  add({from,to,pos,color,life=.15,size=.08,expand=0,velocity=null,wireframe=false,additive=false,damping=0,gravity=null,spin=null,fade='linear',startOpacity=.8,endColor=null}){
   const line=!!from;let slot=this.slots.find(s=>!s.active&&s.line===line);
   if(!slot&&this.slots.length<this.limit){const mat=new T.MeshBasicMaterial({transparent:true,depthWrite:false});const obj=new T.Mesh(line?this.line:this.sphere,mat);slot={obj,line};this.slots.push(slot);this.scene.add(obj);}
   if(!slot){
     let oldest=null;
     for(let i=0;i<this.slots.length;i++){
       const s=this.slots[i];
       if(s.line===line&&(!oldest||s.serial<oldest.serial))oldest=s;
     }
     slot=oldest;
     if(!slot)return;
   }
   const obj=slot.obj;obj.visible=true;obj.material.color.set(color);obj.material.opacity=startOpacity??.8;obj.material.wireframe=wireframe;obj.material.blending=additive?T.AdditiveBlending:T.NormalBlending;obj.rotation.set(0,0,0);
   if(line){obj.position.copy(from);this.direction.subVectors(to,from);obj.scale.set(size,size,this.direction.length());obj.quaternion.setFromUnitVectors(this.axis,this.direction.normalize());}
   else{obj.position.copy(pos);obj.scale.setScalar(size);}
   let vel=null;
   if(velocity){
     slot.velVec??=new T.Vector3();
     slot.velVec.set(velocity.x||0,velocity.y||0,velocity.z||0);
     vel=slot.velVec;
   }
   let spinVec=null;
   if(spin){
     slot.spinVec??=new T.Vector3();
     if(typeof spin==='number')slot.spinVec.set(spin,spin*.7,spin*1.3);
     else slot.spinVec.set(spin.x||0,spin.y||0,spin.z||0);
     spinVec=slot.spinVec;
   }
   if(endColor){
     slot.startCol??=new T.Color();
     slot.endCol??=new T.Color();
     slot.startCol.set(color);
     slot.endCol.set(endColor);
     slot.startColor=slot.startCol;
     slot.endColor=slot.endCol;
   }else{
     slot.startColor=null;
     slot.endColor=null;
   }
   Object.assign(slot,{active:true,serial:++this.serial,life,total:life,expand,velocity:vel,spin:spinVec,damping:Math.max(0,Number(damping)||0),gravity,fade,startOpacity:startOpacity??.8});
   return obj;
  }
  update(dt){
   for(const s of this.slots){
    if(!s.active)continue;
    s.life-=dt;
    if(s.life<=0){s.active=false;s.obj.visible=false;continue;}
    const fraction=Math.max(0,Math.min(1,s.life/s.total));
    let alpha=fraction;
    if(s.fade==='smooth')alpha=fraction*fraction*(3-2*fraction);
    else if(s.fade==='exp')alpha=Math.pow(fraction,1.8);
    else if(s.fade==='pop')alpha=Math.sin(fraction*Math.PI*0.5);
    s.obj.material.opacity=s.startOpacity*alpha;
    if(s.endColor&&s.startColor){
     this.scratchColor.copy(s.endColor).lerp(s.startColor,fraction);
     s.obj.material.color.copy(this.scratchColor);
    }
    if(s.expand)s.obj.scale.addScalar(dt*s.expand);
    if(s.spin){
     s.obj.rotation.x+=s.spin.x*dt;
     s.obj.rotation.y+=s.spin.y*dt;
     s.obj.rotation.z+=s.spin.z*dt;
    }
    if(s.velocity){
     s.obj.position.addScaledVector(s.velocity,dt);
     if(s.damping>0)s.velocity.multiplyScalar(Math.exp(-s.damping*dt));
     s.velocity.y-=(s.gravity!=null?s.gravity:15)*dt;
    }
   }
  }
  clear(){for(const s of this.slots){s.active=false;s.obj.visible=false;s.velocity=null;s.spin=null;s.startColor=null;s.endColor=null;}}
  dispose(){for(const s of this.slots){this.scene.remove(s.obj);s.obj.material.dispose();}this.slots=[];this.line.dispose();this.sphere.dispose();}
}

// Deterministic ambient emitter that reuses the existing pooled effect system.
// Dust/leaves/embers drift around the camera, distant smoke rises from fixed
// arena anchors. Seeded so replays and the CPU renderer see identical spawns;
// the view only calls update() on WebGL and never under reduced motion.
const mulberry=seed=>{let state=(seed>>>0)||1;return()=>{state=(state+0x6d2b79f5)|0;let t=Math.imul(state^(state>>>15),1|state);t=(t+Math.imul(t^(t>>>7),61|t))^t;return((t^(t>>>14))>>>0)/4294967296;};};
export class AmbientFX{
 constructor(pool,{profile=null,seed=1,anchors=[],rateScale=1,moteCap=6}={}){this.pool=pool;this.profile=profile;this.anchors=Array.isArray(anchors)?anchors:[];this.rateScale=Math.max(0,Number(rateScale)||0);this.moteCap=Math.max(1,Math.round(moteCap)||1);this.seed=(seed>>>0)||1;this.random=mulberry(this.seed);this.acc=0;this.smokeAcc=0;this.spawned=0;}
 setProfile(profile){this.profile=profile||null;this.acc=0;this.smokeAcc=0;}
 setAnchors(anchors){this.anchors=Array.isArray(anchors)?anchors:[];}
 reset(){this.acc=0;this.smokeAcc=0;}
 update(dt,origin,{reduced=false,software=false,radius=9,wind=1}={}){
  if(reduced||software||!this.pool||!this.profile||!origin)return 0;
  const step=Math.min(Math.max(Number(dt)||0,0),.1),rate=Math.max(0,Number(this.profile.rate)||0)*this.rateScale;
  this.acc+=step*rate;
  let spawned=0;
  while(this.acc>=1&&spawned<this.moteCap){this.acc-=1;this._mote(origin,radius,wind);spawned++;}
  const smoke=this.profile.smoke;
  if(smoke&&this.anchors.length){this.smokeAcc+=step*Math.max(1,Number(smoke.rate)||1);while(this.smokeAcc>=1&&spawned<this.moteCap*2){this.smokeAcc-=1;this._smoke(smoke,wind);spawned++;}}
  this.spawned+=spawned;return spawned;
 }
 _mote(origin,radius,wind=1){
  const a=this.random()*Math.PI*2,dist=Math.sqrt(this.random())*Math.max(1,radius),height=this.random()*3.4,g=Number.isFinite(wind)&&wind>0?wind:1,drift=(this.profile.drift||.5)*g,rise=(this.profile.rise||0)*g;
  this.pool.add({pos:{x:(origin.x||0)+Math.cos(a)*dist,y:(origin.y||0)+height,z:(origin.z||0)+Math.sin(a)*dist},color:this.profile.color||'#c9d8e6',size:this.profile.size||.035,life:this.profile.life||3.5,velocity:{x:(this.random()-.5)*drift,y:rise*(.5+this.random()),z:(this.random()-.5)*drift},additive:this.profile.additive===true});
 }
 _smoke(smoke,wind=1){
  const anchor=this.anchors[Math.floor(this.random()*this.anchors.length)%this.anchors.length],g=Number.isFinite(wind)&&wind>0?wind:1;
  this.pool.add({pos:{x:(anchor.x||0)+(this.random()-.5)*1.2,y:(anchor.y||0)+.4,z:(anchor.z||0)+(this.random()-.5)*1.2},color:smoke.color||'#8f9a86',size:smoke.size||.3,life:smoke.life||6,expand:.4,velocity:{x:(this.random()-.5)*.2*g,y:(smoke.rise||.5)*g,z:(this.random()-.5)*.2*g},additive:true});
 }
}

// Deterministic precipitation emitter. Reuses the same pooled EffectPool as the
// ambient motes; the spawn list itself comes from the pure precipParticleAdds
// helper so replays match and the CPU renderer can skip the pass entirely.
export class WeatherFX{
 constructor(pool,{seed=1,preset=null,cap=10}={}){this.pool=pool;this.preset=preset;this.seed=(seed>>>0)||1;this.cap=Math.max(1,Math.round(Number(cap)||10));this.serial=0;this.spawned=0;}
 setPreset(preset){this.preset=preset||null;this.serial=0;return this.preset;}
 reset(){this.serial=0;this.spawned=0;}
 update(dt,origin,{reduced=false,software=false,radius=9,intensity=1,quality=1}={}){
  if(reduced||software||!this.pool||!this.preset||!(this.preset.particles>0)||!origin)return 0;
  this.serial=(this.serial+1)>>>0;
  const scale=Math.max(0,Math.min(1,Number(intensity)||0))*Math.max(0,Math.min(1,Number(quality)||0));
  if(scale<=0)return 0;
  const adds=precipParticleAdds(this.serial,this.preset.kind,origin,radius,{...this.preset,particles:Math.round(this.preset.particles*scale)});
  let spawned=0;
  for(const add of adds){if(spawned>=this.cap)break;this.pool.add(add);spawned++;}
  this.spawned+=spawned;return spawned;
 }
}

const REPORTS=[[320,.075,'square',65],[110,.2,'sawtooth',28],[1500,.16,'sine',180],[180,.13,'triangle',35],[620,.09,'triangle',250],[210,.18,'sawtooth',45],[480,.1,'square',1100],[95,.22,'triangle',30],[700,.09,'square',420],[540,.06,'square',180]];
// Per-weapon synthesis family: rifle snap, heavy thump, electric zap, wide burst, sharp crack, rapid chatter.
const GUN_STYLES=['rifle','heavy','zap','burst','plasma','heavy','zap','burst','sharp','rapid'];
// Optional announcer motifs keyed by mode event. Two-note rising/falling pairs
// keep the callouts distinct without a speech asset.
const ANNOUNCE_CUES=Object.freeze({
 capture:Object.freeze({id:'capture',freq:520,mid:780,end:1040,length:.3}),
 'flag-pickup':Object.freeze({id:'flag-pickup',freq:640,mid:760,end:880,length:.24}),
 'flag-return':Object.freeze({id:'flag-return',freq:720,mid:640,end:560,length:.22}),
 goal:Object.freeze({id:'goal',freq:440,mid:880,end:1320,length:.42}),
 killstreak:Object.freeze({id:'killstreak',freq:620,mid:930,end:1240,length:.3}),
 spree:Object.freeze({id:'spree',freq:580,mid:870,end:1160,length:.35}),
 multikill:Object.freeze({id:'multikill',freq:780,mid:1170,end:1560,length:.3}),
 victory:Object.freeze({id:'victory',freq:660,mid:990,end:1320,length:.5}),
 defeat:Object.freeze({id:'defeat',freq:520,mid:410,end:300,length:.5}),
 score:Object.freeze({id:'score',freq:480,mid:600,end:720,length:.25}),
 boss:Object.freeze({id:'boss',freq:190,mid:140,end:96,length:.62}),
 objective:Object.freeze({id:'objective',freq:600,mid:750,end:900,length:.3}),
 power:Object.freeze({id:'power',freq:540,mid:720,end:960,length:.24}),
 feint:Object.freeze({id:'feint',freq:900,mid:600,end:320,length:.18}),
 // Movement verbs (§3.4/§6.3): one opt-in motif per verb, fired on activate.
 // `move-start` is the generic fallback when a verb id is unknown.
 'move-start':Object.freeze({id:'move-start',freq:560,mid:720,end:900,length:.2}),
 'air-dash':Object.freeze({id:'air-dash',freq:680,mid:1020,end:1360,length:.22}),
 'double-jump':Object.freeze({id:'double-jump',freq:620,mid:880,end:1240,length:.2}),
 'super-jump':Object.freeze({id:'super-jump',freq:240,mid:520,end:880,length:.3}),
 'hover-jets':Object.freeze({id:'hover-jets',freq:420,mid:640,end:840,length:.3}),
 'brace-slam':Object.freeze({id:'brace-slam',freq:180,mid:96,end:64,length:.4}),
 'safety-glide':Object.freeze({id:'safety-glide',freq:520,mid:460,end:400,length:.34}),
 grapple:Object.freeze({id:'grapple',freq:700,mid:1050,end:1400,length:.2}),
 'blink-step':Object.freeze({id:'blink-step',freq:880,mid:1320,end:1760,length:.16}),
 'deployable-rope':Object.freeze({id:'deployable-rope',freq:500,mid:750,end:1120,length:.26}),
});
const cl=(n,a,b)=>Math.max(a,Math.min(b,n));

// Per-mode music themes. A theme is a root frequency plus a small scale (in
// semitones) reused for the dynamic combat drone and the victory/defeat sting,
// so a mode has a recognisable tonal centre without a music asset. Pure data.
export const MODE_THEMES=Object.freeze({
 default:Object.freeze({root:58,scale:Object.freeze([0,3,5,7])}),
 deathmatch:Object.freeze({root:62,scale:Object.freeze([0,3,5,7])}),
 teamdeathmatch:Object.freeze({root:58,scale:Object.freeze([0,3,5,7])}),
 ctf:Object.freeze({root:55,scale:Object.freeze([0,4,7,9])}),
 koth:Object.freeze({root:52,scale:Object.freeze([0,5,7,10])}),
 domination:Object.freeze({root:57,scale:Object.freeze([0,4,7,11])}),
 assault:Object.freeze({root:50,scale:Object.freeze([0,3,7,10])}),
 payload:Object.freeze({root:53,scale:Object.freeze([0,5,7,10])}),
 instagib:Object.freeze({root:66,scale:Object.freeze([0,6,8,12])}),
 rockets:Object.freeze({root:48,scale:Object.freeze([0,3,6,9])}),
 arsenal:Object.freeze({root:60,scale:Object.freeze([0,4,7,9])}),
 armsrace:Object.freeze({root:64,scale:Object.freeze([0,2,5,9])}),
 'combined-arms':Object.freeze({root:51,scale:Object.freeze([0,4,7,10])}),
 'puma-race':Object.freeze({root:69,scale:Object.freeze([0,4,7,12])}),
 'puma-soccer':Object.freeze({root:67,scale:Object.freeze([0,4,7,11])}),
 horde:Object.freeze({root:46,scale:Object.freeze([0,1,5,8])}),
 campaign:Object.freeze({root:54,scale:Object.freeze([0,3,7,10])}),
 juggernaut:Object.freeze({root:49,scale:Object.freeze([0,3,6,10])}),
 'team-elimination':Object.freeze({root:45,scale:Object.freeze([0,1,6,8])}),
 'vip-escort':Object.freeze({root:56,scale:Object.freeze([0,4,7,9])}),
 holdout:Object.freeze({root:55,scale:Object.freeze([0,3,5,7])}),
 uplink:Object.freeze({root:63,scale:Object.freeze([0,4,7,11])}),
});
// Victory/defeat stings: a short arpeggio built from the active mode scale.
const STING_CUES=Object.freeze({
 victory:Object.freeze({type:'triangle',octave:4,step:.12,length:.6,gain:.06,end:1.5,notes:Object.freeze([0,2,4,7])}),
 defeat:Object.freeze({type:'sawtooth',octave:2,step:.15,length:.62,gain:.055,end:.5,notes:Object.freeze([4,2,1,0])}),
});

// Objective / match-beat motifs in semitone offsets from the active mode root.
// One motif is one voice (one `_play` token) so a busy objective does not spend
// the shared voice budget. `gain`/`length` are the tone envelope, `step` the
// note spacing, `shimmer` adds a filtered noise accent.
const objective=(notes,step,length,gain,shimmer=false)=>Object.freeze({notes:Object.freeze(notes),step,length,gain,shimmer});
const OBJECTIVE_CUES=Object.freeze({
 pickup:objective([0,7],.06,.2,.08),
 powerup:objective([0,5,12],.05,.2,.075),
 power:objective([7,12],.07,.22,.08),
 spawn:objective([7],0,.2,.06),
 'flag-pickup':objective([0,4,7],.05,.18,.075),
 'flag-drop':objective([7,0],.05,.16,.07),
 'flag-return':objective([12,7,4],.05,.18,.075),
 capture:objective([0,7,12],.06,.22,.085),
 zone:objective([0,5,12],.05,.18,.07),
 default:objective([0,7],.06,.2,.075),
});
const objectiveCue=type=>OBJECTIVE_CUES[type]||(typeof type==='string'&&type.startsWith('zone')?OBJECTIVE_CUES.zone:OBJECTIVE_CUES.default);

// Per-harness activation motifs (§6.3). The `power` event already carries the
// harness id, so an activation reads as the spec that fired instead of one
// generic power blip. One motif is still one `_play` voice.
const POWER_CUES=Object.freeze({
 openclaw:objective([0,-3,0],.06,.22,.09),
 hermes:objective([0,5,12],.05,.18,.08),
 opencode:objective([0,4,7,12],.04,.16,.075),
 claudecode:objective([0,-5],.08,.26,.08),
 codex:objective([0,7,12],.06,.24,.085),
 cline:objective([12,5,0],.04,.14,.075),
 roo:objective([0,-1,-5],.07,.24,.08,true),
});

// The movement module's shared event vocabulary (§3.6). Movement foley is
// local-only: these are the verbs the local player is driving, not world beats.
const MOVEMENT_EVENTS=new Set(['move-start','move-end','move-miss','move-blocked','windup-start','windup-end','windup-interrupt','charge-start','charge-release','charge-cancel','slam-launch','slam-impact','grapple-hook','grapple-release','rope-place','rope-miss','rope-expire','fuel-empty','no-lift','chain-cancel','landing-recovery']);

// Match-beat motifs keyed by mode event type, in semitones from the mode root.
// These cover objective ticks, wave/boss beats and lifetime events that used to
// be silent. One motif is still one `_play` voice.
const EVENT_CUES=Object.freeze({
 'zone-score':objective([0,4,7],.05,.16,.055),
 'zone-progress':objective([0,4],.05,.14,.045),
 'zone-capture':objective([0,7,12],.06,.2,.07,true),
 'zone-neutralized':objective([12,7,0],.05,.18,.06),
 'charge':objective([0,5],.07,.2,.06),
 'assault-hold':objective([0,7],.08,.22,.06),
 'payload-hold':objective([0,5],.08,.22,.06),
 'hill-rotate':objective([7,12],.07,.2,.06),
 'uplink-capture':objective([0,7,12],.05,.2,.07,true),
 'uplink-stage':objective([0,5],.07,.18,.055),
 'objective-win':objective([0,7,12],.09,.3,.085,true),
 'objective-tiebreak':objective([0,6,12],.08,.28,.08),
 'sudden-death':objective([0,-1,0],.12,.3,.08),
 'horde-wave':objective([0,-5],.1,.3,.075),
 'horde-wave-cleared':objective([0,5,12],.07,.24,.075,true),
 'horde-resupply':objective([0,7],.06,.2,.07),
 'boss-summon':objective([0,-6],.14,.4,.09),
 'boss-slam':objective([-12,0],.06,.34,.1),
 'boss-phase':objective([0,-3,-6],.12,.34,.085,true),
 'mender-heal':objective([0,4,7],.04,.14,.05),
 'weapon-upgrade':objective([0,5,7,12],.045,.14,.055,true),
 'armsrace-promote':objective([0,5,12],.05,.16,.06),
 'armsrace-demote':objective([12,5,0],.05,.16,.055),
 'bounty':objective([0,7,0],.05,.16,.06),
 'vip-deploy':objective([0,7],.08,.22,.065),
 'vip-down':objective([7,0,-5],.08,.24,.075),
 'vip-extracted':objective([0,7,12],.07,.24,.08,true),
 'elimination-life':objective([0,-3],.1,.26,.07),
 'singleplayer-life':objective([0,-3],.1,.26,.07),
 'campaign-resupply':objective([0,7],.06,.2,.07),
 'enemy-flank':objective([12,5,12],.11,.24,.07,true),
});

// Layered Web Audio synth: filtered noise transients + tonal bodies, distance
// falloff and stereo panning, plus footsteps, landing thuds and a Warthog engine.
// Continuous ambience bed profiles keyed by biome mood. Frequencies and gains
// are presentation-only; setBedMood eases between them without restarting nodes.
const BED_MOODS=Object.freeze({
 default:Object.freeze({filter:240,tone:42,gain:.018,sub:.006,air:.0045,windFreq:520,wind:1,tense:.004,tenseFreq:58}),
 night:Object.freeze({filter:180,tone:34,gain:.014,sub:.005,air:.003,windFreq:420,wind:.8,tense:.005,tenseFreq:52}),
 cold:Object.freeze({filter:320,tone:54,gain:.016,sub:.004,air:.006,windFreq:760,wind:1.15,tense:.003,tenseFreq:64}),
 hot:Object.freeze({filter:200,tone:38,gain:.02,sub:.008,air:.005,windFreq:600,wind:1.1,tense:.004,tenseFreq:55}),
 storm:Object.freeze({filter:420,tone:48,gain:.024,sub:.005,air:.012,windFreq:900,wind:2,tense:.003,tenseFreq:60}),
});
export class SynthAudio{
 constructor({announcer=false}={}){this.ctx=null;this.muted=false;this.voices=new Set();this.noiseBuffer=null;this.master=null;this.lastDamage=null;this.lastReport=null;this.lastHit=-Infinity;this.footPhase=0;this.wasGrounded=undefined;this.lastVy=0;this.engine=null;this.bed=null;this.bedMood='default';this.ambientBed=true;this.stepVariant=0;this.landVariant=0;this.reloadVariant=0;this.intensity=0;this.bedScale=.75;this.musicEnabled=true;this.announcer=announcer===true;this.announced=new Set();this.lastCue=null;this.mode='default';this.theme=MODE_THEMES.default;this.soundtrack='default';this.reverbUrl=null;this.reverbWet=0.42;this.reverbLoaded=false;this.lastSting=null;this.heartbeatTimer=0;this.reportSerial=0;this.space=null;this.surfaceResolver=null;this.windScale=null;this._reverbPending=false;this.jumpVariant=0;
  // Gain buses. `muteGain` sits between the master and the destination so a
  // master mute silences every branch immediately; music/effects/ambience each
  // have their own bus for independent volume control. Voice chat lives in
  // game/voice.mjs and is deliberately outside this graph.
  this.musicEngine=null;this.effectsBus=null;this.ambienceBus=null;this.muteGain=null;
  this.volumes={master:.9,music:.7,effects:1,ambience:.8};
  this.status='off';this.scene='menu';this._announceAt=new Map();this._stingDuckTimer=null;
 }
 // Start (or resume) the audio engine. Returns a promise that resolves once the
 // context is running; a rejected/blocked resume is surfaced through `status`
 // rather than swallowed so the UI can offer a retry. Safe to call repeatedly.
 start(){
  try{
   const Context=globalThis.AudioContext||globalThis.webkitAudioContext;if(!Context)return Promise.resolve(false);
   this.ctx??=new Context();
   this._ensureBuses();
   this.noiseBuffer??=this._makeNoise();
   if(this.ambientBed!==false)this._bed(true);
   return this.unlock();
  }catch{this.status='error';return Promise.resolve(false);}
 }
 // Resume a suspended AudioContext and record the outcome. Autoplay policies
 // require this to happen inside a user gesture; callers trigger it from clicks.
 unlock(){
  if(!this.ctx)return Promise.resolve(false);
  // Once the context is actually running, load the convolution reverb exactly
  // once per URL. A failed fetch/decode must NOT latch `reverbLoaded`: a later
  // unlock retries, so a transient or 404 failure stays recoverable instead of
  // silently disabling the IR for the session.
  const settle=(ok)=>{
   if(ok&&this.reverbUrl&&!this.reverbLoaded&&!this._reverbPending&&this.musicEngine&&!this.musicEngine.reverb){
    const url=this.reverbUrl;
    this._reverbPending=true;
    Promise.resolve(this.loadMusicReverb(url,{wet:this.reverbWet})).catch(()=>false).then(loaded=>{
     this._reverbPending=false;
     if(this.reverbUrl!==url)return;
     this.reverbLoaded=loaded===true;
    });
   }
   return ok;
  };
  if(this.ctx.state==='running'){this.status='running';return Promise.resolve(settle(true));}
  const res=this.ctx.resume?.();
  if(res&&typeof res.then==='function'){
   return res.then(()=>{this.status=this.ctx.state==='running'?'running':'suspended';return settle(this.status==='running');}).catch(()=>{this.status='blocked';return false;});
  }
  this.status=this.ctx.state||'suspended';return Promise.resolve(settle(this.status==='running'));
 }
 // Register a same-origin impulse response to attach on the next unlock. A new
 // URL cancels any in-flight attach for the old URL; the settle callback checks
 // the URL again before latching so a stale load cannot win.
 setReverbUrl(url,wet=0.42){this.reverbUrl=url||null;const w=Number(wet);this.reverbWet=Number.isFinite(w)?w:.42;this.reverbLoaded=false;this._reverbPending=false;if(this.ctx&&this.ctx.state==='running')this.unlock();return Boolean(url);}
 _ensureBuses(){
  if(!this.ctx||this.master)return;
  const ctx=this.ctx;
  this.master=ctx.createGain();this.master.gain.value=this.volumes.master;
  this.muteGain=ctx.createGain();this.muteGain.gain.value=this.muted?0:1;
  this.master.connect(this.muteGain);this.muteGain.connect(ctx.destination);
  this.effectsBus=ctx.createGain();this.effectsBus.gain.value=this.volumes.effects;this.effectsBus.connect(this.master);
  this.ambienceBus=ctx.createGain();this.ambienceBus.gain.value=this.volumes.ambience;this.ambienceBus.connect(this.master);
  // Shared "space" send: a fixed delay + damped feedback loop. Weapon tails,
  // explosions and thunder route part of their output here so distant fights
  // keep depth without a convolution IR or per-sound scheduling. Optional:
  // contexts without DelayNode (and every Node test fixture) skip it.
  this.space=null;
  if(typeof ctx.createDelay==='function'&&typeof ctx.createBiquadFilter==='function'){
   try{
    const send=ctx.createGain(),delay=ctx.createDelay(.6),damp=ctx.createBiquadFilter(),fb=ctx.createGain(),wet=ctx.createGain();
    delay.delayTime.value=.16;damp.type='lowpass';damp.frequency.value=2000;fb.gain.value=.34;wet.gain.value=.55;send.gain.value=1;
    send.connect(delay);delay.connect(damp);damp.connect(fb);fb.connect(delay);delay.connect(wet);wet.connect(this.effectsBus||this.master);
    this.space={send,delay,damp,fb,wet};
   }catch{this.space=null;}
  }
  try{this.musicEngine=new MusicEngine({ctx,destination:this.master,theme:this.theme,noiseBuffer:this.noiseBuffer,seed:(Date.now()&0xffff)||1});}
  catch{this.musicEngine=null;}
  if(this.musicEngine){this.musicEngine.setEnabled(this.musicEnabled);this.musicEngine.setMuted(this.muted);this.musicEngine.setScene(this.scene);this.musicEngine.setSoundtrack(this.soundtrack||'default');}
  this.status=ctx.state||'suspended';
 }
 // Immediate master mute. The mute gain is set synchronously (not ramped) so a
 // mute silences a running music pad instantly; music scheduling pauses so no
 // new notes are queued while silent.
 setMuted(on){
  this.muted=on===true;
  if(!this.ctx)return this.muted;
  this._ensureBuses();
  try{this.muteGain.gain.cancelScheduledValues?.(this.ctx.currentTime);}catch{}
  try{this.muteGain.gain.value=this.muted?0:1;}catch{}
  this.musicEngine?.setMuted(this.muted);
  if(this.muted){this._engine(0,false);this._bed(false);}
  else if(this.ambientBed!==false)this._bed(true);
  if(!this.muted)this.unlock();
  return this.muted;
 }
 setVolume(kind,value){
  const key=kind in this.volumes?kind:null;if(!key)return null;
  const v=Math.max(0,Math.min(1.5,Number(value)));
  this.volumes[key]=Number.isFinite(v)?v:this.volumes[key];
  if(key==='master'&&this.master)try{this.master.gain.value=this.volumes.master;}catch{}
  if(key==='effects'&&this.effectsBus)try{this.effectsBus.gain.value=this.volumes.effects;}catch{}
  if(key==='ambience'&&this.ambienceBus)try{this.ambienceBus.gain.value=this.volumes.ambience;}catch{}
  return this.volumes[key];
 }
 getVolume(kind){return this.volumes[kind]??null;}
 // Scene drives the soundtrack arrangement: menus get the menu theme, matches
 // get exploration/combat layered by intensity.
 setScene(scene){this.scene=scene==='menu'?'menu':'game';this.musicEngine?.setScene(this.scene==='menu'?'menu':(this.intensity>=.34?'combat':'explore'));return this.scene;}
 previewMusic(scene='menu',seconds=8){this._ensureBuses();const r=this.musicEngine?.preview(scene,seconds);this.unlock();return r??null;}
 // Select an arrangement pack (e.g. 'halo'); delegates to the music engine.
 setSoundtrack(name='default'){this.soundtrack=(name==='halo')?'halo':'default';this._ensureBuses();this.theme=this.soundtrack==='halo'?HALO_THEME:(MODE_THEMES[this.mode]||MODE_THEMES.default);return this.musicEngine?.setSoundtrack(this.soundtrack)??this.soundtrack;}
 // Hand a baked motif (e.g. from qrc-midi) to the soundtrack's lead voice.
 setMotif(motif){return this.musicEngine?.setMotif(motif)??0;}
 // Attach a convolution impulse response (an AudioBuffer) to the music reverb.
 setMusicReverb(buffer,opts){return this.musicEngine?.setReverb(buffer,opts)??false;}
 // Fetch and decode a same-origin impulse response WAV, then attach it. Safe to
 // call repeatedly and safe when the context is not yet running.
 async loadMusicReverb(url,opts){
  if(!url)return false;
  try{
   this._ensureBuses();
   if(!this.ctx||typeof this.ctx.decodeAudioData!=='function')return false;
   const response=await fetch(url,{cache:'force-cache'});
   if(!response.ok)return false;
   const bytes=await response.arrayBuffer();
   const buffer=await new Promise((resolve,reject)=>{const p=this.ctx.decodeAudioData(bytes,resolve,reject);if(p&&typeof p.then==='function')p.then(resolve,reject);});
   if(!this.musicEngine)return false;
   return this.musicEngine.setReverb(buffer,opts);
  }catch{return false;}
 }
 audioStatus(){return {state:this.ctx?(this.ctx.state||'suspended'):'unavailable',status:this.status,enabled:this.musicEnabled,muted:this.muted,scene:this.scene,intensity:this.intensity,voices:this.voices.size,notes:this.musicEngine?.notesScheduled??0,music:this.musicEngine?.status?.()??'off',reverb:this.reverbLoaded?'ready':(this._reverbPending?'loading':(this.reverbUrl?'pending':'off'))};}
 // Low, continuous ambience bed: filtered noise hiss plus a sub tone, faded in
 // through the master gain. Owned by the audio instance and torn down in dispose.
 _bed(on){
  if(!this.ctx||!this.master)return;
  if(on&&!this.bed&&!this.muted){
   if(!this.noiseBuffer)this.noiseBuffer=this._makeNoise();
   const profile=BED_MOODS[this.bedMood]||BED_MOODS.default,t=this.ctx.currentTime,src=this.ctx.createBufferSource();src.buffer=this.noiseBuffer;src.loop=true;
   const f=this.ctx.createBiquadFilter();f.type='lowpass';f.frequency.value=profile.filter;f.Q.value=.5;
   const g=this.ctx.createGain();g.gain.value=.0001;
   const osc=this.ctx.createOscillator();osc.type='sine';osc.frequency.value=profile.tone;
   const og=this.ctx.createGain();og.gain.value=.0001;
   src.connect(f);f.connect(g);g.connect(this.ambienceBus||this.master);osc.connect(og);og.connect(this.ambienceBus||this.master);
   // Wind bed (bandpassed noise plus a slow gust LFO) and tension drone
   // (triangle whose gain follows combat intensity). Both are continuous and
   // bounded: two sources, one LFO and three gains, torn down with the bed.
   const wind=this._windLayer(profile),tense=this._tensionLayer(profile);
   if(wind)wind.windG.gain.setTargetAtTime((profile.air||0)*this._windScale(profile),t,1);
   if(tense)tense.tenseG.gain.setTargetAtTime((profile.tense||0)*this.intensity*this.intensity,t,1);
   src.start();osc.start();g.gain.setTargetAtTime(profile.gain,t,.8);og.gain.setTargetAtTime(profile.sub,t,.9);
   this.bed=Object.assign({src,f,g,osc,og},wind||{},tense||{});
  }else if(!on&&this.bed){
   for(const node of Object.values(this.bed)){if(node&&typeof node.stop==='function')try{node.stop();}catch{}if(node&&typeof node.disconnect==='function')try{node.disconnect();}catch{}}
   this.bed=null;
  }
 }
 _windLayer(profile){
  if(typeof this.ctx.createBufferSource!=='function')return null;
  const src=this.ctx.createBufferSource();src.buffer=this.noiseBuffer;src.loop=true;
  const f=this.ctx.createBiquadFilter();f.type='bandpass';f.frequency.value=profile?.windFreq||520;f.Q.value=.45;
  const g=this.ctx.createGain();g.gain.value=.0001;
  src.connect(f);f.connect(g);g.connect(this.ambienceBus||this.master);
  let lfo=null,lfoGain=null;
  if(typeof this.ctx.createOscillator==='function'){
   lfo=this.ctx.createOscillator();lfo.type='sine';lfo.frequency.value=.07;
   lfoGain=this.ctx.createGain();lfoGain.gain.value=(profile?.air||0)*.5;
   lfo.connect(lfoGain);lfoGain.connect(g.gain);lfo.start();
  }
  src.start();
  return {windSrc:src,windF:f,windG:g,windLfo:lfo,windLfoGain:lfoGain};
 }
 _tensionLayer(profile){
  if(typeof this.ctx.createOscillator!=='function')return null;
  const osc=this.ctx.createOscillator();osc.type='triangle';osc.frequency.value=profile?.tenseFreq||58;
  const g=this.ctx.createGain();g.gain.value=.0001;
  osc.connect(g);g.connect(this.ambienceBus||this.master);osc.start();
  return {tenseOsc:osc,tenseG:g};
 }
 _windScale(profile){return Number.isFinite(this.windScale)?cl(this.windScale,0,3):cl(Number(profile?.wind)||1,0,3);}
 // Optional wind override (0..3). Derived from the bed mood when never set;
 // eases the running wind layer without restarting nodes.
 setWind(strength){
  const value=Number(strength);
  this.windScale=Number.isFinite(value)?cl(value,0,3):null;
  if(!this.bed||!this.ctx)return this.windScale;
  const profile=BED_MOODS[this.bedMood]||BED_MOODS.default;
  if(this.bed.windG)try{this.bed.windG.gain.setTargetAtTime((profile.air||0)*this._windScale(profile)*(.5+this.bedScale*.5),this.ctx.currentTime,1.2);}catch{}
  return this.windScale;
 }
 // Optional surface resolver for movement foley. `fn(x,z,player)` returns an
 // authored material string (or null); called only for the local player's
 // footsteps, landings, jumps and slides, so it can safely hit the terrain.
 setSurfaceResolver(fn){this.surfaceResolver=typeof fn==='function'?fn:null;return this.surfaceResolver;}
 _surfaceFor(player,opts){
  if(opts&&typeof opts.surface==='string')return opts.surface;
  if(player&&typeof player.surface==='string')return player.surface;
  if(opts&&typeof opts.surfaceAt==='function'&&player){try{const s=opts.surfaceAt(player.x||0,player.z||0);if(s)return s;}catch{}}
  if(this.surfaceResolver&&player){try{const s=this.surfaceResolver(player.x||0,player.z||0,player);if(s)return s;}catch{}}
  return null;
 }
 setAmbient(on){this.ambientBed=on!==false;if(!this.ctx)return;this._bed(this.ambientBed&&!this.muted);}
 // Ease the running ambience bed toward a biome mood without restarting nodes.
 // When the bed is not running yet the mood is remembered for the next start.
 setBedMood(mood){
  this.bedMood=BED_MOODS[mood]?mood:'default';
  if(!this.bed||!this.ctx)return this.bedMood;
  const profile=BED_MOODS[this.bedMood],t=this.ctx.currentTime;
  try{this.bed.f.frequency.setTargetAtTime(profile.filter,t,1.2);this.bed.osc.frequency.setTargetAtTime(profile.tone,t,1.2);this.bed.g.gain.setTargetAtTime(profile.gain,t,1.2);this.bed.og.gain.setTargetAtTime(profile.sub,t,1.2);}catch{}
  try{
   if(this.bed.windF)this.bed.windF.frequency.setTargetAtTime(profile.windFreq||520,t,1.4);
   if(this.bed.windG)this.bed.windG.gain.setTargetAtTime((profile.air||0)*this._windScale(profile)*(.5+this.bedScale*.5),t,1.4);
   if(this.bed.tenseOsc)this.bed.tenseOsc.frequency.setTargetAtTime(profile.tenseFreq||58,t,1.4);
   if(this.bed.tenseG)this.bed.tenseG.gain.setTargetAtTime((profile.tense||0)*this.intensity*this.intensity,t,1.2);
  }catch{}
  return this.bedMood;
 }
 // Combat intensity drives the soundtrack arrangement (exploration vs combat
 // layering) and lets the ambience bed duck so gunfire cuts through. It never
 // starts or stops the soundtrack: music plays continuously once enabled.
 setIntensity(value){
  const next=cl(Number(value)||0,0,1);this.intensity=next;
  this.musicEngine?.setIntensity(next);
  this.musicEngine?.setScene(this.scene==='menu'?'menu':(next>=.34?'combat':'explore'));
  this.bedScale=.55+next*.55;
  if(this.ctx&&this.bed){const profile=BED_MOODS[this.bedMood]||BED_MOODS.default,t=this.ctx.currentTime;try{this.bed.g.gain.setTargetAtTime(profile.gain*this.bedScale,t,.5);this.bed.og.gain.setTargetAtTime(profile.sub*this.bedScale,t,.55);}catch{}try{if(this.bed.windG)this.bed.windG.gain.setTargetAtTime((profile.air||0)*this._windScale(profile)*(.5+this.bedScale*.5),t,.6);if(this.bed.tenseG)this.bed.tenseG.gain.setTargetAtTime((profile.tense||0)*next*next,t,.7);}catch{}}
  return this.intensity;
 }
 // Select the tonal centre for a game mode. Every soundtrack layer reads the
 // shared theme, so switching modes retunes the music without restarting nodes.
 setModeTheme(mode){
  const key=typeof mode==='string'&&MODE_THEMES[mode]?mode:'default';
  this.mode=key;
  // The Halo soundtrack owns a single modal tonal centre; mode themes still
  // apply to the baseline soundtrack and to outcome stings.
  this.theme=(this.soundtrack==='halo')?HALO_THEME:MODE_THEMES[key];
  if(this.soundtrack==='halo')this.musicEngine?.setSoundtrack('halo');else this.musicEngine?.setTheme(this.theme);
  return key;
 }
 // Advance the soundtrack scheduler. Called once per rendered frame from the
 // host so note timing is driven by the AudioContext clock, not the frame rate.
 tick(){return this.musicEngine?.tick?.()??0;}
 // Victory/defeat sting: a short arpeggio built from the active mode scale. It
 // reuses the shared voice cap and disposal path, and is a no-op when muted or
 // when the context has not started.
 sting(outcome){
  const cue=STING_CUES[outcome];if(!cue)return null;
  if(!this.ctx||this.muted)return {outcome,played:false};
  const scale=this.theme?.scale||MODE_THEMES.default.scale,root=this.theme?.root??58;
  const freq=step=>root*Math.pow(2,(scale[step%scale.length]+12*(cue.octave-1))/12);
  this._play(cue.length+(cue.notes.length-1)*cue.step+.3,0,(t,out,nodes)=>{
   cue.notes.forEach((step,i)=>{const f=freq(step);this._tone(t+i*cue.step,out,nodes,{freq:f,duration:cue.length,type:cue.type,gain:cue.gain,end:f*cue.end});});
   // Low body drone plus a brief upper shimmer so the resolution reads even
   // when a firefight overlaps the last note. Still one voice token.
   this._tone(t,out,nodes,{freq:root*.5,duration:.5,type:'sine',gain:outcome==='victory'?.05:.04,end:root*.52});
   this._noise(t+.02,out,nodes,{duration:.32,gain:outcome==='victory'?.07:.055,type:'highpass',freq:2800,sweep:1200,q:.6,attack:.02});
  },{send:.28});
  this.lastSting=outcome;
  // Duck the soundtrack under the sting so the result reads clearly, then ease
  // it back. The timer is cleared on disposal so it cannot outlive the engine.
  this.musicEngine?.setDuck(1);
  if(this._stingDuckTimer)clearTimeout(this._stingDuckTimer);
  this._stingDuckTimer=setTimeout(()=>{this._stingDuckTimer=null;this.musicEngine?.setDuck(0);},1400);
  return {outcome,played:true};
 }
 setAnnouncer(on){this.announcer=on===true;return this.announcer;}
 // Music on/off is independent of the global mute: disabling it silences and
 // pauses only the soundtrack, while effects, ambience and the announcer keep
 // playing. Re-enabling attempts an autoplay unlock and resumes scheduling.
 setMusicEnabled(on){
  this.musicEnabled=on!==false;
  this.musicEngine?.setEnabled(this.musicEnabled);
  if(this.musicEnabled)this.unlock();
  return this.musicEnabled;
 }
 // Optional announcer cue: a short two-note motif keyed by mode event. A short
 // per-cue cooldown dedupes the two event paths that can report the same moment
 // (view effect dispatch and the HUD snapshot), so one event makes one sound.
 announcerCue(type){
  const cue=ANNOUNCE_CUES[type];if(!cue)return null;
  if(!this.announcer||!this.ctx||this.muted)return {cue:cue.id,played:false};
  const now=this.ctx.currentTime||0;
  const last=this._announceAt.get(cue.id);
  if(Number.isFinite(last)&&now-last<.25)return {cue:cue.id,played:false,deduped:true};
  this._announceAt.set(cue.id,now);
  const mid=cue.mid??cue.end;
  this._play(cue.length+.1,0,(t,out,nodes)=>{this._tone(t,out,nodes,{freq:cue.freq,duration:cue.length*.45,type:'triangle',gain:.06,end:mid});this._tone(t+cue.length*.5,out,nodes,{freq:mid,duration:cue.length*.45,type:'triangle',gain:.05,end:cue.end});this._tone(t+cue.length*.82,out,nodes,{freq:cue.end,duration:cue.length*.32,type:'sine',gain:.035,end:cue.end*1.06});});
  this.lastCue=cue.id;return {cue:cue.id,played:true};
 }
  // Spectator audio follows the watched actor as well as the local player.
  _isLocal(e,player){if(!e||!player)return false;if(e.actor===player.id||e.actorId===player.id||e.driver===player.id||Boolean(e.occupants?.includes(player.id)))return true;return Boolean(player.spectator===true&&player.spectatorTarget!=null&&(e.actor===player.spectatorTarget||e.actorId===player.spectatorTarget||e.driver===player.spectatorTarget||e.occupants?.includes(player.spectatorTarget)));}
 _isScorer(source,player){if(source==null||!player)return false;return source===player.id||(player.spectator===true&&player.spectatorTarget!=null&&source===player.spectatorTarget);}
 // Confirmation chirp layered into the death voice: a short rising pair so a
 // scoring player hears the kill without spending a second voice slot.
 _killConfirm(t,out,nodes,vol=1){const gain=Math.min(.1,.075*vol);this._tone(t+.02,out,nodes,{freq:1180,duration:.08,type:'triangle',gain,end:1860});this._tone(t+.09,out,nodes,{freq:1660,duration:.07,type:'sine',gain:gain*.7,end:840});}
  _makeNoise(){const ctx=this.ctx,length=Math.max(1,Math.floor(ctx.sampleRate)),buffer=ctx.createBuffer(1,length,ctx.sampleRate),data=buffer.getChannelData(0);let last=0;for(let i=0;i<length;i++){const white=Math.random()*2-1;last=(last+.02*white)/1.02;data[i]=white*.75+last*.5;}return buffer;}
  _dest(pan){const out=this.ctx.createStereoPanner?this.ctx.createStereoPanner():this.ctx.createGain();if(out.pan)out.pan.value=cl(pan||0,-1,1);out.connect(this.effectsBus||this.master);return out;}
  _play(duration,pan,build,opts){if(!this.ctx||this.muted||this.voices.size>=30)return;const t=this.ctx.currentTime,out=this._dest(pan),nodes=[out],token={nodes};if(opts&&opts.send>0&&this.space){try{const snd=this.ctx.createGain();snd.gain.value=cl(Number(opts.send)||0,0,1);out.connect(snd);snd.connect(this.space.send);nodes.push(snd);}catch{}}build(t,out,nodes);this.voices.add(token);token.timer=setTimeout(()=>{for(const n of nodes){try{n.disconnect();}catch{}}this.voices.delete(token);},Math.max(30,(duration+.15)*1000));}
  _noise(t,out,nodes,{duration=.08,gain=.1,type='bandpass',freq=800,q=1,sweep=null,attack=.002}){if(!this.ctx||!this.ctx.createBufferSource)return;const src=this.ctx.createBufferSource();src.buffer=this.noiseBuffer;src.loop=true;const f=this.ctx.createBiquadFilter();f.type=type;f.frequency.setValueAtTime(Math.max(30,freq),t);f.Q.value=q;if(sweep)f.frequency.exponentialRampToValueAtTime(Math.max(30,sweep),t+duration);const g=this.ctx.createGain();g.gain.setValueAtTime(.0001,t);g.gain.linearRampToValueAtTime(Math.max(.0002,gain),t+attack);g.gain.exponentialRampToValueAtTime(.0001,t+duration);src.connect(f);f.connect(g);g.connect(out);src.start(t);src.stop(t+duration+.03);nodes.push(src,f,g);}
  _tone(t,out,nodes,{freq,duration=.08,type='sine',gain=.05,end=0,attack=.003}){const o=this.ctx.createOscillator();o.type=type;o.frequency.setValueAtTime(Math.max(20,freq),t);if(end)o.frequency.exponentialRampToValueAtTime(Math.max(20,end),t+duration);const g=this.ctx.createGain();g.gain.setValueAtTime(.0001,t);g.gain.linearRampToValueAtTime(Math.max(.0002,gain),t+attack);g.gain.exponentialRampToValueAtTime(.0001,t+duration);o.connect(g);g.connect(out);o.start(t);o.stop(t+duration+.03);nodes.push(o,g);}
 tone(freq,duration=.08,type='sine',gain=.04,end=0){this._play(duration,0,(t,out,nodes)=>this._tone(t,out,nodes,{freq,duration,type,gain,end,attack:.006}));}
  _panFor(pos,player){if(!pos||!player||!Number.isFinite(pos.x)||!Number.isFinite(player.x))return 0;const dx=pos.x-(player.x||0),dz=pos.z-(player.z||0),dist=Math.hypot(dx,dz)||1,rx=Math.cos(player.yaw||0),rz=-Math.sin(player.yaw||0);return cl((dx*rx+dz*rz)/dist*.9,-1,1);}
  _falloff(pos,player,max=36){if(!pos||!Number.isFinite(pos.x))return 0;if(!player||!Number.isFinite(player.x))return 1;return Math.max(0,1-Math.hypot(pos.x-(player.x||0),pos.z-(player.z||0))/max);}
  _click(pan,vol=1,gain=.06,freq=1600){this._play(.09,pan,(t,out,nodes)=>{this._noise(t,out,nodes,{duration:.03,gain:gain*vol,type:'highpass',freq:900,sweep:freq});this._tone(t,out,nodes,{freq:freq*.8,duration:.03,type:'square',gain:.02*vol,end:200});});}
  _gunshot(e,local,pan,vol,player){
   const feel=WEAPONS[e.weapon]?.feel||{},s=e.type==='launch'?feel.launch:feel.shot,style=GUN_STYLES[e.weapon]||'rifle',[freq,duration,type,gain]=s||REPORTS[e.weapon]||REPORTS[0],d=cl((duration||.08)*1.5,.06,.3);
   const shape=reportStyle(style);
   const seed=eventSeed(e)||(this.reportSerial=(this.reportSerial+1)>>>0);
   const vary=reportVariation(style,seed);
   // Distance shaping: a far report keeps its body but loses its high end, so
   // distant fights stay audible without the fatigue of full-bright cracks.
   const near=cl(vol,0,1),bright=.55+.45*near,base=Math.max(60,(freq||320)*shape.pitch*vary.pitch),heavy=style==='heavy',tail=shape.tail*vary.tail;
   this._play(d+.08+shape.tail*.12,pan,(t,out,nodes)=>{
    // Layered report: transient crack, filtered body, tonal thump, sub, one
    // family layer and a decaying tail. Still exactly one voice token per shot,
    // so automatic fire cannot grow the voice count.
    this._noise(t,out,nodes,{duration:.032,attack:.0006,gain:.6*vol*shape.transient*bright,type:heavy?'lowpass':'highpass',freq:heavy?Math.max(90,base*.9):base*1.5*vary.bright,sweep:heavy?160:base*.6});
    this._noise(t,out,nodes,{duration:.06,gain:.34*vol*shape.body,type:heavy?'lowpass':'bandpass',freq:heavy?Math.max(120,base*.6):base*.75,q:.9,sweep:heavy?110:Math.max(50,base*.3)});
    this._tone(t,out,nodes,{freq:base,duration:Math.min(.14,d*.8),type:type||'square',gain:Math.min(.3,(gain||.05)*vol*3.2),end:style==='zap'?base*2.2:Math.max(40,base*.55)});
    this._tone(t,out,nodes,{freq:Math.max(60,base*.45),duration:Math.min(.2,d),type:'sine',gain:vol*shape.sub,end:50});
    if(shape.layers==='sizzle')this._noise(t+.01,out,nodes,{duration:.14,gain:.22*vol*bright,type:'bandpass',freq:1800,sweep:5200,q:.9});
    else if(shape.layers==='double')this._noise(t+.055,out,nodes,{duration:.09,gain:.3*vol,type:'lowpass',freq:520,sweep:200,q:.7});
    else if(shape.layers==='bloom'){this._noise(t+.02,out,nodes,{duration:.16,gain:.24*vol,type:'lowpass',freq:1200,sweep:460,q:.6});this._tone(t+.03,out,nodes,{freq:260,duration:.18,type:'triangle',gain:.12*vol,end:1200});}
    else if(shape.layers==='crack')this._noise(t+.005,out,nodes,{duration:.04,gain:.45*vol,type:'bandpass',freq:2200,sweep:800,q:1.8});
    else if(shape.layers==='tight')this._noise(t+.012,out,nodes,{duration:.03,gain:.35*vol,type:'highpass',freq:1400,sweep:600});
    else if(shape.layers==='supersonic')this._noise(t+.02,out,nodes,{duration:.05,gain:.2*vol,type:'highpass',freq:2600,sweep:900});
    if(tail>.04)this._noise(t+.03,out,nodes,{duration:.08+.22*tail,gain:.12*vol*tail,type:'bandpass',freq:shape.tailFreq*bright,sweep:shape.tailFreq*.4,q:.55,attack:.02});
    // Surface-aware impact/ricochet at the endpoint when the shot hit geometry.
    // A truthy `hit` is an actor and is already confirmed by the damage event.
    if((e.hit==null||e.hit===false)&&e.to&&Number.isFinite(e.to.x)&&player){
     const dist=Math.hypot((e.to.x||0)-(player.x||0),(e.to.z||0)-(player.z||0));
     const iv=(local?Math.max(0,.5*(1-dist/26)):Math.max(0,1-dist/30)*.8)*vol;
     if(iv>.02)this._impact(t+.012,out,nodes,{vol:iv,surface:e.surface??e.material,ricochet:dist>12});
    }
   },{send:(.2+.3*Math.min(1,tail))*vol});
  }
  // Surface-aware bullet impact/ricochet: one transient, one material tick, an
  // optional ricochet whine and up to three debris ticks. Bounded per impact.
  _impact(t,out,nodes,{vol=1,surface=null,ricochet=false}={}){
   const p=impactProfile(surface),v=cl(vol,0,1),decay=p.decay??1;
   this._noise(t,out,nodes,{duration:.045*decay,attack:.0008,gain:p.gain*v,type:p.type,freq:p.freq*(ricochet?1.35:1),sweep:p.freq*.45,q:p.q});
   this._tone(t,out,nodes,{freq:p.tone,duration:.05*decay,type:'square',gain:Math.min(.06,p.gain*.22*v),end:p.end});
   if(p.ring)this._tone(t+.005,out,nodes,{freq:p.ring*(ricochet?1.12:1),duration:.18*decay,type:'sine',gain:Math.min(.05,.03*v),end:p.ring*.55});
   if(p.splash)this._noise(t+.01,out,nodes,{duration:.09,gain:p.gain*.5*v,type:'bandpass',freq:1500,sweep:500,q:.7});
   const debris=Math.min(3,Math.round(p.debris||0));
   for(let i=0;i<debris;i++)this._noise(t+.02+i*.035,out,nodes,{duration:.03,gain:p.gain*.3*v,type:'bandpass',freq:p.freq*(.6+i*.25),sweep:p.freq*.3,q:1});
  }
  // Match-beat motif player: one voice token, retuned to the active mode root,
  // with an optional filtered shimmer. Bounded to the motif's note count.
  _beat(cue,pan,vol=1,tailSend=.22){
   if(!cue||vol<=.02)return;
   const root=this.theme?.root??58,notes=cue.notes||[];
   this._play(cue.length+(notes.length-1)*cue.step+.12,pan,(t,out,nodes)=>{
    notes.forEach((semi,i)=>{const f=root*Math.pow(2,Number(semi)/12);this._tone(t+i*cue.step,out,nodes,{freq:f,duration:cue.length,type:cue.type||'triangle',gain:(cue.gain||.06)*vol,end:f*1.42});});
    if(cue.shimmer)this._noise(t+.01,out,nodes,{duration:.24,gain:.05*vol,type:'highpass',freq:3000,sweep:1400,q:.6,attack:.015});
   },{send:tailSend*vol});
  }
  // Mounted chaingun: a heavier, layered thump so it reads differently from the
  // pulse rifle. Slight per-shot pitch wobble gives the spinning-barrel texture.
  _chaingun(pan,vol=1){if(!this.ctx)return;const now=this.ctx.currentTime;if(now-(this.lastChain||0)<.03)return;this.lastChain=now;const pitch=.92+Math.random()*.18;this._play(.15,pan,(t,out,nodes)=>{this._noise(t,out,nodes,{duration:.05,gain:.62*vol,type:'lowpass',freq:1500*pitch,sweep:320,q:.85,attack:.001});this._noise(t,out,nodes,{duration:.028,gain:.34*vol,type:'highpass',freq:2600*pitch,sweep:5600,q:.6,attack:.001});this._tone(t,out,nodes,{freq:150*pitch,duration:.06,type:'square',gain:.22*vol,end:58});this._tone(t,out,nodes,{freq:66*pitch,duration:.11,type:'sine',gain:.26*vol,end:34});this._noise(t+.035,out,nodes,{duration:.13,gain:.12*vol,type:'bandpass',freq:900*pitch,sweep:340,q:.6,attack:.015});},{send:.26*vol});}
 // Per-weapon reload foley. The counter drives three deterministic sequences so
 // repeated reloads do not sound mechanical; voice cap and disposal are inherited
 // from _play/_click.
 _reload(weapon,state){
  if(state!=='start')return;
  this.reloadVariant=(this.reloadVariant+1)%3;
  const kick=WEAPONS[weapon]?.feel?.kick?.[2]??16,heavy=kick<14,delay=heavy?260:200;
  this._click(0,1,.06,heavy?950:1200);
  setTimeout(()=>{if(this.ctx&&!this.muted){this._click(0,1,.05,heavy?1500:1750);if(this.reloadVariant===2)this.tone(heavy?180:320,.05,'square',.02,heavy?120:220);}},delay);
 }
 // Melee whoosh plus a surface-aware impact crack when it connects. The
 // 260 Hz whoosh sweep is the pinned melee identity; the impact layers below it
 // vary with the surface under the swing.
 _melee(weapon,hit,surface){
  this._play(.24,0,(t,out,nodes)=>{this._noise(t,out,nodes,{duration:.16,gain:.22,type:'bandpass',freq:900,sweep:260,q:.7});this._tone(t,out,nodes,{freq:220,duration:.12,type:'triangle',gain:.08,end:90});if(hit){this._noise(t+.05,out,nodes,{duration:.09,gain:.3,type:'lowpass',freq:700,sweep:200,q:.8});this._impact(t+.07,out,nodes,{vol:.9,surface});}},{send:.2});
 }
  // Distant thunder: a low, filtered rumble with a delayed onset and stereo
  // pan. Distance (0..1) controls the delay, brightness and gain so a close
  // strike cracks and a far one rolls. Reuses the shared voice cap/disposal.
  thunder({distance=.6,pan=0,intensity=1}={}){
   if(!this.ctx||this.muted)return false;
   const d=cl(Number(distance)||0,0,1),vol=cl(Number(intensity)||0,0,1)*(1-d*.55);
   if(vol<=.02)return false;
   const delay=.06+d*1.5;
   setTimeout(()=>{if(!this.ctx||this.muted)return;this._play(.9+d*.7,pan,(t,out,nodes)=>{
    // Close strikes get a supersonic crack before the body; the tail rolls into
    // the shared space delay so far thunder trails across the arena.
    if(d<.45)this._noise(t,out,nodes,{duration:.08,attack:.001,gain:.34*vol*(1-d*2),type:'highpass',freq:1800,sweep:500});
    this._noise(t,out,nodes,{duration:.55+d*.5,gain:.42*vol,type:'lowpass',freq:420-d*220,sweep:70+d*40,q:.7,attack:.02});
    this._noise(t+.08,out,nodes,{duration:.3,gain:.2*vol,type:'lowpass',freq:180,sweep:60,q:.8,attack:.03});
    this._noise(t+.3,out,nodes,{duration:.5+d*.4,gain:.12*vol,type:'bandpass',freq:300-d*80,sweep:120,q:.5,attack:.05});
    this._tone(t,out,nodes,{freq:52-d*12,duration:.7+d*.5,type:'sine',gain:.3*vol,end:26});
    this._tone(t,out,nodes,{freq:38-d*8,duration:.85+d*.5,type:'sine',gain:.14*vol,end:22});
   },{send:.4*vol});},Math.round(delay*1000));
   return true;
  }
  // Landing thump scaled by impact speed and surface. The variant shifts the
  // body tone so repeated jumps do not phase into one sample; default surface
  // numbers are unchanged from phase 1.
  _landing(impact,weapon,surface){
  this.landVariant=(this.landVariant+1)%3;
  const sp=footstepProfile(surface),heavy=(WEAPONS[weapon]?.feel?.kick?.[2]??16)<12;
  this._play(.14,0,(t,out,nodes)=>{this._noise(t,out,nodes,{duration:.1,gain:(.05+.16*impact)*sp.gain,type:'lowpass',freq:420*sp.bright,sweep:160,q:.8*sp.q});this._tone(t,out,nodes,{freq:((heavy?76:90)+this.landVariant*8)*sp.body,duration:.12,type:'sine',gain:.05+.1*impact,end:45});if(sp.ring)this._tone(t+.01,out,nodes,{freq:sp.ring,duration:.1,type:'triangle',gain:.03+.04*impact,end:sp.ring*.5});if(sp.splash)this._noise(t+.015,out,nodes,{duration:.08,gain:(.04+.1*impact)*sp.gain,type:'bandpass',freq:1400,sweep:420,q:.7});});
 }
 // Footstep variant selection rotates deterministically per step; the weapon
 // family biases the frequency and the surface profile shapes the band, body
 // and optional ring/debris layers so metal, wood, sand etc. read distinctly.
 _footstep(speed,weapon,surface){
  this.stepVariant=(this.stepVariant+1)%3;
  const sp=footstepProfile(surface),heavy=(WEAPONS[weapon]?.feel?.kick?.[2]??16)<12,vol=Math.min(.13*sp.gain,(.03+speed*.012)*sp.gain);
  this._play(.09,0,(t,out,nodes)=>{
   this._noise(t,out,nodes,{duration:.06,gain:vol,type:'lowpass',freq:((heavy?620:800)*sp.bright)+this.stepVariant*90+Math.min(700,speed*45),sweep:360,q:.9*sp.q});
   this._tone(t,out,nodes,{freq:((heavy?90:110)*sp.body)+this.stepVariant*10,duration:.05,type:'sine',gain:vol*.5,end:60});
   if(sp.ring)this._tone(t+.008,out,nodes,{freq:sp.ring,duration:.07,type:'triangle',gain:vol*.5,end:sp.ring*.6});
   if(sp.splash)this._noise(t+.012,out,nodes,{duration:.07,gain:vol*.8,type:'bandpass',freq:1500,sweep:520,q:.7});
   const scatter=Math.min(3,Math.round(sp.scatter||0));
   for(let i=0;i<scatter;i++)this._noise(t+.018+i*.028,out,nodes,{duration:.025,gain:vol*.55,type:'bandpass',freq:1100*(.7+i*.3),sweep:380,q:1});
  });
 }
 // Take-off foley: gear/cloth push without a voice. One token per jump.
 _jump(surface,weapon){
  this.jumpVariant=(this.jumpVariant+1)%3;
  const sp=footstepProfile(surface),heavy=(WEAPONS[weapon]?.feel?.kick?.[2]??16)<12;
  this._play(.16,0,(t,out,nodes)=>{
   this._noise(t,out,nodes,{duration:.12,gain:heavy?.16:.11,type:'bandpass',freq:(heavy?520:680)*sp.bright+this.jumpVariant*40,sweep:300,q:.6});
   this._tone(t,out,nodes,{freq:((heavy?120:150)*sp.body)+this.jumpVariant*6,duration:.08,type:'triangle',gain:.05,end:70});
   if(sp.ring)this._tone(t+.008,out,nodes,{freq:sp.ring*.7,duration:.07,type:'triangle',gain:.03,end:sp.ring*.4});
  });
 }
 // Sliding friction tick, surface-aware; called on a bounded cadence from
 // update() so a long slide never grows the voice count.
 _slide(speed,surface){
  const sp=footstepProfile(surface),vol=Math.min(1,speed/7);
  this._play(.17,0,(t,out,nodes)=>{
   this._noise(t,out,nodes,{duration:.13,gain:.16*vol*sp.gain,type:'bandpass',freq:950*sp.bright,sweep:450,q:.7});
   this._noise(t+.02,out,nodes,{duration:.1,gain:.07*vol,type:'highpass',freq:1800,sweep:600,q:.6});
   if(sp.ring)this._tone(t,out,nodes,{freq:sp.ring*.6,duration:.08,type:'triangle',gain:.02*vol,end:sp.ring*.3});
   if(sp.scatter)this._noise(t+.04,out,nodes,{duration:.05,gain:.06*vol,type:'bandpass',freq:1200,sweep:420,q:.9});
  });
 }
 // Bounded debris tail for explosions: up to `cap` deterministic chips.
 _debris(t,out,nodes,{vol=1,seed=0,cap=4}={}){
  const n=Math.max(0,Math.min(4,Math.round(cap)));
  for(let i=0;i<n;i++){
   const u=mixUnit((seed>>>0)+i*97);
   this._noise(t+.12+u*.5,out,nodes,{duration:.06+u*.08,gain:.16*vol*(1-i/Math.max(1,n)*.5),type:'bandpass',freq:500+u*1800,sweep:180+u*260,q:.8,attack:.004});
  }
 }
 event(e,player){if(!this.ctx||!e||!player)return;const local=this._isLocal(e,player),pos=e.from??e.pos,pan=this._panFor(pos,player);
  if(e.type==='shot'||e.type==='vehicle-shot'||e.type==='launch'){const same=this.lastReport&&e.time!=null&&this.lastReport.time===e.time&&this.lastReport.actor===e.actor&&this.lastReport.weapon===e.weapon&&this.lastReport.type===e.type;this.lastReport=e;if(same)return;const vehicle=e.type==='vehicle-shot',vol=local?1:this._falloff(pos,player,vehicle?42:34)*(vehicle?.95:.9);if(vol>.01){if(vehicle)this._chaingun(pan,vol);else this._gunshot(e,local,pan,vol,player);}return;}
  if(e.type==='dryfire'){if(local)this._click(0,1,.08,1500);return;}
  if(e.type==='grenade'){const vol=local?1:this._falloff(pos,player,24);if(vol>.02)this._play(.18,pan,(t,out,nodes)=>{this._click(pan,vol,.06,1400);this._noise(t+.02,out,nodes,{duration:.12,gain:.22*vol,type:'bandpass',freq:800,sweep:300,q:.8});this._tone(t+.03,out,nodes,{freq:280,duration:.1,type:'triangle',gain:.08*vol,end:140});});return;}
  if(e.type==='explosion'){const vol=this._falloff(pos,player,42);if(vol>.02){const seed=eventSeed(e);this._play(.85,pan,(t,out,nodes)=>{this._noise(t,out,nodes,{duration:.5,gain:.8*vol,type:'lowpass',freq:900,sweep:60,q:.8});this._noise(t,out,nodes,{duration:.05,attack:.001,gain:.5*vol,type:'highpass',freq:2400,sweep:600});this._tone(t,out,nodes,{freq:120,duration:.5,type:'sine',gain:.35*vol,end:34});this._tone(t,out,nodes,{freq:60,duration:.75,type:'sine',gain:.3*vol,end:28});this._debris(t,out,nodes,{vol,seed,cap:Math.round(vol*3.4)});},{send:.45*vol});}return;}
  if(e.type==='damage'){this.lastDamage=e;if(this._isLocal(e,player)){this._play(e.shieldBreak?.24:.18,0,(t,out,nodes)=>{this._noise(t,out,nodes,{duration:.14,gain:.4,type:'lowpass',freq:700,sweep:200,q:.7});this._tone(t,out,nodes,{freq:150,duration:.14,type:'triangle',gain:.18,end:60});if(e.shieldBreak){this._noise(t,out,nodes,{duration:.2,gain:.42,type:'bandpass',freq:1800,sweep:300,q:1.2});this._tone(t+.02,out,nodes,{freq:260,duration:.18,type:'sawtooth',gain:.2,end:55});this._tone(t+.03,out,nodes,{freq:2100,duration:.16,type:'triangle',gain:.14,end:620});this._noise(t+.04,out,nodes,{duration:.12,gain:.2,type:'highpass',freq:3200,sweep:900,q:.8});}if(e.critical||e.headshot)this._noise(t+.01,out,nodes,{duration:.03,gain:.2,type:'highpass',freq:2600,sweep:4200});});}else if(this._isScorer(e.source,player)&&e.amount>0){const stamp=this.ctx.currentTime;if(stamp-this.lastHit>=.045){this.lastHit=stamp;const crit=Boolean(e.critical||e.headshot||Number(e.amount)>=48);this._play(crit?.16:.12,0,(t,out,nodes)=>{if(crit){this._noise(t,out,nodes,{duration:.04,gain:.28,type:'highpass',freq:2200,sweep:3600});this._tone(t,out,nodes,{freq:1950,duration:.11,type:'triangle',gain:.16,end:2600});this._tone(t+.02,out,nodes,{freq:2900,duration:.09,type:'sine',gain:.11,end:3400});this._tone(t+.04,out,nodes,{freq:140,duration:.11,type:'sine',gain:.09,end:70});}else{this._noise(t,out,nodes,{duration:.05,gain:.26,type:'highpass',freq:1600,sweep:2600});this._tone(t,out,nodes,{freq:1250,duration:.07,type:'sine',gain:.11,end:1800});this._tone(t+.02,out,nodes,{freq:180,duration:.07,type:'sine',gain:.06,end:90});}if(e.shieldBreak){this._noise(t,out,nodes,{duration:.12,gain:.32,type:'bandpass',freq:2400,sweep:600,q:1.4});this._tone(t+.01,out,nodes,{freq:1600,duration:.1,type:'sawtooth',gain:.12,end:400});this._tone(t+.03,out,nodes,{freq:900,duration:.14,type:'triangle',gain:.1,end:1800});}});} }return;}
  if(e.type==='death'){const vol=local?1:this._falloff(pos,player,32);if(vol>.02)this._play(.6,pan,(t,out,nodes)=>{this._noise(t,out,nodes,{duration:.4,gain:.35*vol,type:'lowpass',freq:1200,sweep:120,q:.7});this._tone(t,out,nodes,{freq:local?220:180,duration:.45,type:'sawtooth',gain:.12*vol,end:40});this._noise(t+.05,out,nodes,{duration:.22,gain:.16*vol,type:'bandpass',freq:700,sweep:200,q:.6});if(this._isScorer(e.source,player)&&e.source!==e.actor&&e.actor!==player.id)this._killConfirm(t,out,nodes,vol);},{send:.3*vol});return;}
  if(e.type==='fall'){const vol=local?1:this._falloff(pos,player,26);if(vol>.03)this._play(.34,pan,(t,out,nodes)=>{this._noise(t,out,nodes,{duration:.28,gain:.26*vol,type:'lowpass',freq:600,sweep:120,q:.7,attack:.03});this._tone(t,out,nodes,{freq:74,duration:.3,type:'sine',gain:.14*vol,end:30});});return;}
  if(e.type==='reload'){if(e.actor===player.id)this._reload(e.weapon??player.weapon,e.state);return;}
  if(e.type==='melee'){if(e.actor===player.id)this._melee(e.weapon??player.weapon,e.hit!=null,e.surface??e.material);return;}
  if(e.type==='weapon-switch'){if(e.actor===player.id)this._click(0,1,.05,1900);return;}
  if(e.type==='vehicle-splatter'){const vol=local?1:this._falloff(pos,player,26);if(vol>.02)this._play(.2,pan,(t,out,nodes)=>{this._noise(t,out,nodes,{duration:.16,gain:.5*vol,type:'lowpass',freq:600,sweep:180,q:.8});this._tone(t,out,nodes,{freq:95,duration:.16,type:'sine',gain:.2*vol,end:40});});return;}
  if(e.type==='vehicle-destroyed'){const vol=local?1:this._falloff(pos,player,42);if(vol>.02)this._play(.85,pan,(t,out,nodes)=>{this._noise(t,out,nodes,{duration:.6,gain:.8*vol,type:'lowpass',freq:750,sweep:50,q:.85});this._tone(t,out,nodes,{freq:85,duration:.55,type:'sawtooth',gain:.28*vol,end:25});this._tone(t,out,nodes,{freq:45,duration:.75,type:'sine',gain:.3*vol,end:20});this._noise(t+.06,out,nodes,{duration:.35,gain:.35*vol,type:'bandpass',freq:1400,sweep:300,q:.7});this._debris(t+.08,out,nodes,{vol,seed:eventSeed(e),cap:Math.round(vol*4)});},{send:.42*vol});return;}
  if(e.type==='vehicle-enter'){if(local)this._click(0,1,.08,800);return;}
  if(e.type==='vehicle-exit'){if(local)this._click(0,1,.07,700);return;}
  if(e.type==='soccer-goal'){const vol=local?1:(pos?Math.max(.35,this._falloff(pos,player,60)):.85);if(vol>.05){this._play(.65,pan,(t,out,nodes)=>{this._tone(t,out,nodes,{freq:220,duration:.6,type:'sawtooth',gain:.16*vol,end:220});this._tone(t,out,nodes,{freq:330,duration:.6,type:'triangle',gain:.14*vol,end:330});this._noise(t,out,nodes,{duration:.45,gain:.25*vol,type:'bandpass',freq:850,sweep:420,q:.8});},{send:.3*vol});}return;}
  if(e.type==='race-coin'){if(local||this._falloff(pos,player,20)>.1){this._play(.12,pan,(t,out,nodes)=>{this._tone(t,out,nodes,{freq:988,duration:.08,type:'sine',gain:.08,end:1318});this._tone(t+.03,out,nodes,{freq:1318,duration:.09,type:'triangle',gain:.06,end:1760});});}return;}
  if(e.type==='race-box'){const vol=local?1:this._falloff(pos,player,24);if(vol>.05){this._play(.25,pan,(t,out,nodes)=>{this._tone(t,out,nodes,{freq:520,duration:.12,type:'sine',gain:.08*vol,end:780});this._tone(t+.06,out,nodes,{freq:780,duration:.15,type:'triangle',gain:.07*vol,end:1175});});}return;}
  if(e.type==='race-boost'){const vol=local?1:this._falloff(pos,player,28);if(vol>.05){this._play(.35,pan,(t,out,nodes)=>{this._noise(t,out,nodes,{duration:.3,gain:.45*vol,type:'lowpass',freq:800,sweep:1800,q:.7});this._tone(t,out,nodes,{freq:180,duration:.25,type:'sawtooth',gain:.15*vol,end:420});});}return;}
  if(e.type==='race-item'){const vol=local?1:this._falloff(pos,player,28);if(vol>.05){this._play(.25,pan,(t,out,nodes)=>{if(e.item==='turbo'||e.item==='star'){this._noise(t,out,nodes,{duration:.22,gain:.4*vol,type:'bandpass',freq:1200,sweep:2400,q:.9});this._tone(t,out,nodes,{freq:240,duration:.2,type:'sawtooth',gain:.14*vol,end:580});}else if(e.item==='shield'){this._tone(t,out,nodes,{freq:440,duration:.24,type:'sine',gain:.12*vol,end:660});this._tone(t+.05,out,nodes,{freq:660,duration:.2,type:'triangle',gain:.08*vol,end:880});}else if(e.item==='pulse'||e.item==='triple'||e.item==='bolt'){this._noise(t,out,nodes,{duration:.15,gain:.3*vol,type:'highpass',freq:1800,sweep:3200});this._tone(t,out,nodes,{freq:720,duration:.18,type:'square',gain:.1*vol,end:1440});}else{this._noise(t,out,nodes,{duration:.18,gain:.35*vol,type:'lowpass',freq:600,sweep:120,q:.8});this._tone(t,out,nodes,{freq:140,duration:.15,type:'triangle',gain:.12*vol,end:50});}});}return;}
  if(e.type==='race-hazard-hit'){const vol=local?1:this._falloff(pos,player,26);if(vol>.05){this._play(.32,pan,(t,out,nodes)=>{this._noise(t,out,nodes,{duration:.28,gain:.4*vol,type:'bandpass',freq:1400,sweep:400,q:.6});this._tone(t,out,nodes,{freq:340,duration:.25,type:'sawtooth',gain:.15*vol,end:80});});}return;}
  if(e.type==='race-lap'){if(local){this._play(.4,0,(t,out,nodes)=>{this._tone(t,out,nodes,{freq:523,duration:.18,type:'triangle',gain:.09,end:659});this._tone(t+.1,out,nodes,{freq:659,duration:.22,type:'triangle',gain:.09,end:784});this._tone(t+.2,out,nodes,{freq:1046,duration:.25,type:'sine',gain:.08,end:1046});});}return;}
  if(e.type==='enemy-telegraph'){const vol=local?1:this._falloff(pos,player,30);if(vol>.03)this._play(.5,pan,(t,out,nodes)=>{this._tone(t,out,nodes,{freq:300,duration:.16,type:'square',gain:.07*vol,end:150});this._tone(t+.18,out,nodes,{freq:240,duration:.22,type:'square',gain:.06*vol,end:120});});return;}
  if(e.type==='race-finish'){if(local){this._play(.6,0,(t,out,nodes)=>{this._tone(t,out,nodes,{freq:440,duration:.2,type:'triangle',gain:.1,end:554});this._tone(t+.12,out,nodes,{freq:554,duration:.2,type:'triangle',gain:.1,end:659});this._tone(t+.24,out,nodes,{freq:880,duration:.35,type:'sine',gain:.12,end:880});});}return;}
  // Objective / pickup motifs. Flag and capture cues are deliberately audible
  // for every player (they are match beats); ordinary pickups stay local.
  if(e.type==='power'){if(!local)return;this._beat(POWER_CUES[e.harness]||objectiveCue('power'),pan,1,.25);if(this.announcer)this.announcerCue('power');return;}
  if(e.type==='pickup'||e.type==='powerup'||e.type==='spawn'||e.type.startsWith('flag')){if(!local&&e.type!=='flag-pickup'&&e.type!=='flag-drop'&&e.type!=='flag-return')return;this._beat(objectiveCue(e.type),pan,1,.25);return;}
  if(e.type==='capture'||EVENT_CUES[e.type]){const vol=local?1:(pos?Math.max(.2,this._falloff(pos,player,48)):.9);this._beat(EVENT_CUES[e.type]||objectiveCue('capture'),pan,vol,.3);return;}
  if(e.type.startsWith('zone')){const vol=local?1:(pos?Math.max(.2,this._falloff(pos,player,44)):.9);this._beat(objectiveCue('zone'),pan,vol,.24);return;}
  // Local ability/deployable foley and enemy ordnance, volume-shaped by distance.
  if(e.type==='dash'||e.type==='jam'||e.type==='feint'||e.type==='deployable'||e.type==='deployable-fire'||e.type==='deployable-expire'||e.type==='phalanx-shield'||e.type==='enemy-artillery'||e.type==='enemy-detonate'||e.type==='enemy-flank'){
   const vol=local?1:this._falloff(pos,player,28);if(vol>.03){
    if(e.type==='dash')this._play(.16,pan,(t,out,nodes)=>{this._noise(t,out,nodes,{duration:.12,gain:.22*vol,type:'bandpass',freq:1200,sweep:2600,q:.8});this._tone(t,out,nodes,{freq:180,duration:.1,type:'triangle',gain:.06*vol,end:80});});
    else if(e.type==='feint'){this._play(.2,pan,(t,out,nodes)=>{this._noise(t,out,nodes,{duration:.1,gain:.18*vol,type:'highpass',freq:2400,sweep:3600,q:.8});this._tone(t,out,nodes,{freq:660,duration:.16,type:'triangle',gain:.05*vol,end:220});});if(local&&this.announcer)this.announcerCue('feint');}
    else if(e.type==='jam')this._play(.3,pan,(t,out,nodes)=>{this._noise(t,out,nodes,{duration:.24,gain:.3*vol,type:'bandpass',freq:2400,sweep:400,q:1.4});this._tone(t,out,nodes,{freq:420,duration:.22,type:'square',gain:.08*vol,end:120});});
    else if(e.type==='phalanx-shield')this._play(.3,pan,(t,out,nodes)=>{this._noise(t,out,nodes,{duration:.2,gain:.28*vol,type:'bandpass',freq:1500,sweep:600,q:1.1});this._tone(t+.01,out,nodes,{freq:300,duration:.24,type:'triangle',gain:.1*vol,end:900});});
    else if(e.type==='enemy-artillery'||e.type==='enemy-detonate')this._play(.55,pan,(t,out,nodes)=>{this._noise(t,out,nodes,{duration:.38,gain:.5*vol,type:'lowpass',freq:700,sweep:70,q:.8});this._tone(t,out,nodes,{freq:95,duration:.3,type:'sawtooth',gain:.18*vol,end:30});this._debris(t,out,nodes,{vol,seed:eventSeed(e),cap:3});},{send:.35*vol});
    else if(e.type==='enemy-flank')this._beat(EVENT_CUES['enemy-flank'],pan,vol,.25);
    else this._play(.2,pan,(t,out,nodes)=>{this._noise(t,out,nodes,{duration:.14,gain:.24*vol,type:'bandpass',freq:1000,sweep:2200,q:.8});this._tone(t,out,nodes,{freq:220,duration:.12,type:'triangle',gain:.07*vol,end:440});});
   }return;
  }
  // Movement verbs (§3.4/§6.3): local-only foley keyed to the movement module's
  // shared event vocabulary, plus an opt-in announcer motif per verb.
  if(MOVEMENT_EVENTS.has(e.type)){
   if(!local)return;
   const verb=typeof e.verb==='string'&&e.verb.length?e.verb:null;
   if(e.type==='move-start')this._play(.22,pan,(t,out,nodes)=>{this._noise(t,out,nodes,{duration:.16,gain:.24,type:'bandpass',freq:900,sweep:2600,q:.7});this._tone(t,out,nodes,{freq:150,duration:.14,type:'triangle',gain:.05,end:320});});
   else if(e.type==='windup-start'||e.type==='charge-start'){const duration=Math.min(1,Math.max(.1,Number(e.duration)||.3));this._play(duration+.1,pan,(t,out,nodes)=>{this._tone(t,out,nodes,{freq:180,duration,type:'sawtooth',gain:.05,end:520});this._noise(t,out,nodes,{duration:.2,gain:.12,type:'bandpass',freq:600,sweep:1800,q:.8});});}
   else if(e.type==='slam-launch')this._play(.24,pan,(t,out,nodes)=>{this._noise(t,out,nodes,{duration:.18,gain:.28,type:'lowpass',freq:700,sweep:220,q:.7});this._tone(t,out,nodes,{freq:120,duration:.2,type:'triangle',gain:.1,end:420});});
   else if(e.type==='slam-impact')this._play(.42,pan,(t,out,nodes)=>{this._noise(t,out,nodes,{duration:.3,gain:.5,type:'lowpass',freq:520,sweep:90,q:.8});this._tone(t,out,nodes,{freq:70,duration:.32,type:'sine',gain:.22,end:28});this._debris(t,out,nodes,{vol:1,seed:eventSeed(e),cap:3});});
   else if(e.type==='grapple-hook')this._play(.18,pan,(t,out,nodes)=>{this._noise(t,out,nodes,{duration:.08,gain:.3,type:'bandpass',freq:1800,sweep:900,q:1.4});this._tone(t,out,nodes,{freq:260,duration:.14,type:'triangle',gain:.09,end:520});});
   else if(e.type==='rope-place')this._play(.3,pan,(t,out,nodes)=>{this._noise(t,out,nodes,{duration:.16,gain:.24,type:'bandpass',freq:1200,sweep:2600,q:.9});this._tone(t,out,nodes,{freq:520,duration:.22,type:'sine',gain:.1,end:780});});
   else if(e.type==='fuel-empty'||e.type==='no-lift'||e.type==='move-blocked')this._play(.16,pan,(t,out,nodes)=>{this._tone(t,out,nodes,{freq:220,duration:.1,type:'square',gain:.05,end:150});this._noise(t,out,nodes,{duration:.08,gain:.1,type:'lowpass',freq:700,sweep:300,q:.7});});
   else if(e.type==='landing-recovery')this._play(.18,pan,(t,out,nodes)=>{this._noise(t,out,nodes,{duration:.14,gain:.24,type:'lowpass',freq:500,sweep:150,q:.7,attack:.01});this._tone(t,out,nodes,{freq:90,duration:.16,type:'sine',gain:.12,end:36});});
   else this._play(.14,pan,(t,out,nodes)=>{this._noise(t,out,nodes,{duration:.1,gain:.14,type:'bandpass',freq:1100,sweep:420,q:.9});this._tone(t,out,nodes,{freq:200,duration:.1,type:'triangle',gain:.04,end:110});});
   if(this.announcer&&(e.type==='move-start'||e.type==='slam-impact'||e.type==='rope-place'))this.announcerCue(verb&&ANNOUNCE_CUES[verb]?verb:(e.type==='move-start'?'move-start':e.type));
   return;
  }
 }
  update(player,vehicles=[],dt=0,opts=null){if(!this.ctx||!player)return;if(this.muted){this._engine(0,false);this._bed(false);return;}if(!this.bed&&this.ambientBed!==false)this._bed(true);
  const surface=this._surfaceFor(player,opts);
  if(player.grounded&&this.wasGrounded===false&&player.vehicleId==null){const impact=cl(Math.abs(this.lastVy||0)/13,0,1);if(impact>.12)this._landing(impact,player.weapon,surface);}
  else if(!player.grounded&&this.wasGrounded===true&&player.vehicleId==null&&player.health>0)this._jump(surface,player.weapon);
  this.wasGrounded=player.grounded;this.lastVy=player.vy||0;
  const speed=Math.hypot(player.vx||0,player.vz||0);
  if(player.health>0&&player.vehicleId==null&&player.grounded===true){
    if(player.sliding&&speed>2){
      if(!this.wasSliding){
        this.footPhase=0;
        this._slide(speed,surface);
      }else{
        this.footPhase=(this.footPhase||0)+dt*8;
        if(this.footPhase>=1){this.footPhase-=1;this._slide(speed,surface);}
      }
    }else if(speed>1.4){
      this.footPhase=(this.footPhase||0)+dt*speed*.62;
      if(this.footPhase>=1){this.footPhase-=1;this._footstep(speed,player.weapon,surface);}
    }else this.footPhase=0;
  }else this.footPhase=0;
  this.wasSliding=Boolean(player.sliding&&player.grounded&&speed>2&&player.health>0&&player.vehicleId==null);
  const isLowHealth=Boolean(player.health>0&&player.health<=(player.maxHealth??100)*.28&&player.vehicleId==null&&!this.muted);
  if(isLowHealth){
    this.heartbeatTimer=(this.heartbeatTimer||0)+dt;
    if(!this.wasLowHealth||this.heartbeatTimer>=1.15){
      this.heartbeatTimer=0;
      this._play(.22,0,(t,out,nodes)=>{
        this._tone(t,out,nodes,{freq:54,duration:.07,type:'sine',gain:.13,end:32});
        this._tone(t+.1,out,nodes,{freq:46,duration:.09,type:'sine',gain:.15,end:26});
      });
    }
  }else{
    this.heartbeatTimer=0;
  }
  this.wasLowHealth=isLowHealth;
  const vehicle=(vehicles||[]).find(v=>v.id===player.vehicleId||v.driver===player.id),vx=vehicle?(vehicle.vx??vehicle.velocity?.x??0):0,vz=vehicle?(vehicle.vz??vehicle.velocity?.z??0):0,boosting=Boolean(vehicle&&(vehicle.boosting===true||(vehicle.boostCooldown??0)>0||(vehicle.effects?.turbo>0)));
  this._engine(vehicle?Math.hypot(vx,vz):0,Boolean(vehicle),boosting);}
 _engine(speed,active,boosting=false){if(!this.ctx)return;if(active&&!this.muted){if(!this.engine){const osc=this.ctx.createOscillator(),sub=this.ctx.createOscillator(),f=this.ctx.createBiquadFilter(),g=this.ctx.createGain();osc.type='sawtooth';sub.type='triangle';f.type='lowpass';f.frequency.value=700;g.gain.value=.0001;osc.connect(f);sub.connect(f);f.connect(g);g.connect(this.effectsBus||this.master);osc.start();sub.start();this.engine={osc,sub,f,g};}const s=cl(speed/20,0,1),boostMult=boosting?1.35:1,t=this.ctx.currentTime;this.engine.osc.frequency.setTargetAtTime((55+s*120)*boostMult,t,.1);this.engine.sub.frequency.setTargetAtTime((28+s*40)*boostMult,t,.1);this.engine.g.gain.setTargetAtTime((.022+s*.05)*(boosting?1.2:1),t,.12);this.engine.f.frequency.setTargetAtTime((500+s*1200)*(boosting?1.4:1),t,.15);}else if(this.engine){const {osc,sub,g}=this.engine,t=this.ctx.currentTime;g.gain.setTargetAtTime(.0001,t,.08);this.engine=null;setTimeout(()=>{try{osc.stop();sub.stop();}catch{}},300);}}
 dispose(){if(this._stingDuckTimer){clearTimeout(this._stingDuckTimer);this._stingDuckTimer=null;}try{this.musicEngine?.dispose();}catch{}this.musicEngine=null;if(this.engine){try{this.engine.osc.stop();this.engine.sub.stop();}catch{}this.engine=null;}if(this.bed){for(const node of Object.values(this.bed)){if(node&&typeof node.stop==='function')try{node.stop();}catch{}if(node&&typeof node.disconnect==='function')try{node.disconnect();}catch{}}this.bed=null;}for(const token of this.voices){clearTimeout(token.timer);for(const n of token.nodes){try{n.disconnect();}catch{}}}this.voices.clear();this._announceAt?.clear?.();this.lastSting=null;if(this.space){for(const node of Object.values(this.space)){try{node.disconnect();}catch{}}this.space=null;}for(const bus of [this.effectsBus,this.ambienceBus,this.master,this.muteGain]){try{bus?.disconnect();}catch{}}this.effectsBus=null;this.ambienceBus=null;this.master=null;this.muteGain=null;this.ctx?.close();this.ctx=null;this.status='off';}
}
