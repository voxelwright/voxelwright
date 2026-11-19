// Regenerate the site's shared Village distribution from immutable Git blobs.
// node scripts/refresh-voxelmorphism.mjs <path-to-village-clone>
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { build, version } from "esbuild";

const revision = "dda49b0f8f6353e1ed3bee76b15600f4e8cf4b31";
const repo = process.argv[2];
if (!repo) throw new Error("Pass the path to a Village Git clone containing PR 443.");
if (version !== "0.28.2") throw new Error("Use the esbuild version in the site lockfile (npm ci).");
const root = path.resolve(import.meta.dirname, "..");
const work = fs.mkdtempSync(path.join(os.tmpdir(), "signal-desk-"));
const engine = path.join(work, "engine");
const dist = path.join(work, "vendor");
const source = name => fs.readFileSync(path.join(engine, name), "utf8");
function write(dir, file, data) {
  const target = path.join(dir, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, data);
}
function replaceOnce(source, before, after) {
  if (!source.includes(before) || source.indexOf(before) !== source.lastIndexOf(before)) {
    throw new Error("Upstream source changed near " + before.slice(0, 50));
  }
  return source.replace(before, after);
}

try {
  const entries = ["kit/src", "kit/css", "kit/fonts", "kit/showcase", "blocks", "probe/gpu.ts"];
  const archive = execFileSync("git", ["-C", repo, "archive", revision, ...entries.map(p => "engine/" + p)], { maxBuffer: 48 << 20 });
  execFileSync("tar", ["-xf", "-", "-C", work], { input: archive });

  // The upstream registry imports every specimen. Keep only the installed hardware.
  // esbuild drops unused imports, exports and definitions from the reachable modules.
  const index = source("kit/src/index.js");
  const registry = index.match(/export const components = \[[\s\S]*?\];/)?.[0];
  if (!registry) throw new Error("Missing upstream control registry");
  const parts = {
    button: "button", lampKey: "lamp-key", toggle: "toggle", slider: "slider", rotary: "rotary", backplane: "backplane",
  };
  const installed = Object.keys(parts).join(", ");
  const imports = new Set([...Object.values(parts), "util"]);
  const subset = replaceOnce(index, registry, `export const components = [${installed}];`)
    .replace(/^import .* from '\.\/components\/([^']+)\.js';$/gm, (line, name) => imports.has(name) ? line : "")
    .replace(/^export .* from '\.\/components\/theme-picker\.js';$/m, "")
    .replace(/^export const toast = .*;$/m, "");
  write(engine, "kit/src/index.js", subset);
  write(engine, "kit/api.js", `export { adopt, use, release, ready, live, getStage, fitInstrument, LIGHTS, sound } from './src/index.js';`);

  // Leave renderer selection and the scope of adoption to the host. Drop the
  // showcase's developer console handle and document-wide readiness marker.
  const desk = source("kit/showcase/desk.js");
  const end = desk.indexOf("\nsync();\nadopt();");
  if (end === -1) throw new Error("Missing upstream desk boot");
  // @scope keeps page chrome independent. Publish material attributes inside
  // that scope too, so enclosure and rail selectors can see the current finish.
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

  // English desk labels, the common kit sheet and the two installed extensions.
  let base = source("kit/css/_kit.css");
  base = base.replace(/@font-face\s*\{[^}]+\}/g, face =>
    /latin-(wght|400|600)-normal|vox-text-/.test(face) ? face : "");
  const css = [base, source("kit/css/rotary.css"), source("kit/css/instrument.css")].join("\n");
  write(dist, "kit/voxelmorphism.css", css);
  for (const [, font] of css.matchAll(/url\("(fonts\/[^"]+)"\)/g)) {
    copy("kit/" + font);
    const license = path.join("kit", path.dirname(font), "OFL.txt");
    if (fs.existsSync(path.join(engine, license))) write(dist, license, source(license).replace(/[ \t\r]+$/gm, ""));
  }
  for (const file of ["materials/walnut.jpg", "materials/contours.png"]) copy("kit/showcase/" + file);
  // Scope the original workbench sheet to its wrapper. Its page resets and
  // standalone masthead never touch the site's header, footer or support UI.
  write(dist, "kit/showcase/desk.css", "@scope (.signal-desk) {\n" + source("kit/showcase/desk.css") + "\n}\n");

  const target = path.join(root, "static/vendor/village");
  fs.mkdirSync(target, { recursive: true });
  // These two directories are generated by this script. Other engine lanes are independent.
  for (const dir of ["kit", "blocks"]) {
    const destination = path.join(target, dir);
    if (dir === "kit") fs.rmSync(destination, { recursive: true, force: true });
    fs.cpSync(path.join(dist, dir), destination, { recursive: true });
  }
} finally {
  fs.rmSync(work, { recursive: true, force: true });
}
