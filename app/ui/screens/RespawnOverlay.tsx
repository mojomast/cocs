'use client';
import {useEffect,useRef,useState} from 'react';
import type {ScreenProps} from '../contract';
import {Btn,Chip} from '../primitives';
import {kitView,wingRider} from '../../../game/class-ui.mjs';
import {CHARACTERS,HARNESSES,resolveLoadout} from '../../../game/data.mjs';

const nameOf=(list:any[],id:string)=>list.find((entry:any)=>entry.id===id)?.name??String(id??'');

// The Claude lock (docs/design/CLASS_OVERHAUL.md §10 decision 1, sign-off S1)
// has one valid pairing on this roster: Claude must run Claude Code and Claude
// Code is Claude-only. The overlay disables every other pairing so the compact
// switcher cannot offer an illegal choice; the per-operator cards still show the
// wing and role so the pick reads as a class + spec decision.
const lockedPair=(character:string,harness:string)=>character==='claude'?harness!=='claudecode':harness==='claudecode';

// Team-mode respawn overlay (§3.7, §6.2), F05 split:
//   passive — the automatic death summary. No buttons and no pointer-lock
//             surface: quick respawns stay untouched and an unchanged kit never
//             asks for a click.
//   editor  — the explicit loadout queue, opened with the cursor key while dead.
//             It is the only state that registers the RESPAWN cursor surface, so
//             mouse and keyboard both work while it is open. LOCK IN closes back
//             into the passive summary and reports the queued pair until the
//             next spawn.
export function RespawnOverlay({ui}:ScreenProps){
 const {respawn,killNotice,switchRespawnLoadout,respawnEditor,setRespawnEditor,respawnQueue}=ui;
 const [pick,setPick]=useState<{character:string;harness:string}|null>(null);
 const [error,setError]=useState('');
 const open=respawn?.open===true;
 const editorOpen=open&&respawnEditor===true;
 const firstPick=useRef<HTMLButtonElement>(null);
 // The cursor key is the explicit open gesture; land focus on the first
 // operator so the queue is usable without a mouse.
 useEffect(()=>{if(editorOpen)firstPick.current?.focus({preventScroll:true});},[editorOpen]);
 // The page only mounts this screen while `respawn.open` is true, so every death
 // mounts a fresh `pick` seeded from the actor's current kit and the previous
 // death's pending pick can never leak into the next life.
 if(!open)return null;
 const character=pick?.character??respawn.character;
 const harness=pick?.harness??respawn.harness;
 if(!character||!harness)return null;
 const kit=kitView(character,harness);
 const rider=wingRider(character,harness);
 const changed=character!==respawn.character||harness!==respawn.harness;
 // Truthful feedback: `respawnQueue` is the page's record of the last accepted
 // request. It reads PENDING (local sim queued, applies at spawn), REQUESTED
 // (network request sent, the server validates at spawn) or APPLIED when the
 // live kit already matches the requested pair.
 const queue=respawnQueue??null;
 const queueApplied=Boolean(queue)&&queue.character===respawn.character&&queue.harness===respawn.harness;
 const queueState=queue?(queueApplied?'APPLIED':queue.status==='requested'?'REQUESTED':'PENDING'):'';
 const queueNames=queue?`${nameOf(CHARACTERS,queue.character)} / ${nameOf(HARNESSES,queue.harness)}`:'';
 const cursorKey=String(ui.cursor?.key??'ALT');
 // Picking a non-Claude operator while Claude Code is selected falls back to a
 // legal harness (the overlay's exclusivity rule) instead of keeping a locked
 // pair that `resolveLoadout` alone would allow.
 const selectCharacter=(id:string)=>{const l=resolveLoadout(id,harness),safe=lockedPair(l.character,l.harness)?resolveLoadout(l.character,'openclaw'):l;setPick({character:safe.character,harness:safe.harness});};
 const selectHarness=(id:string)=>{const l=resolveLoadout(character,id);setPick({character:l.character,harness:l.harness});};
 // LOCK IN queues for the next spawn; a refusal (no running match, unchanged
 // pair or a locked request) stays in the editor with its reason instead of
 // pretending the switch landed.
 const lockIn=()=>{const result=switchRespawnLoadout?.(character,harness);if(result&&result.ok===false){setError(String(result.reason??'LOADOUT LOCKED'));return;}setError('');setPick(null);setRespawnEditor?.(false);};
 // The editor is the one surface with a real Tab cycle; keep focus inside it so
 // a stray Tab cannot land on a locked HUD control behind the overlay.
 const trapTab=(event:any)=>{
  if(event.key!=='Tab')return;
  const host=event.currentTarget,focusable=[...host.querySelectorAll('button:not(:disabled),select,[tabindex]:not([tabindex="-1"])')];
  if(!focusable.length)return;
  if(!host.contains(document.activeElement)){event.preventDefault();focusable[0].focus();return;}
  const first=focusable[0],last=focusable[focusable.length-1];
  if(event.shiftKey?document.activeElement===first:document.activeElement===last){event.preventDefault();(event.shiftKey?last:first).focus();}
 };
 const killed=killNotice?.detail?`${killNotice.text} · ${killNotice.detail}`:killNotice?.text??'ELIMINATED';
 if(!editorOpen) return <div className="respawn-overlay" role="region" aria-label="Respawn status" style={{pointerEvents:'none'}}>
  <div className="respawn-overlay__head">
   <div className="respawn-overlay__headline">
    <p className="respawn-overlay__eyebrow">{respawn.respawnIn!==null?`RESPAWN IN ${Math.ceil(respawn.respawnIn)}S`:'AWAITING RESPAWN'}</p>
    <strong className="respawn-overlay__killed">{killed}</strong>
   </div>
   {rider&&<Chip tone="accent">{rider.description}</Chip>}
  </div>
  <div className="respawn-overlay__foot">
   {queue
    ?<span className="field-note" role="status">NEXT SPAWN · <b>{queueNames}</b> · {queueState}</span>
    :<span className="field-note">QUICK RESPAWN · KIT SURVIVES · {cursorKey} TO CHANGE LOADOUT</span>}
  </div>
 </div>;
 return <div className="respawn-overlay" role="dialog" aria-label="Respawn loadout queue" onKeyDown={trapTab}>
  <div className="respawn-overlay__head">
   <div className="respawn-overlay__headline">
    <p className="respawn-overlay__eyebrow">{respawn.respawnIn!==null?`RESPAWN IN ${Math.ceil(respawn.respawnIn)}S`:'AWAITING RESPAWN'}</p>
    <strong className="respawn-overlay__killed">{killed}</strong>
   </div>
   {rider&&<Chip tone="accent">{rider.description}</Chip>}
  </div>
  <div className="respawn-overlay__body">
   <div className="respawn-overlay__picks">
    <span className="label">OPERATOR</span>
    <div className="respawn-overlay__row">
     {CHARACTERS.map((c:any,index:number)=><button key={c.id} ref={index===0?firstPick:null} type="button" className={`respawn-pick${character===c.id?' is-active':''}`} aria-pressed={character===c.id} onClick={()=>selectCharacter(c.id)}>{c.name}</button>)}
    </div>
    <span className="label">HARNESS</span>
    <div className="respawn-overlay__row">
     {HARNESSES.map((h:any)=>{const locked=lockedPair(character,h.id);return <button key={h.id} type="button" disabled={locked} title={locked?'Claude Code pairs only with Claude':h.power} className={`respawn-pick${harness===h.id?' is-active':''}${locked?' is-locked':''}`} aria-pressed={harness===h.id} onClick={()=>selectHarness(h.id)}>{h.name}</button>;})}
    </div>
   </div>
   <div className="respawn-overlay__kit">
    {kit&&<>
     <span className="label">{kit.wing?.label??''}{(kit.wing?.label&&kit.roleLabel)?' · ':''}{kit.roleLabel??''}</span>
     {kit.signature&&<p className="respawn-overlay__verb"><b>{kit.signature.name}</b> — {kit.signature.line}</p>}
     {kit.movement&&<p className="field-note">MOVE · {kit.movement.name} ({kit.movement.inputLabel})</p>}
     {kit.active&&<p className="field-note">ACTIVE · {kit.active.name}{kit.active.description?` — ${kit.active.description}`:''}</p>}
     {kit.tradeoff&&<p className="field-note">TRADEOFF · {kit.tradeoff.name} — {kit.tradeoff.description}</p>}
    </>}
   </div>
  </div>
  {queue&&<p className="field-note" role="status">NEXT SPAWN · <b>{queueNames}</b> · {queueState}</p>}
  {error&&<p className="field-note" role="alert">{error}</p>}
  <div className="respawn-overlay__foot">
   <span className="field-note">One switch per minute; it lands on your next spawn. Closing keeps the quick respawn.</span>
   <div className="respawn-overlay__row">
    <Btn variant="ghost" onClick={()=>{setError('');setRespawnEditor?.(false);}}>CLOSE · KEEP FIGHTING</Btn>
    <Btn variant="primary" disabled={!changed||Boolean(queue)} onClick={lockIn}>LOCK IN · NEXT SPAWN</Btn>
   </div>
  </div>
 </div>;
}
