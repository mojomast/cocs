import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import {addSky,addMountains,addScatter,updateScatterSway,ambientProfile,smokeAnchors,AMBIENT_KINDS,skyPalette,skyGradientAt,skyPhase,WEATHER_KINDS,PRECIP_KINDS,selectWeather,weatherPreset,timeOfDayAt,biomeAmbience,precipParticleAdds} from './environment.mjs';
import {ArenaView} from './view.mjs';

const bounds={minX:-40,maxX:40,minZ:-40,maxZ:40};
const flatTerrain=()=>({surfaces:[{id:'ground',material:'grass',walkable:true,vertices:[[-40,0,-40],[40,0,-40],[40,0,40],[-40,0,40]],triangles:[[0,2,1],[0,3,2]]}]});
const emptyTerrain=()=>({surfaces:[]});
const decomposed=mesh=>{const matrix=new T.Matrix4(),position=new T.Vector3(),quaternion=new T.Quaternion(),scale=new T.Vector3();return index=>{mesh.getMatrixAt(index,matrix);matrix.decompose(position,quaternion,scale);return {position:position.clone(),scale:scale.clone()};};};

test('the sky dome is a finite, environment-tagged scene node',()=>{
 const world=new T.Group();
 const sky=addSky(world,{background:'#090f17',radius:120});
 assert.equal(world.children.length,1);
 assert.ok(sky.isMesh);
 assert.equal(sky.userData.environment,true);
 assert.equal(sky.userData.sky,true);
 assert.equal(sky.renderOrder,-1);
 assert.equal(sky.frustumCulled,false);
 const colors=sky.geometry.getAttribute('color');
 assert.ok(colors&&colors.count>0);
 for(const value of colors.array)assert.ok(Number.isFinite(value));
});

test('the mountain backdrop is one instanced mesh with finite transforms',()=>{
 const world=new T.Group();
 const count=18,mesh=addMountains(world,{background:'#090f17',radius:140,count,seed:7,base:-10});
 assert.equal(world.children.length,1);
 assert.ok(mesh.isInstancedMesh);
 assert.equal(mesh.count,count);
 assert.equal(mesh.userData.environment,true);
 assert.equal(mesh.userData.mountains,true);
 assert.ok(mesh.instanceColor&&mesh.instanceColor.count===count);
 const at=decomposed(mesh);
 for(let i=0;i<count;i++){
  const {position,scale}=at(i);
  assert.ok(Number.isFinite(position.x)&&Number.isFinite(position.y)&&Number.isFinite(position.z));
  assert.ok(scale.x>0&&scale.y>0&&scale.z>0);
 }
});

test('terrain scatter stays in bounds and produces finite instances',()=>{
 const world=new T.Group();
 const meshes=addScatter(world,{terrain:flatTerrain(),bounds,seed:3});
 assert.ok(meshes.length>0);
 for(const mesh of meshes){
  assert.equal(mesh.userData.environment,true);
  assert.equal(mesh.userData.scatter,true);
  assert.ok(mesh.isInstancedMesh);
  assert.ok(mesh.count>0);
  const at=decomposed(mesh);
  for(let i=0;i<mesh.count;i++){
   const {position,scale}=at(i);
   assert.ok(position.x>=bounds.minX&&position.x<=bounds.maxX,`scatter x ${position.x}`);
   assert.ok(position.z>=bounds.minZ&&position.z<=bounds.maxZ,`scatter z ${position.z}`);
   assert.ok(Number.isFinite(position.y));
   assert.ok(scale.x>0&&scale.y>0&&scale.z>0);
  }
 }
});

test('the software scatter guard keeps prop triangle cost bounded',()=>{
 const triangles=meshes=>meshes.reduce((sum,mesh)=>sum+mesh.count*(mesh.geometry.index?mesh.geometry.index.count:mesh.geometry.attributes.position.count)/3,0);
 const webgl=addScatter(new T.Group(),{terrain:flatTerrain(),bounds,seed:9});
 const software=addScatter(new T.Group(),{terrain:flatTerrain(),bounds,seed:9,software:true});
 const webglTris=triangles(webgl),softwareTris=triangles(software),budget=120000;
 assert.ok(webglTris>0&&softwareTris>0,'both detail levels produce scatter');
 assert.ok(softwareTris<=webglTris,`software scatter ${softwareTris} <= WebGL ${webglTris}`);
 assert.ok(webglTris<=budget,`WebGL scatter ${webglTris} stays under ${budget} triangles`);
 assert.ok(softwareTris<=budget,`software scatter ${softwareTris} stays under ${budget} triangles`);
});

test('the sky carries a tagged additive atmosphere band for WebGL',()=>{
 const world=new T.Group();
 const sky=addSky(world,{background:'#0a0f1e',radius:120,phase:'day'});
 const atmosphere=sky.children.find(child=>child.userData.atmosphere);
 assert.ok(atmosphere&&atmosphere.isMesh,'the dome parents an atmosphere band');
 assert.equal(atmosphere.userData.environment,true);
 assert.notEqual(atmosphere.material.side,T.FrontSide,'the haze is seen from inside the dome');
 assert.ok(atmosphere.geometry.attributes.position.count>0);
 assert.equal(sky.children.filter(child=>child.userData.atmosphere).length,1);
});

test('terrain scatter exposes named families including the fern tufts',()=>{
 const meshes=addScatter(new T.Group(),{terrain:flatTerrain(),bounds,seed:5});
 const kinds=new Set(meshes.map(mesh=>mesh.userData.scatterKind));
 assert.ok(kinds.has('grass')&&kinds.has('rock')&&kinds.has('fern'),`scatter kinds ${[...kinds].join(',')}`);
 for(const mesh of meshes){assert.ok(kinds.has(mesh.userData.scatterKind));assert.equal(mesh.userData.environment,true);}
});

test('scatter skips missing terrain and unsupported ground without throwing',()=>{
 const world=new T.Group();
 assert.deepEqual(addScatter(world,{}),[]);
 assert.deepEqual(addScatter(world,{terrain:flatTerrain()}),[]);
 assert.deepEqual(addScatter(world,{terrain:emptyTerrain(),bounds}),[]);
 assert.equal(world.children.length,0);
});

test('the environment builders tolerate default and reduced-motion options alike',()=>{
 for(const options of [{},{reducedMotion:true}]){
  const world=new T.Group();
  addSky(world,{background:'#0a0f1e',radius:100,...options});
  addMountains(world,{background:'#0a0f1e',radius:120,count:8,seed:5,base:-8,...options});
  addScatter(world,{terrain:flatTerrain(),bounds,seed:5,...options});
  assert.ok(world.children.length>=3);
  for(const child of world.children)assert.equal(child.userData.environment,true);
 }
});

test('the view reduced-motion gate still keeps the static backdrop',()=>{
 const view=Object.create(ArenaView.prototype);
 view.display={reducedMotion:true};view.motionQuery={matches:false};
 assert.equal(view.reduced(),true);
 view.display={reducedMotion:false};view.motionQuery={matches:true};
 assert.equal(view.reduced(),true);
 view.display={reducedMotion:false};view.motionQuery={matches:false};
 assert.equal(view.reduced(),false);
});

test('the ambient profile is a pure, biome-aware shape with finite fields',()=>{
 const dust=ambientProfile({id:'custom-map'},'night');
 assert.equal(dust.kind,'dust');
 assert.ok(AMBIENT_KINDS.includes(dust.kind));
 assert.ok(Object.isFrozen(dust));
 assert.deepEqual(dust,ambientProfile({id:'custom-map'},'night'),'same map and phase yield the same profile');
 assert.equal(ambientProfile({id:'frostline'},'day').kind,'snow');
 assert.equal(ambientProfile({id:'blood-gulch'},'day').kind,'leaf');
 assert.equal(ambientProfile({id:'foundry'},'day').kind,'ember');
 assert.equal(ambientProfile({id:'warfront'},'day').kind,'ash');
 for(const arena of [{id:'aether'},{id:'x'},{},null]){
  const profile=ambientProfile(arena,'day');
  assert.ok(AMBIENT_KINDS.includes(profile.kind));
  for(const key of ['color','size','life','rate','drift','rise'])assert.ok(profile[key]!==undefined,`${profile.kind}.${key}`);
  assert.equal(typeof profile.additive,'boolean');
 }
 assert.notEqual(ambientProfile({id:'foundry'},'day').additive,ambientProfile({id:'frostline'},'day').additive,'embers glow while snow does not');
});

test('smoke anchors are deterministic, bounded and count-limited',()=>{
 const bounds={minX:-30,maxX:30,minZ:-20,maxZ:20};
 const a=smokeAnchors(bounds,7,4),b=smokeAnchors(bounds,7,4),c=smokeAnchors(bounds,8,4);
 assert.deepEqual(a,b,'the same seed reproduces the emitters');
 assert.notDeepEqual(a,c);
 assert.equal(a.length,4);
 assert.equal(smokeAnchors(bounds,7,99).length,12,'the emitter count is capped');
 for(const anchor of a){assert.ok(anchor.x>=bounds.minX&&anchor.x<=bounds.maxX);assert.ok(anchor.z>=bounds.minZ&&anchor.z<=bounds.maxZ);assert.ok(Number.isFinite(anchor.y));}
});

test('wind sway mutates only wind-tagged vegetation and is bounded and deterministic',()=>{
 const meshes=addScatter(new T.Group(),{terrain:flatTerrain(),bounds,seed:11,wind:true});
 const swaying=meshes.filter(mesh=>mesh.userData.scatterWind);
 assert.ok(swaying.length>0,'grass and fern families capture wind data');
 assert.ok(swaying.every(mesh=>['grass','fern'].includes(mesh.userData.scatterKind)),'only vegetation sways');
 for(const mesh of swaying){
  assert.equal(mesh.userData.scatterWind.base.length,mesh.count*16,'each live instance has a base transform');
  assert.equal(mesh.userData.scatterWind.phase.length,mesh.count);
 }
 const target=swaying[0],before=Array.from(target.instanceMatrix.array.slice(0,target.count*16));
 const moved=updateScatterSway(swaying,1.25);
 assert.equal(moved,swaying.reduce((n,mesh)=>n+mesh.count,0),'every vegetation instance sways');
 const after=Array.from(target.instanceMatrix.array.slice(0,target.count*16));
 assert.notDeepEqual(after,before,'the wind displaces the instance matrices');
 assert.ok(after.every(Number.isFinite),'the swayed matrices stay finite');
 const replay=Array.from(target.instanceMatrix.array.slice(0,target.count*16));
 updateScatterSway(swaying,1.25);
 assert.deepEqual(Array.from(target.instanceMatrix.array.slice(0,target.count*16)),replay,'sway is deterministic for the same time');
 const rocks=meshes.filter(mesh=>mesh.userData.scatterKind==='rock');
 assert.equal(updateScatterSway(rocks,2),0,'rocks never sway');
 assert.equal(updateScatterSway(undefined,2),0);
});

test('scatter without the wind option never tags vegetation for sway',()=>{
 const meshes=addScatter(new T.Group(),{terrain:flatTerrain(),bounds,seed:12});
 assert.ok(meshes.length>0);
 assert.ok(meshes.every(mesh=>mesh.userData.scatterWind===undefined),'wind data is opt-in');
 assert.equal(updateScatterSway(meshes,1),0);
});

test('the sky gradient is deterministic, finite and eases from horizon to zenith',()=>{
 const palette=skyPalette('#0a0f1e','day'),horizon=skyGradientAt(0,palette),zenith=skyGradientAt(1,palette),ground=skyGradientAt(-1,palette);
 assert.deepEqual(skyGradientAt(.4,palette),skyGradientAt(.4,palette),'the gradient is a pure function');
 for(const t of [-1,-.4,0,.25,.6,1,2,NaN]){const sample=skyGradientAt(t,palette);for(const key of ['r','g','b'])assert.ok(Number.isFinite(sample[key])&&sample[key]>=0&&sample[key]<=1,`${key} at ${t}`);}
 const lift=sample=>sample.r+sample.g+sample.b;
 assert.ok(lift(zenith)>lift(horizon),'the zenith is brighter than the horizon for the day palette');
 assert.ok(lift(ground)<=lift(horizon),'the ground hemisphere is darker than the horizon');
 assert.ok(Math.abs(skyGradientAt(3,palette).r-zenith.r)<1e-9,'out-of-range heights clamp to the zenith');
 assert.notDeepEqual(horizon,skyGradientAt(0,skyPalette('#0a0f1e','night')),'the haze follows the palette phase');
});

test('scatter density and detail scale the triangle bill without changing the layout rule',()=>{
 const triangles=meshes=>meshes.reduce((sum,mesh)=>sum+mesh.count*(mesh.geometry.index?mesh.geometry.index.count:mesh.geometry.attributes.position.count)/3,0);
 const full=addScatter(new T.Group(),{terrain:flatTerrain(),bounds,seed:21});
 const sparse=addScatter(new T.Group(),{terrain:flatTerrain(),bounds,seed:21,density:.4,detail:.3});
 const fullInstances=full.reduce((n,mesh)=>n+mesh.count,0),sparseInstances=sparse.reduce((n,mesh)=>n+mesh.count,0);
 assert.ok(sparseInstances>0&&sparseInstances<fullInstances,`sparse ${sparseInstances} < full ${fullInstances}`);
 assert.ok(triangles(sparse)<triangles(full),'the sparse tier draws fewer triangles');
 const zero=addScatter(new T.Group(),{terrain:flatTerrain(),bounds,seed:21,density:0});
 assert.equal(zero.length,0,'a zero density builds nothing');
});

test('weather selection stays within the known kinds, respects the biome and is deterministic',()=>{
 assert.deepEqual(WEATHER_KINDS,['clear','overcast','rain','snow','ash','storm']);
 for(const arena of [{id:'frostline'},{id:'warfront'},{id:'aether'},{id:'blood-gulch'},{},null]){
  const first=selectWeather(arena,'day',9),second=selectWeather(arena,'day',9);
  assert.equal(first,second,'same arena, phase and seed reuse the frozen preset');
  assert.ok(WEATHER_KINDS.includes(first.kind));
  assert.ok(Object.isFrozen(first));
  assert.equal(weatherPreset(first.kind),first);
 }
 assert.equal(selectWeather({id:'frostline'},'day',2).kind,'snow','snow maps prefer snow');
 assert.equal(selectWeather({id:'warfront'},'day',2).kind,'ash','ashen maps prefer ash');
 assert.ok(['rain','storm','overcast','clear'].includes(selectWeather({id:'aether'},'night',2).kind));
 assert.equal(selectWeather({id:'frostline'},'day',2,{reduced:true}).kind,'clear','reduced motion forces clear skies');
 assert.deepEqual([...PRECIP_KINDS].sort(),['ash','rain','snow','storm']);
 assert.equal(PRECIP_KINDS.has('clear'),false,'clear skies never precipitate');
});

test('time-of-day transitions are deterministic and pin under reduced motion',()=>{
 const arena={id:'exchange',background:'#090f17'};
 assert.deepEqual(timeOfDayAt(arena,12,'playing'),timeOfDayAt(arena,12,'playing'),'the sample is a pure function');
 assert.ok(Object.isFrozen(timeOfDayAt(arena,12,'playing')));
 const phases=new Set();
 for(let i=0;i<40;i++)phases.add(timeOfDayAt(arena,i*10,'selection').phase);
 for(const phase of ['day','dusk','night'])assert.ok(phases.has(phase),`the menu cycle reaches ${phase}`);
 const pinned=timeOfDayAt({...arena,reducedMotion:true},500,'selection');
 assert.equal(pinned.phase,skyPhase(arena),'reduced motion pins the authored phase');
 assert.equal(timeOfDayAt({...arena,timeOfDayOverride:false},500).phase,skyPhase(arena),'an explicit override pins too');
 const sample=timeOfDayAt(arena,1234,'playing');
 assert.ok(sample.blend>=0&&sample.blend<=1,'the phase blend stays normalized');
});

test('biome ambience gives each map family a distinct mood, tint and particle',()=>{
 const snow=biomeAmbience({id:'frostline'}),volcanic=biomeAmbience({id:'foundry'}),forest=biomeAmbience({id:'riverbend'}),urban=biomeAmbience({id:'neon-vertical'});
 assert.equal(snow.biome,'snow');assert.equal(snow.mood,'cold');assert.equal(snow.particles,'snow');
 assert.equal(volcanic.biome,'volcanic');assert.equal(volcanic.mood,'hot');assert.equal(volcanic.particles,'ember');
 assert.equal(forest.biome,'forest');assert.equal(forest.particles,'leaf');
 assert.equal(urban.biome,'urban');
 assert.notDeepEqual(snow,volcanic,'different biomes describe differently');
 assert.deepEqual(snow,biomeAmbience({id:'frostline'}),'the descriptor is pure');
 for(const ambience of [snow,volcanic,forest,urban]){assert.match(ambience.tint,/^#[0-9a-f]{6}$/i);assert.ok(Object.isFrozen(ambience));}
 assert.equal(biomeAmbience({id:'custom-map'}).particles,'dust','an unknown map falls back to dust');
});

test('precipitation spawns are deterministic, fall and stay inside the radius',()=>{
 const origin={x:2,y:1,z:-3},a=precipParticleAdds(4,'rain',origin,9),b=precipParticleAdds(4,'rain',origin,9),c=precipParticleAdds(5,'rain',origin,9);
 assert.ok(a.length>0);
 assert.deepEqual(a,b,'the same serial emits identical particles');
 assert.notDeepEqual(a,c,'a new serial advances the stream');
 for(const add of a){
  assert.ok(Number.isFinite(add.pos.x)&&Number.isFinite(add.pos.y)&&Number.isFinite(add.pos.z));
  assert.ok(add.velocity.y<0,'precipitation falls');
  assert.ok(add.size>0&&add.life>0);
  assert.ok(Math.abs(add.pos.x-origin.x)<=9.5&&Math.abs(add.pos.z-origin.z)<=9.5);
 }
 assert.deepEqual(precipParticleAdds(1,'clear',origin,9),[],'clear weather emits nothing');
});

test('the cheap CPU weather guard skips particle spawns for the software renderer',async()=>{
 const {WeatherFX}=await import('./feedback.mjs');
 const {EffectPool}=await import('./feedback.mjs');
 const pool=new EffectPool(new T.Scene(),24),fx=new WeatherFX(pool,{seed:2,preset:weatherPreset('rain'),cap:8}),origin={x:0,y:0,z:0};
 assert.equal(fx.update(.05,origin,{software:true}),0,'the CPU renderer spawns no precipitation');
 assert.equal(fx.update(.05,origin,{reduced:true}),0,'reduced motion spawns no precipitation');
 assert.ok(fx.update(.05,origin,{quality:1})>0,'the hardware path still precipitates');
 pool.dispose();
});

test('mountain detail scales the cone shell resolution',()=>{
 const triangleCount=mesh=>mesh.count*mesh.geometry.attributes.position.count/3;
 const coarse=addMountains(new T.Group(),{background:'#090f17',count:10,seed:2,detail:.2});
 const fine=addMountains(new T.Group(),{background:'#090f17',count:10,seed:2,detail:1});
 assert.ok(triangleCount(coarse)<triangleCount(fine),'coarse mountains use fewer segments');
 assert.ok(coarse.geometry.attributes.position.count<fine.geometry.attributes.position.count);
});
