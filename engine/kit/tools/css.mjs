// The kit's one stylesheet is put together from its parts' own files.
//   node tools/css.mjs           writes voxelmorphism.css
//   node tools/css.mjs --check   exit 1 if that file is not what the parts would make
// css/_kit.css comes first (the tokens, the first parts, the lit look); every other file in css/
// follows in the order of their names. Edit those files, never the one they make.
import { readFile, readdir, writeFile } from 'node:fs/promises';

const dir = new URL('../css/', import.meta.url);
const out = new URL('../voxelmorphism.css', import.meta.url);
const names = (await readdir(dir)).filter((n) => n.endsWith('.css') && n !== '_kit.css').sort();
let css = `/* Made by tools/css.mjs from css/_kit.css and the ${names.length} files beside it. Do not edit: edit those, and run it again. */\n\n`;
css += (await readFile(new URL('_kit.css', dir), 'utf8')).trimEnd() + '\n';
for (const n of names) css += `\n/* ==== css/${n} ==== */\n\n` + (await readFile(new URL(n, dir), 'utf8')).trimEnd() + '\n';
if (process.argv.includes('--check')) {
  const have = await readFile(out, 'utf8').catch(() => '');
  if (have !== css) { console.log('FAIL voxelmorphism.css is not what css/ makes: run node tools/css.mjs'); process.exit(1); }
  console.log(`ok   voxelmorphism.css is what css/ makes (${names.length + 1} files, ${css.length} bytes)`);
} else {
  await writeFile(out, css);
  console.log(`voxelmorphism.css: ${names.length + 1} files, ${css.length} bytes`);
}
