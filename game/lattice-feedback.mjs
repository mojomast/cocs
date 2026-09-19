// Procedural objective earcons. One short motif uses one existing synth voice;
// no samples, timers or per-tick progress sounds are added.
const motif=(notes,step=.075,length=.2,gain=.065,shimmer=false)=>Object.freeze({notes:Object.freeze(notes),step,length,gain,shimmer});
const cues=Object.freeze({
 secured:motif([0,7,12],.075,.24,.075,true), lost:motif([7,3,-2],.11,.25,.06),
 terminal:motif([0,4,7,12],.04,.14,.055), vault:motif([12,7,12],.055,.2,.06),
 zipline:motif([0,2,7],.035,.12,.055), teleporter:motif([12,0,7],.035,.16,.055,true),
 launch:motif([-12,0,7],.055,.18,.065),
 wave:motif([0,-5,0],.12,.26,.07), cleared:motif([0,5,7,12],.08,.23,.07,true),
 siege:motif([0,-1,0,-1],.15,.2,.08), relieved:motif([0,7],.1,.25,.065),
});

export function latticeSoundCue(event,player){
 if(!event||!player)return null;
 if(event.type==='cocs-capture'||event.type==='cocs-depot-capture')return event.team===player.team?cues.secured:cues.lost;
 if(event.type==='cocs-device-use'){
  if(event.actor!==player.id)return null;
  return event.kind==='zipline'?cues.zipline:event.kind==='teleporter'?cues.teleporter:cues.launch;
 }
 if(event.type==='cocs-terminal-vault')return event.team===player.team?cues.vault:null;
 if(['cocs-terminal-hack','cocs-terminal-deploy','cocs-terminal-sabotage'].includes(event.type))return event.team===player.team?cues.terminal:null;
 return {'director-wave':cues.wave,'director-wave-cleared':cues.cleared,'director-siege':cues.siege,'director-siege-lifted':cues.relieved}[event.type]??null;
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

