// A stand-in dedicated server on this Mac: holds a socket open to the master
// (server-sent events), answers each whole offer with a whole answer
// (node-datachannel, ICE ports 5983-5987), and serves WebTransport on UDP 5981
// with a self-signed certificate whose hash it lists with the master.
// Usage: node host.mjs <master-url> <lobby> [wt-address]
import { networkInterfaces } from 'node:os';
import { lookup } from 'node:dns/promises';
import { Http3Server } from '@fails-components/webtransport';
import { RTCPeerConnection } from 'node-datachannel/polyfill';
import { makeCert } from './lib/cert.mjs';
import * as L from './lib/rtc-load.mjs';

const [master, lobby, wtAddr] = process.argv.slice(2);
const here = new URL('.', import.meta.url).pathname;
const lan = wtAddr ?? Object.values(networkInterfaces()).flat().find((i) => i.family === 'IPv4' && !i.internal && /^(10\.|192\.168\.|172\.)/.test(i.address))?.address;
const iceServers = await Promise.all(L.ICE.map(async ({ urls }) => {
  const [, h, p] = urls.match(/^stun:([^:]+):(\d+)$/);
  return { urls: `stun:${(await lookup(h, { family: 4 })).address}:${p}` };
}));
const RTC = { iceServers, portRangeBegin: 5983, portRangeEnd: 5987 };
const log = (...a) => console.log(new Date().toISOString().slice(11, 23), ...a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))));

// ---- WebTransport ----
const { cert, privKey, hash } = makeCert(here, [lan]);
const wt = new Http3Server({ port: 5981, host: lan, secret: crypto.randomUUID(), cert, privKey });
const sessions = wt.sessionStream('/probe');
wt.startServer();
await wt.ready;
const enc = new TextEncoder();
let lastStream = null;

async function readHeader(reader) {
  let buf = new Uint8Array(0);
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    const n = new Uint8Array(buf.length + value.length); n.set(buf); n.set(value, buf.length); buf = n;
    const i = buf.indexOf(10);
    if (i >= 0) return { header: JSON.parse(new TextDecoder().decode(buf.subarray(0, i))), rest: buf.subarray(i + 1) };
  }
  return { header: null, rest: buf };
}

async function onStream(s) {
  const reader = s.readable.getReader();
  const writer = s.writable.getWriter();
  const { header, rest } = await readHeader(reader);
  if (!header) return;
  if (header.t === 'req') {
    while (!(await reader.read()).done) { /* drain */ }
    await writer.write(enc.encode('y'.repeat(200)));
    return writer.close();
  }
  if (header.t === 'last') { await writer.write(enc.encode(JSON.stringify(lastStream))); return writer.close(); }
  if (header.t === 'stream') {
    const chunk = new Uint8Array(64 * 1024);
    const t0 = performance.now();
    let maxWaitMs = 0;
    for (let sent = 0; sent < header.bytes; sent += chunk.length) {
      const w0 = performance.now();
      await writer.ready;
      await writer.write(chunk);
      maxWaitMs = Math.max(maxWaitMs, performance.now() - w0);
    }
    await writer.close();
    lastStream = { hostMs: Math.round(performance.now() - t0), maxWriteWaitMs: Math.round(maxWaitMs) };
    return;
  }
  if (header.t === 'echo') {
    if (rest.length) await writer.write(rest);
    for (;;) { const { value, done } = await reader.read(); if (done) break; await writer.write(value); }
    return writer.close().catch(() => {});
  }
}

(async () => {
  const r = sessions.getReader();
  for (;;) {
    const { value: session, done } = await r.read();
    if (done) break;
    log('wt session');
    session.ready.then(async () => {
      const dw = session.datagrams.writable.getWriter();
      (async () => { const dr = session.datagrams.readable.getReader(); for (;;) { const { value, done } = await dr.read(); if (done) break; dw.write(value).catch(() => {}); } })().catch(() => {});
      const br = session.incomingBidirectionalStreams.getReader();
      for (;;) { const { value, done } = await br.read(); if (done) break; onStream(value).catch((e) => log('stream error', String(e))); }
    }).catch((e) => log('session error', String(e)));
  }
})();

// ---- listing and the held-open socket to the master ----
await fetch(`${master}/master/lobby/${lobby}`, { method: 'POST', body: JSON.stringify({ wt: { url: `https://${lan}:5981/probe`, hash } }) });
const res = await fetch(`${master}/master/host/${lobby}`);
log('holding the master socket', { lobby, wt: `${lan}:5981` });
const dec = new TextDecoder();
let buf = '';
for await (const chunk of res.body) {
  buf += dec.decode(chunk, { stream: true });
  let i;
  while ((i = buf.indexOf('\n\n')) >= 0) {
    const ev = buf.slice(0, i); buf = buf.slice(i + 2);
    const data = ev.split('\n').find((l) => l.startsWith('data: '));
    if (!data) continue;
    const { sid, offer } = JSON.parse(data.slice(6));
    const t0 = performance.now();
    const h = await L.hostAnswer(RTCPeerConnection, offer, RTC);
    await fetch(`${master}/master/answer/${sid}`, { method: 'POST', body: JSON.stringify({ answer: h.answer }) });
    log('answered', { answerMs: h.answerMs, offer: L.candidateTypes(offer.sdp) });
    h.ready.then(async () => log('rtc open', { ms: Math.round(performance.now() - t0), pair: await L.selectedPair(h.pc) }));
    h.pc.addEventListener('connectionstatechange', () => { if (h.pc.connectionState === 'closed' || h.pc.connectionState === 'failed') log('rtc', h.pc.connectionState); });
  }
}
