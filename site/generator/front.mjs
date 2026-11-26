// Personal front page at "/".
// Built when the site is mounted below "/" (site.base !== "/") and personalHome is enabled:
// scripts/build.mjs, scripts/dev.mjs and scripts/check.mjs enable it by default (SITE_PERSONAL_HOME=0 disables it),
// while direct generator/build.mjs calls in tests keep it off by default (SITE_PERSONAL_HOME=1 enables it).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build, transform } from "esbuild";
import { copyModules } from "voxelmorphism/browser";
import { escapeHtml as e } from "./markdown.mjs";
import { CARD, CLEAR_REALM_KEY, SF_NIGHT } from "./pages.mjs";
import { blogPath, sitePath } from "../lib/paths.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const KIT_ROOT = path.dirname(fileURLToPath(import.meta.resolve("voxelmorphism/voxelmorphism.css")));

// The same Walnut + Ridgeline instrument fitting the rest of zahynailo.dev uses.
const FITTING = { shell: "walnut", caps: "field", profile: "high", rail: "steady" };

// Sections of engine/kit/css/_kit.css that this front page does not render.
const UNUSED_KIT_SECTIONS = new Set([
  "Toggle",
  "Slider",
  "Text field",
  "Note card",
  "List",
  "Tabs",
  "Meter",
  "Menu",
  "Dialog",
  "Toast",
  "Block",
  "lit: wells",
]);

export const WORLD_URL = "https://voxelwright.world";
export const BIO = "Building Voxelwright in San Francisco: worlds people make by talking, with AI agents.";

/** True when the personal front page should be built; explicit SITE_PERSONAL_HOME=1/0 overrides fallback. */
export function personalHomeOn(env = process.env, fallback = false) {
  if (env?.SITE_PERSONAL_HOME === "1") return true;
  if (env?.SITE_PERSONAL_HOME === "0") return false;
  return fallback;
}

/** Social links read directly from site.config.mjs `links`. */
export function frontSocials(site) {
  return (site.links ?? []).map((l) => ({ name: l.name, url: l.url }));
}

/** Keep only the sections of _kit.css needed by the front page (tokens, button, lettering, lit look, groove). */
function trimKitCss(css) {
  const parts = css.split(/(?=\/\* ---------- [^-]+? ---------- \*\/)/);
  return parts
    .filter((chunk) => {
      const m = chunk.match(/^\/\* ---------- ([^-]+?) ---------- \*\//);
      return !m || !UNUSED_KIT_SECTIONS.has(m[1].trim());
    })
    .join("\n");
}

// Slim runtime bridge built against the installed kit's Stage, instrument look, lettering, button,
// groove and the engine's WebGPU renderer — leaving unused kit components and the WebGL2 stand-in out.
const KIT_FRONT_ENTRY = `
import { Stage } from './kit/src/core/stage.js';
import { instrument, settings } from './kit/src/looks/instrument.js';
import { groove } from './kit/src/looks/lit.js';
import { lettering } from './kit/src/components/lettering.js';
import { button } from './kit/src/components/button.js';
import { renderer } from './blocks/renderer.js';

const PARTS = [lettering, button, groove];

export async function mountFront() {
  if (!globalThis.navigator?.gpu) return null;
  const r = await renderer().catch(() => null);
  if (!r || typeof r.draw !== 'function') return null;
  const root = document.documentElement;
  const d = root.dataset;
  if (d.shell) instrument(settings({ shell: d.shell, caps: d.caps, profile: d.profile, rail: d.rail }), root, null);
  if (document.fonts?.load) {
    const family = getComputedStyle(root).getPropertyValue('--vx-key-font').trim();
    if (family) await document.fonts.load('400 20px ' + family).catch(() => {});
  }
  let stage;
  try { stage = new Stage(r); } catch { return null; }
  stage.onfail = () => {
    for (const el of stage.boundUnder(document)) stage.remove(el);
    document.dispatchEvent(new CustomEvent('vx-plain'));
  };
  for (const def of PARTS) {
    for (const el of document.querySelectorAll(def.selector)) stage.add(el, def);
  }
  return stage;
}
`;

/**
 * Tailors a minimal Voxelmorphism JS bundle and inlined CSS strictly for the front page.
 * Writes only `<outDir><base>front/front.js` and returns the minified CSS string for `<style>`.
 */
export async function buildFrontAssets(outDir, base) {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "site-front-kit-"));
  const frontOut = path.join(outDir, base, "front");
  try {
    copyModules(work);
    fs.writeFileSync(path.join(work, "kit-front.js"), KIT_FRONT_ENTRY);
    fs.copyFileSync(path.join(ROOT, "static/front/front.js"), path.join(work, "front.js"));

    fs.mkdirSync(frontOut, { recursive: true });
    await build({
      absWorkingDir: work,
      entryPoints: { front: "front.js" },
      outdir: frontOut,
      bundle: true,
      format: "esm",
      target: "es2022",
      minify: true,
      legalComments: "none",
    });

    const sheet = (name) => fs.readFileSync(path.join(KIT_ROOT, "css", name + ".css"), "utf8");
    const kitFontsPrefix = sitePath(base, "/vendor/village/kit/");
    // Keep only Latin IBM Plex Sans/Mono (400), Vox Text (400), and the inlined Vox Block & Vox Sign fonts.
    const kitBase = trimKitCss(sheet("_kit"))
      .replace(/@font-face\s*\{[^}]+\}/g, (face) =>
        /ibm-plex-sans-latin-wght|ibm-plex-mono-latin-400|vox-text-400|data:font/.test(face) ? face : "",
      )
      .replaceAll('url("fonts/', `url("${kitFontsPrefix}fonts/`);
    // Fittings tokens (including the Ridgeline print for the plain secondary keycap).
    const fittings = sheet("fittings").replace(/\s*--vx-lamp-print:[^;]+;/, "");
    // Instrument plain-key profile, Ridgeline print & shading blocks (so plain CSS matches live voxels).
    const instrumentKeyRules = (sheet("instrument").match(/^\[data-(?:profile|caps="field"|shell)\][^{]*\.vx-button[^{]*\{[^}]*\}/gm) ?? []).join("\n");
    const frontCss = fs.readFileSync(path.join(ROOT, "static/front/front.css"), "utf8");
    const rawCss = [kitBase, fittings, instrumentKeyRules, frontCss].join("\n");
    const { code } = await transform(rawCss, { loader: "css", minify: true });
    return code.trim();
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

// Before first paint: carry over any Day/Night or instrument finish chosen on /blog/ or the Signal Desk.
// Reduced motion keeps the voxels visible and still (SPEC.md, "Less motion"), so only forced colours,
// Save-Data, ?view=2d, or an explicit saved plain preference force data-vx-plain.
const EARLY_FRONT = `<script>
{
  const r = document.documentElement, q = new URLSearchParams(location.search).get("view");
  let t = null, p = null;
  try { t = localStorage.getItem("vx-sky") === "sf" ? ${SF_NIGHT} : localStorage.getItem("vx-theme"); p = localStorage.getItem("vx-plain"); } catch {}
  if (t === "dark" || t === "light") r.dataset.theme = t;
  try { const b = JSON.parse(sessionStorage.getItem("vx-instrument-build")); for (const k of ["shell", "caps", "profile", "rail"]) if (/^[a-z]+$/.test(b?.[k] ?? "")) r.dataset[k] = b[k]; } catch {}
  const plain = matchMedia("(forced-colors: active)").matches || navigator.connection?.saveData;
  if (p === "1" || q === "2d" || (q !== "3d" && plain)) r.setAttribute("data-vx-plain", "");
}
</script>`;

const DEV_RELOAD = `<script type="module">
const es = new EventSource("http://localhost:" + (Number(location.port) + 1) + "/events");
es.onmessage = () => location.reload();
</script>`;

function shareMetaFront(site, description) {
  const image = site.origin + sitePath(site.base, "/og/front.png");
  const url = site.origin + "/";
  const alt = `${site.title} — ${description}`;
  const tags = [
    ["og:type", "website"],
    ["og:site_name", site.title],
    ["og:title", site.title],
    ["og:description", description],
    ["og:url", url],
    ["og:image", image],
    ["og:image:type", "image/png"],
    ["og:image:width", CARD.width],
    ["og:image:height", CARD.height],
    ["og:image:alt", alt],
    ["twitter:card", "summary_large_image"],
    ["twitter:title", site.title],
    ["twitter:description", description],
    ["twitter:image", image],
    ["twitter:image:alt", alt],
  ];
  return tags
    .map(([key, value]) => `<meta ${key.startsWith("og:") ? "property" : "name"}="${key}" content="${e(String(value))}">`)
    .join("\n");
}

/** Generates the standalone HTML and Markdown twin for the personal front page at "/". */
export function frontPage(site, { dev = false, css = "" } = {}) {
  const at = (p) => sitePath(site.base, p);
  const blog = blogPath(site.base);
  const socials = frontSocials(site);
  const description = BIO;
  const fitted = Object.entries(FITTING)
    .map(([k, v]) => ` data-${k}="${v}"`)
    .join("");

  const html = `<!doctype html>
<html lang="${e(site.language)}" data-vx-look="lit"${fitted}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${e(site.title)}</title>
<meta name="description" content="${e(description)}">
<meta name="color-scheme" content="light dark">
${shareMetaFront(site, description)}
<link rel="canonical" href="${e(site.origin + "/")}">
<link rel="alternate" type="text/markdown" href="/index.md" title="This page as Markdown">
<link rel="alternate" type="application/atom+xml" href="${at("/feed.xml")}" title="${e(site.title)}">
<link rel="icon" href="${at("/favicon.svg")}" type="image/svg+xml">
<style>${css}</style>
${EARLY_FRONT}
${CLEAR_REALM_KEY}</head>
<body class="front-page" data-page="front">
<main class="front-column">
<header class="front-head">
<h1 class="vx-sign front-name" data-vx-board="none" data-vx-press="play">${e(site.title)}</h1>
<p class="front-bio">${e(BIO)}</p>
</header>
<nav aria-label="Primary">
<ul class="front-links">
<li><a class="vx-button front-world" data-vx-kind="main" href="${WORLD_URL}">Voxelwright World</a></li>
<li><a class="vx-button front-blog" href="${blog}">Blog</a></li>
</ul>
</nav>
<div class="vx-groove front-rule" role="separator"></div>
<nav aria-label="Elsewhere">
<ul class="front-socials">
${socials.map((l) => `<li><a href="${e(l.url)}" rel="me">${e(l.name)}</a></li>`).join("\n")}
</ul>
</nav>
</main>
<script type="module" src="${at("/front/front.js")}"></script>
${dev ? DEV_RELOAD : ""}</body>
</html>
`;

  const markdown = [
    `# ${site.title}`,
    "",
    BIO,
    "",
    `- [Voxelwright World](${WORLD_URL})`,
    `- [Blog](${site.origin}${blog})`,
    "",
    "## Elsewhere",
    "",
    ...socials.map((l) => `- [${l.name}](${l.url})`),
    "",
  ].join("\n");

  return { path: "/", kind: "front", title: site.title, description, html, markdown };
}
