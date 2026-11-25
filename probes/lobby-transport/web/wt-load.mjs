// The WebTransport client side of the load, for a browser. host.mjs is the server.
const enc = new TextEncoder();
const now = () => performance.now();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stats = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const q = (p) => Math.round(s[Math.min(s.length - 1, Math.floor(p * s.length))] * 10) / 10;
  return { n: s.length, p50: q(0.5), p95: q(0.95), p99: q(0.99), max: Math.round(s[s.length - 1] * 10) / 10 };
};

export async function wtConnect(url, hash) {
  const t0 = now();
  const wt = new WebTransport(url, { serverCertificateHashes: [{ algorithm: 'sha-256', value: new Uint8Array(hash) }] });
  wt.closed.catch(() => {});
  await Promise.race([wt.ready, sleep(15000).then(() => { throw new Error('ready timed out after 15 s'); })]);
  return { wt, connectMs: Math.round(now() - t0) };
}

async function open(wt, header, body) {
  const s = await wt.createBidirectionalStream();
  const w = s.writable.getWriter();
  await w.write(enc.encode(`${JSON.stringify(header)}\n`));
  if (body) await w.write(body);
  return { s, w, r: s.readable.getReader() };
}
// A slow reader takes slowBytesPerSec, paced by elapsed time (chunk sizes differ
// by browser, and per-chunk sleeps clamp to the timer floor).
async function readAll(r, slowBytesPerSec) {
  let n = 0;
  const t0 = now();
  for (;;) {
    const { value, done } = await r.read();
    if (done) return n;
    n += value.length;
    if (slowBytesPerSec) { const ahead = (n / slowBytesPerSec) * 1000 - (now() - t0); if (ahead > 20) await sleep(ahead); }
  }
}

export async function wtRun(wt, { streamBytes = 20 * 1024 * 1024, slowBytesPerSec = 2 * 1024 * 1024, upSeconds = 60, rate = 20, log = () => {} } = {}) {
  const out = {};
  const req = [];
  for (let i = 0; i < 10; i++) {
    const t = now();
    const { w, r } = await open(wt, { t: 'req' }, enc.encode('x'.repeat(200)));
    await w.close();
    await readAll(r);
    req.push(now() - t);
  }
  out.request = stats(req);
  log('request', out.request);
  for (const [k, slow] of [['stream', 0], ['slowStream', slowBytesPerSec]]) {
    const t = now();
    const { w, r } = await open(wt, { t: 'stream', bytes: streamBytes });
    await w.close();
    const bytes = await readAll(r, slow);
    const ms = now() - t;
    const last = await open(wt, { t: 'last' });
    await last.w.close();
    let txt = '';
    for (;;) { const { value, done } = await last.r.read(); if (done) break; txt += new TextDecoder().decode(value); }
    const host = JSON.parse(txt);
    out[k] = { bytes, ms: Math.round(ms), mbps: Math.round((bytes * 8) / ms / 1000 * 10) / 10, hostSendMs: host.hostMs, hostMaxWriteWaitMs: host.maxWriteWaitMs, slowBytesPerSec: slow };
    log(k, out[k]);
  }
  // 20 a second up for upSeconds: datagrams (unreliable) and one reliable stream, both echoed.
  const total = rate * upSeconds;
  const dgSent = new Map(), stSent = new Map(), dgRtt = [], stRtt = [];
  const dw = (wt.datagrams.createWritable?.() ?? wt.datagrams.writable).getWriter();
  const dr = wt.datagrams.readable.getReader();
  let stop = false;
  (async () => { while (!stop) { const { value, done } = await dr.read(); if (done) break; const seq = new DataView(value.buffer, value.byteOffset).getUint32(0); const t = dgSent.get(seq); if (t != null) { dgRtt.push(now() - t); dgSent.delete(seq); } } })().catch(() => {});
  const echo = await open(wt, { t: 'echo' });
  (async () => {
    let buf = new Uint8Array(0);
    for (;;) {
      const { value, done } = await echo.r.read();
      if (done) break;
      const n = new Uint8Array(buf.length + value.length); n.set(buf); n.set(value, buf.length); buf = n;
      while (buf.length >= 64) { const seq = new DataView(buf.buffer, buf.byteOffset).getUint32(0); const t = stSent.get(seq); if (t != null) { stRtt.push(now() - t); stSent.delete(seq); } buf = buf.slice(64); }
    }
  })().catch(() => {});
  const t0 = now();
  for (let i = 0; i < total; i++) {
    const wait = t0 + (i * 1000) / rate - now();
    if (wait > 0) await sleep(wait);
    const msg = new Uint8Array(64); new DataView(msg.buffer).setUint32(0, i);
    dgSent.set(i, now()); dw.write(msg).catch(() => {});
    stSent.set(i, now()); echo.w.write(msg.slice()).catch(() => {});
  }
  await sleep(2000);
  stop = true;
  out.upDatagram = { sent: total, echoed: dgRtt.length, lossPct: Math.round(((total - dgRtt.length) / total) * 10000) / 100, rttMs: stats(dgRtt) };
  out.upStream = { sent: total, echoed: stRtt.length, lossPct: Math.round(((total - stRtt.length) / total) * 10000) / 100, rttMs: stats(stRtt) };
  log('up', out.upDatagram, out.upStream);
  echo.w.close().catch(() => {});
  return out;
}
