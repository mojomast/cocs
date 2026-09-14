'use client';
import type {ReactNode,ButtonHTMLAttributes} from 'react';
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

export function Segmented({value,onChange,options,ariaLabel}:{value:string;onChange:(v:string)=>void;options:{value:string;label:ReactNode}[];ariaLabel?:string}){
 return <div className="segmented" role="tablist" aria-label={ariaLabel}>{options.map(o=><button key={o.value} type="button" role="tab" aria-selected={value===o.value} className={value===o.value?'active':''} onClick={()=>onChange(o.value)}>{o.label}</button>)}</div>;
}

export function Tabs({value,onChange,tabs,ariaLabel}:{value:string;onChange:(v:string)=>void;tabs:{value:string;label:ReactNode}[];ariaLabel?:string}){
 return <div className="tabs" role="tablist" aria-label={ariaLabel}>{tabs.map(t=><button key={t.value} type="button" role="tab" aria-selected={value===t.value} className={value===t.value?'active':''} onClick={()=>onChange(t.value)}>{t.label}</button>)}</div>;
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

export function Modal({open,onClose,size='md',title,eyebrow,description,children,footer,closeLabel='Close'}:{open:boolean;onClose:()=>void;size?:'sm'|'md'|'lg'|'xl';title:ReactNode;eyebrow?:ReactNode;description?:ReactNode;children:ReactNode;footer?:ReactNode;closeLabel?:string}){
 if(!open)return null;
 const titleId=`modal-${String(title).replace(/\W+/g,'-').toLowerCase()}`;
 return <div className="modal" onMouseDown={e=>{if(e.target===e.currentTarget)onClose();}}>
  <section className={`modal-panel modal-panel--${size}`} role="dialog" aria-modal="true" aria-labelledby={titleId}>
   <header className="modal-head">
    <div>{eyebrow&&<p className="eyebrow"><i/>{eyebrow}</p>}<h2 className="modal-title" id={titleId}>{title}</h2>{description&&<p className="modal-desc">{description}</p>}</div>
    <button type="button" className="btn btn-ghost btn-icon modal-close" aria-label={closeLabel} onClick={onClose}><X size={18}/></button>
   </header>
   <div className="modal-body">{children}</div>
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
