// Default mode builds zahynailo.dev as an assets-only Worker (personal page + blog; no Worker code runs),
// unless site/site.config.mjs sets negotiateMarkdown: true, in which case site/src/worker.mjs answers
// `Accept: text/markdown` on page routes.
// World mode builds voxelwright.world with world-worker.mjs for /releases/*, /bay/* and /weather.
// Docs: https://developers.cloudflare.com/cf/projects/cloudflare-config/index.md
import { bindings, defineConfig } from "cf/config";
import site from "../site/site.config.mjs";
import { PAGE_ROUTE_PATTERNS } from "../site/lib/paths.mjs";

export default defineConfig(({ mode }) => {
  const world = mode === "world";
  const negotiate = !world && site.negotiateMarkdown;
  return {
    worker: {
      name: world ? "voxelwright" : "zahynailo",
      compatibilityDate: "2026-11-13",
      observability: { enabled: true },
      // Each Worker answers only at its own domains: no *.workers.dev copy without the zones' rules in front.
      workersDev: false,
      // Each target binds apex and www. Both zones redirect www to the apex; zahynailo.dev also redirects old realm query links.
      domains: world ? ["voxelwright.world", "www.voxelwright.world"] : ["zahynailo.dev", "www.zahynailo.dev"],
      assets: {
        htmlHandling: "auto-trailing-slash",
        notFoundHandling: "404-page",
        // Only the world target (or zahynailo.dev with negotiateMarkdown: true) runs Worker code (each call counts
        // against the Free plan's 100,000 requests a day).
        // /releases/ is the city's pinned release; /bay/ the road's marks and landmarks; /weather San Francisco's weather now.
        ...(world ? { runWorkerFirst: ["/releases/*", "/bay/*", "/weather"] } : negotiate ? { runWorkerFirst: PAGE_ROUTE_PATTERNS } : {}),
      },
      // With negotiateMarkdown off, zahynailo.dev is assets-only: no Worker code runs and static assets never count against Worker requests.
      ...(world ? { entrypoint: "./world-worker.mjs", env: { ASSETS: bindings.assets() } } : negotiate ? { entrypoint: "../site/src/worker.mjs", env: { ASSETS: bindings.assets() } } : {}),
    },
  };
});
