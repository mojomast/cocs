import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import {raceDisplay,raceStandings,raceResult,raceTime} from './race-ui.mjs';
import {ArenaView,raceTrackModel} from './view.mjs';
import {PUMA_CIRCUIT} from './race-maps.mjs';
import {readFile} from 'node:fs/promises';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import ts from 'typescript';
import {DEFAULT_CONFIG} from './config.mjs';

test('race and combat HUDs render one shared online chat with working Enter and Escape',async()=>{
 const file=new URL('../app/page.tsx',import.meta.url),source=await readFile(file,'utf8'),ast=ts.createSourceFile(file.pathname,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);let hudNode;
 const find=node=>{if(ts.isJsxExpression(node)&&node.expression?.getText(ast).startsWith("(mode==='playing'||mode==='paused')"))hudNode=node.expression;ts.forEachChild(node,find);};find(ast);assert.ok(hudNode);
 // Retain the actual chat markup and its enclosing mode/HUD conditions; omit
 // unrelated combat widgets rather than mocking their dozens of dependencies.
 const transformed=ts.transform(hudNode,[context=>{
  const empty=()=>ts.factory.createJsxFragment(ts.factory.createJsxOpeningFragment(),[],ts.factory.createJsxJsxClosingFragment());
  const visit=node=>{
   if(ts.isJsxElement(node)&&node.openingElement.getText(ast).includes('game-chat '))return node;
   if((ts.isJsxElement(node)||ts.isJsxSelfClosingElement(node))&&!node.getText(ast).includes('game-chat '))return empty();
   if(ts.isJsxExpression(node)&&!node.getText(ast).includes('game-chat '))return ts.factory.createJsxExpression(undefined,undefined);
   return ts.visitEachChild(node,visit,context);
  };return node=>ts.visitNode(node,visit);
 }]);
 const expression=ts.createPrinter().printNode(ts.EmitHint.Expression,transformed.transformed[0],ast);transformed.dispose();
 const {outputText}=ts.transpileModule(`export function renderHud({mode,player,isRace,hud,hideHud=false,chatOpen,chatLog,chatInputRef,chatDraft,sendChat,setChatOpen,setChatDraft}){return (${expression});}`,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext}});
 const executable=outputText.replace('"react/jsx-runtime"',JSON.stringify(import.meta.resolve('react/jsx-runtime'))),{renderHud}=await import(`data:text/javascript;base64,${Buffer.from(executable).toString('base64')}`);
 const nodes=element=>!element||typeof element!=='object'?[]:[element,...[element.props?.children].flat(Infinity).flatMap(nodes)];
 for(const isRace of [true,false]){
  let sent=0,closed=false,stopped=0;const props={mode:'playing',player:{id:7},isRace,hud:{net:true},chatOpen:true,chatLog:[{name:'Driver',text:'Ready to race'}],chatInputRef:{current:null},chatDraft:'Hello',sendChat:()=>sent++,setChatOpen:value=>{closed=value===false;},setChatDraft(){}};
  const tree=renderHud(props),html=renderToStaticMarkup(tree);assert.equal((html.match(/class="game-chat /g)??[]).length,1);assert.equal((html.match(/aria-label="Chat message"/g)??[]).length,1);assert.ok(html.includes('Ready to race'));
  const input=nodes(tree).find(node=>node.type==='input');input.props.onKeyDown({key:'Enter',stopPropagation:()=>stopped++});input.props.onKeyDown({key:'Escape',stopPropagation:()=>stopped++});assert.equal(sent,1);assert.equal(closed,true);assert.equal(stopped,2);
  const collapsed=renderToStaticMarkup(renderHud({...props,chatOpen:false}));assert.equal((collapsed.match(/class="game-chat /g)??[]).length,1);assert.ok(collapsed.includes('T / ENTER'));assert.ok(!collapsed.includes('Chat message'));
  assert.ok(!renderToStaticMarkup(renderHud({...props,hud:{net:false}})).includes('game-chat'));
 }
});

test('race display uses official positions, laps and winner, never frags or practice',()=>{
 const snapshot={config:{mode:'puma-race',botCount:0},actors:[{id:0,name:'You',frags:100},{id:2,name:'Rival',frags:0}],race:{phase:'countdown',countdown:2.2,laps:3,elapsed:0,winnerId:null,gates:Array(12),standings:[{actorId:0,position:2,lap:2,completedLaps:1,nextGate:4,finishTime:null,item:'oil',effects:{turbo:1.2,shield:0}},{actorId:2,position:1,lap:3,completedLaps:2,nextGate:0,finishTime:null}]}};
 assert.deepEqual(raceStandings(snapshot).map(r=>r.actorId),[2,0]);assert.equal(snapshot.race.standings[0].actorId,0);
 const display=raceDisplay(snapshot,0);assert.equal(display.position,2);assert.equal(display.countdown,'3');assert.equal(display.checkpoint,5);assert.equal(display.item,'OIL SLICK');assert.equal(display.effects,'TURBO 1.2s');
 snapshot.race.phase='finished';snapshot.race.winnerId=2;assert.equal(raceResult(snapshot,0),'Rival WINS.');snapshot.race.winnerId=0;assert.equal(raceResult(snapshot,0),'YOU WIN THE RACE.');snapshot.race.winnerId=null;assert.equal(raceResult(snapshot,0),'RACE COMPLETE.');
});
test('race time and absent snapshot are readable',()=>{assert.equal(raceTime(61.25),'01:01.25');assert.equal(raceTime(-1),'00:00.00');assert.equal(raceDisplay(null).item,'NO ITEM');});
test('race display exposes coins, friendly item labels and star effects',()=>{
 const labelSnapshot=id=>({config:{mode:'puma-race'},race:{phase:'racing',elapsed:5,laps:3,gates:Array(12),standings:[{actorId:0,position:1,lap:1,nextGate:0,item:id,coins:6,effects:{star:2.1}}]}});
 for(const [id,label] of [['turbo','TURBO'],['shield','SHIELD'],['oil','OIL SLICK'],['pulse','HOMING PULSE'],['mine','MINE'],['triple','TRIPLE PULSE'],['bolt','LIGHTNING'],['star','STAR']])assert.equal(raceDisplay(labelSnapshot(id),0).item,label);
 const display=raceDisplay(labelSnapshot('triple'),0);assert.equal(display.coins,6);assert.equal(display.effects,'STAR 2.1s');
 assert.equal(raceDisplay({race:{standings:[{actorId:0,position:1}]}},0).coins,0);assert.equal(raceDisplay(null).coins,0);
});
test('rendered race HUD shows a COINS readout and friendly item labels',async()=>{
 const file=new URL('../app/page.tsx',import.meta.url),source=await readFile(file,'utf8'),ast=ts.createSourceFile(file.pathname,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);let hud;
 const find=node=>{if(ts.isJsxElement(node)&&node.openingElement.getText(ast).includes('race-hud'))hud=node;ts.forEachChild(node,find);};find(ast);assert.ok(hud);
 const markup=ts.createPrinter().printNode(ts.EmitHint.Expression,hud,ast);
 const {outputText}=ts.transpileModule(`import {raceDisplay} from '${new URL('./race-ui.mjs',import.meta.url).href}';export function renderRaceHud({race,touchControls,raceControls}){return (${markup});}`,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext}});
 const executable=outputText.replace('"react/jsx-runtime"',JSON.stringify(import.meta.resolve('react/jsx-runtime'))),{renderRaceHud}=await import(`data:text/javascript;base64,${Buffer.from(executable).toString('base64')}`);
 const snapshotFor=id=>({config:{mode:'puma-race'},race:{phase:'racing',elapsed:5,gates:Array(12),standings:[{actorId:0,position:1,lap:1,nextGate:0,item:id,coins:7,effects:{star:2.1}}]}});
 const render=id=>renderToStaticMarkup(renderRaceHud({race:raceDisplay(snapshotFor(id),0),touchControls:false,raceControls:''}));
 const html=render('triple');assert.ok(html.includes('COINS'));assert.ok(html.includes('>7<'));assert.ok(html.includes('TRIPLE PULSE'));assert.ok(html.includes('STAR 2.1s'));
 for(const [id,label] of [['turbo','TURBO'],['shield','SHIELD'],['oil','OIL SLICK'],['pulse','HOMING PULSE'],['mine','MINE'],['triple','TRIPLE PULSE'],['bolt','LIGHTNING'],['star','STAR']])assert.ok(render(id).includes(label),label);
});
test('persisted eight-driver history keeps names and never labels actor zero as YOU',async()=>{
 const standings=Array.from({length:8},(_,actorId)=>({actorId,position:8-actorId,completedLaps:3,finishTime:90+actorId}));
 const history={mode:'puma-race',race:{standings,laps:3,phase:'finished',winnerId:7},players:standings.map(row=>({actorId:row.actorId,name:`Driver ${row.actorId}`,race:row})).reverse()};
 assert.deepEqual(raceStandings(history).map(row=>row.name),Array.from({length:8},(_,i)=>`Driver ${7-i}`));assert.equal(raceResult(history,null),'Driver 7 WINS.');
 const file=new URL('../app/page.tsx',import.meta.url),source=await readFile(file,'utf8'),ast=ts.createSourceFile(file.pathname,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);let declaration;
 const visit=node=>{if(ts.isVariableDeclaration(node)&&node.name.getText(ast)==='renderScoreboard')declaration=node;ts.forEachChild(node,visit);};visit(ast);assert.ok(declaration);
 const {outputText}=ts.transpileModule(`import {raceStandings,raceTime} from '${new URL('./race-ui.mjs',import.meta.url).href}';export const ${declaration.getText(ast)};`,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext}});
 const executable=outputText.replace('"react/jsx-runtime"',JSON.stringify(import.meta.resolve('react/jsx-runtime'))),{renderScoreboard}=await import(`data:text/javascript;base64,${Buffer.from(executable).toString('base64')}`);
 const html=renderToStaticMarkup(renderScoreboard(history,true));for(const player of history.players)assert.ok(html.includes(player.name));assert.ok(!html.includes('YOU'));assert.ok(!html.includes('race-score-row you'));
 assert.ok(renderToStaticMarkup(renderScoreboard({...history,actorId:3},false)).includes('Driver 3 / YOU'));
});
test('circuit geometry has eight oriented slots and twelve passable frames',()=>{
 const model=raceTrackModel(PUMA_CIRCUIT.race,PUMA_CIRCUIT.color),slots=model.children.filter(n=>n.userData.raceGrid!==undefined),gates=model.children.filter(n=>n.userData.raceGate!==undefined);
 assert.equal(slots.length,8);assert.equal(gates.length,12);assert.equal(slots[0].rotation.y,Math.PI/2);
 assert.equal(gates[0].children.length,3);assert.equal(gates[0].children[0].position.x,-12);assert.equal(gates[0].children[1].position.x,12);
 model.traverse(n=>{assert.equal(n.userData.objective,true);if(n.geometry)assert.ok([...n.geometry.attributes.position.array].every(Number.isFinite));});ArenaView.prototype.disposeObject.call({},model);
});
test('live boxes hide on collection and expired hazards are disposed',()=>{
 const view=Object.assign(Object.create(ArenaView.prototype),{worldGroup:new T.Group(),reduced:()=>true});
 const match={race:{boxes:[{id:'a',x:4,z:6,ready:true}],hazards:[{id:'b',x:8,z:9,ttl:2}]}};view.updateRace(match,0);assert.equal(view.raceModels.size,2);assert.equal(view.raceModels.get('box:a').visible,true);
 let disposed=false;view.raceModels.get('oil:b').children[0].geometry.addEventListener('dispose',()=>{disposed=true;});match.race.boxes[0].ready=false;match.race.hazards=[];view.updateRace(match,1);assert.equal(view.raceModels.get('box:a').visible,false);assert.equal(disposed,true);view.updateRace({},2);assert.equal(view.worldGroup.children.length,0);
});
test('local match boxes use their authoritative cooldown',()=>{
 const view=Object.assign(Object.create(ArenaView.prototype),{worldGroup:new T.Group(),reduced:()=>true}),match={race:{boxes:[{id:'local',x:0,z:0,wait:0}],hazards:[]}};
 view.updateRace(match,0);assert.equal(view.raceModels.get('box:local').visible,true);match.race.boxes[0].wait=2;view.updateRace(match,1);assert.equal(view.raceModels.get('box:local').visible,false);view.updateRace({},2);
});
test('race ground and barriers have distinct batched materials without changing collision geometry',t=>{
 const previous=Object.getOwnPropertyDescriptor(globalThis,'document');Object.defineProperty(globalThis,'document',{configurable:true,value:{createElement:()=>({getContext:()=>({fillRect(){},fillText(){}})})}});
 t.after(()=>{if(previous)Object.defineProperty(globalThis,'document',previous);else delete globalThis.document;});
 const view=Object.assign(Object.create(ArenaView.prototype),{scene:new T.Scene(),renderer:{isSoftware:true},renderResources:new Set(),reduced:()=>true});view.buildArena(PUMA_CIRCUIT);
 const children=view.worldGroup.children,blocks=children.filter(n=>Number.isInteger(n.userData.block)),colors=new Map();
 assert.equal(blocks.length,PUMA_CIRCUIT.blocks.length);
 for(const mesh of blocks){const b=PUMA_CIRCUIT.blocks[mesh.userData.block];colors.set(b.kind,mesh.material.color.getHexString());assert.deepEqual(mesh.position.toArray(),[b.x,b.h/2,b.z]);assert.deepEqual([mesh.geometry.parameters.width,mesh.geometry.parameters.height,mesh.geometry.parameters.depth],[b.w,b.h,b.d]);}
 assert.equal(colors.get('race-rail'),'e78b30');assert.equal(colors.get('race-infield'),'203b30');assert.equal(colors.get('race-apron'),'171e28');
 const floor=children.find(n=>n.isMesh&&n.position.y===-.25);assert.equal(floor.material.color.getHexString(),PUMA_CIRCUIT.floorColor.slice(1));
 const details=children.filter(n=>n.userData.arenaDetail);assert.ok(details.length<=8);assert.ok(details.some(n=>n.material.color.getHexString()==='f4eddb'));
 const resources=new Set(view.renderResources);view.worldGroup.traverse(n=>{if(n.geometry)resources.add(n.geometry);if(n.material){resources.add(n.material);if(n.material.map)resources.add(n.material.map);}});const counts=new Map();for(const resource of resources){counts.set(resource,0);resource.addEventListener('dispose',()=>counts.set(resource,counts.get(resource)+1));}
 view.buildArena(PUMA_CIRCUIT);assert.ok([...counts.values()].every(count=>count===1));view.disposeObject(view.worldGroup);for(const resource of view.renderResources)resource.dispose();
});
test('race chase follows the local network slot and the selected spectator vehicle',t=>{
 const previous=Object.getOwnPropertyDescriptor(globalThis,'window');Object.defineProperty(globalThis,'window',{configurable:true,value:{}});t.after(()=>{if(previous)Object.defineProperty(globalThis,'window',previous);else delete globalThis.window;});
 const view=Object.assign(Object.create(ArenaView.prototype),{scene:new T.Scene(),worldGroup:new T.Group(),camera:new T.PerspectiveCamera(),hands:new T.Group(),renderer:{render(){}},resize(){},actorModels:new Map(),pickupModels:[],playerId:7,currentWeapon:-1,lastEvent:0,motionQuery:{matches:true}});view.scene.add(view.worldGroup,view.camera);view.camera.add(view.hands);
 const actors=[{id:0,vehicleId:10,weapon:0,health:100,x:0,y:0,z:0},{id:7,vehicleId:17,weapon:0,health:100,x:40,y:0,z:20}],vehicles=[{id:10,kind:'puma',x:0,y:0,z:0,yaw:0},{id:17,kind:'puma',x:40,y:0,z:20,yaw:Math.PI/2}],match={actors,vehicles,race:{boxes:[],hazards:[]},time:1};
 view.render('playing',match,.016,1);assert.ok(view.camera.position.distanceTo(new T.Vector3(31,5,20))<1e-9);assert.equal(view.hands.visible,false);
 view.spectator=true;view.spectatorTarget=0;view.render('playing',match,.016,1);assert.deepEqual(view.camera.position.toArray(),[0,5,-9]);view.disposeObject(view.scene);for(const resource of view.sharedResources??[])resource.dispose();
});
test('title selection with null gameplay follows the showcase Puma in cinematic mode',t=>{
 const previous=Object.getOwnPropertyDescriptor(globalThis,'window');Object.defineProperty(globalThis,'window',{configurable:true,value:{}});t.after(()=>{if(previous)Object.defineProperty(globalThis,'window',previous);else delete globalThis.window;});
 const view=Object.assign(Object.create(ArenaView.prototype),{scene:new T.Scene(),worldGroup:new T.Group(),camera:new T.PerspectiveCamera(),hands:new T.Group(),renderer:{render(){}},resize(){},actorModels:new Map(),pickupModels:[],playerId:-1,currentWeapon:-1,lastEvent:0,motionQuery:{matches:true},_renderPreview(){}});view.scene.add(view.worldGroup,view.camera);view.camera.add(view.hands);
 const racePuma={id:0,kind:'puma',x:40,y:2,z:20,yaw:Math.PI/2};
 view.setShowcase({actors:[{id:0,vehicleId:0,weapon:0,health:100,x:40,y:2,z:20}],vehicles:[racePuma],race:{boxes:[],hazards:[]},time:4});
 view.setCinema(true);view.setDirector({tour:true,update:()=>({x:100,y:100,z:100,pitch:0,yaw:0,fov:70})});
 for(const x of [40,55]){
  racePuma.x=x;view.render('selection',null,.016,4);
  assert.ok(view.camera.position.distanceTo(new T.Vector3(x-9,7,20))<1e-9);
  const target=new T.Vector3(x+6,3,20).sub(view.camera.position).normalize();assert.ok(view.camera.getWorldDirection(new T.Vector3()).distanceTo(target)<1e-9);
  assert.equal(view.hands.visible,false);assert.equal(view.playerId,-1);
 }
 view.disposeObject(view.scene);for(const resource of view.sharedResources??[])resource.dispose();
});
test('race touch UI exposes item reset and brake without combat actions',async()=>{
 const file=new URL('../app/game-ui/touch-controls.tsx',import.meta.url),source=await readFile(file,'utf8');
 const {outputText}=ts.transpileModule(source,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext}});
 const executable=outputText.replace(/from (["'])([^"']+)\1/g,(_,quote,specifier)=>`from ${quote}${specifier.startsWith('.')?new URL(specifier,file).href:import.meta.resolve(specifier)}${quote}`);
 const {TouchControls}=await import(`data:text/javascript;base64,${Buffer.from(executable).toString('base64')}`);
 const html=renderToStaticMarkup(createElement(TouchControls,{runtime:{current:{}},visible:true,mode:'puma-race',onLook(){},onSwap(){},onPause(){}}));
 for(const label of ['USE ITEM','RESET','BRAKE'])assert.ok(html.includes(label));
 for(const action of ['ads','reload','swap','grenade','melee','jump'])assert.ok(!html.includes(`touch-${action}`));
});
test('rendered race setup offers 0-7 rivals without difficulty and defaults only on mode entry',async()=>{
 // Load the real TSX and its UI wrappers without running a production build.
 const modules=new Map();
 const load=async file=>{
  if(modules.has(file.href))return modules.get(file.href);
  const source=await readFile(file,'utf8');let {outputText}=ts.transpileModule(source,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext}});
  for(const match of [...outputText.matchAll(/from (["'])([^"']+)\1/g)]){
   const specifier=match[2];let resolved;
   if(specifier.startsWith('@/')){const local=new URL(`../${specifier.slice(2)}${specifier.startsWith('@/lib/')?'.ts':'.tsx'}`,import.meta.url);resolved=await load(local);}
   else resolved=specifier.startsWith('.')?new URL(specifier,file).href:import.meta.resolve(specifier);
   outputText=outputText.replace(match[0],`from ${JSON.stringify(resolved)}`);
  }
  const url=`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`;modules.set(file.href,url);return url;
 };
 const {MatchConfiguration}=await import(await load(new URL('../app/game-ui/configuration.tsx',import.meta.url)));
 let changed;const onChange=value=>{changed=value;},config={...DEFAULT_CONFIG,mode:'puma-race',botCount:0};
 const html=renderToStaticMarkup(createElement(MatchConfiguration,{config,onChange}));
 assert.match(html,/Rival drivers<output>0<\/output>/);assert.match(html,/aria-valuemin="0"/);assert.match(html,/aria-valuemax="7"/);assert.ok(!html.includes('Bot difficulty'));assert.ok(!html.includes('Starting weapon'));assert.match(html,/human drivers replace excess bots/);assert.equal(changed,undefined);
 const normal=renderToStaticMarkup(createElement(MatchConfiguration,{config:{...DEFAULT_CONFIG,mode:'deathmatch'},onChange}));assert.ok(normal.includes('Bot difficulty'));
 const nodes=element=>!element||typeof element!=='object'?[]:[element,...[element.props?.children].flat(Infinity).flatMap(nodes)];
 const modeControl=tree=>nodes(tree).find(node=>node.props?.['aria-label']==='Game mode');
 modeControl(MatchConfiguration({config:{...DEFAULT_CONFIG,mode:'deathmatch',botCount:0},onChange})).props.onValueChange('puma-race');assert.equal(changed.botCount,7);
 const raceTree=MatchConfiguration({config,onChange});nodes(raceTree).find(node=>node.props?.label==='Rival drivers').props.onChange(2);assert.equal(changed.botCount,2);
 modeControl(MatchConfiguration({config:changed,onChange})).props.onValueChange('puma-race');assert.equal(changed.botCount,2);
 modeControl(MatchConfiguration({config:changed,onChange})).props.onValueChange('deathmatch');assert.equal(changed.botCount,2);
});
