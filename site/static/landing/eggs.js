// Original line drawing from the park's east-southeast view.
const greeting = String.raw`Hello there.
                 |        __
         /\     /|\      |  |
   _[]__/  \_[]/ | \__[]_|  |___
 ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
General Kenobi.
If you managed to find this, you can send your resume… oh wait I'm not hiring, nvm.`;

const code = "↑↑↓↓←→←→ba";
const arrows = { ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→" };
const phrases = new Map([
  [code, "lives"], ["iddqd", "god"], ["do a barrel roll", "roll"],
  ["wake up", "rain"], ["neo", "rain"], ["red pill", "rain"], ["follow the white rabbit", "rain"], ["blue pill", "unplug"],
  ["rickroll", "rickroll"], ["never gonna give you up", "rickroll"], ["bad apple", "apple"],
]);
const RICK = "Never gonna give you up";
const longest = Math.max(...[...phrases.keys()].map((p) => p.length));
const radii = [0.017, 0.028, 0.044];

import { codeRain } from "./matrix.js";
import { videoProgram } from "./video.js";

// Videos on the window screen. Each is a small MP4 (frames at window resolution and
// the audio; see scripts/landing/encode-eggs.mjs), fetched only when its egg starts.
// 'still' is the second shown when an egg starts under Pause; 'outside' is what the
// panes beyond the picture show (null keeps the city's own windows).
const videos = {
  rickroll: {
    src: new URL("eggs/rick.mp4", import.meta.url).href,
    title: "Never Gonna Give You Up",
    palette: "rick",
    still: 20,
    // A dim frame around the picture so it reads as a screen; the lamps show through.
    outside: [14, 8, 22, 190],
    contrast: 1.25,
    start: "Never gonna give you up. Rick Astley is on every window in the city.",
    end: "Never gonna let you down: that was the whole song.",
  },
  apple: {
    src: new URL("eggs/bad-apple.mp4", import.meta.url).href,
    title: "Bad Apple!!",
    palette: "apple",
    still: 62,
    outside: [0, 0, 0, 240],
    contrast: 1.1,
    start: "Bad Apple!! The city plays it in shadow.",
    end: "Bad Apple!! is over. The lights come back on.",
  },
};

export function installEggs(root, { world, project, schedule, broken, billboard, hush, paused }) {
  console.info(greeting);
  const view = root.querySelector(".park-view");
  const canvas = view.querySelector("canvas");
  const links = [...root.querySelectorAll(".park-sign a:has(.breakable-b)")];
  let link = links[0];
  const blog = link.getAttribute("href");
  const log = root.querySelector(".park-log");
  const secrets = root.querySelector(".park-secrets");
  const status = root.querySelector(".egg-status");
  const calm = matchMedia("(prefers-reduced-motion: reduce)");
  const moon = secrets.querySelector('[data-egg="moon"]');
  const god = secrets.querySelector('[data-egg="god"]');
  const wake = secrets.querySelector('[data-egg="rain"]');
  const exit = root.querySelector('[data-sign="matrix-exit"]');
  const mute = root.querySelector('[data-sign="video-mute"]');
  const stopper = root.querySelector('[data-sign="video-stop"]');
  for (const [name, v] of Object.entries(videos)) v.button = secrets.querySelector(`[data-egg="${name}"]`);
  // What the windows are doing: null, { kind: "matrix" } or { kind: "video", ... }.
  let egg = null;
  // The tow banner's message, so a second tap on "Never gonna give you up" plays it.
  let banner = "";
  // Night presses, for Bad Apple's black and white.
  let flips = [];
  let size = 0;
  let shield = false;
  let buffer = "";
  let lastKey = 0;
  let press;
  let spent = false;

  secrets.hidden = false;
  function say(message) {
    status.textContent = message;
  }
  // Both cameos are hand-drawn cell by cell. One pixel in the pattern is two CSS pixels.
  function sprite(rows, colours) {
    const art = document.createElement("canvas");
    art.ariaHidden = "true";
    art.width = rows[0].length;
    art.height = rows.length;
    const ctx = art.getContext("2d");
    rows.forEach((row, y) => [...row].forEach((cell, x) => {
      if (!colours[cell]) return;
      ctx.fillStyle = colours[cell];
      ctx.fillRect(x, y, 1, 1);
    }));
    return art;
  }
  const car = root.querySelector(".offline-car");
  const carriage = sprite([".wwwwwwwwww.", "..y..y..y...", "..y..y..y...", ".rrrrrrrrrr.", ".ryyyyyyyyr.", "wwwwwwwwwwww", "..ww....ww.."], { w: "#554631", y: "#edcd83", r: "#a24a32" });
  car.firstChild.append(carriage);
  function offline() {
    car.hidden = navigator.onLine;
  }
  offline();
  window.addEventListener("online", offline);
  window.addEventListener("offline", offline);
  car.addEventListener("click", () => {
    car.toggleAttribute("data-across");
    say(car.hasAttribute("data-across") ? "The cable car cleared the rooftop." : "Back at the first stop.");
  });
  function dancer() {
    const sign = root.querySelector(".park-sign");
    sign.querySelector(".sign-dancer")?.remove();
    const person = sprite(["...hh...", "...hh...", "y..ww..y", ".yywwyy.", "...ww...", "...bb...", "..b..b..", ".bb..bb."], { h: "#e9a66e", y: "#ffd28c", w: "#f8e4be", b: "#577ca0" });
    person.className = "sign-dancer";
    sign.append(person);
    if (root.hasAttribute("data-scene")) {
      const visible = links.find(a => a.hasAttribute("data-hit")) ?? root.querySelector("[data-sign=view]");
      const r = visible.getBoundingClientRect(), v = view.getBoundingClientRect();
      person.style.cssText = `left:${r.x-v.x+r.width*.6}px;top:${r.y-v.y-15}px;bottom:auto`;
    }
    if (!calm.matches) person.animate([
      { transform: "rotate(-12deg)" }, { transform: "rotate(14deg) translateY(-2px)" }, { transform: "rotate(-12deg)" }
    ], { duration: 430, iterations: 4 });
    setTimeout(() => person.remove(), 1800);
  }
  function mend() {
    if (location.hash === "#site-log") history.replaceState(history.state, "", location.pathname + location.search);
    for (const a of links) {
      a.setAttribute("href", blog);
      a.setAttribute("aria-label", "Blog");
      a.querySelector(".breakable-b").textContent = "B";
      const tail = a.querySelector(".log-tail");
      for (const animation of tail.getAnimations()) animation.cancel();
      tail.textContent = "log";
    }
    log.hidden = true;
    broken(false);
  }
  function breakB(scatter = true) {
    if (shield) return say("The B holds. IDDQD is on.");
    if (!log.hidden) return;
    const b = link.querySelector(".breakable-b"), tail = link.querySelector(".log-tail");
    const rect = b.getBoundingClientRect();
    const width = rect.width, height = rect.height;
    for (const a of links) {
      a.querySelector(".breakable-b").textContent = "";
      a.querySelector(".log-tail").textContent = "LOG";
      a.href = "#site-log";
      a.setAttribute("aria-label", "LOG — site changelog");
    }
    log.hidden = false;
    broken(true);
    say("The B broke loose. LOG opens the site changelog.");
    if (calm.matches || !scatter) return;
    tail.animate([{ transform: `translateX(${width}px)` }, { transform: "none" }], { duration: 200, easing: "ease-out" });
    const chips = document.createElement("span");
    chips.className = "b-chips";
    chips.ariaHidden = "true";
    if (root.hasAttribute("data-scene")) {
      const v = view.getBoundingClientRect();
      chips.style.cssText = `inset:auto;left:${rect.left-v.left}px;top:${rect.top-v.top}px;color:#e64530`;
      view.append(chips);
    } else b.append(chips);
    // A four-by-five bitmap of the removed letter. Each occupied cell is a chip.
    ["1110", "1001", "1110", "1001", "1110"].forEach((row, y) => {
      [...row].forEach((cell, x) => {
        if (cell === "0") return;
        const chip = document.createElement("i");
        chips.append(chip);
        chip.style.cssText = `left:${x * width / 4}px;top:${(y + .5) * height / 6}px;width:${width / 4}px;height:${height / 6}px`;
        const dx = (x - 2) * 9 - 5;
        chip.animate([
          { transform: "none", opacity: 1 },
          { transform: `translate(${dx}px,${-9 + y * 2}px) rotate(${dx}deg)`, opacity: 1, offset: .38 },
          { transform: `translate(${dx * 1.6}px,${12 + y * 4}px) rotate(${dx * 3}deg)`, opacity: 0 },
        ], { duration: 290, easing: "ease-out", fill: "forwards" });
      });
    });
    setTimeout(() => chips.remove(), 300);
  }
  function rain() {
    view.querySelector(".glyph-rain")?.remove();
    const rain = document.createElement("div");
    rain.className = "glyph-rain";
    rain.ariaHidden = "true";
    const glyphs = "▧▥▢╫╬▦";
    for (let i = 0; i < 16; i++) {
      const strand = document.createElement("i");
      strand.textContent = Array.from({ length: 5 }, (_, j) => glyphs[(i * 7 + j * (1 + i % 3)) % glyphs.length]).join("");
      strand.style.left = (i * 6.3) + "%";
      strand.style.top = ((i * 17) % 41) + "%";
      rain.append(strand);
      if (!calm.matches) strand.animate([
        { transform: "translateY(-75%)", opacity: 0 },
        { opacity: 1, offset: .2 },
        { transform: "translateY(90%)", opacity: 0 },
      ], { duration: 1200, delay: (i * 83) % 370, fill: "both" });
    }
    view.append(rain);
    setTimeout(() => rain.remove(), 1600);
    say("Wake up. The windows are writing back.");
  }
  // The Matrix: the windows become one screen of code rain, an overcast deck closes
  // over the park, the fog thickens and the view turns green. The live city only;
  // the still and the plain page keep the short glyph fall.
  function enter() {
    const live = world();
    if (!live) return rain();
    if (egg?.kind === "matrix") return say("You're already in. Esc, or type “blue pill”, to leave.");
    stop(true);
    egg = { kind: "matrix" };
    live.show(codeRain());
    live.mood(1, "matrix");
    root.toggleAttribute("data-matrix", true);
    wake.setAttribute("aria-pressed", "true");
    exit.hidden = false;
    billboard({ billboard: "matrix" });
    schedule();
    say("Wake up, Neo… The windows are code now.");
  }
  function leave(quiet = false) {
    if (egg?.kind !== "matrix") return;
    const live = world();
    live?.show(null);
    live?.mood(0);
    egg = null;
    root.toggleAttribute("data-matrix", false);
    wake.setAttribute("aria-pressed", "false");
    // Focus never falls to the body with the button it was on.
    if (document.activeElement === exit) document.getElementById("main")?.focus({ preventScroll: true });
    exit.hidden = true;
    billboard({ billboard: "" });
    schedule();
    if (!quiet) say("Blue pill. Back in the park.");
  }
  exit.addEventListener("click", () => leave());

  // Video on the windows. One hidden element plays every egg and is the clock (see
  // video.js). It starts inside the visitor's tap or key press, which is what lets
  // its sound play. Without the live city (the still, reduced motion, the plain page)
  // the egg is sound only.
  let media;
  const files = new Map();
  function element() {
    if (media) return media;
    media = document.createElement("video");
    media.className = "egg-media";
    media.playsInline = true;
    media.preload = "none";
    media.disableRemotePlayback = true;
    media.ariaHidden = "true";
    media.tabIndex = -1;
    view.append(media);
    media.addEventListener("ended", () => stop(false, true));
    // A frame that arrives while the city is paused still has to reach the windows.
    for (const type of ["loadeddata", "seeked", "playing"]) media.addEventListener(type, schedule);
    return media;
  }
  // The whole file, as a blob: a media element streams by byte ranges, which a static
  // host may not serve, and Safari will not play a video without them.
  function fetchVideo(v) {
    if (!files.has(v.src)) {
      const file = fetch(v.src).then((r) => {
        if (!r.ok) throw Error(`${v.src}: ${r.status}`);
        return r.blob();
      }).then((blob) => URL.createObjectURL(blob));
      file.catch(() => files.delete(v.src));
      files.set(v.src, file);
    }
    return files.get(v.src);
  }
  function setMuted(on) {
    media.muted = on;
    if (egg?.kind === "video") egg.muted = on;
    mute.setAttribute("aria-pressed", String(on));
    billboard({ muted: on });
  }
  function run(current) {
    if (current.fresh) media.currentTime = 0;
    current.fresh = false;
    media.play().catch((error) => {
      if (egg !== current || error.name !== "NotAllowedError") return;
      // Some browsers want a fresh tap for sound. Play muted; Unmute (or, on the plain
      // page, the egg's own button) is that tap.
      setMuted(true);
      current.blocked = true;
      media.play().catch(() => {});
      say(root.hasAttribute("data-scene")
        ? "Playing muted. Tap Unmute on the directory for sound."
        : `Playing muted. Press ${current.v.title} again for sound.`);
    });
  }
  function play(name) {
    const v = videos[name];
    if (egg?.kind === "video" && egg.name === name) {
      // A press after the browser held back the sound brings the sound, not a stop.
      if (!egg.blocked) return stop();
      egg.blocked = false;
      setMuted(false);
      return say("Sound on.");
    }
    leave(true);
    stop(true);
    const m = element();
    m.muted = false;
    // Start the element inside the gesture, before it has a file: some browsers only
    // let an element play sound later if it was first started from a tap.
    m.play().catch(() => {});
    const live = world();
    const current = (egg = {
      kind: "video",
      name,
      v,
      program: live ? videoProgram(m, { outside: v.outside, contrast: v.contrast }) : null,
      // Under Pause the windows hold a frame until Play.
      held: !!live && paused(),
      fresh: true,
      ready: false,
      muted: false,
    });
    if (live) {
      live.show(current.program);
      live.mood(1, v.palette);
    }
    root.dataset.video = name;
    v.button.setAttribute("aria-pressed", "true");
    mute.hidden = stopper.hidden = false;
    mute.setAttribute("aria-pressed", "false");
    billboard({ billboard: "video", playing: v.title, muted: false });
    hush(true);
    if (name === "rickroll") dancer();
    schedule();
    say(`Tuning in: ${v.title}…`);
    fetchVideo(v).then((url) => {
      if (egg !== current) return;
      m.src = url;
      current.ready = true;
      // The early play() above left the element wanting to play: a held egg waits.
      if (current.held || document.hidden) m.pause();
      if (current.held) m.currentTime = v.still;
      else if (!document.hidden) run(current);
      const how = live ? (current.held ? " Play on the directory starts it." : " Stop it on the directory, or press Esc.") : " Sound only here. Esc stops it.";
      say(v.start + how);
    }, () => {
      if (egg !== current) return;
      stop(true);
      say(`${v.title} didn't load. Try again.`);
    });
  }
  function stop(quiet = false, ended = false) {
    if (egg?.kind !== "video") return;
    const { v, program } = egg;
    egg = null;
    program?.dispose();
    media.pause();
    media.removeAttribute("src");
    media.load();
    const live = world();
    live?.show(null);
    live?.mood(0);
    delete root.dataset.video;
    v.button.setAttribute("aria-pressed", "false");
    if ([mute, stopper].includes(document.activeElement)) document.getElementById("main")?.focus({ preventScroll: true });
    mute.hidden = stopper.hidden = true;
    billboard({ billboard: "", playing: "", muted: false });
    hush(false);
    schedule();
    if (!quiet) say(ended ? v.end : `${v.title} stopped.`);
  }
  mute.addEventListener("click", () => {
    if (egg?.kind !== "video") return;
    setMuted(!media.muted);
    egg.blocked = false;
    // An unmute is a fresh tap, so a video that started muted gets its sound here.
    if (!media.muted && media.paused && egg.ready && !egg.held) run(egg);
    say(media.muted ? "Muted." : "Sound on.");
  });
  stopper.addEventListener("click", () => stop());
  // The tab out of sight takes the sound with it, like the city's own.
  document.addEventListener("visibilitychange", () => {
    if (egg?.kind !== "video" || !egg.ready || egg.held) return;
    if (document.hidden) media.pause();
    else run(egg);
  });
  function exitAll(quiet = false) {
    leave(quiet);
    stop(quiet);
  }
  function activate(action) {
    const live = world();
    switch (action) {
      case "break": return breakB();
      case "god":
        shield = !shield;
        if (shield) mend();
        god.setAttribute("aria-pressed", String(shield));
        return say(shield ? "IDDQD on. The B is indestructible." : "IDDQD off. The B can break again.");
      case "moon":
        size = (size + 1) % radii.length;
        live?.resizeMoon(radii[size]);
        moon.querySelector("i").style.transform = `scale(${radii[size] / radii[0]})`;
        schedule();
        return say(`Moon size ${size + 1} of 3.`);
      case "rain": return live && egg?.kind === "matrix" ? leave() : enter();
      case "rickroll":
      case "apple": return play(action);
      case "unplug": return leave();
      case "roll":
        if (!calm.matches) {
          live?.roll();
          root.querySelector(".bearing i").animate([{ transform: "rotate(120deg)" }, { transform: "rotate(480deg)" }], { duration: 850, easing: "ease-in-out" });
          schedule();
        }
        return say("Barrel roll. Bearing 120° ESE.");
      case "rick":
      case "lives": {
        if (action === "rick") dancer();
        const words = action === "rick" ? RICK : "+30 lives";
        banner = words;
        if (live) void live.banner(words).then(schedule).catch(() => {});
        return say(`Tow banner: ${words}`);
      }
    }
  }

  // A copied LOG fragment also works when opened in a fresh tab.
  function openFragment() {
    if (location.hash !== "#site-log" || !log.hidden || shield) return;
    breakB(false);
    log.focus();
  }
  window.addEventListener("hashchange", openFragment);
  openFragment();

  secrets.addEventListener("click", (e) => {
    const button = e.target.closest("[data-egg]");
    if (button) activate(button.dataset.egg);
  });
  log.querySelector("[data-mend]").addEventListener("click", () => {
    mend();
    (link.hasAttribute("data-hit") || !root.hasAttribute("data-scene") ? link : links.find(a=>a.hasAttribute("data-hit")))?.focus();
    say("The B is back on the sign.");
  });
  // Decide on release so a drag, cancellation or secondary pointer cannot break B.
  const modified = e => e.metaKey || e.ctrlKey || e.altKey || e.shiftKey;
  for (const a of links) {
    a.addEventListener("pointerdown", (e) => {
      if (!e.isPrimary) return;
      link = a;
      spent = false;
      press = e.target.matches(".breakable-b") && !e.button && !modified(e)
        ? { id: e.pointerId, x: e.clientX, y: e.clientY, time: e.timeStamp, touch: e.pointerType !== "mouse" } : null;
    });
    for (const type of ["pointerleave", "pointercancel"]) a.addEventListener(type, (e) => {
      if (press?.id === e.pointerId) press = null;
    });
    a.addEventListener("dragstart", () => { press = null; });
    a.addEventListener("contextmenu", (e) => {
      if (press?.touch) e.preventDefault();
    });
    a.addEventListener("pointermove", (e) => {
      if (press?.id === e.pointerId && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 8) press = null;
    });
    a.addEventListener("pointerup", (e) => {
      if (press?.id !== e.pointerId) return;
      spent = !modified(e) && e.timeStamp - press.time >= 540;
      press = null;
      if (spent) breakB();
    });
    a.addEventListener("click", (e) => {
      if (spent && e.detail) e.preventDefault();
      spent = false;
    });
  }

  canvas.addEventListener("click", (e) => {
    const live = world();
    if (!live || e.button || modified(e)) return;
    const { x, y, width, height } = canvas.getBoundingClientRect();
    const px = e.clientX - x, py = e.clientY - y;
    // A red tower light is the red pill.
    const reach = Math.max(18, height * 0.025);
    if (live.beacons?.some((p) => {
      const [bx, by, bz] = project(p, live.frame, width, height);
      return bz > 0 && Math.hypot(px - bx, py - by) <= reach;
    })) return egg?.kind === "matrix" ? say("Already in. Esc, or type “blue pill”, to leave.") : enter();
    if (root.dataset.hour === "night" && live.moonlit && Math.hypot(px - width * .70, py - height * .14) <= Math.max(14, height * radii[size])) return activate("moon");
    const ends = [live.cloth.from, live.cloth.to].map(p => project(p, live.frame, width, height));
    const [[ax, ay, az], [bx, by, bz]] = ends;
    if (az > 0 && bz > 0 && px >= Math.min(ax, bx) && px <= Math.max(ax, bx) &&
        py >= Math.min(ay, by) - 3 && py <= Math.max(ay, by) + 3) {
      // The first tap tunes the banner; a second tap on the tuned banner plays the song.
      if (egg?.name === "rickroll") return say("You know the rules. Stop is on the directory.");
      return activate(banner === RICK ? "rickroll" : "rick");
    }
  });
  document.addEventListener("keydown", (e) => {
    const target = e.composedPath()[0];
    // Esc ends an egg unless something nearer (a dialog, a panel, Support) took it.
    if (e.key === "Escape" && egg && !e.defaultPrevented &&
        !target.closest?.("dialog,details[open],support-button") && !(target.getRootNode?.() instanceof ShadowRoot)) {
      exitAll();
      return;
    }
    if (e.defaultPrevented || e.isComposing || e.repeat || e.metaKey || e.altKey || e.ctrlKey ||
        target.closest?.('input,textarea,select,button,summary,[contenteditable],[role="textbox"]') || target.getRootNode?.() instanceof ShadowRoot) {
      buffer = "";
      return;
    }
    if (links.includes(target) && e.key === " " && !modified(e) && log.hidden) {
      link=target;
      e.preventDefault();
      return breakB(false);
    }
    if (e.timeStamp - lastKey > 2500) buffer = "";
    lastKey = e.timeStamp;
    const key = arrows[e.key] || (/^[a-z ]$/i.test(e.key) ? e.key.toLowerCase() : "");
    buffer = key ? (buffer + key).slice(-longest) : "";
    for (const [phrase, action] of phrases) if (buffer.endsWith(phrase)) {
      buffer = "";
      activate(action);
      break;
    }
  });
  return {
    get moonRadius() { return radii[size]; },
    // The GPU went away: the still has no windows to show. The Matrix leaves quietly;
    // a playing video keeps its sound, with Mute and Stop on the still's directory.
    lost() {
      leave(true);
      if (egg?.kind !== "video") return;
      if (egg.held) return stop(true);
      egg.program?.dispose();
      egg.program = null;
      say(`${egg.v.title}: sound only now. Esc stops it.`);
    },
    // Pause holds the video and its sound with the rest of the city.
    hold(on) {
      if (egg?.kind !== "video") return;
      egg.held = on;
      if (!egg.ready) return;
      if (on) return media.pause();
      if (egg.fresh) say(egg.v.start + " Stop it on the directory, or press Esc.");
      run(egg);
    },
    // A press of Night. Four in four seconds, black and white and black and white: Bad Apple!!
    night(time) {
      flips = [...flips.filter((t) => time - t < 4000), time];
      if (flips.length < 4) return;
      flips = [];
      if (egg?.name !== "apple") play("apple");
    },
    get playing() { return egg?.kind === "video" ? egg.name : ""; },
  };
}
