'use client';
import {useState} from 'react';
import {MatchConfiguration} from '../../game-ui/configuration';
import {Shell,TopBar,PageHead,Panel,Btn,Tabs,Field,Chip,Empty,Banner,ActionRail,SelectCard} from '../primitives';
import type {ScreenProps} from '../contract';

export function BrowseScreen({ui}:ScreenProps){
 const {rooms=[],matches=[],netUrl='',setNetUrl,roomName='',setRoomName,netError,quickJoin,createRoom,joinRoom,refreshNet,changeMode,headActions,teamName,renderScoreboard,config}=ui;
 const [tab,setTab]=useState('create');
 const live=rooms.filter((r:any)=>r.started||r.players>0).length;
 return <Shell head={<TopBar sub="ROOM BROWSER">{headActions}</TopBar>} rail={<ActionRail>
   <Btn onClick={()=>changeMode('selection')}>BACK</Btn>
   <Btn variant="primary" onClick={refreshNet}>REFRESH</Btn>
  </ActionRail>}>
  <PageHead eyebrow="CONCURRENT ROOMS" title={<>Pick a fight<span>.</span></>} lede="Join any open room, watch one in progress, or create your own code."/>
  <div className="stack">
   <div className="toolbar">
    <span className="toolbar-title">SERVER</span>
    <input className="ui-input" value={netUrl} onChange={e=>setNetUrl(e.target.value)} placeholder="ws://host:port" aria-label="Game server address" spellCheck={false}/>
    <Btn variant="primary" onClick={quickJoin}>QUICK JOIN</Btn>
   </div>
   {netError&&<Banner tone="error">{netError}</Banner>}
   {(config?.mode==='puma-race'||config?.mode==='puma-soccer')&&<p className="field-note">PUMA {config.mode==='puma-race'?'RACE':'SOCCER'} / Equal chassis for every driver. Operator is your identity only. Harnesses, weapons and combat gear are inactive.</p>}
   <div className="layout layout--trail">
    <Panel label="LIVE ROOMS" meta={`${live} LIVE`}>
     <div className="stack stack--tight">
      {rooms.map((room:any)=>{
       const carded=room.started&&room.players>0;
       return <div key={room.roomId} className="stack stack--tight">
        <SelectCard name={room.name||room.roomId} tag={room.started?`IN MATCH · ${room.mapId??'arena'}`:room.players>0?'LOBBY OPEN':'EMPTY'} meta={`${room.players}P`} onClick={carded?undefined:()=>joinRoom(room.roomId,false)}/>
        <div className="row">
         <Btn size="sm" onClick={()=>joinRoom(room.roomId,false)} disabled={carded}>{room.started?'SPECTATE':'JOIN'}</Btn>
         <Btn size="sm" onClick={()=>joinRoom(room.roomId,true)}>WATCH</Btn>
        </div>
       </div>;
      })}
      {rooms.length===0&&<Empty title="No rooms yet">Create one below — the first player to join becomes host.</Empty>}
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
 return <Shell head={<TopBar sub={netRoomId?`ROOM ${netRoomId}`:'NETWORK LOBBY'}>{ui.headActions}</TopBar>} rail={<ActionRail>
   {net.isHost?<Btn variant="primary" onClick={hostAndStart} disabled={!connected}>START NETWORK MATCH</Btn>:<Chip tone={connected?'default':'danger'}>{connected?(net.spectate?'SPECTATING':'WAITING ON HOST'):'DISCONNECTED'}</Chip>}
   <Btn variant="danger" onClick={disconnectNet}>DISCONNECT</Btn>
  </ActionRail>}>
  <PageHead eyebrow="PLAYERS ONLINE" title={<>Gather at the server<span>.</span></>} lede="First to join hosts the match. Escape during play returns here."/>
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
