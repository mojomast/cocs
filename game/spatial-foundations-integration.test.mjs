import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import * as T from 'three';
import {createLevel} from './levelgen.mjs';
import {facadeDetails} from './structures.mjs';
import {SoftwareRenderer} from './software.mjs';

// Exercise the proposed patch in memory ONLY. No write to lead-owned view/core.
function integrationSource(){
 let source=readFileSync(new URL('./view.mjs',import.meta.url),'utf8');
 const url=new URL('../docs/phase1-spatial-integration.patch',import.meta.url);
 if(existsSync(url)){
  const patch=readFileSync(url,'utf8');
  for(const hunk of patch.split(/^@@ .* @@.*\n/gm).slice(1)){
   const lines=hunk.split('\n').filter(l=>/^[ +\-]/.test(l)&&!l.startsWith('--- ')&&!l.startsWith('+++ '));
   const old=lines.filter(l=>l[0]!=='+').map(l=>l.slice(1)).join('\n');
   const next=lines.filter(l=>l[0]!=='-').map(l=>l.slice(1)).join('\n');
   // The integration owner may apply a hunk while this worker is testing.
   // Accept the exact integrated hunk, otherwise apply it only in memory.
   if(source.includes(next))continue;
   assert.ok(source.includes(old),'integration hunk still matches current renderer');
   source=source.replace(old,next);
  }
 }
 return source.replace(/from\s*(['"])([^'"]+)\1/g,(_,q,s)=>`from ${q}${s.startsWith('.')?new URL(s,import.meta.url).href:import.meta.resolve(s)}${q}`);
}

test('proposed renderer patch consumes shared frames and floor paths; software draws geometry',async()=>{
 const source=integrationSource();
 const {ArenaView}=await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
 const map=createLevel({id:'spatial-render',color:'#ccddee',amplitude:0,relief:0,base:6,layout(c){c.addBuilding({x:20,z:0,w:12,d:6,h:7,rot:Math.PI/2});c.addTunnel([[-12,3,0],[12,3,0]],3);}});
 const world=new T.Scene();world.background=new T.Color('#000');
 const view=Object.assign(Object.create(ArenaView.prototype),{renderer:{isSoftware:true},_quality:()=>({tier:0})});
 view.buildNextGen(world,map);
 const expected=map.structures.filter(s=>s.type==='windows').flatMap(s=>facadeDetails(s));
 const windows=world.children.filter(m=>m.userData.facadeDetail);
 assert.equal(windows.length,expected.length,'every detail consumes the frame-aware placement contract');
 for(let i=0;i<windows.length;i++){
  assert.ok(windows[i].position.distanceTo(new T.Vector3(expected[i].x,expected[i].y,expected[i].z))<1e-7);
  assert.ok(Math.abs(windows[i].rotation.y-expected[i].rot)<1e-7);
 }
 const tunnel=world.children.find(m=>m.userData.tunnelShell);assert.ok(tunnel);
 const positions=tunnel.geometry.attributes.position;
 let minimum=Infinity;for(let i=0;i<positions.count;i++)minimum=Math.min(minimum,positions.getY(i));
 assert.ok(Math.abs(minimum-3)<1e-6,'shell follows authored floor, not old terrain');
 let fills=0;
 const canvas={width:96,height:64,getContext:()=>({fillRect(){},fillText(){},beginPath(){},moveTo(){},lineTo(){},closePath(){},stroke(){},fill(){fills++;}})};
 const renderer=new SoftwareRenderer(canvas),camera=new T.PerspectiveCamera(70,1.5,.1,200);
 camera.position.set(28,18,30);camera.lookAt(7,3,0);renderer.render(world,camera);
 assert.ok(renderer.info.render.triangles>0&&fills>0);
 console.log(`spatial software smoke: ${renderer.info.render.triangles} triangles, ${fills} fills (mock canvas, not pixel/visual evidence)`);
 for(const m of world.children){m.geometry?.dispose();m.material?.dispose();}
});
