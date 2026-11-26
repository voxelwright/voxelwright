// npm run build: production build into dist/ (no drafts, personal front page at / on by default).
// With --dev: drafts included, live-reload script added, written to .dev/ (used by npm run dev).
// Set SITE_PERSONAL_HOME=0 to omit the personal front page at /.
import path from "node:path";
import { build, ContentError } from "../generator/build.mjs";
import { personalHomeOn } from "../generator/front.mjs";

const dev = process.argv.includes("--dev");
const outName = dev ? ".dev" : "dist";
const outDir = path.resolve(import.meta.dirname, "..", outName);
const personalHome = personalHomeOn(process.env, true);
const started = performance.now();
try {
  const { posts, pages } = await build({ outDir, drafts: dev, dev, personalHome });
  console.log(`Built ${pages.length} pages${personalHome ? " + personal home" : ""} (${posts.length} posts${dev ? ", drafts included" : ""}) into ${outName}/ in ${Math.round(performance.now() - started)} ms.`);
} catch (e) {
  if (!(e instanceof ContentError)) throw e;
  console.error(e.message);
  process.exit(1);
}
