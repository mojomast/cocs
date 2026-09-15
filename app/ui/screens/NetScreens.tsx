'use client';
import {useState} from 'react';
import {MatchConfiguration} from '../../game-ui/configuration';
import {Shell,TopBar,PageHead,Panel,Btn,Tabs,Field,Chip,Empty,Banner,ActionRail,SelectCard} from '../primitives';
import type {ScreenProps} from '../contract';
import {inviteLink} from '../../../game/invite.mjs';

const copyText=async(text:string)=>{
 try{await navigator.clipboard.writeText(text);return true;}catch{}
 try{const el=document.createElement('textarea');el.value=text;el.setAttribute('readonly','');el.style.position='fixed';el.style.opacity='0';document.body.appendChild(el);el.select();const ok=document.execCommand('copy');el.remove();return ok;}catch{return false;}
};

const FILTER_ALL='all';
const filterLabel=(value:any)=>String(value||'').replace(/[-_]+/g,' ').replace(/\b\w/g,(c:string)=>c.toUpperCase());
const sizeBucket=(players:any)=>{const n=Number(players)||0;return n===0?'empty':n<=2?'small':n<=5?'medium':'large';};

export function BrowseScreen({ui}:ScreenProps){
 const {rooms=[],matches=[],netUrl='',setNetUrl,roomName='',setRoomName,netError,quickJoin,createRoom,joinRoom,refreshNet,changeMode,headActions,teamName,renderScoreboard,config,quickStart,GAME_MODES=[],getMap,DIFFICULTIES=[]}=ui;
 const [tab,setTab]=useState('create');
 const [modeFilter,setModeFilter]=useState(FILTER_ALL);
 const [mapFilter,setMapFilter]=useState(FILTER_ALL);
 const [sizeFilter,setSizeFilter]=useState(FILTER_ALL);
 const [copiedRoom,setCopiedRoom]=useState<string|null>(null);
 const copyRoom=async(roomId:string)=>{const link=typeof window!=='undefined'?inviteLink(window.location.href,roomId):null;if(!link)return;if(await copyText(link)){setCopiedRoom(roomId);setTimeout(()=>setCopiedRoom(prev=>prev===roomId?null:prev),2000);}};
 const [practiceMode,setPracticeMode]=useState('deathmatch');
 const [practiceBots,setPracticeBots]=useState(3);
 const [practiceDifficulty,setPracticeDifficulty]=useState('normal');
 const live=rooms.filter((r:any)=>r.started||r.players>0).length;
 const roomModes=[...new Set(rooms.map((r:any)=>r.config?.mode).filter(Boolean))];
 const roomMaps=[...new Set(rooms.map((r:any)=>r.mapId).filter(Boolean))];
 const visible=rooms.filter((r:any)=>{if(modeFilter!==FILTER_ALL&&r.config?.mode!==modeFilter)return false;if(mapFilter!==FILTER_ALL&&r.mapId!==mapFilter)return false;if(sizeFilter!==FILTER_ALL&&sizeBucket(r.players)!==sizeFilter)return false;return true;});
 const practiceConfig={...config,mode:practiceMode,botCount:practiceBots,difficulty:practiceDifficulty};
 const startPractice=()=>quickStart?.(practiceMode);
 return <Shell head={<TopBar sub="ROOM BROWSER">{headActions}</TopBar>} rail={<ActionRail>
   <Btn onClick={()=>changeMode('selection')}>BACK</Btn>
   <Btn variant="primary" onClick={refreshNet}>REFRESH</Btn>
  </ActionRail>}>
  <PageHead eyebrow="CONCURRENT ROOMS" title={<>Pick a fight<span>.</span></>} lede="Filter open rooms by mode, map or size, join one in progress, or drop straight into a practice match against bots."/>
  <div className="stack">
   <div className="toolbar">
    <span className="toolbar-title">SERVER</span>
    <input className="ui-input" value={netUrl} onChange={e=>setNetUrl(e.target.value)} placeholder="ws://host:port" aria-label="Game server address" spellCheck={false}/>
    <Btn variant="primary" onClick={quickJoin}>QUICK JOIN</Btn>
   </div>
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
    <Panel label="LIVE ROOMS" meta={`${visible.length} / ${rooms.length} SHOWN · ${live} LIVE`}>
     <div className="toolbar theater-filters" role="group" aria-label="Room filters">
      <label className="config-field"><span>Mode</span><select aria-label="Filter by mode" value={modeFilter} onChange={e=>setModeFilter(e.target.value)}><option value={FILTER_ALL}>All modes</option>{roomModes.map((mode:any)=><option key={mode} value={mode}>{filterLabel(mode)}</option>)}</select></label>
      <label className="config-field"><span>Map</span><select aria-label="Filter by map" value={mapFilter} onChange={e=>setMapFilter(e.target.value)}><option value={FILTER_ALL}>All maps</option>{roomMaps.map((map:any)=><option key={map} value={map}>{getMap?.(map)?.name||filterLabel(map)}</option>)}</select></label>
      <label className="config-field"><span>Size</span><select aria-label="Filter by size" value={sizeFilter} onChange={e=>setSizeFilter(e.target.value)}><option value={FILTER_ALL}>Any size</option><option value="empty">Empty</option><option value="small">Small · 1-2</option><option value="medium">Medium · 3-5</option><option value="large">Large · 6+</option></select></label>
     </div>
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
      {rooms.length===0&&<Empty title="No rooms yet">Create one below — the first player to join becomes host.</Empty>}
      {rooms.length>0&&visible.length===0&&<Empty title="No matching rooms">Try a different mode, map or size filter.</Empty>}
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
 const {netPlayers=[],myPeerId,netRoomId,netError,chatLog=[],chatDraft='',setChatDraft,sendChat,newMessages,setNewMessages,lobbyInputRef,lobbyChatRef,chatAtBottom,voicePanel,config,setConfig,mapId,setMapId,selectableMaps=[],selectedMap,selectedMode,hostAndStart,reconnectNet,resumeNet,disconnectNet,net={}}=ui;
 const connected=!!net.connected;
 const chatAtBottomRef=chatAtBottom;
 const [copied,setCopied]=useState(false);
 const invite=typeof window!=='undefined'?inviteLink(window.location.href,netRoomId):null;
 const copyInvite=async()=>{if(!invite)return;if(await copyText(invite)){setCopied(true);setTimeout(()=>setCopied(false),2200);}};
 return <Shell head={<TopBar sub={netRoomId?`ROOM ${netRoomId}`:'NETWORK LOBBY'}>{ui.headActions}</TopBar>} rail={<ActionRail>
   {netRoomId&&<Btn onClick={copyInvite}>{copied?'LINK COPIED':'COPY INVITE LINK'}</Btn>}
   {net.isHost?<Btn variant="primary" onClick={hostAndStart} disabled={!connected}>START NETWORK MATCH</Btn>:<Chip tone={connected?'default':'danger'}>{connected?(net.spectate?'SPECTATING':'WAITING ON HOST'):'DISCONNECTED'}</Chip>}
   <Btn variant="danger" onClick={disconnectNet}>DISCONNECT</Btn>
  </ActionRail>}>
   <PageHead eyebrow="PLAYERS ONLINE" title={<>Gather at the server<span>.</span></>} lede="First to join hosts the match. Escape during play returns here."/>
   {netRoomId&&<div className="toolbar">
    <span className="toolbar-title">INVITE</span>
    <input className="ui-input" readOnly value={invite||''} aria-label="Room invite link" spellCheck={false} onFocus={e=>e.currentTarget.select()}/>
    <Btn variant="primary" onClick={copyInvite}>{copied?'COPIED':'COPY LINK'}</Btn>
   </div>}
  <div className="layout layout--3">
   <Panel label="01 / PLAYERS" meta={`${netPlayers.length} CONNECTED`} bodyClass="stack">
    <div className="stack stack--tight">
     {netPlayers.map((p:any,i:number)=>{
      const status=p.spectate?'SPECTATOR':p.connected===false?'DISCONNECTED · SEAT HELD':p.peerId===net.hostId?'HOST':p.actorId!==null&&p.actorId!==undefined?'IN MATCH':'READY';
      return <SelectCard key={p.peerId} selected={p.peerId===myPeerId} name={p.name} tag={status} meta={p.spectate?'WATCH':p.connected===false?'…':p.actorId!==null&&p.actorId!==undefined?`A${p.actorId}`:String(i+1).padStart(2,'0')}/>;
     })}
     {netPlayers.length===0&&<Empty title="No players">Waiting for players to connect.</Empty>}
    </div>
    <p className="field-note">Your actor stays in the match if you leave; it idles until the next start.</p>
   </Panel>
   <div className="stack">
    <Panel label="CHAT" meta="ROOM ONLY" bodyClass="stack">
     <div ref={lobbyChatRef} role="log" aria-label="Room chat" tabIndex={0} className="stack stack--tight panel-body--scroll" onScroll={e=>{const el=e.currentTarget;chatAtBottomRef.current=el.scrollHeight-el.scrollTop-el.clientHeight<32;if(chatAtBottomRef.current)setNewMessages(false);}}>
      {chatLog.map((m:any,i:number)=><div key={i}><b>{m.name}</b>{m.text}</div>)}
     </div>
     {newMessages&&<Btn size="sm" variant="ghost" onClick={()=>{chatAtBottomRef.current=true;const el=lobbyChatRef.current;if(el)el.scrollTop=el.scrollHeight;setNewMessages(false);}}>New messages / jump to latest</Btn>}
     <div className="row">
      <input ref={lobbyInputRef} className="ui-input" value={chatDraft} onChange={e=>setChatDraft(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.nativeEvent.isComposing)sendChat();}} placeholder="Message the room…" aria-label="Chat message" spellCheck={false}/>
      <Btn size="sm" onClick={sendChat}>SEND</Btn>
     </div>
    </Panel>
    <Panel label="VOICE">{voicePanel}</Panel>
   </div>
   <Panel label="02 / MATCH CONTROL" meta={connected?(net.isHost?'YOU ARE HOST':'WAITING ON HOST'):'OFFLINE'} bodyClass="stack">
    {!connected?<>
     {netError&&<Banner tone="error">{netError||'Connection lost.'}</Banner>}
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
    {netError&&connected&&<Banner tone="error">{netError}</Banner>}
   </Panel>
  </div>
 </Shell>;
}
