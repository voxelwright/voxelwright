// Reference pictures for a review: other kits' own public demo pages, shot the same way as ours,
// so reviewers score the kit beside something and not alone (see HILL.md, section 3).
//   node tools/refs.mjs        writes shots/refs/*.png
// It only reads public pages; nothing of ours is sent anywhere.
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const REFS = [
  ['shadcn', 'https://ui.shadcn.com/'],                       // the clean default most kits are measured against
  ['nes', 'https://nostalgic-css.github.io/NES.css/'],        // a pixel-styled kit
  ['98', 'https://jdan.github.io/98.css/'],                   // bevelled, painted depth
  ['bootstrap', 'https://getbootstrap.com/docs/5.3/examples/cheatsheet/'], // the broad set
];
await mkdir('shots/refs', { recursive: true });
const browser = await chromium.launch();
for (const [name, url] of REFS) {
  for (const dark of [false, true]) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2, colorScheme: dark ? 'dark' : 'light', userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36' });
    const p = await ctx.newPage();
    try {
      await p.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
      await p.waitForTimeout(1200);
      for (let i = 0; i < 2; i++) {
        await p.evaluate((y) => scrollTo(0, y), i * 820);
        await p.waitForTimeout(500);
        await p.screenshot({ path: `shots/refs/${name}-${dark ? 'night' : 'day'}-${i}.png` });
      }
      console.log(`ok   ${name} ${dark ? 'night' : 'day'}`);
    } catch (e) { console.log(`fail ${name} ${dark ? 'night' : 'day'}: ${String(e).slice(0, 120)}`); }
    await ctx.close();
  }
}
await browser.close();
