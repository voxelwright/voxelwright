// The write path's one gate. Every way of publishing (the editor, the MCP server, the CLI)
// sends a post as { slug, files } and gets back either a normalised post or a list of reasons.
// No node: imports, so the same code runs in the Worker and in Node.
//
// What it guards against: path tricks in names, files that would run on the site's origin (SVG,
// HTML, scripts: /edit lives on the same origin), oversized uploads, front matter the build
// would reject, and session files that are malformed or still hold secret-shaped strings.
import YAML from "yaml";
import { validateSession } from "../lib/session/format.mjs";
import { findLeaks } from "../lib/session/redact.mjs";

export const LIMITS = {
  markdown: 256 * 1024,
  session: 2 * 1024 * 1024,
  asset: 10 * 1024 * 1024,
  total: 25 * 1024 * 1024,
  files: 40,
};

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const NAME = /^[a-z0-9]+(?:[-_.][a-z0-9]+)*\.[a-z0-9]+$/;
const FIELDS = new Set(["title", "date", "summary", "tags", "draft"]);

/** Allowed asset types, by extension, with the bytes each must start with. */
const ASSETS = {
  png: [[0x89, 0x50, 0x4e, 0x47]],
  jpg: [[0xff, 0xd8, 0xff]],
  jpeg: [[0xff, 0xd8, 0xff]],
  webp: [[0x52, 0x49, 0x46, 0x46]],
  avif: null, // ISO BMFF: checked by its "ftyp" box below
  gif: [[0x47, 0x49, 0x46, 0x38]],
  mp4: null,
  glb: [[0x67, 0x6c, 0x54, 0x46]], // "glTF"
};

const utf8 = new TextDecoder("utf-8", { fatal: true });

/**
 * @param {{ slug: string, files: Record<string, Uint8Array|string> }} input
 * @returns {{ ok: true, post: { slug, files: Record<string, Uint8Array>, front } } | { ok: false, errors: string[] }}
 */
export function checkSubmission(input) {
  const errors = [];
  const slug = input?.slug;
  if (typeof slug !== "string" || !SLUG.test(slug) || slug.length > 80) errors.push("slug must be lowercase words joined by hyphens, at most 80 characters");
  const entries = Object.entries(input?.files ?? {});
  if (!entries.length) errors.push("no files");
  if (entries.length > LIMITS.files) errors.push(`at most ${LIMITS.files} files per post`);
  if (errors.length) return { ok: false, errors };

  const files = {};
  let total = 0;
  let front = null;
  for (const [name, raw] of entries) {
    const bytes = typeof raw === "string" ? new TextEncoder().encode(raw) : raw;
    if (!(bytes instanceof Uint8Array)) {
      errors.push(`${name}: not text or bytes`);
      continue;
    }
    total += bytes.length;
    if (name === "index.md") {
      if (bytes.length > LIMITS.markdown) errors.push(`index.md is over ${LIMITS.markdown / 1024} KB`);
      const text = decode(bytes, name, errors);
      if (text != null) front = checkMarkdown(text, errors);
    } else if (!NAME.test(name) || name.includes("..")) {
      errors.push(`${name}: file names are lowercase letters, digits, hyphens, dots; no folders`);
      continue;
    } else if (name.endsWith(".session.json")) {
      if (bytes.length > LIMITS.session) errors.push(`${name} is over ${LIMITS.session / 1024 / 1024} MB`);
      const text = decode(bytes, name, errors);
      if (text != null) checkSessionFile(name, text, errors);
    } else {
      const ext = name.split(".").pop();
      if (!(ext in ASSETS)) {
        errors.push(`${name}: .${ext} is not accepted (images, mp4, glb and .session.json only; SVG and HTML would run on the site's origin)`);
        continue;
      }
      if (bytes.length > LIMITS.asset) errors.push(`${name} is over ${LIMITS.asset / 1024 / 1024} MB`);
      if (!magicMatches(ext, bytes)) errors.push(`${name}: the content is not a .${ext} file`);
    }
    files[name] = bytes;
  }
  if (!("index.md" in files)) errors.push("index.md is required");
  if (total > LIMITS.total) errors.push(`the post is over ${LIMITS.total / 1024 / 1024} MB in total`);
  return errors.length ? { ok: false, errors } : { ok: true, post: { slug, files, front } };
}

function decode(bytes, name, errors) {
  try {
    return utf8.decode(bytes);
  } catch {
    errors.push(`${name} is not UTF-8 text`);
    return null;
  }
}

/** The same front matter rules as generator/posts.mjs, without touching the file system. */
function checkMarkdown(text, errors) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text);
  if (!m) {
    errors.push("index.md needs front matter (--- title, date, summary, tags, draft ---)");
    return null;
  }
  let data;
  try {
    data = YAML.parse(m[1], { maxAliasCount: 0 }) ?? {};
  } catch (e) {
    errors.push(`front matter is not valid YAML: ${e.message.split("\n")[0]}`);
    return null;
  }
  if (typeof data !== "object" || Array.isArray(data)) {
    errors.push("front matter must be a list of fields");
    return null;
  }
  for (const key of Object.keys(data)) if (!FIELDS.has(key)) errors.push(`unknown front matter field "${key}"`);
  if (typeof data.title !== "string" || !data.title.trim()) errors.push("title is required");
  const date = data.date instanceof Date ? data.date.toISOString().slice(0, 10) : data.date;
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) errors.push("date must be YYYY-MM-DD");
  if (data.draft != null && typeof data.draft !== "boolean") errors.push("draft must be true or false");
  if (data.tags != null && (!Array.isArray(data.tags) || data.tags.some((t) => typeof t !== "string"))) errors.push("tags must be a list of words");
  if (data.draft === false && !(typeof data.summary === "string" && data.summary.trim())) errors.push("summary is required before publishing");
  return { title: data.title, date, draft: data.draft ?? false };
}

function checkSessionFile(name, text, errors) {
  let session;
  try {
    session = JSON.parse(text);
  } catch {
    errors.push(`${name} is not valid JSON`);
    return;
  }
  const problems = validateSession(session);
  if (problems.length) errors.push(`${name}: ${problems.slice(0, 3).join("; ")}`);
  const leaks = findLeaks(session);
  if (leaks.length) errors.push(`${name} still contains ${leaks.join(", ")}`);
}

function magicMatches(ext, bytes) {
  if (ext === "avif" || ext === "mp4") return bytes.length > 12 && String.fromCharCode(...bytes.slice(4, 8)) === "ftyp";
  return ASSETS[ext].some((sig) => sig.every((b, i) => bytes[i] === b));
}
