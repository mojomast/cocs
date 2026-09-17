// Compatibility shim: the class data now lives in `kits.mjs`. This module keeps
// the historical operator-profile shape (a two-weapon `preferred` pair, the
// role string and the strafe scalar) so every existing consumer stays
// byte-compatible; `OPERATOR_KITS` and `resolveKit` expose the full
// three-weapon affinity band and the rest of the class kit.
import {CHARACTERS} from './data.mjs';
import {OPERATOR_KITS} from './kits.mjs';

const freeze=value=>{if(value&&typeof value==='object'&&!Object.isFrozen(value)){Object.freeze(value);Object.values(value).forEach(freeze);}return value;};
const KITS_BY_ID=Object.fromEntries(OPERATOR_KITS.map(kit=>[kit.id,kit]));
export const OPERATOR_PROFILES=freeze(Object.fromEntries(CHARACTERS.map(character=>{
 const kit=KITS_BY_ID[character.id];
 // The legacy pair is the first two entries of the kit's affinity band, in the
 // kit's order, so `preferredOperatorWeapon` answers exactly as it always did.
 return [kit.id,{id:kit.id,role:kit.role,preferred:kit.preferred.slice(0,2),strafe:kit.strafe}];
})));
export function operatorProfile(id){return OPERATOR_PROFILES[id]??OPERATOR_PROFILES.chatgpt;}
export function preferredOperatorWeapon(id,available=[]){const profile=OPERATOR_PROFILES[id];return profile?.preferred.find(index=>available.includes(index))??null;}
