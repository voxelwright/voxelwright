// npm run build: production build into dist/ (no drafts).
import path from "node:path";
import { build, ContentError } from "../generator/build.mjs";

const outDir = path.resolve(import.meta.dirname, "..", "dist");
const started = performance.now();
try {
  const { posts, pages } = await build({ outDir });
  console.log(`Built ${pages.length} pages (${posts.length} posts) into dist/ in ${Math.round(performance.now() - started)} ms.`);
} catch (e) {
  if (!(e instanceof ContentError)) throw e;
  console.error(e.message);
  process.exit(1);
}
