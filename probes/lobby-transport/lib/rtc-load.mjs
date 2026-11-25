// WebRTC data-channel host and client on the W3C API, so the same code runs in
// a browser and in Node (node-datachannel's polyfill). Signalling is one whole
// offer and one whole answer: each side waits for ICE gathering to finish.
//
// Channels (all opened by the client):
//   ctl   reliable, ordered: request and reply, stream control
//   down  reliable, ordered: the 20 MB stream from the host
//   up    reliable, ordered: 20 small messages a second up (like today's POSTs), echoed
//   upu   unordered, no retransmits: the same load, to see loss
export const ICE = [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun.cloudflare.com:3478' }];
const CHUNK = 64 * 1024;
const HIGH = 1024 * 1024;
const LOW = 256 * 1024;
const now = () => performance.now();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Whole-offer signalling needs gathering to end, but browsers and libjuice can
// take 10 s or more to call it complete (an IPv6 or TCP path that never answers).
// So stop at "complete", or once a server-reflexive candidate is in and nothing
// new came for graceMs, or at capMs. Reports which.
export function gathered(pc, { graceMs = 300, capMs = 3000 } = {}) {
  const t0 = now();
  if (pc.iceGatheringState === 'complete') return Promise.resolve({ how: 'complete', ms: 0 });
  return new Promise((r) => {
    let srflx = false, quiet = null, firstSrflxMs = null;
    const end = (how) => { clearTimeout(cap); clearTimeout(quiet); r({ how, ms: Math.round(now() - t0), firstSrflxMs }); };
    const cap = setTimeout(() => end('cap'), capMs);
    pc.addEventListener('icegatheringstatechange', () => { if (pc.iceGatheringState === 'complete') end('complete'); });
    pc.addEventListener('icecandidate', (e) => {
      if (!e.candidate) return end('complete');
      if (/ typ srflx/.test(e.candidate.candidate) && !srflx) { srflx = true; firstSrflxMs = Math.round(now() - t0); }
      if (srflx) { clearTimeout(quiet); quiet = setTimeout(() => end('srflx+quiet'), graceMs); }
    });
  });
}

const opened = (ch) => (ch.readyState === 'open' ? Promise.resolve() : new Promise((r) => ch.addEventListener('open', () => r(), { once: true })));

// Candidate types in an SDP, without addresses.
export function candidateTypes(sdp) {
  const c = { host: 0, srflx: 0, prflx: 0, relay: 0, udp: 0, tcp: 0, ipv6: 0, mdns: 0 };
  for (const m of sdp.matchAll(/a=candidate:\S+ \d+ (\S+) \d+ (\S+) \d+ typ (\S+)/g)) {
    c[m[3]] = (c[m[3]] ?? 0) + 1;
    c[m[1].toLowerCase()] = (c[m[1].toLowerCase()] ?? 0) + 1;
    if (m[2].includes(':')) c.ipv6++;
    if (m[2].endsWith('.local')) c.mdns++;
  }
  return c;
}

// The selected pair, as types only (never addresses).
export async function selectedPair(pc) {
  try {
    const stats = await pc.getStats();
    const all = [...stats.values()];
    let pair = all.find((s) => s.type === 'candidate-pair' && s.nominated && s.state === 'succeeded');
    const transport = all.find((s) => s.type === 'transport' && s.selectedCandidatePairId);
    if (transport) pair = all.find((s) => s.id === transport.selectedCandidatePairId) ?? pair;
    if (pair) {
      const l = all.find((s) => s.id === pair.localCandidateId);
      const r = all.find((s) => s.id === pair.remoteCandidateId);
      if (l && r) return { local: l.candidateType, remote: r.candidateType, protocol: l.protocol };
    }
  } catch { /* fall through */ }
  if (pc.sctp?.transport?.iceTransport?.getSelectedCandidatePair) {
    const p = pc.sctp.transport.iceTransport.getSelectedCandidatePair();
    if (p) return { local: p.local?.type, remote: p.remote?.type, protocol: p.local?.protocol };
  }
  if (typeof pc.selectedCandidatePair === 'function') {
    const p = pc.selectedCandidatePair();
    if (p) return { local: p.local?.type, remote: p.remote?.type, protocol: p.local?.transportType };
  }
  return null;
}

// ---------- client ----------
export async function clientOffer(PC, config = {}) {
  const t0 = now();
  const pc = new PC({ iceServers: ICE, ...config });
  const ch = {
    ctl: pc.createDataChannel('ctl'),
    down: pc.createDataChannel('down'),
    up: pc.createDataChannel('up'),
    upu: pc.createDataChannel('upu', { ordered: false, maxRetransmits: 0 }),
  };
  for (const c of Object.values(ch)) c.binaryType = 'arraybuffer';
  await pc.setLocalDescription(await pc.createOffer());
  const g = await gathered(pc);
  const offer = { type: pc.localDescription.type, sdp: pc.localDescription.sdp };
  return { pc, ch, offer, gatherMs: Math.round(now() - t0), gatherComplete: g.how, firstSrflxMs: g.firstSrflxMs, offerCandidates: candidateTypes(offer.sdp) };
}

export async function clientConnect(c, answer, timeoutMs = 20000) {
  const t0 = now();
  await c.pc.setRemoteDescription(answer);
  const ok = await Promise.race([Promise.all(Object.values(c.ch).map(opened)).then(() => true), sleep(timeoutMs).then(() => false)]);
  return { open: ok, openMs: Math.round(now() - t0), state: c.pc.connectionState ?? c.pc.iceConnectionState, answerCandidates: candidateTypes(answer.sdp), pair: ok ? await selectedPair(c.pc) : null };
}

function ctlClient(ctl) {
  const waiting = new Map();
  ctl.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    waiting.get(m.id)?.(m);
    waiting.delete(m.id);
  });
  let n = 0;
  return (msg) => new Promise((r) => { const id = ++n; waiting.set(id, r); ctl.send(JSON.stringify({ ...msg, id })); });
}

const stats = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const q = (p) => Math.round(s[Math.min(s.length - 1, Math.floor(p * s.length))] * 10) / 10;
  return { n: s.length, p50: q(0.5), p95: q(0.95), p99: q(0.99), max: Math.round(s[s.length - 1] * 10) / 10 };
};

async function stream(ch, ask, bytes, slowBytesPerSec) {
  let got = 0, queued = 0, peakQueued = 0, consumed = 0;
  const t0 = now();
  const queue = [];
  let wake = null;
  const done = new Promise((resolve) => {
    ch.down.onmessage = (e) => {
      const n = e.data.byteLength ?? e.data.size ?? e.data.length;
      got += n;
      if (slowBytesPerSec) { queue.push(n); queued += n; peakQueued = Math.max(peakQueued, queued); wake?.(); }
      if (got >= bytes && !slowBytesPerSec) resolve();
    };
    if (slowBytesPerSec) (async () => {
      // A slow reader: it takes the bytes at slowBytesPerSec. A data channel has no
      // way to tell the host to wait, so everything not yet taken sits here.
      const s0 = now();
      while (consumed < bytes) {
        if (!queue.length) { await new Promise((r) => { wake = r; }); wake = null; continue; }
        const n = queue.shift();
        consumed += n; queued -= n;
        const ahead = (consumed / slowBytesPerSec) * 1000 - (now() - s0);
        if (ahead > 20) await sleep(ahead);
      }
      resolve();
    })();
  });
  const hostReply = ask({ t: 'stream', bytes });
  await done;
  const host = await hostReply;
  const recvMs = now() - t0;
  ch.down.onmessage = null;
  return { bytes: got, ms: Math.round(recvMs), mbps: Math.round((bytes * 8) / recvMs / 1000 * 10) / 10, hostSendMs: host.hostMs, hostPeakBuffered: host.peakBuffered, readerPeakQueued: slowBytesPerSec ? peakQueued : undefined, slowBytesPerSec };
}

async function upload(chan, rate, seconds) {
  const sent = new Map();
  const rtts = [];
  chan.onmessage = (e) => {
    const m = JSON.parse(e.data);
    const t = sent.get(m.seq);
    if (t != null) { rtts.push(now() - t); sent.delete(m.seq); }
  };
  const total = rate * seconds;
  const t0 = now();
  for (let i = 0; i < total; i++) {
    const due = t0 + (i * 1000) / rate;
    const wait = due - now();
    if (wait > 0) await sleep(wait);
    sent.set(i, now());
    chan.send(JSON.stringify({ seq: i, pos: [1.25, 0.5, -3.75], yaw: 0.3, act: 'walk' }));
  }
  await sleep(2000);
  chan.onmessage = null;
  return { sent: total, echoed: rtts.length, lossPct: Math.round(((total - rtts.length) / total) * 10000) / 100, rttMs: stats(rtts) };
}

export async function clientRun(c, { streamBytes = 20 * 1024 * 1024, slowBytesPerSec = 2 * 1024 * 1024, upSeconds = 60, rate = 20, log = () => {} } = {}) {
  const ask = ctlClient(c.ch.ctl);
  const out = {};
  const req = [];
  for (let i = 0; i < 10; i++) { const t = now(); await ask({ t: 'req', body: 'x'.repeat(200) }); req.push(now() - t); }
  out.request = stats(req);
  log('request', out.request);
  out.stream = await stream(c.ch, ask, streamBytes, 0);
  log('stream', out.stream);
  out.slowStream = await stream(c.ch, ask, streamBytes, slowBytesPerSec);
  log('slowStream', out.slowStream);
  const [up, upu] = await Promise.all([upload(c.ch.up, rate, upSeconds), upload(c.ch.upu, rate, upSeconds)]);
  out.up = up; out.upUnreliable = upu;
  log('up', up, upu);
  return out;
}

// ---------- host ----------
export async function hostAnswer(PC, offer, config = {}) {
  const t0 = now();
  const pc = new PC({ iceServers: ICE, ...config });
  const ch = {};
  const all = new Promise((r) => {
    pc.addEventListener('datachannel', ({ channel }) => {
      channel.binaryType = 'arraybuffer';
      ch[channel.label] = channel;
      opened(channel).then(() => { if (['ctl', 'down', 'up', 'upu'].every((k) => ch[k]?.readyState === 'open')) r(); });
    });
  });
  await pc.setRemoteDescription(offer);
  await pc.setLocalDescription(await pc.createAnswer());
  const g = await gathered(pc);
  const answer = { type: pc.localDescription.type, sdp: pc.localDescription.sdp };
  return { pc, ch, answer, answerMs: Math.round(now() - t0), gather: g, ready: all.then(() => hostServe(ch)) };
}

function hostServe(ch) {
  const echo = (c) => { c.onmessage = (e) => c.send(e.data); };
  echo(ch.up); echo(ch.upu);
  const chunk = new Uint8Array(CHUNK);
  ch.down.bufferedAmountLowThreshold = LOW;
  ch.ctl.onmessage = async (e) => {
    const m = JSON.parse(e.data);
    if (m.t === 'req') return ch.ctl.send(JSON.stringify({ id: m.id, t: 'rep', body: 'y'.repeat(200) }));
    if (m.t === 'stream') {
      const t0 = now();
      let sent = 0, peak = 0;
      while (sent < m.bytes) {
        if (ch.down.bufferedAmount > HIGH) {
          await new Promise((r) => ch.down.addEventListener('bufferedamountlow', () => r(), { once: true }));
        }
        ch.down.send(chunk);
        sent += CHUNK;
        peak = Math.max(peak, ch.down.bufferedAmount);
      }
      while (ch.down.bufferedAmount > 0) await sleep(5);
      ch.ctl.send(JSON.stringify({ id: m.id, t: 'streamDone', hostMs: Math.round(now() - t0), peakBuffered: peak }));
    }
  };
}
