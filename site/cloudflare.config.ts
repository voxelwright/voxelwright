// The site's Worker for `npm run dev` only (`cf dev`, the real Workers runtime). zahynailo.dev is one Worker for
// the realm and the site, deployed from deploy/ in the Village repo (deploy/cloudflare.config.ts); nothing deploys this.
// Docs: https://developers.cloudflare.com/cf/projects/cloudflare-config/index.md
import { bindings, defineConfig } from "cf/config";
import site from "./site.config.mjs";
import { PAGE_ROUTE_PATTERNS } from "./lib/paths.mjs";

export default defineConfig(({ mode }) => {
  // The one switch is `negotiateMarkdown` in site.config.mjs. Dev (`--mode development`)
  // always negotiates so the behaviour can be tried locally.
  const negotiate = site.negotiateMarkdown || mode === "development";

  return {
    worker: {
      name: "site",
      compatibilityDate: "2026-11-13",
      observability: { enabled: true },
      assets: {
        htmlHandling: "auto-trailing-slash",
        notFoundHandling: "404-page",
        // Page routes only ("/" and paths ending in "/"). Files never reach the Worker.
        ...(negotiate ? { runWorkerFirst: PAGE_ROUTE_PATTERNS } : {}),
      },
      // With negotiation off the deploy is assets-only: no Worker code runs at all.
      ...(negotiate ? { entrypoint: "./src/worker.mjs", env: { ASSETS: bindings.assets() } } : {}),
    },
  };
});
