import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {NEXTGEN_MAPS} from './nextgen-maps.mjs';
import {RULES} from './data.mjs';
import {floorAt, obstructed, walkEdge, moveActor, navigation, rayWorld} from './core.mjs';
import {terrainSupportAt, terrainRayHit} from './terrain.mjs';
import {pathFloorAt, tunnelRenderPaths, cavernShell} from './structures.mjs';

// The lead integrated the proposal. Default runs the production regression
// contracts. PORTAL_INTEGRATED=0 is historical pre-integration diagnosis ONLY,
// retained for the pre-patch source snapshot; it is not a current-source suite.
const integrated = process.env.PORTAL_INTEGRATED !== '0';
const sourceURL = new URL('./nextgen-maps.mjs', import.meta.url);
const source = readFileSync(sourceURL, 'utf8');
const dependencies = ['nextgen-maps.mjs', 'levelgen.mjs', 'structures.mjs', 'terrain.mjs', 'core.mjs', 'view.mjs', 'data.mjs'];
const digest = s => createHash('sha256').update(s).digest('hex');
const hashes = Object.fromEntries(dependencies.map(p => [p, digest(readFileSync(new URL(p, import.meta.url)))]));
const byId = (maps, id) => maps.find(m => m.id === id);
const point = (m, x, z) => ({x, z, y: floorAt(x, z, m)});
const gap = (a, b) => Math.hypot(a.x-b.x, a.z-b.z);
const angles = [Math.PI/16, Math.PI+Math.PI/16];
const caves = m => m.structures.filter(s => s.type === 'cavern');
const radial = (m, c, a, r) => point(m, c.x+Math.cos(a)*r, c.z+Math.sin(a)*r);
const boxesAt = (m, p, radius=.52) => m.blocks.filter(b => Math.abs(p.x-b.x)<b.w/2+radius && Math.abs(p.z-b.z)<b.d/2+radius && p.y<b.h-1e-6 && p.y+RULES.height>0);

// Consume the EXACT proposed patch, not a separately maintained approximation.
// Strict context matching fails loudly after another worker edits these hunks.
function proposedSource() {
  const patch = readFileSync(new URL('../docs/phase1-portal-proposed.patch', import.meta.url), 'utf8');
  assert.match(patch, /^--- a\/game\/nextgen-maps\.mjs\n\+\+\+ b\/game\/nextgen-maps\.mjs\n/);
  assert.equal((patch.match(/^--- /gm)||[]).length, 1);
  let result = source;
  const hunks = patch.split(/^@@[^\n]*\n/m).slice(1);
  assert.equal(hunks.length, 2);
  for (const hunk of hunks) {
    const lines = hunk.trimEnd().split('\n');
    const before = lines.filter(l => l[0] !== '+').map(l => l.slice(1)).join('\n');
    const after = lines.filter(l => l[0] !== '-').map(l => l.slice(1)).join('\n');
    assert.equal(result.split(before).length, 2, 'Patch context drift; coordinate with bridge/lead, do not silently rebase');
    result = result.replace(before, after);
  }
  return result;
}
async function fixtures() {
  const s = proposedSource();
  const slice = (a, b) => {
    assert.ok(s.indexOf(a)>=0 && s.indexOf(b)>s.indexOf(a), 'Source layout drift');
    return s.slice(s.indexOf(a), s.indexOf(b));
  };
  // Re-run ONLY the two existing layouts against real current createLevel.
  // This is a fixture, NOT an integrated production fix or a new arena.
  const module = s.slice(0,s.indexOf('// 1. Deathmatch')) +
    slice('const frostGate =', '// 3. King of the Hill') +
    slice('const catacombs =', '// 8. Rocket Arena') +
    '\nexport const REVIEW_MAPS=[frostGate,catacombs];';
  const absolute = module.replace(/from '(\.\/[^']+)'/g, (_, p) => `from '${new URL(p, import.meta.url).href}'`);
  return (await import('data:text/javascript;base64,'+Buffer.from(absolute).toString('base64'))).REVIEW_MAPS;
}
const proposed = integrated ? null : await fixtures();

function edgeFailures(m, from, to) {
  const failures=[];
  let prev=point(m,from.x,from.z);
  const n=Math.ceil(gap(from,to)/.1);
  for(let i=1;i<=n;i++) {
    const next=point(m,from.x+(to.x-from.x)*i/n,from.z+(to.z-from.z)*i/n);
    if(!walkEdge(prev,next,m)) failures.push({from:prev,to:next});
    prev=next;
  }
  return failures;
}
function actorAt(m, p) {
  return {...point(m,p.x,p.z),vx:0,vy:0,vz:0,grounded:true,moveSpeed:5,jumpBuffer:0,coyote:0};
}
function steer(m, actor, to, onStep=()=>{}) {
  const limit=Math.ceil(gap(actor,to)*60)+120;
  for(let i=0;i<limit && gap(actor,to)>.08;i++) {
    const d=gap(actor,to);
    moveActor(actor,{x:(to.x-actor.x)/d,z:(to.z-actor.z)/d},1/60,m);
    onStep(actor);
  }
  return gap(actor,to);
}
function traverse(m, from, to) {
  const failures=edgeFailures(m,from,to);
  assert.equal(failures.length,0,`${m.id}: blocked nav edge ${JSON.stringify(failures[0])}`);
  const actor=actorAt(m,from);
  assert.ok(steer(m,actor,to)<.08,`${m.id}: movement stopped ${JSON.stringify(actor)}`);
  assert.equal(obstructed(actor.x,actor.y,actor.z,RULES.radius,m),false);
}
function portalContract(m) {
  for(const c of caves(m)) for(const a of angles) {
    const inside=radial(m,c,a,c.radius-2),outside=radial(m,c,a,c.radius+2);
    traverse(m,inside,outside); traverse(m,outside,inside);
  }
}
function segmentRadius(a,b) {
  const dx=b.x-a.x,dz=b.z-a.z,den=dx*dx+dz*dz;
  const t=den?Math.max(0,Math.min(1,-(a.x*dx+a.z*dz)/den)):0;
  return Math.hypot(a.x+t*dx,a.z+t*dz);
}
function alternate(m, mask=8, continuous=false) {
  const nav=navigation(m),start=point(m,...m.spawns[0]);
  const end=m.spawns.map(p=>point(m,...p)).reduce((a,b)=>gap(a,start)>gap(b,start)?a:b);
  const attach=p=>nav.nodes.findIndex(q=>gap(q,p)<=6.5 && walkEdge(p,q,m));
  const s=attach(start),t=attach(end); assert.ok(s>=0 && t>=0,'Real spawn-to-nav attachments required');
  const queue=[s],seen=new Set(queue),parent=new Map();
  for(let i=0;i<queue.length;i++) for(const j of nav.edges[queue[i]]) {
    if(seen.has(j) || Math.hypot(nav.nodes[j].x,nav.nodes[j].z)<=mask) continue;
    if(continuous && segmentRadius(nav.nodes[queue[i]],nav.nodes[j])<=mask) continue;
    seen.add(j);parent.set(j,queue[i]);queue.push(j);
  }
  const path=[];
  if(seen.has(t)) {let i=t;while(i!==undefined){path.unshift(nav.nodes[i]);i=parent.get(i);}path.unshift(start);path.push(end);}
  return {found:seen.has(t),path,start,end,nodes:nav.nodes.length,reached:seen.size};
}
function routeContract(m,t) {
  const route=alternate(m,8,true); assert.ok(route.found,'No radius-8 avoiding route');
  const actor=actorAt(m,route.start);
  let minimum=Infinity;
  for(let i=1;i<route.path.length;i++) {
    assert.ok(segmentRadius(route.path[i-1],route.path[i])>8);
    assert.ok(walkEdge(route.path[i-1],route.path[i],m),'Real route edge, including spawn attachment');
    assert.ok(steer(m,actor,route.path[i],p=>{
      minimum=Math.min(minimum,Math.hypot(p.x,p.z));
      assert.ok(Math.hypot(p.x,p.z)>8,'Actor entered masked center');
      assert.equal(obstructed(p.x,p.y,p.z,RULES.radius,m),false,'Actor penetrated solid');
    })<.08,`Route movement stuck at ${JSON.stringify(actor)}, target ${JSON.stringify(route.path[i])}`);
  }
  t.diagnostic(JSON.stringify({nodes:route.nodes,reached:route.reached,waypoints:route.path.length,minimumActorRadius:minimum}));
}

if(integrated) {
  for(const id of ['frost-gate','catacombs']) test(`INTEGRATED DESIRED: ${id} portals`,()=>portalContract(byId(NEXTGEN_MAPS,id)));
  test('INTEGRATED DESIRED: Catacombs real center-avoiding movement',t=>routeContract(byId(NEXTGEN_MAPS,'catacombs'),t));
  test('INTEGRATED: all three full lanes remain traversable both ways',()=>{
    const m=byId(NEXTGEN_MAPS,'catacombs');
    for(const s of m.structures.filter(s=>s.type==='tunnel')){const [a,b]=s.floorPoints,from=point(m,a[0],a[2]),to=point(m,b[0],b[2]);traverse(m,from,to);traverse(m,to,from);}
  });
  test('INTEGRATED: portal terrain rays, shell floor and body headroom agree',()=>{
    const m=byId(NEXTGEN_MAPS,'catacombs');
    for(const c of caves(m))for(const a of angles)for(let i=0;i<=40;i++){
      const p=radial(m,c,a,8+i*.1),s=m.structures.find(s=>s.type==='tunnel'&&s.floorPoints[0][2]===c.z);
      assert.ok(Math.abs(p.y-pathFloorAt(p.x,p.z,...s.floorPoints).y)<1e-8);
      const hit=terrainRayHit([p.x,p.y+1,p.z],[0,-1,0],2,m.terrain);assert.ok(hit&&Math.abs(hit.distance-1)<1e-8);
      assert.ok(Math.hypot(Math.abs(p.z-c.z)+.52,RULES.height)<s.radius*.95*Math.cos(Math.PI/16));
      if(i===40)assert.ok(tunnelRenderPaths(s,m.structures).some(path=>p.x>=path[0][0]&&p.x<=path.at(-1)[0]));
    }
    for(const c of caves(m)){const shell=cavernShell(c.radius,c.height,undefined,c.openSegments);for(const a of angles)assert.equal(shell.arcs.some(arc=>a>=arc.thetaStart&&a<=arc.thetaStart+arc.thetaLength),false);}
  });
  test('INTEGRATED limitation: radius-12 mask still has no independent exterior flank',()=>assert.equal(alternate(byId(NEXTGEN_MAPS,'catacombs'),12).found,false));
  test('INTEGRATED: source did not change during this run',()=>{for(const p of dependencies)assert.equal(digest(readFileSync(new URL(p,import.meta.url))),hashes[p]);});
} else {
  test('BASELINE integrated Frost: west nav clearance catches rock corner, not a floor seam',t=>{
    const m=byId(NEXTGEN_MAPS,'frost-gate'),c=caves(m)[0],a=angles[1];
    const inside=radial(m,c,a,11),outside=radial(m,c,a,15),endpoint=radial(m,c,a,11.2);
    const hits=boxesAt(m,inside);
    assert.equal(hits.length,1);assert.equal(hits[0].kind,'rock');
    assert.equal(boxesAt(m,endpoint).length,0);
    assert.ok(edgeFailures(m,inside,endpoint).length>0,'Clear endpoint must not hide blocked edge start');
    for(let i=0;i<=40;i++) {
      const p=radial(m,c,a,11+i*.1),support=terrainSupportAt(p.x,p.z,m.terrain);
      assert.ok(support);assert.ok(Math.abs(support.y-p.y)<1e-8);
      if(i<20)assert.ok(Math.abs(p.y-c.y)<1e-8);
      assert.equal(obstructed(p.x,p.y,p.z,.52,{...m,blocks:[]}),false,'No terrain-wall collision');
    }
    // .42 actor fits this exact ray. Do NOT turn a .52 nav issue into a false
    // movement-failure claim; test authoritative movement independently.
    assert.equal(RULES.radius,.42);
    for(const [from,to] of [[inside,outside],[outside,inside]])assert.ok(steer(m,actorAt(m,from),to)<.08);
    t.diagnostic(JSON.stringify({inside,clearEndpoint:endpoint,blockingRock:hits[0]}));
  });
  test('BASELINE integrated Catacombs: all ten diagonal rays hit tunnel walls; centerlines remain usable',t=>{
    const m=byId(NEXTGEN_MAPS,'catacombs'); let count=0;
    for(const c of caves(m)) for(const a of angles) {
      const inside=radial(m,c,a,8),outside=radial(m,c,a,12),hit=radial(m,c,a,10.8);
      assert.ok(boxesAt(m,hit).some(b=>b.kind==='tunnel'));
      assert.ok(edgeFailures(m,inside,outside).length>0);
      const actor=actorAt(m,inside),remaining=steer(m,actor,outside);
      assert.ok(remaining>.14 && remaining<.17,`Unexpected actual slide/stall: ${remaining}`);
      assert.equal(obstructed(outside.x,outside.y,outside.z,RULES.radius,m),true);
      count++;
    }
    for(const s of m.structures.filter(s=>s.type==='tunnel')) {
      const [a,b]=s.floorPoints,from=point(m,a[0],a[2]),to=point(m,b[0],b[2]);
      traverse(m,from,to);traverse(m,to,from);
    }
    t.diagnostic(`${count} diagonal rays obstructed; real actors slide and stop about .15 from the outer target`);
  });
  test('BASELINE integrated Catacombs: exact handoff radius-8 node mask has no route',t=>{
    const result=alternate(byId(NEXTGEN_MAPS,'catacombs'));
    assert.equal(result.found,false);t.diagnostic(JSON.stringify(result));
  });
  for(const id of ['frost-gate','catacombs']) test(`PROPOSED FIXTURE (not integrated): ${id} portals both ways`,()=>portalContract(byId(proposed,id)));
  test('PROPOSED FIXTURE (not integrated): Catacombs route is physically walked without entering radius 8',t=>routeContract(byId(proposed,'catacombs'),t));
  test('PROPOSED FIXTURE: widened Catacombs preserves all three full lane traversals',()=>{
    const m=byId(proposed,'catacombs');
    for(const s of m.structures.filter(s=>s.type==='tunnel')) {
      const [a,b]=s.floorPoints,from=point(m,a[0],a[2]),to=point(m,b[0],b[2]);
      traverse(m,from,to);traverse(m,to,from);
    }
  });
  test('PROPOSED FIXTURE limitation: no independent flank demonstrated by radius-12 mask',()=>{
    assert.equal(alternate(byId(proposed,'catacombs'),12).found,false);
  });
  test('PROPOSED FIXTURE: portal floor/ray and actual eight-facet tunnel shell agree',()=>{
    const m=byId(proposed,'catacombs');
    for(const c of caves(m)) for(const a of angles) for(let i=0;i<=40;i++) {
      const p=radial(m,c,a,8+i*.1),s=m.structures.find(s=>s.type==='tunnel'&&s.floorPoints[0][2]===c.z);
      const floor=pathFloorAt(p.x,p.z,...s.floorPoints).y;
      assert.ok(Math.abs(p.y-floor)<1e-8,'Runtime floor must equal rendered shell path floor');
      const hit=terrainRayHit([p.x,p.y+1,p.z],[0,-1,0],2,m.terrain);
      assert.ok(hit && Math.abs(hit.distance-1)<1e-8,'Rendered terrain triangles and support must agree');
      // view.mjs uses eight segments on a semicircle of radius .95*s.radius.
      // The inscribed polygon is no smaller than its apothem. Contain the
      // conservative .52 half-width, full 1.8-height body inside that polygon.
      const lateral=Math.abs(p.z-c.z)+.52;
      assert.ok(Math.hypot(lateral,RULES.height)<s.radius*.95*Math.cos(Math.PI/16),'Rendered shell body/headroom');
      const paths=tunnelRenderPaths(s,m.structures);
      if(i===40)assert.ok(paths.some(path=>p.x>=path[0][0]&&p.x<=path.at(-1)[0]),'Outer portal is under real tunnel shell');
    }
    for(const c of caves(m)) {
      const shell=cavernShell(c.radius,c.height,undefined,c.openSegments);
      for(const a of angles) assert.equal(shell.arcs.some(arc=>a>=arc.thetaStart&&a<=arc.thetaStart+arc.thetaLength),false);
      for(const arc of shell.arcs) assert.ok(shell.renderArcs.some(r=>Math.abs(r.thetaLength-arc.thetaLength)<1e-9&&Math.abs(r.thetaStart-(Math.PI/2-arc.thetaStart-arc.thetaLength))<1e-9));
    }
    // Guard the actual consumer assumptions rather than asserting on an
    // unrelated mock renderer. No WebGL/visual-signoff claim is made.
    const view=readFileSync(new URL('./view.mjs',import.meta.url),'utf8');
    assert.match(view,/const R=Math\.max\(\.5,r\*\.95\),ring=8/);
    assert.match(view,/tunnelRenderPaths\(s,structures\)/);
    assert.match(view,/addTerrainMesh\(terrainTriangles\(arena\.terrain\)\)/);
    assert.match(view,/cavernShell\(s\.radius\?\?12,s\.height\?\?8,undefined,s\.openSegments\)/);
  });
  test('PROPOSED FIXTURE: bounded map changes and legacy ground-to-h solids are preserved',t=>{
    const frost=byId(NEXTGEN_MAPS,'frost-gate'),fixed=byId(proposed,'frost-gate');
    const removed=frost.props.filter(p=>!fixed.props.some(q=>JSON.stringify(q)===JSON.stringify(p)));
    t.diagnostic(JSON.stringify({removedProps:removed}));
    assert.equal(removed.length,1);assert.equal(removed[0].type,'rock');
    assert.equal(fixed.props.length,frost.props.length-1);
    assert.equal(fixed.blocks.length,frost.blocks.length-1);
    const {height:oldHeight,...oldTerrain}=frost.terrain,{height:newHeight,...newTerrain}=fixed.terrain;
    assert.deepEqual(newTerrain,oldTerrain,'Frost terrain seam not changed');
    assert.deepEqual(fixed.structures,frost.structures);
    for(const id of ['frost-gate','catacombs']) {
      const before=byId(NEXTGEN_MAPS,id),after=byId(proposed,id);
      for(const key of ['spawns','teamSpawns','flagSpawns','pickups'])assert.deepEqual(after[key],before[key],`${id}: ${key}`);
      assert.deepEqual(after.objectiveZones.map(({x,z,radius})=>({x,z,radius})),before.objectiveZones.map(({x,z,radius})=>({x,z,radius})));
    }
    const b=frost.blocks.find(b=>b.kind==='rock'),p={x:b.x,y:0,z:b.z};
    const legacy={...frost,blocks:[{...b,y:100,minY:100,thickness:.1}]};
    assert.equal(obstructed(p.x,p.y,p.z,RULES.radius,legacy),true,'Metadata must not create pass-under space');
    assert.equal(rayWorld(p,{x:1,y:0,z:0},1,legacy),0,'Legacy ray still hits ground-to-h block');
    t.diagnostic(JSON.stringify({removedRock:removed[0],catacombsOpenSegments:caves(byId(proposed,'catacombs'))[0].openSegments}));
  });
  test('READ-ONLY source dependency fingerprint is stable during the run',t=>{
    for(const p of dependencies)assert.equal(digest(readFileSync(new URL(p,import.meta.url))),hashes[p],`${p} changed concurrently: rerun before accepting evidence`);
    t.diagnostic(JSON.stringify(hashes));
  });
}
