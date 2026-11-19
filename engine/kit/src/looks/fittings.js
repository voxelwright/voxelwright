// The fittings of an instrument as plain data: enclosures, cap sets and lamps, and the page
// tokens each one sets. No DOM and no renderer, so tools/fittings-css.mjs can write the same
// tokens into css/fittings.css: a page that names its fittings in HTML
// (<html data-shell="walnut" data-caps="field">) is fitted before any script runs, and stays
// fitted where no script runs. src/looks/instrument.js builds the voxel materials from this too.

function walnut(x, y, z) {
  const course = y * .73 + .8 * Math.sin(x * .031) + .42 * Math.sin(x * .047 + y * .11) + z * .23;
  return .022 * Math.sin(course) + .009 * Math.sin(course * 4.2);
}
export const finish = (chamfer, specular = 0) => ({ chamfer, specular });

// panel: the reading plate's colour. dark: the panel is dark, so words on it are light.
// night: the same instrument with the room's lights down (the system's dark setting, or
// data-theme="dark"): the ground and the plate go dark, the case and the caps keep their colour,
// and what is backlit shines.
export const cases = {
  walnut: { name: 'Walnut', treble: -3, plate: '#b98c65', ground: '#efece3', mat: '#355347', panel: '#e3d8be', grain: walnut, face: finish(35, 12),
    night: { ground: '#151a17', mat: '#16231d', panel: '#262b26' } },
  alloy: { name: 'Anodized', treble: 2, plate: '#445964', ground: '#26323a', mat: '#253e4e', panel: '#40545c', dark: true, face: finish(140, 122),
    night: { ground: '#10171b', mat: '#0f1a21', panel: '#24323a' } },
  smoke: { name: 'Smoke', treble: -1.5, plate: '#49505c', ground: '#25242d', mat: '#433e53', panel: '#363b49', dark: true, transmission: .23, face: finish(195, 138),
    night: { ground: '#131218', mat: '#1c1a24', panel: '#272a34' } },
  frost: { name: 'Frost', treble: -1, plate: '#ece9dd', ground: '#e5e9e5', mat: '#4c6560', panel: '#e3e7dd', transmission: .36, face: finish(100, 44),
    night: { ground: '#131918', mat: '#1d2a28', panel: '#283130' } },
  clear: { name: 'Clear', treble: 0, plate: '#c4e4df', ground: '#dfe8e7', mat: '#365b62', panel: '#d2e4dc', transmission: .56, face: finish(220, 145),
    night: { ground: '#10191b', mat: '#172629', panel: '#253234' } },
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

/** The page tokens an enclosure sets (colours of the page, its words and its plate), by day or at night. */
export function shellTokens(name, night = false) {
  const shell = cases[name];
  if (night) {
    const n = shell.night;
    return {
      '--vx-look': 'instrument', '--vx-theme': 'night', '--mat': n.mat, '--vx-ground': n.ground, '--vx-chalk': shell.plate,
      '--vx-ink': '#ece6d6', '--vx-ink-quiet': '#c9c3b2', '--vx-floor': '#0e110f', '--panel': n.panel,
      '--vx-slate': '#3a403b', '--vx-steel': '#5d5b52', '--vx-knob': '#d8c5a1', '--vx-enamel': 'var(--lit-cap-night,#b9562f)',
      '--vx-signal': 'var(--lit-accent)', '--vx-focus': '#ffb58f', '--vx-shadow': 'rgb(0 0 0 / 0.55)',
      '--vx-danger-text': '#ffc2b5', '--vx-link': 'var(--lit-link-night,#9db8ff)', '--vx-on-enamel': '#fff8e8',
      // the lit look's night lights, which a fitted page does not take from the lit look itself
      '--lit-accent': 'var(--lit-accent-night,#458fe3)', '--lit-warm': '#c9a264', '--lit-go': '#5fe894',
      '--lit-stop': '#ff7a66', '--lit-night': '1',
    };
  }
  const ink = shell.dark ? '#fbf5e9' : '#262b25';
  return {
    '--vx-look': 'instrument', '--vx-theme': 'day', '--mat': shell.mat, '--vx-ground': shell.ground, '--vx-chalk': shell.plate,
    '--vx-ink': ink, '--vx-ink-quiet': shell.dark ? '#e0e7e5' : '#3e4037',
    '--vx-floor': shell.dark ? '#313b40' : '#d4cbb5', '--panel': shell.panel,
    '--vx-steel': '#a79d88', '--vx-knob': '#d8c5a1', '--vx-enamel': 'var(--lit-cap-day,#aa4a27)',
    '--vx-signal': 'var(--lit-accent)', '--vx-focus': shell.dark ? '#ffb58f' : '#b95329',
    '--vx-danger-text': shell.dark ? '#ffd4c9' : '#85261c', '--vx-link': shell.dark ? 'var(--lit-link-night,#9db8ff)' : 'var(--lit-link-day,#1f40c4)', '--vx-on-enamel': '#fff8e8',
  };
}

/** The tokens a cap set sets (the colour of a key and of what is written on it). */
export function capTokens(name) {
  const cap = caps[name];
  return { '--vx-key': cap.key, '--vx-lamp-resin': cap.key, '--lit-legend': cap.legend, '--vx-danger-legend': name === 'carbon' ? '#ffd4c9' : '#85261c' };
}
