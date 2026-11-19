// Regenerate the committed distribution. See README.md in this directory.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { transformSync } from "esbuild";

const [repo, cache] = process.argv.slice(2);
if (!repo || !cache) throw Error("Usage: node scripts/landing/prepare.mjs VILLAGE_REPO INA_CACHE");
const dest = new URL("../../static/landing/", import.meta.url);
const ina = "24b416e0742d4cf834ee59393bb1783adf0f0066";
const sky = "bdd9e9675a50a21d3e7543eeefa129c17ca2a19b";
const source = (ref, path) =>
  execFileSync("git", ["-C", repo, "show", ref + ":engine/" + path], { encoding: "utf8" });
const write = (name, value) => writeFileSync(new URL(name, dest), value);
const cachePath = join(cache, "home/.village/engine/place/ina");
const index = JSON.parse(readFileSync(join(cachePath, "index.json")));
if (index.atlas || index.faces !== 707795) throw Error("Expected the unpainted r12 geometry.");
const capture = join(cache, "shots/r12-full.png");
if (
  createHash("sha256").update(readFileSync(capture)).digest("hex") !==
  "55124c0f7a9f3d3970de557c9b6b9aeba53ec03b623796600b5434fa9b03ddc2"
)
  throw Error("Unexpected capture.");
execFileSync("cwebp", [
  "-quiet",
  "-metadata",
  "none",
  "-q",
  "89",
  capture,
  "-o",
  new URL("ina.webp", dest).pathname,
]);

// Group like byte positions before gzip. The GPU gets the original five words back.
const data = Buffer.alloc(index.faces * 20);
let offset = 0;
for (const block of index.blocks) {
  const bytes = readFileSync(join(cachePath, block.file));
  if (bytes.length !== block.faces * 20) throw Error("Incomplete block");
  for (let i = 0; i < block.faces; i++)
    for (let j = 0; j < 20; j++) data[j * index.faces + offset + i] = bytes[i * 20 + j];
  offset += block.faces;
  for (const key of ["file", "layer", "size", "low"]) delete block[key];
}
if (offset !== index.faces) throw Error("Incomplete place");
write("ina.faces.gz", gzipSync(data, { level: 9 }));
delete index.seenFrom;
write("place.json", JSON.stringify(index));

const march = source(ina, "page/march.ts");
function between(s, start, end) {
  const a = s.indexOf(start),
    b = s.indexOf(end, a + start.length);
  if (a < 0 || b < 0) throw Error("Missing source boundary " + start);
  return s.slice(a, b);
}
const clean = (s) =>
  s
    .replace(/\/\/[^\n]*/g, "")
    .replace(/^\s*\n/gm, "")
    .trim();
const globals = `struct Globals {
 eye: vec3f, tanHalf: f32, right: vec3f, aspect: f32, up: vec3f, time: f32,
 forward: vec3f, day: f32, sun: vec3f, low: f32, sea: f32, pad0: f32, pad1: f32, pad2: f32,
 lightSun: vec4f, lightFill: vec4f, skyZenith: vec4f, skyHorizon: vec4f,
 skyHorizonSun: vec4f, cloudTint: vec4f, cloudTintSun: vec4f, weather: vec4f
}`;
const light = clean(between(march, "const ROOM_LIGHT", "\n`"));
const air = clean(between(march, "fn skyBase", "\n`")).replace(/\$\{[^}]+\}/, "3.6e-6");
const cloud = clean(between(march, "fn hash2i", "${sunlitText")).replace("${CLOUDS.toFixed(3)}", "0.100");
const hash = clean(between(march, "fn hash3i", "// A number for a place"));

// Same face decoding, bays, glass and light as matte.ts. A longer near plane gives
// this closed camera path enough depth precision in one pass. Omit ID/atlas passes.
let city = between(source(ina, "page/matte.ts"), "struct V {", "// Which face is nearest");
city = clean(
  city
    .replace(/^\$\{(?:GLOBALS|LIGHT|AIR)\}$/gm, "")
    .replace(/@vertex fn vsFirst[\s\S]*?(?=@vertex fn vs\()/, "")
    .replace(/if \(in\.own > textureLoad[\s\S]*?(?=let dist)/, "")
    .replace(/if \(in\.style == 14u\)[^\n]+/, "")
    .replace("let lit = step(in.shade, in.high + 0.5);", "let lit = select(1.0, step(in.shade, in.high + 0.5), v.light.z > 0.5);")
    .replace("if (in.style == 15u)", "if (v.light.w > 0.5 && in.style == 15u)")
    .replace("const NEAR = 1.0;", "const NEAR = 80.0;")
    .replace(
      "return vec4f(tone(air",
      `let window = fract(sin(dot(floor(vec2f(fx,fy)),vec2f(12.31,78.19)) + f32(in.id)) * 437.15);
  col += pane * smoothstep(0.57,0.82,window) * vec3f(0.94,0.53,0.18) * g.weather.z;
  return vec4f(tone(air`,
    ),
);
write(
  "shaders.js",
  Object.entries({ globals, light, air, cloud, hash, city })
    .map(([k, v]) => "export const " + k + "=" + JSON.stringify(v) + ";")
    .join("\n"),
);

let plane = between(source(sky, "landing/plane.ts"), "type V3", "/**\n * The plane's sound");
plane = plane
  .replace(/const NEAR = 1.0;/g, "const NEAR = 80.0;")
  .replace("depthWriteEnabled: true", "depthWriteEnabled: false")
  .replace("shader(device, 'plane', CODE)", "device.createShaderModule({code: CODE})");
plane = plane.replace(
  /const CODE = [^\x60]*\x60([\s\S]*?)\x60/,
  (_, code) => "const CODE = `" + clean(code) + "`",
);
const skyClock = source(sky, "landing/sky.ts").replace(/^import .*$/gm, "");
const graphics = source(sky, "player/graphics.ts");
write(
  "sky.js",
  transformSync(
    "import {globals as GLOBALS,light as LIGHT} from './shaders.js';\n" +
      plane +
      "\n" +
      skyClock +
      "\n" +
      graphics,
    { loader: "ts", format: "esm", minifySyntax: true, legalComments: "none" },
  ).code,
);

// Keep the original highlight, blur, vignette and grade passes. The landing's
// sky is clear, so its display path never needs the separate rain pipeline.
let glow = source(ina, "page/glow.ts")
  .replace(/^import .*$/gm, "")
  .replace(/const RAIN = [\s\S]*?(?=export async function glow)/, "")
  .replace(/const module = await shader[^\n]+/, "const module = device.createShaderModule({code:CODE})")
  .replace(/const wet = device.createBindGroupLayout[\s\S]*?(?=const block =)/, "")
  .replace(/    if \(rain > 0\) \{[\s\S]*?\n    \}/, "");
glow = glow.replace(/const CODE = [^\x60]*\x60([\s\S]*?)\x60/, (_, code) => "const CODE = `" + clean(code) + "`");
write("glow.js", transformSync(glow, { loader: "ts", format: "esm", legalComments: "none" }).code);

// The pinned player FXAA pass smooths the cached city before its final grade.
const smooth = source(sky, "player/smooth.ts")
  .replace(/^import .*$/gm, "")
  .replace("await shader(device, 'smooth', CODE)", "device.createShaderModule({code: CODE})")
  .replace(/const CODE = [^\x60]*\x60([\s\S]*?)\x60/, (_, code) => "const CODE = `" + clean(code) + "`");
write("smooth.js", transformSync(smooth, { loader: "ts", format: "esm", legalComments: "none" }).code);
