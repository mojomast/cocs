import * as T from 'three';

// Anti-tiling surface enhancer. Baked albedo maps repeat on a fixed grid, which
// reads as an obvious pattern across large meshes. This patches a standard
// material so its albedo is modulated by large-scale, world-space procedural
// noise and blended with a rotated/scaled second sample of the same map. The
// tiling period becomes far longer and irregular. Grid-like textures (hazard
// stripes, paneling, ...) *want* to repeat, so for those the enhancer is a
// deliberate no-op.

export const MOTH_SURFACE_MARKER = 'moth_surface_break';

// Canonical texture kinds where a grid/tiling look is desired. For these the
// enhancer must not run.
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

// Sensible per-kind defaults for natural, non-repeating surfaces. Kept small
// and plain so callers can spread/override them.
const MOTH_NATURAL_PRESETS = Object.freeze({
  rock: { macroScale: 0.012, macroStrength: 0.5, breakScale: 0.37, breakStrength: 0.4, rotation: 0.7 },
  sand: { macroScale: 0.008, macroStrength: 0.35, breakScale: 0.21, breakStrength: 0.3, rotation: 1.1 },
  ice: { macroScale: 0.02, macroStrength: 0.4, breakScale: 0.55, breakStrength: 0.3, rotation: 0.4 },
  grass: { macroScale: 0.02, macroStrength: 0.5, breakScale: 0.29, breakStrength: 0.45, rotation: 0.9 },
  weathered_concrete: { macroScale: 0.01, macroStrength: 0.45, breakScale: 0.41, breakStrength: 0.35, rotation: 0.6 },
  rough_stucco: { macroScale: 0.014, macroStrength: 0.42, breakScale: 0.33, breakStrength: 0.4, rotation: 0.8 },
  alien_chitin: { macroScale: 0.025, macroStrength: 0.55, breakScale: 0.47, breakStrength: 0.5, rotation: 1.3 },
  metal: { macroScale: 0.009, macroStrength: 0.3, breakScale: 0.61, breakStrength: 0.25, rotation: 0.5 },
  concrete: { macroScale: 0.012, macroStrength: 0.45, breakScale: 0.37, breakStrength: 0.35, rotation: 0.7 },
});

const MOTH_FALLBACK_CONFIG = Object.freeze({
  macroScale: 0.012,
  macroStrength: 0.45,
  breakScale: 0.37,
  breakStrength: 0.35,
  rotation: 0.7,
});

function mothNumber(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

// Returns a fresh settings object for a natural kind, `null` for a grid kind,
// and the fallback preset for anything unknown.
export function mothSurfaceBreakConfig(kind) {
  const key = typeof kind === 'string' ? kind : '';
  if (MOTH_GRID_KINDS.includes(key)) return null;
  const preset = MOTH_NATURAL_PRESETS[key] || MOTH_FALLBACK_CONFIG;
  return {
    macroScale: preset.macroScale,
    macroStrength: preset.macroStrength,
    breakScale: preset.breakScale,
    breakStrength: preset.breakStrength,
    rotation: preset.rotation,
  };
}

const MOTH_FRAGMENT_ANCHOR = '#include <map_fragment>';
const MOTH_VERTEX_ANCHOR = '#include <fog_vertex>';

// Cheap, closed-form hash + fbm-ish value noise. No textures, no derivatives,
// three octaves at most.
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
];

export function enhanceMothMaterial(material, options = {}) {
  if (!material || typeof material !== 'object') return material;
  if (!material.userData) material.userData = {};

  const opts = options || {};
  const kind = opts.kind === undefined ? 'concrete' : opts.kind;
  const config = mothSurfaceBreakConfig(kind);
  if (!config) {
    material.userData.mothSurface = false;
    return material;
  }

  // Accept either spelling for the optional macro map. The texture is only
  // read, never reconfigured or disposed, so shared textures stay untouched.
  const macroTexture = opts.macroMap || opts.macro || null;

  const uMothMacro = { value: macroTexture };
  const uMothMacroScale = { value: mothNumber(opts.macroScale, config.macroScale) };
  const uMothMacroStrength = { value: mothNumber(opts.macroStrength, config.macroStrength) };
  const uMothBreakScale = { value: mothNumber(opts.breakScale, config.breakScale) };
  const uMothBreakStrength = { value: mothNumber(opts.breakStrength, config.breakStrength) };
  const uMothRotation = { value: mothNumber(opts.rotation, config.rotation) };

  material.userData.mothSurface = true;
  material.userData.mothSurfaceUniforms = {
    uMothMacro,
    uMothMacroScale,
    uMothMacroStrength,
    uMothBreakScale,
    uMothBreakStrength,
    uMothRotation,
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

  material.onBeforeCompile = (shader) => {
    // Share the stored uniform objects so the setters mutate the live program.
    shader.uniforms.uMothMacro = uMothMacro;
    shader.uniforms.uMothMacroScale = uMothMacroScale;
    shader.uniforms.uMothMacroStrength = uMothMacroStrength;
    shader.uniforms.uMothBreakScale = uMothBreakScale;
    shader.uniforms.uMothBreakStrength = uMothBreakStrength;
    shader.uniforms.uMothRotation = uMothRotation;

    // Vertex: capture the world position while `transformed` is in scope.
    shader.vertexShader = `varying vec3 vMothWorld;\n${shader.vertexShader}`;
    shader.vertexShader = shader.vertexShader.replace(
      MOTH_VERTEX_ANCHOR,
      `${MOTH_VERTEX_ANCHOR}\n\tvMothWorld = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;`
    );

    const declarations = [
      `// ${MOTH_SURFACE_MARKER}`,
      'varying vec3 vMothWorld;',
      'uniform float uMothMacroScale;',
      'uniform float uMothMacroStrength;',
      'uniform float uMothBreakScale;',
      'uniform float uMothBreakStrength;',
      'uniform float uMothRotation;',
    ];
    if (macroTexture) declarations.push('uniform sampler2D uMothMacro;');
    declarations.push(...MOTH_NOISE_GLSL);

    const body = [
      `// ${MOTH_SURFACE_MARKER}`,
      '#ifdef USE_MAP',
      '  float mothMacro = mothNoise( vMothWorld.xz * uMothMacroScale );',
      '  diffuseColor.rgb *= mix( 1.0, 0.6 + mothMacro * 0.8, uMothMacroStrength );',
    ];
    if (macroTexture) {
      body.push(
        '  vec3 mothMacroTex = texture2D( uMothMacro, vMothWorld.xz * 0.0015 ).rgb;',
        '  diffuseColor.rgb *= ( 0.5 + mothMacroTex );'
      );
    }
    body.push(
      '  mat2 mothRot = mat2( cos( uMothRotation ), -sin( uMothRotation ), sin( uMothRotation ), cos( uMothRotation ) );',
      '  vec2 mothRotUv = mothRot * vMapUv;',
      '  vec4 mothSecond = texture2D( map, mothRotUv * uMothBreakScale );',
      '  diffuseColor.rgb = mix( diffuseColor.rgb, diffuseColor.rgb * ( 0.6 + mothSecond.rgb * 0.8 ), uMothBreakStrength );',
      '#endif'
    );

    shader.fragmentShader = `${declarations.join('\n')}\n${shader.fragmentShader}`;
    if (shader.fragmentShader.includes(MOTH_FRAGMENT_ANCHOR)) {
      shader.fragmentShader = shader.fragmentShader.replace(
        MOTH_FRAGMENT_ANCHOR,
        `${MOTH_FRAGMENT_ANCHOR}\n${body.join('\n')}`
      );
    } else {
      shader.fragmentShader = `${shader.fragmentShader}\n${body.join('\n')}`;
    }
  };

  const macroKey = macroTexture ? 'macro' : 'plain';
  const baseKey =
    typeof T.Material.prototype.customProgramCacheKey === 'function'
      ? material.customProgramCacheKey
      : null;
  material.customProgramCacheKey = () =>
    `${MOTH_SURFACE_MARKER}:enhanced:${macroKey}:${
      typeof baseKey === 'function' ? baseKey.call(material) : ''
    }`;

  return material;
}

// Host hook for callers that tick surface effects. Deterministic and, today,
// unused by the shader; kept so the caller API is stable.
export function updateMothSurface(time = 0) {
  return (Number(time) || 0) * 0.0;
}
