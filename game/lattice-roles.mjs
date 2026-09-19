// Pure loadout copy + declarative field hooks. Numbers are LATTICE-local;
// combat kits, movement, and the general economy keep their own budgets.
import {resolveLoadout} from './data.mjs';

const freeze = value => {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
};
const role = (role, name, description, hook) => ({role, name, description, hook});

export const LATTICE_OPERATOR_ROLES = freeze({
  mistral: role('scout', 'Running point', 'Capture 20% faster while moving at least 4 m/s inside the point; stopping loses the bonus.',
    {type: 'capture', when: 'moving', speed: 4, scale: 1.2}),
  gemini: role('assault', 'Relay duelist', 'Swapping weapons opens 3 seconds of 20% faster capture; the window can open only once every 6 seconds.',
    {type: 'capture', when: 'swap', seconds: 3, cooldown: 6, scale: 1.2}),
  grok: role('assault', 'Hot breach', 'Capture 25% faster with at least two Heat stacks. Keep landing hits; cooling off loses the bonus.',
    {type: 'capture', when: 'heat', minimum: .04, scale: 1.25}),
  deepseek: role('scout', 'Patient overwatch', 'While stationary on a point, reveal one visible enemy within 24 m for 2 seconds, every 4 seconds. Intel grants no damage bonus.',
    {type: 'recon', when: 'still', range: 24, seconds: 2, cooldown: 4}),
  meta: role('engineer', 'Braced maintenance', 'Crouch without firing on an owned, uncontested cut point for 4 seconds to repair its link. Moving or taking damage interrupts.',
    {type: 'repair', when: 'braced', channel: 4, cooldown: 8}),
  claude: role('support', 'Safe review', 'Hold still without firing on an owned point to clear slow from one nearby ally, at most once every 6 seconds.',
    {type: 'cleanse', when: 'holding', range: 8, targets: 1, cooldown: 6}),
  chatgpt: role('support', 'Adaptive quartermaster', 'During the post-swap handling window, share up to a quarter-magazine from your ammo belt with one nearby ally on a point, every 8 seconds.',
    {type: 'supply', when: 'adaptive', range: 8, fraction: .25, targets: 1, cooldown: 8}),
  kimi: role('scout', 'Moving context', 'While moving on a point, reveal one visible enemy within 32 m for 1.5 seconds, every 3 seconds. Intel grants no damage bonus.',
    {type: 'recon', when: 'moving', speed: 2, range: 32, seconds: 1.5, cooldown: 3}),
  qwen: role('engineer', 'Tool-use specialist', 'Capture, terminal channels, and economy-node PRIME run at 1.35× speed. Capture uses the strongest bonus, never stacked copies.',
    {type: 'interaction', scale: 1.35}),
});

export const LATTICE_HARNESS_ROLES = freeze({
  openclaw: role('assault', 'Break the siege', 'Claw activation removes up to 15% hostile capture progress from one point within 6 m; it never grants ownership. The point shares an 8-second disruption cooldown.',
    {type: 'disrupt', range: 6, amount: .15, cooldown: 8}),
  hermes: role('support', 'Courier delivery', 'Activate at a connected owned economy point to trade up to 4 personal REQ for 3 team FLUX. Deliveries share a 10-second point cooldown.',
    {type: 'delivery', range: 6, req: 4, flux: 3, cooldown: 10}),
  opencode: role('support', 'Multiplex supply', 'Burst activation shares up to a quarter-magazine from your ammo belt with two allies within 8 m on the point. Recipients share an 8-second resupply cooldown.',
    {type: 'supply', range: 8, fraction: .25, targets: 2, cooldown: 8}),
  claudecode: role('support', 'Team guardrail', 'Guardrail activation clears slow from up to three allies within 8 m on the point. Each ally can receive a cleanse once every 6 seconds.',
    {type: 'cleanse', range: 8, targets: 3, cooldown: 6}),
  codex: role('engineer', 'Recompile link', 'Recompile activation repairs one owned, uncontested cut point within 6 m, including its sabotaged terminal.',
    {type: 'repair', range: 6, cooldown: 8}),
  cline: role('assault', 'Step onto the point', 'After a successful dash, capture 25% faster for 3 seconds while physically on a point; it does not stack with stronger capture boosts.',
    {type: 'capture', seconds: 3, scale: 1.25, cooldown: 6}),
  roo: role('engineer', 'Jam the takeover', 'Jam activation wards one owned point within 9 m for 4 seconds: hostile capture is 20% slower. Wards share an 8-second point cooldown and use the strongest effect with FORTIFY.',
    {type: 'ward', range: 9, seconds: 4, resist: .2, cooldown: 8}),
});

/** Stable UI API; respects the shipped Claude/Claude Code lock and fallbacks. */
export function latticeLoadoutRoles(character, harness) {
  const loadout = resolveLoadout(character, harness);
  return Object.freeze({operator: LATTICE_OPERATOR_ROLES[loadout.character], harness: LATTICE_HARNESS_ROLES[loadout.harness]});
}
