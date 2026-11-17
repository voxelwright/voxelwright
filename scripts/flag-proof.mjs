// npm run flag-proof -- <base> [--candidate <dir>] [--strict] [--try <flag>]
//
// Proves that a checkout builds the same site as <base>, file for file. A change that sits behind
// a flag that is off must pass; anything that leaks into the built site fails.
//
//   <base>             a commit or branch (default: main)
//   --candidate <dir>  the checkout to prove (default: this one). Run this script from a checkout
//                      you trust and point it at the one you do not: the candidate's own copy of
//                      this script, and its package.json scripts, are never used.
//   --strict           for a change made by an agent. Before anything from the candidate runs:
//                      it must be committed and descend from <base>; it may only add or change
//                      plain files in features/<name>/, and list flags as false in the `flags`
//                      literal of site.config.mjs. Nothing else may differ: not the Worker, not
//                      the deploy config, not package.json, not this script, not a test.
//   --try <flag>       after the proof passes, build the candidate once more with that flag on,
//                      in a sandbox, and say what it adds or changes. This is the only safe way
//                      to run a feature's code before the owner turns it on.
//
// The builds run with no network, an empty environment, and (on macOS) write access to one
// temporary folder only. Exit 0: identical. Exit 1: different, or a strict rule broken.
// Exit 2: could not run.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { FLAG_NAME } from "../lib/flags.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const stop = (code, message) => { console.error(message); process.exit(code); };

// ---- arguments
const argv = process.argv.slice(2);
const opts = { base: null, candidate: ROOT, strict: false, try: null };
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--strict") opts.strict = true;
  else if (a === "--candidate" || a === "--try") {
    const v = argv[++i];
    if (!v || v.startsWith("-")) stop(2, `flag-proof: ${a} needs a value.`);
    if (a === "--candidate") opts.candidate = path.resolve(v); else opts.try = v;
  } else if (a.startsWith("-") || opts.base !== null) stop(2, `flag-proof: "${a}" is not something this takes. Usage: flag-proof <base> [--candidate <dir>] [--strict] [--try <flag>]`);
  else opts.base = a;
}
opts.base ??= "main";
if (opts.try !== null && !FLAG_NAME.test(opts.try)) stop(2, `flag-proof: "${opts.try}" is not a flag name.`);

const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8", maxBuffer: 1 << 28 }).replace(/\n$/, "");
const tryGit = (cwd, ...args) => { try { return git(cwd, ...args); } catch { return null; } };

const cand = opts.candidate;
if (!fs.existsSync(cand) || !fs.statSync(cand).isDirectory()) stop(2, `flag-proof: no folder at ${cand}.`);
const base = tryGit(ROOT, "rev-parse", "--verify", "--quiet", `${opts.base}^{commit}`);
if (!base) stop(2, `flag-proof: no commit named "${opts.base}".`);
const head = tryGit(cand, "rev-parse", "--verify", "--quiet", "HEAD^{commit}");
if (!head) stop(2, `flag-proof: ${cand} is not a git checkout.`);
if (tryGit(ROOT, "cat-file", "-t", head) !== "commit") stop(2, `flag-proof: ${cand} is not a checkout of this repository.`);
const dirty = git(cand, "status", "--porcelain") !== "";
const what = `${head.slice(0, 12)}${dirty ? " plus uncommitted edits" : ""} against ${base.slice(0, 12)}`;

// ---- strict: read the change before running any of it
if (opts.strict) {
  const broken = strictProblems();
  if (broken.length) stop(1, `flag-proof: NOT ALLOWED. ${what}:\n  ${broken.slice(0, 40).join("\n  ")}${broken.length > 40 ? `\n  and ${broken.length - 40} more` : ""}`);
}

function strictProblems() {
  const out = [];
  if (dirty) out.push("the candidate has uncommitted or untracked files: commit the change, and nothing else, first");
  if (tryGit(ROOT, "merge-base", "--is-ancestor", base, head) === null) out.push("the candidate does not descend from the base");
  const changed = git(ROOT, "diff", "--name-only", "--no-renames", "-z", base, head).split("\0").filter(Boolean);
  for (const file of changed) {
    if (file === "site.config.mjs") continue;
    const m = file.match(/^features\/([^/]+)\/.+/);
    if (!m || !FLAG_NAME.test(m[1])) out.push(`changed outside a feature folder: ${file}`);
  }
  // only plain files in features/: no links, no executables, no submodules
  for (const line of git(ROOT, "ls-tree", "-r", "-z", head, "--", "features").split("\0").filter(Boolean)) {
    const [meta, file] = line.split("\t");
    if (!meta.startsWith("100644 ") && changed.includes(file)) out.push(`not a plain file: ${file}`);
  }
  if (changed.includes("site.config.mjs")) out.push(...configProblems(git(ROOT, "show", `${base}:site.config.mjs`), git(ROOT, "show", `${head}:site.config.mjs`)));
  return out;
}

/** site.config.mjs may differ only inside its one-line `flags: { … }` literal, and only by new names set to false. */
function configProblems(before, after) {
  const literal = /\bflags:\s*\{([^{}\n]*)\}/g;
  const one = (text) => { const all = [...text.matchAll(literal)]; return all.length === 1 ? all[0] : null; };
  const a = one(before), b = one(after);
  if (!a || !b) return ["site.config.mjs: there must be exactly one `flags: { … }` literal, on one line"];
  if (before.replace(a[0], "flags: {}") !== after.replace(b[0], "flags: {}")) return ["site.config.mjs: changed outside the `flags` literal"];
  const entries = (inner) => {
    const map = new Map();
    for (const part of inner.split(",").map((s) => s.trim()).filter(Boolean)) {
      const m = part.match(/^"([^"]+)":\s*(true|false)$/);
      if (!m || !FLAG_NAME.test(m[1]) || map.has(m[1])) return null;
      map.set(m[1], m[2]);
    }
    return map;
  };
  const was = entries(a[1]), now = entries(b[1]);
  if (!was || !now) return ['site.config.mjs: each flag is written "name": true or "name": false, once'];
  const out = [];
  for (const [name, value] of was) if (now.get(name) !== value) out.push(`site.config.mjs: the flag "${name}" was changed or removed`);
  for (const [name, value] of now) if (!was.has(name) && value !== "false") out.push(`site.config.mjs: the new flag "${name}" must be false`);
  return out;
}

// ---- build both, shut in
const canSandbox = process.platform === "darwin" && fs.existsSync("/usr/bin/sandbox-exec");
if (!canSandbox && opts.try) stop(2, "flag-proof: --try runs the feature's own code, and this system has no sandbox to run it in (it needs macOS sandbox-exec). Not run.");
const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "flag-proof-")));
let keep = false;
let code = 2;
try {
  const exportTree = (commit, name) => {
    const dir = path.join(tmp, name);
    fs.mkdirSync(dir);
    execFileSync("tar", ["-x", "-C", dir], { input: execFileSync("git", ["archive", commit], { cwd: ROOT, maxBuffer: 1 << 30 }) });
    fs.symlinkSync(path.join(ROOT, "node_modules"), path.join(dir, "node_modules")); // the trusted checkout's packages
    return dir;
  };
  const baseDir = exportTree(base, "base");
  // A committed candidate is built from a clean export of its commit; one with loose edits is built where it stands.
  const candDir = dirty ? cand : exportTree(head, "candidate");

  const sandbox = canSandbox ? sandboxFor(tmp) : null;
  const env = { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: tmp, TMPDIR: tmp, LANG: process.env.LANG ?? "C" };
  const run = (cwd, outDir, on = null) => {
    const script = `import { build } from "./generator/build.mjs";
const site = (await import("./site.config.mjs")).default;
const on = process.argv[2];
await build({ outDir: process.argv[1], site: on ? { ...site, flags: { ...(site.flags ?? {}), [on]: true } } : site });`;
    const node = [process.execPath, "--input-type=module", "-e", script, outDir, ...(on ? [on] : [])];
    const [bin, ...args] = sandbox ? ["/usr/bin/sandbox-exec", "-p", sandbox, ...node] : node;
    execFileSync(bin, args, { cwd, env, stdio: ["ignore", "ignore", "inherit"] });
  };
  const outBase = path.join(tmp, "out-base");
  const outHere = path.join(tmp, "out-candidate");
  run(baseDir, outBase);
  run(candDir, outHere);

  const differences = [];
  // Without --strict the candidate may change package.json (a new script, say), but not what is installed.
  const deps = (dir) => {
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
    return JSON.stringify([pkg.dependencies ?? {}, pkg.devDependencies ?? {}, pkg.optionalDependencies ?? {}, pkg.peerDependencies ?? {}]);
  };
  if (deps(baseDir) !== deps(candDir)) differences.push("dependencies in package.json differ from the base");
  const lock = (dir) => (fs.existsSync(path.join(dir, "package-lock.json")) ? hash(path.join(dir, "package-lock.json")) : null);
  if (lock(baseDir) !== lock(candDir)) differences.push("package-lock.json differs from the base");
  differences.push(...compare(listing(outBase), listing(outHere), ["missing:  ", "changed:  ", "added:    "]));

  const how = `${sandbox ? "sandboxed" : "NOT sandboxed (no sandbox-exec on this system)"}${opts.strict ? ", strict" : ""}`;
  if (differences.length) {
    console.error(`flag-proof: DIFFERENT. ${what} (${how}):\n  ${differences.slice(0, 40).join("\n  ")}${differences.length > 40 ? `\n  and ${differences.length - 40} more` : ""}`);
    code = 1;
  } else {
    console.log(`flag-proof: identical. ${what} (${how}): ${listing(outBase).size} files, same names and same bytes; dependencies unchanged.`);
    code = 0;
    if (opts.try) {
      const outTry = path.join(tmp, "out-try");
      run(candDir, outTry, opts.try);
      const delta = compare(listing(outHere), listing(outTry), ["removes:  ", "changes:  ", "adds:     "]);
      keep = true;
      console.log(`flag-proof: with "${opts.try}" on, the site ${delta.length ? `differs in ${delta.length} file${delta.length === 1 ? "" : "s"}:\n  ${delta.slice(0, 60).join("\n  ")}${delta.length > 60 ? `\n  and ${delta.length - 60} more` : ""}` : "is still identical: the flag changes nothing"}`);
      console.log(`Built in ${outTry} for you to read. Delete ${tmp} when you are done.`);
    }
  }
} catch (e) {
  console.error(`flag-proof: could not run: ${e.message}`);
  code = 2;
} finally {
  if (!keep) fs.rmSync(tmp, { recursive: true, force: true });
}
process.exit(code);

/** A macOS sandbox profile: no network, writes only under dir, a few private folders unreadable. */
function sandboxFor(dir) {
  const q = (p) => JSON.stringify(p);
  const home = os.homedir();
  const secret = [".ssh", ".aws", ".gnupg", ".config", ".npmrc", ".netrc", "Library/Keychains"].map((p) => `(subpath ${q(path.join(home, p))})`).join(" ");
  return `(version 1)
(allow default)
(deny network*)
(deny file-write*)
(allow file-write* (subpath ${q(dir)}) (literal "/dev/null") (literal "/dev/stdout") (literal "/dev/stderr") (literal "/dev/tty") (literal "/dev/dtracehelper"))
(deny file-read* ${secret})`;
}

function hash(file) {
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

/** Map of relative path → sha256 for every file under dir. Links are recorded, not followed. */
function listing(dir, rel = "", out = new Map()) {
  for (const entry of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
    const next = path.join(rel, entry.name);
    if (entry.isDirectory()) listing(dir, next, out);
    else if (entry.isSymbolicLink()) out.set(next, "link:" + fs.readlinkSync(path.join(dir, next)));
    else out.set(next, hash(path.join(dir, next)));
  }
  return out;
}

function compare(a, b, [gone, changed, added]) {
  const out = [];
  for (const [rel, sum] of a) {
    if (!b.has(rel)) out.push(gone + rel);
    else if (b.get(rel) !== sum) out.push(changed + rel);
  }
  for (const rel of b.keys()) if (!a.has(rel)) out.push(added + rel);
  return out;
}
