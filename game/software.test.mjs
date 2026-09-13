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
