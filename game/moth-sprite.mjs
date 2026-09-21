import * as T from 'three';

// Pooled sprite-sheet player for the Moth-baked effect sequences. The quantum
// rift was the first user; arc bursts, spark impacts and lightning strikes now
// reuse the same idea through this small reusable player.
//
// Frames are owned by textures.mjs (`mothEffectTextures`, cached per name and
// marked `userData.mothShared`), so a player NEVER disposes them: `dispose()`
// only releases the pooled geometry and the per-slot materials. Everything the
// player creates is deterministic given the spawn calls and the elapsed time,
// which keeps replays and tests stable.
//
// Reduced motion freezes the frame index, growth and spin while still letting a
// live sprite fade out; callers remain responsible for skipping new spawns.

const clamp01 = (value, fallback = 0) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : fallback;
};

export class MothSpritePlayer {
  constructor({ name = '', frames = null, fps = 10, slots = 4, opacity = 0.8, blending = T.AdditiveBlending } = {}) {
    this.name = name;
    this.frames = Array.isArray(frames) ? frames : [];
    this.fps = Math.max(1, Number(fps) || 10);
    this.opacity = clamp01(opacity, 0.8);
    this.geometry = new T.PlaneGeometry(1, 1);
    this.slots = [];
    const count = Math.max(1, Math.round(Number(slots) || 4));
    for (let i = 0; i < count; i++) {
      const material = new T.MeshBasicMaterial({
        map: this.frames[0] ?? null,
        transparent: true,
        opacity: 0,
        blending,
        depthWrite: false,
        side: T.DoubleSide,
        forceSinglePass: true,
        fog: false,
      });
      const mesh = new T.Mesh(this.geometry, material);
      mesh.visible = false;
      mesh.frustumCulled = true;
      mesh.renderOrder = 80;
      mesh.userData.mothSprite = name;
      this.slots.push({
        mesh,
        material,
        active: false,
        life: 0,
        total: 1,
        index: -1,
        scale: 1,
        grow: 0,
        spin: 0,
        angle: 0,
        billboard: true,
        opacity: this.opacity,
      });
    }
  }

  get active() {
    let count = 0;
    for (const slot of this.slots) if (slot.active) count++;
    return count;
  }

  // Attach every slot to a parent (scene or group). Safe to call repeatedly.
  attach(parent) {
    if (!parent) return this;
    for (const slot of this.slots) if (slot.mesh.parent !== parent) parent.add(slot.mesh);
    return this;
  }

  // Spawn one sprite. Overwrites the slot with the least remaining life once the
  // pool is full, so a burst of impacts can never allocate mid-match.
  spawn(position, { size = 1, life = null, opacity = null, grow = 0, spin = 0, angle = 0, billboard = true } = {}) {
    if (!this.frames.length || !position || !Number.isFinite(position.x)) return null;
    let slot = null;
    for (const candidate of this.slots) if (!candidate.active) { slot = candidate; break; }
    if (!slot) {
      slot = this.slots[0] ?? null;
      for (const candidate of this.slots) if (candidate.life < slot.life) slot = candidate;
      if (!slot) return null;
    }
    const total = Number.isFinite(life) ? Math.max(0.02, Number(life)) : this.frames.length / this.fps;
    slot.active = true;
    slot.life = total;
    slot.total = total;
    slot.index = -1;
    slot.scale = Math.max(0.001, Number(size) || 1);
    slot.grow = Number.isFinite(grow) ? grow : 0;
    slot.spin = Number.isFinite(spin) ? spin : 0;
    slot.angle = Number.isFinite(angle) ? angle : 0;
    slot.billboard = billboard === true;
    slot.opacity = opacity === null || opacity === undefined ? this.opacity : clamp01(opacity, this.opacity);
    slot.mesh.visible = true;
    slot.mesh.position.set(position.x || 0, position.y || 0, position.z || 0);
    slot.mesh.scale.setScalar(slot.scale);
    slot.mesh.rotation.set(0, 0, 0);
    return slot;
  }

  update(dt, { reduced = false, camera = null } = {}) {
    const step = Math.max(0, Math.min(Number(dt) || 0, 0.1));
    for (const slot of this.slots) {
      if (!slot.active) continue;
      slot.life -= step;
      if (slot.life <= 0) {
        slot.active = false;
        slot.mesh.visible = false;
        continue;
      }
      const age = slot.total - slot.life;
      // Hold on the last frame once the sequence finishes so a longer-lived
      // sprite reads as a fading afterglow rather than a frozen first frame.
      const frame = reduced ? 0 : Math.min(this.frames.length - 1, Math.floor(age * this.fps));
      if (frame !== slot.index) {
        slot.index = frame;
        slot.material.map = this.frames[frame] ?? null;
        slot.material.needsUpdate = true;
      }
      const fade = Math.min(1, slot.life / Math.max(0.02, slot.total * 0.4));
      slot.material.opacity = slot.opacity * fade;
      if (slot.grow && !reduced) {
        slot.scale = Math.max(0.001, slot.scale + slot.grow * step);
        slot.mesh.scale.setScalar(slot.scale);
      }
      if (slot.spin && !reduced) slot.angle += slot.spin * step;
      if (slot.billboard && camera) {
        slot.mesh.quaternion.copy(camera.quaternion);
        if (slot.angle) slot.mesh.rotateZ(slot.angle);
      } else if (slot.angle) {
        slot.mesh.rotation.z = slot.angle;
      }
    }
  }

  clear() {
    for (const slot of this.slots) {
      slot.active = false;
      slot.mesh.visible = false;
    }
  }

  dispose() {
    for (const slot of this.slots) {
      slot.mesh.parent?.remove(slot.mesh);
      slot.material.dispose();
    }
    this.slots = [];
    this.geometry.dispose();
  }
}
