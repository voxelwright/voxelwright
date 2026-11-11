// A self-signed ECDSA P-256 certificate good for 13 days, made again at every start. A
// browser accepts a WebTransport server by the certificate's hash only for such a
// certificate (ECDSA, 14 days at most). From the seat transport probe (#81); recipe in
// .agents/skills/seat-transport. Written under .certs/, which Git ignores.
import { execFileSync } from 'node:child_process'
import { createHash, X509Certificate } from 'node:crypto'
import { mkdirSync, readFileSync } from 'node:fs'
import { isIP } from 'node:net'
import { join } from 'node:path'

export function makeCert(dir: string, names: string[]) {
  const d = join(dir, '.certs')
  mkdirSync(d, { recursive: true })
  const key = join(d, 'key.pem'), crt = join(d, 'cert.pem')
  const alt = ['DNS:localhost', ...names.map((n) => (isIP(n) ? `IP:${n}` : `DNS:${n}`))]
  execFileSync('openssl', ['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes', '-keyout', key, '-out', crt, '-days', '13', '-subj', '/CN=localhost', '-addext', `subjectAltName=${[...new Set(alt)].join(',')}`], { stdio: 'ignore' })
  const cert = readFileSync(crt, 'utf8')
  return { cert, privKey: readFileSync(key, 'utf8'), hash: [...createHash('sha256').update(new X509Certificate(cert).raw).digest()] }
}
