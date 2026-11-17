// Spike tests that need no running Worker: the Access JWT check, the write-path gate, and the
// git store's conflict handling.   node --test writing/spike.test.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { verifyAccessJwt, b64url } from "./worker/src/auth.mjs";
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
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
