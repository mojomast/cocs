import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {weaponModel} from './view.mjs';
import {ModelAssets} from './effects-fx.mjs';

const meshes=g=>{const nodes=[];g.traverse(n=>{if(n.isMesh)nodes.push(n);});return nodes;};
test('actual assembly preserves muzzle anchors and reuses bounded body resources for all ten models',()=>{
 const assets=new ModelAssets(),rows=[];
 for(let type=0;type<10;type++){
  const g=weaponModel(type,assets),flash=new Set(meshes(g.userData.flash));
  const body=meshes(g).filter(n=>!flash.has(n));
  assert.ok(body.length<=48);assert.equal(g.userData.muzzles.length,type===3?2:1);
  for(const n of body){assert.ok(assets.resources.has(n.geometry));assert.ok(assets.resources.has(n.material));assert.equal(n.material.depthTest,true);}
  const barrel=meshes(g.userData.parts.barrel).find(n=>n.name==='barrel');assert.ok(barrel);
  assert.ok(g.userData.sightError.rearError<1e-8);
  rows.push({type,bodyMeshes:body.length,bodyTriangles:body.reduce((sum,n)=>sum+(n.geometry.index?.count??n.geometry.attributes.position.count)/3,0)});
 }
 const counts=[assets.geometries.size,assets.materials.size,assets.resources.size];
 for(let type=0;type<10;type++)weaponModel(type,assets);
 assert.deepEqual([assets.geometries.size,assets.materials.size,assets.resources.size],counts);
 console.log('Weapon geometry metrics (not GPU/FPS evidence):',JSON.stringify({rows,cache:{geometries:counts[0],materials:counts[1]}}));
 assets.dispose();
});

test('pending patch or lead-integrated view is syntax-valid and retains immediate mouse look',()=>{
 const url=new URL('./view.mjs',import.meta.url),original=readFileSync(url,'utf8');
 const diff=readFileSync(new URL('../docs/phase1-weapons-integration.patch',import.meta.url),'utf8');
 let source=original;
 const integrated=source.includes("import {AdsController} from './weapon-ads.mjs';");
 // The lead can integrate while this bounded worker is still verifying. Never
 // reapply or reverse their changes; check the integrated contract instead.
 if(!integrated)for(const hunk of diff.split(/^@@[^\n]*\n/m).slice(1)){
  const rows=hunk.split('\n');if(rows.at(-1)==='')rows.pop();
  const before=rows.filter(s=>s[0]===' '||s[0]==='-').map(s=>s.slice(1)+'\n').join('');
  const after=rows.filter(s=>s[0]===' '||s[0]==='+').map(s=>s.slice(1)+'\n').join('');
  assert.ok(source.includes(before),'patch matches live view; regenerate if another worker changed context');
  source=source.replace(before,after);
 }
 const checked=spawnSync(process.execPath,['--input-type=module','--check'],{input:source,encoding:'utf8'});
 assert.equal(checked.status,0,checked.stderr);
 assert.ok(source.includes('this.camera.rotation.set(pitch,yaw,0,\'YXZ\')'));
 assert.ok(source.includes('this._adsController.compose(this.hands.position,this.hands.quaternion,pose,this.feedback.channels)'));
 assert.ok(!source.includes('n.material.depthTest=false'));
 assert.ok(!source.includes('const w=weaponModel(pickupWeapon'));
 assert.ok(!source.includes('const targetFov=aiming?adsFieldOfView'));
 assert.ok(source.includes('aiming:ads.reticle.ready'));
 console.log(integrated?'Lead integration already present: verified live source, no patch applied.':'Unapplied integration patch reconstructed and checked in memory only.');
 assert.equal(readFileSync(url,'utf8'),original,'the shared file was not modified');
});
