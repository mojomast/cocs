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
