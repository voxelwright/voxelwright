// The D1/R2 store and its auth, as one Worker. Local only: `cf dev --local` in this folder.
//
//   GET  /edit                  a bare page to set up a passkey, sign in and publish a test post
//   POST /auth/register/options|verify   first passkey only (needs X-Setup-Token)
//   POST /auth/login/options|verify      sign in with the passkey
//   POST /auth/logout
//   GET  /api/me                who is signed in
//   POST /api/publish           { slug, baseRevision, files: { name: { text } | { base64 } } }
//   GET  /api/export            every post's index.md and file list   (Authorization: Bearer BUILD_TOKEN)
//   GET  /api/blob/<sha256>     one file's bytes                       (same)
//
// Posts live in D1 (index.md, the file list, every revision); files live in R2 under their
// SHA-256, so a revision is just a list of hashes and old revisions cost nothing extra.
import { checkSubmission } from "../../core.mjs";
import * as auth from "./auth.mjs";
import { EDIT_HTML, EDIT_JS } from "./edit-page.mjs";

const SCHEMA = [
  "CREATE TABLE IF NOT EXISTS posts (slug TEXT PRIMARY KEY, index_md TEXT NOT NULL, files TEXT NOT NULL, revision INTEGER NOT NULL, updated_at TEXT NOT NULL, updated_by TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS revisions (slug TEXT NOT NULL, revision INTEGER NOT NULL, index_md TEXT NOT NULL, files TEXT NOT NULL, created_at TEXT NOT NULL, created_by TEXT NOT NULL, PRIMARY KEY (slug, revision))",
  "CREATE TABLE IF NOT EXISTS credentials (id TEXT PRIMARY KEY, public_key BLOB NOT NULL, counter INTEGER NOT NULL, transports TEXT NOT NULL, created_at TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS challenges (id TEXT PRIMARY KEY, challenge TEXT NOT NULL, kind TEXT NOT NULL, expires_at INTEGER NOT NULL)",
  "CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, credential_id TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL)",
];
let ready = null;
const migrate = (env) => (ready ??= env.DB.batch(SCHEMA.map((s) => env.DB.prepare(s))));

const SECURITY = {
  "content-security-policy": "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "cache-control": "no-store",
};

function json(status, body, headers = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", ...SECURITY, ...headers } });
}

async function readJson(req, max = 40 * 1024 * 1024) {
  if (!(req.headers.get("content-type") ?? "").startsWith("application/json")) throw new Error("send application/json");
  const length = Number(req.headers.get("content-length") ?? 0);
  if (length > max) throw new Error("request too large");
  const text = await req.text();
  if (text.length > max) throw new Error("request too large");
  return JSON.parse(text);
}

async function hashHex(bytes) {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function publish(env, writer, body) {
  const files = {};
  for (const [name, f] of Object.entries(body?.files ?? {})) {
    if (typeof f?.text === "string") files[name] = f.text;
    else if (typeof f?.base64 === "string") files[name] = auth.b64url.decode(f.base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""));
    else return [400, { errors: [`${name}: send { text } or { base64 }`] }];
  }
  const checked = checkSubmission({ slug: body?.slug, files });
  if (!checked.ok) return [422, { errors: checked.errors }];
  const { slug } = checked.post;

  const current = await env.DB.prepare("SELECT revision FROM posts WHERE slug = ?").bind(slug).first();
  const base = body.baseRevision ?? 0;
  if ((current?.revision ?? 0) !== base) return [409, { error: "the post changed since you opened it", revision: current?.revision ?? 0 }];

  const list = {};
  for (const [name, bytes] of Object.entries(checked.post.files)) {
    if (name === "index.md") continue;
    const sha = await hashHex(bytes);
    if (!(await env.FILES.head(`blobs/${sha}`))) await env.FILES.put(`blobs/${sha}`, bytes);
    list[name] = { sha256: sha, size: bytes.length };
  }
  const md = new TextDecoder().decode(checked.post.files["index.md"]);
  const revision = base + 1;
  const now = new Date().toISOString();
  const filesJson = JSON.stringify(list);
  // The revision row and the post row commit together; the WHERE on the post keeps a racing
  // publish from overwriting this one.
  const [rev, post] = await env.DB.batch([
    env.DB.prepare("INSERT INTO revisions (slug, revision, index_md, files, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?)").bind(slug, revision, md, filesJson, now, writer),
    base === 0
      ? env.DB.prepare("INSERT INTO posts (slug, index_md, files, revision, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?)").bind(slug, md, filesJson, revision, now, writer)
      : env.DB.prepare("UPDATE posts SET index_md = ?, files = ?, revision = ?, updated_at = ?, updated_by = ? WHERE slug = ? AND revision = ?").bind(md, filesJson, revision, now, writer, slug, base),
  ]);
  if (!post.meta.changes) return [409, { error: "the post changed while publishing" }];
  return [200, { slug, revision, files: Object.keys(list).length + 1, at: now }];
}

export default {
  async fetch(req, env) {
    await migrate(env);
    const url = new URL(req.url);
    const path = url.pathname;
    const send = ([status, body, headers]) => json(status, body, headers);

    if (req.method === "GET" && (path === "/edit" || path === "/edit/")) {
      return new Response(EDIT_HTML, { headers: { "content-type": "text/html; charset=utf-8", ...SECURITY } });
    }
    if (req.method === "GET" && path === "/edit.js") {
      return new Response(EDIT_JS, { headers: { "content-type": "text/javascript; charset=utf-8", ...SECURITY } });
    }

    // The builder's read path: a separate bearer token, read-only.
    if (req.method === "GET" && (path === "/api/export" || path.startsWith("/api/blob/"))) {
      const bearer = (req.headers.get("authorization") ?? "").replace(/^Bearer /, "");
      if (!(await auth.same(bearer, env.BUILD_TOKEN ?? ""))) return json(401, { error: "build token required" });
      if (path === "/api/export") {
        const { results } = await env.DB.prepare("SELECT slug, index_md, files, revision, updated_at FROM posts ORDER BY slug").all();
        return json(200, { posts: results.map((r) => ({ ...r, files: JSON.parse(r.files) })) });
      }
      const sha = path.slice("/api/blob/".length);
      if (!/^[a-f0-9]{64}$/.test(sha)) return json(400, { error: "bad hash" });
      const obj = await env.FILES.get(`blobs/${sha}`);
      return obj ? new Response(obj.body, { headers: { "content-type": "application/octet-stream", ...SECURITY } }) : json(404, { error: "no such file" });
    }

    if (req.method !== "POST" && path !== "/api/me") return json(405, { error: "method not allowed" });
    // Every state change comes from the editor's own page.
    if (req.method === "POST" && !auth.originOk(req, env)) return json(403, { error: "cross-origin request refused" });

    try {
      if (env.AUTH_MODE !== "access") {
        if (path === "/auth/register/options") return send(await auth.registerOptions(req, env));
        if (path === "/auth/register/verify") return send(await auth.registerVerify(req, env, await readJson(req, 64 * 1024)));
        if (path === "/auth/login/options") return send(await auth.loginOptions(req, env));
        if (path === "/auth/login/verify") return send(await auth.loginVerify(req, env, await readJson(req, 64 * 1024)));
        if (path === "/auth/logout") return send(await auth.logout(req, env));
      }
      const writer = await auth.who(req, env);
      if (path === "/api/me") return writer ? json(200, { writer }) : json(401, { error: "sign in first" });
      if (!writer) return json(401, { error: "sign in first" });
      if (path === "/api/publish") return send(await publish(env, writer, await readJson(req)));
      return json(404, { error: "not found" });
    } catch (e) {
      return json(400, { error: e.message });
    }
  },
};
