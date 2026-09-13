'use client';

export function GameChat({hud,chatOpen,chatLog,chatInputRef,chatDraft,sendChat,setChatOpen,setChatDraft}:{hud:any;chatOpen:boolean;chatLog:any[];chatInputRef:any;chatDraft:string;sendChat:()=>void;setChatOpen:(open:boolean)=>void;setChatDraft:(draft:string)=>void}){
 if(!hud?.net)return null;
 return <div className={`game-chat ${chatOpen?'open':''}`}>{chatOpen?<><div className="chat-lines">{chatLog.slice(-10).map((m:any,i:number)=><div key={i}><b>{m.name}</b>{m.text}</div>)}</div><input ref={chatInputRef} className="chat-input" autoFocus value={chatDraft} onChange={e=>setChatDraft(e.target.value)} onKeyDown={e=>{e.stopPropagation();if(e.key==='Enter')sendChat();else if(e.key==='Escape')setChatOpen(false);}} placeholder="MESSAGE · ENTER SENDS · ESC CLOSES" aria-label="Chat message" spellCheck={false}/></>:<><div className="chat-lines">{chatLog.slice(-4).map((m:any,i:number)=><div key={i}><b>{m.name}</b>{m.text}</div>)}</div><div className="chat-hint">T / ENTER · CHAT</div></>}</div>;
}
