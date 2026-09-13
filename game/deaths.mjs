// Deterministic death-plan selection. Pure and engine-free so the sim, replay,
// network and renderer all pick the same style from the same kill context.
export const OVERKILL_GIB=55;
// A weapon suggests a family of deaths; the hash then varies within it so the
// same gun does not always produce the same mess.
const WEAPON_STYLES={
 0:['ragdoll','headpop','ragdoll','splatter'],
 1:['combust','burst','gibs'],
 2:['headpop','gibs','vaporize'],
 3:['gibs','splatter','gibs'],
 4:['vaporize','burst','gibs'],
 5:['burst','gibs','combust'],
 6:['electrocute','vaporize','burst'],
 7:['splatter','gibs','burst'],
 8:['headpop','ragdoll','gibs'],
 9:['ragdoll','ragdoll','headpop'],
};
const DEFAULT_STYLES=['ragdoll','gibs','headpop'];
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
};
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
export function deathPlan(context={}){
 const style=deathStyleFor(context),base=RECIPES[style]||RECIPES.ragdoll;
 const overkill=Math.max(0,Number(context.overkill)||0),scale=1+clamp01(overkill/120)*.8;
 const color=base.energy?'#8ce8ff':base.fire?'#ffb27a':'#8f1a1a';
 return {style,...base,pieces:Math.round(base.pieces*scale),gore:Math.round(base.gore*scale),force:base.force*scale,color};
}
