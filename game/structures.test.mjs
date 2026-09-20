import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import {CAVERN_SEGMENTS,cavernArcs,cavernOpening,cavernShell,cavernRenderArcs,BREAK_KINDS,BREAKABLE_PROPS,breakProfile,isBreakable,propId,propHash,applyPropDamage,propDamageStage,propBreakPlan,weaponPose,weaponInspect} from './structures.mjs';

test('a cavern leaves two opposite entrances open', () => {
  assert.equal(CAVERN_SEGMENTS, 16);
  const open = [];
  for (let i = 0; i < CAVERN_SEGMENTS; i++) if (cavernOpening(i)) open.push(i);
  assert.deepEqual(open, [0, 1, 8, 9]);
});

test('cavern arcs cover the wall segments and avoid the entrances', () => {
  const arcs = cavernArcs();
  assert.equal(arcs.length, 2, 'two wall arcs between the two entrances');
  const span = (Math.PI * 2) / CAVERN_SEGMENTS;
  assert.equal(Number(arcs[0].thetaStart.toFixed(3)), Number((1.5 * span).toFixed(3)));
  assert.equal(Number(arcs[0].thetaLength.toFixed(3)), Number((6 * span).toFixed(3)));
  assert.equal(Number(arcs[1].thetaStart.toFixed(3)), Number((9.5 * span).toFixed(3)));
  assert.equal(Number(arcs[1].thetaLength.toFixed(3)), Number((6 * span).toFixed(3)));
  // Every open segment's centre angle must sit outside both arcs.
  for (let i = 0; i < CAVERN_SEGMENTS; i++) {
    if (!cavernOpening(i)) continue;
    const angle = (i / CAVERN_SEGMENTS) * Math.PI * 2;
    for (const arc of arcs) {
      const inside = angle >= arc.thetaStart && angle <= arc.thetaStart + arc.thetaLength;
      assert.equal(inside, false, `opening ${i} is covered by a wall arc`);
    }
  }
});

test('cavern shell dimensions stay positive and finite', () => {
  const shell = cavernShell(12, 8);
  assert.equal(shell.radius, 12);
  assert.ok(shell.wallHeight > 0 && Number.isFinite(shell.wallHeight));
  assert.ok(shell.domeHeight > 0 && Number.isFinite(shell.domeHeight));
  assert.equal(shell.arcs.length, 2);
  assert.equal(shell.renderArcs.length, 2);
  const fallback = cavernShell();
  assert.ok(fallback.wallHeight > 0 && fallback.domeHeight > 0);
});

test('only crates and barrels are breakable and each carries a profile', () => {
  assert.deepEqual([...BREAKABLE_PROPS].sort(), ['barrel', 'crate']);
  assert.deepEqual(BREAK_KINDS, ['crate', 'barrel']);
  for (const kind of BREAK_KINDS) {
    const profile = breakProfile(kind);
    assert.equal(profile.kind, kind);
    assert.ok(profile.threshold > 0 && profile.pieces > 0 && profile.force > 0);
    assert.ok(isBreakable(kind));
  }
  assert.equal(isBreakable('rock'), false);
  assert.equal(breakProfile('tree'), null);
});

test('prop ids are stable and distinct for same-coordinate props', () => {
  const a = {type: 'crate', x: 1, z: 2, seed: 9}, b = {type: 'crate', x: 1, z: 2, seed: 9};
  assert.equal(propId(a, 0), propId(b, 0));
  assert.notEqual(propId(a, 0), propId(a, 1), 'the authored index disambiguates');
  assert.equal(propHash(1, 2, 3), propHash(1, 2, 3));
  assert.notEqual(propHash(1, 2, 3), propHash(1, 2, 4));
});

test('prop damage breaks exactly once at the threshold and never mutates the prop', () => {
  const state = new Map(), prop = {type: 'crate', x: 0, z: 0, seed: 1}, id = propId(prop, 0);
  const before = JSON.stringify(prop);
  const first = applyPropDamage(state, id, 'crate', 10);
  assert.equal(first.broken, false);
  assert.equal(first.hp, breakProfile('crate').threshold - 10);
  const second = applyPropDamage(state, id, 'crate', 999);
  assert.equal(second.broken, true);
  assert.equal(second.wasBroken, false);
  const third = applyPropDamage(state, id, 'crate', 999);
  assert.equal(third.broken, true);
  assert.equal(third.wasBroken, true, 'a broken prop cannot shatter twice');
  assert.equal(JSON.stringify(prop), before, 'damage state lives outside the prop');
  assert.equal(applyPropDamage(state, id, 'rock', 999), null, 'unbreakable props are ignored');
  assert.equal(applyPropDamage(state, id, 'crate', 0), null, 'zero damage is ignored');
});

test('prop damage staging is pure, bounded and reaches its strongest read at the break', () => {
  const profile = breakProfile('crate');
  const pristine = propDamageStage(profile.threshold, profile);
  assert.deepEqual(pristine, {progress: 0, scale: .92, shade: 1});
  const broken = propDamageStage(0, profile);
  assert.deepEqual(broken, {progress: 1, scale: .86, shade: .62});
  assert.deepEqual(propDamageStage(profile.threshold / 2, profile), propDamageStage(profile.threshold / 2, profile), 'the stage is a pure function');
  for (let hp = 0; hp <= profile.threshold; hp += 3) {
    const stage = propDamageStage(hp, profile);
    assert.ok(stage.progress >= 0 && stage.progress <= 1, `progress ${stage.progress}`);
    assert.ok(stage.scale >= .86 && stage.scale <= .92, `scale ${stage.scale}`);
    assert.ok(stage.shade >= .62 && stage.shade <= 1, `shade ${stage.shade}`);
    assert.ok(Object.isFrozen(stage));
  }
  assert.equal(propDamageStage(profile.threshold, null).progress, 0, 'a missing profile reads pristine');
  assert.equal(propDamageStage(Number.NaN, profile).progress, 0, 'non-finite hp reads pristine');
  assert.equal(propDamageStage(-50, profile).scale, .86, 'overkill clamps to the strongest stage');
});

test('the break plan is deterministic, bounded and reduced-motion aware', () => {
  const prop = {type: 'barrel', x: 4, z: -2, y: 1, seed: 7};
  const a = propBreakPlan(prop, {origin: {x: 3, y: 1, z: -2}, serial: 5});
  const b = propBreakPlan(prop, {origin: {x: 3, y: 1, z: -2}, serial: 5});
  const c = propBreakPlan(prop, {origin: {x: 3, y: 1, z: -2}, serial: 6});
  assert.deepEqual(a, b, 'same prop and serial reproduce the plan');
  assert.notDeepEqual(a, c, 'a new serial advances the debris stream');
  assert.equal(a.count, breakProfile('barrel').pieces);
  assert.equal(a.pieces.length, a.count);
  for (const piece of a.pieces) {
    assert.ok([piece.velocity.x, piece.velocity.y, piece.velocity.z].every(Number.isFinite));
    assert.ok(Math.hypot(piece.velocity.x, piece.velocity.y, piece.velocity.z) <= breakProfile('barrel').force * 2.4, 'velocity stays bounded');
    assert.ok(piece.life > 0 && piece.scale > 0);
  }
  const reduced = propBreakPlan(prop, {origin: {x: 3, y: 1, z: -2}, serial: 5, reduced: true});
  assert.ok(reduced.count <= 2 && reduced.count < a.count, 'reduced motion emits a minimal burst');
  assert.equal(propBreakPlan({type: 'rock', x: 0, z: 0}, {}), null, 'unbreakable props have no plan');
});

test('weapon inspect poses are deterministic, finite and freeze under reduced motion', () => {
  const a = weaponPose({ time: 3, spin: .35, index: 2 }), b = weaponPose({ time: 3, spin: .35, index: 2 });
  assert.deepEqual(a, b, 'the same time and index reproduce the pose');
  assert.notDeepEqual(a, weaponPose({ time: 4, spin: .35, index: 2 }), 'the turntable advances with time');
  for (const pose of [a, weaponPose({ time: NaN }), weaponPose({ time: 1, spin: NaN })]) {
    for (const key of ['yaw', 'pitch', 'roll']) assert.ok(Number.isFinite(pose[key]), `${key} finite`);
  }
  const frozen = weaponPose({ time: 10, reduced: true }), frozenLater = weaponPose({ time: 99, reduced: true });
  assert.deepEqual(frozen, frozenLater, 'reduced motion pins the pose');
  assert.equal(frozen.roll, 0, 'reduced motion drops the idle roll');
  assert.notEqual(weaponPose({ time: 0, index: 0 }).yaw, weaponPose({ time: 0, index: 1 }).yaw, 'each weapon gets a distinct resting angle');
});

test('weapon inspect framing pulls back with the bounding radius', () => {
  const small = weaponInspect(.3), large = weaponInspect(2);
  assert.ok(large.distance > small.distance, 'a larger weapon is framed further out');
  assert.ok(large.height > small.height);
  assert.equal(small.fov, 34);
  const reduced = weaponInspect(1, { reduced: true });
  assert.ok(reduced.distance >= weaponInspect(1).distance, 'reduced motion keeps a stable, slightly wider stand-off');
  for (const frame of [small, large, weaponInspect(NaN)]) {
    for (const key of ['distance', 'height', 'fov', 'target']) assert.ok(Number.isFinite(frame[key]) && frame[key] > 0, `${key} finite`);
  }
});

test('rendered cavern arcs put solid walls and openings where collision does', () => {
  for (const radius of [8, 12, 20]) {
    const shell = cavernShell(radius, 8);
    const meshes = shell.renderArcs.map(arc => {
      const mesh = new T.Mesh(new T.CylinderGeometry(radius, radius, 1, 28, 1, true, arc.thetaStart, arc.thetaLength), new T.MeshBasicMaterial({ side: T.DoubleSide }));
      mesh.scale.set(1, shell.wallHeight, 1);
      mesh.updateMatrixWorld(true);
      return mesh;
    });
    const blocked = angle => {
      const raycaster = new T.Raycaster(new T.Vector3(0, 0, 0), new T.Vector3(Math.cos(angle), 0, Math.sin(angle)), .01, radius * 4);
      return meshes.some(mesh => raycaster.intersectObject(mesh, false).length > 0);
    };
    const span = (Math.PI * 2) / CAVERN_SEGMENTS;
    for (let i = 0; i < CAVERN_SEGMENTS; i++) {
      assert.equal(blocked(i * span), !cavernOpening(i), `segment ${i} at radius ${radius} should ${cavernOpening(i) ? 'be open' : 'be walled'}`);
    }
  }
});
