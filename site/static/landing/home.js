import { installEggs } from "./eggs.js";
import { boot, choosePlain, isNight, setNight, soundOn, setSound } from "/site.js";
import { project } from "./survey.js";
import { printCard, postcardDialog, shutter } from "./postcard.js";

const root = document.querySelector(".overlook");
const view = root.querySelector(".park-view");
const canvas = view.querySelector(".park-canvas");
const still = view.querySelector(".park-still");
const poster = view.querySelector(".park-skyline");
const controls = root.querySelector(".park-tools");
const menu = controls.querySelector("details");
const summary = menu.querySelector("summary");
const panel = menu.querySelector("fieldset");
const timeButton = controls.querySelector("[data-time]");
const pauseButton = controls.querySelector("[data-pause]");
const soundButton = controls.querySelector("[data-sound]");
const liveLink = root.querySelector('[data-view="3d"]');
const plainPostcard = root.querySelector("[data-postcard-plain]");
const flash = view.querySelector(".postcard-flash");
const cards = postcardDialog(root.querySelector(".postcard"));
const nodes = new Map([...root.querySelectorAll("[data-sign]")].map((el) => [el.dataset.sign, el]));
const support = document.querySelector("support-button");
const calm = matchMedia("(prefers-reduced-motion: reduce)");
const contrast = matchMedia("(forced-colors: active)");
const dark = matchMedia("(prefers-color-scheme: dark)");
// The home page is always the city. Reduced motion, forced colours and Save-Data keep its still
// (no moving world); only the plain address (?view=2d, set by the head's early script) is plain.
const stillPreferred = () => calm.matches || contrast.matches || navigator.connection?.saveData;
const plain = document.documentElement.hasAttribute("data-vx-plain");
const request = new AbortController();
let index,
  signs,
  drawStill,
  stage,
  world,
  stopGPU = false,
  startupTimer;
let raf = 0,
  last = 0,
  submitted = false,
  paused = false,
  night = isNight(),
  flight;
let supportSource;
let lastFrame,
  lastRevision = -1,
  stillDirty = true,
  ready = false;
// A postcard waiting on the live renderer: one frame without the directory, read, then restored.
let shot = null;
const eggs = installEggs(root, {
  world: () => world,
  project,
  schedule,
  broken: (value) => change({ broken: value }),
  // The directory as a digital billboard while an egg runs (see signs.js).
  billboard(values) {
    if ("billboard" in values) pauseButton.setAttribute("aria-label", values.billboard === "video" ? "Pause the video" : "Pause flight");
    change(values);
  },
  hush,
  paused: () => paused,
});

function change(values) {
  if (!signs) return;
  if (!signs.update(values)) return;
  stillDirty = true;
  schedule();
}

for (const link of [...root.querySelectorAll("[data-view]"), document.querySelector(".skip")]) {
  link.addEventListener("click", (e) => {
    if (e.defaultPrevented || e.button || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    choosePlain((link.dataset.view ?? "2d") === "2d");
  });
}
if (location.hash === "#about-view") root.querySelector(".park-credit").open = true;

function projectHits(frame, w, h) {
  if (lastFrame === frame && signs.revision === lastRevision) return;
  lastFrame = frame;
  lastRevision = signs.revision;
  const visible = new Set();
  for (const hit of signs.hits) {
    const el = nodes.get(hit.id);
    const corners = hit.points.map((p) => project(p, frame, w, h));
    const left = Math.min(...corners.map((p) => p[0])),
      right = Math.max(...corners.map((p) => p[0]));
    const top = Math.min(...corners.map((p) => p[1])),
      bottom = Math.max(...corners.map((p) => p[1]));
    if (corners.some((p) => p[2] < 80) || left >= w || right <= 0 || top >= h || bottom <= 0) continue;
    const width = right - left,
      height = bottom - top;
    visible.add(hit.id);
    el.style.left = left + "px";
    el.style.top = top + "px";
    el.style.width = width + "px";
    el.style.height = height + "px";
    el.style.clipPath =
      "polygon(" +
      corners.map(([x, y]) => ((x - left) / width) * 100 + "% " + ((y - top) / height) * 100 + "%").join(",") +
      ")";
    el.setAttribute("data-hit", "");
  }
  for (const [id, el] of nodes) if (!visible.has(id)) el.removeAttribute("data-hit");
}

function drawPoster() {
  const w = view.clientWidth,
    h = view.clientHeight;
  signs.size(w, h);
  const crop = signs.crop,
    frame = signs.camera(0);
  poster.style.cssText = `left:${crop.left}px;top:${crop.top}px;width:${index.camera.size[0] * crop.scale}px;height:${index.camera.size[1] * crop.scale}px`;
  drawStill(still, signs, frame, w, h, index.sun.vector);
  projectHits(frame, w, h);
  stillDirty = false;
}

function resetTiming() {
  last = 0;
  world?.cadence.resume();
}
function schedule() {
  if (ready && !raf && !document.hidden) raf = requestAnimationFrame(tick);
}
function tick(now) {
  raf = 0;
  if (!ready || document.hidden) return;
  if (!world) {
    if (stillDirty) {
      try {
        drawPoster();
      } catch {
        plainPage();
      }
    }
    return;
  }
  if (submitted) return schedule();
  const busy = !!flight || !!shot || world.time.told.moving || world.leaning || world.arriving || world.changing;
  if (!paused || busy) {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const action = world.cadence.frame(
      now,
      view.clientWidth * view.clientHeight * dpr * dpr,
      !busy,
    );
    if (action === "plain") return fallback();
    if (action === "skip") return schedule();
    if (action === "lower") {
      world.lowerQuality();
      panel.elements.preset.value = world.settings.preset;
      change({ settings: { ...world.settings } });
    }
  }
  const dt = last ? Math.min(0.075, (now - last) / 1000) : 0;
  last = now;
  if (flight) {
    const t = Math.min(1, (now - flight.start) / 490);
    world.flight(t * t * (3 - 2 * t) * flight.direction);
  }
  try {
    world.draw(dt, !paused);
    if (shot) develop();
    projectHits(world.frame, view.clientWidth, view.clientHeight);
    planeSound();
    submitted = true;
    stage.device.queue.onSubmittedWorkDone().then(() => {
      submitted = false;
    }, fallback);
  } catch {
    fallback();
    return;
  }
  if (!paused || busy || world.leaning) schedule();
}
// A WebGPU canvas only holds its picture until the frame is presented, so the copy is made here,
// in the task that submitted the frame. The next frame puts the directory back.
function develop() {
  if (shot.phase === "hide") {
    const copy = document.createElement("canvas");
    copy.width = canvas.width;
    copy.height = canvas.height;
    copy.getContext("2d").drawImage(canvas, 0, 0);
    shot.frame = copy;
    shot.phase = "restore";
    change({ postcard: false });
  } else {
    const done = shot;
    shot = null;
    resetTiming();
    done.resolve(done.frame);
  }
}
function resetFlight() {
  if (flight) clearTimeout(flight.timer);
  flight = null;
  world?.flight(0);
  resetTiming();
  schedule();
}

function fallback() {
  if (stopGPU) return;
  stopGPU = true;
  clearTimeout(startupTimer);
  request.abort();
  const focus = document.activeElement?.closest("[data-sign]")?.dataset.sign;
  world = null;
  eggs.lost();
  if (shot) {
    // The still or the plain page takes this postcard instead.
    shot.resolve(null);
    shot = null;
  }
  audio?.then((a) => a.stop());
  stage?.destroy();
  stage = null;
  canvas.hidden = true;
  delete root.dataset.live;
  delete root.dataset.hour;
  if (ready) {
    still.hidden = false;
    menu.open = false;
    change({ live: false, open: false, postcard: false });
    try {
      drawPoster();
    } catch {
      plainPage();
      return;
    }
    if (focus && !nodes.get(focus)?.hasAttribute("data-hit"))
      nodes.get("plain-still").focus({ preventScroll: true });
  }
}
function plainPage() {
  ready = false;
  delete document.documentElement.dataset.city;
  fallback();
  delete root.dataset.scene;
  delete root.dataset.starting;
  support.inert = false;
  support.measure?.(true);
  controls.hidden = still.hidden = true;
  poster.removeAttribute("style");
  menu.open = false;
  for (const el of nodes.values()) {
    el.removeAttribute("style");
    el.removeAttribute("data-hit");
  }
  liveLink.hidden = plainPostcard.hidden = false;
  if (nodes.has(document.activeElement?.dataset.sign)) nodes.get("blog").focus({ preventScroll: true });
  view.classList.add("vx-recess");
  boot();
}
function viewsChanged() {
  // also while the GPU is still starting: fallback() stops the start and keeps the still
  if (stillPreferred() && ready) fallback();
}
calm.addEventListener("change", viewsChanged);
contrast.addEventListener("change", viewsChanged);

function showSupport(button) {
  supportSource = button;
  support.inert = false;
  const b = button.getBoundingClientRect();
  document.documentElement.style.setProperty(
    "--dock-x",
    Math.min(innerWidth - 70, Math.max(12, b.x + b.width / 2 - 30)) + "px",
  );
  document.documentElement.style.setProperty("--dock-y", Math.max(8, b.top - 72) + "px");
  support.setAttribute("data-summoned", "");
  customElements.whenDefined("support-button").then(() => {
    if (support.hasAttribute("data-summoned")) support.summon();
  });
}
for (const id of ["support", "support-still"])
  nodes.get(id).addEventListener("click", (e) => showSupport(e.currentTarget));
function dismissSupport(restore = false) {
  if (!support.hasAttribute("data-summoned")) return;
  support.removeAttribute("data-summoned");
  support.inert = ready;
  if (restore)
    (supportSource?.hasAttribute("data-hit") ? supportSource : summary).focus({ preventScroll: true });
}
function menuChanged() {
  if (!ready) return;
  dismissSupport();
  change({ open: menu.open, hover: "", pressed: "" });
}
menu.addEventListener("toggle", menuChanged);
menu.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && menu.open) {
    e.preventDefault();
    menu.open = false;
    summary.focus({ preventScroll: true });
  }
});
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape" || e.defaultPrevented) return;
  if (e.composedPath()[0].getRootNode() instanceof ShadowRoot) {
    if (support.hasAttribute("data-summoned") && support.state === "idle") {
      e.preventDefault();
      dismissSupport(true);
    }
    return;
  }
  if (flight) resetFlight();
  if (menu.open) {
    menu.open = false;
    summary.focus({ preventScroll: true });
  }
});

const idOf = (e) => e.target.closest?.("[data-sign]:not(.fixture-face)")?.dataset.sign ?? "";
for (const [event, key] of [
  ["pointerover", "hover"],
  ["focusin", "focus"],
  ["pointerdown", "pressed"],
]) {
  root.addEventListener(event, (e) => {
    const id = idOf(e);
    if (!ready || !id || (key === "focus" && !e.target.matches(":focus-visible"))) return;
    change({ [key]: id });
  });
}
root.addEventListener("pointerout", (e) => {
  if (ready && idOf(e) && !e.target.closest("[data-sign]").contains(e.relatedTarget)) change({ hover: "" });
});
root.addEventListener("focusout", (e) => {
  if (ready && idOf(e)) change({ focus: "" });
});
for (const type of ["pointerup", "pointercancel"])
  window.addEventListener(type, () => {
    if (ready) change({ pressed: "" });
  });
root.querySelector(".park-sign").addEventListener("click", (e) => {
  const a = e.target.closest("a");
  if (
    !world ||
    !a ||
    a.hash ||
    !e.detail ||
    e.button ||
    e.ctrlKey ||
    e.shiftKey ||
    e.altKey ||
    e.metaKey ||
    e.defaultPrevented
  )
    return;
  e.preventDefault();
  resetFlight();
  cue("depart");
  const href = a.href;
  flight = {
    start: performance.now(),
    direction: a.pathname === "/blog/" ? 1 : -0.85,
    timer: setTimeout(() => location.assign(href), 500),
  };
  schedule();
});
window.addEventListener("pageshow", resetFlight);
// Lean with a fine pointer. Touch, menus and departures keep the surveyed pose.
const fine = matchMedia("(hover: hover) and (pointer: fine)");
function aim(x = 0, y = 0) {
  if (!world) return;
  world.aim(x, y);
  if (world.leaning) schedule();
}
view.addEventListener("pointermove", (e) => {
  // Pause holds every ambient movement, the lean included, wherever it rests.
  if (paused) return;
  if (!fine.matches || e.pointerType !== "mouse" || menu.open || flight) return aim();
  const r = view.getBoundingClientRect();
  const clamp = (v) => Math.max(-1, Math.min(1, v));
  aim(clamp(((e.clientX - r.left) / r.width) * 2 - 1), clamp(((e.clientY - r.top) / r.height) * 2 - 1));
});
view.addEventListener("pointerleave", () => paused || aim());
menu.addEventListener("toggle", () => menu.open && aim());
document.addEventListener("visibilitychange", () => {
  resetTiming();
  schedule();
});
new ResizeObserver(() => {
  stillDirty = true;
  schedule();
}).observe(view);
function online() {
  change({ offline: !navigator.onLine });
}
window.addEventListener("online", online);
window.addEventListener("offline", online);

// Sound is off until the visitor turns it on. A saved choice waits for their
// first press or key on the page before anything plays.
// It is the site's one sound choice (static/site.js), shared with the Signal Desk and the keys.
let audio,
  wantSound = soundOn(),
  // While a video egg plays its own sound, the city's waits (see hush).
  hushed = false;
function hear(on) {
  wantSound = on;
  setSound(on);
  soundButton.setAttribute("aria-pressed", String(on));
  soundButton.textContent = on ? "Mute" : "Sound";
  change({ sound: on });
  if (!on) return audio?.then((a) => a.stop());
  // Create the context inside the gesture; Safari will not start one later.
  if (!audio) {
    const ctx = new AudioContext();
    audio = import("./sound.js").then(({ soundscape }) => {
      const a = soundscape(ctx);
      a.night(night);
      return a;
    });
  }
  audio.then((a) => wantSound && !hushed && a.start());
}
// A video egg brings its own sound, which the visitor asked for by starting it. The
// city's soundscape steps aside while it plays and comes back after, and the saved
// Sound choice is never changed.
function hush(on) {
  hushed = on;
  audio?.then((a) => (on || !world ? a.stop() : wantSound && a.start()));
}
soundButton.addEventListener("click", () => hear(!wantSound));
function arm() {
  if (wantSound && !audio && !world) return;
  removeEventListener("pointerup", arm, true);
  removeEventListener("keydown", arm, true);
  if (wantSound && !audio) hear(true);
}
addEventListener("pointerup", arm, true);
addEventListener("keydown", arm, true);
function cue(name) {
  if (wantSound && !hushed) audio?.then((a) => a.on && a[name]());
}
root.addEventListener("click", (e) => {
  const id = e.target.closest?.("[data-sign]:not(.fixture-face)")?.dataset.sign;
  if (world && id && id !== "sound" && id !== "postcard") cue("clack");
});
document.addEventListener("visibilitychange", () => {
  if (!audio) return;
  audio.then((a) => (document.hidden || !world || hushed ? a.stop() : wantSound && a.start()));
});
function planeSound() {
  if (!wantSound || !audio || !world || hushed) return;
  const w = view.clientWidth,
    h = view.clientHeight;
  const [x, , z] = project(world.cloth.from, world.frame, w, h);
  const across = (x / w) * 2 - 1;
  const level = z > 0 && !paused ? Math.max(0, 1 - Math.max(0, Math.abs(across) - 1) * 1.5) : 0;
  audio.then((a) => a.on && a.plane(across, level));
}

// Postcards. The live city, its still and the plain page each print from their own picture.
function snapLive() {
  return new Promise((resolve) => {
    shot = { phase: "hide", resolve };
    change({ postcard: true });
    schedule();
  });
}
async function snapStill() {
  await poster.decode().catch(() => {});
  const w = view.clientWidth,
    h = view.clientHeight,
    ratio = Math.min(devicePixelRatio || 1, 2);
  signs.size(w, h);
  const crop = signs.crop;
  const out = document.createElement("canvas");
  out.width = Math.round(w * ratio);
  out.height = Math.round(h * ratio);
  const c = out.getContext("2d");
  c.fillStyle = "#8db9df";
  c.fillRect(0, 0, out.width, out.height);
  const [pw, ph] = index.camera.size;
  c.drawImage(poster, crop.left * ratio, crop.top * ratio, pw * crop.scale * ratio, ph * crop.scale * ratio);
  signs.update({ postcard: true });
  signs.size(w, h);
  const fixtures = document.createElement("canvas");
  drawStill(fixtures, signs, signs.camera(0), w, h, index.sun.vector);
  c.drawImage(fixtures, 0, 0, out.width, out.height);
  signs.update({ postcard: false });
  signs.size(w, h);
  return out;
}
let printing = false;
// A key press gets no flash and no rise (motion is not used on keyboard-driven actions).
async function makePostcard(source, keyed) {
  if (printing || cards.open) return;
  printing = true;
  const date = new Date();
  let release = () => {};
  try {
    if (menu.open) {
      // The panel reframes the view and stills the lean; the card shows the view it covered.
      menu.open = false;
      change({ open: false });
    }
    if (ready && !keyed) release = shutter(flash);
    cue("shutter");
    let frame = world ? await snapLive() : null;
    // Night only if the live renderer took it; a fallback mid-shot prints the daytime still.
    const lit = !!frame && night;
    let anchor = [0.5, 0.5];
    if (!frame && ready) frame = await snapStill();
    if (!frame) {
      await poster.decode().catch(() => {});
      frame = poster;
      anchor = [0.45, 0.5]; // the whole panorama: keep the Pyramid and Salesforce Tower central
    }
    const card = await printCard(frame, { night: lit, date, anchor });
    release();
    await cards.show(card, { night: lit, date, keyed }, () => {
      const back = !root.hasAttribute("data-scene") || source.hasAttribute("data-hit") ? source : world ? summary : nodes.get("plain-still");
      back.focus({ preventScroll: true });
    });
  } finally {
    release();
    printing = false;
  }
}
nodes.get("postcard").addEventListener("click", (e) => makePostcard(e.currentTarget, !e.detail));
plainPostcard.addEventListener("click", (e) => makePostcard(e.currentTarget, !e.detail));

function setTime(next) {
  if (!world) return;
  night = next;
  root.dataset.hour = night ? "night" : "day";
  timeButton.setAttribute("aria-pressed", String(night));
  timeButton.textContent = night ? "Day" : "Night";
  world.time.to(night ? "night" : "day");
  audio?.then((a) => a.night(night));
  resetTiming();
  change({ night });
}
// Night is the site's: the Night key in the bar, this sign and the system all set it.
timeButton.addEventListener("click", (e) => {
  setNight(!night);
  eggs.night(e.timeStamp);
});
document.addEventListener("vx-night", (e) => setTime(e.detail.night));
pauseButton.addEventListener("click", () => {
  if (!world) return;
  paused = !paused;
  pauseButton.setAttribute("aria-pressed", String(paused));
  pauseButton.textContent = paused ? "Play flight" : "Pause flight";
  eggs.hold(paused);
  planeSound();
  resetTiming();
  change({ paused });
});
const scale = panel.elements.scale;
function syncSettings() {
  const settings = world.settings;
  panel.elements.preset.value = settings.preset;
  panel.elements.target.value = settings.target;
  panel.elements.dynamic.checked = settings.dynamic;
  scale.value = Math.round(settings.scale * 100);
  const value = scale.value + "%";
  panel.querySelector("[data-scale-value]").textContent = value;
  scale.setAttribute("aria-valuetext", value);
  change({ settings: { ...settings } });
}
panel.addEventListener("input", () => {
  if (!world) return;
  world.configure({
    scale: scale.valueAsNumber / 100,
    dynamic: panel.elements.dynamic.checked,
    preset: panel.elements.preset.value,
    target: Number(panel.elements.target.value),
  });
  syncSettings();
  resetTiming();
});

async function start() {
  // Never start the world in a page prepared ahead (prerendered from the address bar): wait to be shown.
  if (document.prerendering) await new Promise((r) => document.addEventListener("prerenderingchange", r, { once: true }));
  if (plain) {
    liveLink.hidden = plainPostcard.hidden = false;
    delete document.documentElement.dataset.city;
    view.classList.add("vx-recess");
    boot();
    return;
  }
  root.dataset.starting = "";
  const [r, signModule, rendererModule] = await Promise.all([
    fetch("/landing/place.json"),
    import("./signs.js"),
    import("./sign-renderer.js"),
  ]);
  drawStill = rendererModule.drawStill;
  if (!r.ok) throw Error("City index unavailable");
  index = await r.json();
  signs = signModule.signScene(index, root.querySelector("h1").textContent);
  root.dataset.scene = "";
  delete root.dataset.starting;
  // the city draws this page itself; the kit's parts (hidden under it) keep their behaviour only
  boot({ plain: true });
  support.inert = true;
  ready = true;
  controls.hidden = still.hidden = false;
  change({ broken: !root.querySelector(".park-log").hidden, offline: !navigator.onLine, night });
  drawPoster();
  Promise.allSettled([
    document.fonts.load('560 40px "Source Serif 4"'),
    document.fonts.load('650 40px "IBM Plex Sans"'),
  ]).then(() => change({}));
  if (!navigator.gpu || stopGPU || stillPreferred()) return;
  startupTimer = setTimeout(fallback, 12000);
  const [{ renderer }, { place }] = await Promise.all([
    import("/vendor/village/blocks/renderer.js"),
    import("./place.js"),
  ]);
  if (stopGPU) return;
  const kit = await renderer();
  if (!kit) return fallback();
  if (stopGPU) {
    kit.stage.destroy();
    return;
  }
  stage = kit.stage;
  const device = stage.device;
  device.lost.then(fallback);
  device.addEventListener("uncapturederror", fallback);
  let arrive = true;
  try {
    arrive = !sessionStorage.getItem("park.arrived");
    sessionStorage.setItem("park.arrived", "1");
  } catch {}
  const live = await place(canvas, device, night, request.signal, index, signs, arrive);
  if (stopGPU) return;
  // Keep the still and its links usable until a complete GPU frame is presented.
  canvas.hidden = false;
  live.resizeMoon(eggs.moonRadius);
  live.draw(0, false);
  await device.queue.onSubmittedWorkDone();
  if (stopGPU) return;
  clearTimeout(startupTimer);
  world = live;
  root.dataset.live = "";
  still.hidden = true;
  if (document.activeElement?.closest('[data-sign$="-still"]')) {
    summary.dataset.hit = "";
    summary.focus({ preventScroll: true });
  }
  change({ live: true, paused, sound: wantSound });
  soundButton.setAttribute("aria-pressed", String(wantSound));
  soundButton.textContent = wantSound ? "Mute" : "Sound";
  syncSettings();
  setTime(isNight());
}
start().catch(() => {
  if (ready) fallback();
  else plainPage();
});
