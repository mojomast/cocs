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
});

// Bounded per-HQ state for the periodic `director-hq-damage` warning. The
// stream emits one event every 30 ticks whenever the siege health moves, so the
// raw cue would chatter: the first hit in a siege is the edge, repeats while the
// health keeps falling re-arm at most once per loop window, and a repair (or a
// quiet tick) stays silent and re-arms the next hit immediately.
export const HQ_DAMAGE_LOOP=3;
export function createLatticeAudioState(){return {hq:new Map()};}
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

export function latticeSoundCue(event,player,state=null){
 if(!event||!player)return null;
 if(event.type==='cocs-capture'||event.type==='cocs-depot-capture')return event.team===player.team?cues.secured:cues.lost;
 if(event.type==='cocs-device-use'){
  if(event.actor!==player.id)return null;
  return event.kind==='zipline'?cues.zipline:event.kind==='teleporter'?cues.teleporter:cues.launch;
 }
 if(event.type==='cocs-terminal-vault')return event.team===player.team?cues.vault:null;
 if(['cocs-terminal-hack','cocs-terminal-deploy','cocs-terminal-sabotage'].includes(event.type))return event.team===player.team?cues.terminal:null;
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
 const label=String(event?.node??event?.depot??'').replace(/-/g,' ').toUpperCase();
 if(event?.type==='cocs-capture')return `Node captured · ${label}`;
 if(event?.type==='cocs-depot-capture')return `Depot captured · ${label}`;
 if(event?.type==='cocs-device-use')return `Route engaged · ${String(event.kind??'device').replace(/-/g,' ')}`;
 if(event?.type==='director-wave')return `Director wave ${event.wave} approaching`;
 if(event?.type==='director-wave-cleared')return `Wave ${event.wave} cleared`;
 if(event?.type==='director-siege')return 'HQ UNDER SIEGE · FALL BACK';
 if(event?.type==='director-siege-lifted')return 'HQ siege lifted';
 if(event?.type==='cocs-order-complete')return `Order complete · ${String(event.verb??'').toUpperCase()}`.trim();
 if(event?.type==='cocs-order-rejected')return `Order rejected · ${String(event.verb??'').toUpperCase()}`.trim();
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

