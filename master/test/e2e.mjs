// End to end on one machine with real WebRTC: the release master on 127.0.0.1:5990,
// a host built from the probe's lib/rtc-load.mjs (node-datachannel) holding the
// master's WebSocket, and a page in Playwright Chromium that lists the lobbies,
// joins one and opens its channels. Then the same through a private lobby's code.
//
// Usage (from the repo root, after `npm ci` in probes/lobby-transport):
//   node master/test/e2e.mjs [joins=5]
// E2E_STUN=1 also has the master answer STUN on udp 5992 and hand itself out in
// /ice, and checks a STUN binding with the probe's lib/stun.mjs (what stun-check.mjs runs).
// Ports: 5990 master (tcp), 5991 the page (tcp), 5992 the master's STUN (udp),
// 5993-5999 the host's ICE (udp).
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const master = join(here, '..');
const probe = join(master, '..', 'probes', 'lobby-transport');
const need = createRequire(join(probe, 'package.json'));
const { RTCPeerConnection } = await import(pathToFileURL(need.resolve('node-datachannel/polyfill')).href);
const pw = await import(pathToFileURL(need.resolve('playwright')).href);
const { chromium } = pw.chromium ? pw : pw.default;
const L = await import(pathToFileURL(join(probe, 'lib', 'rtc-load.mjs')).href);
const S = await import(pathToFileURL(join(probe, 'lib', 'stun.mjs')).href);
const STUN = !!process.env.E2E_STUN;

const JOINS = Number(process.argv[2] ?? 5);
const MS = 'http://127.0.0.1:5990';
const log = (...a) => console.log(...a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- the master ----
const built = spawnSync('cargo', ['build', '--release', '--quiet'], { cwd: master, stdio: 'inherit' });
if (built.status !== 0) process.exit(1);
const mp = spawn(join(master, 'target', 'release', 'village-master'), ['--listen', '127.0.0.1:5990', ...(STUN ? ['--stun-port', '5992', '--stun', 'stun:127.0.0.1:5992'] : [])], { stdio: ['ignore', 'inherit', 'pipe'] });
process.on('exit', () => mp.kill('SIGINT'));
mp.stderr.on('data', (d) => process.stderr.write(`  master: ${d}`));
for (let i = 0; ; i++) {
  try { await fetch(MS); break; } catch { if (i > 50) throw new Error('master did not start'); await sleep(100); }
}
const { iceServers } = await (await fetch(`${MS}/ice`)).json();
log('ice', iceServers);
if (STUN) {
  const dgram = await import('node:dgram');
  const sock = dgram.createSocket('udp4');
  await new Promise((r) => sock.bind(0, '127.0.0.1', r));
  const b = await S.binding(sock, '127.0.0.1', 5992);
  const right = b.address === '127.0.0.1' && b.port === sock.address().port;
  log('stun binding from the master', { mapped: `${b.address}:${b.port}`, local: sock.address().port, right });
  sock.close();
  if (!right) { log('FAIL: STUN'); process.exit(1); }
}

// ---- a host: one socket per lobby ----
const hostSide = [];
function host(name, listed) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${MS.replace('http', 'ws')}/host`);
    let players = 0;
    ws.onopen = () => ws.send(JSON.stringify({ hello: { proto: 1, name, about: 'an end-to-end test', pin: 'town', most: 8, locked: false, listed } }));
    ws.onerror = (e) => reject(e);
    ws.onclose = (e) => log('host socket closed', { name, code: e.code, reason: e.reason });
    ws.onmessage = async (e) => {
      const m = JSON.parse(e.data);
      if (m.welcome) return resolve({ ws, ...m.welcome });
      if (m.offer) {
        const h = await L.hostAnswer(RTCPeerConnection, { type: 'offer', sdp: m.offer.sdp }, { iceServers, portRangeBegin: 5993, portRangeEnd: 5999 });
        ws.send(JSON.stringify({ answer: { n: m.offer.n, sdp: h.answer.sdp } }));
        hostSide.push({ answerMs: h.answerMs, gather: h.gather.how, offer: L.candidateTypes(m.offer.sdp), answer: L.candidateTypes(h.answer.sdp) });
        h.ready.then(() => ws.send(JSON.stringify({ now: { players: ++players } })));
      }
    };
  });
}
const open = await host('Test Meadow', true);
const hidden = await host('Hidden Glade', false);
log('lobbies up', { listed: open.id, unlisted: hidden.id });

// ---- the page, on its own origin (so every master request is cross-origin) ----
const page = `<!doctype html><meta charset="utf-8"><title>e2e</title><div id="list"></div>
<script type="module">
import { clientOffer, clientConnect, selectedPair } from '/rtc-load.mjs';
const MS = ${JSON.stringify(MS)};
const now = () => performance.now();
const { iceServers } = await (await fetch(MS + '/ice')).json();
const code = new URLSearchParams(location.hash.slice(1)).get('code');
const lobbies = code ? [await (await fetch(MS + '/lobbies/' + code)).json()] : (await (await fetch(MS + '/lobbies')).json()).lobbies;
window.listed = lobbies.map((l) => l.name);
for (const l of lobbies) {
  const b = document.createElement('button');
  b.textContent = l.name;
  b.onclick = async () => {
    const t0 = now();
    const c = await clientOffer(RTCPeerConnection, { iceServers });
    const tOffer = now();
    const r = await fetch(MS + '/lobbies/' + (code ?? l.id) + '/join', { method: 'POST', body: JSON.stringify({ sdp: c.offer.sdp }) });
    const tAnswer = now();
    if (!r.ok) { window.result = { status: r.status, body: await r.json() }; return; }
    const { sdp } = await r.json();
    const conn = await clientConnect(c, { type: 'answer', sdp }, 10000);
    const clickToOpenMs = Math.round(now() - t0);
    const rep = await new Promise((res) => { c.ch.ctl.onmessage = (e) => res(JSON.parse(e.data)); c.ch.ctl.send(JSON.stringify({ t: 'req', id: 1, body: 'hi' })); });
    window.result = { clickToOpenMs, gatherMs: Math.round(tOffer - t0), gather: c.gatherComplete, offer: c.offerCandidates,
      joinMs: Math.round(tAnswer - tOffer), openMs: conn.openMs, open: conn.open, pair: conn.pair, reply: rep.t };
    c.pc.close();
  };
  document.getElementById('list').append(b);
}
window.ready = true;
</script>`;
const files = { '/': ['text/html', page], '/rtc-load.mjs': ['text/javascript', readFileSync(join(probe, 'lib', 'rtc-load.mjs'))] };
const web = createServer((req, res) => {
  const f = files[new URL(req.url, 'http://x').pathname];
  res.writeHead(f ? 200 : 404, { 'content-type': f?.[0] ?? 'text/plain' });
  res.end(f?.[1] ?? 'not found');
}).listen(5991, '127.0.0.1');

// No STUN server here (the master hands out none without --stun): the page's
// only candidate is an mDNS host name, and the host's answer still reaches it.
const browser = await chromium.launch();
const ctx = await browser.newContext();
const pg = await ctx.newPage();
pg.on('console', (m) => { if (m.type() === 'error') log('console', m.text()); });
pg.on('pageerror', (e) => log('pageerror', e.message));

async function joinOnce(url, name) {
  await pg.goto('about:blank');
  await pg.goto(url);
  await pg.waitForFunction(() => window.ready, null, { timeout: 10000 });
  const listed = await pg.evaluate(() => window.listed);
  await pg.getByRole('button', { name }).click();
  await pg.waitForFunction(() => window.result, null, { timeout: 20000 });
  return { listed, ...(await pg.evaluate(() => window.result)) };
}

const runs = [];
let ok = true;
for (let i = 0; i < JOINS; i++) {
  const r = await joinOnce('http://127.0.0.1:5991/', 'Test Meadow');
  if (i === 0) log('listed on the page', r.listed);
  if (r.listed.includes('Hidden Glade')) { ok = false; log('FAIL: the unlisted lobby was listed'); }
  log(`join ${i + 1}`, r);
  if (!r.open || r.reply !== 'rep') ok = false;
  runs.push(r);
}
const priv = await joinOnce(`http://127.0.0.1:5991/#code=${hidden.code}`, 'Hidden Glade');
log('join by code', priv);
if (!priv.open) ok = false;
log('host side', hostSide);

const ms = runs.map((r) => r.clickToOpenMs).sort((a, b) => a - b);
const summary = { joins: runs.length, clickToOpenMs: ms, p50: ms[Math.floor(ms.length / 2)], max: ms.at(-1), joinRelayMs: runs.map((r) => r.joinMs), byCode: priv.clickToOpenMs };
log('summary', summary);
const players = (await (await fetch(`${MS}/lobbies/${open.id}`)).json()).players;
log('players reported by the host through now', players);

await browser.close();
web.close();
open.ws.close(); hidden.ws.close();
await sleep(100);
mp.kill('SIGINT');
log(ok ? 'PASS' : 'FAIL');
process.exit(ok ? 0 : 1);
