// Linear, story-driven campaign missions. Each mission reuses a large arena,
// starts the player at an authored spot, then walks them through an ordered
// list of objectives with world waypoints, scripted enemy deployments and
// story beats. Enemy classes live in `game/enemy-types.mjs` and are referenced
// by `type`; the runtime steps `steps` in `game/singleplayer.mjs`.
//
// Step action fields:
//   story:{speaker,text}   queue a story line
//   announce:'...'         short banner message
//   objective:'...'        replace the current objective text
//   spawn:{type,count,elite?,x?,z?,group}   deploy enemies and track the group
//   win:'...' / lose:'...' end the mission
//   checkpoint:true        mark a resumable checkpoint
//   lives:n                change remaining lives
//
// Step completion kinds: enter-zone | group-dead | boss-dead | timer | hold
export const CAMPAIGN_MISSIONS = Object.freeze([
 {
  id:'convoy-run',order:1,chapter:'ACT I',name:'The Long Haul',mapId:'convoy-line',tag:'ESCORT',
  brief:'Relay seven has gone dark. Run the only road east and light it before the cluster closes in.',
  objective:'Rally at the west depot.',
  lives:3,
  start:{x:-66,z:-12,yaw:-1.5708},
  intro:{speaker:'DISPATCH',lines:[
   'Relay seven is dark. No signal, no convoy, no mercy.',
   'Get to the east yard and bring it back online. The road is held — shoot through.',
  ]},
  outro:{speaker:'RELAY',lines:['Relay seven online.','Wait. The long-range sweep just lit up. Something big is crossing Titan Valley.']},
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
    onComplete:[{objective:'Break the east roadblock.'},{story:{speaker:'DISPATCH',text:'Convoy through. Now break their roadblock.'}}]},
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
  intro:{speaker:'DISPATCH',lines:[
   'Sweep says the cluster is massing on the reactor line.',
   'Take the valley piece by piece. The Warden holds the east base.',
  ]},
  outro:{speaker:'WARDEN',lines:['You think this is the cluster?','I am one node. We are already inside your relay.']},
  steps:[
   {id:'outpost',label:'WEST OUTPOST',text:'Secure the west outpost',detail:'Clear the ridge.',marker:{x:-28,z:-30,radius:6,label:'OUTPOST'},
    onStart:[{story:{speaker:'DISPATCH',text:'Eyes on the outpost. Clear it.'}},{spawn:{type:'spitter',count:4,group:'outpost',x:-28,z:-30}},{spawn:{type:'husk',count:3,group:'outpost',x:-16,z:-20}}],
    complete:{kind:'group-dead',group:'outpost'},
    onComplete:[{objective:'Take the central reactor.'},{story:{speaker:'DISPATCH',text:'Outpost clear. Reactor is dead ahead.'}}]},
   {id:'reactor',label:'REACTOR',text:'Take the central reactor',detail:'Heavy resistance at the core.',marker:{x:0,z:0,radius:7,label:'REACTOR'},
    onStart:[{spawn:{type:'brute',count:2,group:'reactor',x:-8,z:8}},{spawn:{type:'spitter',count:4,group:'reactor',x:10,z:-8}},{spawn:{type:'husk',count:4,group:'reactor',x:0,z:16}}],
    complete:{kind:'group-dead',group:'reactor'},
    onComplete:[{objective:'Hold the north cavern.'},{story:{speaker:'DISPATCH',text:'Reactor ours. Contacts pouring out of the north cavern — dig in.'}}]},
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
]);
export const CAMPAIGN_MISSION_IDS = CAMPAIGN_MISSIONS.map(mission => mission.id);
export const DEFAULT_MISSION_ID = CAMPAIGN_MISSIONS[0].id;
export const campaignOrder = () => CAMPAIGN_MISSIONS.slice().sort((a,b)=>(a.order??0)-(b.order??0)).map(mission => mission.id);
export const missionFor = id => CAMPAIGN_MISSIONS.find(mission => mission.id === id) || CAMPAIGN_MISSIONS[0];
