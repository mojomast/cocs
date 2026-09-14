import test from 'node:test';
import assert from 'node:assert/strict';
import {ArenaView,legacyWeaponModel} from './view.mjs';
import {WEAPONS} from './data.mjs';

// The original low-poly weapon geometry is archived in game/weapon-models/legacy.mjs.
// It is no longer rendered, but it stays buildable and correct so the models remain
// available for reference and cannot silently rot.
test('archived legacy weapon geometry assembles, keeps its pinned parts and disposes once',()=>{
  const view=Object.create(ArenaView.prototype);
  for(let type=0;type<WEAPONS.length;type++){
    const model=legacyWeaponModel(type),data=model.userData;
    assert.equal(data.type,type);
    assert.equal(data.feel,WEAPONS[type].feel);
    assert.ok(model.children.length>=14,`legacy ${type} keeps its mechanical detail`);
    assert.equal(data.muzzles.length,type===3?2:1);
    if(type>=5&&type<=7)assert.ok(model.getObjectByName(['grenade-drum','shock-emitter','flak-barrel'][type-5]));
    const resources=new Set();
    model.traverse(n=>{if(n.geometry)resources.add(n.geometry);if(n.material)resources.add(n.material);});
    const counts=[];
    for(const resource of resources){const entry={count:0};counts.push(entry);resource.addEventListener('dispose',()=>entry.count++);}
    view.disposeObject(model);
    assert.ok(counts.every(entry=>entry.count===1));
  }
});
