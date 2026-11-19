// css/fittings.css is written from src/looks/fittings.js, so the stylesheet and the voxels can
// never disagree about an enclosure's colours.
//   node tools/fittings-css.mjs           writes css/fittings.css (then run node tools/css.mjs)
//   node tools/fittings-css.mjs --check   exit 1 if that file is not what fittings.js makes
import { readFile, writeFile } from 'node:fs/promises';
import { cases, caps, shellTokens, capTokens } from '../src/looks/fittings.js';

const out = new URL('../css/fittings.css', import.meta.url);
const block = (selector, tokens) => `${selector} {\n${Object.entries(tokens).map(([k, v]) => `  ${k}: ${v};`).join('\n')}\n}\n`;
let css = `/* ---------- Fittings ----------
   Made by tools/fittings-css.mjs from src/looks/fittings.js. Do not edit: edit that, and run it again.
   An instrument named in the page's HTML is fitted before any script runs, and where none runs:
     <html data-vx-look="lit" data-shell="walnut" data-caps="field" data-profile="high">
   At night (the system's dark setting, or data-theme="dark") the same enclosure has its lights
   down; data-theme="light" keeps it by day. The first adopt() reads these attributes and gives
   the voxels the same materials (fitInstrument() called earlier wins). */

`;
for (const name of Object.keys(cases)) css += block(`:root[data-shell="${name}"]`, shellTokens(name));
css += '\n/* at night */\n';
for (const name of Object.keys(cases)) css += block(`:root[data-theme="dark"][data-shell="${name}"]`, shellTokens(name, true));
css += '@media (prefers-color-scheme: dark) {\n';
for (const name of Object.keys(cases)) css += block(`:root:not([data-theme="light"])[data-shell="${name}"]`, shellTokens(name, true)).replace(/^/gm, '  ').replace(/ +$/gm, '');
css += '}\n\n';
for (const name of Object.keys(caps)) css += block(`:root[data-caps="${name}"]`, capTokens(name));
css = css.replace(/\n+$/, '\n');
if (process.argv.includes('--check')) {
  const have = await readFile(out, 'utf8').catch(() => '');
  if (have !== css) { console.log('FAIL css/fittings.css is not what fittings.js makes: run node tools/fittings-css.mjs'); process.exit(1); }
  console.log('ok   css/fittings.css is what fittings.js makes');
} else {
  await writeFile(out, css);
  console.log(`css/fittings.css: ${Object.keys(cases).length} enclosures, ${Object.keys(caps).length} cap sets`);
}
