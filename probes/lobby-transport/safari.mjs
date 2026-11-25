// Open the probe page in this Mac's real Safari, wait for its result, close the tab.
// Usage: node safari.mjs <page-url> <result-name> [wait-seconds]
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';

const withName = (u, n) => { const x = new URL(u); x.searchParams.set('name', n); return x.href; };
const [url, name, wait = '240'] = process.argv.slice(2);
const file = new URL(`./results/${name}.json`, import.meta.url).pathname;
rmSync(file, { force: true });
const full = withName(url, name);
const version = execFileSync('defaults', ['read', '/Applications/Safari.app/Contents/Info', 'CFBundleShortVersionString'], { encoding: 'utf8' }).trim();
execFileSync('open', ['-a', 'Safari', full]);
const t0 = Date.now();
while (!existsSync(file) && Date.now() - t0 < Number(wait) * 1000) await new Promise((r) => setTimeout(r, 500));
const origin = new URL(url).origin;
try { execFileSync('osascript', ['-e', `tell application "Safari" to close (every tab of every window whose URL starts with "${origin}")`], { timeout: 10000 }); } catch { console.log('(tab left open: AppleScript could not close it)'); }
console.log(JSON.stringify({ browser: 'Safari', version, ms: Date.now() - t0 }));
console.log(existsSync(file) ? readFileSync(file, 'utf8') : 'no result');
