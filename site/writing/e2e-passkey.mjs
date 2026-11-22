// End to end against the local Worker (cf dev on 5977): a real WebAuthn ceremony in Chrome with a
// CDP virtual authenticator, then publishing, then the cases that must fail.
//   PLAYWRIGHT=/path/to/playwright-core node writing/e2e-passkey.mjs
// Reads SETUP_TOKEN from writing/worker/.dev.vars and never prints it.
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT ?? "playwright-core");
const BASE = "http://localhost:5977";
const vars = Object.fromEntries(
  fs.readFileSync(path.join(import.meta.dirname, "worker/.dev.vars"), "utf8").split("\n").filter(Boolean).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
);
const results = [];
const check = async (name, fn) => {
  try {
    await fn();
    results.push(`pass  ${name}`);
  } catch (e) {
    results.push(`FAIL  ${name}: ${e.message}`);
  }
};

const browser = await chromium.launch({ channel: "chrome" });
const context = await browser.newContext();
const page = await context.newPage();
const cdp = await context.newCDPSession(page);
await cdp.send("WebAuthn.enable");
await cdp.send("WebAuthn.addVirtualAuthenticator", {
  options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
});
await page.goto(`${BASE}/edit`);
const out = () => page.locator("#out").textContent();
const fetchIn = (p, init) =>
  page.evaluate(async ([p, init]) => {
    const r = await fetch(p, init);
    return { status: r.status, body: await r.text() };
  }, [p, init]);

await check("publishing before sign-in is refused", async () => {
  const r = await fetchIn("/api/publish", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  assert.equal(r.status, 401);
});
await check("registration without the setup token is refused", async () => {
  const r = await fetchIn("/auth/register/options", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  assert.equal(r.status, 403);
});
await check("first passkey registers with the setup token", async () => {
  await page.fill("#setup", vars.SETUP_TOKEN);
  await page.click("#register");
  await page.waitForFunction(() => document.querySelector("#out").textContent.length > 0);
  assert.match(await out(), /"registered": true/);
});
await check("registration is closed once a passkey exists", async () => {
  await page.click("#register");
  await page.waitForFunction(() => /closed/.test(document.querySelector("#out").textContent));
});
await check("sign-in with the passkey sets a session", async () => {
  await page.click("#login");
  await page.waitForFunction(() => /Signed in as passkey:/.test(document.querySelector("#who").textContent));
  const cookies = await context.cookies(BASE);
  const c = cookies.find((x) => x.name === "__Host-edit");
  assert.ok(c && c.httpOnly && c.secure && c.sameSite === "Strict", "session cookie flags");
});
await check("a signed-in publish lands in D1", async () => {
  await page.fill("#slug", `spike-${Date.now()}`);
  await page.click("#publish");
  await page.waitForFunction(() => /"revision": 1/.test(document.querySelector("#out").textContent));
});
await check("a stale base revision is a conflict, not an overwrite", async () => {
  await page.click("#publish");
  await page.waitForFunction(() => /changed since you opened it/.test(document.querySelector("#out").textContent));
});
await check("bad slugs, path tricks, SVG and leaky sessions are refused", async () => {
  const send = (body) => fetchIn("/api/publish", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const md = '---\ntitle: "x"\ndate: 2026-11-16\nsummary: "x"\ndraft: false\n---\n';
  for (const body of [
    { slug: "../etc", files: { "index.md": { text: md } } },
    { slug: "ok", files: { "index.md": { text: md }, "../x.png": { base64: "iVBORw0KGgo=" } } },
    { slug: "ok", files: { "index.md": { text: md }, "x.svg": { text: "<svg onload=alert(1)>" } } },
    { slug: "ok", files: { "index.md": { text: md }, "x.png": { text: "<html>not a png" } } },
    { slug: "ok", files: { "index.md": { text: md }, "s.session.json": { text: JSON.stringify({ format: "ai-session/1", title: "t", people: [{ id: "h", name: "M" }], agents: [{ id: "a1", name: "C", model: "m", maker: "x" }], turns: [{ id: "t1", type: "prompt", by: "h", text: "see /Users/someone/x" }] }) } } },
    { slug: "ok", files: { "index.md": { text: "no front matter" } } },
  ]) {
    const r = await send(body);
    assert.equal(r.status, 422, `${JSON.stringify(body).slice(0, 80)} → ${r.status} ${r.body}`);
  }
});
await check("a cross-origin write is refused even with the cookie", async () => {
  const r = await page.request.post(`${BASE}/api/publish`, { headers: { origin: "https://evil.example", "content-type": "application/json" }, data: {} });
  assert.equal(r.status(), 403);
});
await check("a challenge works once", async () => {
  // Grab options (sets the challenge cookie), complete once, then replay the same response.
  const replay = await page.evaluate(async () => {
    const post = (p, b) => fetch(p, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b ?? {}) });
    const options = await (await post("/auth/login/options")).json();
    const cred = await navigator.credentials.get({ publicKey: PublicKeyCredential.parseRequestOptionsFromJSON(options) });
    const first = await post("/auth/login/verify", cred.toJSON());
    const second = await post("/auth/login/verify", cred.toJSON());
    return [first.status, second.status];
  });
  assert.deepEqual(replay, [200, 400]);
});
await check("the export needs the build token", async () => {
  const r = await page.request.get(`${BASE}/api/export`);
  assert.equal(r.status(), 401);
  const ok = await page.request.get(`${BASE}/api/export`, { headers: { authorization: `Bearer ${vars.BUILD_TOKEN}` } });
  assert.equal(ok.status(), 200);
});
await check("signing out ends the session", async () => {
  await page.click("#logout");
  const r = await fetchIn("/api/me");
  assert.equal(r.status, 401);
});

await browser.close();
console.log(results.join("\n"));
if (results.some((r) => r.startsWith("FAIL"))) process.exit(1);
