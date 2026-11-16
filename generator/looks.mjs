// The site's looks. Each is a stylesheet in static/looks/<name>.css that replaces
// static/style.css, plus the Shiki theme pair its code blocks use. site.config.mjs picks one
// with `look`; with no look the baseline style.css and the GitHub pair are used.
export const LOOKS = {
  notebook: { code: ["gruvbox-light-hard", "gruvbox-dark-medium"] },
  street: { code: ["vitesse-light", "vitesse-dark"] },
  editorial: { code: ["min-light", "min-dark"] },
};

export const BASELINE_CODE = ["github-light", "github-dark"];

/** The stylesheet URL for a look, or the baseline. Throws on an unknown look. */
export function lookStylesheet(look) {
  if (!look) return "/style.css";
  if (!LOOKS[look]) throw new Error(`site.config.mjs: unknown look "${look}". Known: ${Object.keys(LOOKS).join(", ")}.`);
  return `/looks/${look}.css`;
}
