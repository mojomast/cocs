import * as T from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';

const INK = Object.freeze({shell: '#283c46', dark: '#101e28', metal: '#91a1a4', ivory: '#d9d7bc', copper: '#ba7950', screen: '#255d68'});
export const LATTICE_MACHINE_TINTS = Object.freeze({front: '#d5ba83', economy: '#efb854', relay: '#85ddd0', array: '#9ebce9', hq: '#d4d9d9', HACK: '#71d9cc', DEPLOY: '#b2c3ef', VAULT: '#e3ba69', SABOTAGE: '#ed985d'});

// One merged, vertex-coloured chassis per type, instanced by the scene owner.
// All primitives are temporary CPU construction data, never one draw per bolt.
function kit(simple) {
  const parts = [], transform = new T.Object3D();
  const add = (geometry, color, x, y, z, sx = 1, sy = 1, sz = 1, rx = 0, ry = 0, rz = 0) => {
    transform.position.set(x, y, z); transform.scale.set(sx, sy, sz); transform.rotation.set(rx, ry, rz); transform.updateMatrix();
    geometry.applyMatrix4(transform.matrix);
    const tint = new T.Color(INK[color] ?? color), colors = new Float32Array(geometry.attributes.position.count * 3);
    for (let i = 0; i < colors.length; i += 3) { colors[i] = tint.r; colors[i + 1] = tint.g; colors[i + 2] = tint.b; }
    geometry.setAttribute('color', new T.BufferAttribute(colors, 3)); parts.push(geometry);
  };
  return {
    box(w, h, d, x, y, z, color = 'shell', rz = 0) { add(new T.BoxGeometry(w, h, d), color, x, y, z, 1, 1, 1, 0, 0, rz); },
    cylinder(r, h, x, y, z, color = 'metal', rx = 0) { add(new T.CylinderGeometry(r, r, h, simple ? 6 : 10), color, x, y, z, 1, 1, 1, rx); },
    ring(r, tube, x, y, z, color = 'copper', rx = 0) { add(new T.TorusGeometry(r, tube, 4, simple ? 8 : 16), color, x, y, z, 1, 1, 1, rx); },
    finish() {
      const geometry = mergeGeometries(parts);
      for (const part of parts) part.dispose();
      geometry.computeBoundingBox(); geometry.computeBoundingSphere();
      return geometry;
    },
  };
}

/** Local service bay: <=2.3m wide, 3m high. Front is +Z. Motion is a
 * separate small internal tool; the machine chassis never bobs or scales. */
export function buildLatticeMachineGeometry(kind, {simple = false} = {}) {
  const k = kit(simple), accent = LATTICE_MACHINE_TINTS[kind] ?? '#a8c0be';
  const box = k.box, cyl = k.cylinder, ring = k.ring;
  box(2.2, .13, 1.2, 0, .1, 0, 'shell');
  box(1.9, .045, .1, 0, .185, .55, 'ivory');
  // Readable face-mounted instrument/charge tray on every physical machine.
  box(1.85, .28, .10, 0, .42, .66, 'dark');
  if (kind === 'front') {
    // Split, bevel-like armour leaves and a recessed command slit. No barrel:
    // this is a capture bastion, not a turret that might falsely promise fire.
    box(.72, 1.8, .75, -.63, 1.35, 0, 'metal', -.13);
    box(.72, 1.8, .75, .63, 1.35, 0, 'metal', .13);
    box(.7, 2.3, .7, 0, 1.4, -.1, 'shell');
    box(.48, .62, .07, 0, 1.75, .47, 'dark');
    for (const sign of [-1, 1]) {
      box(.16, 1.4, .12, sign * .88, 1.45, .44, 'ivory', sign * .13);
      box(.58, .12, .1, sign * .23, 2.39, .45, accent, sign * .5);
      box(.14, .72, .14, sign * .45, .95, .47, 'copper');
    }
  } else if (kind === 'economy') {
    // Twin flux separators with return pipes, manifold and heat-exchanger fins.
    for (const sign of [-1, 1]) {
      cyl(.39, 1.85, sign * .56, 1.42, 0, 'metal');
      cyl(.43, .16, sign * .56, .64, 0, 'copper');
      cyl(.43, .16, sign * .56, 2.22, 0, 'copper');
      box(.13, 1.3, .1, sign * .56, 1.4, .4, accent);
      box(.13, 1.7, .18, sign * .97, 1.42, .15, 'copper');
    }
    box(1.7, .18, .5, 0, 2.52, 0, 'shell');
    box(.26, 1.55, .48, 0, 1.48, .05, 'dark');
    for (let i = 0; i < (simple ? 3 : 6); i++) box(.38, .065, .14, 0, .9 + i * (simple ? .36 : .18), .39, 'ivory');
  } else if (kind === 'relay') {
    // Tuning fork, isolators, and operator desk: broad negative space at centre.
    for (const sign of [-1, 1]) {
      box(.24, 2.28, .3, sign * .77, 1.55, -.16, 'metal');
      box(.35, .18, .45, sign * .77, 2.65, -.16, 'ivory');
      for (let i = 0; i < 3; i++) box(.43, .09, .46, sign * .77, 1.5 + i * .27, -.16, 'copper');
    }
    box(1.38, .14, .4, 0, 1.45, -.16, 'shell');
    box(1.32, .48, .48, 0, .95, .1, 'shell');
    box(.85, .23, .045, 0, 1.04, .37, 'screen');
    for (const x of [-.3, 0, .3]) box(.14, .035, .06, x, .81, .38, accent);
  } else if (kind === 'array') {
    // Eight discrete radial vanes read as an aperture, not another relay tower.
    box(.34, 1.35, .36, 0, .95, 0, 'metal');
    ring(.74, .11, 0, 1.93, 0, 'shell');
    for (let i = 0; i < 8; i++) {
      const a = i * Math.PI / 4;
      box(.35, .57, .13, Math.sin(a) * .65, 1.93 + Math.cos(a) * .65, .14, i % 2 ? 'ivory' : 'metal', -a);
    }
    cyl(.28, .2, 0, 1.93, .19, 'copper', Math.PI / 2);
    box(.62, .3, .18, 0, .75, .36, 'dark');
  } else if (kind === 'hq') {
    // Armoured command mainframe with independent flanking compute stacks.
    box(.9, 2.43, .95, 0, 1.48, -.05, 'ivory');
    box(.58, 1.95, .05, 0, 1.48, .46, 'dark');
    for (const sign of [-1, 1]) {
      box(.5, 1.87, .83, sign * .8, 1.16, -.04, 'shell');
      for (let i = 0; i < 4; i++) {
        box(.4, .22, .06, sign * .8, .64 + i * .37, .43, 'metal');
        box(.22, .035, .04, sign * .8, .69 + i * .37, .475, 'copper');
      }
    }
    for (let i = 0; i < 3; i++) box(.36, .19, .08, 0, 1.15 + i * .4, .51, 'screen');
    box(1.15, .13, 1.04, 0, 2.73, -.05, 'copper');
  } else if (kind === 'HACK') {
    // Offset dual screens, mechanical keyboard, and a vertical patch spine.
    box(.26, 1.15, .3, 0, .8, -.1, 'metal');
    box(1.7, .2, .9, 0, 1.2, .12, 'ivory');
    for (const sign of [-1, 1]) {
      box(.77, .68, .19, sign * .46, 1.8 + sign * .12, -.1, 'shell', -sign * .12);
      box(.61, .47, .04, sign * .46, 1.8 + sign * .12, .02, 'screen', -sign * .12);
      box(.08, .57, .07, sign * .82, 2.36, -.16, 'copper');
      for (let i = 0; i < 3; i++) box(.12, .03, .08, sign * (.14 + i * .21), 1.33, .42, 'dark');
    }
    box(.16, .77, .22, 0, 2.05, -.14, 'metal');
  } else if (kind === 'DEPLOY') {
    // Open fabrication cradle and overhead X rail. The moving print carriage
    // stays empty: accepted DEPLOY enables an Oracle, it does not print a robot.
    for (const sign of [-1, 1]) {
      box(.23, 2.02, .45, sign * .88, 1.4, -.18, 'metal');
      box(.09, 1.63, .06, sign * .88, 1.35, .07, accent);
      box(.28, .44, .8, sign * .7, .51, .05, 'shell');
      box(.12, .22, .18, sign * .5, .79, .3, 'copper');
    }
    box(2.03, .24, .56, 0, 2.48, -.16, 'ivory');
    box(1.73, .08, .09, 0, 2.34, .16, 'dark');
    box(1.23, .1, .83, 0, .62, .07, 'dark');
    for (const x of [-.4, 0, .4]) box(.08, .03, .68, x, .687, .07, 'copper');
  } else if (kind === 'VAULT') {
    // Banked archive drawers and a heavy round locking wheel. Drawer lamps
    // are deliberately unlit: stores/uses are counters, not current inventory.
    box(2.02, 2.08, .98, 0, 1.36, -.03, 'ivory');
    box(1.77, 1.86, .04, 0, 1.35, .49, 'dark');
    for (const sign of [-1, 1]) for (let i = 0; i < 4; i++) {
      box(.7, .31, .09, sign * .47, .71 + i * .41, .55, 'metal');
      box(.3, .06, .075, sign * .47, .71 + i * .41, .63, 'dark');
    }
    box(.22, 2.1, .12, 0, 1.37, .66, 'copper');
    ring(.29, .055, 0, 1.52, .76, 'ivory');
    for (const a of [0, Math.PI / 3, -Math.PI / 3]) box(.055, .49, .07, 0, 1.52, .76, 'ivory', a);
    box(2.14, .15, 1.12, 0, 2.48, -.03, 'copper');
  } else if (kind === 'SABOTAGE') {
    // Exposed ceramic isolators and a central knife-switch disconnect.
    box(1.85, 1.85, .25, 0, 1.4, -.28, 'shell');
    for (const sign of [-1, 1]) {
      box(.12, 1.81, .15, sign * .78, 1.4, -.06, 'copper');
      for (const y of [.9, 1.75]) {
        cyl(.19, .29, sign * .49, y, .04, 'ivory', Math.PI / 2);
        ring(.21, .035, sign * .49, y, .2, 'metal');
      }
      box(.19, .31, .17, sign * .49, 2.18, .05, 'dark');
    }
    box(1.57, .1, .1, 0, 2.45, -.06, accent);
    box(.64, .3, .22, 0, .67, .05, 'metal');
  }
  // Kind-specific small mechanism. All movement is bounded by this service bay.
  const tool = kit(simple);
  if (kind === 'DEPLOY') {
    tool.box(.4, .22, .34, 0, 0, 0, 'copper'); tool.box(.12, .28, .12, 0, -.23, 0, 'metal');
  } else if (kind === 'economy') {
    tool.box(.16, .55, .12, 0, 0, 0, 'copper'); tool.box(.4, .12, .21, 0, 0, 0, 'ivory');
  } else if (kind === 'SABOTAGE') {
    tool.box(.94, .1, .13, 0, 0, 0, 'copper'); tool.box(.23, .22, .19, 0, 0, .08, 'ivory');
  } else if (kind === 'array') {
    tool.ring(.31, .035, 0, 0, 0, accent); tool.box(.065, .49, .08, 0, 0, 0, 'ivory');
  } else {
    tool.box(kind === 'relay' ? 1.2 : .34, .085, .10, 0, 0, 0, accent);
  }
  return {body: k.finish(), tool: tool.finish()};
}

export function latticeToolPose(kind, state, time, reduced = false) {
  const wave = !reduced && state.moving ? Math.sin((Number.isFinite(time) ? time : 0) * 2) : 0;
  if (kind === 'DEPLOY') return {x: wave * .43, y: 2.19, z: .22, rz: 0};
  if (kind === 'economy') return {x: 0, y: 1.6 + wave * .09, z: .54, rz: 0};
  if (kind === 'relay') return {x: 0, y: 2.06 + wave * .09, z: -.12, rz: 0};
  if (kind === 'array') return {x: 0, y: 1.93, z: .4, rz: wave * .12};
  if (kind === 'SABOTAGE') return {x: 0, y: 1.76, z: .35, rz: state.blocked ? .85 : 0};
  return {x: 0, y: kind === 'HACK' ? 1.77 : kind === 'hq' ? 2.32 : 1.65, z: .58, rz: 0};
}
