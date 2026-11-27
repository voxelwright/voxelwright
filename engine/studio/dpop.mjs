// RFC 9449 DPoP (Demonstrating Proof-of-Possession) ES256 client proofs compatible with T3 Code's
// server verifier (packages/shared/src/dpop.ts & apps/server/src/auth/dpop.ts) (#98).
// Uses WebCrypto (crypto.subtle) available identically in Node 25 and modern browsers.
import { createHash, randomUUID } from 'node:crypto'

const b64url = (bytes) => Buffer.from(bytes).toString('base64url')
const b64urlJson = (obj) => b64url(Buffer.from(JSON.stringify(obj), 'utf8'))

/** Strips query & fragment from a URL per RFC 9449 §4.2 `htu` rules. */
export function normalizeDpopHtu(rawUrl) {
  const u = new URL(rawUrl)
  const protocol = u.protocol === 'wss:' ? 'https:' : u.protocol === 'ws:' ? 'http:' : u.protocol
  return `${protocol}//${u.host}${u.pathname}`
}

/** SHA-256 base64url hash of an access token or WS ticket (`ath` claim). */
export function dpopAccessTokenHash(token) {
  return createHash('sha256').update(token, 'utf8').digest('base64url')
}

/** RFC 7638 JWK thumbprint matching T3 Code's computeDpopJwkThumbprint. */
export function dpopThumbprint(publicJwk) {
  const canonical = JSON.stringify({
    crv: publicJwk.crv,
    kty: publicJwk.kty,
    x: publicJwk.x,
    y: publicJwk.y,
  })
  return createHash('sha256').update(canonical, 'utf8').digest('base64url')
}

/** Generates a fresh P-256 ES256 DPoP keypair and returns serializable JWK + live CryptoKeys. */
export async function generateDpopKeyPair() {
  const pair = await globalThis.crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify'],
  )
  const privateJwk = await globalThis.crypto.subtle.exportKey('jwk', pair.privateKey)
  const fullPub = await globalThis.crypto.subtle.exportKey('jwk', pair.publicKey)
  const publicJwk = { kty: 'EC', crv: 'P-256', x: fullPub.x, y: fullPub.y }
  return {
    privateKey: pair.privateKey,
    publicKey: pair.publicKey,
    privateJwk,
    publicJwk,
    thumbprint: dpopThumbprint(publicJwk),
  }
}

/** Rehydrates a persisted DPoP keypair from its private JWK. */
export async function importDpopKeyPair(privateJwk) {
  const privateKey = await globalThis.crypto.subtle.importKey(
    'jwk',
    privateJwk,
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign'],
  )
  const publicJwk = { kty: 'EC', crv: 'P-256', x: privateJwk.x, y: privateJwk.y }
  const publicKey = await globalThis.crypto.subtle.importKey(
    'jwk',
    publicJwk,
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['verify'],
  )
  return {
    privateKey,
    publicKey,
    privateJwk,
    publicJwk,
    thumbprint: dpopThumbprint(publicJwk),
  }
}

/** Signs one `dpop+jwt` ES256 proof (IEEE P1363 r||s format, which WebCrypto ECDSA emits natively). */
export async function createDpopProof(keyPair, { method, url, accessToken }) {
  const header = {
    typ: 'dpop+jwt',
    alg: 'ES256',
    jwk: keyPair.publicJwk,
  }
  const payload = {
    htm: String(method).toUpperCase(),
    htu: normalizeDpopHtu(url),
    jti: randomUUID(),
    iat: Math.floor(Date.now() / 1000),
    ...(accessToken ? { ath: dpopAccessTokenHash(accessToken) } : {}),
  }
  const signingInput = `${b64urlJson(header)}.${b64urlJson(payload)}`
  const sig = await globalThis.crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    keyPair.privateKey,
    Buffer.from(signingInput, 'ascii'),
  )
  return `${signingInput}.${b64url(new Uint8Array(sig))}`
}
