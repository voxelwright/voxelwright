// Both Workers serve the same realm. World mode selects the realm-only origin and asset folder.
// Docs: https://developers.cloudflare.com/cf/projects/cloudflare-config/index.md
import { bindings, defineConfig } from "cf/config";

export default defineConfig(({ mode }) => ({
  worker: {
    name: mode === "world" ? "voxelwright" : "zahynailo",
    compatibilityDate: "2026-11-13",
    observability: { enabled: true },
    workersDev: mode !== "world",
    // Each target binds apex and www. zahynailo.dev also has a zone redirect for www.
    domains: mode === "world" ? ["voxelwright.world", "www.voxelwright.world"] : ["zahynailo.dev", "www.zahynailo.dev"],
    entrypoint: mode === "world" ? "./world-worker.mjs" : "./worker.mjs",
    env: { ASSETS: bindings.assets() },
    assets: {
      htmlHandling: "auto-trailing-slash",
      notFoundHandling: "404-page",
      // Only these reach worker.mjs (each one counts against the Free plan's 100,000 requests a day); every other
      // file is a free static asset. /releases/ is the city's pinned release; /bay/ the road's marks and landmarks; /weather San
      // Francisco's weather now (worker.mjs).
      runWorkerFirst: ["/releases/*", "/bay/*", "/weather"],
    },
  },
}));
