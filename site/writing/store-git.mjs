// The git store, simulated locally: a bare repository stands in for the private GitHub repo.
// publishGit() does what the Worker would do through GitHub's API: check the post with the
// shared gate, write posts/<slug>/ as one commit on main, refuse if main moved past the base
// the editor started from, and push.
//
// In production the Worker cannot run git. It would make the same commit with the Git Data API
// (create blobs, a tree on top of the base tree, a commit, then PATCH refs/heads/main with
// force=false, which fails if main moved). See notes/writing-store-auth.md.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { checkSubmission } from "./core.mjs";

const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

/** A bare "private repo" seeded from a source checkout's HEAD, and the editor's working clone. */
export function setupGit(root, source) {
  const bare = path.join(root, "site-private.git");
  const editor = path.join(root, "git-editor");
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(root, { recursive: true });
  git(root, "clone", "--quiet", "--bare", "--no-local", "--single-branch", source, bare);
  git(root, "clone", "--quiet", bare, editor);
  git(editor, "config", "user.name", "Site editor");
  git(editor, "config", "user.email", "editor@localhost");
  return { bare, editor };
}

/**
 * @param {string} editor  working clone of the bare repo
 * @param {{ slug, files, baseCommit? }} submission
 * @returns {{ ok: true, commit } | { ok: false, status, errors }}
 */
export function publishGit(editor, submission, writer = "editor") {
  const checked = checkSubmission(submission);
  if (!checked.ok) return { ok: false, status: 422, errors: checked.errors };
  git(editor, "fetch", "--quiet", "origin");
  const branch = git(editor, "rev-parse", "--abbrev-ref", "origin/HEAD").replace("origin/", "");
  const head = git(editor, "rev-parse", `origin/${branch}`);
  if (submission.baseCommit && submission.baseCommit !== head) {
    // The editor knows which commit the post was opened at; anything newer touching this post is a conflict.
    const touched = git(editor, "log", "--format=%H", `${submission.baseCommit}..${head}`, "--", `posts/${checked.post.slug}`);
    if (touched) return { ok: false, status: 409, errors: ["the post changed since you opened it"] };
  }
  git(editor, "reset", "--quiet", "--hard", head);
  const dir = path.join(editor, "posts", checked.post.slug);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, bytes] of Object.entries(checked.post.files)) fs.writeFileSync(path.join(dir, name), bytes);
  git(editor, "add", "--all", path.join("posts", checked.post.slug));
  if (!git(editor, "status", "--porcelain")) return { ok: true, commit: head, unchanged: true };
  git(editor, "commit", "--quiet", "-m", `Publish ${checked.post.slug}`, "-m", `Via the editor (${writer}).`);
  try {
    git(editor, "push", "--quiet", "origin", `HEAD:${branch}`);
  } catch {
    return { ok: false, status: 409, errors: ["main moved while publishing; try again"] };
  }
  return { ok: true, commit: git(editor, "rev-parse", "HEAD") };
}
