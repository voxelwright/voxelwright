import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";
import { build } from "../generator/build.mjs";

function* files(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* files(p);
    else if (e.name.endsWith(".html")) yield p;
  }
}

test("every vx- class on a page is in the installed kit", async () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "site-kit-"));
  try {
    await build({ outDir: out, drafts: true });
    // the kit's sheet, and the showcase desk's (the Signal Desk's own hardware)
    const css = ["voxelmorphism.css", "showcase/desk.css"].map((f) => fs.readFileSync(path.join(out, "blog/vendor/village/kit", f), "utf8")).join("\n");
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
    assert.deepEqual([...missing], [], "classes the site kit does not style (add the part to PARTS in generator/kit.mjs)");
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
  }
});

test("the built kit loads with its renderer and local assets", async () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "site-kit-"));
  try {
    await build({ outDir: out });
    const kit = path.join(out, "blog/vendor/village/kit");
    const { adopt } = await import(pathToFileURL(path.join(kit, "src/index.js")));
    assert.equal(typeof adopt, "function");
    const { renderer } = await import(pathToFileURL(path.join(kit, "../blocks/renderer.js")));
    assert.equal(typeof renderer, "function");
    for (const file of ["voxelmorphism.css", "showcase/desk.css"]) {
      const sheet = fs.readFileSync(path.join(kit, file), "utf8");
      for (const [, asset] of sheet.matchAll(/url\(["']?((?:fonts|materials)\/[^)"']+)/g)) {
        assert.ok(fs.existsSync(path.resolve(kit, path.dirname(file), asset)), asset);
      }
    }
    for (const file of ["LICENSE", "NOTICE", "shared/audio/LICENSE", "fonts/vox-text/OFL.txt"]) {
      assert.ok(fs.statSync(path.join(kit, file)).size > 0, file);
    }
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
  }
});

test("every selected part is used by the site", async () => {
  const { PARTS } = await import("../generator/kit.mjs");
  function* walk(dir) {
    for (const e of fs.readdirSync(path.join(import.meta.dirname, "..", dir), { withFileTypes: true })) {
      const rel = path.join(dir, e.name);
      if (rel === "generator/kit.mjs") continue;
      if (rel.startsWith(path.join("static", "vendor"))) continue;
      if (e.isDirectory()) yield* walk(rel);
      else if (/\.(mjs|js|css)$/.test(e.name)) yield fs.readFileSync(path.join(import.meta.dirname, "..", rel), "utf8");
    }
  }
  const sources = ["generator", "lib", "static"].flatMap((dir) => [...walk(dir)]).join("\n");
  // the class a part is asked for by, where it differs from its stylesheet's name
  const CLASS = { codeBlock: "vx-code", emptyState: "vx-empty", lampKey: "data-lamp", lettering: "vx-sign", page: "vx-page", backplane: "vx-backplane", toggle: "vx-toggle", navs: "vx-nav" };
  const unused = Object.entries(PARTS)
    .filter(([name, [script, css]]) => script || css)
    .filter(([name, [script, css]]) => !sources.includes(CLASS[name] ?? `vx-${css ?? script}`))
    .map(([name]) => name);
  assert.deepEqual(unused, [], "parts vendored but never used: take them out of PARTS");
});
