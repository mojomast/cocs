import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import {SoftwareRenderer} from './software.mjs';

const canvas=()=>({width:320,height:180,getContext:()=>({fillRect(){},fillText(){},beginPath(){},moveTo(){},lineTo(){},closePath(){},stroke(){},fill(){}})});

function drawnTriangles(vertices,side){
 const renderer=new SoftwareRenderer(canvas());
 const scene=new T.Scene();scene.background=new T.Color('#000');
 const geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.Float32BufferAttribute(vertices,3));
 scene.add(new T.Mesh(geometry,new T.MeshBasicMaterial({color:'#ffffff',side})));
 const camera=new T.PerspectiveCamera(90,320/180,.1,100);camera.position.set(0,0,5);camera.lookAt(0,0,0);
 renderer.render(scene,camera);
 return renderer.info.render.triangles;
}

const frontWinding=[0,0,0,1,0,0,0,1,0];
const backWinding=[0,0,0,0,1,0,1,0,0];

test('the CPU renderer exposes a WebGL-compatible info.reset() so shared hosts never crash',()=>{
 const ctx={fillRect(){},fillText(){},beginPath(){},moveTo(){},lineTo(){},closePath(){},stroke(){},fill(){}};
 const renderer=new SoftwareRenderer({width:320,height:180,getContext:()=>ctx});
 assert.equal(typeof renderer.info.reset,'function','the software info object advertises reset()');
 assert.ok(renderer.info.render&&renderer.info.memory,'info carries render and memory sections like WebGLRenderer');
 const scene=new T.Scene();scene.background=new T.Color('#000');
 scene.add(new T.Mesh(new T.BoxGeometry(1,1,1),new T.MeshBasicMaterial({color:'#fff'})));
 const camera=new T.PerspectiveCamera(90,320/180,.1,100);camera.position.set(0,0,5);camera.lookAt(0,0,0);
 renderer.render(scene,camera);
 assert.ok(renderer.info.render.triangles>0,'a rendered frame accounts triangles');
 // The exact call ArenaView.render makes: optional chaining must not throw and
 // the counters must zero out so per-frame totals stay trustworthy.
 assert.doesNotThrow(()=>renderer?.info?.reset?.());
 assert.equal(renderer.info.render.triangles,0,'reset clears the triangle count');
 assert.equal(renderer.info.render.calls,0,'reset clears the draw-call count');
 // A renderer with no info at all must also survive the guarded call.
 const bare={isSoftware:true};
 assert.doesNotThrow(()=>bare?.info?.reset?.());
});

test('the software renderer culls by material side instead of treating BackSide as front-facing',()=>{
 assert.equal(drawnTriangles(frontWinding,T.FrontSide),1,'FrontSide draws the front winding');
 assert.equal(drawnTriangles(frontWinding,T.BackSide),0,'BackSide culls the front winding');
 assert.equal(drawnTriangles(backWinding,T.FrontSide),0,'FrontSide culls the back winding');
 assert.equal(drawnTriangles(backWinding,T.BackSide),1,'BackSide draws the opposite winding');
 assert.equal(drawnTriangles(frontWinding,T.DoubleSide),1,'DoubleSide ignores winding');
 assert.equal(drawnTriangles(backWinding,T.DoubleSide),1,'DoubleSide ignores winding');
});

const lin2srgb=c=>c<.0031308?c*12.92:1.055*Math.pow(c,.41666)-.055;
const channel=v=>Math.min(255,Math.round(lin2srgb(v)*255));

function renderFills({vertexColor,materialColor='#ffffff',vertexColors}={}){
 const fills=[];
 const ctx={fillStyle:'',strokeStyle:'',lineWidth:0,font:'',textAlign:'',fillRect(){},fillText(){},beginPath(){},moveTo(){},lineTo(){},closePath(){},stroke(){},fill(){fills.push(String(ctx.fillStyle));}};
 const renderer=new SoftwareRenderer({width:320,height:180,getContext:()=>ctx});
 const scene=new T.Scene();scene.background=new T.Color('#000');
 const geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.Float32BufferAttribute(frontWinding,3));
 if(vertexColor)geometry.setAttribute('color',new T.Float32BufferAttribute(vertexColor,3));
 const options={color:materialColor};if(vertexColors!==undefined)options.vertexColors=vertexColors;
 scene.add(new T.Mesh(geometry,new T.MeshBasicMaterial(options)));
 const camera=new T.PerspectiveCamera(90,320/180,.1,100);camera.position.set(0,0,5);camera.lookAt(0,0,0);
 renderer.render(scene,camera);
 return fills;
}

test('per-vertex colors are averaged and tint otherwise identical meshes differently',()=>{
 const red=renderFills({vertexColor:[1,0,0,1,0,0,1,0,0]});
 const blue=renderFills({vertexColor:[0,0,1,0,0,1,0,0,1]});
 assert.deepEqual(red,['rgba(255,0,0,1)']);
 assert.deepEqual(blue,['rgba(0,0,255,1)']);
 assert.notDeepEqual(red,blue,'same material color with different vertex colors must render differently');
 const averaged=renderFills({vertexColor:[1,0,0,0,1,0,0,0,1]});
 assert.deepEqual(averaged,[`rgba(${channel(1/3)},${channel(1/3)},${channel(1/3)},1)`],'per-vertex colors are averaged over the triangle');
});

test('meshes without a color attribute keep their previous flat color',()=>{
 const flat=renderFills({materialColor:'#808080'});
 assert.deepEqual(flat,['rgba(128,128,128,1)']);
 const neutral=renderFills({materialColor:'#808080',vertexColor:[1,1,1,1,1,1,1,1,1]});
 assert.deepEqual(neutral,flat,'a neutral color attribute must match the no-attribute result');
});

test('vertex colors are honored even when material.vertexColors is unset',()=>{
 assert.equal(new T.MeshBasicMaterial({color:'#ffffff'}).vertexColors,false);
 const tinted=renderFills({materialColor:'#ffffff',vertexColor:[.25,.5,.75,.25,.5,.75,.25,.5,.75]});
 assert.deepEqual(tinted,[`rgba(${channel(.25)},${channel(.5)},${channel(.75)},1)`]);
});

test('the CPU renderer draws a flat single-material decal plane without textures or shadows',()=>{
 const fills=[];
 const ctx={fillStyle:'',strokeStyle:'',lineWidth:0,font:'',textAlign:'',fillRect(){},fillText(){},beginPath(){},moveTo(){},lineTo(){},closePath(){},stroke(){},fill(){fills.push(String(ctx.fillStyle));}};
 const renderer=new SoftwareRenderer({width:320,height:180,getContext:()=>ctx});
 const scene=new T.Scene();scene.background=new T.Color('#000');
 const plane=new T.Mesh(new T.PlaneGeometry(1,1),new T.MeshBasicMaterial({color:'#171310',transparent:true,opacity:.58,side:T.DoubleSide,depthWrite:false}));
 plane.rotation.x=-Math.PI/2;plane.position.set(0,0,0);scene.add(plane);
 const camera=new T.PerspectiveCamera(70,320/180,.1,100);camera.position.set(0,2,2);camera.lookAt(0,0,0);
 renderer.render(scene,camera);
 assert.ok(renderer.info.render.triangles>0,'the decal plane draws on the CPU renderer');
 assert.ok(fills.some(fill=>/^rgba\(/.test(fill)),'the decal contributes a fill color');
});

test('the CPU renderer enforces a per-frame triangle budget without growing state',()=>{
 const ctx={fillRect(){},fillText(){},beginPath(){},moveTo(){},lineTo(){},closePath(){},stroke(){},fill(){}};
 const renderer=new SoftwareRenderer({width:320,height:180,getContext:()=>ctx});
 const scene=new T.Scene();scene.background=new T.Color('#000');
 const geometry=new T.BoxGeometry(1,1,1),material=new T.MeshBasicMaterial({color:'#ffffff'});
 for(let i=0;i<6;i++){const mesh=new T.Mesh(geometry,material);mesh.position.set((i-2.5)*1.4,0,0);scene.add(mesh);}
 const camera=new T.PerspectiveCamera(90,320/180,.1,100);camera.position.set(0,0,6);camera.lookAt(0,0,0);
 renderer.render(scene,camera);
 const unbounded=renderer.info.render.triangles;
 assert.ok(unbounded>1,'the scene normally draws many triangles');
 assert.equal(renderer.setTriangleBudget(3),3);
 renderer.render(scene,camera);
 assert.ok(renderer.info.render.triangles<=3,`triangles ${renderer.info.render.triangles} stay within the budget`);
 assert.equal(renderer.setTriangleBudget(-5),Infinity,'an invalid budget disables the cap');
 renderer.render(scene,camera);
 assert.equal(renderer.info.render.triangles,unbounded,'removing the cap restores the full count');
});

test('the CPU renderer drops sub-pixel facets when the screen-area guard is raised',()=>{
 const ctx={fillRect(){},fillText(){},beginPath(){},moveTo(){},lineTo(){},closePath(){},stroke(){},fill(){}};
 const renderer=new SoftwareRenderer({width:320,height:180,getContext:()=>ctx});
 const scene=new T.Scene();scene.background=new T.Color('#000');
 const geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.Float32BufferAttribute([-.015,0,0,.015,0,0,0,.015,0],3));
 scene.add(new T.Mesh(geometry,new T.MeshBasicMaterial({color:'#ffffff'})));
 const camera=new T.PerspectiveCamera(90,320/180,.1,100);camera.position.set(0,0,5);camera.lookAt(0,0,0);
 renderer.render(scene,camera);
 assert.equal(renderer.info.render.triangles,1,'the small facet draws by default');
 const raised=renderer.setScreenArea(50);
 assert.ok(raised>=.06);
 renderer.render(scene,camera);
 assert.equal(renderer.info.render.triangles,0,'a raised area threshold culls the tiny facet');
 renderer.setScreenArea(.001);
 renderer.render(scene,camera);
 assert.equal(renderer.info.render.triangles,1,'lowering the threshold restores it');
 renderer.setScreenArea(NaN);
 assert.equal(renderer.minScreenArea,.06,'an invalid threshold falls back to the default');
});

test('the CPU sky applies a cheap wet darkening and lightning flash backdrop',()=>{
 const rects=[];
 const ctx={fillStyle:'',strokeStyle:'',lineWidth:0,font:'',textAlign:'',
  createLinearGradient(){return {addColorStop(){}};},
  fillRect(x,y,w,h){rects.push(String(this.fillStyle));},fillText(){},beginPath(){},moveTo(){},lineTo(){},closePath(){},stroke(){},fill(){}};
 const renderer=new SoftwareRenderer({width:320,height:180,getContext:()=>ctx});
 const scene=new T.Scene();scene.background=new T.Color('#000');
 scene.userData.sky={background:'#0a0f1e',phase:'night',seed:5,sunDir:[0,40,0],wet:.6,flash:0};
 const camera=new T.PerspectiveCamera(70,320/180,.1,200);camera.position.set(0,2,0);camera.lookAt(0,2,-30);
 renderer.render(scene,camera);
 assert.ok(rects.some(style=>/^rgba\(10,18,26,/.test(style)),'wet skies add a darkening wash');
 scene.userData.sky.flash=.8;
 rects.length=0;
 renderer.render(scene,camera);
 assert.ok(rects.some(style=>/^rgba\(214,232,255,/.test(style)),'a lightning flash adds a bright wash');
 scene.userData.sky.flash=0;scene.userData.sky.wet=0;
 rects.length=0;
 renderer.render(scene,camera);
 assert.ok(!rects.some(style=>/^rgba\(214,232,255,/.test(style)),'a clear sky adds no flash');
});

test('the CPU sky paints layered ridge silhouettes instead of a flat gradient',()=>{
 const fills=[];
 const ctx={fillStyle:'',strokeStyle:'',lineWidth:0,font:'',textAlign:'',
  createLinearGradient(){return {addColorStop(){}};},
  fillRect(){},fillText(){},beginPath(){this._path=[];},moveTo(x,y){this._path=[[x,y]];},lineTo(x,y){this._path.push([x,y]);},closePath(){},stroke(){},fill(){if(this._path&&this._path.length>2)fills.push({style:String(this.fillStyle),points:this._path.slice()});}};
 const renderer=new SoftwareRenderer({width:640,height:360,getContext:()=>ctx});
 const scene=new T.Scene();scene.background=new T.Color('#000');scene.userData.sky={background:'#0a0f1e',phase:'day',seed:5,sunDir:[0,40,0]};
 const camera=new T.PerspectiveCamera(70,640/360,.1,200);camera.position.set(0,2,0);camera.lookAt(0,2,-30);
 renderer.render(scene,camera);
 const ridges=fills.filter(fill=>fill.points.length>4);
 assert.ok(ridges.length>=2,`expected two layered ridges, saw ${ridges.length}`);
 for(const ridge of ridges){
  const ys=ridge.points.map(point=>point[1]);
  assert.ok(Math.max(...ys)-Math.min(...ys)>4,'the ridge has a varied silhouette');
  assert.ok(ys.every(Number.isFinite)&&ridge.points.every(point=>point.every(Number.isFinite)));
 }
 assert.notEqual(ridges[0].style,ridges[1].style,'the far and near ridges are shaded differently');
});
