// The site is built from the vendored Voxelmorphism kit and nothing else: every vx- class a page
// uses must be one the vendored stylesheet knows, and the vendored copy must come from a pinned
// Village commit (scripts/refresh-voxelmorphism.mjs), never from a working checkout.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { build } from "../generator/build.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const KIT = path.join(ROOT, "static/vendor/village/kit");

function* files(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* files(p);
    else if (e.name.endsWith(".html")) yield p;
  }
}

test("every vx- class on a page is in the vendored kit", async () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "site-kit-"));
  try {
    await build({ outDir: out, drafts: true });
    // the kit's sheet, and the showcase desk's (the Signal Desk's own hardware)
    const css = ["voxelmorphism.css", "showcase/desk.css"].map((f) => fs.readFileSync(path.join(KIT, f), "utf8")).join("\n");
    const missing = new Map();
    for (const file of files(out)) {
      if (file.includes(`${path.sep}vendor${path.sep}`)) continue;
      const html = fs.readFileSync(file, "utf8");
      for (const [, list] of html.matchAll(/class="([^"]*)"/g)) {
        for (const name of list.split(/\s+/)) {
          if (!name.startsWith("vx-")) continue;
          if (!new RegExp(`\\.${name}(?![\\w-])`).test(css)) missing.set(name, path.relative(out, file));
        }
      }
    }
    assert.deepEqual([...missing], [], "classes the vendored kit does not style (add the part to PARTS in scripts/refresh-voxelmorphism.mjs)");
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
  }
});

test("the vendored kit comes from a pinned Village commit", async () => {
  const revision = fs.readFileSync(path.join(KIT, "REVISION"), "utf8").trim();
  const { PIN } = await import("../scripts/refresh-voxelmorphism.mjs");
  assert.match(revision, /^[0-9a-f]{40}$/, "vendored from working files: run the refresh script with a revision before committing");
  assert.equal(revision, PIN, "REVISION and the script's PIN disagree");
});
