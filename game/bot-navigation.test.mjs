import test from 'node:test';
import assert from 'node:assert/strict';
import {astar,path,coverPoint,flankDestination} from './bots.mjs';

test('A* minimises route cost instead of edge count and reports reachability',()=>{
 // A direct 2-edge route via a far hub (H) versus a cheaper 3-edge route.
 const nodes=[{x:0,y:0,z:0},{x:100,y:0,z:0},{x:1,y:0,z:0},{x:.4,y:0,z:0},{x:.7,y:0,z:0}];
 const edges=[[1,3],[2],[],[4],[2]];
 const result=astar({x:0,y:0,z:0},{x:1,y:0,z:0},nodes,edges);
 assert.equal(result.reachable,true);
 assert.deepEqual(result.route,[0,3,4,2],'the cheaper three-hop route wins');
 assert.ok(Math.abs(result.cost-1)<1e-9,`cost is the summed distance (${result.cost})`);
 assert.deepEqual(path({x:0,y:0,z:0},{x:1,y:0,z:0},nodes,edges),result.route);
});

test('an unreachable destination is explicit rather than a one-node route',()=>{
 const nodes=[{x:0,y:0,z:0},{x:10,y:0,z:0},{x:40,y:0,z:40}];
 const edges=[[1],[0],[]];
 const result=astar({x:0,y:0,z:0},{x:40,y:0,z:40},nodes,edges);
 assert.equal(result.reachable,false);
 assert.equal(result.cost,Infinity);
 assert.deepEqual(result.route,[]);
 assert.deepEqual(path({x:0,y:0,z:0},{x:40,y:0,z:40},nodes,edges),[],'path returns an empty, explicitly unreachable route');
});

test('cover scoring keeps cover reachable and penalises enemy line of sight',()=>{
 const visibleSpy=[];const match={nav:[{x:0,y:0,z:0},{x:-6,y:0,z:0},{x:6,y:0,z:0}],arena:{blocks:[]},edges:[[1,2],[0],[0]],visible:(from,to)=>{visibleSpy.push([from,to]);return Math.abs(from.z-to.z)<2;}};
 const bot={x:0,y:0,z:0},threat={x:0,y:0,z:6};
 const cover=coverPoint(match,bot,threat);
 assert.ok(cover,'a reachable covered node is chosen');
 assert.ok(Math.abs(cover.z)<1e-9&&cover.x!==0,'the bot does not pick the node it already stands on');
 // Line-of-sight candidates are rejected before scoring.
 const open={nav:[{x:0,y:0,z:0}],arena:{blocks:[]},edges:[[],],visible:()=>true};
 assert.equal(coverPoint(open,bot,threat),null,'visible cover is rejected');
});

test('flank routing demands lateral separation and expires with the target',()=>{
 const match={time:0,nav:[{x:0,y:0,z:12},{x:12,y:0,z:12},{x:30,y:0,z:30}],arena:{}};
 const bot={x:0,y:0,z:0,bot:{target:5,flank:null,flankDone:false}},enemy={x:0,y:0,z:20};
 const pick=flankDestination(match,bot,enemy);
 assert.deepEqual({x:pick.x,z:pick.z},{x:12,z:12},'the lateral node is chosen over the straight-ahead node');
 assert.equal(bot.bot.flank.key,'5');
 // Same target and live window: the committed flank is reused.
 assert.equal(flankDestination(match,bot,enemy).x,12,'an active flank is reused');
 // Expired window recomputes from scratch rather than holding a stale route.
 match.time=10;bot.bot.flank.until=1;
 const refreshed=flankDestination(match,bot,enemy);
 assert.ok(refreshed&&Number.isFinite(refreshed.x),'an expired flank is recomputed');
 // A new target invalidates the previous flank.
 bot.bot.flank={x:99,y:0,z:99,key:'5',until:999};bot.bot.target=6;
 const retargeted=flankDestination(match,bot,enemy);
 assert.ok(retargeted.x!==99,'a retarget drops the stale flank');
 assert.equal(bot.bot.flank.key,'6');
});
