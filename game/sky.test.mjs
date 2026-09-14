import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import {addSky,makeStarField,skyPalette,skyPhase,skyLuminance,SKY_PHASES,HALO_MAPS,NIGHT_MAPS} from './environment.mjs';

test('skyPhase classifies maps deterministically from background or an override', () => {
  assert.equal(skyPhase({id:'frostline',background:'#cfe9f7'}),'day');
  assert.equal(skyPhase({id:'exchange',background:'#090f17'}),'night');
  assert.equal(skyPhase({id:'custom',background:'#7bb8c4'}),'day');
  assert.equal(skyPhase({id:'custom',background:'#5f4a30'}),'dusk');
  assert.equal(skyPhase({id:'custom',background:'#101010',sky:'dusk'}),'dusk');
  assert.ok(SKY_PHASES.includes(skyPhase({background:'#000000'})));
  assert.ok(Object.isFrozen(NIGHT_MAPS) && Object.isFrozen(HALO_MAPS));
  assert.ok(HALO_MAPS.has('aether') && HALO_MAPS.has('skybreak'));
});

test('skyPalette returns finite hex colors for every phase', () => {
  for (const phase of SKY_PHASES) {
    const palette = skyPalette('#0a0f1e', phase);
    for (const key of ['zenith','horizon','ground','star','starDim','disk','diskGlow','halo']) {
      assert.match(palette[key], /^#[0-9a-f]{6}$/i, `${phase}.${key}`);
    }
    assert.ok(Object.isFrozen(palette));
  }
  assert.ok(skyLuminance('#000000') < skyLuminance('#ffffff'));
});

test('the star field is deterministic, unit length and above the horizon', () => {
  const a = makeStarField(7,{count:64}), b = makeStarField(7,{count:64}), c = makeStarField(8,{count:64});
  assert.equal(a.count,64);
  assert.deepEqual(Array.from(a.positions),Array.from(b.positions));
  assert.notDeepEqual(Array.from(a.positions),Array.from(c.positions));
  for (let i=0;i<a.count;i++) {
    const x=a.positions[i*3], y=a.positions[i*3+1], z=a.positions[i*3+2];
    assert.ok(y >= .02 - 1e-6, `star ${i} above the horizon`);
    assert.ok(Math.abs(Math.hypot(x,y,z)-1) < 1e-4, `star ${i} is unit length`);
  }
});

test('a night sky parents stars and a disc without changing the dome contract', () => {
  const world = new T.Group(), sky = addSky(world,{background:'#090f17',radius:120,phase:'night',seed:3,starCount:48});
  assert.equal(world.children.length,1);
  assert.ok(sky.isMesh && sky.userData.sky === true && sky.userData.environment === true);
  assert.equal(sky.renderOrder,-1);
  assert.equal(sky.userData.phase,'night');
  assert.ok(sky.children.some(child => child.userData.stars && child.isPoints),'night dome has a star cloud');
  assert.ok(sky.children.some(child => child.userData.sun),'dome has a sun/moon disc');
  assert.ok(sky.geometry.getAttribute('color').count > 0);
});

test('the halo ring only appears on halo maps', () => {
  const withHalo = addSky(new T.Group(),{background:'#090f17',phase:'night',halo:true});
  const withoutHalo = addSky(new T.Group(),{background:'#090f17',phase:'night',halo:false});
  assert.ok(withHalo.children.some(child => child.userData.halo));
  assert.ok(!withoutHalo.children.some(child => child.userData.halo));
});
