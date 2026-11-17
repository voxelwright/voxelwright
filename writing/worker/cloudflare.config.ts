// The write-path spike: one Worker with D1 (posts, revisions, passkeys, sessions) and R2 (files).
// Local only: `cf dev --local` from this folder. Never deployed; no remote resources exist.
import { bindings, defineConfig } from "cf/config";

export default defineConfig({
  worker: {
    name: "site-writing-spike",
    compatibilityDate: "2026-11-13",
    compatibilityFlags: ["nodejs_compat"],
    entrypoint: "./src/index.mjs",
    env: {
      DB: bindings.d1(),
      FILES: bindings.r2(),
    },
  },
});
