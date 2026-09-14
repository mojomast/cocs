import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import {build} from 'esbuild';
import {singlePlayerDisplay,singlePlayerResult,singlePlayerSummary,missionBrief,campaignMissionPar,campaignMissionStars,campaignMissionView,campaignProgressSummary} from './singleplayer-ui.mjs';
import {HELP_SECTIONS} from './onboarding.mjs';

// Render a client component to static markup so its aria wiring is asserted the
// same way the browser would expose it. esbuild transpiles the TSX; the bundle
// keeps react external and resolves it from this repo's node_modules.
const repoRoot = new URL('../', import.meta.url);
const nodeRequire = createRequire(new URL('package.json', repoRoot));
async function renderSsr(relPath, componentName, propsExpr) {
  const entry = `import {renderToStaticMarkup} from 'react-dom/server';import {createElement} from 'react';import {${componentName}} from ${JSON.stringify(new URL(relPath, repoRoot).pathname)};export const html=renderToStaticMarkup(createElement(${componentName},${propsExpr}));`;
  const {outputFiles} = await build({stdin: {contents: entry, loader: 'tsx', resolveDir: repoRoot.pathname}, bundle: true, platform: 'node', format: 'cjs', jsx: 'automatic', write: false, logLevel: 'silent'});
  const module = {exports: {}};
  vm.runInThisContext('(function(exports,require,module){' + outputFiles[0].text + '\n})')(module.exports, nodeRequire, module);
  return module.exports.html;
}

const horde={config:{mode:'horde'},actors:[{id:0,x:0,z:0}],singleplayer:{kind:'horde',phase:'wave',wave:3,waveTarget:10,waveTimer:0,enemiesAlive:4,enemiesTotal:6,lives:2,kills:9,deaths:1,elapsed:42,objective:'Survive 10 hostile waves.',message:'Second wave through the doors.',winner:null,steps:[]}};
const campaign={
 config:{mode:'campaign'},
 actors:[{id:0,x:10,z:10}],
 singleplayer:{kind:'campaign',phase:'active',enemiesAlive:2,enemiesTotal:4,lives:3,kills:5,deaths:0,elapsed:80,
  objective:'Take the central reactor.',message:'',winner:null,
  story:{speaker:'DISPATCH',text:'Reactor is dead ahead.'},
  waypoint:{id:'reactor',x:40,z:10,label:'REACTOR'},
  steps:[{id:'a',label:'A',text:'Reach the outpost',active:false,done:true},{id:'b',label:'B',text:'Take the reactor',active:true,done:false}],
  hold:{seconds:20,progress:8},
  mission:{id:'reactor-run',name:'Reactor Run',tag:'ASSAULT',chapter:'ACT I',index:1,total:2,brief:'x',intro:{speaker:'DISPATCH',lines:['a']},outro:{speaker:'WARDEN',lines:['b']}},
  boss:{name:'WARDEN',hp:300,maxHp:450,alive:true}},
};

test('horde display adapts waves and enemy counts',()=>{
 const display=singlePlayerDisplay(horde);
 assert.equal(display.horde,true);
 assert.equal(display.title,'HORDE');
 assert.equal(display.enemiesLabel,'4 / 6');
 assert.equal(display.lives,2);
 assert.equal(display.story,null);
 assert.equal(display.waypoint,null);
 assert.equal(singlePlayerDisplay({}),null);
});

test('campaign display surfaces waypoint distance, steps, story and boss',()=>{
 const display=singlePlayerDisplay(campaign);
 assert.equal(display.horde,false);
 assert.equal(display.title,'Reactor Run');
 assert.equal(display.chapter,'ACT I');
 assert.equal(display.stepIndex,1);
 assert.equal(display.stepTotal,2);
 assert.equal(display.waypoint.label,'REACTOR');
 assert.equal(display.waypoint.distance,30);
 assert.equal(display.story.speaker,'DISPATCH');
 assert.equal(display.hold.seconds,20);
 assert.equal(display.boss.name,'WARDEN');
 assert.equal(display.boss.ratio,300/450);
 assert.equal(display.missionLabel,'ACT I 2 / 2');
});

 test('display adapter stays sane when economy and boss-phase fields ride along',()=>{
  const enriched={...horde,singleplayer:{...horde.singleplayer,upgrades:[{id:'haste',name:'Haste',color:'#72f1b8',description:'x'}],upgradeWave:3,upgradeSelected:'haste',upgradeCount:1,bossPhaseTotal:3}};
  const display=singlePlayerDisplay(enriched);
  assert.equal(display.horde,true);
  assert.equal(display.title,'HORDE');
  assert.equal(display.lives,2);
  assert.equal(display.boss,null);
  const bossDisplay=singlePlayerDisplay({...campaign,singleplayer:{...campaign.singleplayer,bossPhase:2,bossPhaseName:'OVERCLOCKED',boss:{...campaign.singleplayer.boss,phase:2,phaseName:'OVERCLOCKED',phases:3}}});
  assert.equal(bossDisplay.boss.name,'WARDEN');
  assert.equal(bossDisplay.boss.ratio,300/450);
 });

 test('results and summaries reflect win or loss',()=>{
 assert.equal(singlePlayerResult(horde),'OVERRUN.');
 assert.equal(singlePlayerResult({...horde,singleplayer:{...horde.singleplayer,winner:0}}),'YOU SURVIVED 10 WAVES.');
 assert.match(singlePlayerResult({...campaign,singleplayer:{...campaign.singleplayer,winner:1}}),/REACTOR RUN FAILED/);
 assert.match(singlePlayerSummary(horde),/2 of 10 waves/);
 assert.match(singlePlayerSummary({...campaign,singleplayer:{...campaign.singleplayer,winner:1}}),/Objective failed/);
 assert.equal(missionBrief(campaign).name,'Reactor Run');
 assert.equal(missionBrief({}),null);
});

 test('adapter forwards horde upgrades, boss phases, checkpoint and notices',()=>{
  const boss={name:'WARDEN',hp:200,maxHp:400,alive:true,phase:2,phaseName:'OVERCLOCKED',phases:3};
  const state={...campaign.singleplayer,boss,upgrades:[{id:'haste',name:'Haste',color:'#72f1b8',description:'x'}],upgradeWave:4,upgradeSelected:'haste',upgradeCount:2,checkpoint:{step:2,missionId:'reactor-run'},notice:{type:'horde-resupply',text:'RESUPPLIED · WAVE 4'}};
  const display=singlePlayerDisplay({...campaign,singleplayer:state});
  assert.deepEqual(display.upgrades,[{id:'haste',name:'Haste',color:'#72f1b8',description:'x'}]);
  assert.equal(display.upgradeWave,4);
  assert.equal(display.upgradeSelected,'haste');
  assert.equal(display.upgradeCount,2);
  assert.equal(display.bossPhase,2);
  assert.equal(display.bossPhaseName,'OVERCLOCKED');
  assert.equal(display.bossPhaseTotal,3);
  assert.equal(display.boss.phase,2);
  assert.equal(display.boss.phaseName,'OVERCLOCKED');
  assert.equal(display.boss.phases,3);
  assert.deepEqual(display.checkpoint,{step:2,missionId:'reactor-run'});
  assert.deepEqual(display.notice,{type:'horde-resupply',text:'RESUPPLIED · WAVE 4',tone:'accent'});
 });

 test('adapter derives a checkpoint from a numeric step and reads top-level hud notices',()=>{
  const display=singlePlayerDisplay({...campaign,singleplayer:{...campaign.singleplayer,checkpoint:3},singleNotice:{type:'enemy-detonate',text:'SAPPER DETONATION'}});
  assert.deepEqual(display.checkpoint,{step:3,missionId:'reactor-run'});
  assert.deepEqual(display.notice,{type:'enemy-detonate',text:'SAPPER DETONATION',tone:'danger'});
 });

 test('adapter defaults the upgrade, phase and checkpoint fields when absent',()=>{
  const display=singlePlayerDisplay(horde);
  assert.deepEqual(display.upgrades,[]);
  assert.equal(display.upgradeWave,null);
  assert.equal(display.upgradeSelected,null);
  assert.equal(display.upgradeCount,0);
  assert.equal(display.bossPhase,0);
  assert.equal(display.bossPhaseTotal,1);
  assert.equal(display.checkpoint,null);
  assert.equal(display.notice,null);
 });

 test('adapter accepts object selections and pending upgrade queues',()=>{
  const selected=singlePlayerDisplay({...horde,singleplayer:{...horde.singleplayer,upgrades:[{id:'haste',name:'Haste'}],upgradeSelected:{id:'haste',name:'Haste'}}});
  assert.equal(selected.upgradeSelected,'haste');
  const pending=singlePlayerDisplay({...horde,singleplayer:{...horde.singleplayer,upgrade:{pending:[{id:'armor',name:'Armor'}]}}});
  assert.deepEqual(pending.upgrades,[{id:'armor',name:'Armor'}]);
 });

 test('adapter normalises notice tones and drops empty notices',()=>{
  const withNotice=type=>singlePlayerDisplay({...horde,singleplayer:{...horde.singleplayer,notice:{type,text:'EVENT'}}});
  assert.equal(withNotice('horde-resupply').notice.tone,'accent');
  assert.equal(withNotice('enemy-detonate').notice.tone,'danger');
  assert.equal(withNotice('horde-upgrade-selected').notice.tone,'default');
  assert.equal(singlePlayerDisplay({...horde,singleplayer:{...horde.singleplayer,notice:{type:'horde-resupply'}}}).notice,null);
 });

 test('single-player HUD exposes screen-reader labels for the new controls',async()=>{
  const single={horde:true,phase:'wave',title:'HORDE',objective:'Survive 10 waves',enemiesLabel:'4 / 6',lives:2,kills:9,wave:3,waveTarget:10,stepTotal:3,
   upgrades:[{id:'haste',name:'Haste',description:'Move faster',color:'#72f1b8'},{id:'armor',name:'Plating',description:'Take less damage'}],upgradeWave:3,upgradeSelected:'haste',
   boss:{name:'WARDEN',hp:200,maxHp:400,ratio:.5,phase:2,phaseName:'OVERCLOCKED',phases:3},
   notice:{type:'enemy-detonate',text:'SAPPER DETONATION',tone:'danger'},checkpoint:{step:1}};
  const html=await renderSsr('app/game-ui/singleplayer-hud.tsx','SinglePlayerHud',`{single:${JSON.stringify(single)},onSelectUpgrade:()=>{},onResumeCheckpoint:()=>{}}`);
  assert.match(html,/role="region" aria-label="Mission status"/);
  assert.match(html,/aria-label="Wave upgrade choices"/);
  assert.match(html,/aria-pressed="true"/);
  assert.match(html,/aria-pressed="false"/);
  assert.match(html,/aria-label="Haste: Move faster"/);
  assert.match(html,/role="status" aria-label="Boss phase 2 of 3"/);
  assert.match(html,/aria-hidden="true"/);
  assert.match(html,/sp-notice sp-notice--danger" role="status" aria-live="polite"/);
  assert.match(html,/aria-label="Resume from checkpoint 2 of 3"/);
 });

 test('theater filters expose labelled select controls',async()=>{
  const ui={demos:[],getMap:()=>undefined,clock:value=>String(value),changeMode:()=>{},headActions:null,CAMERA_RIGS:[]};
  const html=await renderSsr('app/ui/screens/TheaterScreen.tsx','TheaterScreen',`{ui:${JSON.stringify(ui)}}`);
  assert.match(html,/LIBRARY FILTERS/);
  for(const label of ['Mode','Map','Sort'])assert.match(html,new RegExp(`<select aria-label="${label}"`),label);
 });

 test('help legend covers the systems added on top of the core loop',()=>{
  const byId=id=>HELP_SECTIONS.find(section=>section.id===id);
  for(const id of ['modes','horde','challenges','theater','access'])assert.ok(byId(id),id);
  const modes=byId('modes').items.join(' ');
  for(const name of ['JUGGERNAUT','TEAM ELIMINATION','VIP ESCORT','PAYLOAD','ASSAULT'])assert.match(modes,new RegExp(name),name);
  assert.match(byId('horde').items.join(' '),/UPGRADE/i);
  assert.match(byId('challenges').items.join(' '),/rotates every day/i);
  assert.match(byId('theater').items.join(' '),/HIGHLIGHTS/);
  for(const section of HELP_SECTIONS){assert.ok(section.title.length>0,section.id);assert.ok(section.items.length>=2,section.id);}
 });

 test('settings help renders the new-systems legend as an accessible list',async()=>{
  const sections=[{id:'modes',title:'OBJECTIVE MODES',summary:'Team modes with a twist.',items:['JUGGERNAUT · hold the crown and bank points.','TEAM ELIMINATION · every death burns a shared ticket.']}];
  const html=await renderSsr('app/ui/screens/SettingsDialog.tsx','HelpSections',`{sections:${JSON.stringify(sections)}}`);
  assert.match(html,/class="help-sections"/);
  assert.match(html,/OBJECTIVE MODES/);
  assert.match(html,/Team modes with a twist\./);
  assert.match(html,/<ul class="help-list">/);
  assert.match(html,/<li>JUGGERNAUT · hold the crown and bank points\.<\/li>/);
 });

 test('campaign mission select derives stars, locks and best results',()=>{
  const missions=[
   {id:'a',name:'One',chapter:'ACT I',tag:'ESCORT',brief:'first',steps:[{id:'s1'},{id:'s2'}]},
   {id:'b',name:'Two',chapter:'ACT I',tag:'ASSAULT',brief:'second',steps:[{id:'s1'}]},
   {id:'c',name:'Three',chapter:'ACT II',tag:'FINALE',brief:'third',steps:[]},
  ];
  const progress={completed:{a:{wins:1,attempts:1,bestTime:100,bestScore:5,at:1}}};
  const parA=campaignMissionPar(missions[0]);
  assert.equal(parA,120+2*45);
  assert.equal(campaignMissionStars(progress.completed.a,parA),3,'beating par is three stars');
  assert.equal(campaignMissionStars({bestTime:parA*1.4},parA),2);
  assert.equal(campaignMissionStars({bestTime:parA*9},parA),1);
  assert.equal(campaignMissionStars(null,parA),0);
  const view=campaignMissionView(missions,progress,'b');
  assert.deepEqual(view.map(v=>v.id),['a','b','c']);
  assert.equal(view[0].unlocked,true);
  assert.equal(view[1].unlocked,true,'completing the prior mission unlocks the next');
  assert.equal(view[2].unlocked,false,'the finale stays locked until mission two is done');
  assert.equal(view[1].selected,true);
  assert.equal(view[0].stars,3);
  assert.equal(view[1].completed,false);
  assert.equal(view[1].stars,0);
  assert.equal(view[2].completed,false);
  assert.deepEqual(campaignMissionView([],{},null),[]);
  const summary=campaignProgressSummary(missions,progress);
  assert.equal(summary.total,3);
  assert.equal(summary.done,1);
  assert.equal(summary.stars,3);
  assert.equal(summary.maxStars,9);
  assert.equal(summary.ratio,1/3);
  assert.deepEqual(campaignProgressSummary([],{}),{total:0,done:0,stars:0,maxStars:0,ratio:0});
 });

 test('campaign mission select renders locked and replay affordances',async()=>{
  const ui={
   singleOpen:true,setSingleOpen:()=>{},singleSub:'campaign',setSingleSub:()=>{},singleMission:'b',setSingleMission:()=>{},
   config:{difficulty:'normal'},setConfig:()=>{},mapId:'convoy-line',setMapId:()=>{},selectedMap:{name:'Convoy Line',tag:'ESCORT'},
   startSinglePlayer:()=>{},startCampaignMission:()=>{},mapsForMode:()=>[],missionFor:(id)=>id==='b'?{id:'b',name:'Two',mapId:'titan-valley',chapter:'ACT I',tag:'ASSAULT',brief:'second',intro:{speaker:'DISPATCH',lines:['go']},steps:[{id:'s1',text:'Do the thing'}]}:null,
   isMissionUnlocked:()=>true,getMap:()=>({name:'Titan Valley'}),legacyMaps:false,campaign:{},DIFFICULTIES:[{id:'normal',name:'Normal'}],ready:true,error:'',singleRef:{current:null},
   campaignMissions:[
    {id:'a',name:'Mission One',chapter:'ACT I',tag:'ESCORT',brief:'first',unlocked:true,completed:true,stars:3,bestTime:100,bestScore:5,attempts:1,parTime:240,selected:false},
    {id:'b',name:'Mission Two',chapter:'ACT I',tag:'ASSAULT',brief:'second',unlocked:true,completed:false,stars:0,bestTime:null,bestScore:null,attempts:0,parTime:165,selected:true},
    {id:'c',name:'Mission Three',chapter:'ACT II',tag:'FINALE',brief:'third',unlocked:false,completed:false,stars:0,bestTime:null,bestScore:null,attempts:0,parTime:120,selected:false},
   ],
  };
  const html=await renderSsr('app/ui/screens/SetupModals.tsx','SinglePlayerModal',`{ui:{...${JSON.stringify(ui)},missionFor:(id)=>({id,name:'Mission Two',mapId:'titan-valley',chapter:'ACT I',tag:'ASSAULT',brief:'second',parTime:165,intro:{speaker:'DISPATCH',lines:['go']},steps:[{id:'s1',text:'Do the thing'}]})}}`);
  assert.match(html,/Campaign mission select/);
  assert.match(html,/REPLAY/);
  assert.match(html,/aria-label="Mission One: 3 of 3 stars"/);
  assert.match(html,/aria-label="Mission Three: locked"/);
  assert.match(html,/ACT II/);
 });

 test('results medals render as an accessible list with per-medal detail',async()=>{
  const awards=[
   {id:'mvp',label:'MATCH MVP',name:'ChatGPT',value:'12 FRAGS'},
   {id:'captures',label:'MOST CAPTURES',name:'ChatGPT',value:'3 CAP'},
   {id:'accuracy',label:'BEST ACCURACY',name:'Claude',value:'90%'},
   {id:'flawless',label:'UNTOUCHABLE · NO DEATHS',name:'Claude',value:'0 DEATHS'},
  ];
  const html=await renderSsr('app/ui/screens/ResultModals.tsx','MedalStrip',`{awards:${JSON.stringify(awards)},player:{name:'ChatGPT'}}`);
  assert.match(html,/role="list" aria-label="Match medals"/);
  assert.match(html,/role="listitem" aria-label="MOST CAPTURES: ChatGPT, 3 CAP"/);
  assert.match(html,/role="listitem" aria-label="BEST ACCURACY: Claude, 90%"/);
  assert.match(html,/UNTOUCHABLE · NO DEATHS/);
  assert.match(html,/medal--flawless/);
  assert.match(html,/class="medal medal--mvp you"/);
  const empty=await renderSsr('app/ui/screens/ResultModals.tsx','MedalStrip',`{awards:[],player:null}`);
  assert.match(empty,/collect medals/);
 });

 test('arsenal inspector exposes weapons, operators, attachments and cosmetics',async()=>{
  const ui={settings:true,setSettings:()=>{},prefs:null,profile:{level:5},weaponRangeLabel:(w)=>`MID · ${w.range}m`,
   WEAPONS:[{name:'Pulse Rifle',short:'PULSE',damage:11,interval:.09,range:70,color:'#70ffe6',description:'Starter.'}],
   CHARACTERS:[{id:'chatgpt',name:'ChatGPT',tag:'PLEASER',color:'#57e6cd',detail:'Helps.',stats:{health:100,armor:0,speed:8}}],
   ATTACHMENTS:[{id:'holo-sight',slot:'optic',name:'Holo Sight',description:'Zoom.',level:2,weapons:[0,1]}],
   ATTACHMENT_SLOTS:[{id:'optic',name:'Optic'}],GEAR:[{id:'scope',slot:'primary',name:'Scope',description:'x',level:2,modifiers:{}}],GEAR_SLOTS:[{id:'primary',name:'Weapon Kit'}],
   WEAPON_FINISHES:[{id:'finish-ion',name:'Ion',kind:'finish',level:10,description:'Shiny.'}],
   CROSSHAIR_STYLES:[{id:'cross',name:'Cross',level:1,description:'Plain.'}],
   REPO_URL:'https://github.com/mojomast/tokenarena',helpSections:[],settingsTab:'arsenal',setSettingsTab:()=>{}};
  const html=await renderSsr('app/ui/screens/SettingsDialog.tsx','SettingsDialog',`{ui:{...${JSON.stringify(ui)},weaponRangeLabel:(w)=>\`MID · \${w.range}m\`}}`);
  assert.match(html,/OPERATOR LEVEL 5/);
  assert.match(html,/Pulse Rifle/);
  assert.match(html,/MID · 70m/);
  assert.match(html,/role="tablist" aria-label="Settings sections"/);
  assert.match(html,/role="tablist" aria-label="Arsenal category"/);
  assert.match(html,/1 OPERATORS · 1 WEAPONS/);
 });

 test('spectator board groups teams, shows lives and marks the followed target',async()=>{
  const groups=[
   {key:'t0',team:0,label:'RED TEAM',score:4,lives:2,players:[{id:0,name:'ChatGPT',health:80,current:true,juggernaut:true,points:9}]},
   {key:'t1',team:1,label:'BLUE TEAM',score:1,lives:3,players:[{id:1,name:'Grok',health:60,current:false,juggernaut:false,points:0}]},
  ];
  const html=await renderSsr('app/ui/screens/PlayingHud.tsx','SpectatorBoard',`{groups:${JSON.stringify(groups)},objective:{title:'TEAM ELIMINATION',line:'TEAM LIVES REMAINING'},onFollow:()=>{}}`);
  assert.match(html,/role="group" aria-label="Spectator targets"/);
  assert.match(html,/RED TEAM/);
  assert.match(html,/BLUE TEAM/);
  assert.match(html,/spectator-group-label/);
  assert.match(html,/2 LIVES/);
  assert.match(html,/3 LIVES/);
  assert.match(html,/TEAM ELIMINATION/);
  assert.match(html,/aria-pressed="true"/);
  assert.match(html,/aria-pressed="false"/);
  assert.match(html,/aria-label="Follow ChatGPT \(current\) · crown holder"/);
  assert.match(html,/CROWN/);
 });
