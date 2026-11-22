// Starts Voxelmorphism on a page, and keeps the three choices a visitor makes once for the whole
// site: plain or voxels, day or night, sound or silence. The page is whole without this: the
// kit's stylesheet is its plain version, and its links, lists and article are HTML.
//
// Plain or voxels, the first answer wins (site-craft, "The 2D page and the 3D world"):
//   the visitor's saved choice (the foot's link, the city's Plain page); ?view=2d or ?view=3d;
//   reduced motion means plain; no WebGPU means plain. The home page is the exception: it is
//   always the full-screen city, plain only at /?view=2d (static/landing/home.js).
// The early script in each page's head has already set data-vx-plain from the first three, and
// data-theme from the saved night, so nothing changes under the reader.
import { adopt, use, ready, sound } from "/vendor/village/kit/src/index.js";
import { renderer } from "/vendor/village/blocks/renderer.js";

const root = document.documentElement;
const dark = matchMedia("(prefers-color-scheme: dark)");
const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} },
};

/** Whether the page is at night: the visitor's choice, else the system's. */
export const isNight = () => root.dataset.theme === "dark" || (root.dataset.theme !== "light" && dark.matches);

/** Set the time of day for the whole site. Sends vx-night ({ night }) from the document. */
export function setNight(night) {
  // back to the system's own setting when the choice matches it
  if (night === dark.matches) delete root.dataset.theme;
  else root.dataset.theme = night ? "dark" : "light";
  store.set("vx-theme", root.dataset.theme ?? null);
  document.dispatchEvent(new CustomEvent("vx-night", { detail: { night } }));
}
dark.addEventListener("change", () => document.dispatchEvent(new CustomEvent("vx-night", { detail: { night: isNight() } })));

/** Whether the visitor has turned sound on, anywhere on the site. */
export const soundOn = () => store.get("vx-sound") === "1";
/** Turn sound on or off for the whole site; call from a press, so a browser lets it start.
 *  Only the places with a sound control play anything (the Signal Desk, the city): the reading
 *  pages stay silent whatever this says. */
export function setSound(on) {
  store.set("vx-sound", on ? "1" : "0");
  sound(on);
}

/** Remember plain or voxels for the next pages (the link that asks then loads the page). */
export function choosePlain(plain) {
  store.set("vx-plain", plain ? "1" : null);
}

/** Resolves when the page is shown: at once, or when a page prepared ahead (prerendered) is
 *  opened. Nothing that opens a GPU device or plays a sound starts before then. */
export const shown = () =>
  document.prerendering
    ? new Promise((resolve) => document.addEventListener("prerenderingchange", resolve, { once: true }))
    : Promise.resolve();

let booted = null;
/**
 * Run the page's own setup (before), then make the page live: voxels where it may have them,
 * plain otherwise (plain: true keeps it plain whatever, as the city does while it draws the
 * page itself). Once per page, and only once the page is shown; resolves to the stage or null.
 */
export function boot({ before, plain = false } = {}) {
  return (booted ??= (async () => {
    // (only a prerendered page waits: on an ordinary load the bar's keys are set at once, as before)
    if (document.prerendering) await shown();
    lights();
    viewLink();
    if (plain || root.hasAttribute("data-vx-plain")) await use(null);
    else use(renderer());
    await before?.();
    adopt();
    const stage = await ready();
    root.dataset.vx = stage ? "live" : "plain";
    return stage;
  })());
}

// The Night key in the bar. It is the kit's toggle button: a press flips aria-pressed and sends
// vx-change; setting aria-pressed from here moves the key.
function lights() {
  const key = document.querySelector(".site-lights");
  if (!key) return;
  const show = () => key.setAttribute("aria-pressed", String(isNight()));
  key.hidden = false;
  show();
  key.addEventListener("vx-change", (event) => setNight(event.detail.pressed));
  document.addEventListener("vx-night", show);
}

// The foot's view link: from the voxel page to the plain one and back, remembered.
function viewLink() {
  const link = document.querySelector(".site-view");
  // the home page has its own: City view on the plain page, Plain page in the city
  if (!link || document.body.dataset.page === "home") return;
  const plain = root.hasAttribute("data-vx-plain");
  link.hidden = false;
  if (plain) {
    link.textContent = "Voxel page";
    const url = new URL(location.href);
    url.searchParams.set("view", "3d");
    link.href = url.pathname + url.search + url.hash;
  }
  link.addEventListener("click", () => choosePlain(!plain));
}

// A device that is lost for good leaves the page plain; its controls keep working.
document.addEventListener("vx-plain", () => { root.dataset.vx = "plain"; });

// A page with its own script (data-boot="page") calls boot() itself, with its setup.
if (document.body.dataset.boot !== "page") boot();
