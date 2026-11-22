// The 404 page: name the address that was asked for, and let the fog drift.
// Without this script the page is whole: the sign's links work and the fog stands still in CSS.
// Reduced motion and forced colours keep that still fog; the fog stops if either turns on later.

const host = document.querySelector(".lost");
const canvas = host?.querySelector(".lost-fog");

/** The asked-for address as people typed it: decoded where it can be, shortened in the middle. */
export function shown(pathname, search = "") {
  let p = pathname + search;
  try {
    p = decodeURI(p);
  } catch {}
  return p.length > 96 ? p.slice(0, 64) + "…" + p.slice(-28) : p;
}

const where = host?.querySelector(".lost-where");
if (where) {
  const code = document.createElement("code");
  code.className = "lost-path";
  code.textContent = shown(location.pathname, location.search);
  where.replaceWith(code);
}

const calm = [matchMedia("(prefers-reduced-motion: reduce)"), matchMedia("(forced-colors: active)")];
let stop = null;
async function settle() {
  const still = calm.some((m) => m.matches);
  if (still && stop) {
    stop();
    stop = null;
  } else if (!still && !stop && canvas) {
    const { startFog } = await import("./fog.js");
    // a query may have changed while the module loaded
    if (!stop && !calm.some((m) => m.matches)) stop = startFog(canvas, host);
  }
}
if (host) {
  for (const m of calm) m.addEventListener("change", settle);
  settle();
}
