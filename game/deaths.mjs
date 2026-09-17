// Deterministic death-plan selection. Pure and engine-free so the sim, replay,
// network and renderer all pick the same style from the same kill context.
export const OVERKILL_GIB=55;
// A weapon suggests a family of deaths; the hash then varies within it so the
// same gun does not always produce the same mess.
const WEAPON_STYLES={
 0:['ragdoll','headpop','ragdoll','splatter','crumple'],
 1:['combust','burst','gibs','spinout'],
 2:['headpop','gibs','vaporize','spinout'],
 3:['gibs','splatter','gibs','crumple'],
 4:['vaporize','burst','gibs','spinout'],
 5:['burst','gibs','combust','crumple'],
 6:['electrocute','vaporize','burst','spinout'],
 7:['splatter','gibs','burst','crumple'],
 8:['headpop','ragdoll','gibs','spinout'],
 9:['ragdoll','ragdoll','headpop','collapse'],
};
const DEFAULT_STYLES=['ragdoll','gibs','headpop','crumple'];
// Per-style presentation recipe. Counts are the base before overkill scaling.
const RECIPES={
 ragdoll:{pieces:0,gore:3,force:2,duration:2.6,hideBody:false,hideHead:false,topple:true,sound:'thud'},
 headpop:{pieces:4,gore:10,force:5,duration:2.4,hideBody:false,hideHead:true,topple:true,sound:'pop'},
 gibs:{pieces:10,gore:12,force:7,duration:1.9,hideBody:true,hideHead:true,topple:false,sound:'splat'},
 burst:{pieces:8,gore:14,force:8,duration:1.7,hideBody:true,hideHead:true,topple:false,sound:'burst'},
 combust:{pieces:9,gore:6,force:9,duration:1.8,hideBody:true,hideHead:true,topple:false,sound:'boom',fire:true},
 vaporize:{pieces:6,gore:4,force:4,duration:1.5,hideBody:true,hideHead:true,topple:false,sound:'zap',energy:true},
 splatter:{pieces:6,gore:16,force:5,duration:2.4,hideBody:false,hideHead:false,topple:true,sound:'splat',flatten:true},
 electrocute:{pieces:3,gore:3,force:2,duration:2.6,hideBody:false,hideHead:false,topple:true,sound:'zap',energy:true},
 // New ragdoll-family profiles: a slow limb crumple, a hard tumbling spin and a
 // minimal collapse. They reuse the same physics/limits, only the presentation
 // timing and pose hints change.
 crumple:{pieces:2,gore:4,force:2,duration:2.9,hideBody:false,hideHead:false,topple:true,sound:'thud',crumple:true},
 spinout:{pieces:5,gore:6,force:7,duration:2.2,hideBody:false,hideHead:false,topple:true,sound:'thud',spin:true},
 collapse:{pieces:1,gore:2,force:1,duration:3,hideBody:false,hideHead:false,topple:true,sound:'thud',crumple:true},
};
// Deterministic falling/crumple poses layered over the style recipe. Pure: the
// sim, replay and renderer see the same pose from the same kill context.
export const FALL_POSES=Object.freeze(['forward','back','left','right','crumple','sprawl']);
export const DEATH_STYLES=Object.freeze(Object.keys(RECIPES));
const clamp01=n=>Math.max(0,Math.min(1,n));
export function hashSeed(...values){let h=2166136261>>>0;for(const value of values){const n=Math.floor((Number.isFinite(value)?value:0)*1000);h^=(n>>>0);h=Math.imul(h,16777619)>>>0;}h^=h>>>15;h=Math.imul(h,2246822507)>>>0;h^=h>>>13;return h>>>0;}
export const hashUnit=(...values)=>hashSeed(...values)/4294967296;
export function deathStyleFor(context={}){
 if(context.fall===true)return 'ragdoll';
 const weapon=Number.isInteger(context.weapon)?context.weapon:null;
 const overkill=Math.max(0,Number(context.overkill)||0);
 let pool=WEAPON_STYLES[weapon]||DEFAULT_STYLES;
 if(context.headshot===true)pool=['headpop',...pool];
 if(overkill>=OVERKILL_GIB)pool=['gibs','burst','combust'];
 const index=hashSeed(context.seed??0,weapon??-1,overkill,context.headshot?1:0,context.fall?1:0)%pool.length;
 return pool[index];
}
// Pose/spin variation driven only by the same deterministic hash the style uses.
// spin is a bounded tumble multiplier, splay a limb spread and roll a small
// z-lean; pose names the falling stance so the renderer can steer the ragdoll.
export function deathPose(plan={},context={}){
 const seed=Number.isFinite(Number(context.seed))?Number(context.seed):0,actor=Number.isFinite(Number(context.actor))?Number(context.actor):0,pieces=Number(plan.pieces)||0;
 const pick=salt=>hashUnit(seed,actor+salt,pieces);
 const topple=plan.topple!==false;
 let pose='none';
 if(plan.spin===true)pose='sprawl';
 else if(plan.crumple===true)pose='crumple';
 else if(topple)pose=FALL_POSES[Math.floor(pick(0)*FALL_POSES.length)%FALL_POSES.length];
 const spin=(pick(17)*2-1)*(plan.spin===true?1.6:1);
 const splay=pick(31);
 const roll=(pick(53)*2-1);
 return {pose,spin:Math.max(-1.6,Math.min(1.6,spin)),splay:clamp01(splay),roll:Math.max(-1,Math.min(1,roll))};
}
export function deathPlan(context={}){
 const style=deathStyleFor(context),base=RECIPES[style]||RECIPES.ragdoll;
 const overkill=Math.max(0,Number(context.overkill)||0),scale=1+clamp01(overkill/120)*.8;
 const color=base.energy?'#8ce8ff':base.fire?'#ffb27a':'#8f1a1a';
 const variation=deathPose(base,context);
 return {style,...base,pieces:Math.round(base.pieces*scale),gore:Math.round(base.gore*scale),force:base.force*scale,color,...variation};
}

// ---- Hit reactions --------------------------------------------------------
//
// Deterministic, presentation-only flinch/knockback for a non-lethal hit. The
// authoritative simulation never reads this: it only decides how a model leans
// and which way a blood/spark spray is thrown. Pure, so the same hit context
// (actor, direction, damage, serial) always produces the same reaction on every
// client and in a replay. `strength` is a bounded 0..1 envelope, `lean` and
// `push` are small world-space offsets the renderer applies to the model, and
// `spray` describes the directional feedback burst.
const clampUnit=n=>{const v=Number(n);return Number.isFinite(v)?Math.max(0,Math.min(1,v)):0;};

export function hitReaction({damage=0,dir=null,seed=0,actor=0,serial=0,reduced=false,headshot=false,energy=false,fire=false}={}){
 const amount=Math.max(0,Number.isFinite(Number(damage))?Number(damage):0);
 // A 35-damage hit saturates the flinch; tiny chip damage barely reads.
 const strength=clampUnit(amount/35);
 const dx=Number.isFinite(dir?.x)?dir.x:0,dz=Number.isFinite(dir?.z)?dir.z:0;
 const len=Math.hypot(dx,dz)||1,nx=dx/len,nz=dz/len;
 const jitter=hashUnit(seed,actor,serial);
 const lean=reduced?0:(.12+.5*strength)*(.7+.6*jitter);
 const push=reduced?0:(.05+.22*strength);
 const color=energy?'#8ce8ff':fire?'#ffb27a':'#8f1a1a';
 const kind=energy?'spark':fire?'ember':'blood';
 const count=reduced?Math.min(2,Math.round(1+strength*3)):Math.round(2+strength*6);
 return {
  strength,
  headshot:headshot===true,
  kind,
  color,
  lean:Math.max(0,Math.min(.9,lean)),
  push:Math.max(0,Math.min(.4,push)),
  // World-space knockback direction; zero when the hit carried no direction.
  pushX:Number.isFinite(dir?.x)?nx*push:0,
  pushZ:Number.isFinite(dir?.z)?nz*push:0,
  sprayX:nx,sprayZ:nz,
  count,
  seed:hashSeed(seed,actor,serial),
 };
}

// Every surviving-body profile reaches a horizontal rest. Spin changes yaw,
// never the final supporting axis (the old crumple/sprawl remained upright).
export function corpseRotation(plan = {}, progress = 1, yaw = 0, reduced = false) {
 const t=clamp01(Number.isFinite(progress)?progress:0),e=t*t*(3-2*t);
 const tilt=e*Math.PI/2,pose=plan.pose;
 const spin=Number.isFinite(plan.spin)?Math.max(-1.6,Math.min(1.6,plan.spin)):0;
 return {
  x:pose==='left'||pose==='right'?0:pose==='back'?-tilt:tilt,
  y:(Number.isFinite(yaw)?yaw:0)+(reduced?0:spin*e*.35),
  z:pose==='left'?tilt:pose==='right'?-tilt:0,
 };
}
