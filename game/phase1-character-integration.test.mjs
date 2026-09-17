// Exercises the proposed view integration in memory. NEVER writes view.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';

const viewURL=new URL('./view.mjs',import.meta.url);
const original=readFileSync(viewURL,'utf8');
const patch=readFileSync(new URL('../docs/phase1-characters-integration.patch',import.meta.url),'utf8');
function candidateFromPatch(){
 // Once the lead integrates the hooks, test that live version directly; nearby
 // weapon/spatial changes legitimately invalidate the original patch context.
 if(/import\s*\{[^}]*\bCharacterLifecycle\b[^}]*\}\s*from\s*['"]\.\/rig\.mjs['"]/.test(original) && original.includes('refineOperatorCharacter(g);')) return original;
 let candidate=original;
 const hunks=patch.split(/^@@ .* @@.*\n/m).slice(1);
 assert.ok(hunks.length>0);
 for(const hunk of hunks){
  const lines=hunk.split('\n');if(lines.at(-1)==='')lines.pop();
  const before=lines.filter(l=>l[0]===' '||l[0]==='-').map(l=>l.slice(1)+'\n').join('');
  const after=lines.filter(l=>l[0]===' '||l[0]==='+').map(l=>l.slice(1)+'\n').join('');
  if(candidate.includes(before)) candidate=candidate.replace(before,after);
  else assert.ok(candidate.includes(after),'integration patch must be rebased onto current lead view');
 }
 return candidate;
}
let loaded;
async function integrated(){
 if(loaded)return loaded;
 const candidate=candidateFromPatch().replace(/(from\s*['"])([^'"]+)(['"])/g,(_,prefix,path,suffix)=>prefix+(path.startsWith('.')?new URL(path,viewURL).href:import.meta.resolve(path))+suffix);
 try {loaded=await import('data:text/javascript;base64,'+Buffer.from(candidate).toString('base64'));}
 catch(error){throw new Error(`In-memory integration import failed: ${error.message.replace(/data:text[^\s"]+/g,'[candidate]').slice(0,500)}`);}
 return loaded;
}

test('unapplied integration handles corpse -> respawn using real view/model methods',async()=>{
 const {ArenaView,robotModel}=await integrated();
 const view={deathContext:new Map(),hitFlinch:new Map(),playerId:99,reduced:()=>true,characterGroundAt:()=>2};
 const model=robotModel('chatgpt'),actor={id:1,x:0,y:2,z:0,yaw:0,health:0};
 ArenaView.prototype.poseCorpse.call(view,model,actor,{time:0});
 assert.equal(view.characterLifecycle.state(model),'settled');assert.equal(model.userData.joints.contactGait,true);
 const position=model.position.clone();view.hitFlinch.set(1,{until:performance.now()+500,pushX:3,pushZ:3});view.actorModels=new Map([[1,model]]);
 ArenaView.prototype._updateHitReactions.call(view);
 assert.deepEqual(model.position.toArray(),position.toArray());
 ArenaView.prototype.styleActor.call(view,model,{npcProfile:{scale:5}},null);assert.equal(model.scale.x,1);
 ArenaView.prototype.reviveCorpse.call(view,model,{...actor,health:100,x:8},{time:.1});
 assert.equal(view.characterLifecycle.state(model),'respawning');assert.equal(model.position.x,8);assert.equal(model.rotation.x,0);assert.equal(model.visible,true);
 ArenaView.prototype.reviveCorpse.call(view,model,{...actor,health:100},{time:.2});assert.equal(view.characterLifecycle.state(model),'alive');
});
test('integration gates interpolation and leaves the lead-owned view byte-identical',()=>{
 const candidate=candidateFromPatch();
 assert.match(candidate,/state\(model\)!=='alive'\)continue;\s*const pose=this\._presentActor/);
 const hash=s=>createHash('sha256').update(s).digest('hex');
 assert.equal(hash(readFileSync(viewURL,'utf8')),hash(original));
});
