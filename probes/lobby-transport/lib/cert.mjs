// Self-signed ECDSA P-256 certificate valid for 13 days: browsers accept
// serverCertificateHashes only for such certs (ECDSA, at most 14 days).
// Written to .certs/ (gitignored) and made again on every run.
import { execFileSync } from 'node:child_process';
import { createHash, X509Certificate } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export function makeCert(dir, names = []) {
  const d = join(dir, '.certs');
  mkdirSync(d, { recursive: true });
  const key = join(d, 'key.pem');
  const crt = join(d, 'cert.pem');
  const san = ['DNS:localhost', 'IP:127.0.0.1', ...names.map((n) => (/^[\d.]+$|:/.test(n) ? `IP:${n}` : `DNS:${n}`))].join(',');
  execFileSync('openssl', [
    'req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1',
    '-nodes', '-keyout', key, '-out', crt, '-days', '13', '-subj', '/CN=lobby-probe',
    '-addext', `subjectAltName=${san}`,
  ], { stdio: 'ignore' });
  const cert = readFileSync(crt, 'utf8');
  return { cert, privKey: readFileSync(key, 'utf8'), hash: [...createHash('sha256').update(new X509Certificate(cert).raw).digest()] };
}
