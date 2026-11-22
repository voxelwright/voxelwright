// git, for scripts that look at a worktree an agent wrote in.
//
// Such a folder is not trusted, and git reads a good deal from the folder it works on. Two rules
// keep that from running anything:
//  - git is never started inside the folder and never finds a repository through the folder's own
//    .git. The folder must be this checkout or a worktree added from it; its commit and its index
//    are read from this repository's own record of that worktree (recordOf), named to git with
//    --git-dir and --work-tree.
//  - every git call leaves out the owner's global and system settings, runs no hook and no file
//    watcher. A .gitattributes in the folder can name a filter, and git would run that filter's
//    command from whichever settings define it (git-lfs is the usual one); a relative hooks path
//    would be looked up inside the folder. The repository's own settings still apply, so git is
//    also told to take attributes from the empty tree, not from files in the folder: otherwise
//    a .gitattributes there could still pick a filter this repository's own settings define.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const clean = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith("GIT_")));
const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904"; // git knows this object in every repository
export const GIT_ENV = { ...clean, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", GIT_ATTR_NOSYSTEM: "1", GIT_ATTR_SOURCE: EMPTY_TREE, GIT_TERMINAL_PROMPT: "0" };
export const GIT_SAFE = ["-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null"];

/** Runs git and returns what it printed. Nothing it prints is passed through: on a failure it is in the error's message. */
export const git = (cwd, ...args) => execFileSync("git", [...GIT_SAFE, ...args], { cwd, env: GIT_ENV, encoding: "utf8", maxBuffer: 1 << 28, stdio: ["pipe", "pipe", "pipe"] }).replace(/\n$/, "");
export const tryGit = (cwd, ...args) => { try { return git(cwd, ...args); } catch { return null; } };

/** The folder all of this repository's worktrees share (its .git). */
export const commonDir = (root) => git(root, "rev-parse", "--path-format=absolute", "--git-common-dir");

/** This repository's own folder for the worktree at dir (a real path): its HEAD and index live there. Null if dir is not one of its worktrees. */
export function recordOf(root, dir) {
  const same = (p) => { try { return fs.realpathSync(p) === dir; } catch { return false; } };
  const common = commonDir(root);
  const main = git(root, "worktree", "list", "--porcelain", "-z").split("\0")[0].replace(/^worktree /, "");
  if (same(main)) return common;
  const added = path.join(common, "worktrees");
  for (const id of fs.existsSync(added) ? fs.readdirSync(added) : []) {
    let at;
    try { at = fs.readFileSync(path.join(added, id, "gitdir"), "utf8").trim(); } catch { continue; }
    if (same(path.dirname(path.resolve(added, id, at)))) return path.join(added, id);
  }
  return null;
}

/** Is the folder's own .git still the plain link this repository made for it? Read as a file, never through git. */
export function linkIntact(root, dir, record) {
  const real = (p) => fs.realpathSync(p);
  try {
    const own = path.join(dir, ".git");
    const common = commonDir(root);
    if (record === common) return fs.lstatSync(own).isDirectory() && real(own) === real(common);
    const named = fs.lstatSync(own).isFile() && fs.readFileSync(own, "utf8").match(/^gitdir: ([^\n]+)\n?$/);
    return Boolean(named) && real(path.resolve(dir, named[1])) === real(record);
  } catch { return false; }
}
