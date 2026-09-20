import * as T from 'three';

// Anti-tiling surface enhancer. Baked albedo maps repeat on a fixed grid, which
// reads as an obvious pattern across large meshes. This patches a standard
// material in one of two per-kind modes:
//  - `structure`: grid-like textures (hazard stripes, paneling, ...). Their UV
//    sampling is preserved byte-for-byte; only independent, mean-neutral wear
//    is added to albedo and roughness.
//  - `organic`: rock/sand/concrete and friends. Broad world-space variation
//    plus a rotated/scaled second albedo sample break up the baked tile.
// Both modes are static (no time uniform), deterministic, and seeded per
// material so adjacent surfaces do not share the exact same offsets.

export const MOTH_SURFACE_MARKER = 'moth_surface_break';

// Canonical texture kinds whose UV layout carries meaning (panels, rivets,
// stripes). The enhancer no longer skips them: they are patched in `structure`
// mode, which never rotates, offsets or rescales the base sample.
export const MOTH_GRID_KINDS = Object.freeze([
  'hazard_stripes',
  'hex_paneling',
  'circuit_board',
  'metal_grating',
  'diamond_plate',
  'industrial_mesh',
  'corrugated_metal',
  'carbon_fiber',
  'riveted_armor',
  'brushed_metal',
]);

// The two patch modes. `structure` preserves the structural sample; `organic`
// additionally blends a second, transformed sample of the same map.
export const MOTH_SURFACE_MODES = Object.freeze({
  STRUCTURE: 'structure',
  ORGANIC: 'organic',
});

// Structure wear stays conservative so hazard paint, panel seams and rivets keep
// reading as authored. Caps are enforced on options and on the new setters.
export const MOTH_STRUCTURE_WEAR_CAP = 0.24;
export const MOTH_STRUCTURE_ROUGH_CAP = 0.24;

// Documented neutral value of the baked macro map. The shader multiplies only
// the deviation from it, so the macro term stays mean-neutral by construction.
export const MOTH_MACRO_NEUTRAL = 0.5;
// Macro map world period is 1 / 0.0015 ~= 667 world units: large, not infinite.
export const MOTH_MACRO_TEX_SCALE = 0.0015;

// Per-kind defaults for organic, non-repeating surfaces. Kept small and plain
// so callers can spread/override them. `fractureStrength` drives the ridged
// crack layer, `roughStrength` the independent roughness modulation.
const MOTH_ORGANIC_PRESETS = Object.freeze({
  rock: { macroScale: 0.014, macroStrength: 0.6, breakScale: 0.41, breakStrength: 0.42, rotation: 0.7, fractureStrength: 0.55, roughStrength: 0.22 },
  sand: { macroScale: 0.009, macroStrength: 0.34, breakScale: 0.24, breakStrength: 0.28, rotation: 1.1, fractureStrength: 0.2, roughStrength: 0.14 },
  ice: { macroScale: 0.024, macroStrength: 0.42, breakScale: 0.6, breakStrength: 0.3, rotation: 0.4, fractureStrength: 0.3, roughStrength: 0.16 },
  grass: { macroScale: 0.02, macroStrength: 0.5, breakScale: 0.31, breakStrength: 0.45, rotation: 0.9, fractureStrength: 0.3, roughStrength: 0.18 },
  weathered_concrete: { macroScale: 0.011, macroStrength: 0.5, breakScale: 0.44, breakStrength: 0.38, rotation: 0.6, fractureStrength: 0.55, roughStrength: 0.2 },
  rough_stucco: { macroScale: 0.015, macroStrength: 0.45, breakScale: 0.35, breakStrength: 0.4, rotation: 0.8, fractureStrength: 0.35, roughStrength: 0.18 },
  alien_chitin: { macroScale: 0.026, macroStrength: 0.55, breakScale: 0.5, breakStrength: 0.5, rotation: 1.3, fractureStrength: 0.42, roughStrength: 0.2 },
  metal: { macroScale: 0.01, macroStrength: 0.32, breakScale: 0.62, breakStrength: 0.25, rotation: 0.5, fractureStrength: 0.25, roughStrength: 0.12 },
  concrete: { macroScale: 0.013, macroStrength: 0.5, breakScale: 0.4, breakStrength: 0.36, rotation: 0.7, fractureStrength: 0.5, roughStrength: 0.18 },
});

const MOTH_FALLBACK_CONFIG = Object.freeze({
  macroScale: 0.013,
  macroStrength: 0.5,
  breakScale: 0.4,
  breakStrength: 0.36,
  rotation: 0.7,
  fractureStrength: 0.5,
  roughStrength: 0.18,
});

// Per-kind defaults for the structural kinds. `wearScale` is the world-space
// frequency of the broad grime field (larger than the organic break field),
// `wearStrength` its conservative albedo amplitude, `roughStrength` the
// independent roughness amplitude.
const MOTH_STRUCTURE_PRESETS = Object.freeze({
  hazard_stripes: { wearScale: 0.009, wearStrength: 0.14, roughStrength: 0.12 },
  hex_paneling: { wearScale: 0.007, wearStrength: 0.18, roughStrength: 0.16 },
  circuit_board: { wearScale: 0.011, wearStrength: 0.16, roughStrength: 0.12 },
  metal_grating: { wearScale: 0.014, wearStrength: 0.2, roughStrength: 0.2 },
  diamond_plate: { wearScale: 0.012, wearStrength: 0.18, roughStrength: 0.18 },
  industrial_mesh: { wearScale: 0.013, wearStrength: 0.18, roughStrength: 0.16 },
  corrugated_metal: { wearScale: 0.008, wearStrength: 0.2, roughStrength: 0.2 },
  carbon_fiber: { wearScale: 0.009, wearStrength: 0.1, roughStrength: 0.08 },
  riveted_armor: { wearScale: 0.008, wearStrength: 0.18, roughStrength: 0.16 },
  brushed_metal: { wearScale: 0.01, wearStrength: 0.14, roughStrength: 0.12 },
});

function mothNumber(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

function mothClamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

// Returns a fresh policy object for any kind. Pure and total: unknown kinds
// fall back to the organic preset, and structural kinds report `mode:
// 'structure'` instead of the old binary `null`. Callers should branch on
// `mode` (or `structure`) rather than testing for null.
export function mothSurfacePolicy(kind) {
  const key = typeof kind === 'string' ? kind : '';
  const structurePreset = MOTH_STRUCTURE_PRESETS[key];
  if (structurePreset) {
    return {
      kind: key,
      mode: MOTH_SURFACE_MODES.STRUCTURE,
      structure: true,
      // Structural kinds do not use the organic second sample at all. The
      // neutral values below keep a spread policy safe to pass as options.
      macroScale: structurePreset.wearScale,
      macroStrength: 0,
      breakScale: 1,
      breakStrength: 0,
      rotation: 0,
      fractureStrength: 0,
      wearScale: structurePreset.wearScale,
      wearStrength: structurePreset.wearStrength,
      roughStrength: structurePreset.roughStrength,
    };
  }
  const preset = MOTH_ORGANIC_PRESETS[key] || MOTH_FALLBACK_CONFIG;
  return {
    kind: key,
    mode: MOTH_SURFACE_MODES.ORGANIC,
    structure: false,
    macroScale: preset.macroScale,
    macroStrength: preset.macroStrength,
    breakScale: preset.breakScale,
    breakStrength: preset.breakStrength,
    rotation: preset.rotation,
    fractureStrength: preset.fractureStrength,
    wearScale: 0,
    wearStrength: 0,
    roughStrength: preset.roughStrength,
  };
}

// Alias kept for callers that predate policies. Grid kinds now return a
// structure policy instead of null; callers that gated on null must switch to
// `mode`/`structure`. All numeric fields callers spread are still present.
export function mothSurfaceBreakConfig(kind) {
  return mothSurfacePolicy(kind);
}

// Deterministic seed helpers. Never Math.random/Date.now/material.uuid: replay
// of the same kind+seed must always produce the same offsets.
function mothSeedHash(text) {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function mothResolveSeed(seed, kind) {
  if (typeof seed === 'number' && Number.isFinite(seed)) return seed;
  if (typeof seed === 'string' && seed.length > 0) return mothSeedHash(seed);
  // No usable seed: derive one from the kind string only.
  return mothSeedHash(typeof kind === 'string' && kind ? kind : 'moth_surface');
}

// One unit float per slot from the resolved seed. The per-slot constant keeps
// adjacent seeds from producing correlated rotations/phases.
function mothSeedUnit(seed, slot) {
  let x = (Math.floor(Math.abs(seed) * 4096) ^ Math.imul(slot + 1, 2654435761)) >>> 0;
  x ^= x >>> 16;
  x = Math.imul(x, 2246822507);
  x ^= x >>> 13;
  x = Math.imul(x, 3266489909);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

const MOTH_FRAGMENT_ANCHOR = '#include <map_fragment>';
const MOTH_ROUGHNESS_ANCHOR = '#include <roughnessmap_fragment>';
const MOTH_VERTEX_ANCHOR = '#include <project_vertex>';

// Cheap, closed-form hash + fbm-ish value noise. No textures, no derivatives,
// three octaves at most. `mothRidge` is the ridged companion used for fracture
// veins: it folds the same value noise around its midpoint so the high values
// form connected lines instead of blobs.
const MOTH_NOISE_GLSL = [
  'float mothHash( vec2 p ) {',
  '  return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453123 );',
  '}',
  'float mothNoise( vec2 p ) {',
  '  float mothAmp = 0.5;',
  '  float mothSum = 0.0;',
  '  for ( int i = 0; i < 3; i++ ) {',
  '    vec2 mothCell = floor( p );',
  '    vec2 mothFrac = fract( p );',
  '    vec2 mothSmooth = mothFrac * mothFrac * ( 3.0 - 2.0 * mothFrac );',
  '    float mothN = mix(',
  '      mix( mothHash( mothCell ), mothHash( mothCell + vec2( 1.0, 0.0 ) ), mothSmooth.x ),',
  '      mix( mothHash( mothCell + vec2( 0.0, 1.0 ) ), mothHash( mothCell + vec2( 1.0, 1.0 ) ), mothSmooth.x ),',
  '      mothSmooth.y );',
  '    mothSum += mothAmp * mothN;',
  '    p *= 2.0;',
  '    mothAmp *= 0.5;',
  '  }',
  '  return mothSum;',
  '}',
  'float mothRidge( vec2 p ) {',
  '  float mothAmp = 0.62;',
  '  float mothSum = 0.0;',
  '  for ( int i = 0; i < 2; i++ ) {',
  '    vec2 mothCell = floor( p );',
  '    vec2 mothFrac = fract( p );',
  '    vec2 mothSmooth = mothFrac * mothFrac * ( 3.0 - 2.0 * mothFrac );',
  '    float mothN = mix(',
  '      mix( mothHash( mothCell ), mothHash( mothCell + vec2( 1.0, 0.0 ) ), mothSmooth.x ),',
  '      mix( mothHash( mothCell + vec2( 0.0, 1.0 ) ), mothHash( mothCell + vec2( 1.0, 1.0 ) ), mothSmooth.x ),',
  '      mothSmooth.y );',
  '    mothSum += mothAmp * ( 1.0 - abs( 2.0 * mothN - 1.0 ) );',
  '    p *= 2.07;',
  '    mothAmp *= 0.5;',
  '  }',
  '  return mothSum;',
  '}',
  'float mothCentered( vec2 p ) {',
  // 0.4375 is half the octave amplitude sum (0.5 + 0.25 + 0.125), so this
  // wraps the value noise around its own midrange: mean ~0, range ~[-1, 1].
  '  return ( mothNoise( p ) - 0.4375 ) * 2.285714;',
  '}',
  'float mothField( vec3 p, float scale, vec2 phase ) {',
  // The same fbm on three world planes. A vertical wall is constant in Z, so
  // without the XY and ZY slices it would only vary along one axis.
  '  float mothF = mothCentered( p.xz * scale + phase );',
  '  mothF += mothCentered( p.xy * scale * 0.83 + phase.yx + vec2( 11.7, 4.3 ) );',
  '  mothF += mothCentered( p.zy * scale * 0.71 + phase.yx + vec2( 5.1, 19.3 ) );',
  '  return clamp( mothF * 0.333333, -1.0, 1.0 );',
  '}',
];

export function enhanceMothMaterial(material, options = {}) {
  if (!material || typeof material !== 'object') return material;
  if (!material.userData) material.userData = {};

  const opts = options || {};
  const kind = opts.kind === undefined ? 'concrete' : opts.kind;
  const policy = mothSurfacePolicy(kind);
  const structure = policy.mode === MOTH_SURFACE_MODES.STRUCTURE;

  // Accept either spelling for the optional macro map. The texture is only
  // read, never reconfigured or disposed, so shared textures stay untouched.
  const macroTexture = opts.macroMap || opts.macro || null;

  const resolvedSeed = mothResolveSeed(opts.seed, typeof kind === 'string' ? kind : '');
  const seedRotation = mothSeedUnit(resolvedSeed, 2) * 1.7;
  const seedUvScale = 0.85 + mothSeedUnit(resolvedSeed, 3) * 0.3;
  // Shared world-space offset so adjacent materials of the same kind do not
  // march in step; also offsets the organic second sample's UVs.
  const seedPhase = new T.Vector2(
    mothSeedUnit(resolvedSeed, 0) * 37.0,
    mothSeedUnit(resolvedSeed, 1) * 53.0
  );

  const uMothMacro = { value: macroTexture };
  const uMothMacroScale = { value: mothNumber(opts.macroScale, policy.macroScale) };
  const uMothMacroStrength = { value: mothNumber(opts.macroStrength, policy.macroStrength) };
  // Rotation and break scale jitter come from the seed as defaults; an explicit
  // caller option wins exactly, so `rotation: 0` still means no rotation.
  const uMothBreakScale = {
    value: mothNumber(opts.breakScale, structure ? 1 : policy.breakScale * seedUvScale),
  };
  const uMothBreakStrength = { value: mothNumber(opts.breakStrength, policy.breakStrength) };
  const uMothRotation = {
    value: mothNumber(opts.rotation, structure ? 0 : policy.rotation + seedRotation),
  };
  const uMothFractureStrength = { value: mothNumber(opts.fractureStrength, policy.fractureStrength) };
  const uMothWearScale = {
    value: mothClamp(mothNumber(opts.wearScale, policy.wearScale * (structure ? seedUvScale : 1)), 0, 0.08),
  };
  const uMothWearStrength = {
    value: mothClamp(mothNumber(opts.wearStrength, policy.wearStrength), 0, MOTH_STRUCTURE_WEAR_CAP),
  };
  const uMothRoughStrength = {
    value: mothClamp(
      mothNumber(opts.roughStrength, policy.roughStrength),
      0,
      structure ? MOTH_STRUCTURE_ROUGH_CAP : 1
    ),
  };
  const uMothPhase = { value: seedPhase };

  material.userData.mothSurface = true;
  material.userData.mothSurfaceMode = policy.mode;
  material.userData.mothSurfaceSeed = resolvedSeed;
  material.userData.mothSurfaceFallback = null;
  material.userData.mothSurfaceUniforms = {
    uMothMacro,
    uMothMacroScale,
    uMothMacroStrength,
    uMothBreakScale,
    uMothBreakStrength,
    uMothRotation,
    uMothFractureStrength,
    uMothWearScale,
    uMothWearStrength,
    uMothRoughStrength,
    uMothPhase,
  };
  material.userData.setMothMacroStrength = (value) => {
    const next = Number(value);
    if (Number.isFinite(next)) uMothMacroStrength.value = next;
    return uMothMacroStrength.value;
  };
  material.userData.setMothBreakStrength = (value) => {
    const next = Number(value);
    if (Number.isFinite(next)) uMothBreakStrength.value = next;
    return uMothBreakStrength.value;
  };
  material.userData.setMothFractureStrength = (value) => {
    const next = Number(value);
    if (Number.isFinite(next)) uMothFractureStrength.value = next;
    return uMothFractureStrength.value;
  };
  material.userData.setMothWearStrength = (value) => {
    const next = Number(value);
    if (Number.isFinite(next)) uMothWearStrength.value = mothClamp(next, 0, MOTH_STRUCTURE_WEAR_CAP);
    return uMothWearStrength.value;
  };
  material.userData.setMothRoughStrength = (value) => {
    const next = Number(value);
    if (Number.isFinite(next)) {
      uMothRoughStrength.value = mothClamp(next, 0, structure ? MOTH_STRUCTURE_ROUGH_CAP : 1);
    }
    return uMothRoughStrength.value;
  };

  // Chain to a pre-existing patch instead of overwriting it, so composing this
  // with another material enhancer cannot drop either one.
  const previous = typeof material.onBeforeCompile === 'function' ? material.onBeforeCompile : null;

  material.onBeforeCompile = (shader, renderer) => {
    if (previous) previous.call(material, shader, renderer);
    if (!shader || typeof shader.fragmentShader !== 'string' || typeof shader.vertexShader !== 'string') {
      return;
    }

    // Share the stored uniform objects so the setters mutate the live program.
    // Installed before the anchor checks so a skip can never leave userData
    // pointing at uniforms the compiled program does not use.
    shader.uniforms.uMothMacro = uMothMacro;
    shader.uniforms.uMothMacroScale = uMothMacroScale;
    shader.uniforms.uMothMacroStrength = uMothMacroStrength;
    shader.uniforms.uMothBreakScale = uMothBreakScale;
    shader.uniforms.uMothBreakStrength = uMothBreakStrength;
    shader.uniforms.uMothRotation = uMothRotation;
    shader.uniforms.uMothFractureStrength = uMothFractureStrength;
    shader.uniforms.uMothWearScale = uMothWearScale;
    shader.uniforms.uMothWearStrength = uMothWearStrength;
    shader.uniforms.uMothRoughStrength = uMothRoughStrength;
    shader.uniforms.uMothPhase = uMothPhase;

    if (shader.fragmentShader.includes(MOTH_SURFACE_MARKER)) {
      // Another moth-surface patch (e.g. a second enhance call) already
      // injected the body; injecting again would redeclare varyings.
      return;
    }
    if (!shader.fragmentShader.includes(MOTH_FRAGMENT_ANCHOR)) {
      // Appending executable code outside main is not a safe fallback. Leave
      // the shader untouched and report why the patch was skipped.
      material.userData.mothSurface = false;
      material.userData.mothSurfaceFallback = 'missing-map-fragment-anchor';
      return;
    }
    if (!shader.vertexShader.includes(MOTH_VERTEX_ANCHOR)) {
      material.userData.mothSurface = false;
      material.userData.mothSurfaceFallback = 'missing-project-vertex-anchor';
      return;
    }

    // Vertex: capture the world position while `transformed` is in scope, and
    // include the instance/batch transform that modelMatrix alone omits.
    const worldPos = [
      'vec4 mothWorldPos = vec4( transformed, 1.0 );',
      '#ifdef USE_BATCHING',
      '  mothWorldPos = batchingMatrix * mothWorldPos;',
      '#endif',
      '#ifdef USE_INSTANCING',
      '  mothWorldPos = instanceMatrix * mothWorldPos;',
      '#endif',
      'vMothWorld = ( modelMatrix * mothWorldPos ).xyz;',
      MOTH_VERTEX_ANCHOR,
    ].join('\n');
    shader.vertexShader = `varying vec3 vMothWorld;\n${shader.vertexShader}`;
    shader.vertexShader = shader.vertexShader.replace(MOTH_VERTEX_ANCHOR, worldPos);

    const declarations = [
      `// ${MOTH_SURFACE_MARKER}`,
      'varying vec3 vMothWorld;',
      'uniform vec2 uMothPhase;',
      'uniform float uMothRoughStrength;',
    ];
    if (structure) {
      declarations.push(
        'uniform float uMothWearScale;',
        'uniform float uMothWearStrength;'
      );
    } else {
      declarations.push(
        'uniform float uMothMacroScale;',
        'uniform float uMothMacroStrength;',
        'uniform float uMothBreakScale;',
        'uniform float uMothBreakStrength;',
        'uniform float uMothRotation;',
        'uniform float uMothFractureStrength;'
      );
      if (macroTexture) declarations.push('uniform sampler2D uMothMacro;');
    }
    declarations.push(...MOTH_NOISE_GLSL);

    const albedo = structure
      ? [
        `// ${MOTH_SURFACE_MARKER}`,
        'float mothWear = mothField( vMothWorld, uMothWearScale, uMothPhase );',
        'float mothChroma = max( max( diffuseColor.r, diffuseColor.g ), diffuseColor.b ) - min( min( diffuseColor.r, diffuseColor.g ), diffuseColor.b );',
        // Saturated safety paint (hazard stripes, markings) must stay legible:
        // damp the wear by mix( 1.0, 0.35, sat ) as the plan specifies.
        'float mothGuard = mix( 1.0, 0.35, clamp( mothChroma, 0.0, 1.0 ) );',
        'diffuseColor.rgb *= 1.0 + mothWear * uMothWearStrength * mothGuard * vec3( 1.0, 0.97, 0.94 );',
      ]
      : [
        `// ${MOTH_SURFACE_MARKER}`,
        'vec2 mothP = vMothWorld.xz * uMothMacroScale + uMothPhase;',
        'float mothRegion = mothField( vMothWorld, uMothMacroScale, uMothPhase ) * 0.5 + 0.5;',
        'mothRegion = clamp( mothRegion * 0.72 + ( mothCentered( mothP * 0.37 + vec2( 13.1, 7.7 ) ) * 0.5 + 0.5 ) * 0.28, 0.0, 1.0 );',
        // The height term shears the XZ ridge domain: flat floors are unchanged
        // (Y is constant there) while walls stop smearing into vertical columns.
        'float mothCracks = mothRidge( mothP * 2.6 + vec2( vMothWorld.y * 0.12, vMothWorld.y * 0.07 ) );',
        // Cracks only bite where the broad region field is raised, so wear reads
        // as patchy fracture systems instead of uniform noise across the surface.
        'float mothVeil = smoothstep( 0.3, 0.74, mothRegion );',
        // `mothRegion` is centered on 0.5, so this shade is mean-neutral and
        // cannot cumulatively darken a whole map.
        'float mothShade = mix( 1.0, 0.58 + mothRegion * 0.84, uMothMacroStrength );',
        'mothShade *= 1.0 - mothCracks * mothVeil * uMothFractureStrength;',
        'diffuseColor.rgb *= mothShade;',
      ];
    if (!structure && macroTexture) {
      albedo.push(
        // Only organic kinds use the macro color bake. Structural kinds rely on
        // the procedural field alone so saturated markings stay unambiguous.
        `vec3 mothMacroTex = texture2D( uMothMacro, vMothWorld.xz * ${MOTH_MACRO_TEX_SCALE} ).rgb;`,
        // 0.5 is the documented neutral value of the macro bake; scaling only
        // the deviation keeps the term mean-neutral at any strength.
        `diffuseColor.rgb *= 1.0 + ( mothMacroTex - ${MOTH_MACRO_NEUTRAL} ) * 2.0 * uMothMacroStrength;`
      );
    }
    if (!structure) {
      albedo.push(
        '#ifdef USE_MAP',
        // The rotated second sample is deliberately not mirrored into the
        // normal map: a wrong tangent-space reorientation would be worse than
        // no perturbation at all.
        'mat2 mothRot = mat2( cos( uMothRotation ), -sin( uMothRotation ), sin( uMothRotation ), cos( uMothRotation ) );',
        'vec2 mothRotUv = mothRot * vMapUv + uMothPhase * 0.13;',
        'vec4 mothSecond = texture2D( map, mothRotUv * uMothBreakScale );',
        'diffuseColor.rgb = mix( diffuseColor.rgb, diffuseColor.rgb * ( 0.6 + mothSecond.rgb * 0.8 ), uMothBreakStrength );',
        '#endif'
      );
    }

    // Roughness is modulated independently of the albedo so wear reads in
    // reflections too, describing the same surface as the color.
    const roughness = structure
      ? [
        `// ${MOTH_SURFACE_MARKER}`,
        'roughnessFactor = clamp( roughnessFactor + mothWear * uMothRoughStrength * mothGuard, 0.04, 1.0 );',
      ]
      : [
        `// ${MOTH_SURFACE_MARKER}`,
        'roughnessFactor = clamp( roughnessFactor + ( mothRegion - 0.5 ) * 2.0 * uMothRoughStrength + mothCracks * mothVeil * uMothFractureStrength * 0.35, 0.04, 1.0 );',
      ];

    shader.fragmentShader = `${declarations.join('\n')}\n${shader.fragmentShader}`;
    shader.fragmentShader = shader.fragmentShader.replace(
      MOTH_FRAGMENT_ANCHOR,
      `${MOTH_FRAGMENT_ANCHOR}\n${albedo.join('\n')}`
    );
    // Normals are intentionally left alone (see the note in the albedo block).
    if (shader.fragmentShader.includes(MOTH_ROUGHNESS_ANCHOR)) {
      shader.fragmentShader = shader.fragmentShader.replace(
        MOTH_ROUGHNESS_ANCHOR,
        `${MOTH_ROUGHNESS_ANCHOR}\n${roughness.join('\n')}`
      );
      material.userData.mothSurfaceFallback = null;
    } else {
      material.userData.mothSurfaceFallback = 'missing-roughnessmap-anchor';
    }
    material.userData.mothSurface = true;
  };

  // The key covers mode, macro presence and the resolved seed (seed only feeds
  // uniforms today, but a future seeded GLSL branch must not share a program).
  const macroKey = macroTexture && !structure ? 'macro' : 'plain';
  const baseKey =
    typeof T.Material.prototype.customProgramCacheKey === 'function'
      ? material.customProgramCacheKey
      : null;
  material.customProgramCacheKey = () =>
    `${MOTH_SURFACE_MARKER}:${policy.mode}:${macroKey}:${resolvedSeed}:${
      typeof baseKey === 'function' ? baseKey.call(material) : ''
    }`;

  return material;
}

// Host hook for callers that tick surface effects. Deterministic and, today,
// unused by the shader; kept so the caller API is stable.
export function updateMothSurface(time = 0) {
  return (Number(time) || 0) * 0.0;
}
