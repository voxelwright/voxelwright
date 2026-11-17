// Loads the features whose flag is on. See lib/flags.mjs and features/README.md.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { flagsOn } from "../lib/flags.mjs";

/**
 * @returns {Promise<{ features: { name: string, dir: string, staticDir: string | null, hooks: object }[], errors: string[] }>}
 *   Features in name order. Nothing under featuresDir is read for a feature that is off.
 */
export async function loadFeatures(site, { featuresDir, dev = false }) {
  const { on, errors } = flagsOn(site, { dev });
  const features = [];
  for (const name of on) {
    const dir = path.join(featuresDir, name);
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
      errors.push(`Flag "${name}" is on, but there is no features/${name}/ folder.`);
      continue;
    }
    const file = path.join(dir, "feature.mjs");
    let hooks = {};
    if (fs.existsSync(file)) {
      hooks = (await import(pathToFileURL(file).href)).default ?? {};
      for (const key of Object.keys(hooks)) {
        if (!["head", "bodyEnd", "pages"].includes(key) || typeof hooks[key] !== "function") errors.push(`features/${name}/feature.mjs: "${key}" is not a hook. Hooks are the functions head, bodyEnd and pages.`);
      }
    }
    const staticDir = path.join(dir, "static");
    features.push({ name, dir, staticDir: fs.existsSync(staticDir) ? staticDir : null, hooks });
  }
  return { features, errors };
}

/** Adds each feature's head and bodyEnd output to a finished page. */
export function inject(html, page, site, features) {
  const head = features.map((f) => f.hooks.head?.(page, site) ?? "").join("");
  const end = features.map((f) => f.hooks.bodyEnd?.(page, site) ?? "").join("");
  if (head) {
    const at = html.indexOf("</head>");
    if (at < 0) throw new Error(`A feature adds to <head>, but the layout for ${page.path ?? "a page"} has no </head>.`);
    html = html.slice(0, at) + head + html.slice(at);
  }
  if (end) {
    const at = html.lastIndexOf("</body>");
    if (at < 0) throw new Error(`A feature adds to the end of <body>, but the layout for ${page.path ?? "a page"} has no </body>.`);
    html = html.slice(0, at) + end + html.slice(at);
  }
  return html;
}
