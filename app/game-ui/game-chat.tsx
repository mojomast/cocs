'use client';
import type {ReactNode} from 'react';

// Chat rendering shared by the lobby log and the in-game overlay. The server
// already sends `{type:'chat', peerId, name, text, time}`, so the clock stamp and
// the @mention spans are derived locally; nothing here changes the wire. The
// helpers are exported so the pure parts are unit-testable without a browser.
export type ChatSegment={text:string;mention?:boolean;token?:string};

/** HH:MM in the viewer's local zone, or null when the server sent no stamp. */
export function chatStamp(time:any):string|null{
 const value=Number(time);
 if(!Number.isFinite(value)||value<=0)return null;
 const date=new Date(value);
 if(Number.isNaN(date.getTime()))return null;
 const hours=String(date.getHours()).padStart(2,'0');
 const minutes=String(date.getMinutes()).padStart(2,'0');
 return `${hours}:${minutes}`;
}

const MENTION_PATTERN=/(^|\s)@([A-Za-z0-9_][A-Za-z0-9_.-]*)/g;

/** Split message text on @tokens, preserving the text verbatim between spans. */
export function mentionSegments(text:any):ChatSegment[]{
 const source=String(text??'');
 const segments:ChatSegment[]=[];
 let last=0;
 MENTION_PATTERN.lastIndex=0;
 for(let match=MENTION_PATTERN.exec(source);match;match=MENTION_PATTERN.exec(source)){
  const start=match.index+match[1].length;
  if(start>last)segments.push({text:source.slice(last,start)});
  segments.push({text:`@${match[2]}`,mention:true,token:match[2]});
  last=start+match[2].length+1;
 }
 if(last<source.length)segments.push({text:source.slice(last)});
 return segments;
}

/** True when a mentioned token names this client, whole name or one of its words. */
export function isSelfMention(token:any,selfName:any):boolean{
 const target=String(selfName??'').trim().toLowerCase();
 if(!target)return false;
 const name=String(token??'').toLowerCase();
 return target===name||target.split(/\s+/).includes(name);
}

/** Worded unread counter for the lobby's jump-to-latest affordance. */
export function chatUnreadLabel(count:any):string{
 const n=Math.max(0,Math.floor(Number(count)||0));
 return `${n} NEW MESSAGE${n===1?'':'S'} · JUMP TO LATEST`;
}

/** One chat line. Mentions are bold + underlined (never colour alone) and a
 *  mention of this client also carries the words "(you)" for assistive tech. */
export function ChatLine({message,selfName}:{message:any;selfName?:string|null}){
 const stamp=chatStamp(message?.time);
 const parts:ReactNode[]=mentionSegments(message?.text).map((segment,index)=>{
  if(!segment.mention)return <span key={index}>{segment.text}</span>;
  const self=isSelfMention(segment.token,selfName);
  return <mark key={index} className={`chat-mention${self?' chat-mention--self':''}`}>@{segment.token}{self&&<span className="visually-hidden"> (you)</span>}</mark>;
 });
 return <div className="chat-line">
  <span className="chat-line-head">
   {stamp&&<time className="chat-time" dateTime={new Date(Number(message.time)).toISOString()}>{stamp}</time>}
   <b className="chat-name">{String(message?.name??'')}</b>
  </span>
  <span className="chat-text">{parts}</span>
 </div>;
}

export function GameChat({hud,chatOpen,chatLog,chatInputRef,chatDraft,sendChat,setChatOpen,setChatDraft,selfName}:{hud:any;chatOpen:boolean;chatLog:any[];chatInputRef:any;chatDraft:string;sendChat:()=>void;setChatOpen:(open:boolean)=>void;setChatDraft:(draft:string)=>void;selfName?:string|null}){
 if(!hud?.net)return null;
 return <div className={`game-chat ${chatOpen?'open':''}`}>
  {chatOpen?<>
   <div className="chat-lines">{chatLog.slice(-10).map((m:any,i:number)=><ChatLine key={i} message={m} selfName={selfName}/>)}</div>
   <input ref={chatInputRef} className="chat-input" autoFocus value={chatDraft} onChange={e=>setChatDraft(e.target.value)} onKeyDown={e=>{e.stopPropagation();if(e.key==='Enter')sendChat();else if(e.key==='Escape')setChatOpen(false);}} placeholder="MESSAGE · ENTER SENDS · ESC CLOSES" aria-label="Chat message" spellCheck={false}/>
  </>:<>
   <div className="chat-lines">{chatLog.slice(-4).map((m:any,i:number)=><ChatLine key={i} message={m} selfName={selfName}/>)}</div>
   <div className="chat-hint">T / ENTER · CHAT</div>
  </>}
 </div>;
}
