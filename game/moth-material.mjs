import * as T from 'three';

// Iridescent "quantum entanglement" materials. A small reflectance LUT (an RGB
// DataTexture produced by the Moth asset pipeline) is sampled by Fresnel and a
// drifting phase to add a colour-shifting term on top of a standard material.
// The whole patch is opt-in: without a LUT the material is a plain
// MeshStandardMaterial so headless/CI users never touch a sampler.

export const MOTH_LUT_SHADER_MARKER = 'moth_lut_fresnel';

const MOTH_ADD_ANCHOR = '#include <opaque_fragment>';
const MOTH_PHASE_RATE = 0.05;

let mothPhase = 0;

// Advance the shared phase clock from an absolute time (seconds). The result is
// a pure function of `time`, so replaying the same timestamp is deterministic.
export function updateMoth(time = 0) {
  const seconds = Number.isFinite(time) ? time : 0;
  mothPhase = (((seconds * MOTH_PHASE_RATE) % 1) + 1) % 1;
  return mothPhase;
}

function prepareLut(lut) {
  if (!lut || typeof lut !== 'object') return null;
  // Caller-owned textures are configured in place but never disposed here.
  if (lut.wrapS !== T.RepeatWrapping) lut.wrapS = T.RepeatWrapping;
  if (lut.wrapT !== T.RepeatWrapping) lut.wrapT = T.RepeatWrapping;
  if (lut.colorSpace !== T.NoColorSpace) lut.colorSpace = T.NoColorSpace;
  return lut;
}

export function createMothLutMaterial({
  lut = null,
  lutT = null,
  base = {},
  phase = 0.35,
  intensity = 0.9,
} = {}) {
  const material = new T.MeshStandardMaterial({ ...base });
  const primary = prepareLut(lut);
  const secondary = prepareLut(lutT);

  const uMothLut = { value: primary };
  const uMothPhase = { value: phase };
  const uMothIntensity = { value: intensity };

  material.userData.moth = true;
  material.userData.mothUniforms = { uMothLut, uMothPhase, uMothIntensity };
  material.userData.mothLut = primary;
  material.userData.mothLutT = secondary;
  material.userData.setMothPhase = (value) => {
    const next = Number(value);
    if (Number.isFinite(next)) uMothPhase.value = next;
    return uMothPhase.value;
  };
  material.userData.setMothIntensity = (value) => {
    const next = Number(value);
    if (Number.isFinite(next)) uMothIntensity.value = next;
    return uMothIntensity.value;
  };

  material.onBeforeCompile = (shader) => {
    // Share the exact uniform objects with the shader so live setters mutate the
    // compiled program without a recompile.
    shader.uniforms.uMothLut = uMothLut;
    shader.uniforms.uMothPhase = uMothPhase;
    shader.uniforms.uMothIntensity = uMothIntensity;
    if (!primary) return;

    const declarations = [
      `// ${MOTH_LUT_SHADER_MARKER}`,
      'uniform sampler2D uMothLut;',
      'uniform float uMothPhase;',
      'uniform float uMothIntensity;',
    ];
    const samples = [
      '  float mothDot = clamp( dot( normalize( vViewPosition ), normal ), 0.0, 1.0 );',
      '  float mothFresnel = pow( 1.0 - mothDot, 3.0 );',
      '  vec2 mothUv = vec2( clamp( mothFresnel, 0.0, 1.0 ), fract( uMothPhase ) );',
      '  vec3 mothColor = texture2D( uMothLut, mothUv ).rgb;',
    ];
    if (secondary) {
      declarations.push('uniform sampler2D uMothLutT;');
      shader.uniforms.uMothLutT = { value: secondary };
      samples.push(
        '  vec2 mothUvT = vec2( clamp( mothFresnel, 0.0, 1.0 ), fract( uMothPhase + 0.5 ) );',
        '  vec3 mothColorT = texture2D( uMothLutT, mothUvT ).rgb;',
        '  mothColor = mix( mothColor, mothColorT, 0.5 );'
      );
    }
    const addBlock = [
      `// ${MOTH_LUT_SHADER_MARKER}`,
      '{',
      ...samples,
      '  outgoingLight += mothColor * uMothIntensity;',
      '}',
    ].join('\n');

    shader.fragmentShader = `${declarations.join('\n')}\n${shader.fragmentShader}`;
    if (shader.fragmentShader.includes(MOTH_ADD_ANCHOR)) {
      shader.fragmentShader = shader.fragmentShader.replace(
        MOTH_ADD_ANCHOR,
        `${addBlock}\n${MOTH_ADD_ANCHOR}`
      );
    } else {
      shader.fragmentShader = `${shader.fragmentShader}\n${addBlock}`;
    }
  };

  material.customProgramCacheKey = () =>
    `moth:${primary ? 'lut' : 'plain'}:${secondary ? 'lutT' : 'none'}`;

  return material;
}
