import test from 'node:test';
import assert from 'node:assert/strict';
import {PerfTracker,BENCHMARK_PRESET,benchmarkDisplay,benchmarkReport,GpuTimer} from './perf.mjs';

test('the perf tracker accumulates named CPU phases and keeps GPU time distinct',()=>{
 const perf=new PerfTracker({window:30});
 perf.time('sim',()=>{let sum=0;for(let i=0;i<1000;i++)sum+=i;return sum;});
 perf.time('render',()=>{});
 perf.add('snapshot',2.5);
 for(let i=0;i<40;i++)perf.frame(i*16.7);
 const snapshot=perf.snapshot();
 assert.equal(snapshot.frames,40);
 assert.ok(snapshot.cpu.sim>=0&&snapshot.cpu.render>=0&&snapshot.cpu.snapshot===2.5);
 assert.ok(snapshot.frameMs.median>0&&snapshot.frameMs.p95>=snapshot.frameMs.median,'frame percentiles are ordered');
 assert.equal(snapshot.gpu,null,'GPU time stays null until an async query sets it');
 perf.setGpu(4.2);
 assert.equal(perf.snapshot().gpu,4.2);
 perf.reset();
 assert.equal(perf.frames,0);
 assert.equal(perf.get('sim'),0);
});

test('the perf report is compact and labels GPU time separately from CPU',()=>{
 const perf=new PerfTracker();
 perf.time('sim',()=>{});perf.frame(0);perf.frame(16);
 const report=perf.report({drawCalls:123});
 assert.match(report,/frame ms: median/);
 assert.match(report,/cpu ms total: sim/);
 assert.match(report,/gpu ms: n\/a/);
 assert.match(report,/drawCalls: 123/);
});

test('the GPU timer reports elapsed ms only when async query results are actually available',()=>{
 const queries=[];
 const gl={
  createQuery(){const q={id:queries.length};queries.push(q);return q;},
  beginQuery(){},endQuery(){},deleteQuery(q){q.deleted=true;},
  getParameter(){return false;},
  // Each query resolves after one poll; QUERY_RESULT_AVAILABLE then QUERY_RESULT.
  getQueryParameter(q,param){if(param===gl.QUERY_RESULT_AVAILABLE)return q.resolved!==false;return 3_500_000;},
  QUERY_RESULT_AVAILABLE:'available',
 };
 const renderer={getContext:()=>gl};
 gl.getExtension=name=>name==='EXT_disjoint_timer_query_webgl2'?{TIME_ELAPSED_EXT:'time',GPU_DISJOINT_EXT:'disjoint'}:null;
 const timer=new GpuTimer(renderer);
 assert.equal(timer.available,true);
 assert.equal(timer.begin(),true);
 assert.equal(timer.end(),true);
 assert.equal(timer.poll(),3.5,'a resolved query yields milliseconds');
 timer.dispose();
 // A renderer without the extension never fabricates GPU time.
 const bare=new GpuTimer({getContext:()=>({getExtension:()=>null})});
 assert.equal(bare.available,false);
 assert.equal(bare.begin(),false);
 assert.equal(bare.poll(),null);
 // A renderer with no WebGL at all is a no-op, not a crash.
 const none=new GpuTimer(null);
 assert.equal(none.available,false);
 assert.equal(none.poll(),null);
});

test('the benchmark preset fixes the scenario and covers direct and post-processed runs',()=>{
 assert.equal(BENCHMARK_PRESET.mapId,'crosswire');
 assert.ok(Number.isInteger(BENCHMARK_PRESET.seed));
 assert.ok(BENCHMARK_PRESET.botCount>=8);
 assert.ok(BENCHMARK_PRESET.cameraPath.length>=3,'a fixed camera path is part of the preset');
 const ids=BENCHMARK_PRESET.variants.map(v=>v.id);
 assert.deepEqual(ids,['direct','postfx']);
 assert.equal(benchmarkDisplay(BENCHMARK_PRESET.variants[0]).postFx,false);
 assert.equal(benchmarkDisplay(BENCHMARK_PRESET.variants[1]).postFx,true);
 assert.equal(benchmarkDisplay(BENCHMARK_PRESET.variants[1]).resolutionScale,1,'the benchmark keeps the world render at 100%');
 assert.equal(benchmarkDisplay(BENCHMARK_PRESET.variants[1]).resolutionCap,'native','the benchmark opts out of the resolution budget');
 const text=benchmarkReport([{id:'direct',stats:{median:16.7,p95:18},calls:100,triangles:5000},{id:'postfx',stats:{median:20,p95:24},calls:120,triangles:5000}]);
 assert.match(text,/direct: median 16\.70/);
 assert.match(text,/postfx: median 20\.00/);
});
