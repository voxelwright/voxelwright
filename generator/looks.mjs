import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

// The site's looks. Each is a stylesheet in static/looks/<name>.css that replaces
// static/style.css, plus the Shiki theme pair its code blocks use. site.config.mjs picks one
// with `look`; with no look the baseline style.css and the GitHub pair are used.
export const LOOKS = {
  notebook: { code: ["gruvbox-light-hard", "gruvbox-dark-medium"] },
  street: { code: ["vitesse-light", "vitesse-dark"] },
  editorial: { code: ["min-light", "min-dark"] },
};

// Designs: designs/<name>/design.mjs (default export { code: [light, dark] }), with an optional
// pages.mjs that replaces generator/pages.mjs (same exports) and a static/ folder copied over
// static/ (its style.css replaces the baseline). A design is picked like a look; SITE_LOOK in
// the environment overrides site.config.mjs, so two designs can be built side by side.
const DESIGNS_DIR = path.resolve(import.meta.dirname, "../designs");
export const DESIGNS = {};
for (const name of fs.existsSync(DESIGNS_DIR) ? fs.readdirSync(DESIGNS_DIR).sort() : []) {
  const dir = path.join(DESIGNS_DIR, name);
  const file = path.join(dir, "design.mjs");
  if (!fs.existsSync(file)) continue;
  const pagesFile = path.join(dir, "pages.mjs");
  DESIGNS[name] = {
    ...(await import(pathToFileURL(file).href)).default,
    dir,
    pages: fs.existsSync(pagesFile) ? await import(pathToFileURL(pagesFile).href) : null,
  };
  LOOKS[name] = { code: DESIGNS[name].code };
}

/** The look to build: SITE_LOOK from the environment, else the configured one. */
export function chosenLook(site) {
  return process.env.SITE_LOOK || site.look;
}

/** Output folder name for a build kind ("dist" or ".dev"), suffixed when SITE_LOOK is set. */
export function outName(kind) {
  return kind + (process.env.SITE_LOOK ? `-${process.env.SITE_LOOK}` : "");
}

export const BASELINE_CODE = ["github-light", "github-dark"];

/** The stylesheet URL for a look, or the baseline. Throws on an unknown look. */
export function lookStylesheet(look) {
  if (!look) return "/style.css";
  if (DESIGNS[look]) return "/style.css";
  if (!LOOKS[look]) throw new Error(`site.config.mjs: unknown look "${look}". Known: ${Object.keys(LOOKS).join(", ")}.`);
  return `/looks/${look}.css`;
}
