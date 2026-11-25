// What kind of NAT is this machine behind? One UDP socket asks several public
// STUN servers; the same mapped port from each means endpoint-independent
// mapping (cone-like), different ports mean endpoint-dependent (symmetric).
// Usage: node stun-check.mjs [localPort]   (prints no full public address)
import dgram from 'node:dgram';
import { networkInterfaces } from 'node:os';
import { binding, mask, STUN_SERVERS } from './lib/stun.mjs';

export async function stunCheck(localPort = 0) {
  const sock = dgram.createSocket('udp4');
  await new Promise((r) => sock.bind(localPort, r));
  const local = sock.address().port;
  const out = [];
  for (const [h, p] of STUN_SERVERS) out.push(await binding(sock, h, p));
  sock.close();
  const ok = out.filter((r) => !r.error);
  const localIps = Object.values(networkInterfaces()).flat().filter((i) => i.family === 'IPv4').map((i) => i.address);
  const ports = [...new Set(ok.map((r) => r.port))];
  const ips = [...new Set(ok.map((r) => r.address))];
  return {
    localPort: local,
    answers: out.map((r) => ({ server: r.server, mappedIp: mask(r.address), mappedPort: r.port, error: r.error })),
    natted: ok.length ? !localIps.includes(ok[0].address) : null,
    portPreserved: ok.length ? ok.every((r) => r.port === local) : null,
    mapping: ok.length < 2 ? 'unknown' : ports.length === 1 && ips.length === 1 ? 'endpoint-independent' : 'endpoint-dependent',
    _public: ok[0] ? { ip: ok[0].address, port: ok[0].port } : null, // for the mailbox only; strip before logging
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = await stunCheck(Number(process.argv[2] ?? 0));
  delete r._public;
  console.log(JSON.stringify(r, null, 1));
}
