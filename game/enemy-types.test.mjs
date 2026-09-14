import test from 'node:test';
import assert from 'node:assert/strict';
import {ENEMY_TYPES,ENEMY_TYPE_IDS,DEFAULT_ENEMY_ID,enemyById,enemyLeash,applyEnemyFields,enemyBehavior,hasEnemyRole,NPC_ZONE_KINDS,isBossType,bossMaxPhase,bossPhaseProfile} from './enemy-types.mjs';
import {CHARACTERS} from './data.mjs';

const bot=()=>({route:[],think:0,target:-1,memory:0,reaction:0,stuck:0,last:{x:0,y:0,z:0},state:'roam',patrol:0,flank:null,flankDone:false,recover:0,suppressed:0,threat:-1,standoff:null,strafeReverse:-99});

test('enemy types are frozen, uniquely identified and fragile',()=>{
 assert.equal(new Set(ENEMY_TYPE_IDS).size,ENEMY_TYPE_IDS.length);
 const weakest=CHARACTERS.reduce((min,character)=>Math.min(min,character.stats.health),Infinity);
 for(const id of ENEMY_TYPE_IDS){
  const type=ENEMY_TYPES[id];
  assert.equal(type.id,id);
  assert.ok(type.health>0);
  assert.ok(type.speedMult>0&&type.damageMult>0);
  assert.ok(type.scale>0&&/^#[0-9a-f]{6}$/i.test(type.color));
  assert.ok(type.character&&type.harness);
 }
 assert.ok(ENEMY_TYPES.husk.health<weakest,'husks are softer than the softest operator');
 assert.ok(ENEMY_TYPES.spitter.health<weakest,'spitters are softer than any normal bot');
 assert.ok(ENEMY_TYPES.brute.health>ENEMY_TYPES.husk.health);
 assert.equal(ENEMY_TYPES.warden.boss,true);
});

test('enemyById falls back to the default type',()=>{
 assert.equal(enemyById('husk').id,'husk');
 assert.equal(enemyById('nope').id,DEFAULT_ENEMY_ID);
 assert.equal(enemyById(undefined).id,DEFAULT_ENEMY_ID);
});

test('enemy classes expose finite default NPC-zone leashes',()=>{
 assert.deepEqual([...NPC_ZONE_KINDS],['spawn','patrol','hold']);
 for(const id of ENEMY_TYPE_IDS){
  const type=ENEMY_TYPES[id];
  assert.ok(Number.isFinite(type.leash)&&type.leash>0,`${id} has a default leash`);
  assert.equal(enemyLeash(id),type.leash,`${id} leash resolves by id`);
 }
 assert.ok(ENEMY_TYPES.spitter.leash>=ENEMY_TYPES.husk.leash,'ranged enemies get a longer tether');
 assert.ok(ENEMY_TYPES.warden.leash>=ENEMY_TYPES.brute.leash,'the boss gets the longest tether');
 assert.equal(enemyLeash('missing'),ENEMY_TYPES.spitter.leash,'unknown leashes fall back to the default type');
});

test('applyEnemyFields sets the profile and respawn-surviving stats',()=>{
 const actor={character:'chatgpt',harness:'openclaw'};
 applyEnemyFields(actor,'brute');
 assert.equal(actor.npcType,'brute');
 assert.equal(actor.name,'Brute');
 assert.equal(actor.npcProfile.health,ENEMY_TYPES.brute.health);
 assert.equal(actor.npcProfile.armor,ENEMY_TYPES.brute.armor);
 assert.equal(actor.npcProfile.speedMult,ENEMY_TYPES.brute.speedMult);
 const melee={character:'chatgpt',harness:'openclaw'};
 applyEnemyFields(melee,'husk');
 assert.equal(melee.meleeDamage,ENEMY_TYPES.husk.meleeDamage);
 const boss={character:'grok',harness:'openclaw'};
 applyEnemyFields(boss,'warden');
 assert.equal(boss.isBoss,true);
});

test('enemy behavior differentiates swarmer, ranged and heavy classes',()=>{
 const swarmer={id:1,character:'chatgpt',harness:'openclaw',npcType:'husk',bot:bot()};
 const ranged={id:2,character:'meta',harness:'openclaw',npcType:'spitter',bot:bot()};
 const heavy={id:3,character:'deepseek',harness:'openclaw',npcType:'brute',bot:bot()};
 const a=enemyBehavior(swarmer),b=enemyBehavior(ranged),c=enemyBehavior(heavy);
 assert.equal(a.meleeOnly,true);
 assert.notEqual(b.meleeOnly,true);
 assert.ok(a.range[1]<b.range[0],'swarmer closes while ranged holds');
 assert.ok(c.hold>=a.hold,'heavy holds position');
 assert.ok(a.engageBand[0]<c.engageBand[0]);
 assert.ok(a.thinkScale<(enemyBehavior({...swarmer,npcType:'spitter'}).thinkScale||1),'swarmer thinks faster');
});

test('support, sapper and leader archetypes are fragile and carry role data',()=>{
 for(const id of ['mender','sapper','overseer']){
  const type=ENEMY_TYPES[id];
  assert.ok(type,`${id} exists`);
  assert.ok(type.health>0&&type.health<=ENEMY_TYPES.brute.health,`${id} is fragile`);
  assert.ok(Number.isFinite(type.leash)&&type.leash>0,`${id} leash`);
  assert.ok(Number.isFinite(type.scan)&&type.scan>0,`${id} scan`);
  assert.ok(type.character&&type.harness,`${id} loadout`);
 }
 assert.ok(ENEMY_TYPES.mender.support.heal>0);
 assert.ok(ENEMY_TYPES.sapper.sapper.damage>0&&ENEMY_TYPES.sapper.sapper.trigger>0);
 assert.ok(ENEMY_TYPES.overseer.leader.radius>0&&ENEMY_TYPES.overseer.leader.damageBonus>0);
 assert.equal(hasEnemyRole('husk'),false);
 assert.equal(hasEnemyRole('overseer'),true);
});

test('role abilities carry explicit telegraph and cooldown timing',()=>{
 for(const id of ['mender','sapper','overseer']){
  const type=ENEMY_TYPES[id],role=type.support||type.sapper||type.leader;
  assert.ok(Number.isFinite(role.telegraph)&&role.telegraph>0,`${id} telegraph`);
  assert.ok(Number.isFinite(role.cooldown)&&role.cooldown>0,`${id} cooldown`);
  assert.ok(role.telegraph<=role.cooldown,`${id} telegraph fits inside the cooldown`);
 }
 assert.ok(ENEMY_TYPES.sapper.sapper.fuse>=ENEMY_TYPES.sapper.sapper.telegraph,'the sapper fuse matches its warning window');
 assert.ok(ENEMY_TYPES.mender.support.radius>ENEMY_TYPES.mender.range[1]*.4,'the heal aura is wide enough to matter');
});

test('role archetypes expose scan, range, aggression and leash overrides',()=>{
 const make=(id,character)=>({id,character:character||ENEMY_TYPES[id].character,harness:ENEMY_TYPES[id].harness,npcType:id,bot:bot()});
 const husk=enemyBehavior(make('husk','chatgpt'));
 const mender=enemyBehavior(make('mender'));
 const sapper=enemyBehavior(make('sapper'));
 const overseer=enemyBehavior(make('overseer'));
 assert.equal(mender.support,true);
 assert.equal(sapper.sapper,true);
 assert.equal(overseer.leader,true);
 assert.equal(mender.scan,ENEMY_TYPES.mender.scan);
 assert.equal(overseer.leash,ENEMY_TYPES.overseer.leash);
 assert.ok(mender.range[0]>husk.range[1],'the healer keeps its distance');
 assert.ok(sapper.meleeOnly===true&&sapper.aggression>=husk.aggression,'the sapper rushes');
 assert.ok(overseer.aggression>mender.aggression,'the leader pushes harder than the healer');
 assert.ok(mender.retreat>husk.retreat,'the healer retreats earlier');
});

test('the tank and artillery archetypes carry distinct role payloads',()=>{
 for(const id of ['bulwark','mortar']){
  const type=ENEMY_TYPES[id];
  assert.ok(type,`${id} exists`);
  assert.ok(type.health>0&&Number.isFinite(type.leash)&&Number.isFinite(type.scan),`${id} stats`);
  assert.ok(type.character&&type.harness,`${id} loadout`);
  assert.equal(hasEnemyRole(id),true,`${id} has a runtime role`);
 }
 assert.ok(ENEMY_TYPES.bulwark.shield.reduction>0&&ENEMY_TYPES.bulwark.shield.flankBonus>1,'the tank rewards flanking');
 assert.ok(ENEMY_TYPES.mortar.artillery.radius>0&&ENEMY_TYPES.mortar.artillery.damage>0,'the mortar lobs an AoE');
 assert.ok(ENEMY_TYPES.mortar.artillery.telegraph>0&&ENEMY_TYPES.mortar.artillery.cooldown>=ENEMY_TYPES.mortar.artillery.telegraph,'the shell is telegraphed inside its cooldown');
 assert.ok(ENEMY_TYPES.bulwark.armor>ENEMY_TYPES.brute.armor,'the tank is the most armoured line unit');
});

test('enemyBehavior exposes tank and artillery overrides',()=>{
 const make=(id,character)=>({id,character:character||ENEMY_TYPES[id].character,harness:ENEMY_TYPES[id].harness,npcType:id,bot:bot()});
 const tank=enemyBehavior(make('bulwark'));
 const artillery=enemyBehavior(make('mortar'));
 assert.equal(tank.shield,true);
 assert.equal(artillery.artillery,true);
 assert.ok(artillery.engageBand[0]>tank.engageBand[0],'artillery holds much farther back');
 assert.ok(artillery.range[1]>tank.range[1],'artillery out-ranges the tank');
 assert.ok(tank.hold>=.6,'the tank plants itself');
});

test('applyEnemyFields installs tank and artillery payloads',()=>{
 const tank={character:ENEMY_TYPES.bulwark.character,harness:'openclaw'};applyEnemyFields(tank,'bulwark');
 assert.ok(tank.npcShield&&tank.npcShield.reduction>0);
 const mortar={character:ENEMY_TYPES.mortar.character,harness:'openclaw'};applyEnemyFields(mortar,'mortar');
 assert.ok(mortar.npcArtillery&&mortar.npcArtillery.radius>0);
});

test('applyEnemyFields installs scan range and role payloads on the actor',()=>{
 for(const id of ['mender','sapper','overseer']){
  const actor={character:ENEMY_TYPES[id].character,harness:'openclaw'};
  applyEnemyFields(actor,id);
  assert.equal(actor.botScan,ENEMY_TYPES[id].scan,`${id} scan reaches the bot brain`);
 }
 const mender={character:'gemini',harness:'openclaw'};applyEnemyFields(mender,'mender');
 assert.ok(mender.npcSupport&&mender.npcSupport.heal>0);
 const sapper={character:'mistral',harness:'openclaw'};applyEnemyFields(sapper,'sapper');
 assert.ok(sapper.npcSapper&&sapper.npcSapper.fuse>0);
 const overseer={character:'qwen',harness:'openclaw'};applyEnemyFields(overseer,'overseer');
 assert.ok(overseer.npcLeader&&overseer.npcLeader.damageBonus>0);
});

test('the Warden escalates through distinct, telegraphed boss phases',()=>{
 assert.equal(isBossType('warden'),true);
 assert.equal(isBossType('brute'),false);
 assert.equal(bossMaxPhase('warden'),3);
 assert.equal(bossMaxPhase('husk'),1);
 const one=bossPhaseProfile('warden',1),two=bossPhaseProfile('warden',2),three=bossPhaseProfile('warden',3);
 assert.ok(one&&two&&three,'every authored phase resolves');
 assert.equal(two.name,'OVERCLOCKED');
 assert.equal(three.name,'LEGION');
 assert.ok(one.name&&three.name,'phases carry presentation names');
 assert.ok(two.speedMult>one.speedMult&&three.speedMult>two.speedMult,'later phases accelerate');
 assert.ok(two.damageMult>one.damageMult&&three.damageMult>two.damageMult,'later phases hit harder');
 assert.ok(two.stomp.damage>one.stomp.damage&&three.stomp.damage>two.stomp.damage,'the ground slam scales');
 assert.ok(two.stomp.telegraph<one.stomp.telegraph&&three.stomp.telegraph<two.stomp.telegraph,'later slams warn faster');
 assert.equal(bossPhaseProfile('husk',2),null,'non-bosses have no phase profile');
 assert.equal(bossPhaseProfile('warden',99),three,'phase clamps to the last authored overlay');
 assert.equal(bossPhaseProfile('warden',0),one,'phase clamps to the first authored overlay');
 const staged={character:'grok',harness:'openclaw'};applyEnemyFields(staged,'warden');
 assert.equal(staged.bossPhase,1);
 assert.equal(staged.bossPhaseMax,3);
 assert.ok(!ENEMY_TYPES.phases,'ENEMY_TYPES stays a type map');
});

test('the flanker, shield-bearer and summoner archetypes carry distinct payloads',()=>{
 for(const id of ['lancer','sentinel','harbinger']){
  const type=ENEMY_TYPES[id];
  assert.ok(type,`${id} exists`);
  assert.ok(type.health>0&&Number.isFinite(type.leash)&&Number.isFinite(type.scan),`${id} stats`);
  assert.ok(type.character&&type.harness,`${id} loadout`);
  assert.equal(hasEnemyRole(id),true,`${id} has a runtime role`);
 }
 assert.ok(ENEMY_TYPES.lancer.flank.chargeDistance>0&&ENEMY_TYPES.lancer.flank.cooldown>0&&ENEMY_TYPES.lancer.flank.telegraph>0,'the lancer flanks on a cooldown');
 assert.ok(ENEMY_TYPES.sentinel.phalanx.shield>0&&ENEMY_TYPES.sentinel.phalanx.radius>0&&ENEMY_TYPES.sentinel.phalanx.interval>0,'the sentinel projects a formation shield');
 assert.equal(ENEMY_TYPES.harbinger.boss,true);
 assert.equal(bossMaxPhase('harbinger'),3);
 assert.ok(ENEMY_TYPES.harbinger.summon.count>0&&ENEMY_TYPES.harbinger.summon.maxAlive>0,'the Harbinger summons bounded adds');
});

test('applyEnemyFields installs the new role payloads and enemyBehavior flags them',()=>{
 const make=(id,character)=>({id,character:character||ENEMY_TYPES[id].character,harness:ENEMY_TYPES[id].harness,npcType:id,bot:bot()});
 assert.equal(enemyBehavior(make('lancer')).flanker,true);
 assert.equal(enemyBehavior(make('sentinel')).phalanx,true);
 assert.equal(enemyBehavior(make('harbinger')).flanker,false);
 const lancer={character:'mistral',harness:'openclaw'};applyEnemyFields(lancer,'lancer');
 assert.ok(lancer.npcFlank&&lancer.npcFlank.chargeDistance>0);
 const sentinel={character:'kimi',harness:'openclaw'};applyEnemyFields(sentinel,'sentinel');
 assert.ok(sentinel.npcPhalanx&&sentinel.npcPhalanx.shield>0);
 const boss={character:'qwen',harness:'openclaw'};applyEnemyFields(boss,'harbinger');
 assert.ok(boss.npcSummon&&boss.isBoss);
 assert.equal(boss.bossPhase,1);
 assert.equal(boss.bossPhaseMax,3);
});

test('the Harbinger escalates through distinct named phases without a stomp',()=>{
 const one=bossPhaseProfile('harbinger',1),two=bossPhaseProfile('harbinger',2),three=bossPhaseProfile('harbinger',3);
 assert.ok(one&&two&&three,'every authored phase resolves');
 assert.equal(two.name,'SWARMLORD');
 assert.equal(three.name,'OBLIVION');
 assert.ok(two.speedMult>one.speedMult&&three.speedMult>two.speedMult,'later phases accelerate');
 assert.ok(two.damageMult>one.damageMult&&three.damageMult>two.damageMult,'later phases hit harder');
 assert.ok(!one.stomp&&!three.stomp,'the Harbinger summons instead of ground-slamming');
 assert.equal(bossPhaseProfile('lancer',2),null,'non-bosses have no phase profile');
});
