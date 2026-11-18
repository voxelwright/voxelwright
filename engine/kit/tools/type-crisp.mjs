// Photograph one block of DOM text per face and size at 1x, for tools/type-crisp.py to score.
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
const port = process.env.PORT || 5987;
const sizes = (process.argv[2] || '14,16,17,20,22').split(',').map(Number);
await mkdir('shots/type/probe', { recursive: true });
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 900, height: 400 }, deviceScaleFactor: 1 })).newPage();
await page.goto(`http://127.0.0.1:${port}/kit/showcase/type.html?faces=none&lettering=none`);
await page.waitForFunction(() => window.vx, null, { timeout: 9000 });
const faces = await page.evaluate(async () => {
  const ok = [];
  for (const f of window.vx.FACES) { const got = await document.fonts.load(`400 16px "${f.font}"`); if (got.length) ok.push({ id: f.id, font: f.font }); }
  document.body.innerHTML = '<p id="probe" style="position:absolute;left:0;top:0;margin:0;padding:8px;width:700px;background:#fff;color:#000;line-height:1.5">Every watering becomes part of the brief. Hamburgefonstiv quartz, judge my vow: 0123456789.</p>';
  document.documentElement.style.background = '#fff';
  return ok;
});
for (const f of faces) for (const s of sizes) {
  await page.evaluate(([font, size]) => { const p = document.querySelector('#probe'); p.style.fontFamily = `"${font}"`; p.style.fontSize = size + 'px'; }, [f.font, s]);
  await page.locator('#probe').screenshot({ path: `shots/type/probe/${f.id}-${s}.png` });
}
await browser.close();
console.log(faces.map((f) => f.id).join(' '));
