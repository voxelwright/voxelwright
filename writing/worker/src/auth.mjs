// Who may write. Two modes, picked by AUTH_MODE:
//   "passkey": WebAuthn. The first passkey needs SETUP_TOKEN and registration closes once one
//              exists. Signing in sets a 12-hour session cookie (HttpOnly, Secure, SameSite=Strict,
//              __Host- prefix); only a hash of the session token is stored.
//   "access":  Cloudflare Access in front of /edit and /api. The Worker still verifies the
//              Cf-Access-Jwt-Assertion header itself (signature, aud, iss, exp, nbf, email), and
//              ignores the plain email header, which anything behind a misrouted path could set.
// Writes also need an Origin header equal to ORIGIN, which stops cross-site form posts even if a
// browser mishandles SameSite.
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from "@simplewebauthn/server";

const SESSION_COOKIE = "__Host-edit";
const CHALLENGE_COOKIE = "__Host-chal";
const SESSION_SECONDS = 12 * 60 * 60;
const CHALLENGE_SECONDS = 5 * 60;

export const b64url = {
  encode(bytes) {
    let s = "";
    for (const b of bytes) s += String.fromCharCode(b);
    return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  },
  decode(text) {
    const s = atob(text.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((text.length + 3) % 4));
    return Uint8Array.from(s, (c) => c.charCodeAt(0));
  },
};

const random = (n = 32) => b64url.encode(crypto.getRandomValues(new Uint8Array(n)));
async function sha256(text) {
  return b64url.encode(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))));
}

/** Constant-time comparison of two strings, via their hashes. */
export async function same(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || !a || !b) return false;
  const [x, y] = await Promise.all([sha256(a), sha256(b)]);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0 && x.length === y.length;
}

export function cookie(req, name) {
  for (const part of (req.headers.get("cookie") ?? "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return null;
}
const setCookie = (name, value, maxAge) => `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;

/** State-changing requests must come from the editor's own origin. */
export function originOk(req, env) {
  return req.headers.get("origin") === env.ORIGIN;
}

// ---- challenges: single use, five minutes ------------------------------------

async function newChallenge(env, kind, challenge) {
  const id = random(16);
  await env.DB.prepare("INSERT INTO challenges (id, challenge, kind, expires_at) VALUES (?, ?, ?, ?)")
    .bind(id, challenge, kind, Date.now() + CHALLENGE_SECONDS * 1000)
    .run();
  return setCookie(CHALLENGE_COOKIE, id, CHALLENGE_SECONDS);
}

async function takeChallenge(req, env, kind) {
  const id = cookie(req, CHALLENGE_COOKIE);
  if (!id) return null;
  const row = await env.DB.prepare("DELETE FROM challenges WHERE id = ? AND kind = ? RETURNING challenge, expires_at").bind(id, kind).first();
  if (!row || row.expires_at < Date.now()) return null;
  return row.challenge;
}

// ---- passkeys ------------------------------------------------------------------

async function credentialCount(env) {
  return (await env.DB.prepare("SELECT COUNT(*) AS n FROM credentials").first()).n;
}

export async function registerOptions(req, env) {
  if (!(await same(req.headers.get("x-setup-token") ?? "", env.SETUP_TOKEN ?? ""))) return [403, { error: "setup token required" }];
  if ((await credentialCount(env)) > 0) return [409, { error: "a passkey already exists; registration is closed" }];
  const options = await generateRegistrationOptions({
    rpName: env.RP_NAME ?? "Site editor",
    rpID: env.RP_ID,
    userName: "owner",
    userID: new TextEncoder().encode("owner"),
    attestationType: "none",
    authenticatorSelection: { residentKey: "required", userVerification: "required" },
  });
  return [200, options, { "set-cookie": await newChallenge(env, "register", options.challenge) }];
}

export async function registerVerify(req, env, body) {
  if (!(await same(req.headers.get("x-setup-token") ?? "", env.SETUP_TOKEN ?? ""))) return [403, { error: "setup token required" }];
  const challenge = await takeChallenge(req, env, "register");
  if (!challenge) return [400, { error: "no live challenge; start again" }];
  let result;
  try {
    result = await verifyRegistrationResponse({ response: body, expectedChallenge: challenge, expectedOrigin: env.ORIGIN, expectedRPID: env.RP_ID, requireUserVerification: true });
  } catch (e) {
    return [400, { error: `passkey not accepted: ${e.message}` }];
  }
  if (!result.verified) return [400, { error: "passkey not accepted" }];
  const c = result.registrationInfo.credential;
  // Only the first passkey: the insert does nothing if one appeared meanwhile.
  const inserted = await env.DB.prepare(
    "INSERT INTO credentials (id, public_key, counter, transports, created_at) SELECT ?, ?, ?, ?, ? WHERE (SELECT COUNT(*) FROM credentials) = 0",
  )
    .bind(c.id, c.publicKey, c.counter, JSON.stringify(c.transports ?? []), new Date().toISOString())
    .run();
  if (!inserted.meta.changes) return [409, { error: "a passkey already exists; registration is closed" }];
  return [200, { registered: true }];
}

export async function loginOptions(req, env) {
  const options = await generateAuthenticationOptions({ rpID: env.RP_ID, userVerification: "required" });
  return [200, options, { "set-cookie": await newChallenge(env, "login", options.challenge) }];
}

export async function loginVerify(req, env, body) {
  const challenge = await takeChallenge(req, env, "login");
  if (!challenge) return [400, { error: "no live challenge; start again" }];
  const row = typeof body?.id === "string" ? await env.DB.prepare("SELECT id, public_key, counter, transports FROM credentials WHERE id = ?").bind(body.id).first() : null;
  if (!row) return [401, { error: "unknown passkey" }];
  let result;
  try {
    result = await verifyAuthenticationResponse({
      response: body,
      expectedChallenge: challenge,
      expectedOrigin: env.ORIGIN,
      expectedRPID: env.RP_ID,
      requireUserVerification: true,
      credential: { id: row.id, publicKey: new Uint8Array(row.public_key), counter: row.counter, transports: JSON.parse(row.transports) },
    });
  } catch (e) {
    return [401, { error: `sign-in not accepted: ${e.message}` }];
  }
  if (!result.verified) return [401, { error: "sign-in not accepted" }];
  await env.DB.prepare("UPDATE credentials SET counter = ? WHERE id = ?").bind(result.authenticationInfo.newCounter, row.id).run();
  const token = random(32);
  await env.DB.prepare("INSERT INTO sessions (token_hash, credential_id, created_at, expires_at) VALUES (?, ?, ?, ?)")
    .bind(await sha256(token), row.id, Date.now(), Date.now() + SESSION_SECONDS * 1000)
    .run();
  return [200, { signedIn: true }, { "set-cookie": setCookie(SESSION_COOKIE, token, SESSION_SECONDS) }];
}

export async function logout(req, env) {
  const token = cookie(req, SESSION_COOKIE);
  if (token) await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await sha256(token)).run();
  return [200, { signedOut: true }, { "set-cookie": setCookie(SESSION_COOKIE, "", 0) }];
}

// ---- Cloudflare Access ------------------------------------------------------------

let jwksCache = null;
async function accessKeys(env) {
  if (env.ACCESS_JWKS) return JSON.parse(env.ACCESS_JWKS).keys; // local tests only
  if (jwksCache && jwksCache.until > Date.now()) return jwksCache.keys;
  const res = await fetch(`${env.ACCESS_ISSUER}/cdn-cgi/access/certs`);
  if (!res.ok) throw new Error(`Access certs: HTTP ${res.status}`);
  jwksCache = { keys: (await res.json()).keys, until: Date.now() + 10 * 60 * 1000 };
  return jwksCache.keys;
}

/** Verifies an Access JWT. Returns the email, or null. */
export async function verifyAccessJwt(token, env, now = Date.now() / 1000) {
  const parts = (token ?? "").split(".");
  if (parts.length !== 3) return null;
  let header, claims;
  try {
    header = JSON.parse(new TextDecoder().decode(b64url.decode(parts[0])));
    claims = JSON.parse(new TextDecoder().decode(b64url.decode(parts[1])));
  } catch {
    return null;
  }
  if (header.alg !== "RS256") return null;
  const jwk = (await accessKeys(env)).find((k) => k.kid === header.kid);
  if (!jwk) return null;
  const key = await crypto.subtle.importKey("jwk", { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: "RS256", ext: true }, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64url.decode(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
  if (!ok) return null;
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!aud.includes(env.ACCESS_AUD)) return null;
  if (claims.iss !== env.ACCESS_ISSUER) return null;
  if (typeof claims.exp !== "number" || claims.exp < now - 30) return null;
  if (typeof claims.nbf === "number" && claims.nbf > now + 30) return null;
  if (env.OWNER_EMAIL && claims.email !== env.OWNER_EMAIL) return null;
  return claims.email ?? null;
}

/** The writer for this request, or null. */
export async function who(req, env) {
  if (env.AUTH_MODE === "access") {
    const email = await verifyAccessJwt(req.headers.get("cf-access-jwt-assertion"), env);
    return email ? `access:${email}` : null;
  }
  const token = cookie(req, SESSION_COOKIE);
  if (!token) return null;
  const row = await env.DB.prepare("SELECT credential_id, expires_at FROM sessions WHERE token_hash = ?").bind(await sha256(token)).first();
  if (!row || row.expires_at < Date.now()) return null;
  return `passkey:${row.credential_id.slice(0, 8)}`;
}
