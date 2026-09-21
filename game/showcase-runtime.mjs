// Presentation-only budgets for autonomous demos. Gameplay keeps its own
// fixed-step accumulator and display settings.
export const SHOWCASE_WARMUP_SECONDS=.5;
export const SHOWCASE_MAX_STEPS=2;
export const SHOWCASE_CPU_BUDGET_MS=4;
const clock=()=>performance.now();

export function stepShowcase(showcase,elapsed,dt,{now=clock,budgetMs=SHOWCASE_CPU_BUDGET_MS}={}){
 const delta=Math.max(0,Math.min(.1,Number(elapsed)||0));
 showcase.acc=Math.min((showcase.acc||0)+delta,dt*SHOWCASE_MAX_STEPS);
 const start=now();let steps=0;
 while(showcase.acc+1e-9>=dt&&steps<SHOWCASE_MAX_STEPS){
  // Always make progress when due, then bound catch-up work on slow machines.
  if(steps&&now()-start>=budgetMs)break;
  showcase.acc=Math.max(0,showcase.acc-dt);showcase.match.step(dt,{inputs:{}});steps++;
 }
 if(showcase.acc>=dt)showcase.acc%=dt;
 showcase.time+=delta;
 const stats=showcase.performance??={steps:0,frames:0,maxSteps:0,snapshots:0};
 stats.steps+=steps;stats.frames++;stats.maxSteps=Math.max(stats.maxSteps,steps);
 return steps;
}

export function showcaseSnapshot(showcase,at,{active=false}={}){
 const interval=1000/(active?60:30);
 if(!showcase.snapshot||showcase.snapshot.time!==showcase.match.time&&(!Number.isFinite(showcase.snapshotAt)||at-showcase.snapshotAt>=interval-.5)){
  const snapshot=showcase.match.snapshot();snapshot.events=showcase.match.events;snapshot.serial=showcase.match.serial;
  showcase.snapshot=snapshot;showcase.snapshotAt=at;
  if(showcase.performance)showcase.performance.snapshots++;
 }
 return showcase.snapshot;
}

export function showcaseFrameCap(displayCap,{showcase=false,active=false}={}){
 const cap=Number(displayCap)||0;
 if(!showcase)return cap;
 return Math.min(cap>0?cap:Infinity,active?60:30);
}
