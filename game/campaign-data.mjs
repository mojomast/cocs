// Single-player campaign missions. Each mission reuses an existing arena and the
// shared bot brain, layering a scripted timeline of NPC deployments, objective
// changes and win/lose conditions on top. Zones are snapped to the map's
// navigation graph at runtime, so coordinates only need to be roughly in-bounds.
//
// Script event fields:
//   id        unique string
//   at        fire when match.time reaches this many seconds
//   after     fire this many seconds after the previous event (or mission start)
//   when      fire on a condition: 'cleared' | 'boss-dead' | 'enemiesAtMost:N' | 'player-in-zone'
//   announce  show a mission message
//   objective replace the objective text
//   spawn     deploy enemy NPCs: {count, elite?, boss?, character?, harness?, x?, z?}
//   ally      deploy friendly NPCs (same shape)
//   win/lose  end the mission immediately
//   lives     change remaining player lives
export const CAMPAIGN_MISSIONS = Object.freeze([
 {
  id:'boot-camp',name:'Boot Camp',mapId:'colosseum',tag:'TRAINING',
  brief:'A cluster of rogue tokens has gone hostile on the arena floor. Clear them out and get a feel for live fire.',
  objective:'Eliminate all hostile tokens.',
  lives:2,
  enemies:{count:5},
  win:{kind:'eliminate'},
  script:[
   {id:'brief',at:1,announce:'Weapons free. Contacts on the floor.'},
   {id:'mid',when:'enemiesAtMost:3',announce:'Half of them are down. Keep pushing.'},
   {id:'done',when:'cleared',announce:'Floor secure. Welcome to the Colosseum.'},
  ],
 },
 {
  id:'reinforce',name:'Reinforcements',mapId:'substation',tag:'SURVIVAL',
  brief:'Hold the substation against a swarm that only grows. There is no retreat and nowhere to reload but here.',
  objective:'Survive the assault for 75 seconds.',
  lives:2,
  enemies:{count:4},
  win:{kind:'survive',seconds:75},
  script:[
   {id:'a',at:15,spawn:{count:4},announce:'Second wave through the doors.'},
   {id:'b',at:40,spawn:{count:5,elite:true},announce:'Heavy units deployed. Hold the line.'},
   {id:'c',at:70,announce:'Thirty seconds. Do not break now.'},
  ],
 },
 {
  id:'high-value-target',name:'High Value Target',mapId:'catacombs',tag:'ELIMINATION',
  brief:'A Warden-class token is sheltering deep in the catacombs. Its guard will not negotiate.',
  objective:'Eliminate the Warden.',
  lives:2,
  enemies:{count:7},
  win:{kind:'assassinate'},
  script:[
   {id:'vip',at:1,spawn:{count:1,boss:true},announce:'WARDEN signature detected.'},
   {id:'guard',at:20,spawn:{count:4},announce:'Guard patrol inbound.'},
  ],
 },
 {
  id:'hold-the-line',name:'Hold The Line',mapId:'foundry',tag:'DEFENSE',
  brief:'Plant yourself on the foundry core. If the enemy takes it, the line collapses.',
  objective:'Hold the core for 45 seconds.',
  lives:2,
  enemies:{count:6},
  win:{kind:'defend',seconds:45,x:0,z:0,radius:7},
  script:[
   {id:'a',at:14,spawn:{count:5},announce:'Push from the east.'},
   {id:'b',at:30,spawn:{count:6,elite:true},announce:'They want this core badly.'},
  ],
 },
 {
  id:'extraction',name:'Extraction',mapId:'frost-gate',tag:'ESCORT',
  brief:'Clear the ridge, then fall back to the extraction beacon before the second wave lands on your head.',
  objective:'Clear the ridge.',
  lives:2,
  enemies:{count:6},
  win:{kind:'reach',x:0,z:0,radius:6,requireCleared:true},
  script:[
   {id:'push',when:'cleared',objective:'Reach the extraction beacon.',spawn:{count:5,elite:true},announce:'LZ is hot — fall back to the beacon.'},
   {id:'in',when:'player-in-zone',announce:'Extraction inbound. Hold position.'},
  ],
 },
 {
  id:'last-stand',name:'Last Stand',mapId:'titan-valley',tag:'FINALE',
  brief:'The whole cluster is coming, and the Warden is leading them. Break the assault and the head that drives it.',
  objective:'Destroy the hostile cluster.',
  lives:3,
  enemies:{count:8,elite:true},
  win:{kind:'eliminate'},
  script:[
   {id:'w1',at:25,spawn:{count:6},announce:'Reinforcements on the horizon.'},
   {id:'vip',at:45,spawn:{count:1,boss:true},announce:'WARDEN online.'},
   {id:'w2',at:80,spawn:{count:8,elite:true},announce:'Final push. Break them.'},
  ],
 },
]);
export const CAMPAIGN_MISSION_IDS = CAMPAIGN_MISSIONS.map(mission => mission.id);
export const DEFAULT_MISSION_ID = CAMPAIGN_MISSIONS[0].id;
export const missionFor = id => CAMPAIGN_MISSIONS.find(mission => mission.id === id) || CAMPAIGN_MISSIONS[0];
