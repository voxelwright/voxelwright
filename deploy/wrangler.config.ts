// `cf` builds and deploys through Wrangler, which reads the assets folder here (assemble.mjs writes it).
// Docs: https://developers.cloudflare.com/cf/projects/index.md#how-cf-runs-your-project
import { defineWranglerConfig } from "wrangler/experimental-config";

export default defineWranglerConfig({ assetsDirectory: "dist" });
