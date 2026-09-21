// Procedural objective earcons. One short motif uses one existing synth voice;
// no samples, timers or per-tick progress sounds are added.
const motif=(notes,step=.075,length=.2,gain=.065,shimmer=false)=>Object.freeze({notes:Object.freeze(notes),step,length,gain,shimmer});
// The LATTICE vocabulary: secured/lost objectives, traversal devices, director
// warnings and the Operations economy. Every family stays a short (<=4 notes,
// <=.3 s) motif so one beat is still one voice, and every motif is bounded at
// or below .08 gain.
const cues=Object.freeze({
 secured:motif([0,7,12],.075,.24,.075,true), lost:motif([7,3,-2],.11,.25,.06),
 terminal:motif([0,4,7,12],.04,.14,.055), vault:motif([12,7,12],.055,.2,.06),
 zipline:motif([0,2,7],.035,.12,.055), teleporter:motif([12,0,7],.035,.16,.055,true),
 launch:motif([-12,0,7],.055,.18,.065),
 wave:motif([0,-5,0],.12,.26,.07), cleared:motif([0,5,7,12],.08,.23,.07,true),
 siege:motif([0,-1,0,-1],.15,.2,.08), relieved:motif([0,7],.1,.25,.065),
 // Director wave lifecycle. Warnings are short and bright; approaches rise.
 init:motif([0,7],.09,.22,.065),
 telegraph:motif([12,11],.05,.13,.06), bossWarn:motif([0,-5,-7],.1,.24,.08),
 spawn:motif([0,5],.06,.16,.06),
 escalate:motif([0,5,7],.05,.16,.065),
 modifier:motif([7,4,7],.07,.16,.06),
 intermission:motif([0,5],.09,.2,.055),
 boss:motif([0,-5,-12],.12,.3,.08),
 phase:motif([0,-3,-7],.09,.24,.075,true),
 retarget:motif([7,5,12],.05,.15,.06),
 overrun:motif([12,7,4],.07,.18,.075),
 retire:motif([5,0,-3],.09,.2,.055),
 // Denial is a failing pair; ending a denial resolves it.
 denial:motif([7,3],.13,.24,.07), denialEnd:motif([0,5],.09,.22,.06),
 // Replenishments rise; the HQ klaxon alternates two tones.
 reinforce:motif([0,7,12],.05,.18,.07),
 hqDamage:motif([7,4,7,4],.085,.15,.075),
 supply:motif([0,4,7,12],.045,.16,.065,true),
 // Economy: coin up, burn down, spend chirp, rejection falls.
 spend:motif([12,7],.04,.11,.055), rejected:motif([9,4,2],.05,.12,.055),
 coin:motif([12,19],.05,.12,.06), burn:motif([7,3,0],.07,.16,.06),
 reserve:motif([0,-3],.12,.26,.07),
 orderComplete:motif([0,7],.06,.18,.065), buy:motif([0,5],.05,.14,.055),
 summary:motif([0,4,7],.08,.26,.07),
 // Depot logistics, role agents and the prime channel. Deployment and purchases
 // rise; sabotage/siphon/scan pivot around the existing terminal and economy
 // voices. Every family stays as short and quiet as the ones above.
 loaner:motif([0,5,12],.055,.2,.07,true), loanerWarn:motif([12,5],.06,.16,.055),
 depotPurchase:motif([5,12,19],.05,.16,.065,true),
 sabotage:motif([12,6,0],.06,.18,.068), sapper:motif([12,7,3],.065,.17,.07),
 siphon:motif([7,0,-5],.06,.16,.06), scan:motif([19,12],.05,.14,.055),
 roleSpawn:motif([0,3,7],.055,.16,.06), roleKilled:motif([7,2,-3],.08,.2,.07),
 roleExpire:motif([7,0],.09,.2,.055), roleRally:motif([0,7,12,19],.05,.22,.07,true),
 roleRepair:motif([0,4,7,11],.05,.18,.065), roleSpot:motif([12,19,24],.045,.14,.06),
 primeStart:motif([0,-7,0],.09,.22,.07), prime:motif([0,-7,-12],.1,.26,.075,true),
 primeInterrupt:motif([9,2,-1],.07,.16,.07),
 // Commander beats: taking the seat is a low rise, a stance is a decisive
 // two-step (up for ASSAULT, flat for HOLD, down for FORTIFY), a route lock is
 // three descending taps and a mutiny vote is an unresolved tick.
 command:motif([0,5],.06,.2,.07,true), mutiny:motif([5,0],.06,.16,.06),
 assault:motif([0,7],.06,.18,.07), holdLine:motif([0,0],.05,.15,.065), fortify:motif([0,-5],.07,.2,.07),
 route:motif([12,7,0],.05,.16,.065),
});

// Bounded per-HQ state for the periodic `director-hq-damage` warning. The
// stream emits one event every 30 ticks whenever the siege health moves, so the
// raw cue would chatter: the first hit in a siege is the edge, repeats while the
// health keeps falling re-arm at most once per loop window, and a repair (or a
// quiet tick) stays silent and re-arms the next hit immediately.
export const HQ_DAMAGE_LOOP=3;
export function createLatticeAudioState(){return {hq:new Map(),cues:new Map()};}
const HQ_STATE_CAP=32;
function hqDamageCue(event,state){
 if(event?.armed===false)return null;
 const cue=cues.hqDamage;
 if(!state||!(state.hq instanceof Map))return cue;
 const key=String(event.hq??'hq'),health=Number(event.health),time=Number(event.time);
 const entry=state.hq.get(key)||null;
 if(entry&&Number.isFinite(health)&&Number.isFinite(entry.health)&&health>entry.health){
  // Repaired: stay silent, but the next hit is a fresh edge.
  entry.health=health;entry.fired=-Infinity;entry.time=Number.isFinite(time)?time:entry.time;
  return null;
 }
 const edge=!entry||!Number.isFinite(health)||!Number.isFinite(entry.health)||health<entry.health;
 const due=!entry||entry.fired===-Infinity||!Number.isFinite(time)||!Number.isFinite(entry.fired)||time-entry.fired>=HQ_DAMAGE_LOOP;
 const fire=edge&&due;
 state.hq.delete(key);
 state.hq.set(key,{
  health:Number.isFinite(health)?health:(entry?.health??null),
  time:Number.isFinite(time)?time:(entry?.time??null),
  fired:fire&&Number.isFinite(time)?time:(entry?.fired??-Infinity),
 });
 if(state.hq.size>HQ_STATE_CAP)state.hq.delete(state.hq.keys().next().value);
 return fire?cue:null;
}

// Repeat buckets for the ambient role beats that fire on a cadence (scan
// sweeps, ally rallies/repairs/spots). Keyed per team or actor and bounded like
// the HQ map, so a long Operations round cannot grow the state. Events without
// an authoritative `time` always voice: only the sim stream is bucketed.
export const LATTICE_REPEAT_WINDOW=Object.freeze({scan:1.5,rally:3,repair:3,spot:3});
const REPEAT_STATE_CAP=32;
function repeatCue(event,state,key,cue,window){
 if(!state||!(state.cues instanceof Map))return cue;
 const time=Number(event?.time);
 if(!Number.isFinite(time))return cue;
 const last=state.cues.get(key);
 // Silent repeats do not re-arm the bucket: a stream that keeps reporting the
 // same beat still voices once per window instead of never.
 if(Number.isFinite(last)&&time-last<window)return null;
 state.cues.delete(key);
 state.cues.set(key,time);
 if(state.cues.size>REPEAT_STATE_CAP)state.cues.delete(state.cues.keys().next().value);
 return cue;
}

export function latticeSoundCue(event,player,state=null){
 if(!event||!player)return null;
 if(event.type==='cocs-terminal-shard')return event.team===player.team?(event.action==='collect'?cues.coin:cues.burn):null;
 if(event.type==='cocs-capture'||event.type==='cocs-depot-capture')return event.team===player.team?cues.secured:cues.lost;
 if(event.type==='cocs-device-use'){
  if(event.actor!==player.id)return null;
  return event.kind==='zipline'?cues.zipline:event.kind==='teleporter'?cues.teleporter:cues.launch;
 }
 if(event.type==='cocs-terminal-vault')return event.team===player.team?cues.vault:null;
 if(event.type==='cocs-terminal-sabotage')return event.team===player.team?cues.sabotage:null;
 if(['cocs-terminal-hack','cocs-terminal-deploy'].includes(event.type))return event.team===player.team?cues.terminal:null;
 // Depot logistics. A loaner rolls out for everyone watching the pad (the
 // friendly team gets the rise, the enemy a short warning); the REQ purchase is
 // a team-private economy beat.
 if(event.type==='cocs-depot-vehicle-spawn')return event.team===player.team||event.team===undefined||event.team===null?cues.loaner:cues.loanerWarn;
 if(event.type==='cocs-depot-purchase')return event.team===player.team?cues.depotPurchase:null;
 // Saboteur, scout and role-agent beats. Only the acting team is voiced; the
 // cadence beats are bucketed so a long round stays one voice per moment.
 if(event.type==='cocs-sapper')return event.team===player.team?cues.sapper:null;
 if(event.type==='cocs-siphon')return event.team===player.team?cues.siphon:null;
 if(event.type==='cocs-scan')return event.team===player.team?repeatCue(event,state,`scan:${event.team}`,cues.scan,LATTICE_REPEAT_WINDOW.scan):null;
 if(event.type==='cocs-role-spawn')return event.team===player.team?cues.roleSpawn:null;
 if(event.type==='cocs-role-killed')return event.team===player.team?cues.roleKilled:null;
 if(event.type==='cocs-role-expire')return event.team===player.team?cues.roleExpire:null;
 if(event.type==='cocs-role-rally')return repeatCue(event,state,`rally:${event.actor}`,cues.roleRally,LATTICE_REPEAT_WINDOW.rally);
 if(event.type==='cocs-role-repair')return Array.isArray(event.repaired)&&event.repaired.length?repeatCue(event,state,`repair:${event.actor}`,cues.roleRepair,LATTICE_REPEAT_WINDOW.repair):null;
 if(event.type==='cocs-role-spot')return Array.isArray(event.targets)&&event.targets.length?repeatCue(event,state,`spot:${event.actor}`,cues.roleSpot,LATTICE_REPEAT_WINDOW.spot):null;
 // Commander command beats are team-private intent: only the issuing team is
 // voiced, and a stance takes its own colour (assault rises, fortify falls).
 if(event.type==='cocs-command'){
  if(event.team!==player.team)return null;
  if(event.action==='take'||event.action==='release')return cues.command;
  if(event.action==='mutiny-vote')return event.seat?cues.command:cues.mutiny;
  if(event.action==='policy'){
   if(event.policy==='ASSAULT')return cues.assault;
   if(event.policy==='FORTIFY')return cues.fortify;
   return cues.holdLine;
  }
  if(event.action==='set-route')return repeatCue(event,state,`route:${event.team}`,cues.route,LATTICE_REPEAT_WINDOW.scan);
  return null;
 }
 // The prime channel is world-visible: both sides hear a node come online.
 if(event.type==='cocs-prime-start')return cues.primeStart;
 if(event.type==='cocs-prime')return cues.prime;
 if(event.type==='cocs-prime-interrupt')return cues.primeInterrupt;
 // Team-private command beats only voice for the issuing team; a buy is the
 // local commander's own beat.
 if(event.type==='cocs-order-complete')return event.team===player.team?cues.orderComplete:null;
 if(event.type==='cocs-order-rejected')return event.team===player.team?cues.rejected:null;
 if(event.type==='cocs-buy')return event.actor===player.id?cues.buy:null;
 if(event.type==='director-spawn-telegraph')return event.kind==='boss'?cues.bossWarn:cues.telegraph;
 if(event.type==='director-spawn')return cues.spawn;
 if(event.type==='coop-spend-rejected')return cues.rejected;
 if(event.type==='coop-spend')return cues.spend;
 if(event.type==='coop-bonus')return event.state==='failed'?cues.burn:cues.coin;
 if(event.type==='operation-summary')return cues.summary;
 if(event.type==='director-hq-damage')return hqDamageCue(event,state);
 return {
  'director-init':cues.init,
  'director-wave':cues.wave,'director-wave-cleared':cues.cleared,
  'director-siege':cues.siege,'director-siege-lifted':cues.relieved,
  'director-escalation':cues.escalate,'director-modifier':cues.modifier,
  'director-intermission':cues.intermission,'director-boss':cues.boss,
  'director-phase':cues.phase,'director-retarget':cues.retarget,
  'director-overrun':cues.overrun,'director-retire':cues.retire,
  'director-denial':cues.denial,'director-denial-end':cues.denialEnd,
  'director-reinforce':cues.reinforce,
  'coop-reinforce':cues.reinforce,'coop-resupply':cues.supply,
  'coop-reserve':cues.reserve,'coop-intermission-open':cues.intermission,
  'coop-subagent-retire':cues.retire,
 }[event.type]??null;
}

export function latticeCaption(event){
 if(event?.type==='cocs-terminal-shard')return event.action==='collect'?'Shard secured · return to your HQ vault':'Shard returned · recover it at the relay';
 const label=String(event?.node??event?.depot??'').replace(/-/g,' ').toUpperCase();
 const roleWord=String(event?.role??'role').replace(/-/g,' ').toUpperCase();
 if(event?.type==='cocs-capture')return `Node captured · ${label}`;
 if(event?.type==='cocs-depot-capture')return `Depot captured · ${label}`;
 // The depot headline: a loaner rolling off the pad, and the REQ purchase.
 if(event?.type==='cocs-depot-vehicle-spawn')return label?`LOANER READY · ${label}`:'LOANER READY';
 if(event?.type==='cocs-depot-purchase')return `${String(event.item??'puma').toUpperCase()} REQUISITIONED${label?` · ${label}`:''}`;
 if(event?.type==='cocs-device-use')return `Route engaged · ${String(event.kind??'device').replace(/-/g,' ')}`;
 if(event?.type==='director-wave')return `Director wave ${event.wave} approaching`;
 if(event?.type==='director-wave-cleared')return `Wave ${event.wave} cleared`;
 if(event?.type==='director-siege')return 'HQ UNDER SIEGE · FALL BACK';
 if(event?.type==='director-siege-lifted')return 'HQ siege lifted';
 if(event?.type==='cocs-order-complete')return `Order complete · ${String(event.verb??'').toUpperCase()}`.trim();
 if(event?.type==='cocs-order-rejected')return `Order rejected · ${String(event.verb??'').toUpperCase()}`.trim();
 // Commander intent subtitles, so a stance or route is readable without the HUD.
 if(event?.type==='cocs-command'){
  if(event.action==='take')return 'Command assumed';
  if(event.action==='release')return 'Command released';
  if(event.action==='mutiny-vote')return event.seat?'Mutiny carried · new commander':`Mutiny vote · ${Math.max(0,Number(event.votes)||0)}/${Math.max(1,Number(event.needed)||1)}`;
  if(event.action==='policy')return event.policy?`Stance · ${String(event.policy).toUpperCase()}`:'Stance cleared';
  if(event.action==='set-route')return event.value?`Route set · ${String(event.value).replace(/-/g,' ').toUpperCase()}`:'Route cleared';
  return 'Command updated';
 }
 if(event?.type==='director-init')return `Operation online${event.tier?` · tier ${event.tier}`:''}`;
 if(event?.type==='director-spawn-telegraph')return event.kind==='boss'?'Boss telegraph':'Spawn telegraph';
 if(event?.type==='director-spawn')return `Wave ${event.wave} contact`;
 if(event?.type==='director-modifier')return `Wave modifier · ${String(event.name??event.id??'').replace(/-/g,' ').toUpperCase()}`.trim();
 if(event?.type==='director-escalation')return `Director escalation · ${String(event.kind??'').replace(/-/g,' ').toUpperCase()}`.trim();
 if(event?.type==='director-boss')return `Boss deployed${event.phase?` · phase ${event.phase}`:''}`;
 if(event?.type==='director-phase')return `Boss phase ${event.phase}`;
 if(event?.type==='director-retarget')return `Director retarget · ${String(event?.node??'').replace(/-/g,' ').toUpperCase()}`.trim();
 if(event?.type==='director-overrun')return 'Front overrun';
 if(event?.type==='director-retire')return `Director retires ${Number(event.count)||0} units`;
 if(event?.type==='director-denial')return `Denial field · ${String(event?.node??'').replace(/-/g,' ').toUpperCase()}`.trim();
 if(event?.type==='director-denial-end')return 'Denial lifted';
 if(event?.type==='director-reinforce')return `Director reinforcement · ${String(event?.node??'').replace(/-/g,' ').toUpperCase()}`.trim();
 if(event?.type==='director-hq-damage')return 'HQ UNDER FIRE';
 if(event?.type==='coop-bonus')return `Bonus ${String(event.state??'open')}${event.label?` · ${event.label}`:''}`;
 if(event?.type==='coop-spend-rejected')return `Spend rejected · ${String(event.verb??'').toUpperCase()}`.trim();
 if(event?.type==='coop-subagent-retire')return 'Subagent retired';
 // Saboteur, scout and role-agent beats, then the prime channel. The terminal
 // sabotage names its own terminal instead of the generic completion line.
 if(event?.type==='cocs-terminal-sabotage')return `Terminal sabotage${event.terminal?` · ${String(event.terminal).replace(/-/g,' ').toUpperCase()}`:''}`;
 if(event?.type==='cocs-sapper')return `Link cut${label?` · ${label}`:''}${Number(event.denied)>0?` · ${Number(event.denied)} DENIED`:''}`;
 if(event?.type==='cocs-siphon')return `Flux siphoned${Number(event.flux)>0?` · ${Math.round(Number(event.flux))} FLUX`:''}`;
 if(event?.type==='cocs-scan')return `Scan sweep${Number(event.marked)>0?` · ${Number(event.marked)} MARKED`:''}`;
 if(event?.type==='cocs-role-spawn')return `Role deployed · ${roleWord}`;
 if(event?.type==='cocs-role-killed')return `Role killed · ${roleWord}`;
 if(event?.type==='cocs-role-expire')return `Role retired · ${roleWord}${Number(event.refund)>0?` · +${Math.round(Number(event.refund))} FLUX`:''}`;
 if(event?.type==='cocs-role-rally')return `Rally${event.targets?.length?` · ${event.targets.length} LINKED`:''}`;
 if(event?.type==='cocs-role-repair')return `Repairs done${event.repaired?.length?` · ${event.repaired.length} RESTORED`:''}`;
 if(event?.type==='cocs-role-spot')return `Spot${event.targets?.length?` · ${event.targets.length} MARKED`:''}`;
 if(event?.type==='cocs-prime-start')return `Prime started${label?` · ${label}`:''}`;
 if(event?.type==='cocs-prime')return `Node primed${label?` · ${label}`:''}`;
 if(event?.type==='cocs-prime-interrupt')return `Prime interrupted${label?` · ${label}`:''}`;
 if(event?.type?.startsWith('cocs-terminal-'))return `Terminal ${event.type.slice('cocs-terminal-'.length)} complete`;
 return null;
}

// Presentation-only transition detection for the LATTICE world markers. The
// authoritative events (`cocs-capture`, `cocs-depot-capture`) carry ids but no
// positions, so the view compares the marker state it drew last frame against
// this frame and sparks the difference. Pure and allocation-light: no RNG, no
// timers, and the returned `next` map is the only state the caller keeps.
const markerPoint = (source, radius) => ({
 x: Number(source?.x) || 0,
 y: Number(source?.y) || 0,
 z: Number(source?.z) || 0,
 radius: Math.max(2.5, Math.min(14, Number(radius ?? source?.r ?? source?.radius) || 6)),
});

export function latticePresentationChanges(previous, { nodes = [], depots = [], devices = [] } = {}) {
 const before = previous && typeof previous === 'object' ? previous : {};
 const next = {}, captures = [];
 for (const node of nodes) {
  if (!node || node.id === undefined || node.id === null) continue;
  const key = `node:${node.id}`;
  const owner = node.owner === 0 || node.owner === 1 ? node.owner : null;
  const state = { owner, ...markerPoint(node) };
  next[key] = state;
  const was = before[key];
  if (was && was.owner !== owner) captures.push({ ...state, lost: owner === null });
 }
 for (const depot of depots) {
  if (!depot || depot.id === undefined || depot.id === null) continue;
  const key = `depot:${depot.id}`;
  const owner = depot.owner === 0 || depot.owner === 1 ? depot.owner : null;
  const state = { owner, ...markerPoint(depot, 4) };
  next[key] = state;
  const was = before[key];
  if (was && was.owner !== owner) captures.push({ ...state, lost: owner === null, depot: true });
 }
 const deviceChanges = [];
 for (const device of devices) {
  if (!device || device.id === undefined || device.id === null) continue;
  const key = `device:${device.id}`;
  const state = String(device.state ?? 'live');
  next[key] = { state, ...markerPoint(device, 2.2) };
  const was = before[key];
  if (was && was.state !== state) deviceChanges.push({ from: was.state, to: state, ...markerPoint(device, 2.2) });
 }
 return { next, captures, deviceChanges };
}
