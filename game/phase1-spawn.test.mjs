import test from 'node:test';
import assert from 'node:assert/strict';
import {routeDistances,spawnRouteContext,contestedPickupPenalty} from './spawn-placement.mjs';
import {Match,obstructed} from './core.mjs';
test('spawn travel follows route around walls and caches source distances',()=>{const m={nav:[{x:0,y:0,z:0},{x:0,y:0,z:10},{x:2,y:0,z:10},{x:2,y:0,z:0}],edges:[[1],[0,2],[1,3],[2]]};assert.equal(routeDistances(m.nav,m.edges,0)[3],22);const c=spawnRouteContext(m,m.nav[0]);assert.equal(c.travel(m.nav[3]),22);spawnRouteContext(m,m.nav[0]);assert.equal(m._spawnRouteCache.size,1);});
test('unreachable graph destinations are not invented as short safe routes',()=>{const m={nav:[{x:0,y:0,z:0},{x:8,y:0,z:0}],edges:[[],[]]};assert.equal(spawnRouteContext(m,m.nav[0]).travel(m.nav[1]),null);});
test('power pickup penalty requires hostile contest and usable route',()=>{const p={x:0,y:0,z:0},items=[{kind:'rocket',x:2,y:0,z:0,wait:0}],route={travel:()=>2};assert.equal(contestedPickupPenalty(p,items,[],route),0);assert.ok(contestedPickupPenalty(p,items,[{x:5,y:0,z:0}],route)>0);assert.equal(contestedPickupPenalty(p,items,[{x:5,y:0,z:0}],{travel:()=>30}),0);});
test('invalid spawn markers recover to supported navigation rather than reactor origin',()=>{const m=new Match('chatgpt','openclaw',()=>.5,'exchange',{botCount:0});m.spawns=[{x:0,y:0,z:0}];m.spawn(m.actors[0]);const p=m.actors[0];assert.equal(obstructed(p.x,p.y,p.z,.38,m.arena),false);});
