import test from 'node:test';
import assert from 'node:assert/strict';
import {register} from 'node:module';
import {readFile} from 'node:fs/promises';
import {renderToStaticMarkup} from 'react-dom/server';
import {resetMenuState,renderMenu} from './selection-menu-hooks.mjs';
import {CHARACTERS,HARNESSES} from '../game/data.mjs';
import {DEFAULT_CONFIG,normalizeConfig,quickStartRules,matchPlan} from '../game/config.mjs';
import {latticePracticeDefaults} from '../game/lattice-guide.mjs';
import {mapsForMode} from '../game/arenas.mjs';
import {operatorCard,specSheet} from '../game/class-ui.mjs';

register('./tsx-loader.mjs', import.meta.url);
register(`data:text/javascript,${encodeURIComponent(`
export async function resolve(specifier,context,nextResolve){
 if(specifier==='react'&&context.parentURL?.endsWith('/SelectionScreen.tsx'))return {url:${JSON.stringify(new URL('./selection-menu-hooks.mjs',import.meta.url).href)},shortCircuit:true};
 try{return await nextResolve(specifier,context);}catch(error){
  if(!specifier.startsWith('.'))throw error;
  for(const ext of ['.tsx','.ts']){try{return await nextResolve(specifier+ext,context);}catch{}}
  throw error;
 }
}
export async function load(url,context,nextLoad){
 if(url.endsWith('.module.css'))return {format:'module',source:'export default new Proxy({}, {get: (_, key) => String(key)});',shortCircuit:true};
 return nextLoad(url,context);
}
`)}`);
const {SelectionScreen}=await import('../app/ui/screens/SelectionScreen.tsx');

// Expand the real, hook-free presentational primitives to inspect buttons and
// invoke the component's actual handlers (no parallel copy of menu routing).
function nodes(element) {
 if(!element||typeof element!=='object')return [];
 if(Array.isArray(element))return element.flatMap(nodes);
 if(typeof element.type==='function')return nodes(element.type(element.props));
 return [element,...nodes(element.props?.children)];
}
function text(element) {
 if(element==null||typeof element==='boolean')return '';
 if(typeof element==='string'||typeof element==='number')return String(element);
 if(Array.isArray(element))return element.map(text).join('');
 return text(element.props?.children);
}
function setup(overrides={}) {
 resetMenuState();
 const calls=[];
 const spy=name=>(...args)=>calls.push({name,args});
 const ui={entered:true,ready:true,error:'',character:'claude',harness:'claudecode',CHARACTERS,HARNESSES,
  selected:CHARACTERS.find(c=>c.id==='claude'),power:HARNESSES.find(h=>h.id==='claudecode'),
  config:normalizeConfig({...DEFAULT_CONFIG,playerName:'Menu pilot'}),mapId:'lattice-slice',previewRef:{current:null},
  profile:{level:3},presets:[],demos:[],challenges:[],nextUnlocks:[],
  ...Object.fromEntries(['start','setConfig','setMapId','quickStart','startTraining','setSetupOpen','setSingleOpen','openBrowser','connectNet','chooseCharacter','setHarness','setNotice','shuffle','changeMode','openSettings','startSpectate','backToDemo','refreshDemos','loadPreset','deletePreset'].map(name=>[name,spy(name)])),...overrides};
 let tree=renderMenu(SelectionScreen,ui);
 const all=()=>nodes(tree);
 const button=pattern=>{
  const found=all().filter(node=>node.type==='button'&&(typeof pattern==='string'?(node.props['aria-label']??text(node))===pattern:pattern.test(node.props['aria-label']??text(node))));
  assert.equal(found.length,1,`one button matching ${pattern}`);return found[0];
 };
 return {ui,calls,all,button,html:()=>renderToStaticMarkup(tree),click(pattern){const target=button(pattern);assert.ok(!target.props.disabled,`${pattern} is enabled`);target.props.onClick();tree=renderMenu(SelectionScreen,ui);},rerender(){tree=renderMenu(SelectionScreen,ui);}};
}

test('landing prioritizes Play and discovery instead of operator/mode grids',()=>{
 const menu=setup();
 assert.equal(menu.button('Play').props['aria-current'],'page');
 assert.match(menu.html(),/Your next great match/);
 assert.match(menu.html(),/FEATURED EXPERIENCE/);
 assert.doesNotMatch(menu.html(),/panel--operator|panel--harness|RECOMMENDED FIRST MATCH|DAILY CHALLENGES/);
 for(const label of ['Loadout','Library',/^Online/,/^Training/,/^Custom match/,'EXPLORE LATTICE STRIKE','OPERATIONS · CO-OP','ENTER ARENA','MATCH SETUP'])menu.button(label);
 const preview=()=>menu.all().filter(n=>n.props?.ref===menu.ui.previewRef);
 assert.equal(preview().length,1);
 menu.click('Loadout');
 assert.equal(preview().length,1,'the preview host remains outside conditional route content');
 assert.match(menu.html(),/SHUFFLE LOADOUT \/ MAP/);
 assert.match(menu.html(),/Claude Code/);
 menu.click('Library');assert.equal(preview().length,1);
 menu.click('Play');assert.equal(preview().length,1);
});

test('loadout retains operator identity, compatible harness locks and saved presets',()=>{
 const preset={id:'p1',name:'Frontline',character:'claude',harness:'claudecode'};
 const menu=setup({presets:[preset]});menu.click('Loadout');
 for(const character of CHARACTERS){const card=menu.button(new RegExp(`^${character.name}:`));assert.ok(card.props['aria-label'].includes(operatorCard(character.id).roleLabel));}
 for(const harness of HARNESSES){const card=menu.button(new RegExp(`^${harness.name}:`));assert.equal(card.props.disabled,harness.id!=='claudecode');assert.ok(card.props['aria-label'].includes(specSheet(harness.id).tradeoff.name));}
 menu.click('Load preset Frontline');menu.click('Delete preset Frontline');
 assert.deepEqual(menu.calls.slice(-2),[{name:'loadPreset',args:[preset]},{name:'deletePreset',args:['p1']}]);
 menu.click(/SHUFFLE LOADOUT/);assert.equal(menu.calls.at(-1).name,'shuffle');
});

test('LATTICE briefing is non-destructive; deploy commits exactly the clean previewed preset',()=>{
 for(const [button,mode] of [['EXPLORE LATTICE STRIKE','cocs'],['OPERATIONS · CO-OP','cocs-coop']]){
  const config=normalizeConfig({...DEFAULT_CONFIG,playerName:'Veteran',mutators:['lowgrav'],speed:1.5});
  const menu=setup({config,mapId:'invalid-map'});
  menu.click(button);assert.deepEqual(menu.calls,[],'opening the briefing must not overwrite saved rules');
  assert.match(menu.html(),/RULES RESET · NO MODIFIERS/);assert.match(menu.html(),/LATTICE deployment briefing/);
  menu.click('Back to Play');assert.deepEqual(menu.calls,[],'back preserves saved configuration');
  menu.click(button);menu.click(mode==='cocs'?'DEPLOY LATTICE STRIKE':'DEPLOY OPERATIONS');
  const expected=quickStartRules({},mode,latticePracticeDefaults(mode),{playerName:config.playerName});
  assert.deepEqual(menu.calls,[{name:'setConfig',args:[expected]},{name:'setMapId',args:['lattice-slice']},{name:'start',args:[{character:'claude',harness:'claudecode',mapId:'lattice-slice',config:expected}]}]);
 }
});

test('training routes keep clean beginner rules and dedicated protected training handlers',()=>{
 const menu=setup({config:normalizeConfig({...DEFAULT_CONFIG,speed:1.5,playerName:'Learner'}),mapId:'invalid-map'});
 menu.click(/^Training/);
 assert.match(menu.html(),/PRACTICE · NO XP \/ CHALLENGES \/ HISTORY/);
 menu.click(/^Recommended first match:/);
 const rules=normalizeConfig({...DEFAULT_CONFIG,playerName:'Learner'});
 const launch=menu.calls.find(call=>call.name==='start').args[0];
 assert.deepEqual(launch.config,rules);assert.equal(launch.mapId,mapsForMode(rules.mode)[0].id);
 menu.click(/^LATTICE FIELD TRAINING:/);menu.click(/^OPERATIONS FIELD TRAINING:/);
 assert.deepEqual(menu.calls.filter(call=>call.name==='startTraining'),[{name:'startTraining',args:['cocs']},{name:'startTraining',args:['cocs-coop']}]);
});

test('arena launches preserve inherited rules and disclose map substitution',()=>{
 const config=normalizeConfig({...DEFAULT_CONFIG,speed:1.5,botCount:0});
 const menu=setup({config,mapId:'invalid-map'});menu.click(/^Arena quick starts/);
 assert.match(menu.html(),/SUBSTITUTED/);
 for(const mode of ['deathmatch','teamdeathmatch','ctf','koth','rockets','instagib','armsrace']){
  const rules=quickStartRules(config,mode,latticePracticeDefaults(mode));
  const plan=matchPlan(rules);
  menu.click(new RegExp(`^${plan.mode.name}:`));
  assert.deepEqual(menu.calls.at(-1),{name:'start',args:[{character:'claude',harness:'claudecode',mapId:mapsForMode(mode)[0].id,config:rules}]});
 }
});

test('online, custom, solo, library and settings use their existing owners',()=>{
 const menu=setup({netConnected:true});
 menu.click(/^Online/);menu.click('DISCONNECT FROM SERVER');menu.click(/^Custom match/);menu.click('Help & controls');
 assert.deepEqual(menu.calls.slice(0,4),[{name:'openBrowser',args:[]},{name:'connectNet',args:[]},{name:'setSetupOpen',args:[true]},{name:'openSettings',args:['help']}]);
 menu.click(/^Single player/);menu.click(/^Horde:/i);menu.click(/^Campaign:/i);menu.click('SINGLE PLAYER HUB');
 assert.deepEqual(menu.calls.slice(-3),[{name:'quickStart',args:['horde']},{name:'quickStart',args:['campaign']},{name:'setSingleOpen',args:[true]}]);
 menu.click('Library');menu.click(/^Theater/);menu.click(/^Field guide/);menu.click(/^Progression/);menu.click(/^Arsenal/);menu.click(/^Spectate:/);menu.click('BACK TO DEMO');menu.click('PATCH NOTES');
 assert.deepEqual(menu.calls.slice(-8),[{name:'changeMode',args:['theater']},{name:'refreshDemos',args:[]},{name:'openSettings',args:['help']},{name:'changeMode',args:['progression']},{name:'openSettings',args:['arsenal']},{name:'startSpectate',args:[]},{name:'backToDemo',args:[]},{name:'changeMode',args:['changelog']}]);
});

test('unready and error states disable every launch while discovery stays available',()=>{
 for(const state of [{ready:false},{error:'GPU unavailable'}]){
  const menu=setup(state);
  assert.equal(menu.button('ENTER ARENA').props.disabled,true);assert.equal(menu.button(/^Online/).props.disabled,true);
  menu.click('EXPLORE LATTICE STRIKE');assert.equal(menu.button('DEPLOY LATTICE STRIKE').props.disabled,true);
  menu.click('TRAIN FIRST');
  for(const button of menu.all().filter(n=>n.type==='button'&&/first match:|TRAINING:/i.test(n.props['aria-label']??'')))assert.equal(button.props.disabled,true);
  assert.deepEqual(menu.calls,[]);
 }
});

test('menu keeps native navigation/disclosures, route focus and touch-sized controls',async()=>{
 const menu=setup();assert.match(menu.html(),/<nav aria-label="Main menu"/);assert.match(menu.html(),/<details[^>]*><summary>Review rules<\/summary>/);
 const source=await readFile(new URL('../app/ui/screens/SelectionScreen.tsx',import.meta.url),'utf8');
 assert.match(source,/contentHeading\.current\?\.focus\(\{preventScroll:true\}\)/);
 assert.match(source,/<h1 ref=\{contentHeading\} tabIndex=\{-1\}/);
 const css=await readFile(new URL('../app/ui/screens/SelectionScreen.module.css',import.meta.url),'utf8');
 assert.match(css,/\.menu :global\(\.btn\), \.menu summary \{ min-height: 44px; \}/);
 assert.match(css,/button:focus-visible/);assert.match(css,/@media \(max-width: 520px\)/);assert.match(css,/@media \(prefers-reduced-motion: reduce\)/);
});
