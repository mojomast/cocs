// Linear, story-driven campaign missions. Each mission reuses a large arena,
// starts the player at an authored spot, then walks them through an ordered
// list of objectives with world waypoints, scripted enemy deployments and
// story beats. Enemy classes live in `game/enemy-types.mjs` and are referenced
// by `type`; the runtime steps `steps` in `game/singleplayer.mjs`.
//
// Step action fields:
//   story:{speaker,text}   queue a story line
//   bark:{speaker,text}    in-world NPC transmission (caption event npc-bark)
//   bossPhase:n            announce a boss phase change (caption boss-phase)
//   announce:'...'         short banner message
//   objective:'...'        replace the current objective text
//   spawn:{type,count,elite?,x?,z?,group,zone?}   deploy enemies and track the group
//   ally:{...}             deploy a friendly NPC
//   win:'...' / lose:'...' end the mission
//   checkpoint:true        mark a resumable checkpoint
//   lives:n                change remaining lives
//
// Anchored missions: anchors[name] defines floor X/Z, maxSnap and optional Y
// bounds. Runtime resolves them on the entrance's bidirectionally reachable nav
// component; markers/start/win/spawns reference {anchor:name}. halfHeight bounds
// trigger volumes around floor Y. predeploy stages onStart enemies before play,
// not when visible objectives activate. Reviewed predeploy missions must not add
// unreviewed script/onComplete spawns. checkpoints maps saved step indices to
// anchors. supply:true restores difficulty-scaled minimum reserves.
// Step completion kinds: enter-zone | group-dead | boss-dead | timer | hold
// complete.groups optionally requires additional groups cleared before progress.
// complete.requireZone gates a kill objective on its height-aware route marker.
// spawn.summons:false disables that actor's live adds in reviewed predeploy fights.
// Script/lore step:'id' gates a once-only event to the active linear step.
//
// Mission `script:[...]` events are one-shot, ordered and id-tagged. A trigger
// is one of:
//   at:seconds        elapsed mission time
//   after:seconds     seconds since the previous fired event
//   when:'cleared' | 'boss-dead' | 'player-in-zone' |
//        'enemiesAtMost:N' | 'boss-hp:<fraction>'
// and may carry any of the action fields above. `spawn.zone` (or a bare x,z)
// confines that group: `kind:'patrol'`/`'hold'` are hard leashes, `'spawn'` is
// a soft leash that only breaks to engage a nearby player.
//
// Mission `win:{kind,...}` is the runtime fallback win condition:
//   eliminate | survive:{seconds} | assassinate | reach:{x,z,radius,requireCleared?} | defend:{seconds}
export const CAMPAIGN_MISSIONS = Object.freeze([
 {
  id:'convoy-run',order:1,chapter:'ACT I',name:'The Long Haul',mapId:'convoy-line',tag:'ESCORT',
  weather:'overcast',predeploy:true,
  // Outdoor service-road floor anchors. Avoid tunnel axis, roofs and depot
  // interiors until map-family geometry review. Y is resolved from navigation.
  anchors:{
   entrance:{x:-66,z:-12,minY:-2,maxY:4,maxSnap:3},
   'approach.depot':{x:-54,z:-12,minY:-2,maxY:4,maxSnap:3},
   'encounter.opening':{x:-48,z:-12,minY:-2,maxY:4,maxSnap:3},
   'encounter.tenements':{x:-30,z:-10,minY:-2,maxY:4,maxSnap:4},
   'encounter.bridge':{x:0,z:12,minY:-2,maxY:4,maxSnap:3},
   'checkpoint.roadblock':{x:12,z:12,minY:-2,maxY:4,maxSnap:3},
   'encounter.roadblock':{x:34,z:10,minY:-2,maxY:4,maxSnap:4},
   'encounter.yard':{x:54,z:12,minY:-2,maxY:4,maxSnap:3},
   exit:{x:54,z:12,minY:-2,maxY:4,maxSnap:3},
  },
  checkpoints:{3:'checkpoint.roadblock',5:'exit'},
  brief:'Relay seven has gone dark. Run the only road east and light it before the cluster closes in.',
  objective:'Rally at the west depot.',
  lives:3,
  start:{anchor:'entrance',x:-66,z:-12,yaw:-1.5708},
  win:{kind:'reach',anchor:'exit',radius:5,halfHeight:1.5,requireCleared:true,label:'RELAY'},
  intro:{speaker:'DISPATCH',lines:['Relay seven is dark.','Use the open service road. The tunnel and rooftops are not the route. Defenders are already dug in.']},
  outro:{speaker:'RELAY',lines:['Relay seven online.','Something big is crossing Titan Valley.']},
  script:[
   {id:'convoy-reinforce-1',step:'rally',at:6,bark:{speaker:'DISPATCH',text:'Depot patrol ahead. Clear your approach before moving east.'}},
   {id:'convoy-ambush-cleared',step:'tenements',at:0,bark:{speaker:'RELAY',text:'Roadblock on the open lane. Do not chase contacts into the tenements.'}},
   {id:'convoy-bridge-ambush',step:'bridge',when:'player-in-zone',anchor:'encounter.bridge',radius:7,halfHeight:1.5,weather:'rain',bark:{speaker:'DISPATCH',text:'Hold the service-road crossing. Supplies follow.'}},
   {id:'convoy-yard-phase2',step:'yard',when:'boss-hp:0.6',bossPhase:2,name:'UNSHACKLED',bark:{speaker:'WARDEN',text:'You should have stayed on the road!'}},
   {id:'convoy-yard-phase3',step:'yard',when:'boss-hp:0.3',bossPhase:3,name:'LEGION',bark:{speaker:'WARDEN',text:'The cluster knows your name now.'}},
   {id:'convoy-relay-online',step:'yard',when:'boss-dead',objective:'Clear the remaining yard guards.',announce:'Yardmaster down. Clear the guards.'},
  ],
  steps:[
   {id:'rally',stage:'approach',label:'WEST DEPOT',text:'Rally outside the west depot',detail:'Follow the southern apron, not the sealed building.',marker:{anchor:'approach.depot',radius:4,halfHeight:1.5,label:'DEPOT'},
    onStart:[{story:{speaker:'DISPATCH',text:'Service road ahead. Clear the patrol before the tenement lane.'}},{spawn:{type:'husk',count:2,group:'opening',anchor:'encounter.opening',radius:6,hold:true}}],
    complete:{kind:'enter-zone'},onComplete:[{objective:'Clear the tenement roadblock.'}]},
   {id:'tenements',stage:'encounter',label:'TENEMENTS',text:'Clear the tenement roadblock',detail:'Fight on the open lane. Clear the depot patrol too.',marker:{anchor:'encounter.tenements',radius:6,halfHeight:1.5,label:'TENEMENTS'},
    onStart:[{spawn:{type:'husk',count:3,group:'tenements',anchor:'encounter.tenements',radius:8,hold:true}},{spawn:{type:'spitter',count:2,group:'tenements',anchor:'encounter.tenements',radius:8,hold:true}}],
    complete:{kind:'group-dead',group:'tenements',groups:['opening']},
    onComplete:[{objective:'Hold the service-road crossing.'},{story:{speaker:'DISPATCH',text:'Roadblock clear. Cross south of the tunnel and hold the open road.'}}]},
   {id:'bridge',stage:'encounter',label:'SERVICE CROSSING',text:'Hold the service-road crossing',detail:'Clear its guards, then hold for 20 seconds. Recovery follows.',marker:{anchor:'encounter.bridge',radius:7,halfHeight:1.5,label:'CROSSING'},
    onStart:[{spawn:{type:'husk',count:3,group:'bridge',anchor:'encounter.bridge',radius:9,hold:true}},{spawn:{type:'spitter',count:2,group:'bridge',anchor:'encounter.bridge',radius:9,hold:true}}],
    complete:{kind:'hold',seconds:20,groups:['bridge']},
    onComplete:[{objective:'Recover supplies, then break the east roadblock.'},{supply:true},{story:{speaker:'DISPATCH',text:'Crossing secure. Supplies restored. Checkpoint is on the east approach; take a breath before the next push.'}},{checkpoint:true}]},
   {id:'roadblock',stage:'recovery-approach',label:'EAST ROADBLOCK',text:'Break the east roadblock',detail:'Checkpoint and recovery are behind you on the open approach.',marker:{anchor:'encounter.roadblock',radius:6,halfHeight:1.5,label:'ROADBLOCK'},
    onStart:[{spawn:{type:'husk',count:3,group:'roadblock',anchor:'encounter.roadblock',radius:8,hold:true}},{spawn:{type:'brute',count:1,group:'roadblock',anchor:'encounter.roadblock',radius:8,hold:true}}],
    complete:{kind:'group-dead',group:'roadblock'},
    onComplete:[{objective:'Secure the outer fuel yard.'},{story:{speaker:'RELAY',text:'The Yardmaster and guards hold the outside apron. No need to enter the sealed depot.'}}]},
   {id:'yard',stage:'encounter',label:'FUEL YARD',text:'Secure the outer fuel yard',detail:'Kill the Yardmaster and its guards on the open apron.',marker:{anchor:'encounter.yard',radius:7,halfHeight:1.5,label:'YARD'},
    onStart:[{spawn:{type:'warden',count:1,group:'yard',anchor:'encounter.yard',radius:8,hold:true}},{spawn:{type:'brute',count:2,group:'yard',anchor:'encounter.yard',radius:8,hold:true}}],
    complete:{kind:'group-dead',group:'yard'},
    onComplete:[{checkpoint:true},{win:'Relay seven online.'}]},
  ],
 },
 {
  id:'reactor-run',order:2,chapter:'ACT I',name:'Reactor Run',mapId:'titan-valley',tag:'ASSAULT',
  weather:'ash',predeploy:true,
  // Base aprons and the real north cavern floor; no roof-height objectives.
  anchors:{
   entrance:{x:-60,z:-18,minY:6,maxY:9,maxSnap:3},
   'encounter.outpost':{x:-28,z:-20,minY:5,maxY:8,maxSnap:3},
   'encounter.reactor':{x:0,z:12,minY:4,maxY:8,maxSnap:3},
   'checkpoint.cavern':{x:0,z:12,minY:4,maxY:8,maxSnap:3},
   'encounter.cavern':{x:0,z:-30,minY:5,maxY:7,maxSnap:3},
   'encounter.south':{x:28,z:20,minY:4,maxY:8,maxSnap:3},
   'encounter.warden':{x:46,z:0,minY:4,maxY:7,maxSnap:3},
   exit:{x:46,z:0,minY:4,maxY:7,maxSnap:3},
  },
  checkpoints:{2:'checkpoint.cavern',5:'exit'},
  brief:'The cluster is massing around the Titan Valley reactor. Cross the ridge, take the core, and end the Warden.',
  objective:'Secure the west outpost.',
  lives:3,
  start:{anchor:'entrance',x:-60,z:-18,yaw:-1.5708},
  win:{kind:'reach',anchor:'exit',radius:8,halfHeight:1.5,requireCleared:true},
  intro:{speaker:'DISPATCH',lines:[
   'Sweep says the cluster is massing on the reactor line.',
   'Take the valley piece by piece. The Warden holds the east base.',
  ]},
  outro:{speaker:'WARDEN',lines:['You think this is the cluster?','I am one node. We are already inside your relay.']},
  script:[
   {id:'reactor-reinforce-1',step:'outpost',at:8,bark:{speaker:'DISPATCH',text:'Outpost guard just went active — break them fast.'}},
   {id:'reactor-cavern-ambush',step:'cavern',when:'player-in-zone',anchor:'encounter.cavern',radius:9,halfHeight:1.5,bark:{speaker:'RELAY',text:'Contact in the cavern — they use the dark.'}},
   {id:'reactor-low-count',step:'reactor',at:0,bark:{speaker:'WARDEN',text:'I see you, operator.'}},
   {id:'reactor-warden-phase2',step:'warden',when:'boss-hp:0.5',bossPhase:2,name:'OVERCLOCKED',bark:{speaker:'WARDEN',text:'Then let the cluster burn with me!'}},
   {id:'reactor-warden-phase3',step:'warden',when:'boss-hp:0.2',bossPhase:3,name:'LEGION',weather:'storm',bark:{speaker:'WARDEN',text:'We are one node. We are legion.'}},
  ],
  steps:[
   {id:'outpost',label:'WEST OUTPOST',text:'Secure the west outpost',detail:'Clear the ridge.',marker:{anchor:'encounter.outpost',halfHeight:1.5,radius:6,label:'OUTPOST'},
    onStart:[{story:{speaker:'DISPATCH',text:'Eyes on the outpost. Clear it.'}},{spawn:{type:'spitter',count:4,group:'outpost',anchor:'encounter.outpost',radius:9,hold:true}},{spawn:{type:'husk',count:3,group:'outpost',anchor:'encounter.outpost',radius:9,hold:true}}],
    complete:{kind:'group-dead',requireZone:true,group:'outpost'},
    onComplete:[{objective:'Take the central reactor.'},{story:{speaker:'DISPATCH',text:'Outpost clear. Reactor is dead ahead.'}}]},
   {id:'reactor',label:'REACTOR',text:'Take the central reactor',detail:'Secure the south reactor apron; the tunnel is not the objective.',marker:{anchor:'encounter.reactor',halfHeight:1.5,radius:7,label:'REACTOR'},
    onStart:[{spawn:{type:'brute',count:2,group:'reactor',anchor:'encounter.reactor',radius:12,hold:true}},{spawn:{type:'spitter',count:4,group:'reactor',anchor:'encounter.reactor',radius:12,hold:true}},{spawn:{type:'husk',count:4,group:'reactor',anchor:'encounter.reactor',radius:12,hold:true}}],
    complete:{kind:'group-dead',requireZone:true,group:'reactor'},
    onComplete:[{objective:'Hold the north cavern.'},{story:{speaker:'DISPATCH',text:'Reactor ours. Contacts pouring out of the north cavern — dig in.'}},{supply:true},{checkpoint:true}]},
   {id:'cavern',label:'NORTH CAVERN',text:'Hold the north cavern',detail:'Clear the cavern defenders, then hold for 25 seconds.',marker:{anchor:'encounter.cavern',halfHeight:1.5,radius:9,label:'CAVERN'},
    onStart:[{spawn:{type:'husk',count:6,group:'cavernA',anchor:'encounter.cavern',radius:9,hold:true}},{spawn:{type:'spitter',count:3,group:'cavernA',anchor:'encounter.cavern',radius:9,hold:true}}],
    complete:{kind:'hold',seconds:25,groups:['cavernA']},
    onComplete:[{objective:'Secure the south outpost.'},{story:{speaker:'DISPATCH',text:'Ambush broken. South outpost is exposed — hit it now.'}}]},
   {id:'south',label:'SOUTH OUTPOST',text:'Secure the south outpost',detail:'Flank and clear.',marker:{anchor:'encounter.south',halfHeight:1.5,radius:6,label:'OUTPOST'},
    onStart:[{spawn:{type:'brute',count:1,group:'south',anchor:'encounter.south',radius:9,hold:true}},{spawn:{type:'spitter',count:4,group:'south',elite:true,anchor:'encounter.south',radius:9,hold:true}}],
    complete:{kind:'group-dead',requireZone:true,group:'south'},
    onComplete:[{objective:'Assault the east base. Kill the Warden.'},{story:{speaker:'DISPATCH',text:'Last push. The Warden holds the east base forecourt.'}}]},
   {id:'warden',label:'EAST BASE',text:'Kill the Warden',detail:'Clear the boss and guards outside the east base.',marker:{anchor:'encounter.warden',halfHeight:1.5,radius:8,label:'WARDEN'},
    onStart:[{spawn:{type:'warden',count:1,group:'warden',anchor:'encounter.warden',radius:9,hold:true}},{spawn:{type:'brute',count:3,group:'warden',elite:true,anchor:'encounter.warden',radius:9,hold:true}}],
    complete:{kind:'group-dead',requireZone:true,group:'warden'},
    onComplete:[{checkpoint:true},{win:'The Warden falls.'}]},
  ],
 },
 {
  id:'throne-siege',order:3,chapter:'ACT II',name:'The Broken Throne',mapId:'throne',tag:'FINALE',
  weather:'storm',predeploy:true,
  anchors:{
   'entrance':{x:0,z:42,minY:0,maxY:2,maxSnap:3},
   'encounter.approach':{x:0,z:30,minY:0,maxY:2,maxSnap:3},
   'encounter.breach':{x:0,z:12,minY:0,maxY:2,maxSnap:3},
   'checkpoint.midfield':{x:0,z:24,minY:0,maxY:2,maxSnap:3},
   'encounter.midfield':{x:0,z:-12,minY:0,maxY:2,maxSnap:3},
   'checkpoint.warden':{x:0,z:-12,minY:0,maxY:2,maxSnap:3},
   'encounter.warden':{x:0,z:0,minY:0,maxY:2,maxSnap:3},
   'checkpoint.throne':{x:0,z:-12,minY:0,maxY:2,maxSnap:3},
   'encounter.throne':{x:12,z:-24,minY:0,maxY:2,maxSnap:3},
   'objective.throne':{x:0,z:0,minY:0,maxY:2,maxSnap:3},
  },
  checkpoints:{2:'checkpoint.midfield',3:'checkpoint.warden',4:'checkpoint.throne'},
  brief:'The cluster\'s last node is enthroned at the centre of the arena. Break the ring, survive the pit, and end the Warden on the throne.',
  objective:'Reach the outer ring.',
  lives:3,
  start:{anchor:'entrance',x:0,z:42,yaw:0},
  win:{kind:'defend',anchor:'objective.throne',halfHeight:1.5,radius:5,seconds:22,label:'THRONE'},
  intro:{speaker:'DISPATCH',lines:[
   'This is the last node. The Warden is sitting on it.',
   'Break the outer ring, hold the pit, and put the crown in the dirt.',
  ]},
  outro:{speaker:'DISPATCH',lines:['Throne is dark. The cluster has no voice left.','Good hunting, operator. Come home.']},
  script:[
   {id:'throne-outer-1',step:'approach',at:5,bark:{speaker:'DISPATCH',text:'Outer ring is awake — husks on the steps.'}},
   {id:'throne-ambush',step:'breach',when:'player-in-zone',anchor:'encounter.breach',radius:6,halfHeight:1.5,bark:{speaker:'WARDEN',text:'You climbed all this way to kneel?'}},
   {id:'throne-artillery',step:'midfield',at:0,bark:{speaker:'DISPATCH',text:'Siege battery on the pit floor — do not stand still.'}},
   {id:'throne-phase2',step:'warden',when:'boss-hp:0.6',bossPhase:2,name:'THE CROWN STIRS',bark:{speaker:'WARDEN',text:'The throne answers only blood.'}},
   {id:'throne-phase3',step:'warden',when:'boss-hp:0.25',bossPhase:3,name:'LEGION FINAL',bark:{speaker:'WARDEN',text:'We are the last node of the cluster.'}},
   {id:'throne-crown-cracks',step:'warden',when:'boss-hp:0.1',bark:{speaker:'WARDEN',text:'Then the throne takes you with it.'},announce:'The Warden is breaking — finish it.'},
   {id:'throne-message',step:'warden',when:'boss-dead',objective:'The Warden falls — hold the throne.',announce:'The Warden falls.'},
  ],
  steps:[
   {id:'approach',label:'SOUTH APPROACH',text:'Reach the outer ring',detail:'Push north toward the throne.',marker:{anchor:'encounter.approach',halfHeight:1.5,radius:6,label:'APPROACH'},
    onStart:[{story:{speaker:'DISPATCH',text:'Throne is the last node. The Warden is waiting.'}},{spawn:{type:'husk',count:3,group:'approach',anchor:'encounter.approach',radius:9,hold:true}},{spawn:{type:'spitter',count:1,group:'approach',anchor:'encounter.approach',radius:9,hold:true}}],
    complete:{kind:'enter-zone'},
    onComplete:[{objective:'Break the outer ring.'},{story:{speaker:'DISPATCH',text:'Outer ring ahead. Clear the steps.'}}]},
   {id:'breach',label:'OUTER RING',text:'Break the outer ring',detail:'Husks rush; spitters cover.',marker:{anchor:'encounter.breach',halfHeight:1.5,radius:6,label:'OUTER RING'},
    onStart:[{spawn:{type:'husk',count:5,group:'breach',anchor:'encounter.breach',radius:9,hold:true}},{spawn:{type:'spitter',count:2,group:'breach',anchor:'encounter.breach',radius:9,hold:true}},{spawn:{type:'brute',count:1,group:'breach',elite:true,anchor:'encounter.breach',radius:9,hold:true}}],
    complete:{kind:'group-dead',requireZone:true,group:'breach',groups:['approach']},
    onComplete:[{objective:'Hold the pit.'},{story:{speaker:'WARDEN',text:'You are already inside my range.'}},{supply:true},{checkpoint:true}]},
   {id:'midfield',label:'THE PIT',text:'Hold the pit',detail:'Clear the pit defenders, then hold for 18 seconds.',marker:{anchor:'encounter.midfield',halfHeight:1.5,radius:6,label:'THE PIT'},
    onStart:[{spawn:{type:'husk',count:6,group:'midfield',anchor:'encounter.midfield',radius:9,hold:true}},{spawn:{type:'mortar',count:1,group:'midfield',anchor:'encounter.midfield',radius:9,hold:true}}],
    complete:{kind:'hold',seconds:18,groups:['midfield']},
    onComplete:[{objective:'Kill the Warden.'},{story:{speaker:'DISPATCH',text:'Pit held. The Warden is on the throne.'}},{supply:true},{checkpoint:true}]},
   {id:'warden',label:'THE WARDEN',text:'Kill the Warden',detail:'Boss fight — use the cover.',marker:{anchor:'encounter.warden',halfHeight:1.5,radius:8,label:'WARDEN'},
    onStart:[{spawn:{type:'warden',count:1,group:'warden',anchor:'encounter.warden',radius:9,hold:true}},{spawn:{type:'brute',count:2,group:'warden',elite:true,anchor:'encounter.warden',radius:9,hold:true}}],
    complete:{kind:'group-dead',requireZone:true,group:'warden'},
    onComplete:[{objective:'Hold the throne.'},{story:{speaker:'DISPATCH',text:'Warden down. Lock the throne before the cluster answers.'}},{supply:true},{checkpoint:true}]},
   {id:'throne',label:'HOLD THE THRONE',text:'Hold the throne',detail:'Clear the northeast reserve, then hold the central floor for 25 seconds.',marker:{anchor:'objective.throne',halfHeight:1.5,radius:6,label:'THRONE'},
    onStart:[{spawn:{type:'bulwark',count:1,group:'throne',elite:true,anchor:'encounter.throne',radius:9,hold:true}},{spawn:{type:'mortar',count:2,group:'throne',anchor:'encounter.throne',radius:9,hold:true}},{spawn:{type:'husk',count:6,group:'throne',anchor:'encounter.throne',radius:9,hold:true}}],
    complete:{kind:'hold',seconds:25,groups:['throne']},
    onComplete:[{win:'The throne is held.'}]},
  ],
 },
 {
  id:'ghost-wire',order:4,chapter:'ACT II',name:'Ghost Wire',mapId:'frost-gate',tag:'STEALTH',
  weather:'snow',predeploy:true,
  anchors:{
   'entrance':{x:-50,z:-24,minY:2.5,maxY:6.5,maxSnap:3},
   'encounter.drop':{x:-48,z:-30,minY:2.5,maxY:6.5,maxSnap:3},
   'encounter.ridge':{x:-14,z:-26,minY:2.5,maxY:6.5,maxSnap:3},
   'checkpoint.slice':{x:-14,z:-26,minY:2.5,maxY:6.5,maxSnap:3},
   'encounter.slice':{x:0,z:0,minY:2.5,maxY:6.5,maxSnap:3},
   'checkpoint.exfil':{x:0,z:0,minY:2.5,maxY:6.5,maxSnap:3},
   'encounter.exfil':{x:34,z:18,minY:2.5,maxY:6.5,maxSnap:3},
   'exit':{x:46,z:24,minY:2.5,maxY:6.5,maxSnap:3},
  },
  checkpoints:{2:'checkpoint.slice',3:'checkpoint.exfil'},
  brief:'A listening post on the frozen ridge is selling our convoy routes to the cluster. Slip the patrols, slice the relay, and leave without the fight you cannot win.',
  objective:'Infiltrate the ridge depot.',
  lives:3,
  start:{anchor:'entrance',x:-50,z:-24,yaw:.6},
  win:{kind:'reach',anchor:'exit',halfHeight:1.5,radius:9,requireCleared:false,label:'EXFIL'},
  intro:{speaker:'DISPATCH',lines:[
   'No grenades, no heroics. The ridge is crawling with patrols.',
   'Get to the relay, pull the intel, and get off the ice. Quiet is a weapon.',
  ]},
  outro:{speaker:'RELAY',lines:['Wire is dark. They will not see us coming.','Good work, ghost. Come home cold.']},
  script:[
   {id:'ghost-patrol-north',step:'ridge',at:7,bark:{speaker:'DISPATCH',text:'Patrol on the north ridge — stay wide of their positions.'}},
   {id:'ghost-ambush',step:'ridge',when:'player-in-zone',anchor:'encounter.ridge',radius:6,halfHeight:1.5,bark:{speaker:'RELAY',text:'Shield-bearer on the ridge line. Do not trade with it.'}},
   {id:'ghost-response',step:'exfil',at:0,bark:{speaker:'DISPATCH',text:'They heard the splice. Move!'}},
   {id:'ghost-exfil',step:'exfil',when:'player-in-zone',anchor:'exit',radius:7,halfHeight:1.5,objective:'Exfiltrate east — do not look back.',announce:'Relay sliced. Exfil.'},
  ],
  steps:[
   {id:'drop',label:'RIDGE DROP',text:'Infiltrate the ridge depot',detail:'Stay wide of the patrol lanes.',marker:{anchor:'encounter.drop',halfHeight:1.5,radius:4,label:'DROP'},
    onStart:[{story:{speaker:'DISPATCH',text:'Cold drop. The depot is along the ridge.'}},{spawn:{type:'husk',count:2,group:'drop',anchor:'encounter.drop',radius:9,hold:true}}],
    complete:{kind:'enter-zone'},
    onComplete:[{objective:'Cross the north ridge unnoticed.'},{story:{speaker:'RELAY',text:'North ridge crossed. The relay is next. Keep low.'}}]},
   {id:'ridge',label:'NORTH RIDGE',text:'Cross the north ridge',detail:'Avoid the patrol; you do not need the kill.',marker:{anchor:'encounter.ridge',halfHeight:1.5,radius:6,label:'RIDGE'},
    onStart:[{spawn:{type:'lancer',count:2,group:'ridge',anchor:'encounter.ridge',radius:9,hold:true}},{spawn:{type:'husk',count:2,group:'ridge',anchor:'encounter.ridge',radius:9,hold:true}}],
    complete:{kind:'enter-zone'},
    onComplete:[{objective:'Slice the relay.'},{story:{speaker:'DISPATCH',text:'Relay dead ahead. Hold the splice — they will converge.'}},{supply:true},{checkpoint:true}]},
   {id:'slice',label:'RELAY',text:'Slice the relay',detail:'Hold the splice for 14 seconds.',marker:{anchor:'encounter.slice',halfHeight:1.5,radius:7,label:'RELAY'},
    onStart:[{spawn:{type:'sentinel',count:1,group:'slice',anchor:'encounter.slice',radius:9,hold:true}},{spawn:{type:'lancer',count:3,group:'slice',anchor:'encounter.slice',radius:9,hold:true}},{spawn:{type:'husk',count:3,group:'slice',anchor:'encounter.slice',radius:9,hold:true}}],
    complete:{kind:'hold',seconds:14},
    onComplete:[{objective:'Exfiltrate east.'},{story:{speaker:'RELAY',text:'Intel is ours. Take the open southeast ridge to extraction!'}},{supply:true},{checkpoint:true}]},
   {id:'exfil',label:'EXFIL',text:'Exfiltrate east',detail:'Reach the eastern ridge.',marker:{anchor:'exit',halfHeight:1.5,radius:7,label:'EXFIL'},
    onStart:[{spawn:{type:'husk',count:3,group:'exfil',anchor:'encounter.exfil',radius:9,hold:true}},{spawn:{type:'lancer',count:1,group:'exfil',anchor:'encounter.exfil',radius:9,hold:true}}],
    complete:{kind:'enter-zone'},
    onComplete:[{win:'Ghost wire is dark.'}]},
  ],
 },
 {
  id:'crown-duel',order:5,chapter:'ACT III',name:'The Crown Duel',mapId:'fortress',tag:'DUEL',
  weather:'storm',predeploy:true,
  anchors:{
   'entrance':{x:-46,z:0,minY:1,maxY:4,maxSnap:3},
   'encounter.approach':{x:-32,z:-12,minY:2,maxY:5,maxSnap:3},
   'checkpoint.shield-line':{x:-32,z:-12,minY:2,maxY:5,maxSnap:3},
   'encounter.shield-line':{x:-12,z:0,minY:3,maxY:5,maxSnap:3},
   'checkpoint.ring':{x:-12,z:0,minY:3,maxY:5,maxSnap:3},
   'encounter.ring':{x:0,z:0,minY:3,maxY:6,maxSnap:3},
   'checkpoint.duel':{x:0,z:0,minY:3,maxY:6,maxSnap:3},
   'encounter.duel':{x:30,z:0,minY:4,maxY:6,maxSnap:3},
   'exit':{x:30,z:0,minY:4,maxY:6,maxSnap:3},
  },
  checkpoints:{1:'checkpoint.shield-line',2:'checkpoint.ring',3:'checkpoint.duel',4:'exit'},
  brief:'The Harbinger holds the fortress keep and will drown the valley in husks. Break the shield line, survive the ring, and duel the voice of the cluster.',
  objective:'Break into the fortress.',
  lives:3,
  start:{anchor:'entrance',x:-46,z:0,yaw:-1.5708},
  win:{kind:'reach',anchor:'exit',radius:8,halfHeight:1.5,requireCleared:true},
  intro:{speaker:'DISPATCH',lines:[
   'The Harbinger is in the keep. Its guard is already deployed. Reach it through the west doorway.',
   'Cut through the fortress and end it. This is the voice of the cluster.',
  ]},
  outro:{speaker:'HARBINGER',lines:['You... only killed a mouth.','The cluster has a thousand more.']},
  script:[
   {id:'duel-gate-ambush',step:'approach',at:6,bark:{speaker:'HARBINGER',text:'You are already surrounded.'}},
   {id:'duel-shield-line',step:'shield-line',when:'player-in-zone',anchor:'encounter.shield-line',radius:7,halfHeight:1.5,bark:{speaker:'DISPATCH',text:'Shield line ahead — break the formation.'}},
   {id:'duel-phase2',step:'duel',when:'boss-hp:0.65',bossPhase:2,name:'SWARMLORD',bark:{speaker:'HARBINGER',text:'Rise. Rise and drag them down.'}},
   {id:'duel-phase3',step:'duel',when:'boss-hp:0.3',bossPhase:3,name:'OBLIVION',bark:{speaker:'HARBINGER',text:'I am the mouth of the swarm. You cannot close it.'}},
   {id:'duel-crown',step:'duel',when:'boss-hp:0.12',bark:{speaker:'HARBINGER',text:'Then the swarm drinks this rock dry.'},announce:'The Harbinger is breaking — finish it.'},
  ],
  steps:[
   {id:'approach',label:'FORTRESS GATE',text:'Break into the fortress',detail:'Use the north gatehouse apron; do not push through its wall.',marker:{anchor:'encounter.approach',halfHeight:1.5,radius:6,label:'GATE'},
    onStart:[{story:{speaker:'DISPATCH',text:'Fortress gate ahead. They know you are here.'}},{spawn:{type:'husk',count:4,group:'approach',anchor:'encounter.approach',radius:9,hold:true}}],
    complete:{kind:'group-dead',requireZone:true,group:'approach'},
    onComplete:[{objective:'Break the shield line.'},{story:{speaker:'DISPATCH',text:'Gate clear. Shield-bearers hold the yard.'}},{supply:true},{checkpoint:true}]},
   {id:'shield-line',label:'SHIELD LINE',text:'Break the shield line',detail:'Shield-bearers buff the whole push.',marker:{anchor:'encounter.shield-line',halfHeight:1.5,radius:7,label:'YARD'},
    onStart:[{spawn:{type:'sentinel',count:2,group:'shield-line',anchor:'encounter.shield-line',radius:9,hold:true}},{spawn:{type:'husk',count:4,group:'shield-line',anchor:'encounter.shield-line',radius:9,hold:true}},{spawn:{type:'lancer',count:2,group:'shield-line',anchor:'encounter.shield-line',radius:9,hold:true}}],
    complete:{kind:'group-dead',requireZone:true,group:'shield-line'},
    onComplete:[{objective:'Secure the ring.'},{story:{speaker:'HARBINGER',text:'Good. Now bleed in my ring.'}},{supply:true},{checkpoint:true}]},
   {id:'ring',label:'THE RING',text:'Secure the ring',detail:'Clear the ring, then hold for 18 seconds.',marker:{anchor:'encounter.ring',halfHeight:1.5,radius:7,label:'RING'},
    onStart:[{spawn:{type:'husk',count:6,group:'ring',anchor:'encounter.ring',radius:9,hold:true}},{spawn:{type:'lancer',count:2,group:'ring',anchor:'encounter.ring',radius:9,hold:true}},{spawn:{type:'mortar',count:1,group:'ring',anchor:'encounter.ring',radius:9,hold:true}}],
    complete:{kind:'hold',seconds:18,groups:['ring']},
    onComplete:[{objective:'Duel the Harbinger.'},{story:{speaker:'DISPATCH',text:'Ring held. Enter the keep through its west door to reach the Harbinger.'}},{supply:true},{checkpoint:true}]},
   {id:'duel',label:'THE HARBINGER',text:'Duel the Harbinger',detail:'Enter the keep through its west door. Kill the Harbinger and shield guard.',marker:{anchor:'encounter.duel',halfHeight:1.5,radius:8,label:'HARBINGER'},
    onStart:[{spawn:{type:'harbinger',summons:false,count:1,group:'duel',anchor:'encounter.duel',radius:9,hold:true}},{spawn:{type:'bulwark',count:1,group:'duel',elite:true,anchor:'encounter.duel',radius:9,hold:true}}],
    complete:{kind:'group-dead',requireZone:true,group:'duel'},
    onComplete:[{supply:true},{checkpoint:true},{win:'The Harbinger falls.'}]},
  ],
 },
 {
  id:'verdant-signal',order:6,chapter:'FIELD OPERATIONS',name:'The Verdant Signal',mapId:'verdant-reliquary',tag:'RECOVERY',
  weather:'overcast',predeploy:true,lives:3,
  brief:'A forgotten relay is broadcasting from beneath the roots. Cross the cloister, recover its signal, and extract through the eastern gardens.',
  objective:'Enter the root cloister.',
  anchors:{
   entrance:{x:-42,z:-36,minY:-.1,maxY:.1,maxSnap:2},
   encounter1:{x:-28,z:10,minY:-.1,maxY:.1,maxSnap:2},
   hold:{x:8,z:-4,minY:-.1,maxY:.1,maxSnap:2},
   encounter2:{x:28,z:25,minY:-.1,maxY:.1,maxSnap:2},
   exit:{x:40,z:34,minY:-.1,maxY:.1,maxSnap:2},
  },
  checkpoints:{2:'hold',4:'exit'},start:{anchor:'entrance',x:-42,z:-36,yaw:-1.5708},
  win:{kind:'reach',anchor:'exit',radius:5,halfHeight:1.5,requireCleared:true},
  intro:{speaker:'DISPATCH',lines:['A living forest surrounds a dead network. Something inside it still remembers us.','Use the cloister passages, hold the cavern relay, and leave by the sun altar.']},
  outro:{speaker:'RELAY',lines:['Signal recovered. The roots did not erase it.','There are other destinations. Keep listening.']},
  script:[{id:'verdant-warning',step:'approach',at:3,bark:{speaker:'DISPATCH',text:'Defenders are already in position. The cloister has more than one entrance; use them.'}}],
  steps:[
   {id:'approach',label:'FERN GATE',text:'Reach the root cloister',detail:'Follow the garden loop to the western cloister approach.',marker:{anchor:'encounter1',radius:6,halfHeight:1.5,label:'CLOISTER'},
    onStart:[{story:{speaker:'RELAY',text:'I can hear you through the stone. Come closer.'}}],complete:{kind:'enter-zone'},onComplete:[{objective:'Clear the cloister defenders.'}]},
   {id:'cloister',label:'ROOT CLOISTER',text:'Clear the root cloister',detail:'Use the multiple entrances to break the defensive line.',marker:{anchor:'encounter1',radius:7,halfHeight:1.5,label:'CLOISTER'},
    onStart:[{spawn:{type:'husk',count:2,group:'cloister',anchor:'encounter1',radius:9,hold:true}},{spawn:{type:'spitter',count:1,group:'cloister',anchor:'encounter1',radius:9,hold:true}}],
    complete:{kind:'group-dead',group:'cloister',requireZone:true},onComplete:[{supply:true},{checkpoint:true},{objective:'Recover the signal in the heart cavern.'}]},
   {id:'signal',label:'HEART CAVERN',text:'Hold the cavern relay',detail:'Clear its guardians, then hold the receiver for 15 seconds.',marker:{anchor:'hold',radius:6,halfHeight:1.5,label:'RECEIVER'},
    onStart:[{spawn:{type:'husk',count:2,group:'receiver',anchor:'hold',radius:8,hold:true}},{spawn:{type:'spitter',count:1,group:'receiver',anchor:'hold',radius:8,hold:true}}],
    complete:{kind:'hold',seconds:15,groups:['receiver']},onComplete:[{supply:true},{objective:'Clear the sun altar approach.'},{story:{speaker:'RELAY',text:'The signal is yours. The east garden is the way out.'}}]},
   {id:'altar',label:'SUN ALTAR',text:'Clear the sun altar approach',detail:'Break the final patrol on the lower garden loop.',marker:{anchor:'encounter2',radius:7,halfHeight:1.5,label:'ALTAR'},
    onStart:[{spawn:{type:'brute',count:1,group:'altar',anchor:'encounter2',radius:9,hold:true}},{spawn:{type:'spitter',count:2,group:'altar',anchor:'encounter2',radius:9,hold:true}}],
    complete:{kind:'group-dead',group:'altar',requireZone:true},onComplete:[{supply:true},{checkpoint:true},{objective:'Extract through the east garden gate.'}]},
   {id:'extract',label:'EAST GARDEN',text:'Reach the east garden gate',detail:'Bring the recovered signal home.',marker:{anchor:'exit',radius:5,halfHeight:1.5,label:'EXTRACT'},
    onStart:[],complete:{kind:'enter-zone'},onComplete:[{win:'Verdant signal recovered.'}]},
  ],
 },
]);
export const CAMPAIGN_MISSION_IDS = CAMPAIGN_MISSIONS.map(mission => mission.id);
export const DEFAULT_MISSION_ID = CAMPAIGN_MISSIONS[0].id;
export const campaignOrder = () => CAMPAIGN_MISSIONS.slice().sort((a,b)=>(a.order??0)-(b.order??0)).map(mission => mission.id);
export const missionFor = id => CAMPAIGN_MISSIONS.find(mission => mission.id === id) || CAMPAIGN_MISSIONS[0];
