// Memory and relay time under load, on one machine: the release master on
// 127.0.0.1:5990, 1,000 host sockets (one lobby each, answering every offer at
// once with a fixed SDP), then 100 joins a second for 30 s. Per-address limits
// are raised by flag, since every socket here comes from 127.0.0.1.
//
// Usage: node master/test/load.mjs [lobbies=1000] [joinsPerSecond=100] [seconds=30]
// The relay time is the page's whole POST /lobbies/<id>/join on loopback: the
// request, the offer to the host over its WebSocket, the host's answer, and the
// reply, with Node on both ends.
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cpus, arch, platform, release } from 'node:os';

const master = join(dirname(fileURLToPath(import.meta.url)), '..');
const [LOBBIES = 1000, RATE = 100, SECONDS = 30] = process.argv.slice(2).map(Number);
const MS = 'http://127.0.0.1:5990';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(...a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))));

if (spawnSync('cargo', ['build', '--release', '--quiet'], { cwd: master, stdio: 'inherit' }).status !== 0) process.exit(1);
const bin = join(master, 'target', 'release', 'village-master');
const mp = spawn(bin, [
  '--listen', '127.0.0.1:5990',
  '--max-lobbies-per-addr', String(LOBBIES + 10), '--registrations-per-minute', '1000000',
  '--joins-per-minute', '1000000', '--lookups-per-minute', '1000000',
  '--max-connections-per-addr', '100000', '--max-connections', '100000',
], { stdio: ['ignore', 'ignore', 'ignore'] });
process.on('exit', () => mp.kill('SIGINT'));
const rssKb = () => Number(execFileSync('ps', ['-o', 'rss=', '-p', String(mp.pid)]).toString().trim());
for (let i = 0; ; i++) { try { await fetch(MS); break; } catch { if (i > 50) throw new Error('no master'); await sleep(100); } }
await sleep(500);
const out = { machine: `${platform()} ${release()} ${arch()}, ${cpus()[0].model}, ${cpus().length} cores`, binaryBytes: Number(execFileSync('stat', platform() === 'darwin' ? ['-f', '%z', bin] : ['-c', '%s', bin]).toString()), idleRssKb: rssKb() };
log('idle', out);

// A realistic answer: Chromium-shaped, ~1 KB.
const SDP = ['v=0', 'o=- 4611731400430051336 2 IN IP4 127.0.0.1', 's=-', 't=0 0', 'a=group:BUNDLE 0', 'a=msid-semantic: WMS',
  'm=application 9 UDP/DTLS/SCTP webrtc-datachannel', 'c=IN IP4 0.0.0.0', 'a=candidate:1 1 udp 2122260223 192.0.2.10 54321 typ host generation 0',
  'a=ice-ufrag:abcd', 'a=ice-pwd:abcdefghijklmnopqrstuvwx', 'a=ice-options:trickle',
  'a=fingerprint:sha-256 ' + Array.from({ length: 32 }, () => 'AB').join(':'), 'a=setup:actpass', 'a=mid:0', 'a=sctp-port:5000', 'a=max-message-size:262144', ''].join('\r\n');

const ids = [];
let answered = 0;
await Promise.all(Array.from({ length: LOBBIES }, (_, i) => new Promise((resolve, reject) => {
  const ws = new WebSocket(`ws://127.0.0.1:5990/host`);
  ws.onopen = () => ws.send(JSON.stringify({ hello: { proto: 1, name: `Load Lobby ${i}`, about: 'a load test', pin: 'town', most: 8, listed: true } }));
  ws.onerror = reject;
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.welcome) { ids.push(m.welcome.id); setInterval(() => ws.send(JSON.stringify({ now: { players: 1 } })), 20000); resolve(); }
    if (m.offer) { answered++; ws.send(JSON.stringify({ answer: { n: m.offer.n, sdp: SDP } })); }
  };
})));
await sleep(1000);
out.lobbies = ids.length;
out.lobbiesRssKb = rssKb();
const t = performance.now();
const list = await (await fetch(`${MS}/lobbies`)).text();
out.listBytes = list.length; // one page (200)
out.listMs = Math.round(performance.now() - t);
log('lobbies up', { lobbies: out.lobbies, rssKb: out.lobbiesRssKb, listBytes: out.listBytes, listMs: out.listMs });

const times = [];
const fails = {};
let peak = out.lobbiesRssKb;
const sampler = setInterval(() => { peak = Math.max(peak, rssKb()); }, 500);
const total = RATE * SECONDS;
const t0 = performance.now();
const inflight = [];
for (let i = 0; i < total; i++) {
  const due = t0 + (i * 1000) / RATE;
  const wait = due - performance.now();
  if (wait > 0) await sleep(wait);
  const id = ids[i % ids.length];
  inflight.push((async () => {
    const s = performance.now();
    const r = await fetch(`${MS}/lobbies/${id}/join`, { method: 'POST', body: JSON.stringify({ sdp: SDP }) });
    await r.text();
    if (r.ok) times.push(performance.now() - s); else fails[r.status] = (fails[r.status] ?? 0) + 1;
  })().catch((e) => { fails[e.code ?? e.name] = (fails[e.code ?? e.name] ?? 0) + 1; }));
}
await Promise.all(inflight);
const elapsed = (performance.now() - t0) / 1000;
clearInterval(sampler);
out.joins = { asked: total, answered: times.length, failed: fails, perSecond: Math.round(times.length / elapsed) };
times.sort((a, b) => a - b);
const q = (p) => Math.round(times[Math.min(times.length - 1, Math.floor(p * times.length))] * 100) / 100;
out.relayMs = { p50: q(0.5), p99: q(0.99), max: q(1) };
out.peakRssKb = peak;
await sleep(1000);
out.afterRssKb = rssKb();
log('result', out);
process.exit(0);
