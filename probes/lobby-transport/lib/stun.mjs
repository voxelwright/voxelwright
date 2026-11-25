// A STUN binding request (RFC 5389) over a UDP socket the caller owns, so the
// same local port can ask several servers and the mapped ports can be compared.
import { randomBytes } from 'node:crypto';
import { lookup } from 'node:dns/promises';

export const STUN_SERVERS = [
  ['stun.l.google.com', 19302],
  ['stun1.l.google.com', 19302],
  ['stun.cloudflare.com', 3478],
];

export async function binding(sock, host, port, timeoutMs = 3000) {
  const { address } = await lookup(host, { family: 4 });
  const id = randomBytes(12);
  const req = Buffer.alloc(20);
  req.writeUInt16BE(0x0001, 0); req.writeUInt16BE(0, 2); req.writeUInt32BE(0x2112a442, 4); id.copy(req, 8);
  return new Promise((resolve) => {
    const done = (v) => { clearTimeout(timer); sock.off('message', on); resolve(v); };
    const on = (msg) => {
      if (msg.length < 20 || !msg.subarray(8, 20).equals(id)) return;
      let off = 20;
      while (off + 4 <= msg.length) {
        const type = msg.readUInt16BE(off), len = msg.readUInt16BE(off + 2);
        if (type === 0x0020 || type === 0x0001) { // XOR-MAPPED-ADDRESS or MAPPED-ADDRESS
          const xor = type === 0x0020;
          const p = msg.readUInt16BE(off + 6) ^ (xor ? 0x2112 : 0);
          const a = [0, 1, 2, 3].map((i) => msg[off + 8 + i] ^ (xor ? [0x21, 0x12, 0xa4, 0x42][i] : 0)).join('.');
          return done({ server: `${host}:${port}`, serverIp: address, address: a, port: p });
        }
        off += 4 + len + ((4 - (len % 4)) % 4);
      }
    };
    const timer = setTimeout(() => done({ server: `${host}:${port}`, serverIp: address, error: 'timeout' }), timeoutMs);
    sock.on('message', on);
    sock.send(req, port, address);
  });
}

// Never print a public address: keep only its shape.
export const mask = (ip) => (ip ? ip.replace(/^(\d+)\.\d+\.\d+\.(\d+)$/, '$1.x.x.$2') : ip);
