// Spike tests that need no running Worker: the Access JWT check, the write-path gate, and the
// git store's conflict handling.   node --test writing/spike.test.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { verifyAccessJwt, b64url, loginOptions, MAX_PENDING_CHALLENGES } from "./worker/src/auth.mjs";
import { checkSubmission } from "./core.mjs";
import { setupGit, publishGit } from "./store-git.mjs";

const enc = (o) => b64url.encode(new TextEncoder().encode(JSON.stringify(o)));
const { publicKey, privateKey } = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
const other = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
const jwk = { ...(await crypto.subtle.exportKey("jwk", publicKey)), kid: "k1" };
const env = { ACCESS_JWKS: JSON.stringify({ keys: [jwk] }), ACCESS_AUD: "aud-123", ACCESS_ISSUER: "https://team.cloudflareaccess.com", OWNER_EMAIL: "owner@example.org" };
const now = Math.floor(Date.now() / 1000);

async function jwt(claims, { key = privateKey, header = { alg: "RS256", kid: "k1" } } = {}) {
  const body = `${enc(header)}.${enc({ aud: ["aud-123"], iss: env.ACCESS_ISSUER, email: "owner@example.org", exp: now + 600, iat: now, ...claims })}`;
  const sig = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(body)));
  return `${body}.${b64url.encode(sig)}`;
}

test("a valid Access token names the owner", async () => {
  assert.equal(await verifyAccessJwt(await jwt({}), env), "owner@example.org");
});

test("Access tokens with a bad signature, audience, issuer, expiry, email or algorithm are refused", async () => {
  assert.equal(await verifyAccessJwt(await jwt({}, { key: other.privateKey }), env), null);
  assert.equal(await verifyAccessJwt(await jwt({ aud: ["someone-else"] }), env), null);
  assert.equal(await verifyAccessJwt(await jwt({ iss: "https://evil.cloudflareaccess.com" }), env), null);
  assert.equal(await verifyAccessJwt(await jwt({ exp: now - 120 }), env), null);
  assert.equal(await verifyAccessJwt(await jwt({ nbf: now + 600 }), env), null);
  assert.equal(await verifyAccessJwt(await jwt({ email: "intruder@example.org" }), env), null);
  assert.equal(await verifyAccessJwt(await jwt({}, { header: { alg: "none", kid: "k1" } }), env), null);
  assert.equal(await verifyAccessJwt(await jwt({}, { header: { alg: "RS256", kid: "unknown" } }), env), null);
  assert.equal(await verifyAccessJwt("not.a.jwt", env), null);
  assert.equal(await verifyAccessJwt(null, env), null);
});

test("an Access token with no key id, or an empty one, is refused even when a key has no id either", async () => {
  const { kid, ...unnamed } = jwk;
  const anyKey = { ...env, ACCESS_JWKS: JSON.stringify({ keys: [unnamed] }) };
  assert.equal(await verifyAccessJwt(await jwt({}, { header: { alg: "RS256" } }), anyKey), null);
  assert.equal(await verifyAccessJwt(await jwt({}, { header: { alg: "RS256", kid: "" } }), { ...env, ACCESS_JWKS: JSON.stringify({ keys: [{ ...unnamed, kid: "" }] }) }), null);
  assert.equal(await verifyAccessJwt(await jwt({}, { header: { alg: "RS256", kid: 1 } }), { ...env, ACCESS_JWKS: JSON.stringify({ keys: [{ ...unnamed, kid: 1 }] }) }), null);
});

/** A D1 stand-in holding only the challenges table, for the statements auth.mjs runs on it. */
function challengeDb() {
  const rows = [];
  const statement = (sql) => ({
    args: [],
    bind(...args) { this.args = args; return this; },
    async first() {
      if (/^SELECT COUNT\(\*\) AS n FROM challenges WHERE expires_at >= \?$/.test(sql)) return { n: rows.filter((r) => r.expires_at >= this.args[0]).length };
      throw new Error(`unexpected first(): ${sql}`);
    },
    async run() {
      if (/^DELETE FROM challenges WHERE expires_at < \?$/.test(sql)) { for (let i = rows.length - 1; i >= 0; i--) if (rows[i].expires_at < this.args[0]) rows.splice(i, 1); return {}; }
      if (/^INSERT INTO challenges/.test(sql)) { const [id, challenge, kind, expires_at] = this.args; rows.push({ id, challenge, kind, expires_at }); return {}; }
      throw new Error(`unexpected run(): ${sql}`);
    },
  });
  return { rows, prepare: statement, async batch(list) { for (const s of list) await s.run(); return []; } };
}

test("sign-in challenges are capped: past the cap a new one is refused with 429 until the old ones expire", async () => {
  const DB = challengeDb();
  const authEnv = { DB, RP_ID: "localhost" };
  const req = new Request("https://localhost/auth/login/options", { method: "POST" });
  for (let i = 0; i < MAX_PENDING_CHALLENGES; i++) assert.equal((await loginOptions(req, authEnv))[0], 200);
  assert.equal(DB.rows.length, MAX_PENDING_CHALLENGES);
  const [status, body, headers] = await loginOptions(req, authEnv);
  assert.equal(status, 429);
  assert.match(body.error, /too many/);
  assert.ok(Number(headers["retry-after"]) > 0);
  assert.equal(DB.rows.length, MAX_PENDING_CHALLENGES, "a refused sign-in stores nothing");
  for (const row of DB.rows) row.expires_at = Date.now() - 1;
  assert.equal((await loginOptions(req, authEnv))[0], 200, "expired challenges free the room and are swept");
  assert.equal(DB.rows.length, 1);
});

const MD = '---\ntitle: "T"\ndate: 2026-11-16\nsummary: "S."\ntags: [x]\ndraft: false\n---\n\nBody.\n';

test("the gate accepts a normal post and refuses the dangerous ones", () => {
  assert.equal(checkSubmission({ slug: "a-post", files: { "index.md": MD } }).ok, true);
  const refuse = (input, re) => {
    const r = checkSubmission(input);
    assert.equal(r.ok, false);
    assert.match(r.errors.join("\n"), re);
  };
  refuse({ slug: "A Post", files: { "index.md": MD } }, /slug/);
  refuse({ slug: "a", files: { "index.md": MD, "x.html": "<b>" } }, /not accepted/);
  refuse({ slug: "a", files: { "index.md": MD, "logo.svg": "<svg/>" } }, /not accepted/);
  refuse({ slug: "a", files: { "index.md": MD, "../up.png": new Uint8Array([0x89, 0x50, 0x4e, 0x47]) } }, /file names/);
  refuse({ slug: "a", files: { "index.md": MD, "x.png": "GIF89a" } }, /not a \.png/);
  refuse({ slug: "a", files: { "index.md": MD.replace("draft: false", "draft: false\nlayout: x") } }, /unknown front matter/);
  refuse({ slug: "a", files: { "index.md": "---\na: &x [1]\nb: *x\n---\n" } }, /YAML|unknown/);
  refuse({ slug: "a", files: { "index.md": "x".repeat(300 * 1024) } }, /over 256 KB/);
  refuse({ slug: "a", files: { "x.png": new Uint8Array([0x89, 0x50, 0x4e, 0x47]) } }, /index\.md is required/);
});

test("the git store commits a post and refuses a stale edit", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "git-store-"));
  try {
    const src = path.join(root, "src");
    fs.mkdirSync(src);
    execFileSync("git", ["init", "--quiet", "-b", "main", src]);
    fs.writeFileSync(path.join(src, "README.md"), "seed\n");
    execFileSync("git", ["-C", src, "add", "."]);
    execFileSync("git", ["-C", src, "-c", "user.name=T", "-c", "user.email=t@localhost", "commit", "--quiet", "-m", "seed"]);
    const { bare, editor } = setupGit(path.join(root, "store"), src);
    const first = publishGit(editor, { slug: "p", files: { "index.md": MD } });
    assert.equal(first.ok, true);
    assert.match(execFileSync("git", ["--git-dir", bare, "show", "main:posts/p/index.md"], { encoding: "utf8" }), /title: "T"/);
    const second = publishGit(editor, { slug: "p", files: { "index.md": MD.replace("Body.", "Edited.") }, baseCommit: first.commit });
    assert.equal(second.ok, true);
    const stale = publishGit(editor, { slug: "p", files: { "index.md": MD.replace("Body.", "Lost update.") }, baseCommit: first.commit });
    assert.equal(stale.ok, false);
    assert.equal(stale.status, 409);
    // baseCommit goes to git log: only a full commit id, never an option or a revision expression
    for (const baseCommit of ["--output=/tmp/x", "HEAD~1", first.commit.slice(0, 12), `${first.commit}..HEAD`, first.commit.toUpperCase(), 42]) {
      const odd = publishGit(editor, { slug: "p", files: { "index.md": MD.replace("Body.", "Odd.") }, baseCommit });
      assert.equal(odd.ok, false, String(baseCommit));
      assert.equal(odd.status, 422, String(baseCommit));
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
