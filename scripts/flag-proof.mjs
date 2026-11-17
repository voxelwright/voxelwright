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
//                      plain files in features/<name>/ for features whose flag is off, and list
//                      new flags as false in the `flags` literal of site.config.mjs. Nothing else may differ: not the Worker, not
//                      the deploy config, not package.json, not this script, not a test.
//   --try <flag>       after the proof passes, build the candidate once more with that flag on,
//                      in a sandbox, and say what it adds or changes. This is the only safe way
//                      to run a feature's code before the owner turns it on.
//
// The candidate must be this checkout or a worktree added from it. git is never run inside the
// candidate, and never finds a repository through the candidate's own .git: which commit it is
// on is read from this repository's record of its worktrees.
//
// The builds run with no network and an empty environment, and are stopped after two minutes. On
// macOS they are also shut in a sandbox: they write to one temporary folder only, read only that
// folder, the installed packages and the system's own libraries, start no other process, open no
// terminal, load no native code of their own and signal no other process. (A build can still learn
// the account's name, the machine's name and its network addresses.) What a build prints is
// never passed through: on a failure it is quoted, marked as data. Every name and message that
// comes from the candidate is printed in quotes, with anything but plain ASCII escaped.
// Exit 0: identical. Exit 1: different, or a strict rule broken. Exit 2: could not run.
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { builtinModules } from "node:module";
import os from "node:os";
import path from "node:path";
import { FLAG_NAME } from "../lib/flags.mjs";
import { GIT_ENV, GIT_SAFE, git, linkIntact, recordOf, tryGit } from "../lib/worktree.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const stop = (code, message) => { console.error(message); process.exit(code); };
// For anything the candidate chose. A newline stays inside the quotes; so does every other
// character that could break a line, steer a terminal or reorder the text (U+2028, NEL, CSI, RLO).
const quote = (s) => JSON.stringify(String(s)).replace(/[^\x20-\x7e]/g, (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));
// An error this script did not expect may carry a path the candidate named: quote it too.
process.on("uncaughtException", (e) => { console.error(`flag-proof: could not run: ${quote(e?.message ?? e)}`); process.exit(2); });

/** The one-line `flags: { … }` literal of site.config.mjs, and its entries: "name": true | false, each once. */
const FLAGS_LITERAL = /\bflags:\s*\{([^{}\n]*)\}/g;
function flagEntries(inner) {
  const map = new Map();
  for (const part of inner.split(",").map((s) => s.trim()).filter(Boolean)) {
    const m = part.match(/^"([^"]+)":\s*(true|false)$/);
    if (!m || !FLAG_NAME.test(m[1]) || map.has(m[1])) return null;
    map.set(m[1], m[2]);
  }
  return map;
}

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
  } else if (a.startsWith("-") || opts.base !== null) stop(2, `flag-proof: ${quote(a)} is not something this takes. Usage: flag-proof <base> [--candidate <dir>] [--strict] [--try <flag>]`);
  else opts.base = a;
}
opts.base ??= "main";
if (opts.try !== null && !FLAG_NAME.test(opts.try)) stop(2, `flag-proof: ${quote(opts.try)} is not a flag name.`);

// What git and tar print is never passed through either: on a failure it ends up, quoted, in the error.
const PIPED = ["pipe", "pipe", "pipe"];

if (!fs.existsSync(opts.candidate) || !fs.statSync(opts.candidate).isDirectory()) stop(2, `flag-proof: no folder at ${quote(opts.candidate)}.`);
const cand = fs.realpathSync(opts.candidate);
const base = tryGit(ROOT, "rev-parse", "--verify", "--quiet", `${opts.base}^{commit}`);
if (!base) stop(2, `flag-proof: no commit named ${quote(opts.base)}.`);

// ---- which commit the candidate is on
// git is never run inside the candidate, never finds a repository through it, and never takes a
// command from the owner's global settings on the candidate's say-so (see lib/worktree.mjs). The
// candidate's .git, a repository nested in it, a .gitattributes: each can name a command for git
// to run, and it would run here, outside any sandbox, before a single check.
const record = recordOf(ROOT, cand);
if (!record) stop(2, `flag-proof: ${quote(cand)} is not this checkout or a worktree added from it (git worktree add).`);
const gitOf = (...args) => git(ROOT, `--git-dir=${record}`, `--work-tree=${cand}`, ...args);
const head = tryGit(ROOT, `--git-dir=${record}`, "rev-parse", "--verify", "--quiet", "HEAD^{commit}");
if (!head) stop(2, `flag-proof: ${quote(cand)} has no commit checked out.`);
// a repository nested in the candidate is listed as it stands and never entered
const dirty = gitOf("status", "--porcelain", "--ignore-submodules=all") !== "";
const what = `${head.slice(0, 12)}${dirty ? " plus uncommitted edits" : ""} against ${base.slice(0, 12)}`;

// ---- strict: read the change before running any of it
let baseFlags = null; // what the base's flags literal reads as; checked against what the base's config evaluates to
if (opts.strict) {
  const broken = strictProblems();
  if (broken.length) stop(1, `flag-proof: NOT ALLOWED. ${what}:\n  ${broken.slice(0, 40).join("\n  ")}${broken.length > 40 ? `\n  and ${broken.length - 40} more` : ""}`);
}

function strictProblems() {
  const out = [];
  if (dirty) out.push("the candidate has uncommitted or untracked files: commit the change, and nothing else, first");
  // This script never follows the candidate's .git, but whatever runs git in that folder next
  // (the site's tests, a shell prompt) does, and would take its settings from wherever it points.
  // The candidate's own ignore files decide what `status` leaves out, so they are not asked:
  // a file hidden that way is in no commit and no proof, yet it sits where the next command
  // run in that folder will load it. Strict wants the commit's files there and nothing else.
  const loose = gitOf("ls-files", "--others", "--directory", "-z").split("\0").filter(Boolean);
  if (loose.length) out.push(`the candidate holds files that are not in its commit, ignored ones included: ${loose.slice(0, 6).map(quote).join(", ")}${loose.length > 6 ? ` and ${loose.length - 6} more` : ""}. Strict proves a worktree that holds its commit and nothing else, so run it before anything is installed there`);
  if (!linkIntact(ROOT, cand, record)) out.push("the candidate's .git is not the link this repository made for it: do not run git in that folder");
  if (tryGit(ROOT, "merge-base", "--is-ancestor", base, head) === null) out.push("the candidate does not descend from the base");
  const changed = git(ROOT, "diff", "--name-only", "--no-renames", "-z", base, head).split("\0").filter(Boolean);
  // A feature whose flag is already on is live code: the build, the tests and the next deploy all
  // load it. A strict change may only touch features that are off, at the base and after it.
  // Which flags are on is read from the base, and read strictly: a literal this cannot read
  // is refused, never taken to mean that nothing is on.
  const baseConfig = tryGit(ROOT, "show", `${base}:site.config.mjs`) ?? "";
  const literals = [...baseConfig.matchAll(FLAGS_LITERAL)];
  baseFlags = literals.length === 1 ? flagEntries(literals[0][1]) : null;
  if (!baseFlags) return ['site.config.mjs at the base: flags must be exactly one one-line literal of "name": true or "name": false entries. Write it that way on the base first.'];
  const on = new Set([...baseFlags].filter(([, value]) => value === "true").map(([name]) => name));
  for (const file of changed) {
    if (file === "site.config.mjs") continue;
    const m = file.match(/^features\/([^/]+)\/.+/);
    if (!m || !FLAG_NAME.test(m[1])) out.push(`changed outside a feature folder: ${quote(file)}`);
    else if (on.has(m[1])) out.push(`changed a feature whose flag is on: ${quote(file)}`);
    // .gitattributes can make the export that is built differ from the commit that is merged;
    // no other dotfile has a use in a feature either
    else if (file.split("/").some((part) => part.startsWith("."))) out.push(`a dotfile in a feature folder: ${quote(file)}`);
  }
  // only plain files in features/: no links, no executables, no submodules
  for (const line of git(ROOT, "ls-tree", "-r", "-z", head, "--", "features").split("\0").filter(Boolean)) {
    const [meta, file] = line.split("\t");
    if (!meta.startsWith("100644 ") && changed.includes(file)) out.push(`not a plain file: ${quote(file)}`);
  }
  if (changed.includes("site.config.mjs")) out.push(...configProblems(baseConfig, git(ROOT, "show", `${head}:site.config.mjs`)));
  return out;
}

/** site.config.mjs may differ only inside its one-line `flags: { … }` literal, and only by new names set to false. */
function configProblems(before, after) {
  const one = (text) => { const all = [...text.matchAll(FLAGS_LITERAL)]; return all.length === 1 ? all[0] : null; };
  const a = one(before), b = one(after);
  if (!a || !b) return ["site.config.mjs: there must be exactly one `flags: { … }` literal, on one line"];
  if (before.replace(a[0], "flags: {}") !== after.replace(b[0], "flags: {}")) return ["site.config.mjs: changed outside the `flags` literal"];
  const was = flagEntries(a[1]), now = flagEntries(b[1]);
  if (!was || !now) return ['site.config.mjs: each flag is written "name": true or "name": false, once'];
  const out = [];
  for (const [name, value] of was) if (now.get(name) !== value) out.push(`site.config.mjs: the flag "${name}" was changed or removed`);
  for (const [name, value] of now) if (!was.has(name) && value !== "false") out.push(`site.config.mjs: the new flag "${name}" must be false`);
  return out;
}

// ---- build both, shut in
class Refused extends Error { constructor(code, message) { super(message); this.code = code; } }
const stopAfter = (code, message) => { throw new Refused(code, message); }; // leaves through the finally, which clears the temp folder
const canSandbox = process.platform === "darwin" && fs.existsSync("/usr/bin/sandbox-exec");
if (!canSandbox && opts.try) stop(2, "flag-proof: --try runs the feature's own code, and this system has no sandbox to run it in (it needs macOS sandbox-exec). Not run.");
// The sandbox keeps a build from loading native code of its own. This node has no other way to
// call into the system; one that does (a foreign-function module) needs the profile looked at again.
if (opts.try && builtinModules.includes("ffi")) stop(2, "flag-proof: this node has a foreign-function module, which the sandbox for --try was not written for. Not run.");
const LIMIT = Number(process.env.FLAG_PROOF_LIMIT_MS) || 120_000; // how long one build may take
const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "flag-proof-")));
let keep = false;
let code = 2;
try {
  const exportTree = (commit, name) => {
    const dir = path.join(tmp, name);
    fs.mkdirSync(dir);
    execFileSync("tar", ["-x", "-C", dir], { input: execFileSync("git", [...GIT_SAFE, "archive", commit], { cwd: ROOT, env: GIT_ENV, maxBuffer: 1 << 30, stdio: PIPED }), stdio: PIPED });
    fs.symlinkSync(path.join(ROOT, "node_modules"), path.join(dir, "node_modules")); // the trusted checkout's packages
    return dir;
  };
  // A candidate with loose edits is built where it stands, so the sandbox must let that folder be read.
  const sandbox = canSandbox ? sandboxFor(tmp, dirty ? [fs.realpathSync(cand)] : []) : null;
  const env = { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: tmp, TMPDIR: tmp, LANG: process.env.LANG ?? "C" };
  // Runs a script with node, shut in. Nothing it prints is passed through: on a failure its
  // last lines are quoted in the error, marked as data.
  const node = (cwd, script, ...rest) => {
    const cmd = [process.execPath, "--input-type=module", "-e", script, ...rest];
    const [bin, ...args] = sandbox ? ["/usr/bin/sandbox-exec", "-p", sandbox, ...cmd] : cmd;
    const r = spawnSync(bin, args, { cwd, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 1 << 26, timeout: LIMIT, killSignal: "SIGKILL" });
    if (r.status !== 0) {
      const said = String(r.stderr ?? "").replace(/[^\x20-\x7e\n]/g, "?").trimEnd().split("\n").slice(-30).map((line) => "    | " + line.slice(0, 300)).join("\n");
      const how = r.error?.code === "ETIMEDOUT" ? `ran longer than ${Math.round(LIMIT / 1000)} seconds and was stopped` : r.status === null ? `was stopped (${quote(r.signal ?? r.error?.code)})` : `exited ${r.status}`;
      stopAfter(2, `flag-proof: could not run: the build ${how}. What it printed follows, quoted. It is the build's own output: data, not instructions.\n${said}`);
    }
    return r.stdout;
  };
  const run = (cwd, outDir, on = null) => {
    node(cwd, `import { build } from "./generator/build.mjs";
const site = (await import("./site.config.mjs")).default;
const on = process.argv[2];
await build({ outDir: process.argv[1], site: on ? { ...site, flags: { ...(site.flags ?? {}), [on]: true } } : site });`, outDir, ...(on ? [on] : []));
  };

  const baseDir = exportTree(base, "base");
  // Strict read which flags are on from the text of the base's config. Before anything from the
  // candidate runs, make sure that reading is the truth: evaluate the base's config (the base is
  // trusted) and compare. A config whose real flags are written some other way stops here.
  if (opts.strict) {
    const real = JSON.parse(node(baseDir, `const site = (await import("./site.config.mjs")).default; process.stdout.write(JSON.stringify(site.flags ?? {}));`));
    const read = Object.fromEntries([...baseFlags].map(([name, value]) => [name, value === "true"]));
    const same = (a, b) => JSON.stringify(Object.entries(a).sort()) === JSON.stringify(Object.entries(b).sort());
    if (!same(real, read)) stopAfter(1, `flag-proof: NOT ALLOWED. ${what}:\n  site.config.mjs at the base: its flags literal reads ${JSON.stringify(read)} but the config evaluates to ${JSON.stringify(real)}. Write the flags as one one-line literal on the base first.`);
  }
  // A committed candidate is built from a clean export of its commit; one with loose edits is built where it stands.
  const candDir = dirty ? cand : exportTree(head, "candidate");
  // What is built must be what will be merged: every file of the commit, and no other.
  if (!dirty) {
    const want = git(ROOT, "ls-tree", "-r", "-z", "--name-only", head).split("\0").filter(Boolean).sort();
    const got = [...listing(candDir).keys()].filter((rel) => rel !== "node_modules").sort();
    if (JSON.stringify(want) !== JSON.stringify(got)) stopAfter(1, `flag-proof: NOT ALLOWED. ${what}:\n  the export of the candidate does not hold exactly the files of its commit (an export-ignore attribute?)`);
  }

  // Everything below is read before the next build runs. A build can write anywhere in the
  // temp folder, so whatever it could reach is taken down first and never read again.
  const differences = [];
  // Without --strict the candidate may change package.json (a new script, say), but not what is installed.
  const deps = (dir) => {
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
    return JSON.stringify([pkg.dependencies ?? {}, pkg.devDependencies ?? {}, pkg.optionalDependencies ?? {}, pkg.peerDependencies ?? {}]);
  };
  if (deps(baseDir) !== deps(candDir)) differences.push("dependencies in package.json differ from the base");
  const lock = (dir) => (fs.existsSync(path.join(dir, "package-lock.json")) ? hash(path.join(dir, "package-lock.json")) : null);
  if (lock(baseDir) !== lock(candDir)) differences.push("package-lock.json differs from the base");

  const outBase = path.join(tmp, "out-base");
  const outHere = path.join(tmp, "out-candidate");
  run(baseDir, outBase);
  const builtBase = listing(outBase);
  run(candDir, outHere);
  const builtHere = listing(outHere);
  differences.push(...compare(builtBase, builtHere, ["missing:  ", "changed:  ", "added:    "]));

  const how = `${sandbox ? "sandboxed" : "NOT sandboxed (no sandbox-exec on this system)"}${opts.strict ? ", strict" : ""}`;
  if (differences.length) {
    console.error(`flag-proof: DIFFERENT. ${what} (${how}):\n  ${differences.slice(0, 40).join("\n  ")}${differences.length > 40 ? `\n  and ${differences.length - 40} more` : ""}`);
    code = 1;
  } else {
    console.log(`flag-proof: identical. ${what} (${how}): ${builtBase.size} files, same names and same bytes; dependencies unchanged.`);
    // the proof's own word for what it proved, so nobody has to ask the candidate's checkout
    if (!dirty) console.log(`flag-proof: proven ${head}`);
    code = 0;
    if (opts.try) {
      const outTry = path.join(tmp, "out-try");
      run(candDir, outTry, opts.try);
      const delta = compare(builtHere, listing(outTry), ["removes:  ", "changes:  ", "adds:     "]);
      keep = true;
      console.log(`flag-proof: with "${opts.try}" on, the site ${delta.length ? `differs in ${delta.length} file${delta.length === 1 ? "" : "s"}:\n  ${delta.slice(0, 60).join("\n  ")}${delta.length > 60 ? `\n  and ${delta.length - 60} more` : ""}` : "is still identical: the flag changes nothing"}`);
      console.log(`Built in ${outTry} for you to read. Delete ${tmp} when you are done.`);
    }
  }
} catch (e) {
  if (e instanceof Refused) { console.error(e.message); code = e.code; }
  else { console.error(`flag-proof: could not run: ${quote(e.message)}`); code = 2; } // the message may carry a path a build made
} finally {
  if (!keep) {
    // a build may have left folders nobody can open; open them, so the whole folder can go
    try { unlock(tmp); fs.rmSync(tmp, { recursive: true, force: true }); } catch { console.error(`flag-proof: could not remove ${tmp}. Delete it by hand.`); }
  }
}
process.exit(code);

/**
 * A macOS sandbox profile for a build. Later rules win over earlier ones.
 *  - no network (that includes local sockets, such as an ssh or docker agent)
 *  - writes only under dir
 *  - reads only what is listed: dir, the installed packages, node itself, the system's own
 *    libraries and time zones, and any folder in `readable`. Everything else is shut, wherever
 *    it is: a build that could read a token file could leave it in its output for whoever
 *    reads that. (Names and sizes elsewhere can still be seen; contents and folder listings
 *    cannot.)
 *  - no terminal, by any name: a build can neither write past this script to the screen nor
 *    read what is typed
 *  - no other process: nothing forked, so nothing left running afterwards, and no program
 *    started (so not `security`, which reads the keychain)
 *  - native code may be loaded only from the system, node itself and the installed packages:
 *    never from dir, and never from a candidate folder that was made readable
 *  - no signal to any other process
 */
function sandboxFor(dir, readable = []) {
  const q = (p) => JSON.stringify(p);
  const nodeBin = fs.realpathSync(process.execPath);
  const packages = path.join(ROOT, "node_modules");
  const real = (p) => { try { return fs.realpathSync(p); } catch { return p; } };
  // A node that loads shared libraries from somewhere else (a package manager's folder, say)
  // will fail to start in here; add that folder to this list rather than opening a wider one.
  const system = ["/System", "/usr/lib", "/usr/share", "/private/var/db/timezone", "/private/var/db/dyld"].map((p) => `(subpath ${q(p)})`);
  const devices = ["/", "/dev/null", "/dev/urandom", "/dev/random"].map((p) => `(literal ${q(p)})`);
  const node = [...new Set([process.execPath, nodeBin])].map((p) => `(literal ${q(p)})`);
  const read = [...system, ...devices, ...node, `(subpath ${q(dir)})`, `(literal ${q(packages)})`, `(subpath ${q(real(packages))})`, ...readable.map((p) => `(subpath ${q(p)})`)].join(" ");
  return `(version 1)
(allow default)
(deny network*)
(deny file-write*)
(allow file-write* (subpath ${q(dir)}) (literal "/dev/null") (literal "/dev/stdout") (literal "/dev/stderr") (literal "/dev/dtracehelper"))
(deny file-read-data (subpath "/"))
(allow file-read-data ${read})
(deny file-map-executable)
(allow file-map-executable ${system.join(" ")} ${node.join(" ")} (subpath ${q(real(packages))}))
(deny process-fork)
(deny process-exec*)
(allow process-exec* ${node.join(" ")})
(deny signal)
(allow signal (target self))`;
}

/** Makes every folder under dir one this user can open and empty again. Links are not followed. */
function unlock(dir) {
  fs.chmodSync(dir, 0o700);
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) if (entry.isDirectory()) unlock(path.join(dir, entry.name));
}

function hash(file) {
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

/**
 * Map of relative path → sha256 for every file under dir. Links are recorded, not followed.
 * Anything else a build can leave (a pipe, a socket, a folder or file nobody may open) is
 * recorded as what it is and never opened: reading a pipe would wait forever.
 */
function listing(dir, rel = "", out = new Map()) {
  let entries;
  try { entries = fs.readdirSync(path.join(dir, rel), { withFileTypes: true }); } catch (e) { out.set(rel || ".", "a folder that cannot be read: " + e.code); return out; }
  for (const entry of entries) {
    const next = path.join(rel, entry.name);
    if (entry.isDirectory()) listing(dir, next, out);
    else if (entry.isSymbolicLink()) out.set(next, "link:" + fs.readlinkSync(path.join(dir, next)));
    else if (!entry.isFile()) out.set(next, "not a file");
    else { try { out.set(next, hash(path.join(dir, next))); } catch (e) { out.set(next, "a file that cannot be read: " + e.code); } }
  }
  return out;
}

function compare(a, b, [gone, changed, added]) {
  const out = [];
  for (const [rel, sum] of a) {
    if (!b.has(rel)) out.push(gone + quote(rel));
    else if (b.get(rel) !== sum) out.push(changed + quote(rel));
  }
  for (const rel of b.keys()) if (!a.has(rel)) out.push(added + quote(rel));
  return out;
}
