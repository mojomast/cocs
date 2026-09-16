import test from 'node:test';
import assert from 'node:assert/strict';
import {smoothNormals,positionColors} from './terrain-normals.mjs';

// Two coplanar triangles sharing an edge form a flat quad (+Y normal).
const flat=[0,0,0, 1,0,1, 1,0,0, 0,0,0, 0,0,1, 1,0,1];
// A ground face (+Y) and a wall face (+Z) meeting at the origin: a hard crease.
const crease=[0,0,0, 1,0,1, 1,0,0, 0,0,0, 1,0,0, 0,1,0];

test('coplanar triangles smooth to one normal while a crease keeps hard edges',()=>{
 const flatN=smoothNormals(flat);
 for(let v=0;v<6;v++)assert.ok(Math.abs(flatN[v*3])<1e-6&&Math.abs(flatN[v*3+1]-1)<1e-6&&Math.abs(flatN[v*3+2])<1e-6,`flat vertex ${v} points up`);
 const creaseN=smoothNormals(crease);
 // The shared origin vertex appears twice; the crease must not average the two
 // orthogonal faces into one diagonal normal.
 const first=[creaseN[0],creaseN[1],creaseN[2]], second=[creaseN[9],creaseN[10],creaseN[11]];
 assert.ok(Math.abs(first[1]-1)<1e-6,'the ground face keeps its up normal at the crease');
 assert.ok(Math.abs(second[2]-1)<1e-6,'the wall face keeps its own normal at the crease');
});

test('every returned normal is unit length and finite',()=>{
 for(const positions of [flat,crease]){
  const normals=smoothNormals(positions);
  for(let v=0;v<normals.length/3;v++){
   const len=Math.hypot(normals[v*3],normals[v*3+1],normals[v*3+2]);
   assert.ok(Math.abs(len-1)<1e-6&&Number.isFinite(len),`vertex ${v} normal is unit length`);
  }
 }
 assert.equal(smoothNormals([]).length,0,'empty input is a no-op');
});

test('position colors are deterministic and shared positions get one color',()=>{
 const a=positionColors(flat,{seed:7,jitter:.2}),b=positionColors(flat,{seed:7,jitter:.2});
 assert.deepEqual([...a],[...b],'the same seed reproduces the same colors');
 assert.deepEqual([a[0],a[1],a[2]],[a[9],a[10],a[11]],'coincident vertices share a color');
 const other=positionColors(flat,{seed:8,jitter:.2});
 assert.notDeepEqual([...a],[...other],'a different seed varies the tint');
});
