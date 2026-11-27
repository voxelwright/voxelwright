// A self-signed ECDSA P-256 certificate good for 13 days, made again at every start. A
// browser accepts a WebTransport server by the certificate's hash only for such a
// certificate (ECDSA, 14 days at most). From the seat transport probe (#81); recipe in
// .agents/skills/seat-transport. Written under .certs/, which Git ignores.
import { execFileSync } from 'node:child_process'
import { createHash, X509Certificate } from 'node:crypto'
import { chmodSync, mkdirSync, readFileSync } from 'node:fs'
import { isIP } from 'node:net'
import { join } from 'node:path'

/** A DNS name: dot-separated labels of letters, digits and inner hyphens, at most 253 characters. */
const HOST_NAME = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i

export function makeCert(dir: string, names: string[]) {
  // Every name goes into OpenSSL's subjectAltName list, where a comma or colon would add entries of its own.
  const wrong = names.find((n) => !isIP(n) && !HOST_NAME.test(n))
  if (wrong !== undefined) throw new Error(`${JSON.stringify(wrong)} is not a host name or IP address`)
  const d = join(dir, '.certs')
  mkdirSync(d, { recursive: true, mode: 0o700 })
  chmodSync(d, 0o700)
  const key = join(d, 'key.pem'), crt = join(d, 'cert.pem')
  const alt = ['DNS:localhost', ...names.map((n) => (isIP(n) ? `IP:${n}` : `DNS:${n}`))]
  execFileSync('openssl', ['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes', '-keyout', key, '-out', crt, '-days', '13', '-subj', '/CN=localhost', '-addext', `subjectAltName=${[...new Set(alt)].join(',')}`], { stdio: 'ignore' })
  chmodSync(key, 0o600)
  const cert = readFileSync(crt, 'utf8')
  return { cert, privKey: readFileSync(key, 'utf8'), hash: [...createHash('sha256').update(new X509Certificate(cert).raw).digest()] }
}
