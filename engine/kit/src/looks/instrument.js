// One material recipe drives the block models, their CSS equivalents and the
// mount around them. Transmission is the fraction of the backing visible
// through the front sheet; grain is sampled in model space across the slab.
import { defineLook, LOOKS } from '../core/look.js';
import './lit.js';
import { switchTreble } from '../core/sound.js';
import { defineMaterial } from '../core/materials.js';
import { cases, caps, lamps, finish, shellTokens, hardware } from './fittings.js';
export { cases, caps, lamps };

for (const [name, day] of Object.entries({
  panel: '#e2d8c1', backlight: '#ffb45f', 'cap-inlay': '#909b80', 'cap-ridge': '#637a6c',
})) defineMaterial(name, { day, jitter: .006 });

const paint = (day, rest = {}) => ({ day, night: day, ...rest });
export const defaults = { shell: 'walnut', caps: 'field', profile: 'high', lamp: 'amber', level: 7, rail: 'steady' };
export function settings(value = {}) {
  const has = (items, key) => Object.hasOwn(items, key);
  return { shell: has(cases, value?.shell) ? value.shell : defaults.shell,
    caps: has(caps, value?.caps) ? value.caps : defaults.caps,
    profile: value?.profile === 'low' ? 'low' : 'high',
    lamp: has(lamps, value?.lamp) ? value.lamp : defaults.lamp,
    rail: value?.rail === 'spectrum' ? 'spectrum' : 'steady',
    level: Number.isFinite(value?.level) ? Math.max(0, Math.min(10, Math.round(value.level))) : defaults.level };
}

export function instrument(s, root, stage) {
  // The page's tokens come from css/fittings.css, keyed on the attributes set below, so they hold
  // before and without the script; here the voxels get the same colours, by day and at night,
  // and the lamp's live values are set.
  const shellName = s.shell;
  const shell = cases[shellName], cap = caps[s.caps], light = lamps[s.lamp].hue;
  switchTreble(shell.treble);
  const page = shellTokens(shellName), dark = shellTokens(shellName, true);
  const two = (key) => ({ day: page[key], night: dark[key] });
  const ink = two('--vx-ink'), panel = two('--panel');
  const vars = { '--case-lamp': light, '--lamp-level': s.level / 10 };
  const shape = [shellName, s.caps, s.profile].join('/');
  const retool = LOOKS.instrument?.tooling !== shape;
  let look = LOOKS.instrument;
  if (retool) {
    look = defineLook('instrument', { from: 'lit', tooling: shape, readingPlate: 'panel', artwork: s.caps === 'field', rise: s.profile === 'high' ? 7 : 3,
      travel: s.profile === 'high' ? 4 : 2, grain: 1, seam: .45,
      finishes: { ...LOOKS.lit.finishes, chalk: shell.face, key: cap.face, 'lamp-cap': cap.face, 'warm-metal': finish(65, 105), 'spun-brass': finish(10, 85) },
      materials: { panel: { ...panel }, chalk: paint(shell.plate, { grain: shell.grain, transmission: shell.transmission, jitter: .004 }),
        'lamp-cap': paint(cap.key, { transmission: cap.transmission, jitter: .007 }),
        key: paint(cap.key, { transmission: cap.transmission, jitter: .009 }), ink: { ...ink },
        steel: paint(hardware.steel), gasket: paint(hardware.gasket), slate: paint(hardware.slate),
        floor: two('--vx-floor'), ivory: paint(hardware.ivory), enamel: LOOKS.lit.appliedTheme?.cap ?? paint('#aa4a27'),
        'warm-metal': paint('#baaa8b', { grain: (x,y) => .013 * Math.sin(Math.hypot(x,y)*2.5) }) } });
  }
  // Only the decorative light pipe and the cap diffuser follow this dimmer.
  // Status lenses keep their own colors and output.
  const intensity = s.level / 10;
  const recolor = look.illuminant !== light || look.dimmer !== intensity;
  if (recolor) {
    look.illuminant = light;
    look.dimmer = intensity;
    const rgb = [1,3,5].map(i => parseInt(light.slice(i,i+2),16));
    const lit = '#' + rgb.map(c => Math.round(42 + (c - 42) * intensity).toString(16).padStart(2,'0')).join('');
    look.materials.backlight = paint(lit, { glow: intensity });
    if (cap.transmission) {
      const tint = '#' + rgb.map((c,i) => {
        const base = parseInt(cap.key.slice(1+2*i,3+2*i),16);
        return Math.round(base + (c-base)*intensity*.35).toString(16).padStart(2,'0');
      }).join('');
      look.materials.key = paint(tint, { transmission: cap.transmission });
    }
    delete look._table;
  }
  // a cap that lets light through takes the lamp's tint; the others keep their stylesheet colour
  if (cap.transmission) vars['--vx-key'] = look.materials.key.day;
  else root.style.removeProperty('--vx-key');
  for (const [key, value] of Object.entries(vars)) root.style.setProperty(key, value);
  root.dataset.rail = s.rail;
  root.dataset.shell = s.shell;
  root.dataset.caps = s.caps;
  root.dataset.profile = s.profile;
  if (stage) for (const l of stage.lives.values()) {
    if (retool) l.retint();
    else if (l.look === look && recolor) l.recolor();
  }
}
