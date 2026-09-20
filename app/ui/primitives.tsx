'use client';
import {useCallback,useEffect,useRef} from 'react';
import type {ReactNode,ButtonHTMLAttributes,KeyboardEvent as ReactKeyboardEvent} from 'react';
import {Crosshair,X} from 'lucide-react';
import {formatNumber} from '../../game/format-ui.mjs';

export function TopBar({sub,children}:{sub:ReactNode;children?:ReactNode}){
 return <header className="shell-head">
  <div className="brand"><span className="brand-mark"><Crosshair size={24}/></span>
   <span className="brand-name">COCS<em>Colosseum Of Competitive Slop</em></span>
   <span className="brand-sub">{sub}</span></div>
  <div className="head-actions">{children}</div>
 </header>;
}

export function Shell({head,rail,children,bleed=false,className=''}:{head?:ReactNode;rail?:ReactNode;children:ReactNode;bleed?:boolean;className?:string}){
 return <div className={`shell${bleed?' shell--bleed':''}${className?' '+className:''}`}>{head}<main className="shell-body">{children}</main>{rail}</div>;
}

export function PageHead({eyebrow,title,lede,actions}:{eyebrow?:ReactNode;title:ReactNode;lede?:ReactNode;actions?:ReactNode}){
 return <div className="section-head"><div>{eyebrow&&<p className="eyebrow"><i/>{eyebrow}</p>}<h1 className="h-page">{title}</h1>{lede&&<p className="lede">{lede}</p>}</div>{actions&&<div className="row">{actions}</div>}</div>;
}

export function Panel({title,label,meta,actions,children,bodyClass='',accent=false,flush=false,className=''}:{title?:ReactNode;label?:ReactNode;meta?:ReactNode;actions?:ReactNode;children:ReactNode;bodyClass?:string;accent?:boolean;flush?:boolean;className?:string}){
 return <section className={`panel${accent?' panel--accent':''}${className?' '+className:''}`}>
  {(title||label||actions)&&<header className="panel-head">{label&&<span className="label">{label}</span>}{title&&<h2 className="panel-title">{title}</h2>}{meta&&<span className="label">{meta}</span>}{actions}</header>}
  <div className={`panel-body${flush?' panel--flush':''}${bodyClass?' '+bodyClass:''}`}>{children}</div>
 </section>;
}

type BtnProps=ButtonHTMLAttributes<HTMLButtonElement>&{variant?:'primary'|'secondary'|'ghost'|'danger';size?:'sm'|'md'|'lg'};
export function Btn({variant='secondary',size='md',className='',children,...rest}:BtnProps){
 return <button type="button" className={`btn btn-${variant}${size==='sm'?' btn-sm':''}${size==='lg'?' btn--primary-lg':''}${className?' '+className:''}`} {...rest}>{children}</button>;
}

function tabKeyNav(event:ReactKeyboardEvent<HTMLDivElement>,values:string[],current:string,onChange:(v:string)=>void){
 const index=values.indexOf(current),last=values.length-1;
 if(index<0||last<0)return;
 let next=-1;
 if(event.key==='ArrowRight'||event.key==='ArrowDown')next=index>=last?0:index+1;
 else if(event.key==='ArrowLeft'||event.key==='ArrowUp')next=index<=0?last:index-1;
 else if(event.key==='Home')next=0;
 else if(event.key==='End')next=last;
 if(next<0)return;
 event.preventDefault();
 const target=values[next];
 onChange(target);
 const buttons=event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]');
 buttons[next]?.focus();
}

export function Segmented({value,onChange,options,ariaLabel}:{value:string;onChange:(v:string)=>void;options:{value:string;label:ReactNode}[];ariaLabel?:string}){
 const values=options.map(o=>o.value);
 return <div className="segmented" role="tablist" aria-label={ariaLabel} onKeyDown={e=>tabKeyNav(e,values,value,onChange)}>{options.map(o=><button key={o.value} type="button" role="tab" tabIndex={value===o.value?0:-1} aria-selected={value===o.value} className={value===o.value?'active':''} onClick={()=>onChange(o.value)}>{o.label}</button>)}</div>;
}

export function Tabs({value,onChange,tabs,ariaLabel}:{value:string;onChange:(v:string)=>void;tabs:{value:string;label:ReactNode}[];ariaLabel?:string}){
 const values=tabs.map(t=>t.value);
 return <div className="tabs" role="tablist" aria-label={ariaLabel} onKeyDown={e=>tabKeyNav(e,values,value,onChange)}>{tabs.map(t=><button key={t.value} type="button" role="tab" tabIndex={value===t.value?0:-1} aria-selected={value===t.value} className={value===t.value?'active':''} onClick={()=>onChange(t.value)}>{t.label}</button>)}</div>;
}

export function Stats({items,className=''}:{items:{label:ReactNode;value:ReactNode;hint?:ReactNode}[];className?:string}){
  return <dl className={`stats${className?' '+className:''}`}>{items.map((s,i)=><div className="stat" key={i}><dt>{s.label}</dt><dd>{typeof s.value==='number'?formatNumber(s.value):s.value}{s.hint&&<small> {s.hint}</small>}</dd></div>)}</dl>;
}

export function Field({label,value,children,note}:{label:ReactNode;value?:ReactNode;children:ReactNode;note?:ReactNode}){
 return <div className="field"><span className="field-label"><span>{label}</span>{value!==undefined&&<output>{value}</output>}</span>{children}{note&&<p className="field-note">{note}</p>}</div>;
}

export function Chip({tone='default',children}:{tone?:'default'|'accent'|'warn'|'danger';children:ReactNode}){
 return <span className={`chip${tone!=='default'?' chip--'+tone:''}`}>{children}</span>;
}

export function Meter({ratio}:{ratio:number}){
 return <span className="meter"><i style={{width:`${Math.max(0,Math.min(1,ratio))*100}%`}}/></span>;
}

export function Empty({title,children,action}:{title?:ReactNode;children?:ReactNode;action?:ReactNode}){
 return <div className="empty">{title&&<strong>{title}</strong>}{children}{action}</div>;
}

export function Banner({tone='default',children}:{tone?:'default'|'error'|'warn';children:ReactNode}){
 return <div className={`banner${tone!=='default'?' banner--'+tone:''}`} role={tone==='error'?'alert':'status'}>{children}</div>;
}

// WP2.1 — one dialog layer at a time. `covered` marks a lower dialog that a
// child dialog is stacked over: it stays rendered underneath (so the child can
// be dismissed back into it) but leaves the accessibility tree, cannot receive
// pointer or keyboard focus, and never claims `aria-modal`.
const MODAL_FOCUS_SELECTOR='button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href],summary,[tabindex]:not([tabindex="-1"])';

/** The element a dialog should return focus to. The page body itself is not an
 *  opener: a dialog opened over nothing must not focus the document on close. */
export function rememberModalOpener(active:HTMLElement|null|undefined){
 if(!active||typeof active.focus!=='function')return null;
 const doc=active.ownerDocument;
 if(doc&&(active===doc.body||active===doc.documentElement))return null;
 return active;
}

/** Restore focus to a remembered opener. Detached openers are ignored. */
export function restoreModalFocus(opener:HTMLElement|null|undefined){
 if(!rememberModalOpener(opener))return false;
 if(opener!.isConnected===false)return false;
 opener!.focus({preventScroll:true});
 return true;
}

/** First visible, enabled control in a dialog panel (or null). */
export function firstFocusableIn(host:HTMLElement|null|undefined){
 if(!host||typeof host.querySelectorAll!=='function')return null;
 const list=[...host.querySelectorAll<HTMLElement>(MODAL_FOCUS_SELECTOR)];
 return list.find(element=>element&&(typeof element.getClientRects!=='function'||element.getClientRects().length>0))??null;
}

export function Modal({open,onClose,size='md',title,eyebrow,description,children,footer,closeLabel='Close',panelRef,keepMounted=false,bodyClass='',covered=false,restoreFocus=null}:{open:boolean;onClose:()=>void;size?:'sm'|'md'|'lg'|'xl';title:ReactNode;eyebrow?:ReactNode;description?:ReactNode;children:ReactNode;footer?:ReactNode;closeLabel?:string;panelRef?:React.Ref<HTMLElement>;keepMounted?:boolean;bodyClass?:string;covered?:boolean;restoreFocus?:HTMLElement|null}){
 const panelElement=useRef<HTMLElement|null>(null);
 const opener=useRef<HTMLElement|null>(null);
 const wasOpen=useRef(false);
 const coveredRef=useRef(covered);
 // The caller's panel ref (used by the page's Tab trap) wins when supplied; a
 // local ref covers the primitives rendered without one.
 const panelHost=useCallback(()=>panelElement.current??(panelRef&&typeof panelRef==='object'?panelRef.current:null),[panelRef]);
 // Capture the exact opener synchronously at the open transition. A caller may
 // pass it explicitly (required when the opener sits in a dialog that becomes
 // inert in the same commit, because inert drops focus to the document body).
 useEffect(()=>{
  if(open&&!wasOpen.current)opener.current=rememberModalOpener(restoreFocus)??rememberModalOpener(typeof document==='undefined'?null:(document.activeElement as HTMLElement|null));
  wasOpen.current=open;
 },[open,restoreFocus]);
 // Move focus into the top dialog on its open transition only. A modal that is
 // (or becomes) covered never grabs focus, and a modal becoming uncovered again
 // must not steal focus from the layer that just restored its opener.
 useEffect(()=>{coveredRef.current=covered;},[covered]);
 useEffect(()=>{
  if(!open)return;
  const frame=typeof requestAnimationFrame==='function'?requestAnimationFrame(()=>{
   if(coveredRef.current)return;
   const host=panelHost();
   if(!host)return;
   const active=host.ownerDocument?.activeElement;
   if(active&&host.contains(active))return;
   const target=firstFocusableIn(host)??host;
   target?.focus?.({preventScroll:true});
  }):0;
  return ()=>{if(frame)cancelAnimationFrame(frame);};
 },[open,panelHost]);
 // Give focus back to the exact opener on close/unmount. This is a separate
 // effect on `open` alone so covering a dialog never bounces focus.
 useEffect(()=>{
  if(!open)return;
  return ()=>{
   const target=opener.current;
   opener.current=null;
   restoreModalFocus(target);
  };
 },[open]);
 if(!open&&!keepMounted)return null;
 const titleId=`modal-${String(title).replace(/\W+/g,'-').toLowerCase()}`;
 const hidden=!open,coveredLayer=open&&covered;
 return <div className={`modal${hidden?' modal--hidden':''}${coveredLayer?' modal--covered':''}`} aria-hidden={hidden||coveredLayer} inert={coveredLayer||undefined} onMouseDown={e=>{if(open&&!coveredLayer&&e.target===e.currentTarget)onClose();}}>
  <section ref={panelRef??panelElement} tabIndex={-1} className={`modal-panel modal-panel--${size}`} role="dialog" aria-modal={open&&!coveredLayer?true:undefined} aria-labelledby={titleId}>
   <header className="modal-head">
    <div>{eyebrow&&<p className="eyebrow"><i/>{eyebrow}</p>}<h2 className="modal-title" id={titleId}>{title}</h2>{description&&<p className="modal-desc">{description}</p>}</div>
    <button type="button" className="btn btn-ghost btn-icon modal-close" aria-label={closeLabel} onClick={onClose}><X size={18}/></button>
   </header>
   <div className={`modal-body${bodyClass?' '+bodyClass:''}`}>{children}</div>
   {footer&&<footer className="modal-foot">{footer}</footer>}
  </section>
 </div>;
}

export function ActionRail({summary,children}:{summary?:ReactNode;children:ReactNode}){
 return <footer className="shell-rail">{summary&&<div className="rail-summary">{summary}</div>}<div className="rail-actions">{children}</div></footer>;
}

export function SelectCard({selected,onClick,disabled,icon,name,tag,meta,stats,ariaLabel,className=''}:{selected?:boolean;onClick?:()=>void;disabled?:boolean;icon?:ReactNode;name:ReactNode;tag?:ReactNode;meta?:ReactNode;stats?:ReactNode;ariaLabel?:string;className?:string}){
 return <button type="button" className={`card${selected?' selected':''}${className?' '+className:''}`} aria-pressed={selected} aria-label={ariaLabel} disabled={disabled} onClick={onClick}>
  {icon&&<span className="card-icon">{icon}</span>}
  <span className="card-main"><span className="card-name">{name}{tag&&<small>{tag}</small>}</span>{stats&&<span className="card-stats">{stats}</span>}</span>
  {meta!==undefined&&meta!==null&&<span className="card-stat">{meta}</span>}
 </button>;
}
