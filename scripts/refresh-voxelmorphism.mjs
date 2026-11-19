// Regenerate the site's copy of the Voxelmorphism kit from Village.
//   node scripts/refresh-voxelmorphism.mjs <village-clone> [revision]
//       reads the exact commit (default: the pin below) from Git; this is what a commit ships
//   node scripts/refresh-voxelmorphism.mjs <village-checkout> --worktree
//       reads the checkout's working files, for changing the kit and the site side by side;
//       never commit what it writes (the build check refuses a copy that names no revision)
// The site uses the parts in PARTS and nothing else: their scripts are registered, their CSS is
// put together in the kit's own order (tools/css.mjs), and the build test fails when a page uses
// a vx- class that is not here.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { build, version } from "esbuild";

export const PIN = "26e971357e0386a55ec4d49e2d6e094c525f4686";

// Every part the site's pages use: [its script in the kit's src/components (null for a part with
// no script of its own), its stylesheet in css/ (null when it lives in the core sheet)], keyed
// by the name its definition is exported as. test/kit.test.mjs checks each is named in the
// site's source, so a part nobody uses does not ride along.
export const PARTS = {
  // the instrument and its controls (the Signal Desk, settings, the park's controls)
  button: ["button", null], lampKey: ["lamp-key", null], toggle: ["toggle", null], slider: ["slider", null],
  rotary: ["rotary", "rotary"], backplane: ["backplane", null], select: ["select", "select"],
  toggleGroup: ["toggle-group", "toggle-group"], toggleButton: ["toggle-button", "toggle-button"],
  // surfaces, grooves, wells and lamps (lit.js and the core sheet)
  card: ["card", null], groove: [null, null], recess: [null, null], lamp: [null, null], lettering: ["lettering", null],
  // a site: the page, its bar, its links
  page: [null, "page"], navbar: ["navbar", "navbar"], navs: ["navs", "navs"],
  // reading
  prose: ["prose", "prose"], codeBlock: [null, "code-block"], figure: [null, "figure"], table: ["table", "table"],
  callout: ["callout", "callout"], badge: [null, "badge"],
  item: [null, "item"], listGroup: ["list-group", "list-group"], emptyState: [null, "empty-state"],
};
// Sheets every page needs whatever its parts: the instrument's fittings and its lit look.
const SHEETS = ["fittings", "instrument", "instrument-library", "existing"];

const [repo, mode] = process.argv.slice(2);
const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) await refresh(repo, mode);

async function refresh(repo, mode) {
  if (!repo) throw new Error("Pass the path to a Village clone (and optionally a revision, or --worktree).");
  if (version !== "0.28.2") throw new Error("Use the esbuild version in the site lockfile (npm ci).");
  const fromWorktree = mode === "--worktree";
  const revision = fromWorktree ? null : mode || PIN;
  const root = path.resolve(import.meta.dirname, "..");
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "voxelmorphism-"));
  const engine = path.join(work, "engine");
  const dist = path.join(work, "vendor");
  const source = (name) => fs.readFileSync(path.join(engine, name), "utf8");
  const write = (dir, file, data) => {
    const target = path.join(dir, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, data);
  };
  const replaceOnce = (text, before, after) => {
    if (!text.includes(before) || text.indexOf(before) !== text.lastIndexOf(before)) throw new Error("Upstream source changed near " + before.slice(0, 50));
    return text.replace(before, after);
  };

  try {
    const entries = ["kit/src", "kit/css", "kit/fonts", "kit/showcase", "blocks", "probe/gpu.ts"];
    if (fromWorktree) {
      const checkout = path.join(path.resolve(repo), "engine");
      for (const e of entries) fs.cpSync(path.join(checkout, e), path.join(engine, e), { recursive: true });
    } else {
      const archive = execFileSync("git", ["-C", repo, "archive", revision, ...entries.map((p) => "engine/" + p)], { maxBuffer: 64 << 20 });
      execFileSync("tar", ["-xf", "-", "-C", work], { input: archive });
    }

    // The kit registers every part. Keep the site's: esbuild then drops the rest.
    const index = source("kit/src/index.js");
    const registry = index.match(/export const components = \[[\s\S]*?\];/)?.[0];
    if (!registry) throw new Error("Missing upstream control registry");
    const scripted = Object.entries(PARTS).filter(([, [file]]) => file !== null || false).map(([name]) => name);
    const litParts = ["groove", "recess", "lamp"];
    for (const name of [...scripted, ...litParts]) if (!new RegExp(`\\b${name}\\b`).test(registry)) throw new Error(`The kit has no part named ${name}`);
    const files = new Set(Object.values(PARTS).map(([file]) => file).filter(Boolean));
    const subset = replaceOnce(index, registry, `export const components = [${[...scripted, ...litParts].join(", ")}];`)
      .replace(/^import .* from '\.\/components\/([^']+)\.js';$/gm, (line, name) => (files.has(name) || name === "util" || name === "toast" ? line : ""))
      .replace(/^export .* from '\.\/components\/theme-picker\.js';$/m, "");
    write(engine, "kit/src/index.js", subset);
    write(engine, "kit/api.js", `export { adopt, use, release, ready, live, refresh, getStage, fitInstrument, toast, LIGHTS, sound } from './src/index.js';`);

    // The desk's controller, without the showcase's own boot: the site's page starts it.
    const desk = source("kit/showcase/desk.js");
    const end = desk.indexOf("\nsync();\nadopt();");
    if (end === -1) throw new Error("Missing upstream desk boot");
    const scopedDesk = replaceOnce(desk.slice(0, end), "function sync() {", `function sync() {
    const mount = hardware.closest('.workbench');
    for (const key of ['shell', 'caps', 'rail', 'profile']) mount.dataset[key] = build[key];`);
    write(engine, "kit/showcase/desk.js", scopedDesk + "\nsync();\n");

    await build({
      absWorkingDir: engine,
      entryPoints: { "kit/src/index": "kit/api.js", "kit/showcase/desk": "kit/showcase/desk.js", "blocks/renderer": "blocks/renderer.ts" },
      outdir: dist, bundle: true, splitting: true, format: "esm", target: "es2022",
      chunkNames: "kit/shared/[name]-[hash]", minify: true, legalComments: "none",
    });
    const copy = (src, dest = src) => write(dist, dest, fs.readFileSync(path.join(engine, src)));
    for (const file of ["press.wav", "release.wav", "LICENSE"]) copy("kit/src/core/audio/" + file, "kit/shared/audio/" + file);

    // One stylesheet, as the kit's tools/css.mjs makes it (_kit.css first, the rest by name),
    // with only the site's parts. Latin faces only.
    let base = source("kit/css/_kit.css").replace(/@font-face\s*\{[^}]+\}/g, (face) => (/latin-(wght|400|600)-normal|vox-text-|data:font/.test(face) ? face : ""));
    const sheets = new Set([...SHEETS, ...Object.values(PARTS).map(([, css]) => css).filter(Boolean)]);
    for (const name of sheets) if (!fs.existsSync(path.join(engine, `kit/css/${name}.css`))) throw new Error(`The kit has no css/${name}.css`);
    const css = [`/* Voxelmorphism, from Village ${revision ?? "(working files: do not commit)"}. Made by scripts/refresh-voxelmorphism.mjs. */\n`, base,
      ...[...sheets].sort().map((n) => `\n/* ==== css/${n}.css ==== */\n\n` + source(`kit/css/${n}.css`))].join("\n");
    write(dist, "kit/voxelmorphism.css", css);
    for (const [, font] of css.matchAll(/url\("(fonts\/[^"]+)"\)/g)) {
      copy("kit/" + font);
      const license = path.join("kit", path.dirname(font), "OFL.txt");
      if (fs.existsSync(path.join(engine, license))) write(dist, license, source(license).replace(/[ \t\r]+$/gm, ""));
    }
    for (const file of ["materials/walnut.jpg", "materials/contours.png"]) copy("kit/showcase/" + file);
    write(dist, "kit/showcase/desk.css", "@scope (.signal-desk) {\n" + source("kit/showcase/desk.css") + "\n}\n");
    write(dist, "kit/REVISION", (revision ?? "worktree") + "\n");

    const target = path.join(root, "static/vendor/village");
    fs.mkdirSync(target, { recursive: true });
    for (const dir of ["kit", "blocks"]) {
      const destination = path.join(target, dir);
      if (dir === "kit") fs.rmSync(destination, { recursive: true, force: true });
      fs.cpSync(path.join(dist, dir), destination, { recursive: true });
    }
    console.log(`Voxelmorphism ${revision ?? "(working files)"}: ${scripted.length + litParts.length} scripted parts, ${sheets.size + 1} sheets, ${css.length} bytes of CSS.`);
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}
