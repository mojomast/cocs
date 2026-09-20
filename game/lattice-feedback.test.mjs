import test from 'node:test';
import assert from 'node:assert/strict';
import {latticeSoundCue,latticeCaption,createLatticeAudioState,latticePresentationChanges,HQ_DAMAGE_LOOP} from './lattice-feedback.mjs';
import {SynthAudio} from './feedback.mjs';
test('LATTICE event audio is bounded and distinguishes secured ground from loss',()=>{
 const player={id:0,team:0};
 const audio=new SynthAudio();audio.ctx={currentTime:0};
 const heard=[];audio._beat=cue=>heard.push(cue);
 for(const type of ['cocs-capture','cocs-depot-capture','director-wave','director-wave-cleared','director-siege','director-siege-lifted'])audio.event({type,team:0},player);
 assert.equal(heard.length,6);
 assert.ok(heard.every(cue=>cue.notes.length<=4&&cue.gain<=.08&&cue.length<=.3));
 assert.notDeepEqual(latticeSoundCue({type:'cocs-capture',team:0},player),latticeSoundCue({type:'cocs-capture',team:1},player));
 assert.equal(latticeSoundCue({type:'cocs-device-use',actor:1},player),null);
 assert.equal(latticeSoundCue({type:'cocs-terminal-hack',team:1},player),null);
 // The generic progress tick stays out of the lattice table (feedback owns its
 // per-zone quantizer); the director beats now all have earcons.
 assert.equal(latticeSoundCue({type:'zone-progress'},player),null,'progress chatter is quantized, not a lattice cue');
 for(const type of ['director-phase','director-hq-damage'])assert.ok(latticeSoundCue({type},player),`${type} has an earcon`);
 assert.match(latticeCaption({type:'director-siege'}),/FALL BACK/);
});

test('every director and coop beat has a distinct bounded motif, one voice per event',()=>{
 const player={id:0,team:0};
 const beats=['director-init','director-spawn-telegraph','director-spawn','director-wave','director-wave-cleared','director-modifier','director-intermission','director-escalation','director-boss','director-phase','director-retarget','director-overrun','director-retire','director-denial','director-denial-end','director-reinforce','director-hq-damage','director-siege','director-siege-lifted','coop-spend','coop-spend-rejected','coop-reinforce','coop-resupply','coop-bonus','coop-reserve','coop-intermission-open','coop-subagent-retire','operation-summary','cocs-order-complete','cocs-order-rejected','cocs-buy'];
 const seen=new Map();
 for(const type of beats){
  const cue=latticeSoundCue({type,team:0,actor:0,hq:'hq-0',health:900,time:10,state:'open'},player);
  assert.ok(cue,`${type} resolves to a cue`);
  assert.ok(cue.notes.length<=4&&cue.notes.length>=1,`${type} stays short`);
  assert.ok(cue.gain<=.08&&cue.length<=.3,`${type} stays quiet and short`);
  seen.set(type,cue);
 }
 // The families the earcons must keep apart: warning vs boss vs denial vs
 // economy vs klaxon vs supply.
 assert.notDeepEqual(seen.get('director-spawn-telegraph'),seen.get('director-boss'));
 assert.notDeepEqual(seen.get('director-denial'),seen.get('director-denial-end'));
 assert.notDeepEqual(seen.get('coop-bonus'),latticeSoundCue({type:'coop-bonus',state:'failed',time:11},player),'a failed bonus burns instead of chimes');
 assert.notDeepEqual(seen.get('coop-resupply'),seen.get('coop-reserve'));
 assert.notDeepEqual(seen.get('director-hq-damage'),seen.get('coop-spend-rejected'));
 assert.equal(latticeSoundCue({type:'coop-bonus',state:'failed'},player).notes.length,3,'burn falls');
 // Team/actor gating: private beats stay off another team's stream.
 assert.equal(latticeSoundCue({type:'cocs-order-complete',team:1},player),null);
 assert.equal(latticeSoundCue({type:'cocs-order-rejected',team:1},player),null);
 assert.equal(latticeSoundCue({type:'cocs-buy',actor:1},player),null);
 assert.equal(latticeSoundCue({type:'unknown-beat',team:0},player),null);
 // SynthAudio spends exactly one `_beat` voice per beat.
 const audio=new SynthAudio();audio.ctx={currentTime:0};
 const heard=[];audio._beat=cue=>heard.push(cue);
 for(const type of beats)audio.event({type,team:0,actor:0,hq:'hq-0',health:900,time:10,state:'open'},player);
 assert.equal(heard.length,beats.length,'one voice per LATTICE beat');
});

test('the HQ klaxon is an edge/loop warning and stays silent while repaired',()=>{
 const player={id:0,team:0};
 const state=createLatticeAudioState();
 const hit=(time,health)=>latticeSoundCue({type:'director-hq-damage',hq:'hq-0',health,time},player,state);
 assert.ok(hit(10,900),'the first hit is the edge');
 assert.equal(hit(10.5,890),null,'a repeat inside the loop window is silent');
 assert.equal(hit(11,880),null);
 assert.ok(hit(10+HQ_DAMAGE_LOOP,860),'a continuing siege re-arms after the loop window');
 assert.equal(hit(13.01,860),null,'an unchanged health tick is silent');
 assert.equal(hit(13.5,880),null,'a repair quietens the warning');
 assert.ok(hit(14,870),'damage after a repair is a fresh edge');
 assert.equal(latticeSoundCue({type:'director-hq-damage',hq:'hq-0',health:860,time:14,armed:false},player,state),null,'an unarmed siege stays silent');
 // Bounded state: many HQ keys cannot grow the map without limit.
 for(let i=0;i<80;i++)latticeSoundCue({type:'director-hq-damage',hq:`hq-${i}`,health:100-i,time:100+i},player,state);
 assert.ok(state.hq.size<=32,'the HQ state stays bounded');
});

test('director and coop captions are readable and unknown beats stay uncaptioned',()=>{
 assert.match(latticeCaption({type:'director-spawn-telegraph',kind:'boss'}),/Boss telegraph/);
 assert.match(latticeCaption({type:'director-boss',phase:2}),/Boss deployed/);
 assert.match(latticeCaption({type:'director-hq-damage'}),/HQ UNDER FIRE/);
 assert.match(latticeCaption({type:'director-retarget',node:'relay-2'}),/RELAY 2/);
 assert.match(latticeCaption({type:'coop-bonus',state:'done',label:'Convoy'}),/Bonus done/);
 assert.match(latticeCaption({type:'coop-subagent-retire'}),/Subagent/);
 assert.match(latticeCaption({type:'cocs-order-complete',verb:'hold'}),/Order complete/);
 assert.match(latticeCaption({type:'cocs-order-rejected',verb:'push'}),/Order rejected/);
 assert.match(latticeCaption({type:'director-init',tier:2}),/tier 2/);
 assert.equal(latticeCaption({type:'coop-spend',verb:'repair'}),null,'the HUD keeps its own spend wording');
 assert.equal(latticeCaption({type:'not-a-beat'}),null);
 assert.equal(latticeCaption(null),null);
});

test('world-marker transitions fire once per flip and seed without a burst',()=>{
 const nodes=[{id:'front-0',owner:0,x:-54,y:4,z:0,r:6},{id:'relay-0',owner:null,x:0,y:4,z:0,r:6}];
 const depots=[{id:'depot-0',owner:null,x:-70,y:4,z:-50,radius:6}];
 const devices=[{id:'zip-a',state:'live',x:-30,y:2,z:0}];
 const first=latticePresentationChanges(null,{nodes,depots,devices});
 assert.equal(first.captures.length,0,'the first frame seeds markers instead of sparking');
 assert.equal(first.deviceChanges.length,0);
 const capture=latticePresentationChanges(first.next,{nodes:[{...nodes[0],owner:1},nodes[1]],depots,devices});
 assert.equal(capture.captures.length,1);
 assert.deepEqual({owner:capture.captures[0].owner,lost:capture.captures[0].lost,x:capture.captures[0].x,radius:capture.captures[0].radius},{owner:1,lost:false,x:-54,radius:6});
 const quiet=latticePresentationChanges(capture.next,{nodes:[{...nodes[0],owner:1},nodes[1]],depots,devices});
 assert.equal(quiet.captures.length,0,'a held node does not re-fire');
 const routed=latticePresentationChanges(quiet.next,{nodes:[{...nodes[0],owner:1},nodes[1]],depots:[{...depots[0],owner:1}],devices:[{...devices[0],state:'cut'}]});
 assert.equal(routed.captures.length,1);
 assert.equal(routed.captures[0].depot,true);
 assert.deepEqual(routed.deviceChanges.map(change=>[change.from,change.to]),[['live','cut']]);
 assert.equal(nodes[0].owner,0,'the authoritative node list is never mutated');
});
