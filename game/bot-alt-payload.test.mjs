// Bot alt-fire and payload escort (v8.6). These pin the two bot-policy seams:
//   - `botAltPreference`/`Match.altFire` wiring: bots pick the alt mode only in
//     the narrow situation the preference table describes, share the trigger
//     cadence and difficulty fire delay, and hold a short visible `a.alt`
//     window instead of morphing permanently;
//   - `payloadBotOrders`: attackers escort/clear around the live cart position
//     and defenders contest the same point, instead of parking on stale
//     checkpoint rings.
import test from 'node:test';
import assert from 'node:assert/strict';
import {Match} from './core.mjs';
import {WEAPONS} from './data.mjs';
import {altSpecFor} from './alt-fire.mjs';
import {ALT_FIRE_WINDOW,ALT_MINE_COOLDOWN,botAltPreference,botDefending,payloadBotOrders,payloadLeadPoint} from './bots.mjs';
import {payloadPosition} from './payload.mjs';

const seeded=(n=987654321)=>{let s=n>>>0;return()=>((s=(Math.imul(s,1664525)+1013904223)>>>0)/4294967296);};

// A deterministic, obstacle-free arena: distances and lines of fire are exact,
// and every actor except the bot is a valid target for preference checks.
function altFixture(){
 const m=new Match('chatgpt','openclaw',seeded(),'exchange',{mode:'deathmatch',botCount:1,humanCount:3,timeLimit:120});
 m.pickups=[];m.vehicles=[];
 m.arena={blocks:[],bounds:{minX:-1000,maxX:1000,minZ:-1000,maxZ:1000}};
 m.actors.forEach((a,i)=>Object.assign(a,{x:i*200,y:0,z:0,vx:0,vy:0,vz:0,health:100,maxHealth:100,armor:0,protection:0,weapon:0,shotWait:0,reloading:false,weaponSwitch:0,alt:false}));
 const bot=m.actors[3];
 Object.assign(bot.bot,{state:'engage',objectiveRole:'attack',route:[],destination:null,target:-1,memory:0,think:0,altMineAt:0,altUntil:0});
 return {m,bot,targets:m.actors.slice(0,3)};
}
const equip=(a,index,count)=>{a.weapon=index;a.ammo.fill(0);a.ammo[index]=count;};
const place=(a,x,z)=>Object.assign(a,{x,y:0,z,health:a.maxHealth});
const clearTargets=(targets,keep)=>targets.forEach(t=>{if(t!==keep)place(t,800,800);});
const aimAt=(bot,target)=>Object.assign(bot,{x:0,y:0,z:0,yaw:Math.atan2(-(target.x-bot.x),-(target.z-bot.z)),pitch:Math.asin((target.y+1.1-(bot.y+1.45))/(Math.hypot(target.x-bot.x,target.y-bot.y,target.z-bot.z)||1))});

test('the alt preference table is situational per weapon, not a generic upgrade',()=>{
 const {m,bot,targets}=altFixture();
 const [t0,t1,t2]=targets;
 // salvo: mid window, ammo reserve and own health all gate the burst.
 equip(bot,0,10);place(bot,0,0);place(t0,0,-18);clearTargets(targets,t0);t0.health=t0.maxHealth*.5;
 assert.equal(botAltPreference(m,bot,t0),true,'salvo in its mid window against a wounded target');
 place(t0,0,-5);assert.equal(botAltPreference(m,bot,t0),false,'salvo too close');
 place(t0,0,-18);t0.health=t0.maxHealth*.5;bot.ammo[0]=2;assert.equal(botAltPreference(m,bot,t0),false,'salvo below the reserve');
 bot.ammo[0]=10;bot.health=bot.maxHealth*.2;assert.equal(botAltPreference(m,bot,t0),false,'salvo while nearly dead');
 bot.health=bot.maxHealth;
 // slug: only past the scattergun falloff knee.
 equip(bot,3,10);place(t0,0,-22);assert.equal(botAltPreference(m,bot,t0),true,'slug at range');
 place(t0,0,-10);assert.equal(botAltPreference(m,bot,t0),false,'slug inside the scatter window');
 // overload: needs a second body on the beam.
 equip(bot,2,6);place(t0,0,-20);place(t1,0,-30);assert.equal(botAltPreference(m,bot,t0),true,'overload with a lined-up target');
 place(t1,60,0);assert.equal(botAltPreference(m,bot,t0),false,'overload alone');
 // cluster/mortar: blast into a pair.
 equip(bot,1,6);place(t0,0,-20);place(t1,0,-21);assert.equal(botAltPreference(m,bot,t0),true,'cluster into a pair');
 place(t1,60,0);assert.equal(botAltPreference(m,bot,t0),false,'cluster alone');
 equip(bot,4,6);place(t1,0,-21);assert.equal(botAltPreference(m,bot,t0),true,'mortar into a pair');
 place(t1,60,0);assert.equal(botAltPreference(m,bot,t0),false,'mortar alone');
 // chain: three bodies inside its own 7 m arc range.
 equip(bot,6,6);place(t0,0,-10);place(t1,0,-12);assert.equal(botAltPreference(m,bot,t0),false,'chain with only two bodies');
 place(t2,0,-13);assert.equal(botAltPreference(m,bot,t0),true,'chain with three bodies');
 // double tap: ranged finisher against a hurt target.
 equip(bot,8,6);clearTargets(targets,t0);place(t0,0,-30);t0.health=t0.maxHealth*.5;
 assert.equal(botAltPreference(m,bot,t0),true,'double tap finishes a hurt target');
 t0.health=t0.maxHealth;assert.equal(botAltPreference(m,bot,t0),false,'double tap on a healthy target');
 // twin: close quarters with a deep magazine.
 equip(bot,9,10);place(t0,0,-5);assert.equal(botAltPreference(m,bot,t0),true,'twin up close');
 place(t0,0,-14);assert.equal(botAltPreference(m,bot,t0),false,'twin outside close quarters');
 place(t0,0,-5);bot.ammo[9]=6;assert.equal(botAltPreference(m,bot,t0),false,'twin below its reserve');
 // flak bomb: only when the target is hugging geometry.
 equip(bot,7,6);place(t0,0,-10);assert.equal(botAltPreference(m,bot,t0),false,'bomb in the open');
 m.arena.blocks=[{x:0,z:-10,w:6,d:6,h:3}];
 assert.equal(botAltPreference(m,bot,t0),true,'bomb against a covered target');
 m.arena.blocks=[];
 // mine: defensive posture only, with a quiet period between drops.
 equip(bot,5,6);place(t0,0,-10);bot.bot.state='engage';bot.bot.objectiveRole='attack';
 assert.equal(botAltPreference(m,bot,t0),false,'mine while attacking');
 bot.bot.state='hold';assert.equal(botAltPreference(m,bot,t0),true,'mine while holding');
 bot.bot.altMineAt=m.time+ALT_MINE_COOLDOWN;
 assert.equal(botAltPreference(m,bot,t0),false,'mine respects its quiet period');
 assert.equal(botDefending(bot),true);
 bot.bot.state='engage';bot.bot.objectiveRole='defend';assert.equal(botDefending(bot),true,'the payload defence role counts');
 // Every weapon index has a row and a dead target is never worth an alt shot.
 for(let index=0;index<WEAPONS.length;index++){equip(bot,index,20);place(bot,0,0);place(t0,0,-15);assert.ok(typeof botAltPreference(m,bot,t0)==='boolean',`weapon ${index} resolves`);}
 t0.health=0;assert.equal(botAltPreference(m,bot,t0),false,'no alt fire at a corpse');
});

test('an alt-preferring bot calls altFire instead of fire, once per cadence, and opens a visible a.alt window',()=>{
 const {m,bot,targets}=altFixture();
 const [t0]=targets;
 clearTargets(targets,t0);place(bot,0,0);place(t0,0,-22);equip(bot,3,3);
 Object.assign(bot.bot,{target:t0.id,memory:1.5,think:0,tracking:true,reaction:0,altMineAt:0,altUntil:0});
 aimAt(bot,t0);
 const targetId=t0.id;
 const before=m.stats.shots;
 const input=m.botInput(bot,1/60)||{};
 assert.ok(Number.isFinite(input.x)&&Number.isFinite(input.z),'the bot still produces movement input');
 const shots=m.events.filter(e=>e.type==='shot');
 assert.equal(m.stats.shots-before,altSpecFor(3).shots,'one slug trigger resolved');
 assert.ok(shots.some(e=>e.alt===true&&e.altId==='slug'),'the slug alt mode fired');
 assert.equal(shots.some(e=>e.alt!==true&&e.weapon===3),false,'the primary did not fire in the same tick');
 assert.equal(bot.alt,true,'the alt window is open on the firing tick');
 assert.equal(bot.bot.altWantTarget===targetId,true,'the decision is keyed to the chosen target');
 const spec=altSpecFor(3);
 assert.ok(bot.shotWait>=spec.interval/1.16+m.difficulty.fireDelay-1e-9,`alt shares the difficulty fire delay (${bot.shotWait})`);
 // The situational guard: the same fight cannot spam the alt mode.
 bot.ammo[3]=3;
 assert.equal(botAltPreference(m,bot,t0),false,'a fresh alt shot arms the per-bot repeat wait');
 bot.bot.altReadyAt=m.time-1;
 assert.equal(botAltPreference(m,bot,t0),true,'the row is eligible again once the wait expires');
 bot.bot.altReadyAt=m.time+1;
 // The cadence guard holds across subsequent ticks until the shared wait drains.
 const cadenceBaseline=m.stats.shots;
 for(let i=0;i<12;i++){m.time+=1/60;bot.shotWait=Math.max(0,bot.shotWait-1/60);m.botInput(bot,1/60);}
 assert.equal(m.stats.shots,cadenceBaseline,'no second trigger inside the shared wait');
 // The window closes on its own once the timer expires.
 const windowEnd=m.time+ALT_FIRE_WINDOW+1/60;
 while(m.time<windowEnd){m.time+=1/60;bot.shotWait=Math.max(0,bot.shotWait-1/60);m.botInput(bot,1/60);}
 assert.equal(bot.alt,false,'the alt window closes after the deterministic hold');
});

test('alt preference evaluation consumes no randomness and reads only match state',()=>{
 let draws=0;
 const rng=()=>{draws++;return .5;};
 const m=new Match('chatgpt','openclaw',rng,'exchange',{mode:'deathmatch',botCount:1,humanCount:3,timeLimit:120});
 m.pickups=[];m.vehicles=[];
 m.arena={blocks:[],bounds:{minX:-1000,maxX:1000,minZ:-1000,maxZ:1000}};
 const bot=m.actors[3],target=m.actors[0],behind=m.actors[1];
 Object.assign(bot,{x:0,y:0,z:0,health:100,maxHealth:100,weapon:2,shotWait:0});
 bot.ammo.fill(0);bot.ammo[2]=6;
 Object.assign(target,{x:0,y:0,z:-20,health:100,maxHealth:100});
 Object.assign(behind,{x:0,y:0,z:-30,health:100,maxHealth:100});
 Object.assign(m.actors[2],{x:800,z:800});
 Object.assign(bot.bot,{state:'hold',objectiveRole:'defend'});
 const before=draws,first=botAltPreference(m,bot,target);
 assert.equal(first,true,'the overload is wanted while a second body is lined up');
 for(let i=0;i<64;i++)assert.equal(botAltPreference(m,bot,target),first);
 assert.equal(draws,before,'preference checks never draw from match.random');
 assert.equal(first,botAltPreference(m,bot,target),'the decision is stable for identical state');
});

test('the difficulty fire delay slows bot alt fire on easier settings',()=>{
 const run=difficulty=>{
  const m=new Match('chatgpt','openclaw',seeded(),'exchange',{mode:'deathmatch',botCount:1,humanCount:1,timeLimit:120,difficulty});
  m.pickups=[];m.vehicles=[];
  m.arena={blocks:[],bounds:{minX:-1000,maxX:1000,minZ:-1000,maxZ:1000}};
  const bot=m.actors[1],target=m.actors[0];
  m.actors.forEach(a=>Object.assign(a,{x:0,y:0,z:0,health:100,maxHealth:100,armor:0,protection:0,shotWait:0,reloading:false,weaponSwitch:0,alt:false}));
  equip(bot,3,5);Object.assign(bot.bot,{state:'engage',objectiveRole:'attack',route:[],destination:null,target:target.id,memory:1.5,think:0,tracking:true,reaction:0,altMineAt:0,altUntil:0});
  Object.assign(target,{x:0,y:0,z:-22});
  aimAt(bot,target);
  m.botInput(bot,1/60);
  return {bot,over:bot.alt===true};
 };
 const easy=run('easy'),hard=run('hard');
 assert.equal(easy.over,true,'easy bot alt-fires');
 assert.equal(hard.over,true,'hard bot alt-fires');
 assert.ok(easy.bot.shotWait-hard.bot.shotWait>=.4,`easy fire delay applies (${easy.bot.shotWait} vs ${hard.bot.shotWait})`);
});

// ---------------------------------------------------------------------------
// Payload escort
// ---------------------------------------------------------------------------
const payloadFixture=()=>{
 const m=new Match('chatgpt','openclaw',seeded(),'convoy-line',{mode:'payload',botCount:5,humanCount:1,timeLimit:120,fragLimit:3});
 m.pickups=[];
 const state=m.objectiveState;
 state.position=payloadPosition(state);
 return {m,state};
};
const cartDistance=(destination,state)=>Math.hypot(destination.x-state.position.x,destination.z-state.position.z);
const attackerBot=(m,state)=>m.actors.find(a=>a.bot&&a.team===state.attacker);
const defenderBot=(m,state)=>m.actors.find(a=>a.bot&&a.team===state.defender);

test('payload attackers escort the live cart and defenders contest the same point',()=>{
 const {m,state}=payloadFixture();
 const attacker=attackerBot(m,state),defender=defenderBot(m,state);
 assert.ok(attacker&&defender,'the fixture fields both roles');
 const escort=payloadBotOrders(m,attacker);
 assert.equal(escort.state,'objective');
 assert.equal(escort.role,'escort');
 assert.ok(cartDistance(escort.destination,state)<=state.radius,`attacker slot rides the cart (${cartDistance(escort.destination,state)})`);
 const hold=payloadBotOrders(m,defender);
 assert.equal(hold.state,'objective');
 assert.equal(hold.role,'defend');
 assert.ok(cartDistance(hold.destination,state)<=state.radius,`defender slot contests the cart (${cartDistance(hold.destination,state)})`);
});

test('payload orders follow the cart as it moves instead of a stale checkpoint',()=>{
 const {m,state}=payloadFixture();
 const attacker=attackerBot(m,state);
 const stale={...state.position},checkpoint=state.checkpoints[0];
 state.distance=state.total*.4;
 state.position=payloadPosition(state);
 assert.ok(Math.hypot(state.position.x-stale.x,state.position.z-stale.z)>2,'the cart really moved');
 const escort=payloadBotOrders(m,attacker);
 assert.ok(cartDistance(escort.destination,state)<=state.radius,'orders ride the moved cart');
 assert.ok(Math.hypot(escort.destination.x-stale.x,escort.destination.z-stale.z)>1,'orders are not the old cart spot');
 assert.ok(Math.hypot(escort.destination.x-checkpoint.x,escort.destination.z-checkpoint.z)<=state.radius+6,'orders are not the checkpoint ring either');
});

test('a rolling cart sends a bounded share of attackers ahead while the rest escort',()=>{
 const {m,state}=payloadFixture();
 state.distance=state.total*.3;state.position=payloadPosition(state);
 state.pushing=state.attacker;state.contested=false;
 const attackers=m.actors.filter(a=>a.bot&&a.team===state.attacker);
 assert.ok(attackers.length>=2,'the fixture has an escort squad');
 for(const attacker of attackers)Object.assign(attacker,{x:state.position.x,y:state.position.y,z:state.position.z+2,health:attacker.maxHealth});
 let ahead=0,escorts=0;
 for(const attacker of attackers){
  const orders=payloadBotOrders(m,attacker);
  if(orders.role==='clear'){
   ahead++;
   assert.deepEqual(orders.destination,payloadLeadPoint(state,14),'the clearing half uses the authored route ahead of the cart');
   assert.ok(Number.isFinite(orders.destination.x)&&Number.isFinite(orders.destination.z),'the lead point is finite');
  }else{escorts++;assert.ok(cartDistance(orders.destination,state)<=state.radius,'escorts hold the cart');}
 }
 assert.ok(ahead>=1&&escorts>=1,'the squad splits deterministically');
 // The lead point is clamped to the route and never collapses onto the cart.
 state.distance=state.total-1;
 assert.ok(payloadLeadPoint(state,14)&&Number.isFinite(payloadLeadPoint(state,14).x));
});

test('a contested or rolling-back cart pulls attackers onto the nearby defenders',()=>{
 const {m,state}=payloadFixture();
 const attacker=attackerBot(m,state),defender=defenderBot(m,state);
 state.distance=state.total*.5;state.position=payloadPosition(state);
 state.pushing=state.defender;state.contested=false;
 Object.assign(defender,{x:state.position.x+5,y:state.position.y,z:state.position.z,health:defender.maxHealth});
 const orders=payloadBotOrders(m,attacker);
 assert.equal(orders.role,'clear');
 assert.equal(orders.destination.x,defender.x);
 assert.equal(orders.destination.z,defender.z);
 state.contested=true;state.pushing=null;
 const contested=payloadBotOrders(m,attacker);
 assert.equal(contested.role,'clear');
 assert.equal(contested.destination.x,defender.x,'a contested cart means clearing whoever holds it');
 Object.assign(defender,{x:state.position.x+80,z:state.position.z});
 const clear=payloadBotOrders(m,attacker);
 assert.ok(cartDistance(clear.destination,state)<=state.radius,'no nearby enemy falls back to the cart slot');
});

test('payload orders consume no randomness and are stable for identical state',()=>{
 let draws=0;
 const seeded=(n=555)=>{let s=n>>>0;return()=>{draws++;return (s=(Math.imul(s,1664525)+1013904223)>>>0)/4294967296;};};
 const m=new Match('chatgpt','openclaw',seeded(),'riverbend',{mode:'payload',botCount:3,humanCount:1,timeLimit:120,fragLimit:3});
 m.pickups=[];
 const state=m.objectiveState;
 state.distance=state.total*.25;state.position=payloadPosition(state);
 const attackers=m.actors.filter(a=>a.bot&&a.team===state.attacker);
 const before=draws;
 const first=attackers.map(a=>payloadBotOrders(m,a));
 const lead=payloadLeadPoint(state,14);
 for(let i=0;i<16;i++){
  attackers.forEach((a,index)=>assert.deepEqual(payloadBotOrders(m,a),first[index]));
  assert.deepEqual(payloadLeadPoint(state,14),lead);
 }
 assert.equal(draws,before,'payload orders never draw from match.random');
});

test('botInput assigns payload escort state and re-follows the cart each think',()=>{
 const {m,state}=payloadFixture();
 const attacker=attackerBot(m,state);
 Object.assign(attacker.bot,{think:0,route:[],destination:null,state:'roam'});
 m.botInput(attacker,1/60);
 assert.equal(attacker.bot.state,'objective');
 assert.ok(['escort','clear'].includes(attacker.bot.objectiveRole));
 assert.ok(cartDistance(attacker.bot.destination,state)<=state.radius,'the attacker destination rides the cart');
 const first={...attacker.bot.destination};
 state.distance=state.total*.5;state.position=payloadPosition(state);
 Object.assign(attacker.bot,{think:0});
 m.botInput(attacker,1/60);
 assert.ok(cartDistance(attacker.bot.destination,state)<=state.radius,'the new destination follows the moved cart');
 assert.ok(Math.hypot(attacker.bot.destination.x-first.x,attacker.bot.destination.z-first.z)>1,'the stale destination is replaced');
 const defender=defenderBot(m,state);
 Object.assign(defender.bot,{think:0,route:[],destination:null,state:'roam'});
 m.botInput(defender,1/60);
 assert.equal(defender.bot.objectiveRole,'defend');
 assert.ok(cartDistance(defender.bot.destination,state)<=state.radius,'the defender destination contests the cart');
});

test('assault sector orders are not disturbed by the payload escort',()=>{
 const m=new Match('chatgpt','openclaw',seeded(),'warfront',{mode:'assault',botCount:3,humanCount:1,timeLimit:120});
 m.pickups=[];
 const state=m.objectiveState,sector=state.sectors[Math.min(state.active??0,state.sectors.length-1)];
 const bots=m.actors.filter(a=>a.bot);
 assert.ok(sector,'the assault fixture has an active sector');
 for(const bot of bots){Object.assign(bot.bot,{think:0,memory:0,target:-1,destination:null});m.botInput(bot,1/60);}
 assert.ok(bots.every(bot=>['hold','objective','roam','seek','engage','flank','cover','pursue'].includes(bot.bot.state)),'assault bots resolve a sector policy');
 assert.ok(bots.some(bot=>bot.bot.destination&&Math.hypot(bot.bot.destination.x-sector.x,bot.bot.destination.z-sector.z)<=8),'at least one attacker heads to the active sector');
});

test('a live payload match sees attackers reach the cart and push it',()=>{
 const m=new Match('chatgpt','openclaw',seeded(),'convoy-line',{mode:'payload',botCount:3,humanCount:1,timeLimit:120,fragLimit:3});
 const state=m.objectiveState;
 let closest=Infinity,moved=false;
 for(let i=0;i<60*60&&!m.over;i++){
  m.step(1/60);
  if(m.objectiveState.distance>0)moved=true;
  const position=m.objectiveState.position??payloadPosition(m.objectiveState);
  for(const attacker of m.actors)if(attacker.bot&&attacker.team===state.attacker&&attacker.health>0){
   closest=Math.min(closest,Math.hypot(attacker.x-position.x,attacker.z-position.z));
  }
 }
 assert.ok(moved,'attackers stand on the cart and push it');
 assert.ok(closest<=state.radius+3,`an attacker reached the cart (closest ${closest.toFixed(1)})`);
});
