// Feature flags. A feature is a folder, features/<name>/. It ships only when site.config.mjs
// says `flags: { "<name>": true }`. With its flag off (or absent) the build never reads the
// folder, so the output is the same, file for file, as if the feature did not exist.
// `npm run flag-proof` checks exactly that.

export const FLAG_NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * The names of the features that are on.
 * @param {object} site  site.config.mjs
 * @param {object} [options]
 * @param {boolean} [options.dev]  A dev build also turns on the names in SITE_FLAGS
 *   (comma separated), so a feature can be looked at locally before its flag is flipped.
 *   A production build ignores SITE_FLAGS.
 * @returns {{ on: string[], errors: string[] }}
 */
export function flagsOn(site, { dev = false, env = process.env } = {}) {
  const errors = [];
  const on = new Set();
  const flags = site.flags ?? {};
  if (typeof flags !== "object" || Array.isArray(flags)) return { on: [], errors: ["site.config.mjs: flags must be an object of name: true or false."] };
  for (const [name, value] of Object.entries(flags)) {
    if (!FLAG_NAME.test(name)) errors.push(`site.config.mjs: flag "${name}" must be lower-case words joined by hyphens.`);
    else if (typeof value !== "boolean") errors.push(`site.config.mjs: flag "${name}" must be true or false, not ${JSON.stringify(value)}.`);
    else if (value) on.add(name);
  }
  if (dev && env.SITE_FLAGS) {
    for (const name of env.SITE_FLAGS.split(",").map((s) => s.trim()).filter(Boolean)) {
      if (!FLAG_NAME.test(name)) errors.push(`SITE_FLAGS: "${name}" is not a flag name.`);
      else on.add(name);
    }
  }
  return { on: [...on].sort(), errors };
}
