// Asset-pack helper; deliberately not wired into SynthAudio yet.
// Keep state per player instance, not globally. Never immediately repeat a take.
export function createAnnouncerSelector(clips, random = Math.random) {
 const groups = new Map(), previous = new Map();
 for (const clip of clips) {
  if (!/^[a-z-]+-\d+\.wav$/.test(clip.file)) throw new Error('Invalid announcer filename');
  if (!groups.has(clip.cue)) groups.set(clip.cue, []);
  groups.get(clip.cue).push(clip);
 }
 return cue => {
  const all = groups.get(cue);
  if (!all?.length) return null;
  const candidates = all.length > 1 ? all.filter(c => c.file !== previous.get(cue)) : all;
  const value = random();
  const index = Number.isFinite(value) ? Math.max(0, Math.min(candidates.length - 1, Math.floor(value * candidates.length))) : 0;
  const clip = candidates[index];
  previous.set(cue, clip.file);
  return {...clip, url: `/audio/announcer/${clip.file}`};
 };
}
