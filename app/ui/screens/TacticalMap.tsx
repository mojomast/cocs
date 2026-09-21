'use client';

import {memo,useEffect,useId,useMemo,useRef,useState} from 'react';
import type {MouseEvent} from 'react';
import {ArrowDown,ArrowLeft,ArrowRight,ArrowUp,Circle,Diamond,Minus,Plus,RectangleHorizontal,Square,Triangle,X} from 'lucide-react';
import {tacticalActors,tacticalCommandGate,tacticalMapGeometry,tacticalMapGeometryForView,tacticalNearestTarget,tacticalObjectives} from '../../../game/tactical-map.mjs';
import {rememberModalOpener,restoreModalFocus} from '../primitives';
import styles from './TacticalMap.module.css';

export type TacticalMapProps = {
  open:boolean;
  /** Immutable authored map (ui.hudMap / getMap(hud.mapId)). */
  map:any;
  /** Current presentation snapshot, never the live Match. */
  hud:any;
  player:any;
  brief?:{title?:string;action?:string;detail?:string;status?:string};
  /** The SAME cocsCommand view/callbacks used by PlayingHud. */
  command?:any;
  /** Existing radar result; only used for non-LATTICE revealed contacts. */
  radar?:any;
  onClose:()=>void;
  /** Optional toggle button handler; keyboard binding is owned by the page. */
  onToggle?:()=>void;
  keyLabel?:string;
};

type Geometry = ReturnType<typeof tacticalMapGeometry>;
type Objective = ReturnType<typeof tacticalObjectives>[number];

// A memoized static layer keeps terrain paths and solid footprints out of the
// HUD tick's reconciliation work. The geometry itself is built once per map.
const MapGround=memo(function MapGround({geometry}:{geometry:Geometry}) {
  const {bounds,width,height}=geometry;
  return <g aria-hidden="true" pointerEvents="none">
    <rect x={bounds.minX} y={bounds.minZ} width={width} height={height} className={geometry.voidOutside?styles.voidGround:styles.ground}/>
    {geometry.terrain.map((band:any)=><path key={band.band} d={band.path} fill={band.fill}/>)}
    {geometry.platforms.map(platform=><path key={platform.id} d={platform.path} fill={platform.fill} className={styles.platform} vectorEffect="non-scaling-stroke"><title>{platform.label} · elevation {platform.elevation} m</title></path>)}
    {geometry.lanes.map((lane:any)=><polyline key={lane.id} points={lane.points} className={styles.lane} vectorEffect="non-scaling-stroke"/>)}
    <path d={geometry.solids} className={styles.solids} vectorEffect="non-scaling-stroke"/>
    {geometry.links.map((link:any,i:number)=><line key={i} x1={link.a.x} y1={link.a.z} x2={link.b.x} y2={link.b.z} className={styles.link} vectorEffect="non-scaling-stroke"/>)}
    <rect x={bounds.minX} y={bounds.minZ} width={width} height={height} className={styles.boundary} vectorEffect="non-scaling-stroke"/>
  </g>;
});

/** Parent owns the cursor surface, input suspension, pointer-lock release and
 * remappable toggle hotkey. This native modal owns focus containment/restore
 * and Escape. Mount outside .game-hud (which can be pointer-events:none). */
export function TacticalMap(props:TacticalMapProps) {
  const geometry=useMemo(()=>tacticalMapGeometryForView(props.map,props.open),[props.map,props.open]);
  if (!geometry) return null;
  return <TacticalMapDialog key={props.map?.id??'map'} {...props} geometry={geometry}/>;
}

function TacticalMapDialog({map,hud,player,brief,command,radar,onClose,keyLabel,geometry}:TacticalMapProps&{geometry:Geometry}) {
  const dialogRef=useRef<HTMLDialogElement>(null);
  const closeRef=useRef<HTMLButtonElement>(null);
  const titleId=useId(),hintId=useId();
  const [selectedId,setSelectedId]=useState<string|null>(null);
  const [showNames,setShowNames]=useState(true);
  const [camera,setCamera]=useState({zoom:1,x:(geometry.bounds.minX+geometry.bounds.maxX)/2,z:(geometry.bounds.minZ+geometry.bounds.maxZ)/2});
  const objectives=useMemo(()=>tacticalObjectives(hud,map,player,command),[hud,map,player,command]);
  const actors=useMemo(()=>tacticalActors(hud,player,radar),[hud,player,radar]);
  const gate=tacticalCommandGate(hud,player,command);
  const strip=command?.strip;
  const selected=objectives.find((objective:Objective)=>objective.id===selectedId)??null;
  const legalTargets=(Array.isArray(strip?.nodes)?strip.nodes:[]).map((node:any)=>{
    const objective=objectives.find((entry:Objective)=>entry.nodeId===String(node.id));
    return {...objective,...node};
  });
  const legalIds=new Set(legalTargets.map((node:any)=>String(node.id)));
  const pending=strip?.pending?.text;
  const response=strip?.notice??strip?.issued?.text??'';
  const unit=Math.max(geometry.width,geometry.height)/230/camera.zoom;
  const viewWidth=geometry.width*1.12/camera.zoom,viewHeight=geometry.height*1.18/camera.zoom;
  const viewBox=`${camera.x-viewWidth/2} ${camera.z-viewHeight/2} ${viewWidth} ${viewHeight}`;

  useEffect(()=>{
    const dialog=dialogRef.current;
    if (!dialog) return;
    const opener=rememberModalOpener(document.activeElement as HTMLElement|null);
    dialog.showModal();
    closeRef.current?.focus({preventScroll:true});
    return ()=>{dialog.close();restoreModalFocus(opener);};
  },[]);

  const fit=()=>setCamera({zoom:1,x:(geometry.bounds.minX+geometry.bounds.maxX)/2,z:(geometry.bounds.minZ+geometry.bounds.maxZ)/2});
  const pan=(dx:number,dz:number)=>setCamera(c=>({...c,
    x:Math.max(geometry.bounds.minX,Math.min(geometry.bounds.maxX,c.x+dx*viewWidth*.2)),
    z:Math.max(geometry.bounds.minZ,Math.min(geometry.bounds.maxZ,c.z+dz*viewHeight*.2))}));
  const selectObjective=(objective:Objective)=>{
    setSelectedId(objective.id);
    if (gate.allowed&&strip?.armed&&objective.nodeId&&legalIds.has(objective.nodeId)) command.pickCocsTarget(objective.nodeId);
  };
  const selectPosition=(event:MouseEvent<SVGSVGElement>)=>{
    const svg=event.currentTarget,matrix=svg.getScreenCTM();
    if (!matrix) return;
    const p=svg.createSVGPoint();p.x=event.clientX;p.y=event.clientY;
    const world=p.matrixTransform(matrix.inverse());
    if (world.x<geometry.bounds.minX||world.x>geometry.bounds.maxX||world.y<geometry.bounds.minZ||world.y>geometry.bounds.maxZ) return;
    const nearest=tacticalNearestTarget({x:world.x,z:world.y},gate.allowed&&strip?.armed?legalTargets:objectives);
    if (!nearest) return;
    const objective=objectives.find((entry:Objective)=>entry.id===String(nearest.id));
    if (objective) selectObjective(objective);
  };
  const issue=()=>{
    // Re-read all render gates at click time; the shared callback then performs
    // coop gating and dispatches through NetClient or the local simulation queue.
    if (!gate.allowed||!strip?.canIssue||!legalIds.has(String(strip.target))) return;
    command.issueCocsOrder();
  };
  const tone=(objective:Objective)=>objective.contested?styles.contested:objective.owner===null?styles.neutral:objective.owner===player?.team?styles.friendly:styles.enemy;

  return <dialog ref={dialogRef} className={styles.dialog} aria-modal="true" aria-labelledby={titleId} aria-describedby={hintId}
    onCancel={event=>{event.preventDefault();onClose();}}
    onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();onClose();}}}>
    <header className={styles.header}>
      <div><p className={styles.eyebrow}>TACTICAL MAP {keyLabel&&<kbd>{keyLabel}</kbd>}</p><h2 id={titleId}>{map?.name??hud?.mapName??'Arena'}</h2><p>{hud?.modeName??map?.tag}</p></div>
      <button ref={closeRef} type="button" className={styles.close} onClick={onClose} aria-label="Close tactical map">Close <kbd>Esc</kbd></button>
    </header>
    <div className={styles.body}>
      <section className={styles.mapPane} aria-label="Map overview">
        <div className={styles.toolbar} role="group" aria-label="Map view controls">
          <button type="button" onClick={()=>setCamera(c=>({...c,zoom:Math.min(4,c.zoom*1.5)}))} disabled={camera.zoom>=4} aria-label="Zoom in"><Plus size={18} aria-hidden="true"/></button>
          <button type="button" onClick={()=>setCamera(c=>({...c,zoom:Math.max(1,c.zoom/1.5)}))} disabled={camera.zoom<=1} aria-label="Zoom out"><Minus size={18} aria-hidden="true"/></button>
          <button type="button" onClick={fit}>Fit map</button>
          <button type="button" onClick={()=>setShowNames(value=>!value)} aria-pressed={showNames}>Names</button>
          <span>{Math.round(camera.zoom*100)}% · N <ArrowUp size={14} aria-hidden="true"/></span>
        </div>
        <div className={styles.canvas}>
          <svg viewBox={viewBox} className={styles.svg} role="img" aria-label={`${map?.name??'Arena'}, north up. ${objectives.length} objectives, ${actors.friendly.length} friendly markers, ${actors.enemy.length} revealed enemy markers. Select named objectives in the list for keyboard access.`} onClick={selectPosition}>
            <MapGround geometry={geometry}/>
            <g aria-hidden="true">
              {geometry.facilities.map((facility:any)=><g key={facility.id} transform={`translate(${facility.x} ${facility.z})`} pointerEvents="none"><rect x={-unit*1.3} y={-unit*1.3} width={unit*2.6} height={unit*2.6} className={styles.facility} vectorEffect="non-scaling-stroke"/><title>{facility.kind}: {facility.label}</title></g>)}
              {showNames&&geometry.landmarks.filter((landmark:any)=>!objectives.some((o:Objective)=>Math.hypot(o.x-landmark.x,o.z-landmark.z)<unit*6)).map((landmark:any)=><text key={landmark.id} x={landmark.x} y={landmark.z} fontSize={unit*3} className={styles.landmark} textAnchor="middle" pointerEvents="none">{landmark.label}</text>)}
              {objectives.map((objective:Objective)=>{
                const picked=selectedId===objective.id||(strip?.target!=null&&strip.target===objective.nodeId);
                const legal=gate.allowed&&strip?.armed&&objective.nodeId&&legalIds.has(objective.nodeId);
                return <g key={objective.id} transform={`translate(${objective.x} ${objective.z})`} className={`${styles.objective} ${tone(objective)}`} onClick={event=>{event.stopPropagation();selectObjective(objective);}}>
                  {objective.radius>0&&<circle r={objective.radius} className={styles.captureArea} vectorEffect="non-scaling-stroke"/>}
                  <circle r={unit*7} fill="transparent" stroke="none"/>
                  {(picked||legal)&&<circle r={unit*5.2} className={picked?styles.selected:styles.legal} vectorEffect="non-scaling-stroke"/>}
                  <path d={`M0,${-unit*3.5}L${unit*3.5},0L0,${unit*3.5}L${-unit*3.5},0Z`} fill="currentColor" stroke="#071116" strokeWidth={unit*.8}/>
                  <title>{objective.label}: {objective.status}</title>
                  {showNames&&<text y={unit*8.6} fontSize={unit*3.6} textAnchor="middle" className={styles.pinName}>{objective.label}</text>}
                </g>;
              })}
              {actors.enemy.map((actor:any)=><g key={actor.id} transform={`translate(${actor.x} ${actor.z})`} className={styles.enemyPin} pointerEvents="none"><path d={`M${-unit*2},${-unit*2}L${unit*2},${unit*2}M${unit*2},${-unit*2}L${-unit*2},${unit*2}`} stroke="currentColor" strokeWidth={unit*1.1}/><title>{actor.label}</title></g>)}
              {actors.friendly.filter((actor:any)=>!actor.self).map((actor:any)=><g key={actor.id} transform={`translate(${actor.x} ${actor.z})`} pointerEvents="none"><circle r={unit*1.9} className={styles.allyPin}/><title>{actor.label}</title>{showNames&&camera.zoom>1&&<text y={-unit*3.2} fontSize={unit*3} textAnchor="middle" className={styles.pinName}>{actor.label}</text>}</g>)}
              {actors.friendly.filter((actor:any)=>actor.self).map((actor:any)=><g key={actor.id} transform={`translate(${actor.x} ${actor.z})`} pointerEvents="none"><circle r={unit*4.5} className={styles.selfRing}/><path transform={`rotate(${-actor.yaw*180/Math.PI})`} d={`M0,${-unit*4}L${unit*2.7},${unit*3}L0,${unit*1.5}L${-unit*2.7},${unit*3}Z`} className={styles.selfPin}/><text y={-unit*6} fontSize={unit*3.3} textAnchor="middle" className={styles.pinName}>{actor.label}</text></g>)}
            </g>
          </svg>
          {camera.zoom>1&&<div className={styles.pan} role="group" aria-label="Pan map"><button type="button" onClick={()=>pan(0,-1)} aria-label="Pan north"><ArrowUp size={18} aria-hidden="true"/></button><button type="button" onClick={()=>pan(-1,0)} aria-label="Pan west"><ArrowLeft size={18} aria-hidden="true"/></button><button type="button" onClick={()=>pan(1,0)} aria-label="Pan east"><ArrowRight size={18} aria-hidden="true"/></button><button type="button" onClick={()=>pan(0,1)} aria-label="Pan south"><ArrowDown size={18} aria-hidden="true"/></button></div>}
        </div>
        <ul className={styles.legend} aria-label="Map legend"><li><Triangle size={12} fill="currentColor" aria-hidden="true"/> You / heading</li><li><Circle size={10} fill="currentColor" aria-hidden="true"/> Friendly operator</li><li><X size={12} aria-hidden="true"/> Revealed enemy</li><li><Diamond size={12} fill="currentColor" aria-hidden="true"/> Objective</li><li><Square size={12} aria-hidden="true"/> Terminal / transit / depot</li><li><RectangleHorizontal size={14} fill="currentColor" aria-hidden="true"/> Solid footprint</li>{geometry.platforms.length>0&&<li><span className={styles.floorSwatch} aria-hidden="true"/> Walkable platform</li>}{geometry.voidOutside&&<li><span className={styles.voidSwatch} aria-hidden="true"/> Void / no floor</li>}<li>Shading: ground elevation</li></ul>
        <p className={styles.mapNote}>North up · {Math.round(geometry.width)} × {Math.round(geometry.height)} m · Multi-level routes overlap in this overhead view. Enemy marks show published intel, not live tracking.</p>
      </section>
      <aside className={styles.sidebar} aria-label="Objectives and map orders">
        <section className={styles.brief}><h3>{brief?.title??'Area briefing'}</h3><p>{brief?.action??map?.description??'Use the map to orient and find your team.'}</p>{(brief?.status||brief?.detail)&&<small>{brief.status||brief.detail}</small>}</section>
        <section className={styles.commands} aria-label="Commander map orders">
          <h3>{gate.allowed?'Commander orders':'Tactical overview'}</h3><p id={hintId}>{gate.reason}</p>
          {gate.allowed&&<>
            <div className={styles.verbs} role="group" aria-label="Order verb">{(strip?.buttons??[]).map((button:any)=><button key={button.id} type="button" disabled={button.disabled} aria-pressed={button.armed} title={button.disabled?button.reason:button.hint} onClick={()=>command.armCocsVerb(button.id)}>{button.label}{button.disabled&&<small>{button.reason}</small>}</button>)}</div>
            <p>{strip?.armed?`${strip.armedLabel} / ${strip.targetLabel??'select a highlighted node'}`:'Choose SCAN, GO, ATTACK or ROUTE.'}</p>
            <small>Click a node, or click terrain to choose the nearest legal node. Orders target nodes.</small>
            <button type="button" className={styles.issue} disabled={!strip?.canIssue||!legalIds.has(String(strip.target))} onClick={issue}>Issue {strip?.armedLabel??'order'}{strip?.targetLabel?` · ${strip.targetLabel}`:''}</button>
            {command.commander?.route&&<small>Squad route: {command.commander.routeLabel}</small>}
          </>}
          {(pending||response)&&<p role="status" className={styles.response}>{pending?`Queued · ${pending}`:response}</p>}
        </section>
        <section className={styles.objectives}><h3>Objectives <span>{objectives.length}</span></h3>
          {objectives.length?<ul>{objectives.map((objective:Objective)=><li key={objective.id}><button type="button" className={selectedId===objective.id?styles.activeObjective:undefined} aria-pressed={selectedId===objective.id} onClick={()=>selectObjective(objective)}><Diamond className={tone(objective)} size={12} fill="currentColor" aria-hidden="true"/><span><b>{objective.label}</b><small>{objective.status||objective.kind}{gate.allowed&&strip?.armed&&objective.nodeId&&legalIds.has(objective.nodeId)?' · Order target':''}</small></span></button></li>)}</ul>:<p>No active capture objectives. Use the terrain, landmarks and friendly pins to orient.</p>}
          {selected&&<p className={styles.selection}><b>{selected.label}</b><br/>{selected.status}<br/>X {Math.round(selected.x)} · Z {Math.round(selected.z)}{Number.isFinite(player?.x)&&Number.isFinite(player?.z)?` · ${Math.round(Math.hypot(selected.x-player.x,selected.z-player.z))} m away`:''}</p>}
        </section>
        {(geometry.lanes.length>0||geometry.facilities.length>0)&&<details className={styles.area}><summary>Routes &amp; facilities</summary><ul>{geometry.lanes.filter((lane:any)=>lane.id.endsWith('-0')).map((lane:any)=><li key={lane.id}><b>{lane.label}</b> · {lane.kind}</li>)}{geometry.facilities.map((facility:any)=><li key={facility.id}>{facility.label} · {facility.kind}</li>)}</ul></details>}
      </aside>
    </div>
  </dialog>;
}

/** Optional HUD launcher; positioning remains the parent's responsibility. */
export function TacticalMapButton({onToggle,keyLabel,open=false}:{onToggle:()=>void;keyLabel?:string;open?:boolean}) {
  return <button type="button" className={styles.launcher} onClick={onToggle} aria-haspopup="dialog" aria-expanded={open}>{keyLabel&&<kbd>{keyLabel}</kbd>} Tactical map</button>;
}

export default TacticalMap;
