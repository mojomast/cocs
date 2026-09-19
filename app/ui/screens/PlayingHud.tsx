'use client';
/* eslint-disable react-hooks/purity -- floating damage numbers fade against the wall clock. */
import type {ScreenProps} from '../contract';
import {Shield,Crosshair,Move} from 'lucide-react';
import {SinglePlayerHud} from '../../game-ui/singleplayer-hud';
import {SightReticle} from './SightReticle';
import {abilityRing,movementHud} from '../../../game/hud-class.mjs';
import {MOVEMENT_VERBS} from '../../../game/kits.mjs';
import {harnessAbility} from '../../../game/harness-profiles.mjs';
import {wingChip} from '../../../game/class-ui.mjs';
import {OperationsDirectorHud} from './OperationsDirectorHud';
import {CommandBoardHud} from './CommandBoardHud';
import {SpendWindowHud} from './SpendWindowHud';
import {CocsTerminalsHud} from './CocsTerminalsHud';
import {LatticeTactical} from './LatticeGuide';
import {LatticeTrainingHud} from './LatticeTrainingHud';
import {latticeLoadoutRoles} from '../../../game/lattice-roles.mjs';
import {SpectatorBoard} from './SpectatorBoard';
export {SpectatorBoard} from './SpectatorBoard';
import {formatNumber,formatResource,formatCountdown} from '../../../game/format-ui.mjs';

const FRAG_COOLDOWN=7;

// LATTICE STRIKE front-line strip. The board/economy/strip model is derived in
// `game/cocs-orders.mjs` from the frozen cocs snapshot; this is a pure view.
// Ownership reads as a shape glyph plus a word (never colour alone) and the
// capture hint is the live objective line. The V0b one-button command layer is
// the three-button SCAN / GO / ATTACK strip: arm a verb, pick a live node, then
// issue. Disabled verbs explain why (cooldown / FLUX low) and never rely on
// colour; the animation-free markup is reduced-motion safe.
function CocsReadout({command,teamName,player}:{command:any;teamName:(team:any)=>string;player:any}){
 if(!command)return null;
 const {board,economy,strip,scanTarget,traversal}=command;
 if(!board||!strip)return null;
  const amount=formatNumber;
  const whole=formatResource;
 const nodes=board.live||[],mine=board.myNodes??0,enemy=board.enemyNodes??0;
 const flux=economy?.flux??0,fluxCap=economy?.fluxCap??0,net=economy?.net??0,fluxPercent=Math.round((economy?.fluxPercent??0)*100);
 const req=economy?.req??{value:0,earned:0},orders=economy?.orders??{issued:0,completed:0},scout=economy?.scout??{alive:false},stats=economy?.scoutStats??{spawned:0,killed:0,scans:0};
 const spots=command.spots??[];
  const scoutState=scout.alive?(scout.idle?'IDLE':scout.returning?'RETURNING':scout.scanned?'SCANNED':'EN ROUTE'):'READY';
  const fieldRole=latticeLoadoutRoles(player.character,player.harness);
 return <div className="cocs-readout" role="region" aria-label={`Lattice front. ${board.hint}. ${board.liveCount} live nodes.`}>
   <div className="cocs-readout__head"><span className="eyebrow">LATTICE FRONT</span><span className="cocs-readout__count">{board.liveCount} LIVE</span></div>
   {command.coach&&<div className="lattice-coach" role="status"><b>{command.coach.title}</b><p>{command.coach.detail}</p></div>}
   {command.coach&&<details className="lattice-map-details" onToggle={e=>command.onReadoutPanel?.('map',e.currentTarget.open)}><summary>SUPPLY MAP · NEXT OBJECTIVE</summary><LatticeTactical coach={command.coach}/></details>}
   <details className="lattice-kit-details" onToggle={e=>command.onReadoutPanel?.('kit',e.currentTarget.open)}><summary>YOUR FIELD ROLE · {fieldRole.operator.role.toUpperCase()}</summary><b>{fieldRole.operator.name}</b><p>{fieldRole.operator.description}</p><b>{command.keys?.power??'Q'} · {fieldRole.harness.name}</b><p>{fieldRole.harness.description}</p></details>
   {(command.terminals?.hasTerminals||command.terminals?.hasRoles)&&<details className="lattice-terminal-details" onToggle={e=>command.onReadoutPanel?.('terminals',e.currentTarget.open)}><summary>TERMINALS &amp; SUPPORT ROLES</summary><CocsTerminalsHud terminals={command.terminals} reducedMotion/></details>}
  <div className="cocs-readout__scores" aria-label={`Objective score: ${teamName(0)} ${amount(board.scores[0])}, ${teamName(1)} ${amount(board.scores[1])}`}>
   <span className={board.leader===0?'is-lead':''}>{teamName(0)} <b>{amount(board.scores[0])}</b></span>
   <span className="cocs-readout__op" aria-hidden="true">OP</span>
   <span className={board.leader===1?'is-lead':''}>{teamName(1)} <b>{amount(board.scores[1])}</b></span>
  </div>
   <details className="lattice-node-details" onToggle={e=>command.onReadoutPanel?.('nodes',e.currentTarget.open)}><summary>NODE STATUS · {mine} OWNED / {enemy} ENEMY</summary><ul className="cocs-readout__nodes">
   {nodes.map((node:any)=><li key={node.id} className={`cocs-node${node.mine?' cocs-node--mine':''}${node.enemy?' cocs-node--enemy':''}${node.contested?' cocs-node--contested':''}`} aria-label={`${node.label}: ${node.ownerLabel}${node.contested?' contested':''}${node.progressPercent>0&&!node.mine?` ${node.progressPercent} percent captured`:''}`}>
    <span className="cocs-node__mark" aria-hidden="true">{node.mark}</span>
    <span className="cocs-node__label">{node.label}</span>
    <span className="cocs-node__status">{node.ownerLabel}{node.progressPercent>0&&!node.mine?` ${node.progressPercent}%`:''}</span>
   </li>)}
   {!nodes.length&&<li className="cocs-node cocs-node--neutral"><span className="cocs-node__mark" aria-hidden="true">○</span><span className="cocs-node__label">NO NODES</span><span className="cocs-node__status">STAND BY</span></li>}
   </ul></details>
   <div className="cocs-readout__own">
   <span aria-label={`Your team owns ${mine} nodes`}>{teamName(board.team??0)} <b>{mine}</b> NODES</span>
   <span aria-label={`The enemy owns ${enemy} nodes`}>{teamName((board.team??0)===0?1:0)} <b>{enemy}</b> NODES</span>
  </div>
  <p className="cocs-readout__hint">{board.hint}</p>
  {command.rung&&<div className="cocs-readout__rung" role="status" aria-label={`Rung ${command.rung}. Roles ${(command.roleBoard?.allow??[]).join(', ')}. Threads ${command.roleBoard?.threads?.used??0} of ${command.roleBoard?.threads?.cap??0}.`}>
   <span className="eyebrow">RUNG</span> <b>{String(command.rung).toUpperCase()}</b>
   {command.roleBoard&&<small>ROLES {(command.roleBoard.allow??[]).map((role:any)=>String(role).toUpperCase()).join(' · ')} · THREADS {command.roleBoard.threads?.used??0}/{command.roleBoard.threads?.cap??0}</small>}
  </div>}
  <div className="cocs-readout__economy" role="group" aria-label="Team economy">
    <div className="cocs-flux" aria-label={`Team flux ${whole(flux)} of ${whole(fluxCap)}, ${net>=0?'plus':'minus'} ${formatNumber(Math.abs(net))} per second`}>
    <span className="eyebrow">FLUX</span>
    <span className="cocs-flux__track" aria-hidden="true"><i style={{width:`${fluxPercent}%`}}/></span>
    <b>{whole(flux)}</b><small>/{whole(fluxCap)}</small>
     <em className={net<0?'is-drain':''}>{net>=0?'+':''}{formatNumber(net)}/s</em>
   </div>
   <div className="cocs-chips">
    <span className="cocs-chip" aria-label={`Personal requisition ${whole(req.value)}`}>REQ <b>{whole(req.value)}</b></span>
    <span className="cocs-chip" aria-label={`Orders issued ${orders.issued}, completed ${orders.completed}`}>ORD <b>{orders.issued}</b>/<b>{orders.completed}</b></span>
    <span className="cocs-chip" aria-label={`Scout ${scoutState}. ${stats.spawned} spawned, ${stats.killed} killed, ${stats.scans} scans`}>SCOUT <b>{scoutState}</b><small>{stats.spawned}S · {stats.killed}K · {stats.scans}SCAN</small></span>
    <span className="cocs-chip" aria-label={scanTarget?.nodeId?`Chief scan target ${scanTarget.label}`:'No chief scan target'}>CHIEF SCAN <b>{scanTarget?.nodeId?scanTarget.label:'NONE'}</b></span>
   </div>
    {spots.length>0&&<div className="cocs-spots" role="group" aria-label={`${spots.length} enemies spotted`}><span className="eyebrow">SPOTTED</span>{spots.map((spot:any)=><span key={spot.id} className="cocs-spot-chip" aria-label={`Enemy ${spot.id} spotted for ${formatCountdown(spot.remainingSeconds)} seconds`}>◈ {formatCountdown(spot.remainingSeconds)}s</span>)}</div>}
  </div>
  {traversal&&(traversal.deviceCount>0||traversal.depotCount>0)&&<div className="cocs-traversal" role="group" aria-label="Traversal devices and depots">
    {traversal.channel&&<p className="cocs-traversal__channel" role="status" aria-live="polite"><span aria-hidden="true">{traversal.channelDevice?.mark}</span> {traversal.channel.label} {traversal.channelDevice?.label} · {formatCountdown(traversal.channel.remainingSeconds)}s <b>{Math.round((traversal.channel.percent??0)*100)}%</b></p>}
    <details><summary>ROUTES &amp; DEPOTS</summary>{traversal.deviceCount>0&&<ul className="cocs-traversal__list" aria-label="Devices">
    {traversal.devices.map((device:any)=><li key={device.id} className={`cocs-device cocs-device--${device.state}`} aria-label={`${device.label} ${device.stateLabel}${device.timerSeconds>0?`, ${device.timerSeconds} seconds remaining`:''}${device.channel?`, ${device.channel.label}`:''}`}><span className="cocs-device__mark" aria-hidden="true">{device.mark}</span><span className="cocs-device__state" aria-hidden="true">{device.stateMark}</span> {device.stateLabel}</li>)}
   </ul>}
   {traversal.depotCount>0&&<ul className="cocs-traversal__list" aria-label="Depots">
    {traversal.depots.map((depot:any)=><li key={depot.id} className={`cocs-depot${depot.mine?' is-mine':''}${depot.enemy?' is-enemy':''}${depot.contested?' is-contested':''}`} aria-label={`${depot.label} ${depot.ownerLabel}${depot.capturePercent>0?`, ${depot.capturePercent} percent captured`:''}. Loaner ${depot.vehicle.state}`}><span className="cocs-depot__mark" aria-hidden="true">{depot.mark}</span> {depot.ownerLabel}{depot.capturePercent>0?` ${depot.capturePercent}%`:''} <small>LOANER {depot.vehicle.state}</small></li>)}
   </ul>}
     </details>{traversal.arrivalActive&&<p className="cocs-traversal__arrival" role="status">ARRIVAL PROTECTION · {formatCountdown(traversal.arrivalSeconds)}s</p>}
   {command.interactPrompt&&<p className={`cocs-interact cocs-interact--${command.interactPrompt.source}`} role="status" aria-live="polite" aria-label={`${command.interactPrompt.verb} ${command.interactPrompt.label}. Press ${command.interactPrompt.key}. ${command.interactPrompt.anchored?'At the anchor':`${command.interactPrompt.distanceMeters} meters away`}${command.interactPrompt.channelPercent>0?`, ${command.interactPrompt.channelPercent} percent channelled`:''}`}>
    <span className="cocs-interact__mark" aria-hidden="true">{command.interactPrompt.mark}</span>
    <b className="cocs-interact__verb">{command.interactPrompt.verb}</b>
    <span className="cocs-interact__label">{command.interactPrompt.label}</span>
    <kbd className="cocs-interact__key">{command.interactPrompt.key}</kbd>
     <small className="cocs-interact__state">{command.interactPrompt.anchored?'ANCHORED':`${formatNumber(command.interactPrompt.distanceMeters)}m`}{command.interactPrompt.channelPercent>0?` · ${command.interactPrompt.channelPercent}%`:''}</small>
   </p>}
   {!command.interactPrompt&&traversal.deviceCount>0&&<p className="cocs-interact cocs-interact--idle" role="status"><span aria-hidden="true">⇢</span> STAND ON AN ANCHOR · <kbd>{traversal.interactKey}</kbd> RIDE · CUT · REPAIR</p>}
   {command.depotPrompt&&<p className="cocs-interact cocs-interact--depot" role="status"><span aria-hidden="true">{command.depotPrompt.mark}</span> {command.depotPrompt.hint} <small>{command.depotPrompt.ownerLabel}{command.depotPrompt.capturePercent>0?` · ${command.depotPrompt.capturePercent}%`:''}</small></p>}
  </div>}
  <div className="cocs-strip" role="group" aria-label="Order strip. Arm a verb, pick a node, then issue.">
   <div className="cocs-strip__verbs">
     {strip.buttons.map((button:any)=><button key={button.id} type="button" className={`cocs-verb${button.armed?' is-armed':''}${button.disabled?' is-disabled':''}`} aria-pressed={button.armed} disabled={button.disabled} title={button.disabled?`${button.label} unavailable: ${button.reason}`:button.hint} onClick={()=>command.armCocsVerb(button.id)}>{button.label} <kbd>{command.keys?.[button.id==='SCAN'?'commandScan':button.id==='GO'?'commandGo':'commandAttack']}</kbd></button>)}
   </div>
   {traversal&&<p className="cocs-strip__context" role="status"><span aria-hidden="true">◈</span> {traversal.context}</p>}
   <p className="cocs-strip__prompt" role="status" aria-live="polite">{strip.armedLabel&&!strip.targetLabel?`${strip.armedLabel} · PICK A NODE`:strip.armedLabel&&strip.targetLabel?`${strip.armedLabel} → ${strip.targetLabel}`:'ARM AN ORDER'}{strip.notice&&<span className="cocs-strip__notice">{strip.notice}</span>}</p>
    {strip.armed&&strip.nodes.length>0&&<ul className="cocs-picker">{strip.nodes.map((node:any)=><li key={node.id}><button type="button" aria-pressed={strip.target===node.id} onClick={()=>command.pickCocsTarget(node.id)}><span className="cocs-picker__index">{node.index}</span><span aria-hidden="true">{node.mark}</span> {node.label} <small>{node.ownerLabel}</small></button></li>)}</ul>}
    {strip.armed&&<button type="button" className="cocs-issue" disabled={!strip.canIssue} onClick={()=>command.issueCocsOrder()} aria-label={strip.armedLabel?`Issue ${strip.armedLabel} order${strip.targetLabel?` on ${strip.targetLabel}`:''}`:'Issue order'}>ENTER · ISSUE {strip.armedLabel}</button>}
    <p className="cocs-strip__help">Verb → number → ENTER · ESC cancels. Hold {command.keys?.command??'B'} for the board. Field guide: pause menu.</p>
   {strip.pending&&<p className="cocs-strip__pending" role="status">SENDING {strip.pending.text}…</p>}
    {strip.issued&&!strip.pending&&<p className="cocs-strip__issued" role="status">LAST {strip.issued.text}</p>}
    <button type="button" className="cocs-board-inline" onClick={command.toggleBoardPin}>{command.keys?.command??'B'} · COMMAND BOARD <small>{command.boardView?.summary?.needsYou??0} NEED YOU</small></button>
  </div>
 </div>;
}

export function PlayingHud({ui}:ScreenProps){
 const {hud,player,display,brief,phase,hudRoute,hudMap,hudMode,isTeamMode,teamName,modeGoal,ladderStatus,flagText,armsrace,WEAPONS,activePower,powerIcon,radar,radarCols,radarBlip,marker,reloadFill,reloading,posture,killNotice,suddenBanner,startBanner,scoreCue,damageIndicator,damageNumberStyle,reducedMotion,vehiclePrompt,vehicle,ammoEmpty,ammoLow,hideHud,touchControls,pointerHint,requestLock,chatOpen,isSingle,single,selectHordeUpgrade,resumeSingleplayer,spectatorTeams,CAMERA_MODE_LABELS,runtime,changeMode,grenadeStatus,streakStatus,killFeedWeapon,voiceState,voiceHint,escapeHint,clock,teamScoreText,ammoText,weaponTag,cocsCommand,cursor}=ui;
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
 const ring=abilityRing(player,harnessAbility(player.harness)||activePower,hud.config||{},{over:hud.over===true});
 const abilityDisabled=ring.disabled;
 const abilityActive=ring.active;
 const abilityRatio=ring.ratio;
 const abilityReady=ring.ready;
 const kitMovement=player.movement?.verb?MOVEMENT_VERBS.find((v:any)=>v.id===player.movement.verb)||null:null;
 const movement=player.movement?movementHud(player.movement,kitMovement):null;
 const frag=!hud.spectate?grenadeStatus(player):null;
 const fragRatio=frag?frag.ready?1:Math.max(0,Math.min(1,1-frag.cooldown/FRAG_COOLDOWN)):0;
 const streak=!hud.spectate?streakStatus(player):null;
  const spectatorTarget=hud.spectateLocal?runtime.current?.spectateDirector?.targetId:((hud.actors??[]).find((actor:any)=>actor.id===runtime.current?.spectateTarget&&actor.health>0)||(hud.actors??[]).find((actor:any)=>actor.health>0))?.id;
  const specGroups=hud.spectate?spectatorTeams(hud.actors,spectatorTarget,{points:hud.objectives?.points,includeInactive:true}).map((group:any)=>({
   key:group.key,
   team:group.team,
   label:group.team===null?'FREE AGENTS':`${teamName(group.team)} TEAM`,
   score:group.team===null?null:(Number(hud.teamScores?.[group.team])||0),
   lives:hud.objectives?.kind==='elimination'?(Number(hud.objectives.lives?.[group.team])||0):null,
   players:group.players,
  })):[];
   return <div className={`game-hud${hud.spectate?' spectating-hud':''}${cocsCommand?' lattice-hud':''}${hud.spectate&&hideHud?' hide-hud':''}${touchControls&&!hud.spectate?' touch-mode':''}`}>
  <div className="match-top" role="region" aria-label="Live match status"><div className="match-context"><span className="eyebrow">{hud.mapName?.toUpperCase()} / {hudRoute}</span><strong>{hud.modeName?.toUpperCase()}</strong><small className="phase-label">PHASE / {phase}</small>{isTeamMode(hudMode)&&<small className="team-label">{teamName(player.team)} TEAM · {hud.spectate?'FOLLOWING':'YOU'}</small>}</div><div className="match-clock" aria-label={`${hud.spectate?'Spectating':`${clock(hud.config.timeLimit-hud.time)} remaining`}`}><strong>{hud.spectate?'SPECTATING':clock(hud.config.timeLimit-hud.time)}</strong><small>{hud.net?'NETWORK MATCH':hud.config.botCount===0?'SOLO PRACTICE':isSingle?`FIRST TO ${hud.config.fragLimit} ${modeGoal(hudMode).toLowerCase()}`:''}</small></div><div className="frag-counter"><strong>{armsrace?ladderStatus(player,WEAPONS.length).rung+1:isTeamMode(hudMode)?teamScoreText(hud.teamScores??hud.teams)||player.frags:player.frags}<span>{hud.spectate?'':` / ${armsrace?WEAPONS.length:hud.config.fragLimit}`}</span></strong><small>{hud.spectate?`FOLLOWING ${player.name.toUpperCase()}`:armsrace?'LADDER RUNG':isTeamMode(hudMode)?modeGoal(hudMode):'YOUR FRAGS'}</small></div></div>
   {cursor?.active&&<div className={`cursor-chip${cursor.blocked?' has-surface':''}`} role="status" aria-live="polite" aria-label="Cursor released. Mouse input reaches the interface."><kbd>{cursor.key}</kbd> · CURSOR{cursor.blocked&&cursor.label?<span>{cursor.label}</span>:null}</div>}
   {!hud.spectate&&cursor?.active&&!cursor.blocked&&<div className="cursor-resume" role="group" aria-label="Return to combat"><button type="button" className="cursor-resume__button" onClick={cursor.resume}><b>CLICK TO FIGHT</b><small>{cursor.key} OR CLICK · MOUSE CAPTURED</small></button></div>}

   {cocsCommand&&!hud.spectate&&<CocsReadout command={cocsCommand} teamName={teamName} player={player}/>}
   {cocsCommand?.interactPrompt&&!hud.spectate&&player.health>0&&<div className="lattice-interaction-hint" aria-hidden="true"><kbd>{cocsCommand.interactPrompt.key}</kbd><span><b>{cocsCommand.interactPrompt.verb} · {cocsCommand.interactPrompt.label}</b><small>{cocsCommand.interactPrompt.channelPercent>0?`${cocsCommand.interactPrompt.channelPercent}% · KEEP THE AREA CLEAR`:cocsCommand.interactPrompt.anchored?'AT THE ANCHOR':`${cocsCommand.interactPrompt.distanceMeters} m · READ THE ACTION BEFORE USING`}</small></span></div>}
  {cocsCommand?.spend&&cocsCommand.spendVisible===false&&!hud.spectate&&<button type="button" className="cocs-spend-chip" aria-label={`Spend window open, ${Math.round(cocsCommand.spend.secondsRemaining)} seconds left. Activate to reopen.`} onClick={cocsCommand.reopenSpend}><span aria-hidden="true">▦</span> SPEND WINDOW · {Math.round(Number(cocsCommand.spend.secondsRemaining)||0)}s · OPEN</button>}
   {cocsCommand?.notice&&<div className={`cocs-notice${cocsCommand.notice.ok?'':' is-failed'}`} role="status" aria-live="polite"><i aria-hidden="true">{cocsCommand.notice.ok?'✓':'✕'}</i> {cocsCommand.notice.text}</div>}
   {cocsCommand?.spend&&cocsCommand.spendVisible!==false&&!hud.spectate&&<SpendWindowHud spend={cocsCommand.spend} onSpend={cocsCommand.spendCocs} onSkip={cocsCommand.skipSpend} cursorKey={cocsCommand.cursorKey} reducedMotion={reducedMotion()}/>}
  {cocsCommand?.boardView&&!hud.spectate&&<CommandBoardHud command={cocsCommand} open={cocsCommand.boardOpen===true} collapsed={cocsCommand.boardCollapsed===true} pinned={cocsCommand.boardPinned===true} activeId={cocsCommand.boardActive} reducedMotion={reducedMotion()} cursorKey={cocsCommand.cursorKey} onSelect={cocsCommand.selectBoardCard} onActivate={cocsCommand.activateBoardCard} onClose={cocsCommand.closeBoard} onTogglePin={cocsCommand.toggleBoardPin}/>}
  {cocsCommand?.director&&!hud.spectate&&<OperationsDirectorHud director={cocsCommand.director}/>}
  {hud.spectate&&hud.net&&runtime.current&&<button type="button" className="spectator-return" onClick={()=>changeMode('lobby')}>RETURN TO LOBBY</button>}
  {isSingle&&<SinglePlayerHud single={single} onSelectUpgrade={selectHordeUpgrade} onResumeCheckpoint={resumeSingleplayer}/>}
  {announcement==='kill'&&<div className={`kill-banner ${killNotice.kind}`} role="status" aria-live="polite">{killNotice.text}{killNotice.detail&&<small className="kill-banner-ability">{killNotice.detail}</small>}</div>}
  {announcement==='callout'&&<div className={`kill-callout ${hud.killCue.kind}`} role="status" aria-live="polite"><strong>{hud.killCue.text}</strong><small>{hud.killCue.detail}</small></div>}
  {announcement==='sudden'&&<div className="objective-announcer sudden-death" role="status" aria-live="polite"><strong>{suddenBanner.text}</strong><small>{suddenBanner.detail}</small></div>}
  {announcement==='start'&&<div className="objective-announcer start" role="status" aria-live="polite"><strong>{startBanner.text}</strong><small>{startBanner.detail}</small></div>}
  {announcement==='score'&&<div className={`objective-announcer ${scoreCue.kind}`} role="status" aria-live="polite"><strong>{scoreCue.text}</strong>{scoreCue.detail?<small>{scoreCue.detail}</small>:scoreCue.amount>1?<small>{scoreCue.amount}×</small>:null}</div>}
  {hud.training&&<LatticeTrainingHud training={hud.training} bindings={ui.bindings} cursorKey={ui.cursor?.key??'ALT'} onContinue={ui.continueTutorial} onEnd={ui.endTutorial}/>}
  <div className="visually-hidden" role="status" aria-live="polite">{hud.modeName}. {brief.title}. {brief.action}. {brief.status||brief.detail}</div>
  {hud.preparing&&<div className="preparing-overlay" role="status" aria-live="polite"><span className="eyebrow">PREPARING ARENA</span><small>Compiling shaders and warming the arena…</small></div>}
  {hud.caption&&<div className="audio-caption" role="status" aria-live="polite">{hud.caption}</div>}
  {display.showKillFeed!==false&&<div className="kill-feed" role="log" aria-live="polite" aria-relevant="additions" aria-label="Kill feed">{hud.feed?.filter((e:any)=>hud.time-e.time<6).slice(-4).map((e:any,i:number)=>{const feedWing=typeof e.killerCharacter==='string'?wingChip(e.killerCharacter):null;const label=killFeedWeapon(e,WEAPONS);return <div key={`${e.time}-${i}`}>{feedWing&&<small className="kill-feed-wing" style={{color:feedWing.color,border:`1px solid ${feedWing.color}66`,borderRadius:4,padding:'0 4px'}} title={`${feedWing.name} · ${feedWing.label}`}>{feedWing.label}</small>}<span>{e.killer}</span><Crosshair size={12}/>{label&&<small className={e.ability===true?'kill-feed-ability':''}>{label}</small>}<span>{e.victim}</span>{e.self&&<small>SELF</small>}</div>;})}</div>}
  {!hud.spectate&&display.showRadar!==false&&<div className="radar" aria-hidden="true"><svg viewBox="-1.18 -1.18 2.36 2.36" role="presentation"><circle className="radar-ring" r="1"/><circle className="radar-ring" r=".5"/><line className="radar-axis" x1="-1" y1="0" x2="1" y2="0"/><line className="radar-axis" x1="0" y1="-1" x2="0" y2="1"/><polygon className="radar-view" points="0,-.18 -.11,.12 .11,.12"/><line className="radar-sweep" x1="0" y1="0" x2="0" y2="-1"/>{radar.contacts.map((c:any,i:number)=>{const b:any=radarBlip(c,player,radarCols);if(b.shape==='circle')return <g key={`a${c.id}`} className={b.spotted?'radar-spotted':''}>{b.spotted&&<circle className="radar-spotted__ring" cx={b.cx} cy={b.cy} r={b.r*2.4} fill="none" stroke={b.fill} strokeWidth=".018"/>}<circle cx={b.cx} cy={b.cy} r={b.r} fill={b.fill} className={`${b.dead?'radar-dead':''} ${b.revealed?'radar-revealed':''}`}/>{b.spotted&&<polygon className="radar-spotted__mark" points={`${b.cx},${b.cy-.032} ${b.cx-.026},${b.cy+.018} ${b.cx+.026},${b.cy+.018}`} fill={b.fill}/>}</g>;if(b.shape==='rect')return <g key={`z${c.id}`}><rect x={b.rect.x} y={b.rect.y} width={b.rect.width} height={b.rect.height} fill={b.fill}/>{b.label&&<text className="radar-zone-label" x={b.cx} y={b.cy} textAnchor="middle" dominantBaseline="central" fill={b.fill}>{b.label}</text>}</g>;if(b.shape==='payload'){const circ=2*Math.PI*b.ring.r;return <g key="payload"><circle cx={b.cx} cy={b.cy} r={b.ring.r} fill="none" stroke={b.fill} strokeWidth={b.ring.thickness} strokeDasharray={`${(b.progressRatio??0)*circ} ${circ}`} transform={`rotate(-90 ${b.cx} ${b.cy})`} className={b.clamped?'radar-revealed':''}/><rect x={b.cx-.05} y={b.cy-.05} width=".1" height=".1" fill={b.fill}/>{b.delivered&&<circle cx={b.cx} cy={b.cy} r=".026" fill="#fff"/>}</g>;}return <polygon key={`f${b.team??'n'}-${c.index??i}`} points={b.points} fill={b.fill}/>;})}{radar.contacts.map((c:any)=>{const b:any=radarBlip(c,player,radarCols);return b.indicator?<g key={`indicator-${c.id}`} className="radar-indicator"><circle cx={b.cx} cy={b.cy} r={b.indicator.ring.r} fill="none" stroke={b.fill} strokeWidth={b.indicator.ring.thickness}/><polygon points={b.indicator.arrow} fill={b.fill}/></g>:null;})}</svg></div>}
  {hud.spectate&&<SpectatorBoard groups={specGroups} objective={brief?{title:brief.title,line:brief.detail}:null} camera={hud.spectateLocal?runtime.current?.cameraMode:undefined} cameraModes={hud.spectateLocal?CAMERA_MODE_LABELS:undefined} onCamera={(mode:string)=>{const r=runtime.current;if(!r)return;r.cameraMode=mode;if(mode==='auto')r.spectateDirector?.reframe(r.match?.snapshot());r.applySpectateCamera?.(0);}} controls={hud.spectateLocal?`${cursor?.key??'ALT'} cursor · [ / ] follow · B camera · F free cam · H hide HUD · ESC menu. Free cam: WASD / SPACE / SHIFT / CTRL.`:'[ / ] follow · H hide HUD · P third person · ESC lobby'} onFollow={(id:any)=>{const r=runtime.current;if(!r)return;if(hud.spectateLocal){if(r.spectateDirector?.setTarget(id)){if(r.cameraMode==='free')r.cameraMode='chase';r.applySpectateCamera?.(0);}}else{r.spectateTarget=id;r.view.setSpectatorTarget(id);}}}/>}
  {hud.spectate?null:player.health>0?<><SightReticle ui={ui}/>{marker&&<div className={`hitmarker ${marker}`} role="status" aria-live="polite" aria-label={marker==='kill'?'Elimination confirmed':marker==='critical'?'Critical hit confirmed':'Hit confirmed'}><span/><span/></div>}{reloading&&<div className="reload-indicator" role="status" aria-live="polite" aria-label={`Reloading ${Math.round(reloadFill*100)} percent`}><span className="reload-label">RELOADING</span><span className="reload-track"><i style={{width:`${Math.round(reloadFill*100)}%`}}/></span></div>}{posture&&<div className="posture-chip" role="status">{posture}</div>}</>:<div className="death-message"><span className="eyebrow">CONNECTION LOST</span><h2>RECOMPILING</h2><p>Respawning in {Math.max(1,Math.ceil(player.dead))}…</p></div>}
  {hud.damage&&!hud.spectate&&<div className="damage-vignette"/>}
  {display.showDamageNumbers!==false&&hud.damageNumbers?.length?<div className="damage-numbers" aria-hidden="true">{hud.damageNumbers.map((n:any)=>{const fade=damageNumberStyle((performance.now()-n.born)/1000,{reduced:reducedMotion()});return <span key={n.id} className={`damage-number ${n.kill?'kill':n.critical?'critical':'hit'}`} style={{left:`${n.x}px`,top:`${n.y}px`,opacity:fade.opacity,transform:`translate(-50%,-50%) translateY(${fade.dy}px)`}}>{n.amount}</span>;})}</div>:null}
  {damageIndicator&&!hud.spectate&&(damageIndicator.hasSource?<div className="damage-direction" style={{'--damage-angle':`${-damageIndicator.angle}rad`} as any} aria-hidden="true"><i/></div>:<div className="damage-flash" aria-hidden="true"/>)}
  <div className="hud-lower"><div className="hud-messages"><div className="pickup-message">{player.slow>0?`CONTEXT JAM · ${formatCountdown(player.slow)}s`:Object.entries(player.powerups??{}).filter(([,seconds]:any)=>seconds>0).map(([id,seconds]:any)=>`${id.toUpperCase()} · ${formatCountdown(seconds)}s`).join('  ·  ')||hud.pickup}</div>
  {player.protection>0&&player.health>0&&!hud.spectate&&<div className="spawn-protection"><Shield size={15}/> SPAWN PROTECTION</div>}
  {vehiclePrompt&&<div className="vehicle-prompt">{vehiclePrompt}</div>}
  {!vehicle&&!hud.spectate&&player.health>0&&(ammoEmpty||ammoLow)&&<div className={`ammo-warning ${ammoLow&&!ammoEmpty?'pulse':''}`}>{ammoEmpty?'OUT OF AMMO':'LOW AMMO'} / {player.ammo[player.weapon]} LEFT / 1-9/0 OR WHEEL TO SWITCH</div>}
  {pointerHint&&!cursor?.active&&runtime.current&&!hud.spectate&&!chatOpen&&!touchControls&&<div className="pointer-hint">Click the arena to capture your mouse. WASD moves; <kbd>{cursor?.key??'ALT'}</kbd> frees the cursor for the interface. <button onClick={requestLock}>Capture mouse</button></div>}
  </div></div>
  <div className="hud-bottom" role="region" aria-label="Player status">
   <div className="hud-corner hud-corner--left">
    <div className={`stat-card stat-card--vitals${healthRatio<=.3&&player.health>0?' is-low':''}`}><span className="vital vital--health"><span className="stat-label">HEALTH</span><strong className="stat-value">{Math.ceil(player.health)}</strong><span className="stat-bar"><i style={{width:`${healthRatio*100}%`}}/></span></span>
    <span className={`vital vital--armor${player.armor<=0?' is-empty':''}`}><span className="stat-label">ARMOR</span><strong className="stat-value">{Math.ceil(player.armor)}</strong><span className="stat-bar"><i style={{width:`${armorRatio*100}%`}}/></span></span></div>
    {(streak||armsrace)&&<div className="hud-pills">{!hud.spectate&&armsrace&&<span className="hud-pill"><b>ARS</b>{ladderStatus(player,WEAPONS.length).label}</span>}{streak&&<span className="hud-pill hud-pill--warn"><b>×</b>{streak.label}</span>}</div>}
   </div>
   {!isSingle&&<div className="objective-bar" aria-label="Current objective">
    {bearing!==null&&<span className="compass" aria-hidden="true"><i style={{'--bearing':`${bearing}rad`} as any}/></span>}
    <span className="objective-copy"><strong>{brief.title}</strong><small>{brief.action}</small></span>
    <span className="objective-tags"><span className="chip chip--accent">{brief.detail}</span>{hud.captureNotice?<span className="chip chip--warn">{hud.captureNotice}</span>:(isTeamMode(hudMode)||hudMode?.id==='armsrace')&&<span className="chip">{brief.status}</span>}</span>
   </div>}
   <div className="hud-corner hud-corner--right">
    {!hud.spectate&&player.health>0&&(vehicle?<div className={`stat-card stat-card--ammo${vehicle.overheated?' is-empty':''}`}><span className="stat-label">PUMA</span><strong className="stat-value">{Math.ceil(vehicle.health)}</strong><span className="stat-note">{Math.round(Math.max(0,Math.min(1,vehicle.heat))*100)}% HEAT{vehicle.overheated?' · OVERHEATED':''}</span></div>:<div className={`stat-card stat-card--ammo${ammoEmpty?' is-empty':''}`}><span className="stat-label">{weapon?.name||'WEAPON'}{weapon&&weaponTag(weapon)&&<b className="weapon-tag">{weaponTag(weapon)}</b>}</span><strong className="stat-value">{ammoText(ammoCount)}</strong><span className="stat-bar"><i style={{width:`${ammoRatio*100}%`}}/></span></div>)}
    {!hud.spectate&&<div className={`ability-card${abilityActive?' is-active':''}${abilityReady?' is-ready':''}${abilityDisabled?' is-disabled':''}`} role="status" aria-label={`Ability ${abilityReady?'ready':abilityDisabled?'unavailable':`recharging ${formatCountdown(player.cooldown)} seconds`}`}>
     <span className="ability-ring" style={{'--fill':`${abilityRatio}turn`} as any}>{powerIcon(player.harness,22)}</span>
     <span className="stat-label">{activePower?.power||'ABILITY'}</span>
     <span className="stat-note">{ring.label}</span>
    </div>}
    {!hud.spectate&&!vehicle&&movement&&<div className={`ability-card movement-card${movement.ready?' is-ready':''}${movement.phase!=='ready'?' is-active':''}${movement.enabled?'':' is-disabled'}`} role="status" aria-label={`Movement ${movement.name} · ${movement.note}`}>
     <span className="ability-ring" style={{'--fill':`${movement.progress}turn`} as any}>{movement.maxCharges>0?<b>{Math.round(movement.charges)}</b>:movement.maxFuel>0?<b>{Math.round(movement.fuel/Math.max(1e-9,movement.maxFuel)*100)}%</b>:<Move size={18}/>}</span>
     <span className="stat-label">{movement.name.toUpperCase()}</span>
     <span className="stat-note">{movement.note}</span>
    </div>}
    {frag&&<div className={`ability-card frag-card${frag.ready?' is-ready':''}`} role="status" aria-label={frag.label}>
     <span className="ability-ring" style={{'--fill':`${fragRatio}turn`} as any}><b>G</b></span>
     <span className="stat-label">FRAG</span>
     <span className="stat-note">{frag.ready?'READY':`${formatCountdown(frag.cooldown)}s`}</span>
    </div>}
   </div>
  </div>
  <div className={`hud-bottom-note${hud.time>60?' is-settled':''}`}><span className="hint-static">TAB / SCOREBOARD</span>{!hud.spectate&&<span className="hint-static"><kbd>{cursor?.key??'ALT'}</kbd> / FREE CURSOR</span>}{hud.spectate&&<span className="hint-static">[ / ] FOLLOW</span>}{hud.net&&hud.quality&&<span className={`net-quality ${hud.quality.tone}`}>{hud.quality.label} · {hud.quality.ms}MS</span>}{voiceHint(voiceState.enabled,voiceState.mode)&&<span>{voiceHint(voiceState.enabled,voiceState.mode)}</span>}{display.showFps&&<span>{hud.fps||0} FPS · {hud.renderer==='software'?'CPU':'WEBGL'}</span>}<span className="hint-static">{escapeHint(hud.net)}</span>{reducedMotion()&&<span className="motion-note">REDUCED MOTION</span>}</div></div>;
}
