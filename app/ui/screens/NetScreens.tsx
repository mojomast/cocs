'use client';
import {useEffect,useRef,useState} from 'react';
import {MatchConfiguration} from '../../game-ui/configuration';
import {ChatLine,chatUnreadLabel} from '../../game-ui/game-chat';
import {Shell,TopBar,PageHead,Panel,Btn,Tabs,Field,Chip,Empty,Banner,ActionRail,SelectCard,Segmented,Modal,Meter} from '../primitives';
import type {ScreenProps} from '../contract';
import {inviteLink,normaliseRoomCode} from '../../../game/invite.mjs';
import {leaveNeedsConfirm,seatHoldSeconds,SEAT_HOLD_MS} from '../../../game/net.mjs';
import {connectionQuality} from '../../../game/hud.mjs';
import {PLACEMENT_MATCHES,rankFor} from '../../../game/ranked.mjs';

const copyText=async(text:string)=>{
 try{await navigator.clipboard.writeText(text);return true;}catch{}
 try{const el=document.createElement('textarea');el.value=text;el.setAttribute('readonly','');el.style.position='fixed';el.style.opacity='0';document.body.appendChild(el);el.select();const ok=document.execCommand('copy');el.remove();return ok;}catch{return false;}
};

// Shape + word cues mirror every colour cue: a gain, loss or hold is never
// communicated with green/red alone. `aria-hidden` marks the glyph as decoration
// because the word beside it already carries the meaning.
const deltaShape=(delta:number)=>delta>0?'▲':delta<0?'▼':'▬';
const deltaWord=(delta:number)=>delta>0?'GAINED':delta<0?'LOST':'HELD';
const deltaText=(delta:number)=>`${delta>0?'+':''}${delta}`;
const placementText=(row:any)=>row?.provisional?`PLACEMENTS ${Math.min(Number(row.matches)||0,PLACEMENT_MATCHES)}/${PLACEMENT_MATCHES}`:`${Number(row?.matches)||0} RATED MATCHES`;

const FILTER_ALL='all';
const filterLabel=(value:any)=>String(value||'').replace(/[-_]+/g,' ').replace(/\b\w/g,(c:string)=>c.toUpperCase());
const sizeBucket=(players:any)=>{const n=Number(players)||0;return n===0?'empty':n<=2?'small':n<=5?'medium':'large';};

// Room-browser sort/search helpers. Kept pure so the fallback rules are
// testable: the server's room summary carries no per-room ping, so "BEST PING"
// only orders by `room.ping` when a server reports it and otherwise falls back
// to room-name order (the UI says so in words instead of pretending).
export const ROOM_SORT_OPTIONS=[{value:'players',label:'Most players'},{value:'ping',label:'Best ping'},{value:'name',label:'Room name'}] as const;
export function roomPingOf(room:any):number|null{const ping=Number(room?.ping);return Number.isFinite(ping)&&ping>=0?ping:null;}
export function roomNameOf(room:any):string{return String(room?.name||room?.roomId||'');}
export function sortRooms(list:any[],sort:string,pingReported:boolean):any[]{
 const rows=Array.isArray(list)?[...list]:[];
 const byName=(a:any,b:any)=>roomNameOf(a).localeCompare(roomNameOf(b));
 return rows.sort((a:any,b:any)=>{
  if(sort==='name')return byName(a,b);
  if(sort==='ping'&&pingReported){const pa=roomPingOf(a),pb=roomPingOf(b);if(pa!==pb)return (pa??Number.POSITIVE_INFINITY)-(pb??Number.POSITIVE_INFINITY);}
  else if(sort==='players'){const diff=(Number(b?.players)||0)-(Number(a?.players)||0);if(diff)return diff;}
  return byName(a,b);
 });
}
export function filterRooms(list:any[],filters:any):any[]{
 const query=String(filters?.query??'').trim().toLowerCase();
 return (Array.isArray(list)?list:[]).filter((room:any)=>{
  if(filters?.hideStarted&&room?.started)return false;
  if(query){const hay=`${room?.name??''} ${room?.roomId??''} ${room?.mapId??''} ${room?.config?.mode??''}`.toLowerCase();if(!hay.includes(query))return false;}
  if(filters?.mode&&filters.mode!==FILTER_ALL&&room?.config?.mode!==filters.mode)return false;
  if(filters?.map&&filters.map!==FILTER_ALL&&room?.mapId!==filters.map)return false;
  if(filters?.size&&filters.size!==FILTER_ALL&&sizeBucket(room?.players)!==filters.size)return false;
  return true;
 });
}
export function roomAgeSeconds(roomsAt:any,now:any):number|null{
 const stamp=Number(roomsAt);
 if(!Number.isFinite(stamp)||stamp<=0)return null;
 return Math.max(0,Math.round((Number(now)-stamp)/1000));
}
export function refreshedLabel(seconds:any):string{
 if(seconds===null||seconds===undefined||seconds==='')return 'LIST NOT REFRESHED YET';
 const value=Number(seconds);
 if(!Number.isFinite(value))return 'LIST NOT REFRESHED YET';
 return value<=0?'REFRESHED JUST NOW':`REFRESHED ${Math.max(1,Math.floor(value))}s AGO`;
}

export function BrowseScreen({ui}:ScreenProps){
 const {rooms,matches=[],netUrl='',setNetUrl,roomName='',setRoomName,netError,quickJoin,createRoom,joinRoom,refreshNet,changeMode,headActions,teamName,renderScoreboard,config,quickStart,GAME_MODES=[],getMap,DIFFICULTIES=[],myPeerId,ranked,rankedQueued,queueRanked,cancelQueue}=ui;
 const roomList:any[]=Array.isArray(rooms)?rooms:[];
 const [tab,setTab]=useState('create');
 const [queueMode,setQueueMode]=useState('unranked');
 const [modeFilter,setModeFilter]=useState(FILTER_ALL);
 const [mapFilter,setMapFilter]=useState(FILTER_ALL);
 const [sizeFilter,setSizeFilter]=useState(FILTER_ALL);
 const [roomQuery,setRoomQuery]=useState('');
 const [roomSort,setRoomSort]=useState('players');
 const [hideStarted,setHideStarted]=useState(false);
 // "Refreshed Ns ago" is read from the arrival of a new room list, never
 // guessed: the effect only fires when the page hands over a new array.
 const [roomsAt,setRoomsAt]=useState(0);
 const [nowTick,setNowTick]=useState(0);
 useEffect(()=>{if(rooms===undefined)return;const id=setTimeout(()=>setRoomsAt(Date.now()),0);return()=>clearTimeout(id);},[rooms]);
 useEffect(()=>{const id=setInterval(()=>setNowTick(Date.now()),1000);return()=>clearInterval(id);},[]);
 const [copiedRoom,setCopiedRoom]=useState<string|null>(null);
 const copyRoom=async(roomId:string)=>{const link=typeof window!=='undefined'?inviteLink(window.location.href,roomId):null;if(!link)return;if(await copyText(link)){setCopiedRoom(roomId);setTimeout(()=>setCopiedRoom(prev=>prev===roomId?null:prev),2000);}};
 const [practiceMode,setPracticeMode]=useState('deathmatch');
 const [practiceBots,setPracticeBots]=useState(3);
 const [practiceDifficulty,setPracticeDifficulty]=useState('normal');
 const rankedMode=queueMode==='ranked';
 const myRank=ranked?.players?.[myPeerId]??null;
 const rankInfo=myRank?rankFor(myRank.rating,myRank.matches):null;
 const lastMatch=ranked?.last?.entries?.find((entry:any)=>entry.peerId===myPeerId)??null;
 const live=roomList.filter((r:any)=>r.started||r.players>0).length;
 const roomModes=[...new Set(roomList.map((r:any)=>r.config?.mode).filter(Boolean))];
 const roomMaps=[...new Set(roomList.map((r:any)=>r.mapId).filter(Boolean))];
 const roomsPinged=roomList.some((r:any)=>roomPingOf(r)!==null);
 const visible=sortRooms(filterRooms(roomList,{query:roomQuery,hideStarted,mode:modeFilter,map:mapFilter,size:sizeFilter}),roomSort,roomsPinged);
 const refreshed=refreshedLabel(roomAgeSeconds(roomsAt,nowTick));
 const sortWord=roomSort==='players'?'MOST PLAYERS':roomSort==='ping'?'BEST PING':'ROOM NAME';
 const practiceConfig={...config,mode:practiceMode,botCount:practiceBots,difficulty:practiceDifficulty};
 const startPractice=()=>quickStart?.(practiceMode,{botCount:practiceBots,difficulty:practiceDifficulty});
 return <Shell head={<TopBar sub="ROOM BROWSER">{headActions}</TopBar>} rail={<ActionRail>
   <Btn onClick={()=>changeMode('selection')}>BACK</Btn>
   <Btn variant="primary" onClick={refreshNet}>REFRESH</Btn>
  </ActionRail>}>
  <PageHead eyebrow="CONCURRENT ROOMS" title={<>Pick a fight<span>.</span></>} lede="Filter open rooms by mode, map or size, join one in progress, or drop straight into a practice match against bots."/>
  <div className="stack">
   <div className="toolbar">
    <span className="toolbar-title">SERVER</span>
    <input className="ui-input" value={netUrl} onChange={e=>setNetUrl(e.target.value)} placeholder="ws://host:port" aria-label="Game server address" spellCheck={false}/>
    <Segmented value={queueMode} onChange={setQueueMode} ariaLabel="Matchmaking queue" options={[
     {value:'unranked',label:<>{queueMode==='unranked'?'✓ ':''}UNRANKED</>},
     {value:'ranked',label:<>{queueMode==='ranked'?'✓ ':''}RANKED</>},
    ]}/>
    {rankedMode
     ? (rankedQueued?<Btn onClick={cancelQueue}>LEAVE RANKED QUEUE</Btn>:<Btn variant="primary" onClick={queueRanked}>FIND RANKED MATCH</Btn>)
     : <Btn variant="primary" onClick={quickJoin}>QUICK JOIN</Btn>}
   </div>
   <Panel label="RANKED LADDER" meta={rankedMode?'QUEUE · RANKED':'QUEUE · UNRANKED (DEFAULT)'} bodyClass="stack">
    {rankInfo?<>
     <p className="field-note" role="status">RATING <b>{rankInfo.rating}</b> · <b>{rankInfo.label}</b> · {placementText(myRank)}</p>
     {lastMatch
      ?<p className="field-note"><span aria-hidden="true">{deltaShape(lastMatch.delta)}</span> {deltaWord(lastMatch.delta)} {deltaText(lastMatch.delta)} RATING · LAST RATED MATCH</p>
      :<p className="field-note">NO RATED MATCH THIS SESSION.</p>}
    </>:<p className="field-note">RATINGS ARE SERVER-AUTHORITATIVE. QUICK JOIN LOADS YOUR LADDER ROW FROM THE LOBBY.</p>}
    {rankedQueued&&<p role="status">IN RANKED QUEUE · <b>SEARCHING FOR AN EVEN MATCH</b> · LEAVE THE QUEUE ANY TIME.</p>}
    {ranked?.queue==='ranked'&&<p className="field-note" role="status">RANKED LOBBY · {ranked.active?'MATCH LIVE':'WAITING FOR HOST'} · MATCH {ranked.matchId??'—'}</p>}
   </Panel>
   {netError&&<Banner tone="error">{netError}</Banner>}
   {(config?.mode==='puma-race'||config?.mode==='puma-soccer')&&<p className="field-note">PUMA {config.mode==='puma-race'?'RACE':'SOCCER'} / Equal chassis for every driver. Operator is your identity only. Harnesses, weapons and combat gear are inactive.</p>}
   <Panel label="PRACTICE VS BOTS" meta="OFFLINE · INSTANT" bodyClass="stack">
    <p className="field-note">No server needed. Launch a local match against bots with your current operator and arena.</p>
    <div className="row">
     <label className="config-field"><span>Mode</span><select aria-label="Practice mode" value={practiceMode} onChange={e=>setPracticeMode(e.target.value)}>{GAME_MODES.filter((m:any)=>!['horde','campaign'].includes(m.id)).map((m:any)=><option key={m.id} value={m.id}>{m.name}</option>)}</select></label>
     <label className="config-field"><span>Bots</span><select aria-label="Practice bot count" value={practiceBots} onChange={e=>setPracticeBots(Number(e.target.value))}>{[0,1,2,3,4,5,6,7].map(n=><option key={n} value={n}>{n}</option>)}</select></label>
     <label className="config-field"><span>Difficulty</span><select aria-label="Practice bot difficulty" value={practiceDifficulty} onChange={e=>setPracticeDifficulty(e.target.value)}>{DIFFICULTIES.map((d:any)=><option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
     <Btn variant="primary" onClick={startPractice}>PRACTICE VS BOTS</Btn>
    </div>
    <p className="field-note">{practiceConfig.botCount} bots · {filterLabel(practiceMode)} · {filterLabel(practiceDifficulty)}. Practice starts with your saved rules; tune everything under MATCH SETUP.</p>
   </Panel>
   <div className="layout layout--trail">
    <Panel label="LIVE ROOMS" meta={`${visible.length} / ${roomList.length} SHOWN · ${live} LIVE`}>
     <div className="toolbar theater-filters" role="group" aria-label="Room filters">
      <label className="config-field"><span>Search</span><input className="ui-input" type="search" value={roomQuery} onChange={e=>setRoomQuery(e.target.value)} placeholder="Room, map or mode" aria-label="Search rooms" spellCheck={false}/></label>
      <label className="config-field"><span>Sort</span><select aria-label="Sort rooms" value={roomSort} onChange={e=>setRoomSort(e.target.value)}>{ROOM_SORT_OPTIONS.map(option=><option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
      <label className="config-field"><span>Mode</span><select aria-label="Filter by mode" value={modeFilter} onChange={e=>setModeFilter(e.target.value)}><option value={FILTER_ALL}>All modes</option>{roomModes.map((mode:any)=><option key={mode} value={mode}>{filterLabel(mode)}</option>)}</select></label>
      <label className="config-field"><span>Map</span><select aria-label="Filter by map" value={mapFilter} onChange={e=>setMapFilter(e.target.value)}><option value={FILTER_ALL}>All maps</option>{roomMaps.map((map:any)=><option key={map} value={map}>{getMap?.(map)?.name||filterLabel(map)}</option>)}</select></label>
      <label className="config-field"><span>Size</span><select aria-label="Filter by size" value={sizeFilter} onChange={e=>setSizeFilter(e.target.value)}><option value={FILTER_ALL}>Any size</option><option value="empty">Empty</option><option value="small">Small · 1-2</option><option value="medium">Medium · 3-5</option><option value="large">Large · 6+</option></select></label>
      <div className="config-field"><span>In progress</span><Btn aria-pressed={hideStarted} onClick={()=>setHideStarted(value=>!value)}>{hideStarted?'✓ IN-PROGRESS HIDDEN':'HIDE IN-PROGRESS'}</Btn></div>
     </div>
     <p className="field-note">{refreshed} · SORT {sortWord}{roomsPinged?'':roomSort==='ping'?' · THIS SERVER REPORTS NO PER-ROOM PING, SO ROOMS FALL BACK TO NAME ORDER':''}{hideStarted?' · MATCHES IN PROGRESS ARE HIDDEN':''}</p>
     <div className="stack stack--tight">
      {visible.map((room:any)=>{
       const carded=room.started&&room.players>0;
       return <div key={room.roomId} className="stack stack--tight">
        <SelectCard name={room.name||room.roomId} tag={room.started?`IN MATCH · ${room.mapId??'arena'}`:room.players>0?'LOBBY OPEN':'EMPTY'} meta={`${room.players}P`} onClick={carded?undefined:()=>joinRoom(room.roomId,false)}/>
         <div className="row">
          <Btn size="sm" onClick={()=>joinRoom(room.roomId,false)} disabled={carded}>{room.started?'SPECTATE':'JOIN'}</Btn>
          <Btn size="sm" onClick={()=>joinRoom(room.roomId,true)}>WATCH</Btn>
          <Btn size="sm" variant="ghost" onClick={()=>copyRoom(room.roomId)}>{copiedRoom===room.roomId?'LINK COPIED':'COPY LINK'}</Btn>
         </div>
       </div>;
      })}
      {roomList.length===0&&<Empty title="No rooms yet">Create one below — the first player to join becomes host.</Empty>}
      {roomList.length>0&&visible.length===0&&<Empty title="No matching rooms">Try a different search, mode, map or size filter.</Empty>}
     </div>
    </Panel>
    <Panel>
     <Tabs value={tab} onChange={setTab} tabs={[{value:'create',label:'Create room'},{value:'recent',label:'Recent'}]} ariaLabel="Room browser panels"/>
     {tab==='create'&&<div className="stack">
      <Field label="Room name" note="A room gets a short code others can type or click.">
       <input className="ui-input" value={roomName} onChange={e=>setRoomName(e.target.value)} placeholder="Room name" aria-label="Room name" spellCheck={false}/>
      </Field>
      <Btn variant="primary" onClick={createRoom}>CREATE &amp; HOST</Btn>
     </div>}
     {tab==='recent'&&<div className="stack stack--tight">
      {matches.slice(0,6).map((m:any)=><Panel key={m.id} label={`${String(m.mode??'deathmatch').toUpperCase()} · ${String(m.mapId??'arena').toUpperCase()}`} meta={m.winner!==null&&m.winner!==undefined?`${teamName(m.winner)} WINNER`:undefined}>
       {renderScoreboard(m,true)}
       {m.leader&&<p className="field-note">{m.leader}</p>}
      </Panel>)}
      {matches.length===0&&<Empty title="No completed matches">No completed matches on this server yet.</Empty>}
     </div>}
    </Panel>
   </div>
  </div>
 </Shell>;
}

export function LobbyScreen({ui}:ScreenProps){
 const {netPlayers=[],myPeerId,netRoomId,netError,chatLog=[],chatDraft='',setChatDraft,sendChat,newMessages,setNewMessages,lobbyInputRef,lobbyChatRef,chatAtBottom,voicePanel,config,setConfig,mapId,setMapId,selectableMaps=[],selectedMap,selectedMode,hostAndStart,reconnectNet,resumeNet,disconnectNet,netReady,netMapVote,netRematch,netWarmup,getMap,runtime,net={},ranked,rankedQueued,queueRanked,cancelQueue}=ui;
 const connected=!!net.connected;
 const chatAtBottomRef=chatAtBottom;
 // A copy confirmation is earned, never assumed: the state only becomes
 // 'copied' after `copyText` resolves true, and a failed copy says so in words
 // and selects the field instead of pretending the clipboard holds the link.
 const [copyState,setCopyState]=useState<'idle'|'copied'|'failed'>('idle');
 const inviteInputRef=useRef<HTMLInputElement>(null);
 // Lobby lifecycle, mirrored verbatim from the server's `lifecycle()` payload.
 // Every tally is authoritative; the local flags below only remember what this
 // client just sent so a control can render its optimistic pressed state.
 const lifecycle=net.lifecycle??null;
 const ratedRoom=ranked?.queue==='ranked'||rankedQueued!=null;
 const needsLeaveConfirm=leaveNeedsConfirm({started:net.started===true,roundOver:net.roundOver===true,rated:ratedRoom});
 const [confirmLeave,setConfirmLeave]=useState(false);
 const [voteMapId,setVoteMapId]=useState('');
 // Optimistic local vote flags are scoped to a room+round key, so a new room or
 // round derives a clean slate during render instead of resetting in effects.
 const voteScopeKey=`${netRoomId}:${net.roundOver===true?'over':'live'}`;
 const [voteScope,setVoteScope]=useState({key:voteScopeKey,map:null as string|null,rematch:false});
 const scoped=voteScope.key===voteScopeKey?voteScope:{key:voteScopeKey,map:null,rematch:false};
 const myMapVote=scoped.map,myRematchVote=scoped.rematch;
 const setMyMapVote=(value:string)=>setVoteScope({key:voteScopeKey,map:value,rematch:scoped.rematch});
 const setMyRematchVote=(value:boolean)=>setVoteScope({key:voteScopeKey,map:scoped.map,rematch:value});
 // One-second mirror of the live transport: the seat-hold countdown and the
 // measured RTT refresh on the interval stamp, never from a stale render.
 const [uiTick,setUiTick]=useState(0);
 useEffect(()=>{const id=setInterval(()=>setUiTick(typeof performance!=='undefined'?performance.now():Date.now()),1000);return()=>clearInterval(id);},[]);
 const liveNet=runtime?.current?.net;
 const holdLeft=uiTick?seatHoldSeconds(net.disconnectedAt??liveNet?.disconnectedAt,uiTick):null;
 const liveRtt=Number.isFinite(liveNet?.rtt)?liveNet.rtt:(Number.isFinite(net.rtt)?net.rtt:null);
 // Diagnostics read the live client, never a derived guess. The jitter/loss
 // estimators sit at 0 until the server streams snapshots, so until then the
 // readout says the stream has not started instead of claiming a clean link.
 const liveJitter=Number.isFinite(liveNet?.jitter)?liveNet.jitter:null;
 const liveLoss=Number.isFinite(liveNet?.lossRate)?liveNet.lossRate:null;
 const streamSeen=!!liveNet&&liveNet._lastRecvAt!==null&&liveNet._lastRecvAt!==undefined;
 const quality=streamSeen?connectionQuality({jitter:liveJitter??0,lossRate:liveLoss??0,renderDelay:liveNet?.renderDelay}):null;
 const diagState=connected?'CONNECTED':holdLeft!==null?'RECONNECTING':'OFFLINE';
 const voteOptions=Array.isArray(selectableMaps)?selectableMaps:[];
 const voteValue=voteOptions.some((m:any)=>m?.id===voteMapId)?voteMapId:(voteOptions[0]?.id??mapId??'');
 const voteRows=lifecycle?Object.entries(lifecycle.mapVotes??{}).map(([id,count]:[string,any])=>({id,name:getMap?.(id)?.name??id,votes:Number(count)||0})).sort((a:any,b:any)=>b.votes-a.votes||String(a.name).localeCompare(String(b.name))):[];
 const voteMax=voteRows.reduce((max:number,row:any)=>Math.max(max,row.votes),0);
 // Vote-close countdown only exists when the server sends a finite value; absent
 // that, the panel states the truthful rule instead of inventing a timer.
 const voteCloseRaw=lifecycle?.voteClose;
 const voteClose=voteCloseRaw===null||voteCloseRaw===undefined||voteCloseRaw===''?null:(Number.isFinite(Number(voteCloseRaw))?Math.max(0,Math.ceil(Number(voteCloseRaw))):null);
 const rematchShort=lifecycle?Math.max(0,(Number(lifecycle.rematchNeeded)||0)-(Number(lifecycle.rematch)||0)):0;
 const myName=netPlayers.find((p:any)=>p.peerId===myPeerId)?.name??config?.playerName??'';
 const roomCode=normaliseRoomCode(netRoomId)??netRoomId;
 const joinState=!connected?'DISCONNECTED':net.spectate?'SPECTATING':net.isHost?'HOSTING':'WAITING ON HOST';
 const myRank=ranked?.players?.[myPeerId]??null;
 const rankInfo=myRank?rankFor(myRank.rating,myRank.matches):null;
 const lastMatch=ranked?.last?.entries?.find((entry:any)=>entry.peerId===myPeerId)??null;
 const invite=typeof window!=='undefined'?inviteLink(window.location.href,netRoomId,{spectate:net.spectate===true}):null;
 const copyInvite=async()=>{if(!invite){setCopyState('failed');return;}const ok=await copyText(invite);setCopyState(ok?'copied':'failed');if(!ok)inviteInputRef.current?.select();setTimeout(()=>setCopyState('idle'),2200);};
 return <Shell head={<TopBar sub={netRoomId?`ROOM ${netRoomId}`:'NETWORK LOBBY'}>{ui.headActions}</TopBar>} rail={<ActionRail>
   {ranked?.queue!=='ranked'&&(rankedQueued?<Btn onClick={cancelQueue}>LEAVE RANKED QUEUE</Btn>:<Btn onClick={queueRanked}>FIND RANKED MATCH</Btn>)}
   {ranked?.queue==='ranked'&&<Chip tone="accent">RANKED</Chip>}
   {netRoomId&&<Btn onClick={copyInvite} disabled={!invite}>{copyState==='copied'?'INVITE COPIED':copyState==='failed'?'COPY FAILED':'COPY INVITE LINK'}</Btn>}
   {net.isHost?<Btn variant="primary" onClick={hostAndStart} disabled={!connected}>START NETWORK MATCH</Btn>:<Chip tone={connected?'default':'danger'}>{connected?(net.spectate?'SPECTATING':'WAITING ON HOST'):'DISCONNECTED'}</Chip>}
   <Btn variant="danger" onClick={()=>{if(needsLeaveConfirm)setConfirmLeave(true);else disconnectNet();}}>DISCONNECT</Btn>
  </ActionRail>}>
   <PageHead eyebrow="PLAYERS ONLINE" title={<>Gather at the server<span>.</span></>} lede="First to join hosts the match. Escape during play returns here."/>
   {netRoomId&&<>
    <div className="toolbar">
     <span className="toolbar-title">INVITE</span>
     <span className="label">ROOM CODE <b className="room-code">{roomCode}</b></span>
     <Chip tone={connected?'default':'danger'}>{joinState}</Chip>
     <input ref={inviteInputRef} className="ui-input" readOnly value={invite||''} aria-label="Room invite link" spellCheck={false} onFocus={e=>e.currentTarget.select()}/>
     <Btn variant="primary" onClick={copyInvite} disabled={!invite}>{copyState==='copied'?'COPIED ✓':copyState==='failed'?'COPY FAILED':'COPY LINK'}</Btn>
    </div>
    {copyState==='failed'&&<p className="field-note">COPY FAILED · THE LINK FIELD IS SELECTED, COPY IT MANUALLY.</p>}
   </>}
  <div className="layout layout--3">
   <Panel label="01 / PLAYERS" meta={`${netPlayers.length} CONNECTED`} bodyClass="stack">
    <div className="stack stack--tight">
     {netPlayers.map((p:any,i:number)=>{
      const status=p.spectate?'SPECTATOR':p.connected===false?'DISCONNECTED · SEAT HELD':p.peerId===net.hostId?'HOST':p.actorId!==null&&p.actorId!==undefined?'IN MATCH':p.ready===true?'READY':'NOT READY';
      const mine=p.peerId===myPeerId;
      return <div key={p.peerId} className="row row--between">
       <SelectCard selected={mine} name={p.name} tag={status} meta={p.spectate?'WATCH':p.connected===false?'…':p.actorId!==null&&p.actorId!==undefined?`A${p.actorId}`:String(i+1).padStart(2,'0')}/>
       {!p.spectate&&(mine
        ?<Btn size="sm" aria-pressed={p.ready===true} aria-label={p.ready===true?'Cancel your ready status':'Mark yourself ready'} onClick={()=>netReady(p.ready!==true)} disabled={!connected}>{p.ready===true?'READY ✓':'MARK READY'}</Btn>
        :<Chip tone={p.ready===true?'accent':'default'}>{p.ready===true?'READY':'NOT READY'}</Chip>)}
      </div>;
     })}
     {netPlayers.length===0&&<Empty title="No players">Waiting for players to connect.</Empty>}
    </div>
    <p className="field-note">Your actor stays in the match if you leave; it idles until the next start.</p>
   </Panel>
   <div className="stack">
    <Panel label="CHAT" meta="ROOM ONLY" bodyClass="stack">
     <div ref={lobbyChatRef} role="log" aria-label="Room chat" tabIndex={0} className="stack stack--tight panel-body--scroll chat-log" onScroll={e=>{const el=e.currentTarget;chatAtBottomRef.current=el.scrollHeight-el.scrollTop-el.clientHeight<32;if(chatAtBottomRef.current)setNewMessages(0);}}>
      {chatLog.map((m:any,i:number)=><ChatLine key={i} message={m} selfName={myName}/>)}
     </div>
     {newMessages>0&&<Btn size="sm" variant="ghost" onClick={()=>{chatAtBottomRef.current=true;const el=lobbyChatRef.current;if(el)el.scrollTop=el.scrollHeight;setNewMessages(0);}}>{chatUnreadLabel(newMessages)}</Btn>}
     <div className="row">
      <input ref={lobbyInputRef} className="ui-input" value={chatDraft} onChange={e=>setChatDraft(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.nativeEvent.isComposing)sendChat();}} placeholder="Message the room…" aria-label="Chat message" spellCheck={false}/>
      <Btn size="sm" onClick={sendChat}>SEND</Btn>
     </div>
    </Panel>
    <Panel label="VOICE">{voicePanel}</Panel>
   </div>
   <Panel label="02 / MATCH CONTROL" meta={connected?(net.isHost?'YOU ARE HOST':'WAITING ON HOST'):'OFFLINE'} bodyClass="stack">
    {(rankInfo||ranked?.queue==='ranked')&&<div className="stack stack--tight" role="status" aria-label="Ranked status">
     <p className="field-note">{ranked?.queue==='ranked'?'RANKED · RATED MATCH':'CASUAL · UNRANKED'}{ranked?.matchId?` · MATCH ${ranked.matchId}`:''}{ranked?.active?' · LIVE':''}</p>
     {rankInfo&&<p className="field-note">YOUR RATING <b>{rankInfo.rating}</b> · <b>{rankInfo.label}</b> · {placementText(myRank)}</p>}
     {lastMatch&&<p className="field-note"><span aria-hidden="true">{deltaShape(lastMatch.delta)}</span> {deltaWord(lastMatch.delta)} {deltaText(lastMatch.delta)} RATING · LAST MATCH</p>}
     {ranked?.skipped>0&&<p className="field-note">RATED SETTLEMENT SKIPPED · MODE OR BOT RULES NOT RATED.</p>}
    </div>}
    {!connected?<>
     {netError&&<Banner tone="error">{netError||'Connection lost.'}</Banner>}
     {holdLeft!==null&&<p className="field-note">{holdLeft>0?`SEAT HELD ~${holdLeft}s · RECONNECT before the server recycles your seat.`:'SEAT HOLD WINDOW PASSED · RECONNECT TO REJOIN.'}</p>}
     <Btn variant="primary" onClick={reconnectNet}>RECONNECT</Btn>
    </>:net.started&&(net.actorId!==null&&net.actorId!==undefined||net.spectate)&&!net.roundOver?<>
     <p className="field-note">Your match is still running. Return without restarting the round.</p>
     <Btn variant="primary" onClick={resumeNet}>{net.spectate?'WATCH MATCH':'RESUME MATCH'}</Btn>
    </>:net.spectate?<>
     <p className="field-note">Watching this room as a <b>spectator</b>. You will follow live actors once the match runs — no firing arm, no seat.</p>
     {net.started&&!net.roundOver?<Btn variant="primary" onClick={resumeNet}>WATCHING MATCH</Btn>:<p className="field-note">Waiting for the host to start. You will see snapshots automatically.</p>}
    </>:net.isHost?<>
     <MatchConfiguration config={config} excludeModes={['horde','campaign']} onChange={setConfig}/>
     <div className="row row--between"><span className="label">ARENA</span><span className="label">{selectedMap?.tag}</span></div>
     <div className="grid-cards">
      {selectableMaps.map((map:any)=><SelectCard key={map.id} selected={mapId===map.id} onClick={()=>setMapId(map.id)} name={map.name} tag={map.tag} stats={map.description} ariaLabel={map.name}/>)}
     </div>
     <p className="field-note">{selectedMode?.name} · {config?.botCount??0} BOTS · {netPlayers.length} PLAYERS</p>
     <Btn variant="primary" size="lg" onClick={hostAndStart} disabled={!connected}>START NETWORK MATCH</Btn>
    </>:<p className="field-note">Waiting for the host to choose match settings and start. You will be placed automatically.</p>}
    {connected&&lifecycle&&<div className="stack stack--tight" role="group" aria-label="Lobby readiness">
     <div className="row row--between"><span className="label">READINESS</span><span className="label">{Number(lifecycle.ready)||0} / {Number(lifecycle.readyNeeded)||0} READY</span></div>
     {liveRtt!==null&&<p className="field-note">YOUR PING · {Math.round(liveRtt)}MS · {liveRtt<60?'GOOD':liveRtt<120?'FAIR':'POOR'}</p>}
     {lifecycle.phase==='warmup'
      ?<div className="row row--between"><p className="field-note">WARMUP · MATCH STARTS IN {Math.max(0,Math.ceil(Number(lifecycle.warmup)||0))}s</p>{net.isHost&&!net.spectate&&<Btn size="sm" onClick={()=>netWarmup(true)}>CANCEL WARMUP</Btn>}</div>
      :net.isHost&&!net.spectate&&(net.started!==true||net.roundOver===true)&&<Btn size="sm" onClick={()=>netWarmup(false)} disabled={!connected}>START WARMUP · {Number(lifecycle.readyNeeded)||0} READY NEEDED</Btn>}
     <p className="field-note">Ready feeds the warmup gate only: the host can still start directly at any time.</p>
    </div>}
    {connected&&lifecycle&&<div className="stack stack--tight" role="group" aria-label="Map votes">
     <div className="row row--between"><span className="label">MAP VOTES</span><span className="label">{lifecycle.mapVoteWinner?`LEADING · ${getMap?.(lifecycle.mapVoteWinner)?.name??lifecycle.mapVoteWinner}`:'NO VOTES YET'}</span></div>
     {voteRows.length>0&&<div className="vote-rows">{voteRows.map((row:any)=><div key={row.id} className="vote-row">
      <div className="row row--between"><span className="label">{row.name}</span><span className="label">{row.votes} VOTE{row.votes===1?'':'S'}{row.votes===voteMax&&voteMax>0?' · LEADING':''}</span></div>
      <span aria-hidden="true"><Meter ratio={voteMax>0?row.votes/voteMax:0}/></span>
     </div>)}</div>}
     {voteClose!==null
      ?<p className="field-note">MAP VOTES CLOSE IN {voteClose}s · VOTE BEFORE THE COUNTDOWN ENDS.</p>
      :<p className="field-note">VOTES STAY OPEN UNTIL CHANGED · THE LEADING MAP IS SHOWN TO EVERYONE.</p>}
     <div className="toolbar">
      <label className="config-field"><span>Your map</span><select aria-label="Map vote" value={voteValue} onChange={e=>setVoteMapId(e.target.value)} disabled={!connected||net.spectate===true}>{voteOptions.map((m:any)=><option key={m.id} value={m.id}>{m.name}{lifecycle.mapVotes?.[m.id]?` · ${lifecycle.mapVotes[m.id]} VOTE${Number(lifecycle.mapVotes[m.id])===1?'':'S'}`:''}</option>)}</select></label>
      <Btn size="sm" aria-pressed={myMapVote===voteValue} aria-label={myMapVote===voteValue?`Change your map vote to ${getMap?.(voteValue)?.name??voteValue}`:`Vote for ${getMap?.(voteValue)?.name??voteValue}`} onClick={()=>{if(!voteValue)return;setMyMapVote(voteValue);netMapVote(voteValue);}} disabled={!connected||net.spectate===true||!voteValue}>{myMapVote===voteValue?'VOTE CAST · CHANGE':'VOTE FOR MAP'}</Btn>
     </div>
    </div>}
    {connected&&lifecycle&&net.started===true&&<div className="stack stack--tight" role="group" aria-label="Rematch vote">
     <div className="row row--between"><span className="label">REMATCH</span><span className="label">{Number(lifecycle.rematch)||0} / {Number(lifecycle.rematchNeeded)||0} VOTES</span></div>
     <Btn size="sm" aria-pressed={myRematchVote} aria-label={myRematchVote?'Your rematch vote is cast':'Vote for a rematch'} onClick={()=>{setMyRematchVote(true);netRematch();}} disabled={!connected||net.spectate===true||net.roundOver!==true}>{myRematchVote?'REMATCH VOTE CAST':'VOTE REMATCH'}</Btn>
     <p className="field-note">{lifecycle.rematchReady===true?'GATE MET · THE HOST CAN RESTART WITHOUT A WARMUP.':net.roundOver!==true?'REMATCH VOTES COUNT ONCE THE ROUND ENDS.':`REMATCH NEEDS ${rematchShort} MORE VOTE${rematchShort===1?'':'S'}.`}</p>
     {net.isHost&&!net.spectate&&lifecycle.rematchReady===true&&<Btn variant="primary" onClick={hostAndStart} disabled={!connected}>REMATCH NOW · GATE MET</Btn>}
    </div>}
    {netError&&connected&&<Banner tone="error">{netError}</Banner>}
    {(netRoomId||connected)&&<div className="stack stack--tight" role="group" aria-label="Connection diagnostics">
     <div className="row row--between"><span className="label">CONNECTION</span><span className="label">{quality?quality.label:'MEASURING'}</span></div>
     <div className="diag-rows">
      {liveRtt!==null?<p className="field-note">RTT · <b>{Math.round(liveRtt)} MS</b> · ROUND TRIP</p>:<p className="field-note">RTT · <b>WAITING FOR PONG</b> · ROUND TRIP</p>}
      {quality?<p className="field-note">J · <b>{quality.jitter} MS</b> · JITTER</p>:<p className="field-note">J · <b>NO SNAPSHOTS YET</b> · JITTER</p>}
      {quality?<p className="field-note">L · <b>{quality.loss}%</b> · LOSS</p>:<p className="field-note">L · <b>NO SNAPSHOTS YET</b> · LOSS</p>}
      <p className="field-note">STATE · <b>{diagState}</b>{diagState==='CONNECTED'?' · SOCKET OPEN':diagState==='RECONNECTING'?' · SEAT HELD FOR A SHORT WINDOW':' · NOT CONNECTED'}</p>
      {holdLeft!==null&&<p className="field-note">SEAT HOLD · <b>{holdLeft>0?`~${holdLeft}s LEFT`:'WINDOW PASSED'}</b> · {holdLeft>0?'RECONNECT TO REJOIN':'THE SERVER MAY HAVE RECYCLED THE SEAT'}</p>}
     </div>
    </div>}
    <Modal open={confirmLeave} onClose={()=>setConfirmLeave(false)} size="sm" eyebrow="CONFIRM" title="Leave this match?" footer={<>
     <Btn onClick={()=>setConfirmLeave(false)}>STAY IN MATCH</Btn>
     <Btn variant="danger" onClick={()=>{setConfirmLeave(false);disconnectNet();}}>LEAVE MATCH</Btn>
    </>}>
     <p className="field-note">{net.started===true&&net.roundOver!==true?'The round is still running.':ratedRoom?'This room is rated.':''} After a disconnect the server holds your seat for about {Math.round(SEAT_HOLD_MS/1000)}s, so reconnecting can return you to it.</p>
    </Modal>
   </Panel>
  </div>
 </Shell>;
}
