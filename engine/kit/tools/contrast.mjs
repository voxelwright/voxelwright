// Contrast of every text and surface pair the kit uses, read from voxelmorphism.css. Body text
// needs 7:1, quiet text and labels on controls 4.5:1. Exit 1 if any pair falls short.
import { readFileSync } from 'node:fs';
const css = readFileSync(new URL('../packages/voxelmorphism/voxelmorphism.css', import.meta.url), 'utf8');
const block = (re) => Object.fromEntries([...css.match(re)[1].matchAll(/(--vx-[\w-]+):\s*(#[0-9a-f]{6})/gi)].map((m) => [m[1], m[2]]));
const day = block(/:root \{([\s\S]*?)\n\}/);
const night = { ...day, ...block(/:root\[data-theme="dark"\] \{([\s\S]*?)\n\}/) };
const lum = (h) => { const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const pairs = [
  ['body text on the page', '--vx-ink', '--vx-ground', 7], ['body text on chalk', '--vx-ink', '--vx-chalk', 7],
  ['quiet text on the page', '--vx-ink-quiet', '--vx-ground', 4.5], ['quiet text on chalk', '--vx-ink-quiet', '--vx-chalk', 4.5],
  ['label on enamel', '--vx-on-enamel', '--vx-enamel', 4.5], ['label on brick', '--vx-on-brick', '--vx-brick', 4.5],
  ['label on signal', '--vx-on-signal', '--vx-signal', 4.5], ['tab label on slate', '--vx-ink', '--vx-slate', 4.5],
  ['link on the page', '--vx-link', '--vx-ground', 4.5], ['danger item on chalk', '--vx-danger-text', '--vx-chalk', 4.5],
  ['focus ring on the page', '--vx-focus', '--vx-ground', 3],
];
let bad = 0;
for (const [name, t] of [['day', day], ['night', night]]) for (const [what, fg, bg, need] of pairs) {
  const r = ratio(t[fg], t[bg]);
  if (r < need) bad++;
  console.log(`${r < need ? 'FAIL' : 'ok  '} ${name.padEnd(5)} ${what.padEnd(24)} ${r.toFixed(2)}:1 (needs ${need}) ${t[fg]} on ${t[bg]}`);
}
process.exit(bad ? 1 : 0);
