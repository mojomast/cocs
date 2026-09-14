import {MAPS} from './maps.mjs';
import {GAME_MODES,modeRule} from './config.mjs';

export const ARENA_GROUPS=[
 {id:'arena',name:'Arena',description:'Compact classic combat arenas. Legacy rotation.'},
 {id:'urban',name:'Urban',description:'Dense city blocks with jump pads, ziplines and rooftops.'},
 {id:'indoor',name:'Indoor',description:'Enclosed facilities and station interiors.'},
 {id:'outdoor',name:'Outdoor',description:'Open terrain, canyons and plateaus.'},
 {id:'island',name:'Island',description:'Floating routes across a lethal void.'},
 {id:'vehicle',name:'Vehicle',description:'Armour-friendly ground battlefields.'},
 {id:'combined',name:'Combined Arms',description:'The largest battlefields: infantry, armour and aircraft.'},
];
export const ARENA_SCALES={skirmish:{bots:3,label:'Skirmish'},battle:{bots:7,label:'Battle'},warzone:{bots:11,label:'Warzone'}};
export const DEFAULT_MAX_BOTS=8;

const AUTHOR={
 'puma-circuit':{group:'vehicle',scale:'battle',play:['puma-race']},
 'puma-pitch':{group:'vehicle',scale:'battle',play:['puma-soccer']},
 exchange:{group:'arena',legacy:true,scale:'skirmish',play:['deathmatch','teamdeathmatch','instagib','rockets','arsenal','armsrace','koth','domination']},
 crosswire:{group:'arena',legacy:true,scale:'skirmish',play:['deathmatch','teamdeathmatch','instagib','rockets','arsenal','armsrace','koth','domination']},
 foundry:{group:'arena',legacy:true,scale:'skirmish',play:['deathmatch','teamdeathmatch','instagib','rockets','arsenal','armsrace','koth','domination']},
 launchpad:{group:'arena',legacy:true,scale:'battle',play:['ctf','teamdeathmatch','deathmatch','koth','domination','arsenal','payload']},
 citadel:{group:'arena',legacy:true,scale:'battle',play:['ctf','teamdeathmatch','deathmatch','koth','domination','arsenal','payload']},
 'blood-gulch':{group:'outdoor',legacy:true,scale:'battle',play:['ctf','teamdeathmatch','deathmatch','koth','domination','combined-arms','payload']},
 skybreak:{group:'island',scale:'battle',play:['ctf','teamdeathmatch','deathmatch','koth','domination']},
 aether:{group:'island',scale:'battle',play:['ctf','teamdeathmatch','deathmatch','koth','domination']},
 'sunscar-canyon':{group:'outdoor',scale:'battle',play:['ctf','teamdeathmatch','deathmatch','koth','domination','payload']},
 // Launcher-connected islands have no continuous ground route for a payload.
 'ironfall-megastructure':{group:'outdoor',scale:'warzone',play:['ctf','teamdeathmatch','deathmatch','koth','domination','combined-arms']},
 'longreach-plateau':{group:'outdoor',scale:'warzone',play:['ctf','teamdeathmatch','deathmatch','koth','domination','combined-arms']},
 frostline:{group:'outdoor',scale:'warzone',play:['ctf','teamdeathmatch','deathmatch','koth','domination','combined-arms','payload']},
 'derelict-station':{group:'indoor',scale:'warzone',play:['ctf','teamdeathmatch','deathmatch','koth','domination','payload']},
 'ashen-rift':{group:'outdoor',scale:'warzone',play:['ctf','teamdeathmatch','deathmatch','koth','domination','combined-arms','payload']},
 'neon-vertical':{group:'urban',scale:'battle',play:['deathmatch','teamdeathmatch','instagib','rockets','arsenal','koth','domination','ctf','payload']},
 substation:{group:'indoor',scale:'battle',play:['deathmatch','teamdeathmatch','instagib','rockets','arsenal','koth','domination','ctf','payload']},
 warfront:{group:'combined',scale:'warzone',play:['combined-arms','ctf','teamdeathmatch','deathmatch','koth','domination','arsenal','payload']},
 'skyfall-basin':{group:'combined',scale:'warzone',play:['combined-arms','ctf','teamdeathmatch','koth','domination','arsenal','payload']},
 trenchline:{group:'combined',scale:'warzone',play:['combined-arms','assault','ctf','teamdeathmatch','deathmatch','koth','domination','arsenal','payload']},
 'signal-ridge':{group:'combined',scale:'warzone',play:['combined-arms','assault','ctf','teamdeathmatch','koth','domination','arsenal','payload']},
 rampart:{group:'urban',scale:'battle',play:['assault','deathmatch','teamdeathmatch','instagib','rockets','arsenal','koth','domination']},
 'catwalk-breach':{group:'urban',scale:'battle',play:['assault','deathmatch','teamdeathmatch','instagib','rockets','arsenal','koth','domination']},
 // Next-generation procedural maps (levelgen.mjs). One per mode.
 colosseum:{group:'arena',scale:'battle',play:['deathmatch','teamdeathmatch','instagib','rockets','arsenal','armsrace','koth','domination']},
 'frost-gate':{group:'outdoor',scale:'warzone',play:['ctf','teamdeathmatch','deathmatch','koth','domination','arsenal','payload']},
 'sunken-hill':{group:'outdoor',scale:'battle',play:['koth','domination','deathmatch','teamdeathmatch','ctf','payload']},
 riverbend:{group:'urban',scale:'warzone',play:['domination','koth','deathmatch','teamdeathmatch','arsenal','payload']},
 fortress:{group:'indoor',scale:'warzone',play:['assault','deathmatch','teamdeathmatch','koth','domination','arsenal']},
 atrium:{group:'indoor',scale:'battle',play:['teamdeathmatch','deathmatch','koth','domination','instagib','rockets','arsenal','payload']},
 catacombs:{group:'indoor',scale:'battle',play:['instagib','rockets','deathmatch','teamdeathmatch','arsenal','koth','domination']},
 slagworks:{group:'urban',scale:'battle',play:['rockets','deathmatch','teamdeathmatch','koth','domination','arsenal','instagib']},
 forge:{group:'arena',scale:'battle',play:['arsenal','armsrace','deathmatch','teamdeathmatch','koth','domination','instagib','rockets']},
 'proving-grounds':{group:'arena',scale:'skirmish',play:['armsrace','deathmatch','teamdeathmatch','instagib','rockets','arsenal','koth','domination']},
 'titan-valley':{group:'combined',scale:'warzone',play:['combined-arms','teamdeathmatch','deathmatch','koth','domination','arsenal','assault','payload']},
 'convoy-line':{group:'urban',scale:'warzone',play:['payload','combined-arms','teamdeathmatch','deathmatch','koth','domination','arsenal']},
};

const span=arena=>{
 const bounds=arena.bounds||{minX:-14,maxX:14,minZ:-14,maxZ:14};
 return Math.max(bounds.maxX-bounds.minX,bounds.maxZ-bounds.minZ);
};
const derivedGroup=arena=>arena.platforms?.length?'island':(arena.vehicles?.length?'vehicle':(arena.terrain?'outdoor':'arena'));
const derivedScale=arena=>{const width=span(arena);return width<60?'skirmish':width<140?'battle':'warzone';};

export function arenaMeta(mapOrId){
 const arena=typeof mapOrId==='string'?MAPS.find(map=>map.id===mapOrId):mapOrId;
 if(!arena)return null;
 const author=AUTHOR[arena.id]||{};
 return {id:arena.id,group:author.group??derivedGroup(arena),scale:author.scale??derivedScale(arena),legacy:author.legacy===true,play:author.play??null,scaleBots:ARENA_SCALES[author.scale??derivedScale(arena)].bots};
}
export function arenaSupportsMode(mapId,mode){const meta=arenaMeta(mapId);if(!meta)return false;if(mode==='puma-race'||mode==='puma-soccer')return meta.play?.includes(mode)===true;if(mode==='horde'||mode==='campaign')return mapId!=='puma-circuit'&&mapId!=='puma-pitch';return !meta.play||meta.play.includes(mode);}
export function maxBotsFor(mode){return modeRule(mode)?.maxBots??DEFAULT_MAX_BOTS;}
export function recommendedBots(mode,mapId){const meta=arenaMeta(mapId);const cap=maxBotsFor(mode),base=meta?.scaleBots??ARENA_SCALES.skirmish.bots;return Math.max(0,Math.min(cap,base));}
export function mapsForMode(mode,{legacy=false}={}){return MAPS.filter(map=>arenaSupportsMode(map.id,mode)&&(legacy||!arenaMeta(map.id).legacy));}
export function resolveMapForMode(mapId,mode,options={}){
 const available=mapsForMode(mode,options);
 if(!available.length)return mapId;
 return available.some(map=>map.id===mapId)?mapId:available[0].id;
}
export function activeMaps({legacy=false}={}){return legacy?[...MAPS]:MAPS.filter(map=>!arenaMeta(map.id).legacy);}
export function groupedMaps(maps=MAPS){const groups=[];for(const group of ARENA_GROUPS){const entries=maps.filter(map=>(arenaMeta(map.id).group)===group.id);if(entries.length)groups.push({...group,maps:entries});}return groups;}
export function modeMapSummary(mode,mapId){const meta=arenaMeta(mapId);const group=ARENA_GROUPS.find(entry=>entry.id===meta.group);return {mapId,group:meta.group,groupName:group?.name??'Arena',scale:meta.scale,recommendedBots:recommendedBots(mode,mapId),maxBots:maxBotsFor(mode),legacy:meta.legacy};}
export const MODE_IDS=GAME_MODES.map(mode=>mode.id);
