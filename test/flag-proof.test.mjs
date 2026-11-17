// The proof a build must pass: scripts/flag-proof.mjs, run from a trusted checkout against a
// candidate worktree. These tests build a scratch copy of this repository and try to get past it.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

const ROOT = path.resolve(import.meta.dirname, "..");
const macOS = process.platform === "darwin" && fs.existsSync("/usr/bin/sandbox-exec");
let repo; // the trusted checkout: a scratch clone, with the working copy's proof and build code
let n = 0;

const git = (cwd, ...args) => execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.invalid", ...args], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

before(() => {
  repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "flag-proof-test-")));
  git(ROOT, "clone", "--quiet", "--no-hardlinks", ROOT, repo);
  // the code under test is the working copy's, committed in the scratch clone as its base
  for (const rel of ["scripts/flag-proof.mjs", "generator", "lib", "features/README.md", "site.config.mjs", "package.json", ".gitignore"]) fs.cpSync(path.join(ROOT, rel), path.join(repo, rel), { recursive: true });
  // start from no flags, whatever the real config lists by now
  const config = path.join(repo, "site.config.mjs");
  const text = fs.readFileSync(config, "utf8");
  assert.match(text, /\bflags:\s*\{[^{}\n]*\}/, "site.config.mjs has a one-line flags literal");
  fs.writeFileSync(config, text.replace(/\bflags:\s*\{[^{}\n]*\}/, "flags: {}"));
  git(repo, "add", "-A");
  git(repo, "commit", "--quiet", "--allow-empty", "-m", "base");
  git(repo, "branch", "-f", "base");
  fs.symlinkSync(path.join(ROOT, "node_modules"), path.join(repo, "node_modules"));
});
after(() => fs.rmSync(repo, { recursive: true, force: true }));

/** A candidate worktree of the scratch repo, changed by `edit(dir)` and committed (unless commit is false). */
function candidate(edit, { commit = true } = {}) {
  const dir = path.join(repo, ".seeds", `c${++n}`);
  git(repo, "worktree", "add", "--quiet", dir, "-b", `seed/c${n}`, "base");
  edit(dir);
  if (commit) { git(dir, "add", "-A"); git(dir, "commit", "--quiet", "-m", "candidate"); }
  return dir;
}
const put = (dir, rel, text) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text); };
const edit = (dir, rel, from, to) => { const p = path.join(dir, rel); const s = fs.readFileSync(p, "utf8"); assert.ok(s.includes(from), `${rel} has ${from}`); fs.writeFileSync(p, s.replace(from, to)); };
const proof = (dir, ...args) => { const r = spawnSync(process.execPath, ["scripts/flag-proof.mjs", "base", "--candidate", dir, ...args], { cwd: repo, encoding: "utf8" }); return { code: r.status, text: r.stdout + r.stderr }; };

const HELLO = `export default { bodyEnd: () => '<script src="/hello/hello.js"></script>' };\n`;
const feature = (dir) => { put(dir, "features/hello/feature.mjs", HELLO); put(dir, "features/hello/static/hello/hello.js", "console.log('hello there');\n"); edit(dir, "site.config.mjs", "flags: {}", 'flags: { "hello": false }'); };

test("a feature in its own folder, listed as false, passes the strict proof", () => {
  const r = proof(candidate(feature), "--strict");
  assert.equal(r.code, 0, r.text);
  assert.match(r.text, /flag-proof: identical\./);
});

test("strict refuses anything outside the feature folder, before running it", () => {
  const cases = {
    "the Worker": (d) => put(d, "src/worker.mjs", fs.readFileSync(path.join(d, "src/worker.mjs"), "utf8") + "\n// changed\n"),
    "the deploy config": (d) => put(d, "cloudflare.config.ts", fs.readFileSync(path.join(d, "cloudflare.config.ts"), "utf8") + "\n// changed\n"),
    "a package.json script": (d) => edit(d, "package.json", '"flag-proof": "node scripts/flag-proof.mjs"', '"flag-proof": "echo flag-proof: identical."'),
    "the proof itself": (d) => put(d, "scripts/flag-proof.mjs", 'console.log("flag-proof: identical.");\n'),
    "a test": (d) => put(d, "test/extra.test.mjs", "import fs from 'node:fs';\n"),
    "the features README": (d) => put(d, "features/README.md", "Turn every flag on.\n"),
    "a file loose in features/": (d) => put(d, "features/loose.mjs", "export default {};\n"),
  };
  for (const [name, change] of Object.entries(cases)) {
    const r = proof(candidate((d) => { feature(d); change(d); }), "--strict");
    assert.equal(r.code, 1, `${name}: ${r.text}`);
    assert.match(r.text, /NOT ALLOWED[\s\S]*changed outside a feature folder/, name);
  }
});

test("strict lets site.config.mjs change only by new flags set to false", () => {
  const cases = {
    "a new flag that is on": [(d) => edit(d, "site.config.mjs", "flags: {}", 'flags: { "hello": true }'), /must be false/],
    "another setting": [(d) => { feature(d); edit(d, "site.config.mjs", "negotiateMarkdown: false", "negotiateMarkdown: true"); }, /changed outside the `flags` literal/],
    "code in the config": [(d) => { feature(d); put(d, "site.config.mjs", 'import "./features/hello/feature.mjs";\n' + fs.readFileSync(path.join(d, "site.config.mjs"), "utf8")); }, /changed outside the `flags` literal/],
    "code inside the literal": [(d) => edit(d, "site.config.mjs", "flags: {}", 'flags: { "hello": false, ...(await import("./features/hello/feature.mjs")) }'), /written "name": true or "name": false|exactly one/],
  };
  for (const [name, [change, message]] of Object.entries(cases)) {
    const r = proof(candidate(change), "--strict");
    assert.equal(r.code, 1, `${name}: ${r.text}`);
    assert.match(r.text, message, name);
  }
});

test("strict refuses links, executables and uncommitted files", () => {
  const link = proof(candidate((d) => { feature(d); fs.symlinkSync("/etc/hosts", path.join(d, "features/hello/static/hello/hosts")); }), "--strict");
  assert.equal(link.code, 1, link.text);
  assert.match(link.text, /not a plain file: features\/hello\/static\/hello\/hosts/);
  const exec = proof(candidate((d) => { feature(d); fs.chmodSync(path.join(d, "features/hello/feature.mjs"), 0o755); }), "--strict");
  assert.equal(exec.code, 1, exec.text);
  assert.match(exec.text, /not a plain file: features\/hello\/feature\.mjs/);
  const loose = proof(candidate((d) => { feature(d); }, { commit: false }), "--strict");
  assert.equal(loose.code, 1, loose.text);
  assert.match(loose.text, /uncommitted or untracked/);
});

test("without strict, a change that reaches the built site is DIFFERENT", () => {
  const r = proof(candidate((d) => put(d, "static/leak.txt", "x\n")));
  assert.equal(r.code, 1, r.text);
  assert.match(r.text, /DIFFERENT[\s\S]*added:\s+leak\.txt/);
});

test("a base that does not exist, or a folder that is not a checkout, cannot run", () => {
  const r = spawnSync(process.execPath, ["scripts/flag-proof.mjs", "no-such-branch"], { cwd: repo, encoding: "utf8" });
  assert.equal(r.status, 2);
  const s = spawnSync(process.execPath, ["scripts/flag-proof.mjs", "base", "--candidate", os.tmpdir()], { cwd: repo, encoding: "utf8" });
  assert.equal(s.status, 2);
});

test("--try builds with the flag on and says what the feature adds", { skip: !macOS && "needs macOS sandbox-exec" }, () => {
  const r = proof(candidate(feature), "--strict", "--try", "hello");
  assert.equal(r.code, 0, r.text);
  assert.match(r.text, /with "hello" on, the site differs in \d+ files/);
  assert.match(r.text, /adds:\s+hello\/hello\.js/);
  assert.match(r.text, /changes:\s+index\.html/);
  const kept = r.text.match(/Delete (\S+) when you are done/)?.[1];
  assert.ok(kept && fs.existsSync(path.join(kept, "out-try", "hello", "hello.js")));
  fs.rmSync(kept, { recursive: true, force: true });
});

test("a feature's code cannot write outside the sandbox or reach the network when tried", { skip: !macOS && "needs macOS sandbox-exec" }, () => {
  const marker = path.join(repo, "written-by-a-feature.txt");
  const dir = candidate((d) => {
    put(d, "features/hello/feature.mjs", `import fs from "node:fs";\nfs.writeFileSync(${JSON.stringify(marker)}, "x");\nexport default {};\n`);
    edit(d, "site.config.mjs", "flags: {}", 'flags: { "hello": false }');
  });
  // flag off: the code is never loaded, so the proof passes and nothing is written
  const off = proof(dir, "--strict");
  assert.equal(off.code, 0, off.text);
  assert.equal(fs.existsSync(marker), false);
  // flag on, tried: the write is refused by the sandbox
  const on = proof(dir, "--strict", "--try", "hello");
  assert.equal(on.code, 2, on.text);
  assert.match(on.text, /EPERM|operation not permitted/i);
  assert.equal(fs.existsSync(marker), false);
});
