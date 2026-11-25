// Test 2: cross a real NAT. One end runs on this Mac (behind a home NAT), the
// other on a GitHub Actions runner; neither can be reached from outside, so they
// meet in an issue's comments (lib/mailbox.mjs). In one run:
//   1. each end asks public STUN servers what its NAT is (two sockets on the runner)
//   2. raw UDP: is an unsolicited packet let in, and does a two-way punch work?
//   3. one WebTransport attempt from the runner to the Mac's public address
//   4. direction A: host on the Mac, client on the runner (whole offer, whole answer)
//   5. direction B: host on the runner, serving any client the Mac sends (Node,
//      Chromium, Safari through relay.mjs) until the Mac says bye
// Usage: node nat-peer.mjs runner|mac <run-id>
// Env: MAILBOX_REPO, MAILBOX_ISSUE, GITHUB_TOKEN (runner). Prints no address.
import dgram from 'node:dgram';
import { networkInterfaces } from 'node:os';
import { mkdirSync, writeFileSync } from 'node:fs';
import ndc from 'node-datachannel';
import { RTCPeerConnection } from 'node-datachannel/polyfill';
import { mailbox } from './lib/mailbox.mjs';
import { binding, STUN_SERVERS } from './lib/stun.mjs';
import * as L from './lib/rtc-load.mjs';

const [role, run] = process.argv.slice(2);
// PHASES (default all): nat,udp,wt,A,B. SCTP_BUF: libdatachannel's SCTP send and receive buffer, bytes.
const PHASES = new Set((process.env.PHASES || 'nat,udp,wt,A,B').split(','));
if (Number(process.env.SCTP_BUF)) ndc.setSctpSettings({ sendBufferSize: Number(process.env.SCTP_BUF), recvBufferSize: Number(process.env.SCTP_BUF) });
const mb = mailbox({ repo: process.env.MAILBOX_REPO ?? 'the private source repository', issue: Number(process.env.MAILBOX_ISSUE), me: role, run });
const UP_SECONDS = Number(process.env.UP_SECONDS ?? 60);
// libdatachannel 0.24 (libjuice) never finishes gathering when a STUN server is a
// hostname and the host has no IPv6 route: the AAAA entry stays pending. Pass IPv4 literals.
const { lookup } = await import('node:dns/promises');
const iceServers = await Promise.all(L.ICE.map(async ({ urls }) => {
  const [, host, port] = urls.match(/^stun:([^:]+):(\d+)$/);
  return { urls: `stun:${(await lookup(host, { family: 4 })).address}:${port}` };
}));
const PORTS = role === 'mac' ? { iceServers, portRangeBegin: 5983, portRangeEnd: 5987 } : { iceServers };
const out = { role, run, node: process.version };
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function udpSocket(port = 0) {
  const s = dgram.createSocket('udp4');
  await new Promise((r) => s.bind(port, r));
  const answers = [];
  for (const [h, p] of STUN_SERVERS) answers.push(await binding(s, h, p));
  const ok = answers.filter((a) => !a.error);
  const localIps = Object.values(networkInterfaces()).flat().map((i) => i.address);
  return {
    s,
    pub: ok[0] ? { ip: ok[0].address, port: ok[0].port } : null,
    shape: {
      localPort: s.address().port,
      natted: ok[0] ? !localIps.includes(ok[0].address) : null,
      portPreserved: ok.length ? ok.every((a) => a.port === s.address().port) : null,
      mapping: ok.length < 2 ? 'unknown' : new Set(ok.map((a) => `${a.address}:${a.port}`)).size === 1 ? 'endpoint-independent' : 'endpoint-dependent',
      mappedPorts: ok.map((a) => a.port),
    },
  };
}

function counter(sock) {
  const c = { n: 0 };
  sock.on('message', (m) => { if (m.toString().startsWith('lt-punch')) c.n++; });
  return c;
}
async function burst(sock, to, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) { sock.send('lt-punch', to.port, to.ip); await sleep(200); }
}
const until = (t) => sleep(Math.max(0, t - Date.now()));

// ---------- 1 + 2: NAT shape and raw UDP ----------
let wtHash = null, wtServer = null;
if (role === 'mac' && PHASES.has('wt')) {
  const { makeCert } = await import('./lib/cert.mjs');
  const { Http3Server } = await import('@fails-components/webtransport');
  const lan = Object.values(networkInterfaces()).flat().find((i) => i.family === 'IPv4' && !i.internal && /^(10\.|192\.168\.|172\.)/.test(i.address))?.address;
  const c = makeCert(new URL('.', import.meta.url).pathname, []);
  wtServer = new Http3Server({ port: 5981, host: lan, secret: crypto.randomUUID(), cert: c.cert, privKey: c.privKey });
  const sessions = wtServer.sessionStream('/probe');
  wtServer.startServer();
  await wtServer.ready;
  wtHash = c.hash;
  out.wtSessionsSeen = 0;
  (async () => { const r = sessions.getReader(); for (;;) { const { done } = await r.read(); if (done) break; out.wtSessionsSeen++; } })();
}

if (PHASES.has('nat')) {
const a = await udpSocket(role === 'mac' ? 5980 : 0);
const b = role === 'runner' ? await udpSocket(0) : null;
out.nat = { a: a.shape, b: b?.shape };
out.sctpBuf = process.env.SCTP_BUF ?? 'default';
log('nat', out.nat);
await mb.post('stun', 'nat', { a: a.pub, b: b?.pub, wt: wtHash ? { port: 5981, hash: wtHash } : null });
const peer = (await mb.wait('stun', { sid: 'nat', timeoutMs: 300000 })).data;

if (PHASES.has('udp')) {
let T;
if (role === 'mac') { T = Date.now() + 12000; await mb.post('go', 'udp', { T }); } else T = (await mb.wait('go', { sid: 'udp' })).data.T;
const ca = counter(a.s), cb = b ? counter(b.s) : null;
const udp = {};
// phase 1 [T, T+4): runner socket a -> Mac a; the Mac has never sent to the runner.
await until(T);
if (role === 'runner') await burst(a.s, peer.a, 4000); else await until(T + 4000);
udp.p1_recv = role === 'mac' ? ca.n : undefined;
// phase 2 [T+4, T+8): Mac a -> runner b; runner b has never sent to the Mac.
await until(T + 4000);
if (role === 'mac') await burst(a.s, peer.b, 4000); else await until(T + 8000);
if (role === 'runner') udp.p2_recv = cb.n;
// phase 3 [T+8, T+14): both a sockets send to each other (a punch).
await until(T + 8000);
const before = ca.n;
await burst(a.s, peer.a, 6000);
udp.p3_recv = ca.n - before;
out.udp = udp;
log('udp', udp);
}

// ---------- 3: WebTransport straight to the Mac's public address ----------
if (role === 'runner' && peer.wt) {
  const { WebTransport, quicheLoaded } = await import('@fails-components/webtransport');
  await quicheLoaded;
  const t0 = performance.now();
  try {
    const wt = new WebTransport(`https://${peer.a.ip}:${peer.wt.port}/probe`, { requireUnreliable: true, serverCertificateHashes: [{ algorithm: 'sha-256', value: new Uint8Array(peer.wt.hash) }] });
    wt.closed.catch(() => {});
    const r = await Promise.race([wt.ready.then(() => 'ready', (e) => `failed: ${String(e).replace(/\d+\.\d+\.\d+\.\d+/g, 'x.x.x.x')}`), sleep(10000).then(() => 'timeout')]);
    out.wtToMacPublic = { result: r, ms: Math.round(performance.now() - t0) };
    try { wt.close(); } catch { /* */ }
  } catch (e) { out.wtToMacPublic = { result: 'error', error: String(e).replace(/\d+\.\d+\.\d+\.\d+/g, 'x.x.x.x') }; }
  log('wt', out.wtToMacPublic);
}
await mb.post('sync', 'wt', {});
await mb.wait('sync', { sid: 'wt' });
if (role === 'mac') out.wtSessionsSeenFromRunner = out.wtSessionsSeen;
a.s.close(); b?.s.close();
}

// ---------- 4: direction A, host on the Mac ----------
if (!PHASES.has('A')) { /* skipped */ } else if (role === 'runner') {
  const c = await L.clientOffer(RTCPeerConnection, PORTS);
  const tPost = performance.now();
  await mb.post('offer', 'A', c.offer);
  const ans = await mb.wait('answer', { sid: 'A', everyMs: 1000 });
  const mailboxMs = Math.round(performance.now() - tPost);
  const conn = await L.clientConnect(c, ans.data);
  out.A = { gatherMs: c.gatherMs, offerCandidates: c.offerCandidates, mailboxMs, ...conn };
  log('A connect', out.A);
  if (conn.open) out.A.load = await L.clientRun(c, { upSeconds: UP_SECONDS, log: (k, v) => log('A', k, v) });
  c.pc.close();
  await mb.post('result', 'A', out.A);
} else {
  const off = await mb.wait('offer', { sid: 'A', everyMs: 1000 });
  const h = await L.hostAnswer(RTCPeerConnection, off.data, PORTS);
  await mb.post('answer', 'A', h.answer);
  out.A_host = { answerMs: h.answerMs, answerCandidates: L.candidateTypes(h.answer.sdp) };
  const opened = await Promise.race([h.ready.then(() => true), sleep(30000).then(() => false)]);
  out.A_host.open = opened;
  out.A_host.pair = opened ? await L.selectedPair(h.pc) : null;
  log('A host', out.A_host);
  out.A = (await mb.wait('result', { sid: 'A', timeoutMs: 400000 }))?.data;
  h.pc.close();
}

// ---------- 5: direction B, host on the runner ----------
if (!PHASES.has('B')) { /* skipped */ } else if (role === 'runner') {
  out.B = [];
  const end = Date.now() + Number(process.env.HOST_MINUTES ?? 12) * 60000;
  const bye = mb.wait('bye', { sid: 'B', timeoutMs: end - Date.now(), everyMs: 4000 });
  let stop = false;
  bye.then(() => { stop = true; });
  while (!stop && Date.now() < end) {
    const off = await Promise.race([mb.wait('offer', { sid: 'B', timeoutMs: 5000, everyMs: 1000 }), bye]);
    if (!off || off.kind !== 'offer') continue;
    const t0 = performance.now();
    const h = await L.hostAnswer(RTCPeerConnection, off.data, PORTS);
    await mb.post('answer', off.sid, h.answer);
    const rec = { sid: off.sid, answerMs: h.answerMs, answerCandidates: L.candidateTypes(h.answer.sdp) };
    out.B.push(rec);
    h.ready.then(async () => { rec.open = true; rec.openAfterAnswerPostedMs = Math.round(performance.now() - t0); rec.pair = await L.selectedPair(h.pc); log('B open', rec); });
    setTimeout(() => { if (!rec.open) { rec.open = false; log('B not open', rec); } }, 30000);
  }
} else if (process.env.NODE_CLIENT !== '0') {
  const c = await L.clientOffer(RTCPeerConnection, PORTS);
  const tPost = performance.now();
  await mb.post('offer', 'B-node', c.offer);
  const ans = await mb.wait('answer', { sid: 'B-node', everyMs: 1000 });
  const mailboxMs = Math.round(performance.now() - tPost);
  const conn = await L.clientConnect(c, ans.data);
  out.B_node = { gatherMs: c.gatherMs, offerCandidates: c.offerCandidates, mailboxMs, ...conn };
  log('B node connect', out.B_node);
  if (conn.open) out.B_node.load = await L.clientRun(c, { upSeconds: UP_SECONDS, log: (k, v) => log('B', k, v) });
  c.pc.close();
  if (process.env.SAY_BYE !== '0') await mb.post('bye', 'B', {});
}

wtServer?.stopServer();
const dir = new URL('./results/', import.meta.url).pathname;
mkdirSync(dir, { recursive: true });
writeFileSync(`${dir}nat-${role}.json`, JSON.stringify(out, null, 1));
log('done', role === 'mac' ? 'see results/nat-mac.json' : JSON.stringify(out));
setTimeout(() => process.exit(0), 500);
