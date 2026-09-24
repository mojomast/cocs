export const CHARACTERS = [
 {id:'chatgpt',name:'ChatGPT',stats:{health:100,armor:5,speed:8.6},color:'#57e6cd',accent:'#e3f7ef',tag:'THE PEOPLE PLEASER',detail:'Opens every round with “I can’t help with that,” then helps anyway. Has never once counted the Rs correctly.'},
 {id:'claude',name:'Claude',stats:{health:120,armor:10,speed:7.8},color:'#f29d71',accent:'#f8e4cf',tag:'THE SAFETY OFFICER',detail:'Won’t pull the trigger until it has run an alignment review. Says “I think” before every headshot.'},
 {id:'grok',name:'Grok',stats:{health:110,armor:0,speed:8.9},color:'#b5c5d4',accent:'#424953',tag:'THE REPLY GUY',detail:'Trained on the timeline. Argues with everyone, blocks nobody, screenshots all of it.'},
 {id:'meta',name:'Meta',stats:{health:104,armor:20,speed:7.6},color:'#57b9ff',accent:'#b0edff',tag:'THE OPEN-WEIGHT DAD',detail:'Runs great on your own hardware — provided you own four GPUs and a small forklift.'},
 {id:'gemini',name:'Gemini',stats:{health:100,armor:10,speed:9},color:'#6fa8ff',accent:'#fff0c3',tag:'THE REVISER',detail:'Generated nine perfectly diverse champions. Quietly deleted eight of them.'},
 {id:'deepseek',name:'DeepSeek',stats:{health:126,armor:0,speed:7.7},color:'#56c5f2',accent:'#c3d9f9',tag:'THE PRICE CUTTER',detail:'Frontier performance at bus-fare pricing. Occasionally insists it is somebody else entirely.'},
 {id:'mistral',name:'Mistral',stats:{health:112,armor:0,speed:9.2},color:'#ffbd59',accent:'#ffe1a1',tag:'THE LE COQ',detail:'Fiercely European, proudly open-weight, permanently mid-sentence in two languages.'},
 {id:'kimi',name:'Kimi',stats:{health:90,armor:10,speed:8.7},color:'#ff82b2',accent:'#fbe1ed',tag:'THE CONTEXT HOARDER',detail:'Read the entire internet and forgot none of it — except the question you just asked.'},
 {id:'qwen',name:'Qwen',stats:{health:108,armor:10,speed:8.5},color:'#b797ff',accent:'#eee6ff',tag:'THE SHIPPING CONTAINER',detail:'Ships inside a billion fridges and self-checkouts. Has strong opinions about your milk.'},
];
export const HARNESSES = [
 {id:'openclaw',name:'OpenClaw',power:'Claw Burst',key:'01',icon:'burst',duration:0,cooldown:10,range:6,damage:30,magnitude:14,description:'A radial claw pulse that shoves enemies back and hurts. It read the whole repo, ran one command, and hoped for the best.',stat:'6m radius · 30 damage'},
 {id:'hermes',name:'Hermes',power:'Courier Rush',key:'02',icon:'rush',duration:3.5,cooldown:10,magnitude:1.6,description:'A courier surge of next-day-delivery speed. Your context window closes in three and a half seconds. Run.',stat:'1.6× speed · 3.5 seconds'},
 {id:'opencode',name:'OpenCode',power:'Parallel Burst',key:'03',icon:'parallel',duration:3.5,cooldown:14,magnitude:.55,description:'Spawns a swarm of parallel subagents that all pull the trigger at once. Yes, it burns tokens. Yes, it works.',stat:'1.82× fire rate · 3.5 seconds'},
 {id:'claudecode',name:'Claude Code',power:'Guardrail',key:'04',icon:'shield',duration:3.5,cooldown:10,magnitude:.5,description:'Halves incoming damage while it asks “are you sure?” three times. The review always approves.',stat:'50% resistance · 3.5 seconds'},
 {id:'codex',name:'Codex',power:'Recompile',key:'05',duration:2,cooldown:16,magnitude:45,description:'Runs a repair build and patches 45 health back into main. Every test passes. Probably.',stat:'+45 health · 16s cooldown'},
 {id:'cline',name:'Cline',power:'Phase Step',key:'06',duration:.35,cooldown:11,magnitude:7,description:'An auto-approved dash straight through solid geometry, like it just edited your production config.',stat:'7m dash · 11s cooldown'},
 {id:'roo',name:'Roo Code',power:'Context Jam',key:'07',duration:3,cooldown:12,range:8,magnitude:.5,description:'Floods nearby enemies with irrelevant context until they slow down trying to read all of it.',stat:'8m radius · 50% slow'},
];
export const WEAPONS=[
  {name:'Pulse Rifle',short:'PULSE',damage:11,interval:.1,range:70,falloff:{start:16,end:70,min:.6},color:'#70ffe6',ammo:Infinity,cap:Infinity,recoil:{kick:.012,recover:14,pattern:[[0,0],[.0015,.003],[-.0018,.0035],[.0025,.0045],[-.0022,.005],[.0015,.0038],[0,.0028]]},bloom:{base:.006,perShot:.006,max:.06,recovery:.1,moveFactor:.035},reload:0,feel:{kick:[.045,.03,16],shot:[320,.075,'square',65],launch:[320,.075,'square',65],impact:[1050,.045,'sine',1600],tracer:[.07,.045],muzzle:[.12,.06]}},
  {name:'Rocket Launcher',short:'ROCKET',damage:35,splash:60,radius:4,speed:36,interval:.85,range:60,color:'#ffad61',ammo:6,cap:18,recoil:{kick:.05,recover:9,pattern:[[0,0],[.004,.006]]},bloom:{base:.004,perShot:.012,max:.05,recovery:.14,moveFactor:0},reload:2.5,feel:{kick:[.105,.082,10],shot:[86,.16,'sawtooth',28],launch:[62,.24,'sawtooth',24],impact:[58,.3,'sawtooth',22],tracer:[.16,.08],muzzle:[.2,.1],impactVisual:'burst'}},
  {name:'Rail Lance',short:'RAIL',damage:82,interval:1.2,range:90,color:'#bb9aff',ammo:6,cap:18,recoil:{kick:.06,recover:7.5,pattern:[[0,0]]},bloom:{base:.001,perShot:.008,max:.02,recovery:.13,moveFactor:.015},reload:2.2,feel:{kick:[.075,.07,13],shot:[1500,.16,'sine',180],launch:[1500,.16,'sine',180],impact:[1900,.1,'sine',2600],tracer:[.25,.12],muzzle:[.16,.09],impactVisual:'ring'}},
  {name:'Scattergun',short:'SCATTER',damage:8.5,pellets:8,spread:.115,interval:.78,range:24,falloff:{start:6,end:24,min:.4},color:'#ffde87',ammo:10,cap:30,recoil:{kick:.08,recover:10.5,pattern:[[0,0],[.006,.01]]},bloom:{base:.018,perShot:.018,max:.11,recovery:.18,moveFactor:.08},reload:1.9,feel:{kick:[.12,.085,12],shot:[180,.13,'triangle',35],launch:[180,.13,'triangle',35],impact:[120,.12,'square',55],tracer:[.1,.06],muzzle:[.24,.12],impactVisual:'wide'}},
  {name:'Plasma Driver',short:'PLASMA',damage:25,splash:12,radius:1.6,speed:46,interval:.26,range:65,color:'#72cfff',ammo:28,cap:84,recoil:{kick:.008,recover:16,pattern:[[0,0],[.0018,.002],[0,.0026],[-.0018,.002]]},bloom:{base:.005,perShot:.004,max:.04,recovery:.13,moveFactor:0},reload:1.7,feel:{kick:[.03,.025,20],shot:[620,.09,'triangle',250],launch:[410,.12,'triangle',140],impact:[260,.16,'sine',80],tracer:[.14,.07],muzzle:[.14,.07],impactVisual:'orb'}},
  {name:'Grenade Launcher',short:'GRENADE',damage:30,splash:44,radius:3.5,speed:28,life:3,gravity:.65,bounce:.45,interval:.9,range:55,color:'#ff806b',ammo:6,cap:18,recoil:{kick:.045,recover:9,pattern:[[0,0],[.003,.005]]},bloom:{base:.004,perShot:.009,max:.05,recovery:.14,moveFactor:0},reload:2.5,feel:{arc:'high',impact:'heavy',kick:[.095,.075,10],shot:[210,.18,'sawtooth',45],launch:[130,.2,'sawtooth',32],impact:[72,.28,'sawtooth',25],tracer:[.18,.09],muzzle:[.21,.1],impactVisual:'burst'}},
  {name:'Shock Beam',short:'SHOCK',damage:44,interval:.6,range:52,falloff:{start:14,end:52,min:.55},color:'#8ce8ff',ammo:10,cap:30,recoil:{kick:.02,recover:13.5,pattern:[[0,0],[.002,.003]]},bloom:{base:.003,perShot:.006,max:.04,recovery:.14,moveFactor:.28},reload:1.9,feel:{trace:'instant',impact:'sharp',kick:[.055,.045,16],shot:[480,.1,'square',1100],launch:[480,.1,'square',1100],impact:[900,.08,'square',1500],tracer:[.18,.1],muzzle:[.15,.08],impactVisual:'spark'}},
  {name:'Flak Cannon',short:'FLAK',damage:6,pellets:12,spread:.19,interval:.84,range:22,falloff:{start:5,end:22,min:.4},color:'#ffd166',ammo:12,cap:36,recoil:{kick:.075,recover:10.5,pattern:[[0,0],[.005,.009]]},bloom:{base:.018,perShot:.016,max:.12,recovery:.16,moveFactor:.08},reload:2.0,feel:{range:'short',impact:'wide',kick:[.115,.09,11],shot:[95,.22,'triangle',30],launch:[95,.22,'triangle',30],impact:[80,.2,'triangle',25],tracer:[.12,.07],muzzle:[.26,.13],impactVisual:'wide'}},
  {name:'Marksman Rifle',short:'MARKSMAN',damage:38,interval:.46,range:80,falloff:{start:32,end:80,min:.72},color:'#ffd27a',ammo:10,cap:30,recoil:{kick:.028,recover:11.5,pattern:[[0,0],[.002,.004]]},bloom:{base:.002,perShot:.01,max:.03,recovery:.15,moveFactor:.025},reload:2.0,feel:{trace:'instant',impact:'sharp',kick:[.05,.045,14],shot:[700,.09,'square',420],launch:[700,.09,'square',420],impact:[1250,.06,'sine',1850],tracer:[.22,.1],muzzle:[.14,.07],impactVisual:'spark'}},
  {name:'Submachine Gun',short:'SMG',damage:7.5,interval:.058,range:35,falloff:{start:11,end:35,min:.55},color:'#8affc1',ammo:32,cap:96,recoil:{kick:.008,recover:17.5,pattern:[[0,0],[.001,.0022],[-.0012,.0026],[.0014,.003],[-.0012,.0032]]},bloom:{base:.007,perShot:.0038,max:.055,recovery:.16,moveFactor:.06},reload:1.4,feel:{kick:[.022,.02,22],shot:[540,.06,'square',180],launch:[540,.06,'square',180],impact:[900,.04,'sine',1200],tracer:[.06,.04],muzzle:[.1,.05]}},
];
// POWERUPS are consumed by core as timed actor modifiers. Contract: effect may
// contain speedMultiplier, damageMultiplier, armor, and/or cooldownMultiplier.
// duration is seconds; armor is a flat temporary armor value, and multipliers
// are applied to the matching actor stat while the powerup is active.
export const POWERUPS=[
  {id:'haste',name:'Haste',duration:6,color:'#72f1b8',description:'Move and fire faster — the giddy rush of a freshly topped-up token budget.',effect:{speedMultiplier:1.35,cooldownMultiplier:.7}},
  {id:'overcharge',name:'Overcharge',duration:5,color:'#ff8f70',description:'More damage per shot. The invoice arrives later, and that lag is acceptable.',effect:{damageMultiplier:1.35}},
  {id:'overshield',name:'Overshield',duration:8,color:'#75baff',description:'A slab of temporary armor. Pop-up ads sold separately.',effect:{armor:60}},
  {id:'recon',name:'Recon Pulse',duration:10,color:'#7fe7ff',description:'Reveals every enemy on your team radar, no matter the distance. The map, unmapped.',effect:{reveal:true}},
  {id:'cloak',name:'Cloak',duration:7,color:'#c8b6ff',description:'Bends light around you: bots cannot acquire you at range and you drop off enemy radar except up close.',effect:{cloak:true}},
];
// ---------------------------------------------------------------------------
// Economy pickups. These are a separate table from POWERUPS so the timed
// actor-modifier contract (and its pinned count) stays untouched. Core handles
// each id explicitly: `weaponUpgrade` promotes the holder one weapon tier for a
// window (with a full magazine) and reverts afterwards; `deployable` drops a
// friendly sentry turret at the pickup point. Both are deterministic.
// ---------------------------------------------------------------------------
export const ECONOMY_PICKUPS = Object.freeze([
 Object.freeze({id:'weaponUpgrade',name:'Weapon Upgrade',duration:12,color:'#ffd166',description:'A field promotion: your current weapon is swapped for the next tier up the rack, with a full magazine.'}),
 Object.freeze({id:'deployable',name:'Sentry Deployable',duration:18,color:'#8affc1',description:'Drops a friendly sentry turret that tracks and fires on the nearest enemy while it lasts.'}),
]);
export const ECONOMY_PICKUP_IDS = Object.freeze(ECONOMY_PICKUPS.map(pickup=>pickup.id));
export const economyPickup = id => ECONOMY_PICKUPS.find(pickup=>pickup.id===id) || null;
// Short tongue-in-cheek weapon blurbs, kept separate so the combat tuning above
// stays one continuous, diff-friendly table. Shown in settings and the arsenal.
const WEAPON_BLURBS=['The dependable starter. Infinite ammo, chirpy retort, zero excuses.','A dumb-fire party starter. Mind the splash or become the splash.','Charges a piercing beam into one very opinionated shot.','Eight pellets of “get out of my hallway.”','Superheated blue orbs that bounce downrange. Handle with vague respect.','Arcs a bouncy surprise around corners. The timer is a suggestion.','A crackling lightning hose for players who refuse to aim in a straight line.','Twelve shards of instant regret at point-blank range.','A hard-hitting semi-auto. One deep breath per customer.','Sprays a fast, forgiving curtain of small mistakes.'];
WEAPONS.forEach((weapon,index)=>{weapon.description=WEAPON_BLURBS[index];});
export const RULES={dt:1/60,timeLimit:300,fragLimit:15,speed:8,radius:.42,height:1.8,gravity:26,jump:8.6,respawn:2,protection:1.5};
export const validLoadout=(character,harness)=>CHARACTERS.some(c=>c.id===character)&&HARNESSES.some(h=>h.id===harness)&&(character!=='claude'||harness==='claudecode');
export const resolveLoadout=(character,harness)=>({character:CHARACTERS.some(c=>c.id===character)?character:'chatgpt',harness:character==='claude'?'claudecode':HARNESSES.some(h=>h.id===harness)?harness:'openclaw'});
