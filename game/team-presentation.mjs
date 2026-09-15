import * as T from 'three';

export const NEUTRAL='#55ddcc';
export const TEAM_PALETTE=Object.freeze([
 Object.freeze({id:0,key:'red',label:'RED / I',color:'#ed514b',bars:1}),
 Object.freeze({id:1,key:'blue',label:'BLUE / II',color:'#438eff',bars:2}),
]);
// Okabe-Ito blue/orange: distinguishable under every common colour-vision deficiency.
export const TEAM_PALETTE_COLORBLIND=Object.freeze([
 Object.freeze({id:0,key:'red',label:'ORANGE / I',color:'#ff9d2e',bars:1}),
 Object.freeze({id:1,key:'blue',label:'BLUE / II',color:'#2f9bff',bars:2}),
]);
export function teamPalette(mode){return mode==='colorblind'?TEAM_PALETTE_COLORBLIND:TEAM_PALETTE;}
export function teamPresentation(team,palette='default'){const set=teamPalette(palette);return team===0||team==='0'||team==='red'?set[0]:team===1||team==='1'||team==='blue'?set[1]:null;}

// Raised ivory bars stay legible without hue or canvas text, on both renderers.
export function teamMark(){const g=new T.Group(),mat=new T.MeshBasicMaterial({color:'#fff4dc'}),geo=new T.BoxGeometry(.045,.18,.012);for(const x of [-.05,.05]){const bar=new T.Mesh(geo,mat);bar.position.x=x;g.add(bar);}return g;}
export function updateTeamMark(mark,team){const p=teamPresentation(team);mark.visible=!!p;mark.userData.teamLabel=p?.label??null;mark.children[0].position.x=p?.bars===1?0:-.05;mark.children[1].visible=p?.bars===2;}

// ---------------------------------------------------------------------------
// Team outlines. A cheap back-face shell scaled slightly larger than the body
// gives every team member a coloured rim that reads at distance and in the
// software renderer (no post-process). The shell is built lazily from the
// model's base mesh so view.mjs needs no changes; it is disposed with the model
// because it is parented to it.
// ---------------------------------------------------------------------------
export function ensureTeamOutline(model){
 const data=model?.userData;
 if(!data||data.teamOutline)return data?.teamOutline??null;
 const source=data.base;
 if(!source?.geometry)return null;
 const mat=new T.MeshBasicMaterial({color:data.armorColor??'#ffffff',side:T.BackSide,transparent:true,opacity:.55,depthWrite:false});
 const outline=new T.Mesh(source.geometry,mat);
 outline.scale.setScalar(1.06);
 outline.renderOrder=-1;
 outline.userData.teamOutlineShell=true;
 model.add(outline);
 data.teamOutline=outline;
 return outline;
}

// Outline opacity by distance: teammates stay faintly rimmed far away while
// enemies fade out so the screen does not fill with coloured shells.
export function outlineOpacity(distance,{team=false,range=60}={}){
 const d=Number.isFinite(distance)?Math.max(0,distance):0;
 const span=Number.isFinite(range)&&range>0?range:60;
 const t=Math.max(0,Math.min(1,1-d/span));
 return (team?.5:.35)*t;
}

export function applyActorTeam(model,team,palette='default'){
 const p=teamPresentation(team,palette),data=model.userData;
 if(data.team===p?.id&&data.teamApplied&&data.teamPalette===palette)return;
 data.teamApplied=true;data.team=p?.id;data.teamPalette=palette;data.teamLabel=p?.label??null;
 data.armor.color.set(p?.color??data.armorColor);
 data.base.material.color.set(p?.color??data.color);
 const outline=ensureTeamOutline(model);
 if(outline){outline.material.color.set(p?.color??data.armorColor);outline.visible=!!p;}
 for(const mark of data.teamMarks)updateTeamMark(mark,team);
}

// ---------------------------------------------------------------------------
// Announcer callouts for objectives and streaks. Pure text/priority selection
// so the audio layer can decide what to speak; deterministic and allocation
// light. `priority` orders simultaneous cues (higher wins).
// ---------------------------------------------------------------------------
export const TEAM_CALLOUTS=Object.freeze({
 capture:Object.freeze({id:'capture',text:'FLAG CAPTURED',priority:3}),
 'flag-pickup':Object.freeze({id:'flag-pickup',text:'FLAG TAKEN',priority:2}),
 'flag-return':Object.freeze({id:'flag-return',text:'FLAG RETURNED',priority:2}),
 'flag-drop':Object.freeze({id:'flag-drop',text:'FLAG DROPPED',priority:1}),
 'zone-capture':Object.freeze({id:'zone-capture',text:'ZONE CAPTURED',priority:3}),
 'zone-neutralized':Object.freeze({id:'zone-neutralized',text:'ZONE NEUTRALIZED',priority:2}),
 'assault-breach':Object.freeze({id:'assault-breach',text:'SECTOR BREACHED',priority:3}),
 'payload-checkpoint':Object.freeze({id:'payload-checkpoint',text:'CHECKPOINT REACHED',priority:2}),
 'payload-delivered':Object.freeze({id:'payload-delivered',text:'PAYLOAD DELIVERED',priority:4}),
 'soccer-goal':Object.freeze({id:'soccer-goal',text:'GOAL',priority:4}),
 killstreak:Object.freeze({id:'killstreak',text:'KILLSTREAK',priority:2}),
 victory:Object.freeze({id:'victory',text:'VICTORY',priority:5}),
 defeat:Object.freeze({id:'defeat',text:'DEFEAT',priority:5}),
});

// Map a match event to an announcer callout (or null). Streaks include the
// count and milestone reward so the caller can say "5 KILLSTREAK — OVERCHARGE".
export function teamCallout(event){
 if(!event||typeof event.type!=='string')return null;
 const base=TEAM_CALLOUTS[event.type];
 if(!base)return null;
 if(event.type==='killstreak'){
  const streak=Math.max(0,Math.floor(Number(event.streak)||0));
  if(streak<2)return null;
  return {id:base.id,text:`${streak} ${base.text}`,detail:event.reward?String(event.reward).toUpperCase():null,priority:base.priority,streak};
 }
 return {id:base.id,text:base.text,detail:event.team!==null&&event.team!==undefined?teamPresentation(event.team)?.label??null:null,priority:base.priority,actor:event.actor??null,team:event.team??null};
}

// Pick the highest-priority callout from a batch, breaking ties by order. The
// audio layer can then spend a single voice slot per frame.
export function selectCallout(events){
 let best=null;
 for(const event of Array.isArray(events)?events:[]){
  const callout=teamCallout(event);
  if(!callout)continue;
  if(!best||callout.priority>best.priority)best=callout;
 }
 return best;
}
