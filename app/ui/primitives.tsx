'use client';
import type {ReactNode,ButtonHTMLAttributes,KeyboardEvent as ReactKeyboardEvent} from 'react';
import {Crosshair,X} from 'lucide-react';

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
 return <dl className={`stats${className?' '+className:''}`}>{items.map((s,i)=><div className="stat" key={i}><dt>{s.label}</dt><dd>{s.value}{s.hint&&<small> {s.hint}</small>}</dd></div>)}</dl>;
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

export function Modal({open,onClose,size='md',title,eyebrow,description,children,footer,closeLabel='Close',panelRef,keepMounted=false,bodyClass=''}:{open:boolean;onClose:()=>void;size?:'sm'|'md'|'lg'|'xl';title:ReactNode;eyebrow?:ReactNode;description?:ReactNode;children:ReactNode;footer?:ReactNode;closeLabel?:string;panelRef?:React.Ref<HTMLElement>;keepMounted?:boolean;bodyClass?:string}){
 if(!open&&!keepMounted)return null;
 const titleId=`modal-${String(title).replace(/\W+/g,'-').toLowerCase()}`;
 return <div className={`modal${open?'':' modal--hidden'}`} aria-hidden={!open} onMouseDown={e=>{if(open&&e.target===e.currentTarget)onClose();}}>
  <section ref={panelRef} className={`modal-panel modal-panel--${size}`} role="dialog" aria-modal={open} aria-labelledby={titleId}>
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
