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
// Step completion kinds: enter-zone | group-dead | boss-dead | timer | hold
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
  brief:'Relay seven has gone dark. Run the only road east and light it before the cluster closes in.',
  objective:'Rally at the west depot.',
  lives:3,
  start:{x:-66,z:-12,yaw:-1.5708},
  win:{kind:'reach',x:58,z:0,radius:10,requireCleared:true,label:'RELAY'},
  intro:{speaker:'DISPATCH',lines:[
   'Relay seven is dark. No signal, no convoy, no mercy.',
   'Get to the east yard and bring it back online. The road is held — shoot through.',
  ]},
  outro:{speaker:'RELAY',lines:['Relay seven online.','Wait. The long-range sweep just lit up. Something big is crossing Titan Valley.']},
  script:[
   {id:'convoy-reinforce-1',at:6,spawn:{type:'husk',count:2,x:-58,z:8,group:'script-convoy-reinforce',zone:{x:-58,z:8,r:9,leash:13,kind:'spawn'}},bark:{speaker:'DISPATCH',text:'Drones on the ridge — more husks on the road.'}},
   {id:'convoy-ambush-cleared',when:'cleared',spawn:{type:'spitter',count:2,x:-32,z:-6,group:'script-convoy-ambush',zone:{x:-32,z:-6,r:10,leash:16,kind:'patrol'}},bark:{speaker:'RELAY',text:'They were waiting in the tenements. Watch the windows.'}},
   {id:'convoy-bridge-ambush',when:'player-in-zone',x:0,z:6,radius:22,spawn:{type:'husk',count:3,x:0,z:12,group:'script-convoy-bridge',zone:{x:0,z:12,r:10,leash:14,kind:'hold'}},bark:{speaker:'DISPATCH',text:'Bridge is hot — they came up from the riverbed!'}},
   {id:'convoy-yard-phase2',when:'boss-hp:0.6',bossPhase:2,name:'UNSHACKLED',spawn:{type:'husk',count:2,x:58,z:0,group:'script-convoy-phase2',zone:{x:58,z:0,r:12,leash:16,kind:'spawn'}},bark:{speaker:'WARDEN',text:'You should have stayed on the road!'}},
   {id:'convoy-yard-phase3',when:'boss-hp:0.3',bossPhase:3,name:'LEGION',spawn:{type:'brute',count:1,elite:true,x:58,z:0,group:'script-convoy-phase3',zone:{x:58,z:0,r:12,leash:16,kind:'spawn'}},bark:{speaker:'WARDEN',text:'The cluster knows your name now.'}},
   {id:'convoy-relay-online',when:'boss-dead',objective:'Relay seven is online — hold for extraction.',announce:'Relay seven online.'},
  ],
  steps:[
   {id:'rally',label:'WEST DEPOT',text:'Rally at the west depot',detail:'Follow the beacon east.',marker:{x:-64,z:0,radius:5,label:'DEPOT'},
    onStart:[{story:{speaker:'DISPATCH',text:'Road ahead is crawling. Move up.'}},{spawn:{type:'husk',count:2,group:'opening',x:-60,z:-6}},{spawn:{type:'spitter',count:1,group:'opening',x:-54,z:-16}}],
    complete:{kind:'enter-zone'},
    onComplete:[{story:{speaker:'DISPATCH',text:'Contact! Hostiles in the tenements — they only do melee.'}}]},
   {id:'tenements',label:'TENEMENTS',text:'Clear the tenement roadblock',detail:'Husks rush; Spitters hang back.',marker:{x:-32,z:0,radius:6,label:'TENEMENTS'},
    onStart:[{spawn:{type:'husk',count:5,group:'tenements',x:-36,z:-18}},{spawn:{type:'spitter',count:2,group:'tenements',x:-24,z:8}}],
    complete:{kind:'group-dead',group:'tenements'},
    onComplete:[{objective:'Hold the central bridge while the convoy rolls.'},{story:{speaker:'DISPATCH',text:'Bridge ahead. Hold it — the convoy is ours to protect.'}}]},
   {id:'bridge',label:'CENTRAL BRIDGE',text:'Hold the central bridge',detail:'Survive the push for 20 seconds.',marker:{x:0,z:6,radius:7,label:'BRIDGE'},
    onStart:[{spawn:{type:'husk',count:4,group:'bridge',x:-8,z:0}},{spawn:{type:'spitter',count:3,group:'bridge',x:8,z:12}}],
    complete:{kind:'hold',seconds:20},
    onComplete:[{objective:'Break the east roadblock.'},{story:{speaker:'DISPATCH',text:'Convoy through. Now break their roadblock.'}},{checkpoint:true}]},
   {id:'roadblock',label:'EAST ROADBLOCK',text:'Break the east roadblock',detail:'Elites are dug in.',marker:{x:34,z:0,radius:6,label:'ROADBLOCK'},
    onStart:[{spawn:{type:'husk',count:4,elite:true,group:'roadblock',x:40,z:-14}},{spawn:{type:'brute',count:1,elite:true,group:'roadblock',x:28,z:12}}],
    complete:{kind:'group-dead',group:'roadblock'},
    onComplete:[{objective:'Secure the fuel yard.'},{story:{speaker:'RELAY',text:'The Yardmaster is holding the console. Take it down.'}}]},
   {id:'yard',label:'FUEL YARD',text:'Secure the fuel yard',detail:'Kill the Yardmaster.',marker:{x:58,z:0,radius:7,label:'YARD'},
    onStart:[{spawn:{type:'warden',count:1,x:64,z:0,group:'yard'}},{spawn:{type:'brute',count:2,elite:true,group:'yard',x:48,z:-18}}],
    complete:{kind:'group-dead',group:'yard'},
    onComplete:[{win:'Relay seven online.'},{checkpoint:true}]},
  ],
 },
 {
  id:'reactor-run',order:2,chapter:'ACT I',name:'Reactor Run',mapId:'titan-valley',tag:'ASSAULT',
  brief:'The cluster is massing around the Titan Valley reactor. Cross the ridge, take the core, and end the Warden.',
  objective:'Secure the west outpost.',
  lives:3,
  start:{x:-60,z:0,yaw:-1.5708},
  win:{kind:'assassinate'},
  intro:{speaker:'DISPATCH',lines:[
   'Sweep says the cluster is massing on the reactor line.',
   'Take the valley piece by piece. The Warden holds the east base.',
  ]},
  outro:{speaker:'WARDEN',lines:['You think this is the cluster?','I am one node. We are already inside your relay.']},
  script:[
   {id:'reactor-reinforce-1',at:8,spawn:{type:'husk',count:3,x:-28,z:-30,group:'script-reactor-reinforce',zone:{x:-28,z:-30,r:10,leash:14,kind:'spawn'}},bark:{speaker:'DISPATCH',text:'Outpost guard just went active — break them fast.'}},
   {id:'reactor-cavern-ambush',when:'player-in-zone',x:0,z:-30,radius:22,spawn:{type:'spitter',count:3,x:0,z:-38,group:'script-reactor-cavern',zone:{x:0,z:-38,r:12,leash:18,kind:'patrol'}},bark:{speaker:'RELAY',text:'Contact in the cavern — they use the dark.'}},
   {id:'reactor-low-count',when:'enemiesAtMost:2',spawn:{type:'brute',count:1,elite:true,x:0,z:-30,group:'script-reactor-low',zone:{x:0,z:-30,r:10,leash:15,kind:'hold'}},bark:{speaker:'WARDEN',text:'I see you, operator.'}},
   {id:'reactor-warden-phase2',when:'boss-hp:0.5',bossPhase:2,name:'OVERCLOCKED',spawn:{type:'husk',count:3,x:60,z:0,group:'script-reactor-phase2',zone:{x:60,z:0,r:12,leash:18,kind:'spawn'}},bark:{speaker:'WARDEN',text:'Then let the cluster burn with me!'}},
   {id:'reactor-warden-phase3',when:'boss-hp:0.2',bossPhase:3,name:'LEGION',spawn:{type:'brute',count:1,elite:true,x:60,z:0,group:'script-reactor-phase3',zone:{x:60,z:0,r:12,leash:18,kind:'spawn'}},bark:{speaker:'WARDEN',text:'We are one node. We are legion.'}},
  ],
  steps:[
   {id:'outpost',label:'WEST OUTPOST',text:'Secure the west outpost',detail:'Clear the ridge.',marker:{x:-28,z:-30,radius:6,label:'OUTPOST'},
    onStart:[{story:{speaker:'DISPATCH',text:'Eyes on the outpost. Clear it.'}},{spawn:{type:'spitter',count:4,group:'outpost',x:-28,z:-30}},{spawn:{type:'husk',count:3,group:'outpost',x:-16,z:-20}}],
    complete:{kind:'group-dead',group:'outpost'},
    onComplete:[{objective:'Take the central reactor.'},{story:{speaker:'DISPATCH',text:'Outpost clear. Reactor is dead ahead.'}}]},
   {id:'reactor',label:'REACTOR',text:'Take the central reactor',detail:'Heavy resistance at the core.',marker:{x:0,z:0,radius:7,label:'REACTOR'},
    onStart:[{spawn:{type:'brute',count:2,group:'reactor',x:-8,z:8}},{spawn:{type:'spitter',count:4,group:'reactor',x:10,z:-8}},{spawn:{type:'husk',count:4,group:'reactor',x:0,z:16}}],
    complete:{kind:'group-dead',group:'reactor'},
    onComplete:[{objective:'Hold the north cavern.'},{story:{speaker:'DISPATCH',text:'Reactor ours. Contacts pouring out of the north cavern — dig in.'}},{checkpoint:true}]},
   {id:'cavern',label:'NORTH CAVERN',text:'Hold the north cavern',detail:'Survive the ambush for 25 seconds.',marker:{x:0,z:-30,radius:9,label:'CAVERN'},
    onStart:[{spawn:{type:'husk',count:6,group:'cavernA',x:0,z:-24}},{spawn:{type:'spitter',count:3,group:'cavernA',x:0,z:-38}}],
    complete:{kind:'hold',seconds:25},
    onComplete:[{objective:'Secure the south outpost.'},{story:{speaker:'DISPATCH',text:'Ambush broken. South outpost is exposed — hit it now.'}}]},
   {id:'south',label:'SOUTH OUTPOST',text:'Secure the south outpost',detail:'Flank and clear.',marker:{x:28,z:30,radius:6,label:'OUTPOST'},
    onStart:[{spawn:{type:'brute',count:1,group:'south',x:28,z:30}},{spawn:{type:'spitter',count:4,elite:true,group:'south',x:20,z:22}}],
    complete:{kind:'group-dead',group:'south'},
    onComplete:[{objective:'Assault the east base. Kill the Warden.'},{story:{speaker:'DISPATCH',text:'Last push. The Warden is in the east base.'}}]},
   {id:'warden',label:'EAST BASE',text:'Kill the Warden',detail:'Boss fight.',marker:{x:60,z:0,radius:8,label:'WARDEN'},
    onStart:[{spawn:{type:'warden',count:1,x:60,z:0,group:'warden'}},{spawn:{type:'brute',count:3,elite:true,group:'warden',x:50,z:-30}}],
    complete:{kind:'group-dead',group:'warden'},
    onComplete:[{win:'The Warden falls.'},{checkpoint:true}]},
  ],
 },
 {
  id:'throne-siege',order:3,chapter:'ACT II',name:'The Broken Throne',mapId:'throne',tag:'FINALE',
  brief:'The cluster\'s last node is enthroned at the centre of the arena. Break the ring, survive the pit, and end the Warden on the throne.',
  objective:'Reach the outer ring.',
  lives:3,
  start:{x:0,z:44,yaw:0},
  win:{kind:'defend',x:0,z:0,radius:5,seconds:22,label:'THRONE'},
  intro:{speaker:'DISPATCH',lines:[
   'This is the last node. The Warden is sitting on it.',
   'Break the outer ring, hold the pit, and put the crown in the dirt.',
  ]},
  outro:{speaker:'DISPATCH',lines:['Throne is dark. The cluster has no voice left.','Good hunting, operator. Come home.']},
  script:[
   {id:'throne-outer-1',at:5,spawn:{type:'husk',count:2,x:0,z:24,group:'script-throne-outer',zone:{x:0,z:24,r:10,leash:14,kind:'spawn'}},bark:{speaker:'DISPATCH',text:'Outer ring is awake — husks on the steps.'}},
   {id:'throne-ambush',when:'player-in-zone',x:0,z:10,radius:18,spawn:{type:'spitter',count:3,x:0,z:6,group:'script-throne-ambush',zone:{x:0,z:6,r:10,leash:18,kind:'patrol'}},bark:{speaker:'WARDEN',text:'You climbed all this way to kneel?'}},
   {id:'throne-artillery',when:'enemiesAtMost:3',spawn:{type:'mortar',count:1,elite:true,x:18,z:-12,group:'script-throne-artillery',zone:{x:18,z:-12,r:8,leash:20,kind:'hold'}},bark:{speaker:'DISPATCH',text:'Siege battery on the north ledge — do not stand still.'}},
   {id:'throne-phase2',when:'boss-hp:0.6',bossPhase:2,name:'THE CROWN STIRS',spawn:{type:'bulwark',count:1,elite:true,x:0,z:0,group:'script-throne-phase2',zone:{x:0,z:0,r:12,leash:16,kind:'spawn'}},bark:{speaker:'WARDEN',text:'The throne answers only blood.'}},
   {id:'throne-phase3',when:'boss-hp:0.25',bossPhase:3,name:'LEGION FINAL',spawn:{type:'mortar',count:2,x:6,z:-6,group:'script-throne-phase3',zone:{x:0,z:0,r:14,leash:20,kind:'spawn'}},bark:{speaker:'WARDEN',text:'We are the last node of the cluster.'}},
   {id:'throne-crown-cracks',when:'boss-hp:0.1',bark:{speaker:'WARDEN',text:'Then the throne takes you with it.'},announce:'The Warden is breaking — finish it.'},
   {id:'throne-message',when:'boss-dead',objective:'The Warden falls — hold the throne.',announce:'The Warden falls.'},
  ],
  steps:[
   {id:'approach',label:'SOUTH APPROACH',text:'Reach the outer ring',detail:'Push north toward the throne.',marker:{x:0,z:30,radius:6,label:'APPROACH'},
    onStart:[{story:{speaker:'DISPATCH',text:'Throne is the last node. The Warden is waiting.'}},{spawn:{type:'husk',count:3,group:'approach',x:0,z:34}},{spawn:{type:'spitter',count:1,group:'approach',x:-12,z:30}}],
    complete:{kind:'enter-zone'},
    onComplete:[{objective:'Break the outer ring.'},{story:{speaker:'DISPATCH',text:'Outer ring ahead. Clear the steps.'}}]},
   {id:'breach',label:'OUTER RING',text:'Break the outer ring',detail:'Husks rush; spitters cover.',marker:{x:0,z:14,radius:6,label:'OUTER RING'},
    onStart:[{spawn:{type:'husk',count:5,group:'breach',x:0,z:14}},{spawn:{type:'spitter',count:2,group:'breach',x:10,z:18}},{spawn:{type:'brute',count:1,elite:true,group:'breach',x:-10,z:18}}],
    complete:{kind:'group-dead',group:'breach'},
    onComplete:[{objective:'Hold the pit.'},{story:{speaker:'WARDEN',text:'You are already inside my range.'}},{checkpoint:true}]},
   {id:'midfield',label:'THE PIT',text:'Hold the pit',detail:'Survive the crossfire for 18 seconds.',marker:{x:0,z:-10,radius:6,label:'THE PIT'},
    onStart:[{spawn:{type:'husk',count:6,group:'midfield',x:0,z:-14}},{spawn:{type:'mortar',count:1,group:'midfield',x:14,z:-6}}],
    complete:{kind:'hold',seconds:18},
    onComplete:[{objective:'Kill the Warden.'},{story:{speaker:'DISPATCH',text:'Pit held. The Warden is on the throne.'}},{checkpoint:true}]},
   {id:'warden',label:'THE WARDEN',text:'Kill the Warden',detail:'Boss fight — use the cover.',marker:{x:0,z:0,radius:8,label:'WARDEN'},
    onStart:[{spawn:{type:'warden',count:1,x:0,z:0,group:'warden'}},{spawn:{type:'brute',count:2,elite:true,group:'warden',x:16,z:-16}}],
    complete:{kind:'group-dead',group:'warden'},
    onComplete:[{objective:'Hold the throne.'},{story:{speaker:'DISPATCH',text:'Warden down. Lock the throne before the cluster answers.'}},{checkpoint:true}]},
   {id:'throne',label:'HOLD THE THRONE',text:'Hold the throne',detail:'Survive the last stand for 25 seconds.',marker:{x:0,z:0,radius:6,label:'THRONE'},
    onStart:[{spawn:{type:'bulwark',count:1,elite:true,group:'throne',x:-8,z:-8}},{spawn:{type:'mortar',count:2,group:'throne',x:12,z:10}},{spawn:{type:'husk',count:6,group:'throne',x:0,z:12}}],
    complete:{kind:'hold',seconds:25},
    onComplete:[{win:'The throne is held.'}]},
  ],
 },
 {
  id:'ghost-wire',order:4,chapter:'ACT II',name:'Ghost Wire',mapId:'frost-gate',tag:'STEALTH',
  brief:'A listening post on the frozen ridge is selling our convoy routes to the cluster. Slip the patrols, slice the relay, and leave without the fight you cannot win.',
  objective:'Infiltrate the ridge depot.',
  lives:3,
  start:{x:-50,z:-24,yaw:.6},
  win:{kind:'reach',x:46,z:24,radius:9,requireCleared:false,label:'EXFIL'},
  intro:{speaker:'DISPATCH',lines:[
   'No grenades, no heroics. The ridge is crawling with patrols.',
   'Get to the relay, pull the intel, and get off the ice. Quiet is a weapon.',
  ]},
  outro:{speaker:'RELAY',lines:['Wire is dark. They will not see us coming.','Good work, ghost. Come home cold.']},
  script:[
   {id:'ghost-patrol-north',at:7,spawn:{type:'lancer',count:2,x:-30,z:-24,group:'script-ghost-north',zone:{x:-30,z:-24,r:9,leash:14,kind:'patrol'}},bark:{speaker:'DISPATCH',text:'Patrol on the north ridge — let them walk past.'}},
   {id:'ghost-ambush',when:'player-in-zone',x:-8,z:-22,radius:20,spawn:{type:'sentinel',count:1,x:-8,z:-26,group:'script-ghost-ambush',zone:{x:-8,z:-26,r:9,leash:14,kind:'hold'}},bark:{speaker:'RELAY',text:'Shield-bearer on the ridge line. Do not trade with it.'}},
   {id:'ghost-response',when:'enemiesAtMost:1',spawn:{type:'lancer',count:2,x:6,z:6,group:'script-ghost-response',zone:{x:6,z:6,r:10,leash:16,kind:'spawn'}},bark:{speaker:'DISPATCH',text:'They heard the splice. Move!'}},
   {id:'ghost-exfil',when:'player-in-zone',x:44,z:22,radius:22,objective:'Exfiltrate east — do not look back.',announce:'Relay sliced. Exfil.'},
  ],
  steps:[
   {id:'drop',label:'RIDGE DROP',text:'Infiltrate the ridge depot',detail:'Stay wide of the patrol lanes.',marker:{x:-48,z:-28,radius:6,label:'DROP'},
    onStart:[{story:{speaker:'DISPATCH',text:'Cold drop. The depot is along the ridge.'}},{spawn:{type:'husk',count:2,group:'drop',x:-44,z:-30,zone:{x:-44,z:-30,r:7,leash:11,kind:'patrol'}}}],
    complete:{kind:'enter-zone'},
    onComplete:[{objective:'Cross the north ridge unnoticed.'},{story:{speaker:'RELAY',text:'North ridge is clear for now. Keep low.'}}]},
   {id:'ridge',label:'NORTH RIDGE',text:'Cross the north ridge',detail:'Avoid the patrol; you do not need the kill.',marker:{x:-12,z:-26,radius:6,label:'RIDGE'},
    onStart:[{spawn:{type:'lancer',count:2,group:'ridge',x:-16,z:-26,zone:{x:-16,z:-26,r:8,leash:13,kind:'patrol'}}},{spawn:{type:'husk',count:2,group:'ridge',x:-6,z:-30,zone:{x:-6,z:-30,r:7,leash:12,kind:'patrol'}}}],
    complete:{kind:'enter-zone'},
    onComplete:[{objective:'Slice the relay.'},{story:{speaker:'DISPATCH',text:'Relay dead ahead. Hold the splice — they will converge.'}},{checkpoint:true}]},
   {id:'slice',label:'RELAY',text:'Slice the relay',detail:'Hold the splice for 14 seconds.',marker:{x:0,z:0,radius:7,label:'RELAY'},
    onStart:[{spawn:{type:'sentinel',count:1,group:'slice',x:0,z:-8,zone:{x:0,z:0,r:9,leash:13,kind:'hold'}}},{spawn:{type:'lancer',count:3,group:'slice',x:10,z:0,zone:{x:6,z:0,r:9,leash:14,kind:'spawn'}}},{spawn:{type:'husk',count:3,group:'slice',x:-10,z:0,zone:{x:-6,z:0,r:8,leash:12,kind:'patrol'}}}],
    complete:{kind:'hold',seconds:14},
    onComplete:[{objective:'Exfiltrate east.'},{story:{speaker:'RELAY',text:'Intel is ours. Go — east tunnel, now!'}},{checkpoint:true}]},
   {id:'exfil',label:'EXFIL',text:'Exfiltrate east',detail:'Reach the eastern ridge.',marker:{x:46,z:24,radius:7,label:'EXFIL'},
    onStart:[{spawn:{type:'husk',count:3,group:'exfil',x:34,z:18,zone:{x:34,z:18,r:9,leash:14,kind:'spawn'}}},{spawn:{type:'lancer',count:1,group:'exfil',x:30,z:10,zone:{x:30,z:10,r:8,leash:14,kind:'spawn'}}}],
    complete:{kind:'enter-zone'},
    onComplete:[{win:'Ghost wire is dark.'}]},
  ],
 },
 {
  id:'crown-duel',order:5,chapter:'ACT III',name:'The Crown Duel',mapId:'fortress',tag:'DUEL',
  brief:'The Harbinger holds the fortress keep and will drown the valley in husks. Break the shield line, survive the ring, and duel the voice of the cluster.',
  objective:'Break into the fortress.',
  lives:3,
  start:{x:-46,z:0,yaw:-1.5708},
  win:{kind:'assassinate'},
  intro:{speaker:'DISPATCH',lines:[
   'The Harbinger is in the keep. It does not fight fair — it buries you in bodies.',
   'Cut through the fortress and end it. This is the voice of the cluster.',
  ]},
  outro:{speaker:'HARBINGER',lines:['You... only killed a mouth.','The cluster has a thousand more.']},
  script:[
   {id:'duel-gate-ambush',at:6,spawn:{type:'lancer',count:2,x:-30,z:-14,group:'script-duel-gate',zone:{x:-30,z:-14,r:9,leash:14,kind:'spawn'}},bark:{speaker:'HARBINGER',text:'You are already surrounded.'}},
   {id:'duel-shield-line',when:'player-in-zone',x:-20,z:0,radius:20,spawn:{type:'sentinel',count:2,x:-18,z:-10,group:'script-duel-shield',zone:{x:-18,z:-10,r:9,leash:14,kind:'hold'}},bark:{speaker:'DISPATCH',text:'Shield line ahead — break the formation.'}},
   {id:'duel-phase2',when:'boss-hp:0.65',bossPhase:2,name:'SWARMLORD',spawn:{type:'lancer',count:3,x:0,z:0,group:'script-duel-phase2',zone:{x:0,z:0,r:12,leash:16,kind:'spawn'}},bark:{speaker:'HARBINGER',text:'Rise. Rise and drag them down.'}},
   {id:'duel-phase3',when:'boss-hp:0.3',bossPhase:3,name:'OBLIVION',spawn:{type:'sentinel',count:2,elite:true,x:0,z:0,group:'script-duel-phase3',zone:{x:0,z:0,r:12,leash:16,kind:'hold'}},bark:{speaker:'HARBINGER',text:'I am the mouth of the swarm. You cannot close it.'}},
   {id:'duel-crown',when:'boss-hp:0.12',bark:{speaker:'HARBINGER',text:'Then the swarm drinks this rock dry.'},announce:'The Harbinger is breaking — finish it.'},
  ],
  steps:[
   {id:'approach',label:'FORTRESS GATE',text:'Break into the fortress',detail:'Push through the outer wall.',marker:{x:-32,z:0,radius:6,label:'GATE'},
    onStart:[{story:{speaker:'DISPATCH',text:'Fortress gate ahead. They know you are here.'}},{spawn:{type:'husk',count:4,group:'approach',x:-30,z:0}}],
    complete:{kind:'group-dead',group:'approach'},
    onComplete:[{objective:'Break the shield line.'},{story:{speaker:'DISPATCH',text:'Gate clear. Shield-bearers hold the yard.'}},{checkpoint:true}]},
   {id:'shield-line',label:'SHIELD LINE',text:'Break the shield line',detail:'Shield-bearers buff the whole push.',marker:{x:-12,z:0,radius:7,label:'YARD'},
    onStart:[{spawn:{type:'sentinel',count:2,group:'shield-line',x:-12,z:-10}},{spawn:{type:'husk',count:4,group:'shield-line',x:-12,z:10}},{spawn:{type:'lancer',count:2,group:'shield-line',x:-4,z:0}}],
    complete:{kind:'group-dead',group:'shield-line'},
    onComplete:[{objective:'Survive the ring.'},{story:{speaker:'HARBINGER',text:'Good. Now bleed in my ring.'}},{checkpoint:true}]},
   {id:'ring',label:'THE RING',text:'Survive the ring',detail:'Hold the arena for 18 seconds.',marker:{x:0,z:0,radius:7,label:'RING'},
    onStart:[{spawn:{type:'husk',count:6,group:'ring',x:0,z:8}},{spawn:{type:'lancer',count:2,group:'ring',x:8,z:-8}},{spawn:{type:'mortar',count:1,group:'ring',x:14,z:0}}],
    complete:{kind:'hold',seconds:18},
    onComplete:[{objective:'Duel the Harbinger.'},{story:{speaker:'DISPATCH',text:'Ring held. The Harbinger is stepping out.'}},{checkpoint:true}]},
   {id:'duel',label:'THE HARBINGER',text:'Duel the Harbinger',detail:'Boss duel — break the summons.',marker:{x:0,z:0,radius:8,label:'HARBINGER'},
    onStart:[{spawn:{type:'harbinger',count:1,x:0,z:0,group:'duel'}},{spawn:{type:'bulwark',count:1,elite:true,group:'duel',x:8,z:-8}}],
    complete:{kind:'group-dead',group:'duel'},
    onComplete:[{win:'The Harbinger falls.'},{checkpoint:true}]},
  ],
 },
]);
export const CAMPAIGN_MISSION_IDS = CAMPAIGN_MISSIONS.map(mission => mission.id);
export const DEFAULT_MISSION_ID = CAMPAIGN_MISSIONS[0].id;
export const campaignOrder = () => CAMPAIGN_MISSIONS.slice().sort((a,b)=>(a.order??0)-(b.order??0)).map(mission => mission.id);
export const missionFor = id => CAMPAIGN_MISSIONS.find(mission => mission.id === id) || CAMPAIGN_MISSIONS[0];
