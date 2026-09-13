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
export function applyActorTeam(model,team,palette='default'){const p=teamPresentation(team,palette),data=model.userData;if(data.team===p?.id&&data.teamApplied&&data.teamPalette===palette)return;data.teamApplied=true;data.team=p?.id;data.teamPalette=palette;data.teamLabel=p?.label??null;data.armor.color.set(p?.color??data.armorColor);data.base.material.color.set(p?.color??data.color);for(const mark of data.teamMarks)updateTeamMark(mark,team);}
