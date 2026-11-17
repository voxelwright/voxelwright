// npm run flag-proof -- <base>: proves this checkout builds the same site as <base>, file for
// file. A change that sits behind a flag that is off must pass; anything that leaks out fails.
// Also fails if the dependencies or the lock file differ from the base.
//
// <base> is a commit or branch (default: main). The base is built from a clean export of that
// commit in a temporary folder, with this checkout's node_modules. This checkout is built as it
// stands, uncommitted edits included, so run it on a committed tree for a proof worth keeping.
// SITE_FLAGS and SITE_LOOK are ignored. Exit 0: identical. Exit 1: different. Exit 2: could not run.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const base = process.argv[2] ?? "main";
const git = (...args) => execFileSync("git", args, { cwd: ROOT, encoding: "utf8", maxBuffer: 1 << 28 }).trim();
const stop = (code, message) => { console.error(message); process.exit(code); };

if (base.startsWith("-")) stop(2, `flag-proof: "${base}" is not a commit or branch.`);
let baseCommit;
try { baseCommit = git("rev-parse", "--verify", "--quiet", `${base}^{commit}`); } catch { stop(2, `flag-proof: no commit named "${base}".`); }
const head = git("rev-parse", "HEAD");
const dirty = git("status", "--porcelain") !== "";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "flag-proof-"));
let code = 2;
try {
  // The base, exported clean.
  const baseDir = path.join(tmp, "base");
  fs.mkdirSync(baseDir);
  execFileSync("tar", ["-x", "-C", baseDir], { input: execFileSync("git", ["archive", baseCommit], { cwd: ROOT, maxBuffer: 1 << 30 }) });
  fs.symlinkSync(path.join(ROOT, "node_modules"), path.join(baseDir, "node_modules"));

  const env = { ...process.env };
  delete env.SITE_FLAGS;
  delete env.SITE_LOOK;
  const builder = 'import { build } from "./generator/build.mjs"; await build({ outDir: process.argv[1] });';
  const run = (cwd, outDir) => execFileSync(process.execPath, ["--input-type=module", "-e", builder, outDir], { cwd, env, stdio: ["ignore", "ignore", "inherit"] });
  const outBase = path.join(tmp, "out-base");
  const outHere = path.join(tmp, "out-here");
  run(baseDir, outBase);
  run(ROOT, outHere);

  const differences = [];
  // Dependencies: none added, removed or moved.
  const deps = (dir) => {
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
    return JSON.stringify([pkg.dependencies ?? {}, pkg.devDependencies ?? {}, pkg.optionalDependencies ?? {}, pkg.peerDependencies ?? {}]);
  };
  if (deps(baseDir) !== deps(ROOT)) differences.push("dependencies in package.json differ from the base");
  const lock = (dir) => (fs.existsSync(path.join(dir, "package-lock.json")) ? hash(path.join(dir, "package-lock.json")) : null);
  if (lock(baseDir) !== lock(ROOT)) differences.push("package-lock.json differs from the base");

  const a = listing(outBase);
  const b = listing(outHere);
  for (const [rel, sum] of a) {
    if (!b.has(rel)) differences.push(`missing here: ${rel}`);
    else if (b.get(rel) !== sum) differences.push(`changed:      ${rel}`);
  }
  for (const rel of b.keys()) if (!a.has(rel)) differences.push(`added here:   ${rel}`);

  const what = `${head.slice(0, 12)}${dirty ? " plus uncommitted edits" : ""} against ${baseCommit.slice(0, 12)}`;
  if (differences.length) {
    console.error(`flag-proof: DIFFERENT. ${what}:\n  ${differences.slice(0, 40).join("\n  ")}${differences.length > 40 ? `\n  and ${differences.length - 40} more` : ""}`);
    code = 1;
  } else {
    console.log(`flag-proof: identical. ${what}: ${a.size} files, same names and same bytes; dependencies unchanged.`);
    code = 0;
  }
} catch (e) {
  console.error(`flag-proof: could not run: ${e.message}`);
  code = 2;
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
process.exit(code);

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
