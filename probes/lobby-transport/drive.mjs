// Open the probe page in Playwright's Chromium (or the installed Chrome with
// --chrome), wait until it reports, print its result.
// Usage: node drive.mjs <page-url> <result-name> [--headed] [--chrome] [--public-origin]
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const withName = (u, n) => { const x = new URL(u); x.searchParams.set('name', n); return x.href; };
const [url, name] = process.argv.slice(2);
const flag = (f) => process.argv.includes(f);
const args = [];
// The tailnet origin resolves into 100.64/10, which Chromium may count as a
// local address; zahynailo.dev is public. This makes the page's origin public.
if (flag('--public-origin')) {
  const u = new URL(url);
  const ip = process.env.ORIGIN_IP;
  args.push(`--ip-address-space-overrides=${ip}:${u.port || 443}=public`);
}
const browser = await chromium.launch({ headless: !flag('--headed'), channel: flag('--chrome') ? 'chrome' : undefined, args });
const ctx = await browser.newContext();
if (flag('--grant')) await ctx.grantPermissions((process.env.GRANT ?? 'local-network-access').split(','), { origin: new URL(url).origin });
const page = await ctx.newPage();
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log('console', m.type(), m.text().slice(0, 300)); });
const t0 = Date.now();
await page.goto(withName(url, name));
await page.waitForFunction(() => document.title === 'done', null, { timeout: Number(process.env.WAIT_MS ?? 240000) }).catch((e) => console.log('wait', e.message.split('\n')[0]));

console.log(JSON.stringify({ browser: flag('--chrome') ? 'chrome' : 'chromium', version: browser.version(), headless: !flag('--headed'), args, ms: Date.now() - t0 }));
try { console.log(readFileSync(new URL(`./results/${name}.json`, import.meta.url), 'utf8')); } catch { console.log('no result file'); }
await browser.close();
