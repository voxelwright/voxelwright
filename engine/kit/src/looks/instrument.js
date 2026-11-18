// One material recipe drives the block models, their CSS equivalents and the
// mount around them. Transmission is the fraction of the backing visible
// through the front sheet; grain is sampled in model space across the slab.
import { defineLook, LOOKS } from '../core/look.js';
import './lit.js';
import { defineMaterial } from '../core/materials.js';

for (const [name, day] of Object.entries({
  panel: '#e2d8c1', backlight: '#ffb45f', 'cap-inlay': '#909b80', 'cap-ridge': '#637a6c',
})) defineMaterial(name, { day, jitter: .006 });

function walnut(x, y, z) {
  const course = y * .73 + .8 * Math.sin(x * .031) + .42 * Math.sin(x * .047 + y * .11) + z * .23;
  return .022 * Math.sin(course) + .009 * Math.sin(course * 4.2);
}
const finish = (chamfer, specular = 0) => ({ chamfer, specular });
export const cases = {
  walnut: { name: 'Walnut', plate: '#b98c65', ground: '#efece3', mat: '#355347', grain: walnut, face: finish(35, 12) },
  alloy: { name: 'Anodized', plate: '#445964', ground: '#e3e8e7', mat: '#253e4e', face: finish(140, 122) },
  smoke: { name: 'Smoke', plate: '#49505c', ground: '#dddde4', mat: '#433e53', transmission: .23, face: finish(195, 138) },
  frost: { name: 'Frost', plate: '#ece9dd', ground: '#e5e9e5', mat: '#4c6560', transmission: .36, face: finish(100, 44) },
  clear: { name: 'Clear', plate: '#c4e4df', ground: '#dfe8e7', mat: '#365b62', transmission: .56, face: finish(220, 145) },
};
export const caps = {
  field: { name: 'Ridgeline PBT', key: '#e9dfc5', legend: '#352c23', face: finish(48, 16) },
  linen: { name: 'Parchment', key: '#eee4cd', legend: '#352c23', face: finish(48, 16) },
  carbon: { name: 'Carbon PBT', key: '#393f3f', legend: '#f7ead4', face: finish(66, 14) },
  opal: { name: 'Opal', key: '#c8dfdf', legend: '#152c32', transmission: .24, face: finish(130, 90) },
};
export const lamps = {
  amber: { name: 'Amber', hue: '#ffb45f' }, tide: { name: 'Tide', hue: '#71e2cd' },
  lilac: { name: 'Lilac', hue: '#d5b0ff' }, ember: { name: 'Ember', hue: '#ff9479' },
};
const paint = (day, rest = {}) => ({ day, night: day, ...rest });
export const defaults = { shell: 'walnut', caps: 'field', profile: 'high', lamp: 'amber', level: 7 };
export function settings(value = {}) {
  const has = (items, key) => Object.hasOwn(items, key);
  return { shell: has(cases, value?.shell) ? value.shell : defaults.shell,
    caps: has(caps, value?.caps) ? value.caps : defaults.caps,
    profile: value?.profile === 'low' ? 'low' : 'high',
    lamp: has(lamps, value?.lamp) ? value.lamp : defaults.lamp,
    level: Number.isFinite(value?.level) ? Math.max(0, Math.min(10, Math.round(value.level))) : defaults.level };
}

export function instrument(s, root, stage) {
  const shell = cases[s.shell], cap = caps[s.caps], light = lamps[s.lamp].hue;
  const ink = ['smoke','alloy'].includes(s.shell) ? '#fbf5e9' : '#262b25';
  const quiet = ['smoke','alloy'].includes(s.shell) ? '#e0e7e5' : '#3e4037';
  const panel = { walnut: '#e3d8be', alloy: '#40545c', smoke: '#363b49', clear: '#d2e4dc', frost: '#e3e7dd' }[s.shell];
  const vars = { '--vx-look': 'instrument', '--mat': shell.mat, '--vx-ground': shell.ground,
    '--vx-key': cap.key, '--lit-legend': cap.legend, '--vx-chalk': shell.plate, '--vx-ink': ink,
    '--vx-ink-quiet': quiet, '--vx-floor': ['alloy','smoke'].includes(s.shell) ? '#313b40' : '#d4cbb5',
    '--vx-steel': '#a79d88', '--vx-knob': '#d8c5a1', '--vx-enamel': 'var(--lit-cap-day,#aa4a27)',
    '--panel': panel, '--case-lamp': light, '--vx-signal': 'var(--lit-accent)', '--vx-focus': '#b95329', '--lamp-level': s.level / 10,
    '--vx-link': ink, '--vx-on-enamel': '#fff8e8' };
  const shape = [s.shell, s.caps, s.profile].join('/');
  const retool = LOOKS.instrument?.tooling !== shape;
  let look = LOOKS.instrument;
  if (retool) {
    look = defineLook('instrument', { from: 'lit', tooling: shape, artwork: s.caps === 'field', rise: s.profile === 'high' ? 7 : 3,
      travel: s.profile === 'high' ? 4 : 2, grain: 1, seam: .45,
      finishes: { ...LOOKS.lit.finishes, chalk: shell.face, key: cap.face, 'warm-metal': finish(65, 105) },
      materials: { panel: paint(panel), chalk: paint(shell.plate, { grain: shell.grain, transmission: shell.transmission, jitter: .004 }),
        key: paint(cap.key, { transmission: cap.transmission, jitter: .009 }), ink: paint(ink),
        steel: paint('#9d998a'), gasket: paint('#232824'), slate: paint('#515754'),
        floor: paint(vars['--vx-floor']), ivory: paint('#dcd5c1'), enamel: root.dataset.vxTheme ? LOOKS.lit.materials.enamel : paint('#aa4a27'),
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
  vars['--vx-key'] = look.materials.key.day;
  for (const [key, value] of Object.entries(vars)) root.style.setProperty(key, value);
  root.dataset.shell = s.shell;
  root.dataset.caps = s.caps;
  root.dataset.profile = s.profile;
  if (stage) for (const l of stage.lives.values()) {
    if (retool) l.retint();
    else if (l.look === look && recolor) l.recolor();
  }
}
