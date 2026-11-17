// node scripts/seed-commit.mjs <worktree> <flag> "<message>"
//
// Commits a seed's change, from the checkout you trust: the files of features/<flag>/ and
// site.config.mjs in that worktree, and nothing else. An agent uses this, not git, to commit
// what it wrote, because git run in a folder an agent wrote in can be made to run a command:
// by that folder's .git, by a hook, by a .gitattributes that names a filter (lib/worktree.mjs).
// Here git is never started in the worktree, uses this repository's own record of it, leaves out
// the owner's global settings, and runs no hook. The author is this checkout's user.
//
// It prints `seed-commit: <commit>`. It checks nothing about the change: that is flag-proof's job.
// Exit 0: committed. Exit 1: nothing to commit, or refused. Exit 2: could not run.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { FLAG_NAME } from "../lib/flags.mjs";
import { commonDir, git, recordOf } from "../lib/worktree.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const quote = (s) => JSON.stringify(String(s)).replace(/[^\x20-\x7e]/g, (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));
const stop = (code, message) => { console.error(`seed-commit: ${message}`); process.exit(code); };
process.on("uncaughtException", (e) => stop(2, `could not run: ${quote(e?.message ?? e)}`));

const [dir, flag, message, ...rest] = process.argv.slice(2);
if (!dir || !flag || !message || rest.length) stop(2, 'usage: node scripts/seed-commit.mjs <worktree> <flag> "<message>"');
if (!FLAG_NAME.test(flag)) stop(2, `${quote(flag)} is not a flag name.`);
const line = message.split("\n")[0].replace(/[\x00-\x1f\x7f]/g, " ").trim().slice(0, 200);
if (!line) stop(2, "the message is empty.");
if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) stop(2, `no folder at ${quote(dir)}.`);
const cand = fs.realpathSync(dir);
const record = recordOf(ROOT, cand);
if (!record || record === commonDir(ROOT)) stop(2, `${quote(cand)} is not a worktree added from this checkout (git worktree add).`);

// who commits: this checkout's user, read here, where the settings are the owner's own
const own = (key) => { try { return execFileSync("git", ["config", "--get", key], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { return ""; } };
const name = own("user.name"), email = own("user.email");
if (!name || !email) stop(2, "this checkout has no user.name and user.email to commit as.");

// Only plain files of the feature's own are committed: no link (a link to a file elsewhere
// would commit that file's contents, as you), no dotfile, nothing that is not a regular file.
const odd = [];
const look = (rel) => {
  const st = fs.lstatSync(path.join(cand, rel));
  if (st.isDirectory()) { for (const name of fs.readdirSync(path.join(cand, rel))) { if (name.startsWith(".")) odd.push(`${rel}/${name} (a dotfile)`); else look(`${rel}/${name}`); } }
  else if (!st.isFile()) odd.push(`${rel} (not a plain file)`);
  else if (st.nlink > 1) odd.push(`${rel} (linked to a file elsewhere)`);
};
if (!fs.existsSync(path.join(cand, "features", flag))) stop(1, `there is no features/${flag}/ in that worktree.`);
look(`features/${flag}`);
look("site.config.mjs");
if (odd.length) stop(1, `nothing was committed. A feature holds plain files of its own only: ${odd.slice(0, 6).map(quote).join(", ")}${odd.length > 6 ? ` and ${odd.length - 6} more` : ""}`);

const at = [`--git-dir=${record}`, `--work-tree=${cand}`];
const paths = [`features/${flag}`, "site.config.mjs"];
try { git(ROOT, ...at, "add", "--", ...paths); } catch (e) { stop(1, `nothing was committed: ${quote(e.stderr || e.message)}`); }
if (git(ROOT, ...at, "diff", "--cached", "--name-only", "--", ...paths) === "") stop(1, `nothing to commit in features/${flag}/ or site.config.mjs.`);
// only those paths, whatever else an earlier command may have staged
try { git(ROOT, "-c", `user.name=${name}`, "-c", `user.email=${email}`, "-c", "commit.gpgsign=false", ...at, "commit", "--quiet", "--no-verify", "-m", line, "--", ...paths); } catch (e) { stop(1, `nothing was committed: ${quote(e.stderr || e.message)}`); }
console.log(`seed-commit: ${git(ROOT, `--git-dir=${record}`, "rev-parse", "HEAD")}`);
