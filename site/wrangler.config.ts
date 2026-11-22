// `cf` builds this static site through Wrangler, which reads the assets directory here.
// Docs: https://developers.cloudflare.com/cf/projects/index.md#how-cf-runs-your-project
import { defineWranglerConfig } from "wrangler/experimental-config";

export default defineWranglerConfig({
  // `npm run dev` points this at .dev/ (drafts included). Deploys copy dist/ into deploy/dist (deploy/assemble.mjs).
  assetsDirectory: process.env.SITE_ASSETS_DIR ?? "dist",
});
