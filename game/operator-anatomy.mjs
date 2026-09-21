// Authored robot anatomy. Every returned geometry is a single-material batch
// confined to one existing articulation. No assets, global caches or animators.
import * as T from 'three';
import {armorPanel,contourGeometry,joinedGeometry,placedGeometry} from './model-geometry.mjs';

export const OPERATOR_ANATOMY=Object.freeze({
 chatgpt:{design:'split-cage survey instrument',chest:'cage',limb:'suspension',width:.258,waist:.112,depth:.161,power:.78,shoulder:.164},
 claude:{design:'ceramic warding chassis',chest:'shield',limb:'ceramic',width:.267,waist:.170,depth:.164,power:.56,shoulder:.181},
 grok:{design:'asymmetric industrial outrider',chest:'offset',limb:'suspension',width:.232,waist:.088,depth:.157,power:.62,shoulder:.153},
 meta:{design:'twin-turbine heavy chassis',chest:'twin',limb:'industrial',width:.278,waist:.190,depth:.168,power:.48,shoulder:.183},
 gemini:{design:'bifurcated ceramic anatomy',chest:'petals',limb:'ceramic',width:.237,waist:.090,depth:.154,power:.90,shoulder:.162},
 deepseek:{design:'pressure-vessel salvage frame',chest:'diver',limb:'industrial',width:.250,waist:.172,depth:.175,power:.89,shoulder:.173},
 mistral:{design:'swept aerofoil interceptor',chest:'keel',limb:'swept',width:.253,waist:.082,depth:.150,power:.68,shoulder:.163},
 kimi:{design:'orbital gimbal reactor',chest:'orbital',limb:'ceramic',width:.260,waist:.106,depth:.165,power:1,shoulder:.173},
 qwen:{design:'lamellar mechanical sentinel',chest:'lamellar',limb:'lamellar',width:.265,waist:.164,depth:.160,power:.58,shoulder:.178},
});

const shield=[[-.62,-1],[.62,-1],[1,-.26],[.88,.74],[.40,1],[-.40,1],[-.88,.74],[-1,-.26]];
const petal=[[-.35,-1],[.58,-.70],[1,.26],[.45,1],[-.40,.86],[-1,.05]];
const chevron=[[-1,-.50],[0,-1],[1,-.50],[.91,.73],[0,1],[-.91,.73]];
const slab=[[-.90,-1],[.90,-1],[1,-.72],[1,.72],[.90,1],[-.90,1],[-1,.72],[-1,-.72]];
const swept=[[-1,-.86],[.03,-1],[1,.79],[.68,1],[-.72,.42]];
// Cross-section widths are authored independently, not scaled copies of the
// same barrel. Rows correspond to the established nine-ring chest envelope.
const chestWidths={
 chatgpt:[0,.32,.46,.72,1,.98,.91,.39,0],
 claude:[0,.54,.68,.91,.97,1,1,.57,0],
 grok:[0,.28,.37,.78,1,.91,.64,.40,0],
 meta:[0,.62,.87,.98,1,1,.97,.67,0],
 gemini:[0,.30,.42,1,.97,.82,.71,.38,0],
 deepseek:[0,.39,.70,.98,1,.94,.76,.44,0],
 mistral:[0,.22,.33,.55,.87,.97,1,.44,0],
 kimi:[0,.27,.43,.83,1,.94,.69,.31,0],
 qwen:[0,.43,.72,.72,1,.88,.88,.48,0],
};
const waistWidths={
 chatgpt:[0,.91,1,.77,.66,.71,1.21,1.75,1.37,0],
 claude:[0,1.16,1.19,1.10,.93,.88,1.07,1.19,.91,0],
 grok:[0,.86,1.01,.75,.68,.82,1.30,1.99,1.42,0],
 meta:[0,.82,1.02,1.08,1.09,1.10,1.14,1.13,.94,0],
 gemini:[0,.80,1,.75,.61,.76,1.56,2.08,1.44,0],
 deepseek:[0,.68,.88,1.07,1.12,1.10,1.07,.96,.78,0],
 mistral:[0,.97,1.11,.73,.60,.76,1.40,2.04,1.66,0],
 kimi:[0,.49,.77,.96,1.08,1.24,1.70,1.89,1.31,0],
 qwen:[0,1.12,1.13,.87,.88,.73,1.07,1.26,.98,0],
};
const plate=(w,h,d,outline=shield,low=false)=>armorPanel(outline.map(([x,y])=>[x*w*.5,y*h*.5]),d,{bevel:.11,steps:low?0:1});
const tube=(r,h,low)=>new T.CylinderGeometry(r,r,h,low?8:12,1,true);
const ring=(r,t,low)=>new T.TorusGeometry(r,t,low?4:6,low?12:24);
function shell(sections,f,low,segments=40){return contourGeometry(sections,{segments:low?12:segments,power:f.power});}

export function operatorPartGeometry(id,part,{low=false,side=1}={}){
 const f=OPERATOR_ANATOMY[id],parts=[];
 const add=(g,p,rot)=>parts.push(placedGeometry(g,p,rot));
 const panel=(w,h,d,p,rot,outline=shield)=>add(plate(w,h,d,outline,low),p,rot);
 const hoop=(r,t,p)=>add(ring(r,t,low),p);
 const pin=(r,h,p,rot)=>add(tube(r,h,low),p,rot);
 if(part==='chest')return shell([
  [-.23,0,0],[-.211,f.waist*.82,.100],[-.18,f.waist,.115],[-.075,f.width*.91,f.depth*.97],
  [.045,f.width,f.depth],[.105,f.width*.97,f.depth*.96],[.159,f.width*.83,.130],[.205,f.waist*.83,.105],[.23,0,0],
 ].map((row,i)=>[row[0],f.width*chestWidths[id][i],row[2],0,id==='grok'?(i-4)*.003:0]),f,low);
 if(part==='abdomen')return shell([
  [-.26,0,0],[-.232,f.waist*.93,.10],[-.195,f.waist,.113],[-.135,f.waist*1.10,.123],
  [-.07,f.waist*1.17,.130],[-.025,f.waist*1.12,.122],[.045,f.width*.78,.141],
  [.14,f.width*.83,.145],[.205,f.width*.69,.119],[.26,0,0],
 ].map((row,i)=>[row[0],f.waist*waistWidths[id][i],row[2]*(id==='mistral'?.77:id==='grok'?.83:1),0,id==='grok'?(i-4)*.002:0]),f,low,24);
 if(part==='sternum'){
  // Front is -Z. Apertures and deep seams expose the darker chassis behind.
  switch(f.chest){
   case 'cage':
    hoop(.092,.019,[0,.015,-.016]);
    for(const s of [-1,1]){panel(.114,.26,.048,[s*.136,.006,.008],[0,s*.14,s*-.18]);for(let i=0;i<(low?1:3);i++)panel(.082,.025,.027,[s*.105,-.078+i*.072,-.024],[0,0,s*.28]);}break;
   case 'shield':
    panel(.34,.31,.065,[0,.008,0],undefined,chevron);panel(.058,.235,.035,[0,.025,-.050]);
    for(const s of [-1,1])panel(.075,.175,.038,[s*.185,.055,.01],[0,s*.15,-s*.17]);break;
   case 'offset':
    panel(.17,.30,.06,[-.098,.006,0],[0,0,-.19],petal);panel(.15,.19,.055,[.117,.084,0],[0,0,-.38]);
    pin(.025,.21,[.102,-.052,-.035],[0,0,-.24]);if(!low)for(let i=0;i<3;i++)add(new T.TorusGeometry(.031,.008,4,12),[.086+i*.015,-.114+i*.06,-.035],[Math.PI/2,0,-.24]);break;
   case 'twin':
    for(const s of [-1,1]){hoop(.094,.023,[s*.115,.035,-.018]);panel(.085,.135,.042,[s*.185,-.070,.018]);}
    panel(.068,.26,.07,[0,-.01,-.026]);break;
   case 'petals':
    for(const s of [-1,1]){panel(.18,.31,.055,[s*.10,.02,0],[0,s*.16,-s*.23],petal);hoop(.047,.012,[s*.071,.057,-.038]);}break;
   case 'diver':
    hoop(.122,.027,[0,.035,-.008]);panel(.27,.086,.052,[0,-.11,.01]);
    for(const s of [-1,1])pin(.027,.21,[s*.166,.017,.014]);break;
   case 'keel':
    for(const s of [-1,1])panel(.141,.31,.065,[s*.101,.017,0],[0,s*.27,-s*.32],petal);
    panel(.038,.26,.058,[0,.003,-.047]);break;
   case 'orbital':
    hoop(.111,.021,[0,.012,-.018]);hoop(.073,.010,[0,.012,-.035]);
    for(const s of [-1,1])panel(.104,.215,.044,[s*.16,.013,.018],[0,s*.3,-s*.25],petal);break;
   case 'lamellar':
    for(let i=0;i<3;i++)panel(.34-i*.048,.132,.038,[0,.10-i*.098,-i*.014],[.13,0,0],chevron);break;
  }
 }else if(part==='core'){
  const lens=(x,y,r)=>{const g=new T.SphereGeometry(r,low?8:20,low?4:10);g.scale(1,1,.22);add(g,[x,y,-.230]);};
  switch(f.chest){
   case 'twin':for(const s of [-1,1])lens(s*.115,-.020,.065);break;
   case 'petals':for(const s of [-1,1])lens(s*.071,.002,.031);break;
   case 'shield':panel(.019,.17,.013,[0,-.017,-.284]);break;
   case 'lamellar':for(let i=0;i<3;i++)panel(.055,.012,.012,[0,.05-i*.098,-.232-i*.014]);break;
   case 'keel':panel(.012,.15,.016,[0,-.019,-.277]);break;
   case 'offset':lens(.10,-.070,.034);break;
   default:lens(0,f.chest==='diver'?-.02:-.043,f.chest==='diver'?.084:.053);
  }
 }else if(part==='chassis'){
  // One dark batch includes exposed spinal laminations and chest recesses.
  panel(.30,.30,.020,[0,-.046,-.181]);
  for(const s of [-1,1])for(let i=0;i<(low?2:4);i++)add(new T.BoxGeometry(.069,.012,.020),[s*.112,-.08-i*.026,-.192],[0,0,s*.12]);
 }else if(part==='shoulder'){
  // Real shoulder shells with distinct outer edges and voids. All fit the
  // original pad envelope; secondary wing fixtures keep their own mounts.
  const outward=outline=>side<0?outline.map(([x,y])=>[-x,y]).reverse():outline;
  switch(id){
   case 'chatgpt':
    for(const s of [-1,1])panel(.122,.165,.20,[s*.086,0,0],undefined,chevron);break;
   case 'claude':panel(.255,.178,.25,[side*.035,0,0],undefined,slab);break;
   case 'grok':
    panel(side<0?.17:.29,side<0?.105:.172,.20,[side*.021,side<0?-.018:0,0],undefined,outward(swept));break;
   case 'meta':
    panel(.353,.174,.27,undefined,undefined,slab);break;
   case 'gemini':
    panel(.17,.172,.205,[side*.062,0,-.026],undefined,outward(petal));
    panel(.10,.135,.12,[-side*.065,.013,.016],undefined,chevron);break;
   case 'deepseek':{
    const g=shell([[-.147,0,0],[-.145,.064,.12],[-.117,.082,.15],[-.098,.068,.12],[.098,.068,.12],[.145,.086,.15],[.147,0,0]],{power:1},low,20);
    g.rotateZ(Math.PI/2);parts.push(g);break;
   }
   case 'mistral':panel(.318,.174,.20,undefined,undefined,outward(swept));break;
   case 'kimi':{
    const g=ring(.065,.017,low);g.scale(2.08,1,1.6);parts.push(g);break;
   }
   case 'qwen':
    for(let i=0;i<3;i++)panel(.29-i*.043,.082,.12,[side*i*.018,.05-i*.05,-i*.041],undefined,chevron);break;
  }
 }else if(part==='pelvis'){
  // The lower chassis is no longer the same sideways ball on every operator.
  if(id==='gemini'||id==='chatgpt'){
   for(const s of [-1,1])panel(id==='gemini'?.12:.14,.184,.19,[s*.081,0,0],undefined,id==='gemini'?petal:chevron);
  }else{
   const width={claude:.37,grok:.23,meta:.38,deepseek:.31,mistral:.225,kimi:.265,qwen:.34}[id];
   panel(width,id==='meta'?.20:.22,.23,undefined,undefined,id==='meta'||id==='claude'?slab:id==='mistral'?swept:chevron);
  }
 }else if(part==='harness'){
  // Preserve the wing accent/material/name while opening the old solid badge
  // so it cannot cover the entire operator-specific thorax behind the weapon.
  for(const s of [-1,1]){
   add(new T.BoxGeometry(.055,.24,.04),[s*.185,0,0],[0,0,s*(id==='deepseek'?.23:id==='claude'?-.17:0)]);
   if(id==='meta')add(new T.BoxGeometry(.11,.035,.04),[s*.153,.105,0]);
  }
 }else if(part==='pauldron'){
  panel(.28,.065,.25,undefined,undefined,id==='claude'?chevron:id==='meta'?slab:petal);
 }else if(part==='foot'){
  // Flat load-bearing sole, sloped instep and a separate split toe cap.
  panel(.19,.27,.095,[0,0,0],[Math.PI/2,0,0]);
  for(const s of [-1,1])panel(.085,.135,.059,[s*.049,.029,-.045],[Math.PI/2,0,0]);
 }else if(part==='foreplate'||part==='shinplate'){
  const shin=part==='shinplate',w=shin?.111:.097,h=shin?.203:.195;
  panel(w,h,.042,[0,0,-.007],[0,side*.08,side*(f.limb==='swept'?.16:.025)],f.limb==='ceramic'?petal:chevron);
  if(!low)for(const s of [-1,1])pin(.010,h*.60,[s*w*.36,-.014,.008]);
 }else if(part==='hand'){
  panel(.09,.10,.074);
  for(const x of [-.027,0,.027])panel(.023,.043,.038,[x,-.025,-.047]);
 }else{
  const dims={arm:[.082,.20],forearm:[.068,.19],thigh:[.10,.25],shin:[.082,.23]}[part];
  if(!dims)throw new Error(`Unknown operator part ${part}`);
  const [r,h]=dims,length=h+2*r;
  // Axle ends and longitudinal load-bearing members replace soft capsules.
  // Dimensions are constrained to the old capsule's radius and full length.
  const profile=f.limb==='ceramic'?petal:f.limb==='lamellar'?chevron:shield;
  if(part==='arm'&&id==='deepseek'){
   // A turned pressure sleeve with a narrow central bellows, not a plate cage.
   return shell([[-length*.5,0,0],[-length*.40,r*.74,r*.74],[-length*.29,r,r],
    [length*.10,r*.64,r*.64],[length*.37,r*.94,r*.94],[length*.5,0,0]],f,low,20);
  }
  if(f.limb==='ceramic'||f.limb==='swept'){
   const armWidths={claude:[0,.64,.78,.91,.94,.63,0],gemini:[0,.28,.94,.45,.91,.31,0],mistral:[0,.25,.47,.69,.97,.31,0],kimi:[0,.35,.55,.90,.97,.54,0]};
   const sections=[[-length*.5,0,0],[-length*.45,r*.54,r*.54],[-length*.26,r*.85,r*.83],
    [length*.10,r,r*.96],[length*.35,r*.82,r*.76],[length*.46,r*.43,r*.43],[length*.5,0,0]];
   add(shell(part==='arm'?sections.map((row,i)=>[row[0],r*armWidths[id][i],r*armWidths[id][i]*.92]):sections,f,low,24));
   if(!low)panel(r*(part==='arm'&&id!=='claude'?.60:1.13),length*.52,.023,[0,0,-r*(part==='arm'?.49:.78)],[0,0,side*.09],profile);
  }else{
   for(const s of [-1,1])pin(r*.24,length*.72,[s*r*.54,0,0]);
   for(const s of [-1,1]){const g=new T.CylinderGeometry(r*.88,r*.88,r*.70,low?8:12);add(g,[0,s*(length*.5-r*.88),0],[Math.PI/2,0,0]);}
   const count=f.limb==='lamellar'?3:2;
   for(let i=0;i<count;i++){
    const width=part==='arm'?(id==='grok'?(i===0?1.45:.82):id==='meta'?1.92:id==='chatgpt'?(i===0?1.63:1.05):1.75):1.75;
    panel(r*width,length*(count===3?.32:.36),r*.48,[0,length*.23-i*length*.48/(count-1),-r*.57],[0,0,part==='arm'?0:side*.05],id==='meta'&&part==='arm'?slab:profile);
   }
   if(!low&&f.limb==='suspension')for(let i=0;i<3;i++){const g=new T.TorusGeometry(r*.34,r*.075,4,6);g.rotateX(Math.PI/2);add(g,[0,-length*.17+i*length*.17,0]);}
  }
 }
 return joinedGeometry(parts);
}
