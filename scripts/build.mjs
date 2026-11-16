// npm run build: production build into dist/ (no drafts).
// With --dev: drafts included, live-reload script added, written to .dev/ (used by npm run dev).
import path from "node:path";
import { outName as lookOut } from "../generator/looks.mjs";
import { build, ContentError } from "../generator/build.mjs";

const dev = process.argv.includes("--dev");
const outName = lookOut(dev ? ".dev" : "dist");
const outDir = path.resolve(import.meta.dirname, "..", outName);
const started = performance.now();
try {
  const { posts, pages } = await build({ outDir, drafts: dev, dev });
  console.log(`Built ${pages.length} pages (${posts.length} posts${dev ? ", drafts included" : ""}) into ${outName}/ in ${Math.round(performance.now() - started)} ms.`);
} catch (e) {
  if (!(e instanceof ContentError)) throw e;
  console.error(e.message);
  process.exit(1);
}
