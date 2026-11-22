// zahynailo.dev (#450): one Worker with static assets, run by the `cf` CLI. The SF realm is the landing at "/", the
// site (site/) is under "/blog/". `node assemble.mjs` writes the assets folder (dist/, named in wrangler.config.ts).
// Docs: https://developers.cloudflare.com/cf/projects/cloudflare-config/index.md
import { bindings, defineConfig } from "cf/config";

export default defineConfig({
  worker: {
    name: "zahynailo",
    compatibilityDate: "2026-11-13",
    observability: { enabled: true },
    workersDev: true,
    // www answers too, and a redirect rule on the zone sends it to the apex (deploy/README.md).
    domains: ["zahynailo.dev", "www.zahynailo.dev"],
    entrypoint: "./worker.mjs",
    env: { ASSETS: bindings.assets() },
    assets: {
      htmlHandling: "auto-trailing-slash",
      notFoundHandling: "404-page",
      // Only these reach worker.mjs (each one counts against the Free plan's 100,000 requests a day); every other
      // file is a free static asset. /releases/ is the city's pinned release; /bay/ the road's marks and landmarks.
      runWorkerFirst: ["/releases/*", "/bay/*"],
    },
  },
});
