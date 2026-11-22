// Reads posts/<slug>/index.md, parses front matter and checks it.
import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { slugify } from "../lib/paths.mjs";

const FIELDS = new Set(["title", "date", "summary", "tags", "draft"]);

/** Splits "---\n<yaml>\n---\n<body>". Returns the body's starting line so errors point at the file. */
export function splitFrontMatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text);
  if (!m) return { data: null, body: text, bodyLine: 0 };
  return { data: YAML.parse(m[1]) ?? {}, body: text.slice(m[0].length), bodyLine: m[0].split("\n").length - 1 };
}

/**
 * @returns {{ posts: object[], errors: string[] }} posts newest first; drafts only when includeDrafts.
 */
export function loadPosts(postsDir, { includeDrafts }) {
  const posts = [];
  const errors = [];
  if (!fs.existsSync(postsDir)) return { posts, errors };

  for (const entry of fs.readdirSync(postsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const slug = entry.name;
    const dir = path.join(postsDir, slug);
    const file = path.join(dir, "index.md");
    const rel = path.relative(process.cwd(), file);
    if (!fs.existsSync(file)) {
      errors.push(`${path.relative(process.cwd(), dir)}: missing index.md`);
      continue;
    }
    if (slug !== slugify(slug)) {
      errors.push(`${rel}: folder name "${slug}" must be a lowercase slug (a-z, 0-9, hyphens).`);
      continue;
    }

    let parsed;
    try {
      parsed = splitFrontMatter(fs.readFileSync(file, "utf8"));
    } catch (e) {
      errors.push(`${rel}: front matter is not valid YAML: ${e.message}`);
      continue;
    }
    const { data, body, bodyLine } = parsed;
    if (!data) {
      errors.push(`${rel}: missing front matter (--- title, date, summary, tags, draft ---).`);
      continue;
    }

    const problems = [];
    for (const key of Object.keys(data)) if (!FIELDS.has(key)) problems.push(`unknown field "${key}"`);
    const draft = data.draft ?? false;
    if (typeof draft !== "boolean") problems.push("draft must be true or false");
    if (typeof data.title !== "string" || !data.title.trim()) problems.push("title is required");
    const date = normalizeDate(data.date);
    if (!date) problems.push("date must be YYYY-MM-DD");
    const tags = data.tags ?? [];
    if (!Array.isArray(tags) || tags.some((t) => typeof t !== "string" || !slugify(t))) problems.push("tags must be a list of words");
    const summary = data.summary ?? "";
    if (typeof summary !== "string") problems.push("summary must be text");
    else if (!draft && !summary.trim()) problems.push("summary is required before publishing");

    if (problems.length) {
      errors.push(`${rel}: ${problems.join("; ")}.`);
      continue;
    }
    if (draft && !includeDrafts) continue;

    posts.push({
      slug,
      dir,
      file: rel,
      title: data.title.trim(),
      date,
      summary: summary.trim(),
      tags: [...new Set(tags.map((t) => t.trim()))],
      draft,
      body,
      bodyLine,
    });
  }

  posts.sort((a, b) => (a.date === b.date ? a.slug.localeCompare(b.slug) : b.date.localeCompare(a.date)));
  return { posts, errors };
}

function normalizeDate(value) {
  if (value instanceof Date && !Number.isNaN(value.valueOf())) return value.toISOString().slice(0, 10);
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value))) return value;
  return null;
}
