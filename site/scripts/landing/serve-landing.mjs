// Serve a root-mounted (base: "/") build for the landing browser checks.
// Reuses site/dist when it already holds the landing; otherwise builds a temporary base: "/" copy.
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { build } from "../../generator/build.mjs";
import site from "../../site.config.mjs";
import { startServer } from "../serve.mjs";

const DIST = resolve(import.meta.dirname, "../../dist");

export async function serveLanding() {
  let root = DIST;
  let tempDir = null;
  if (!existsSync(join(DIST, "landing/home.js"))) {
    tempDir = await mkdtemp(join(tmpdir(), "site-landing-"));
    root = tempDir;
    await build({ outDir: root, drafts: false, dev: false, personalHome: false, site: { ...site, base: "/" } });
  }
  const server = await startServer({ root, port: 0, host: "127.0.0.1" });
  const base = `http://127.0.0.1:${server.address().port}/`;
  return {
    root,
    server,
    base,
    async close() {
      server.close();
      if (tempDir) await rm(tempDir, { recursive: true, force: true });
    },
  };
}
