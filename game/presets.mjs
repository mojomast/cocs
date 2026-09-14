// Named loadout presets. Pure and engine-free so persistence, validation and
// de-duplication are unit-testable. A preset captures the operator, harness,
// arena, match rules and the full cosmetic/gear loadout.
export const PRESET_LIMIT = 8;
export const PRESET_STORAGE_KEY = 'token-arena-presets';
export const LOADOUT_KEYS = Object.freeze(['gear', 'attachments', 'finish', 'crosshair']);

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
