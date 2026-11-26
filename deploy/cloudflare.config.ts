// Default mode builds zahynailo.dev as an assets-only Worker (personal page + blog; no Worker code runs).
// World mode builds voxelwright.world with world-worker.mjs for /releases/*, /bay/* and /weather.
// Docs: https://developers.cloudflare.com/cf/projects/cloudflare-config/index.md
import { bindings, defineConfig } from "cf/config";

export default defineConfig(({ mode }) => {
  const world = mode === "world";
  return {
    worker: {
      name: world ? "voxelwright" : "zahynailo",
      compatibilityDate: "2026-11-13",
      observability: { enabled: true },
      workersDev: !world,
      // Each target binds apex and www. Both zones redirect www to the apex; zahynailo.dev also redirects old realm query links.
      domains: world ? ["voxelwright.world", "www.voxelwright.world"] : ["zahynailo.dev", "www.zahynailo.dev"],
      assets: {
        htmlHandling: "auto-trailing-slash",
        notFoundHandling: "404-page",
        // Only the world target runs Worker code (each call counts against the Free plan's 100,000 requests a day).
        // /releases/ is the city's pinned release; /bay/ the road's marks and landmarks; /weather San Francisco's weather now.
        ...(world ? { runWorkerFirst: ["/releases/*", "/bay/*", "/weather"] } : {}),
      },
      // zahynailo.dev is assets-only: no Worker code runs and static assets never count against Worker requests.
      ...(world ? { entrypoint: "./world-worker.mjs", env: { ASSETS: bindings.assets() } } : {}),
    },
  };
});
