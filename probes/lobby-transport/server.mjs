// The page's origin, a stand-in master server, and the results sink, on
// 127.0.0.1:5980. `tailscale serve --https=10980 http://127.0.0.1:5980` puts it
// on a real https origin (tailnet only).
//
// Master (the smallest signalling that works):
//   GET  /master/host/:lobby        a host holds this open (server-sent events); offers arrive on it
//   POST /master/lobby/:lobby       the host's listing: { wt: { url, hash } } (metadata only)
//   GET  /master/lobby/:lobby       the listing, for a page
//   POST /master/join/:lobby        a client's whole offer; the reply is the host's whole answer
//   POST /master/answer/:sid        the host's whole answer for one offer
// Relay (test 2 and 3 only): POST /relay/offer  { run, sid, offer } -> the issue mailbox -> { answer }
// Results: POST /result/:name, POST /log/:name
import { createServer } from 'node:http';
import { mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { mailbox } from './lib/mailbox.mjs';

const here = new URL('.', import.meta.url).pathname;
const PORT = Number(process.env.PORT ?? 5980);
const hosts = new Map(); // lobby -> sse response
const listings = new Map();
const pending = new Map(); // sid -> resolve(answer)
const results = join(here, 'results');
mkdirSync(join(results, 'private'), { recursive: true });

const body = (req) => new Promise((r) => { let s = ''; req.on('data', (d) => { s += d; }); req.on('end', () => r(s ? JSON.parse(s) : {})); });
const json = (res, code, v) => { res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(v)); };
const files = { '/': 'web/index.html', '/lib/rtc-load.mjs': 'lib/rtc-load.mjs', '/wt-load.mjs': 'web/wt-load.mjs' };

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  if (req.method === 'GET' && files[p]) {
    res.writeHead(200, { 'content-type': p.endsWith('.mjs') ? 'text/javascript' : 'text/html', 'cache-control': 'no-store' });
    return res.end(readFileSync(join(here, files[p])));
  }
  let m;
  if ((m = p.match(/^\/master\/host\/([\w-]+)$/)) && req.method === 'GET') {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store' });
    res.write(': held\n\n');
    hosts.set(m[1], res);
    const ping = setInterval(() => res.write(': ping\n\n'), 15000);
    req.on('close', () => { clearInterval(ping); if (hosts.get(m[1]) === res) hosts.delete(m[1]); });
    return;
  }
  if ((m = p.match(/^\/master\/lobby\/([\w-]+)$/))) {
    if (req.method === 'POST') { listings.set(m[1], await body(req)); return json(res, 200, { ok: true }); }
    return listings.has(m[1]) ? json(res, 200, listings.get(m[1])) : json(res, 404, { error: 'no such lobby' });
  }
  if ((m = p.match(/^\/master\/join\/([\w-]+)$/)) && req.method === 'POST') {
    const host = hosts.get(m[1]);
    if (!host) return json(res, 404, { error: 'host not connected' });
    const { offer } = await body(req);
    const sid = crypto.randomUUID();
    const t0 = performance.now();
    const answer = await new Promise((r) => { pending.set(sid, r); host.write(`data: ${JSON.stringify({ sid, offer })}\n\n`); setTimeout(() => r(null), 20000); });
    pending.delete(sid);
    return answer ? json(res, 200, { answer, masterMs: Math.round(performance.now() - t0) }) : json(res, 504, { error: 'host did not answer' });
  }
  if ((m = p.match(/^\/master\/answer\/([\w-]+)$/)) && req.method === 'POST') {
    pending.get(m[1])?.((await body(req)).answer);
    return json(res, 200, { ok: true });
  }
  if (p === '/relay/offer' && req.method === 'POST') {
    const { run, sid, offer } = await body(req);
    const mb = mailbox({ repo: 'the private source repository', issue: Number(process.env.MAILBOX_ISSUE), me: 'mac', run });
    const t0 = performance.now();
    await mb.post('offer', sid, offer);
    const ans = await mb.wait('answer', { sid, timeoutMs: 60000, everyMs: 1000 });
    return ans ? json(res, 200, { answer: ans.data, mailboxMs: Math.round(performance.now() - t0) }) : json(res, 504, { error: 'no answer' });
  }
  if ((m = p.match(/^\/(result|log)\/([\w.-]+)$/)) && req.method === 'POST') {
    const v = await body(req);
    if (v.origin) v.origin = v.origin.replace(/\/\/[^/]+\.ts\.net(:\d+)?/, '//<tailnet-host>$1'); // keep the tailnet name out of results
    if (m[1] === 'result') writeFileSync(join(results, `${m[2]}.json`), JSON.stringify(v, null, 1));
    else appendFileSync(join(results, 'private', `${m[2]}.log`), `${new Date().toISOString()} ${JSON.stringify(v)}\n`);
    console.log(m[1], m[2], JSON.stringify(v).slice(0, 300));
    return json(res, 200, { ok: true });
  }
  json(res, 404, { error: 'not found' });
}).listen(PORT, '127.0.0.1', () => console.log(`probe server on http://127.0.0.1:${PORT}`));
