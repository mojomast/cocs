import test from 'node:test';
import assert from 'node:assert/strict';
import {ENEMY_TYPES,ENEMY_TYPE_IDS,DEFAULT_ENEMY_ID,enemyById,enemyLeash,applyEnemyFields,enemyBehavior,NPC_ZONE_KINDS} from './enemy-types.mjs';
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
