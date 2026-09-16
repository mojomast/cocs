'use client';
/* eslint-disable react-hooks/purity -- floating damage numbers fade against the wall clock. */
import type {ScreenProps} from '../contract';
import {Shield,Crosshair} from 'lucide-react';
import {SinglePlayerHud} from '../../game-ui/singleplayer-hud';

const FRAG_COOLDOWN=7;

// Spectator target board, grouped by team with the objective strip above it.
// Exported so its aria wiring can be rendered in isolation.
export function SpectatorBoard({groups=[],objective,onFollow}:{groups?:any[];objective?:{title?:string;line?:string}|null;onFollow?:(id:any)=>void}){
 return <div className="spectator-board" role="group" aria-label="Spectator targets">
  {objective&&<p className="spectator-objective" role="status"><b>{objective.title}</b>{objective.line&&<span>{objective.line}</span>}</p>}
  <div className="spectator-targets">
   {groups.map((group:any)=><div key={group.key} className="spectator-group">
    <span className="spectator-group-label">{group.label}{group.score!==null&&group.score!==undefined&&<b>{group.score}</b>}{group.lives!==null&&group.lives!==undefined&&<em>{group.lives} LIVES</em>}</span>
    <div className="spectator-group-players">{group.players.map((a:any)=><button type="button" key={a.id} className={a.current?'current':''} aria-pressed={a.current} aria-label={`Follow ${a.name}${a.current?' (current)':''}${a.juggernaut?' · crown holder':''}`} onClick={()=>onFollow?.(a.id)}>
     <span>{a.juggernaut&&<i className="spectator-crown" aria-hidden="true">♛</i>}{a.name}</span>
     <small>{a.juggernaut?'CROWN':a.health>0?`${Math.round(a.health)} HP`:''}</small>
    </button>)}</div>
   </div>)}
  </div>
 </div>;
}

export function PlayingHud({ui}:ScreenProps){
 const {hud,player,display,brief,phase,hudRoute,hudMap,hudMode,isTeamMode,teamName,modeGoal,ladderStatus,flagText,armsrace,WEAPONS,activePower,powerIcon,radar,radarCols,radarBlip,crosshairGap,marker,reloadFill,reloading,posture,killNotice,suddenBanner,startBanner,scoreCue,damageIndicator,damageNumberStyle,reducedMotion,vehiclePrompt,vehicle,ammoEmpty,ammoLow,hideHud,touchControls,pointerHint,requestLock,chatOpen,isSingle,single,selectHordeUpgrade,resumeSingleplayer,spectatorTeams,CAMERA_MODE_LABELS,runtime,changeMode,grenadeStatus,streakStatus,killFeedWeapon,voiceState,voiceHint,escapeHint,clock,teamScoreText,ammoText,weaponTag}=ui;
 if(!hud||!player)return null;
 const callout=!hud.spectate&&hud.killCue?hud.killCue:null;
 const kill=!hud.spectate&&killNotice&&killNotice.age<1.5?killNotice:null;
 const announcement=suddenBanner?'sudden':startBanner?'start':scoreCue?'score':callout?'callout':kill?'kill':null;
 const objectiveContact=(radar.contacts||[]).find((c:any)=>c.kind==='waypoint')||(radar.contacts||[]).find((c:any)=>c.kind==='payload')||(radar.contacts||[]).find((c:any)=>c.kind==='zone')||(radar.contacts||[]).find((c:any)=>c.kind==='flag')||null;
 const bearing=objectiveContact?Math.atan2(Number(objectiveContact.x)||0,Number(objectiveContact.y)||0):null;
 const weapon=WEAPONS?.[player.weapon]||null;
 const weaponCap=Number(weapon?.cap)||Number(weapon?.ammo)||1;
 const ammoCount=player.ammo?.[player.weapon];
 const ammoRatio=ammoCount===Infinity?1:Math.max(0,Math.min(1,(Number(ammoCount)||0)/weaponCap));
 const healthRatio=Math.max(0,Math.min(1,(Number(player.health)||0)/(player.maxHealth??100)));
 const armorRatio=Math.max(0,Math.min(1,(Number(player.armor)||0)/100));
 const abilityMax=(Number(activePower?.cooldown)||1)*(hud.config?.fastPowers?.5:1);
 const abilityDisabled=!!vehicle||hud.config?.mode==='instagib';
 const abilityActive=Number(player.active)>0;
 const abilityRatio=abilityActive?1:Math.max(0,Math.min(1,1-(Number(player.cooldown)||0)/abilityMax));
 const abilityReady=!abilityDisabled&&!abilityActive&&Number(player.cooldown)<=0;
 const frag=!hud.spectate?grenadeStatus(player):null;
 const fragRatio=frag?frag.ready?1:Math.max(0,Math.min(1,1-frag.cooldown/FRAG_COOLDOWN)):0;
 const streak=!hud.spectate?streakStatus(player):null;
  const specGroups=hud.spectate?spectatorTeams(hud.actors,runtime.current?.spectateTarget,{points:hud.objectives?.points}).map((group:any)=>({
   key:group.key,
   team:group.team,
   label:group.team===null?'FREE AGENTS':`${teamName(group.team)} TEAM`,
   score:group.team===null?null:(Number(hud.teamScores?.[group.team])||0),
   lives:hud.objectives?.kind==='elimination'?(Number(hud.objectives.lives?.[group.team])||0):null,
   players:group.players,
  })):[];
  return <div className={`game-hud${hud.spectate&&hideHud?' hide-hud':''}${touchControls&&!hud.spectate?' touch-mode':''}`}>
  <div className="match-top" role="region" aria-label="Live match status"><div className="match-context"><span className="eyebrow">{hud.mapName?.toUpperCase()} / {hudRoute}</span><strong>{hud.modeName?.toUpperCase()}</strong><small className="phase-label">PHASE / {phase}</small>{isTeamMode(hudMode)&&<small className="team-label">{teamName(player.team)} TEAM · {hud.spectate?'FOLLOWING':'YOU'}</small>}</div><div className="match-clock" aria-label={`${hud.spectate?'Spectating':`${clock(hud.config.timeLimit-hud.time)} remaining`}`}><strong>{hud.spectate?'SPECTATING':clock(hud.config.timeLimit-hud.time)}</strong><small>{hud.net?'NETWORK MATCH':hud.config.botCount===0?'SOLO PRACTICE':armsrace?ladderStatus(player,WEAPONS.length).label:`FIRST TO ${hud.config.fragLimit} ${modeGoal(hudMode).toLowerCase()}`}</small></div><div className="frag-counter"><strong>{armsrace?ladderStatus(player,WEAPONS.length).rung+1:isTeamMode(hudMode)?teamScoreText(hud.teamScores??hud.teams)||player.frags:player.frags}<span>{hud.spectate?'':` / ${armsrace?WEAPONS.length:hud.config.fragLimit}`}</span></strong><small>{hud.spectate?`FOLLOWING ${player.name.toUpperCase()}`:armsrace?'LADDER RUNG':isTeamMode(hudMode)?modeGoal(hudMode):'YOUR FRAGS'}</small></div></div>
  {hud.spectate&&hud.net&&runtime.current&&<button type="button" className="spectator-return" onClick={()=>changeMode('lobby')}>RETURN TO LOBBY</button>}
  {hud.spectateLocal&&runtime.current&&<div className="spectate-cam-panel" role="status"><span className="eyebrow">SPECTATE BOTS</span><strong>{(CAMERA_MODE_LABELS as any)[runtime.current?.cameraMode]||String(runtime.current?.cameraMode||'auto').toUpperCase()}</strong><small>B CYCLE CAMERA · [ / ] FOLLOW BOT · F FREE CAM{runtime.current?.cameraMode==='free'?' · WASD / SPACE / SHIFT / CTRL':''}</small></div>}
  {isSingle&&<SinglePlayerHud single={single} onSelectUpgrade={selectHordeUpgrade} onResumeCheckpoint={resumeSingleplayer}/>}
  {announcement==='kill'&&<div className={`kill-banner ${killNotice.kind}`} role="status" aria-live="polite">{killNotice.text}</div>}
  {announcement==='callout'&&<div className={`kill-callout ${hud.killCue.kind}`} role="status" aria-live="polite"><strong>{hud.killCue.text}</strong><small>{hud.killCue.detail}</small></div>}
  {announcement==='sudden'&&<div className="objective-announcer sudden-death" role="status" aria-live="polite"><strong>{suddenBanner.text}</strong><small>{suddenBanner.detail}</small></div>}
  {announcement==='start'&&<div className="objective-announcer start" role="status" aria-live="polite"><strong>{startBanner.text}</strong><small>{startBanner.detail}</small></div>}
  {announcement==='score'&&<div className={`objective-announcer ${scoreCue.kind}`} role="status" aria-live="polite"><strong>{scoreCue.text}</strong>{scoreCue.amount>1&&<small>{scoreCue.amount}×</small>}</div>}
  <div className="visually-hidden" role="status" aria-live="polite">{hud.modeName}. {brief.title}. {brief.action}. {brief.status||brief.detail}</div>
  {hud.caption&&<div className="audio-caption" role="status" aria-live="polite">{hud.caption}</div>}
  {display.showKillFeed!==false&&<div className="kill-feed" role="log" aria-live="polite" aria-relevant="additions" aria-label="Kill feed">{hud.feed?.filter((e:any)=>hud.time-e.time<6).map((e:any,i:number)=><div key={`${e.time}-${i}`}><span>{e.killer}</span><Crosshair size={12}/>{killFeedWeapon(e,WEAPONS)&&<small>{killFeedWeapon(e,WEAPONS)}</small>}<span>{e.victim}</span>{e.self&&<small>SELF</small>}</div>)}</div>}
  {!hud.spectate&&display.showRadar!==false&&<div className="radar" aria-hidden="true"><svg viewBox="-1.18 -1.18 2.36 2.36" role="presentation"><circle className="radar-ring" r="1"/><circle className="radar-ring" r=".5"/><line className="radar-axis" x1="-1" y1="0" x2="1" y2="0"/><line className="radar-axis" x1="0" y1="-1" x2="0" y2="1"/><polygon className="radar-view" points="0,-.18 -.11,.12 .11,.12"/><line className="radar-sweep" x1="0" y1="0" x2="0" y2="-1"/>{radar.contacts.map((c:any,i:number)=>{const b:any=radarBlip(c,player,radarCols);if(b.shape==='circle')return <circle key={`a${c.id}`} cx={b.cx} cy={b.cy} r={b.r} fill={b.fill} className={`${b.dead?'radar-dead':''} ${b.revealed?'radar-revealed':''}`}/>;if(b.shape==='rect')return <g key={`z${c.id}`}><rect x={b.rect.x} y={b.rect.y} width={b.rect.width} height={b.rect.height} fill={b.fill}/>{b.label&&<text className="radar-zone-label" x={b.cx} y={b.cy} textAnchor="middle" dominantBaseline="central" fill={b.fill}>{b.label}</text>}</g>;if(b.shape==='payload'){const circ=2*Math.PI*b.ring.r;return <g key="payload"><circle cx={b.cx} cy={b.cy} r={b.ring.r} fill="none" stroke={b.fill} strokeWidth={b.ring.thickness} strokeDasharray={`${(b.progressRatio??0)*circ} ${circ}`} transform={`rotate(-90 ${b.cx} ${b.cy})`} className={b.clamped?'radar-revealed':''}/><rect x={b.cx-.05} y={b.cy-.05} width=".1" height=".1" fill={b.fill}/>{b.delivered&&<circle cx={b.cx} cy={b.cy} r=".026" fill="#fff"/>}</g>;}return <polygon key={`f${b.team??'n'}-${c.index??i}`} points={b.points} fill={b.fill}/>;})}{radar.contacts.map((c:any)=>{const b:any=radarBlip(c,player,radarCols);return b.indicator?<g key={`indicator-${c.id}`} className="radar-indicator"><circle cx={b.cx} cy={b.cy} r={b.indicator.ring.r} fill="none" stroke={b.fill} strokeWidth={b.indicator.ring.thickness}/><polygon points={b.indicator.arrow} fill={b.fill}/></g>:null;})}</svg></div>}
  {hud.spectate&&<SpectatorBoard groups={specGroups} objective={brief?{title:brief.title,line:brief.detail}:null} onFollow={(id:any)=>{const r=runtime.current;if(!r)return;r.spectateTarget=id;r.view.setSpectatorTarget(id);}}/>}
  {hud.spectate?<div className="spectator-tag" role="status" aria-live="polite"><span className="eyebrow">YOU ARE SPECTATING</span><h2>NO SEAT</h2><p>Following {player.name} live. Snapshot feed only — no inputs sent.</p>{!hud.spectateLocal&&<p className="spectator-controls">[ / ] follow · H hide HUD · P third person · ESC lobby</p>}</div>:player.health>0?<>{(runtime?.current?.ads||player.ads)?<div className={`ads-reticle${player.attachments?.visual?.optic==='scope'?' scope':''}`} role="presentation" style={{'--crosshair-color':display.color,'--crosshair-size':display.size} as any}/>:<div className={`crosshair shape-${display.crosshair}`} style={{'--crosshair-color':display.color,'--crosshair-size':display.size,'--crosshair-gap':`${crosshairGap}px`} as any}><span/><span/><span/><span/></div>}{marker&&<div className={`hitmarker ${marker}`} role="status" aria-live="polite" aria-label={marker==='kill'?'Elimination confirmed':marker==='critical'?'Critical hit confirmed':'Hit confirmed'}><span/><span/></div>}{reloading&&<div className="reload-indicator" role="status" aria-live="polite" aria-label={`Reloading ${Math.round(reloadFill*100)} percent`}><span className="reload-label">RELOADING</span><span className="reload-track"><i style={{width:`${Math.round(reloadFill*100)}%`}}/></span></div>}{posture&&<div className="posture-chip" role="status">{posture}</div>}</>:<div className="death-message"><span className="eyebrow">CONNECTION LOST</span><h2>RECOMPILING</h2><p>Respawning in {Math.max(1,Math.ceil(player.dead))}…</p></div>}
  {hud.damage&&!hud.spectate&&<div className="damage-vignette"/>}
  {display.showDamageNumbers!==false&&hud.damageNumbers?.length?<div className="damage-numbers" aria-hidden="true">{hud.damageNumbers.map((n:any)=>{const fade=damageNumberStyle((performance.now()-n.born)/1000,{reduced:reducedMotion()});return <span key={n.id} className={`damage-number ${n.kill?'kill':n.critical?'critical':'hit'}`} style={{left:`${n.x}px`,top:`${n.y}px`,opacity:fade.opacity,transform:`translate(-50%,-50%) translateY(${fade.dy}px)`}}>{n.amount}</span>;})}</div>:null}
  {damageIndicator&&!hud.spectate&&(damageIndicator.hasSource?<div className="damage-direction" style={{'--damage-angle':`${-damageIndicator.angle}rad`} as any} aria-hidden="true"><i/></div>:<div className="damage-flash" aria-hidden="true"/>)}
  <div className="hud-lower"><div className="hud-messages"><div className="pickup-message">{player.slow>0?`CONTEXT JAM · ${player.slow.toFixed(1)}s`:Object.entries(player.powerups??{}).filter(([,seconds]:any)=>seconds>0).map(([id,seconds]:any)=>`${id.toUpperCase()} · ${seconds.toFixed(1)}s`).join('  ·  ')||hud.pickup}</div>
  {player.protection>0&&player.health>0&&!hud.spectate&&<div className="spawn-protection"><Shield size={15}/> SPAWN PROTECTION</div>}
  {vehiclePrompt&&<div className="vehicle-prompt">{vehiclePrompt}</div>}
  {!vehicle&&!hud.spectate&&player.health>0&&(ammoEmpty||ammoLow)&&<div className={`ammo-warning ${ammoLow&&!ammoEmpty?'pulse':''}`}>{ammoEmpty?'OUT OF AMMO':'LOW AMMO'} / {player.ammo[player.weapon]} LEFT / 1-9/0 OR WHEEL TO SWITCH</div>}
  {pointerHint&&runtime.current&&!hud.spectate&&!chatOpen&&!touchControls&&<div className="pointer-hint">Click the arena to capture your mouse. WASD moves; hold left mouse to aim if capture is unavailable. <button onClick={requestLock}>Capture mouse</button></div>}
  </div></div>
  <div className="hud-bottom" role="region" aria-label="Player status">
   <div className="hud-corner hud-corner--left">
    <div className={`stat-card stat-card--health${healthRatio<=.3&&player.health>0?' is-low':''}`}><span className="stat-label">HEALTH</span><strong className="stat-value">{Math.ceil(player.health)}</strong><span className="stat-bar"><i style={{width:`${healthRatio*100}%`}}/></span></div>
    <div className={`stat-card stat-card--armor${player.armor<=0?' is-empty':''}`}><span className="stat-label">ARMOR</span><strong className="stat-value">{Math.ceil(player.armor)}</strong><span className="stat-bar"><i style={{width:`${armorRatio*100}%`}}/></span></div>
    {(streak||armsrace)&&<div className="hud-pills">{!hud.spectate&&armsrace&&<span className="hud-pill"><b>ARS</b>{ladderStatus(player,WEAPONS.length).label}</span>}{streak&&<span className="hud-pill hud-pill--warn"><b>×</b>{streak.label}</span>}</div>}
   </div>
   {!isSingle&&<div className="objective-bar" aria-label="Current objective">
    {bearing!==null&&<span className="compass" aria-hidden="true"><i style={{'--bearing':`${bearing}rad`} as any}/></span>}
    <span className="objective-copy"><strong>{brief.title}</strong><small>{brief.action}</small></span>
    <span className="objective-tags"><span className="chip chip--accent">{brief.detail}</span>{(isTeamMode(hudMode)||hudMode?.id==='armsrace')&&<span className="chip">{brief.status}</span>}{hud.captureNotice&&<span className="chip chip--warn">{hud.captureNotice}</span>}</span>
   </div>}
   <div className="hud-corner hud-corner--right">
    {!hud.spectate&&player.health>0&&(vehicle?<div className={`stat-card stat-card--ammo${vehicle.overheated?' is-empty':''}`}><span className="stat-label">PUMA</span><strong className="stat-value">{Math.ceil(vehicle.health)}</strong><span className="stat-note">{Math.round(Math.max(0,Math.min(1,vehicle.heat))*100)}% HEAT{vehicle.overheated?' · OVERHEATED':''}</span></div>:<div className={`stat-card stat-card--ammo${ammoEmpty?' is-empty':''}`}><span className="stat-label">{weapon?.name||'WEAPON'}{weapon&&weaponTag(weapon)&&<b className="weapon-tag">{weaponTag(weapon)}</b>}</span><strong className="stat-value">{ammoText(ammoCount)}</strong><span className="stat-bar"><i style={{width:`${ammoRatio*100}%`}}/></span></div>)}
    {!hud.spectate&&<div className={`ability-card${abilityActive?' is-active':''}${abilityReady?' is-ready':''}${abilityDisabled?' is-disabled':''}`} role="status" aria-label={`Ability ${abilityReady?'ready':abilityDisabled?'unavailable':`recharging ${Number(player.cooldown).toFixed(1)} seconds`}`}>
     <span className="ability-ring" style={{'--fill':`${abilityRatio}turn`} as any}>{powerIcon(player.harness,22)}</span>
     <span className="stat-label">{activePower?.power||'ABILITY'}</span>
     <span className="stat-note">{abilityDisabled?(vehicle?'DRIVING':'OFF'):abilityActive?`ACTIVE ${Number(player.active).toFixed(1)}s`:abilityReady?'READY':`${Number(player.cooldown).toFixed(1)}s`}</span>
    </div>}
    {frag&&<div className={`ability-card frag-card${frag.ready?' is-ready':''}`} role="status" aria-label={frag.label}>
     <span className="ability-ring" style={{'--fill':`${fragRatio}turn`} as any}><b>G</b></span>
     <span className="stat-label">FRAG</span>
     <span className="stat-note">{frag.ready?'READY':`${frag.cooldown.toFixed(1)}s`}</span>
    </div>}
   </div>
  </div>
  <div className="hud-bottom-note"><span>TAB / SCOREBOARD</span>{hud.spectate&&<span>[ / ] FOLLOW</span>}{hud.net&&hud.quality&&<span className={`net-quality ${hud.quality.tone}`}>{hud.quality.label} · {hud.quality.ms}MS</span>}{voiceHint(voiceState.enabled,voiceState.mode)&&<span>{voiceHint(voiceState.enabled,voiceState.mode)}</span>}{display.showFps&&<span>{hud.fps||0} FPS · {hud.renderer==='software'?'CPU':'WEBGL'}</span>}<span>{escapeHint(hud.net)}</span></div></div>;
}
