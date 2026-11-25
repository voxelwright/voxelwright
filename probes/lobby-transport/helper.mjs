// Test 4: a stand-in for the visitor's own helper (which would run their model
// CLI). Plain http on 127.0.0.1 and ::1, port 5982, answering CORS and Private
// Network Access preflights. Logs what each request carried.
import { createServer } from 'node:http';

const PORT = Number(process.env.HELPER_PORT ?? 5982);
const handler = (req, res) => {
  const origin = req.headers.origin;
  console.log(new Date().toISOString().slice(11, 23), req.method, req.url, JSON.stringify({
    origin, host: req.headers.host, pnaRequest: req.headers['access-control-request-private-network'],
    lnaRequest: req.headers['access-control-request-local-network'], secFetchSite: req.headers['sec-fetch-site'],
  }));
  const h = {
    'access-control-allow-origin': origin ?? '*',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'content-type',
    'access-control-allow-private-network': 'true',
    'access-control-allow-local-network': 'true',
    vary: 'origin',
  };
  if (req.method === 'OPTIONS') { res.writeHead(204, h); return res.end(); }
  res.writeHead(200, { ...h, 'content-type': 'application/json' });
  res.end(JSON.stringify({ helper: 'ok', via: req.headers.host }));
};
for (const host of ['127.0.0.1', '::1']) createServer(handler).listen(PORT, host, () => console.log(`helper on http://${host.includes(':') ? `[${host}]` : host}:${PORT}`));

// Safari blocks fetch from an https page to http on loopback (mixed content).
// WebTransport by certificate hash is not mixed content: the same helper also
// answers on https://127.0.0.1:5988 (UDP) with a 13-day self-signed certificate.
// The page learns the hash from the link the helper prints (a URL fragment).
if (process.env.HELPER_WT !== '0') {
  const { Http3Server } = await import('@fails-components/webtransport');
  const { makeCert } = await import('./lib/cert.mjs');
  const { cert, privKey, hash } = makeCert(new URL('./.certs/helper/', import.meta.url).pathname);
  const wt = new Http3Server({ port: 5988, host: '127.0.0.1', secret: crypto.randomUUID(), cert, privKey });
  const sessions = wt.sessionStream('/helper');
  wt.startServer();
  await wt.ready;
  console.log(`helper WebTransport on https://127.0.0.1:5988/helper, hash ${Buffer.from(hash).toString('hex')}`);
  (async () => {
    const r = sessions.getReader();
    for (;;) {
      const { value: s, done } = await r.read();
      if (done) break;
      s.ready.then(async () => {
        console.log(new Date().toISOString().slice(11, 23), 'wt session');
        const br = s.incomingBidirectionalStreams.getReader();
        for (;;) {
          const { value: st, done: d } = await br.read();
          if (d) break;
          const rd = st.readable.getReader(); const w = st.writable.getWriter();
          let got = ''; for (;;) { const x = await rd.read(); if (x.done) break; got += new TextDecoder().decode(x.value); }
          await w.write(new TextEncoder().encode(JSON.stringify({ helper: 'ok', via: 'webtransport', got }))); await w.close();
        }
      }).catch(() => {});
    }
  })();
}
