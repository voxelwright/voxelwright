// Publish-to-built latency for both stores, measured to the same end point: the write is
// accepted, and the generator's output contains the post.
//   cf dev running in writing/worker on 5977 with a FRESH persist dir (registration must be open)
//   PLAYWRIGHT=/path/to/playwright-core node writing/bench.mjs <scratch dir> [runs]
// Deploy (cf deploy, GitHub Actions queueing) is not measured here: see the estimates in
// notes/writing-store-auth.md.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { build } from "../generator/build.mjs";
import { setupGit, publishGit } from "./store-git.mjs";

const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT ?? "playwright-core");
const ROOT = path.resolve(import.meta.dirname, "..");
const scratch = process.argv[2] ?? fs.mkdtempSync(path.join(os.tmpdir(), "writing-bench-"));
const RUNS = Number(process.argv[3] ?? 5);
const BASE = "http://localhost:5977";
const vars = Object.fromEntries(fs.readFileSync(path.join(import.meta.dirname, "worker/.dev.vars"), "utf8").split("\n").filter(Boolean).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
const SITE = { ...(await import("../site.config.mjs")).default, title: "Bench", author: "Bench" };
const session = fs.readFileSync(path.join(ROOT, "posts/ai-sessions-as-blocks/decision-sample.session.json"), "utf8");
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

const post = (slug, n) => ({
  slug,
  files: {
    "index.md": `---\ntitle: "Bench ${n}"\ndate: 2026-11-16\nsummary: "Benchmark post ${n}."\ntags: [bench]\ndraft: false\n---\n\nRun ${n}.\n\n![A pixel](pixel.png)\n\n<ai-session src="s.session.json">\n`,
    "s.session.json": session,
    "pixel.png": PNG,
  },
});
const ms = (t) => Math.round(performance.now() - t);
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const built = (out, slug) => fs.existsSync(path.join(out, "blog", slug, "index.html"));

// ---- git ------------------------------------------------------------------------
const gitRoot = path.join(scratch, "git");
const { bare, editor } = setupGit(gitRoot, ROOT);
const builder = path.join(gitRoot, "git-builder");
execFileSync("git", ["clone", "--quiet", bare, builder]);
const git = { write: [], build: [] };
for (let i = 0; i < RUNS; i++) {
  const slug = `bench-git-${i}`;
  const t0 = performance.now();
  const r = publishGit(editor, post(slug, i));
  if (!r.ok) throw new Error(`git publish: ${r.errors.join("; ")}`);
  git.write.push(ms(t0));
  // The CI side: fetch the new commit and build from the checkout.
  execFileSync("git", ["-C", builder, "pull", "--quiet", "--ff-only"]);
  const out = path.join(gitRoot, "out");
  await build({ outDir: out, postsDir: path.join(builder, "posts"), site: SITE });
  if (!built(out, slug)) throw new Error("git: post missing from the build");
  git.build.push(ms(t0));
}

// ---- D1/R2 --------------------------------------------------------------------------
const browser = await chromium.launch({ channel: "chrome" });
const page = await (await browser.newContext()).newPage();
const cdp = await page.context().newCDPSession(page);
await cdp.send("WebAuthn.enable");
await cdp.send("WebAuthn.addVirtualAuthenticator", { options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
await page.goto(`${BASE}/edit`);
await page.fill("#setup", vars.SETUP_TOKEN);
await page.click("#register");
await page.waitForFunction(() => /registered|closed/.test(document.querySelector("#out").textContent));
if (/closed/.test(await page.locator("#out").textContent())) throw new Error("restart cf dev with a fresh --persist-to: registration is closed");
await page.click("#login");
await page.waitForFunction(() => /Signed in/.test(document.querySelector("#who").textContent));

const d1 = { write: [], build: [] };
const exportDir = path.join(scratch, "d1");
for (let i = 0; i < RUNS; i++) {
  const slug = `bench-d1-${i}-${Date.now()}`;
  const p = post(slug, i);
  const files = Object.fromEntries(Object.entries(p.files).map(([k, v]) => [k, Buffer.isBuffer(v) ? { base64: v.toString("base64") } : { text: v }]));
  const t0 = performance.now();
  const res = await page.evaluate(async (body) => {
    const r = await fetch("/api/publish", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    return { status: r.status, body: await r.text() };
  }, { slug, baseRevision: 0, files });
  if (res.status !== 200) throw new Error(`d1 publish: ${res.status} ${res.body}`);
  d1.write.push(ms(t0));
  // The builder: export everything, fetch blobs it lacks, build.
  const auth = { authorization: `Bearer ${vars.BUILD_TOKEN}` };
  const { posts } = await (await fetch(`${BASE}/api/export`, { headers: auth })).json();
  const postsDir = path.join(exportDir, "posts");
  const cache = path.join(exportDir, "blobs");
  fs.mkdirSync(cache, { recursive: true });
  fs.rmSync(postsDir, { recursive: true, force: true });
  for (const p of posts) {
    const dir = path.join(postsDir, p.slug);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "index.md"), p.index_md);
    for (const [name, f] of Object.entries(p.files)) {
      const blob = path.join(cache, f.sha256);
      if (!fs.existsSync(blob)) fs.writeFileSync(blob, Buffer.from(await (await fetch(`${BASE}/api/blob/${f.sha256}`, { headers: auth })).arrayBuffer()));
      fs.copyFileSync(blob, path.join(dir, name));
    }
  }
  const out = path.join(exportDir, "out");
  await build({ outDir: out, postsDir, site: SITE });
  if (!built(out, slug)) throw new Error("d1: post missing from the build");
  d1.build.push(ms(t0));
}
await browser.close();

const row = (name, s) => `${name.padEnd(8)} write accepted: median ${median(s.write)} ms (${s.write.join(", ")})   built: median ${median(s.build)} ms (${s.build.join(", ")})`;
console.log(row("git", git));
console.log(row("D1/R2", d1));
