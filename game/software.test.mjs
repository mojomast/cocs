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
