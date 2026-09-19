'use client';
import {latticeBriefing} from '../../../game/lattice-guide.mjs';

export function LatticeBriefing({mode,bindings={},compact=false}:{mode:string;bindings?:any;compact?:boolean}){
 const guide=latticeBriefing(mode,bindings);
 if(!guide)return null;
 return <section className={`lattice-guide${compact?' lattice-guide--compact':''}`} aria-label={guide.title}>
  <p className="eyebrow">{guide.title}</p>
  <h3>Take ground. Keep it connected.</h3>
  <p className="lattice-guide__goal">{guide.objective}</p>
  <ol className="lattice-guide__steps">{guide.steps.map(step=><li key={step.title}><b>{step.title}</b><p>{step.detail}</p></li>)}</ol>
  <details><summary>Map symbols &amp; movement</summary>
   <dl className="lattice-guide__legend">{guide.legend.map(entry=><div key={entry.name}><dt><span aria-hidden="true">{entry.mark}</span> {entry.name}</dt><dd>{entry.detail}</dd></div>)}</dl>
   <p>{guide.movement}</p>
  </details>
 </section>;
}

export function LatticeTactical({coach}:{coach:any}){
 if(!coach)return null;
 const nodes=new Map<string,any>(coach.nodes.map((node:any)=>[node.id,node]));
 const bounds=coach.bounds??{minX:-120,maxX:120,minZ:-120,maxZ:120};
 const width=bounds.maxX-bounds.minX;
 // Tighten to the actual objective corridor; large scenic margins should not
 // make the useful diagram tiny. This is a topology diagram, not a pathfinder.
 const zs=coach.nodes.map((n:any)=>n.z),minZ=Math.min(...zs)-32,maxZ=Math.max(...zs)+32;
 return <section className="lattice-tactical" aria-label="Lattice supply links">
  <div className="lattice-tactical__head"><b>SUPPLY LINKS</b><span>⌂ HQ · ◆ SIPHON</span></div>
  <svg viewBox={`${bounds.minX-12} ${minZ} ${width+24} ${maxZ-minZ}`} role="img" aria-label={`Your next objective: ${coach.title}. Solid links join your owned nodes. Dashed links are potential supply routes.`}>
   {coach.links.map(([a,b]:string[])=>{const from=nodes.get(a),to=nodes.get(b);return from&&to?<line key={`${a}-${b}`} x1={from.x} y1={from.z} x2={to.x} y2={to.z} className={from.mine&&to.mine?'is-linked':''}/>:null;})}
   {coach.nodes.map((node:any)=><g key={node.id} className={`${node.mine?'is-mine':node.owner!=null?'is-enemy':'is-neutral'}${node.id===coach.targetId?' is-target':''}`}><title>{node.label}: {node.status}{node.legal?' · reachable front':''}</title>
    {node.id===coach.targetId&&<circle cx={node.x} cy={node.z} r="10" className="target-ring"/>}
    <rect x={node.x-5} y={node.z-5} width="10" height="10" rx={node.archetype==='hq'?0:3}/>
    <text x={node.x} y={node.z+3} textAnchor="middle">{node.contested?'!':node.archetype==='hq'?'H':node.archetype==='relay'?'R':node.archetype==='economy'?'S':'F'}</text>
   </g>)}
   <circle cx={Math.max(bounds.minX,Math.min(bounds.maxX,coach.player.x))} cy={Math.max(minZ+3,Math.min(maxZ-3,coach.player.z))} r="2.8" className="player-dot"><title>Your position (clamped to diagram)</title></circle>
  </svg>
  <p>● YOU · outlined node = next objective</p>
 </section>;
}
