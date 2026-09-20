// Named loadout presets. Pure and engine-free so persistence, validation and
// de-duplication are unit-testable. A preset captures the operator, harness,
// arena, match rules and the full cosmetic/gear loadout.
export const PRESET_LIMIT = 8;
export const PRESET_STORAGE_KEY = 'token-arena-presets';

const clean = (value, max) => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max) : '';
const titleCase = value => {const text = clean(value, 24); return text ? text[0].toUpperCase() + text.slice(1) : '';};

function sanitizeSlots(value, slots, allowed) {
  const source = value && typeof value === 'object' ? value : {};
  const out = {};
  for (const slot of Array.isArray(slots) ? slots : []) {
    const id = clean(source[slot], 40);
    if (!id) continue;
    if (Array.isArray(allowed) && allowed.length && !allowed.includes(id)) continue;
    out[slot] = id;
  }
  return out;
}

function pickCosmetic(value, allowed) {
  const id = clean(value, 40);
  if (!id) return null;
  if (Array.isArray(allowed) && allowed.length && !allowed.includes(id)) return null;
  return id;
}

export function descriptivePresetName(raw = {}) {
  const parts = [titleCase(raw.character), titleCase(raw.harness)].filter(Boolean);
  const mode = clean(raw?.config?.mode, 24);
  const label = [parts.join(' · '), mode ? mode.toUpperCase() : ''].filter(Boolean).join(' · ');
  return clean(label, 40) || 'Loadout';
}

export function normalizeLoadout(raw = {}, {gearSlots = [], gearIds = [], attachmentSlots = [], attachmentIds = [], finishes = [], crosshairs = []} = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  return {
    gear: sanitizeSlots(source.gear ?? source.equipment, gearSlots, gearIds),
    attachments: sanitizeSlots(source.attachments ?? source.mods, attachmentSlots, attachmentIds),
    finish: pickCosmetic(source.finish, finishes),
    crosshair: pickCosmetic(source.crosshair, crosshairs),
  };
}

export function normalizePreset(raw, {characters = [], harnesses = [], maps = [], gearSlots = [], gearIds = [], attachmentSlots = [], attachmentIds = [], finishes = [], crosshairs = []} = {}, makeId) {
  if (!raw || typeof raw !== 'object') return null;
  const character = clean(raw.character, 24), harness = clean(raw.harness, 24), mapId = clean(raw.mapId, 40), name = clean(raw.name, 40) || descriptivePresetName({...raw, character, harness});
  if (characters.length && !characters.includes(character)) return null;
  if (harnesses.length && !harnesses.includes(harness)) return null;
  if (maps.length && !maps.includes(mapId)) return null;
  const id = clean(raw.id, 40) || (typeof makeId === 'function' ? clean(makeId(), 40) : `p${Math.floor(Math.random() * 1e9).toString(36)}`);
  if (!id) return null;
  return {id, name, character, harness, mapId, config: raw.config && typeof raw.config === 'object' ? {...raw.config} : {}, loadout: normalizeLoadout(raw.loadout ?? raw, {gearSlots, gearIds, attachmentSlots, attachmentIds, finishes, crosshairs})};
}

export function normalizePresets(value, options, makeId) {
  return (Array.isArray(value) ? value : [])
    .map((item, index) => normalizePreset(item, options, makeId ? () => makeId(index) : undefined))
    .filter(Boolean)
    .slice(-PRESET_LIMIT);
}

export function addPreset(list, preset) {
  if (!preset) return Array.isArray(list) ? list.slice(-PRESET_LIMIT) : [];
  const kept = (Array.isArray(list) ? list : []).filter(item => item.id !== preset.id && String(item.name).toLowerCase() !== String(preset.name).toLowerCase());
  return [...kept, preset].slice(-PRESET_LIMIT);
}

export function removePreset(list, id) {
  return (Array.isArray(list) ? list : []).filter(item => item.id !== id);
}

// Undo for a delete: put the exact preset back at its remembered position and
// keep the capacity rule, so undo can never smuggle an over-limit list in.
export function restorePreset(list, preset, index = null) {
  if (!preset || typeof preset !== 'object') return Array.isArray(list) ? list.slice(-PRESET_LIMIT) : [];
  const kept = (Array.isArray(list) ? list : []).filter(item => item && item.id !== preset.id);
  const at = Number.isInteger(index) ? Math.max(0, Math.min(index, kept.length)) : kept.length;
  return [...kept.slice(0, at), preset, ...kept.slice(at)].slice(-PRESET_LIMIT);
}

export function findPreset(list, id) {
  return (Array.isArray(list) ? list : []).find(item => item.id === id) || null;
}

// Quick display profiles. Kept beside the loadout presets so the menu can offer
// one-tap quality tiers without hard-coding values in the component.
export const DISPLAY_PRESETS = Object.freeze([
  {id: 'performance', name: 'Performance', detail: 'Low resolution, low detail, FPS on.', values: {resolutionScale: .5, postFx: false, bloom: 0, quality: 'low', showFps: true}},
  {id: 'balanced', name: 'Balanced', detail: 'Standard resolution with a soft glow.', values: {resolutionScale: .85, postFx: true, bloom: .34, quality: 'medium', showFps: false}},
  {id: 'quality', name: 'Quality', detail: 'High resolution and a strong glow.', values: {resolutionScale: 1.25, postFx: true, bloom: .5, quality: 'high', showFps: false}},
]);

export function applyDisplayPreset(display, id) {
  const base = display && typeof display === 'object' ? {...display} : {};
  const preset = DISPLAY_PRESETS.find(item => item.id === id);
  return preset ? {...base, ...preset.values} : base;
}

// ---------------------------------------------------------------------------
// Accessibility palettes. The 3D engine only understands the canonical
// `default` / `colorblind` display values, so the page keeps
// `display.teamPalette` as that coarse hint while the 2D UI (radar, score
// banners, HUD chips) reads the richer palette selected here. Pure and
// engine-free so the palette maths and persistence are unit-testable.
export const ACCESSIBILITY_VERSION = 1;
export const ACCESSIBILITY_STORAGE_KEY = 'token-arena-accessibility';
export const DEFAULT_PALETTE_ID = 'default';
export const HIGH_CONTRAST_CLASS = 'ui-contrast';

const palette = (id, name, detail, colors) => Object.freeze({id, name, detail, ...colors});

// Each deficiency palette keeps team hues on opposite sides of the affected
// axis: green-blind uses orange/blue, red-blind uses blue/yellow, blue-blind
// uses vermillion/teal. Colours follow the Okabe-Ito safe set.
export const ACCESSIBILITY_PALETTES = Object.freeze([
  palette('default', 'Red / blue', 'Classic red-versus-blue teams.', {
    team: ['#ed514b', '#438eff'],
    red: '#ed514b', blue: '#438eff', hostile: '#ff6b6b', self: '#8dffb0', teammate: '#7fe7ff',
    neutral: '#55ddcc', contested: '#ffd166', payload: '#ff9f43', waypoint: '#ffe066',
  }),
  palette('deuteranopia', 'Deuteranopia', 'Orange versus blue for green-blind players.', {
    team: ['#ff9d2e', '#2f9bff'],
    red: '#ff9d2e', blue: '#2f9bff', hostile: '#ffb000', self: '#8dffb0', teammate: '#7fe7ff',
    neutral: '#55ddcc', contested: '#ffd166', payload: '#ffc04d', waypoint: '#ffe066',
  }),
  palette('protanopia', 'Protanopia', 'Blue versus yellow for red-blind players.', {
    team: ['#0072b2', '#f0e442'],
    red: '#0072b2', blue: '#f0e442', hostile: '#56b4e9', self: '#8dffb0', teammate: '#7fe7ff',
    neutral: '#55ddcc', contested: '#ffd166', payload: '#e69f00', waypoint: '#f0e442',
  }),
  palette('tritanopia', 'Tritanopia', 'Vermillion versus teal for blue-blind players.', {
    team: ['#d55e00', '#009e73'],
    red: '#d55e00', blue: '#009e73', hostile: '#cc79a7', self: '#8dffb0', teammate: '#7fe7ff',
    neutral: '#55ddcc', contested: '#ffd166', payload: '#e69f00', waypoint: '#f0e442',
  }),
]);

export function paletteIds() {
  return ACCESSIBILITY_PALETTES.map(item => item.id);
}

export function normalizePaletteId(value) {
  return ACCESSIBILITY_PALETTES.some(item => item.id === value) ? value : DEFAULT_PALETTE_ID;
}

export function paletteById(id) {
  const key = normalizePaletteId(id);
  return ACCESSIBILITY_PALETTES.find(item => item.id === key) || ACCESSIBILITY_PALETTES[0];
}

export function paletteOptions() {
  return ACCESSIBILITY_PALETTES.map(({id, name, detail}) => ({id, name, detail}));
}

export function teamColorsFor(id) {
  return [...paletteById(id).team];
}

// Radar-ready colour object: the same shape radar.mjs builds for its own
// palettes, so the HUD can consume it without knowing about accessibility.
export function radarPaletteFor(id) {
  const p = paletteById(id);
  return {
    red: p.red, blue: p.blue, hostile: p.hostile, self: p.self, teammate: p.teammate,
    neutral: p.neutral, contested: p.contested, payload: p.payload, waypoint: p.waypoint,
  };
}

// The 3D renderer only distinguishes default from every colourblind variant.
export function enginePaletteFor(id) {
  return normalizePaletteId(id) === DEFAULT_PALETTE_ID ? 'default' : 'colorblind';
}

export function normalizeAccessibility(value) {
  const source = value && typeof value === 'object' ? value : {};
  return {
    version: ACCESSIBILITY_VERSION,
    palette: normalizePaletteId(source.palette),
    highContrast: source.highContrast === true,
  };
}

export function defaultAccessibility() {
  return normalizeAccessibility({});
}
