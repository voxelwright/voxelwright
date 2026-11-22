// node scripts/seed-test.mjs <base> <commit>
//
// Runs the site's tests on a commit an agent made, in a place the agent has never written.
// The tests are not sandboxed, so this is the one step where a mistake runs code as you. It
// therefore does four things itself, in order, and an agent runs this instead of doing them:
//
//  1. Makes a fresh checkout of <commit> in a new private temporary folder. Not in the agent's
//     worktree, where a file in no commit would be loaded; and not beside it, in a folder the
//     agent can write: npm takes a parent folder that holds a package.json with "workspaces" as
//     the project, and would run that folder's scripts and settings.
//  2. Runs the strict proof of that checkout against <base>. Nothing is installed or run
//     unless the commit is one strict allows.
//  3. Runs `npm ci` and `npm test` there with workspaces off (so no parent folder is the
//     project) and without the settings an environment can carry in.
//  4. Removes the checkout.
//
// Exit 0: the tests passed. Exit 1: not proven, or a test failed. Exit 2: could not run.
// SEED_TEST=1 is set for the tests it runs, so a test of this script can tell it is inside one.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { git, tryGit } from "../lib/worktree.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const quote = (s) => JSON.stringify(String(s)).replace(/[^\x20-\x7e]/g, (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));
const say = (message) => console.log(`seed-test: ${message}`);
const stop = (code, message) => { console.error(`seed-test: ${message}`); process.exit(code); };
process.on("uncaughtException", (e) => stop(2, `could not run: ${quote(e?.message ?? e)}`));

const [baseArg, commitArg, ...rest] = process.argv.slice(2);
if (!baseArg || !commitArg || rest.length) stop(2, "usage: node scripts/seed-test.mjs <base> <commit>");
const base = tryGit(ROOT, "rev-parse", "--verify", "--quiet", `${baseArg}^{commit}`);
const commit = tryGit(ROOT, "rev-parse", "--verify", "--quiet", `${commitArg}^{commit}`);
if (!base) stop(2, `no commit named ${quote(baseArg)}.`);
if (!commit) stop(2, `no commit named ${quote(commitArg)}.`);

// what an environment can carry in: npm settings, node options, git settings
const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !/^(npm_|NODE_OPTIONS$|NODE_PATH$|GIT_)/i.test(name)));
env.SEED_TEST = "1";

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "seed-test-")));
const dir = path.join(tmp, "site");
let code = 2;
try {
  git(ROOT, "worktree", "add", "--detach", "--quiet", dir, commit);
  const proof = spawnSync(process.execPath, [path.join(ROOT, "scripts", "flag-proof.mjs"), base, "--candidate", dir, "--strict"], { cwd: ROOT, env, stdio: "inherit" });
  if (proof.status !== 0) { code = proof.status === 1 ? 1 : 2; console.error(`seed-test: ${commit.slice(0, 12)} did not pass the strict proof. Nothing was installed and no test was run.`); }
  else {
    const npm = (...args) => spawnSync("npm", [...args, "--workspaces=false"], { cwd: dir, env, stdio: "inherit" }).status;
    if (npm("ci", "--prefer-offline", "--no-audit", "--no-fund") !== 0) { code = 2; console.error("seed-test: the packages could not be installed."); }
    else if (npm("test") !== 0) { code = 1; console.error(`seed-test: FAILED. A test did not pass on ${commit}.`); }
    else { code = 0; say(`passed ${commit}`); }
  }
} finally {
  try { git(ROOT, "worktree", "remove", "--force", dir); } catch {}
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { console.error(`seed-test: could not remove ${tmp}. Delete it by hand.`); }
  try { git(ROOT, "worktree", "prune"); } catch {}
}
process.exit(code);
