'use client';
import {useState} from 'react';
import type {ScreenProps} from '../contract';
import {Btn,Chip} from '../primitives';
import {kitView,wingRider} from '../../../game/class-ui.mjs';
import {CHARACTERS,HARNESSES,resolveLoadout} from '../../../game/data.mjs';

// The Claude lock (docs/design/CLASS_OVERHAUL.md §10 decision 1, sign-off S1)
// has one valid pairing on this roster: Claude must run Claude Code and Claude
// Code is Claude-only. The overlay disables every other pairing so the compact
// switcher cannot offer an illegal choice; the per-operator cards still show the
// wing and role so the pick reads as a class + spec decision.
const lockedPair=(character:string,harness:string)=>character==='claude'?harness!=='claudecode':harness==='claudecode';

// Team-mode respawn overlay (§3.7, §6.2). Rendered while a team-mode actor is
// dead outside sudden death: it names what killed the player and offers the one
// legal operator/harness change, which the page applies on the next spawn. Pure
// render over the `respawn`, `killNotice` and `switchRespawnLoadout` bag fields.
export function RespawnOverlay({ui}:ScreenProps){
 const {respawn,killNotice,switchRespawnLoadout}=ui;
 const [pick,setPick]=useState<{character:string;harness:string}|null>(null);
 const open=respawn?.open===true;
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
 // Picking a non-Claude operator while Claude Code is selected falls back to a
 // legal harness (the overlay's exclusivity rule) instead of keeping a locked
 // pair that `resolveLoadout` alone would allow.
 const selectCharacter=(id:string)=>{const l=resolveLoadout(id,harness),safe=lockedPair(l.character,l.harness)?resolveLoadout(l.character,'openclaw'):l;setPick({character:safe.character,harness:safe.harness});};
 const selectHarness=(id:string)=>{const l=resolveLoadout(character,id);setPick({character:l.character,harness:l.harness});};
 const killed=killNotice?.detail?`${killNotice.text} · ${killNotice.detail}`:killNotice?.text??'ELIMINATED';
 return <div className="respawn-overlay" role="dialog" aria-label="Respawn loadout">
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
     {CHARACTERS.map((c:any)=><button key={c.id} type="button" className={`respawn-pick${character===c.id?' is-active':''}`} aria-pressed={character===c.id} onClick={()=>selectCharacter(c.id)}>{c.name}</button>)}
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
  <div className="respawn-overlay__foot">
   <span className="field-note">One switch per minute; it lands on your next spawn.</span>
   <Btn variant="primary" disabled={!changed} onClick={()=>switchRespawnLoadout(character,harness)}>LOCK IN</Btn>
  </div>
 </div>;
}
