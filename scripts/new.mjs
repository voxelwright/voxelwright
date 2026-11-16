// npm run new "Title": creates posts/<slug>/index.md with front matter only.
import fs from "node:fs";
import path from "node:path";
import { slugify } from "../lib/paths.mjs";

const title = process.argv.slice(2).join(" ").trim();
if (!title) {
  console.error('Usage: npm run new "Post title"');
  process.exit(1);
}
const slug = slugify(title);
if (!slug) {
  console.error(`Cannot make a slug from "${title}". Use some letters or digits.`);
  process.exit(1);
}
const dir = path.resolve(import.meta.dirname, "..", "posts", slug);
if (fs.existsSync(dir)) {
  console.error(`posts/${slug}/ already exists.`);
  process.exit(1);
}
const now = new Date();
const date = [now.getFullYear(), now.getMonth() + 1, now.getDate()].map((n) => String(n).padStart(2, "0")).join("-");
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(
  path.join(dir, "index.md"),
  `---\ntitle: ${JSON.stringify(title)}\ndate: ${date}\nsummary: ""\ntags: []\ndraft: true\n---\n`,
);
console.log(`Created posts/${slug}/index.md`);
