import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build, transform } from "esbuild";
import { copyModules } from "voxelmorphism/browser";

const root = path.dirname(fileURLToPath(import.meta.resolve("voxelmorphism/voxelmorphism.css")));

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

export async function buildKit(out) {
  // The flag proof prepares this exact module's output before entering its no-fork sandbox.
  if (process.env.FLAG_PROOF_KIT) {
    fs.cpSync(process.env.FLAG_PROOF_KIT, out, { recursive: true });
    return;
  }
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "site-kit-src-"));
  const kit = path.join(out, "kit");
  try {
    copyModules(work);
    const index = path.join(work, "kit/src/index.js");
    const registry = /export const components = \[([^\]]*)\];/;
    const src = fs.readFileSync(index, "utf8");
    const upstream = src.match(registry)?.[1].split(",").map((name) => name.trim());
    const names = Object.entries(PARTS).filter(([name, [script, sheet]]) => script || !sheet).map(([name]) => name);
    for (const name of names) if (!upstream?.includes(name)) throw new Error("Missing kit component " + name);
    const components = src.replace(registry, `export const components = [${names.join(", ")}];`);
    const files = new Set(["util", "toast", ...Object.values(PARTS).map(([script]) => script)]);
    const selected = components.replace(/^(?:import|export) .* from '\.\/components\/([^']+)\.js';$/gm,
      (line, file) => files.has(file) ? line : "");
    fs.writeFileSync(index, selected);
    fs.writeFileSync(path.join(work, "api.js"), "export { adopt, use, release, ready, live, refresh, getStage, fitInstrument, toast, LIGHTS, sound } from './kit/src/index.js';");
    await build({
      absWorkingDir: work,
      entryPoints: { "kit/src/index": "api.js", "kit/showcase/desk-controls": "kit/showcase/desk-controls.js", "blocks/renderer": "blocks/renderer.js" },
      outdir: out, bundle: true, splitting: true, format: "esm", target: "es2022",
      chunkNames: "kit/shared/[name]-[hash]", minify: true, legalComments: "none",
    });
    const copy = (from, to) => fs.cpSync(from, path.join(kit, to), { recursive: true });
    const moduleFile = (rel) => path.join(work, "kit", rel);
    for (const file of ["press.wav", "release.wav", "LICENSE"]) copy(moduleFile("src/core/audio/" + file), "shared/audio/" + file);
    copy(moduleFile("showcase/materials"), "showcase/materials");
    const desk = fs.readFileSync(moduleFile("showcase/desk.css"), "utf8");
    fs.writeFileSync(path.join(kit, "showcase/desk.css"), "@scope (.signal-desk) {\n" + desk + "\n}\n");
    for (const file of ["LICENSE", "NOTICE"]) copy(path.join(root, file), file);

    const sheet = (name) => fs.readFileSync(path.join(root, "css", name + ".css"), "utf8");
    const base = sheet("_kit").replace(/@font-face\s*\{[^}]+\}/g, (face) =>
      /ibm-plex-(?:sans|mono)-latin-|vox-text-|data:font/.test(face) ? face : "");
    const sheets = new Set([...SHEETS, ...Object.values(PARTS).map(([, css]) => css).filter(Boolean)]);
    const css = [base, ...[...sheets].sort().map(sheet)].join("\n");
    const { code } = await transform(css, { loader: "css", minifyWhitespace: true });
    fs.writeFileSync(path.join(kit, "voxelmorphism.css"), code);
    for (const [, font] of css.matchAll(/url\("(fonts\/[^"]+)"\)/g)) {
      copy(path.join(root, font), font);
      const license = path.join(path.dirname(font), "OFL.txt");
      copy(path.join(root, license), license);
    }
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}
