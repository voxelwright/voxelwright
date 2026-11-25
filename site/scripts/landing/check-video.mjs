// Browser check for video on the window screen (static/landing/video.js) and its two
// eggs, the Rickroll and Bad Apple!!, on the production build. Like check-matrix it
// counts passes by pipeline label and compares pixels only under Pause. It also
// counts picture uploads, watches the network for the egg files and reads the hidden
// media element, which is the clock and the sound. Every egg starts from a click, key
// press or tap. Playwright's input (and its evaluate) counts as a user gesture, so a
// browser that refuses sound is simulated, in one section, by a play() that refuses. The check exposes the live world to
// find the tow banner on screen; the shipped page does not.
import { eggOverlay } from "../../lib/egg-overlay.mjs";
import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { pixels } from "./png-pixels.mjs";
import { startServer } from "../serve.mjs";

const same = (a, b) => pixels(a).equals(pixels(b));

const dist = resolve(import.meta.dirname, "../../dist");
if (!eggOverlay) {
  console.log("SKIP landing video playback: set VOXELWRIGHT_EGG_MEDIA to check the private overlay");
  process.exit(0);
}
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT ?? "playwright");
const out = process.env.OUT ?? ".shots/video";
await mkdir(out, { recursive: true });

const LABELS = { "Window map": "map", "Window screen": "screen", "Mood grade": "grade" };
function count() {
  const n = (window.__video = { map: 0, screen: 0, grade: 0, frames: 0, uploads: 0 });
  const pass = GPURenderPassEncoder.prototype;
  const { setPipeline } = pass;
  pass.setPipeline = function (pipeline) {
    if (pipeline.label in LABELS) n[LABELS[pipeline.label]]++;
    return setPipeline.call(this, pipeline);
  };
  const { submit, writeTexture } = GPUQueue.prototype;
  GPUQueue.prototype.submit = function (buffers) {
    n.frames++;
    return submit.call(this, buffers);
  };
  GPUQueue.prototype.writeTexture = function (target, ...rest) {
    if (target.texture.label === "Window screen picture") n.uploads++;
    return writeTexture.call(this, target, ...rest);
  };
}
const counter = `const LABELS = ${JSON.stringify(LABELS)};\n(${count})();`;

const browser = await chromium.launch({ channel: "chrome", args: ["--enable-unsafe-webgpu"] });
const errors = [];
let server;
try {
  server = await startServer({ root: dist, port: 0, host: "127.0.0.1" });
  const base = `http://127.0.0.1:${server.address().port}/`;
  const home = (await readFile(join(dist, "landing/home.js"), "utf8")) + "\nwindow.__world = () => world;";
  async function open({ width = 1440, height = 900, scale = 1, scheme = "dark", preset = "high", motion = "no-preference", mobile = false, path = "", init = "" }) {
    const context = await browser.newContext({
      viewport: { width, height },
      deviceScaleFactor: scale,
      isMobile: mobile,
      hasTouch: mobile,
      colorScheme: scheme,
      reducedMotion: motion,
      storageState: {
        cookies: [],
        origins: [{
          origin: new URL(base).origin,
          localStorage: [
            { name: "support-button-muted", value: "1" },
            { name: "village.graphics", value: JSON.stringify({ preset, scale: 1, dynamic: false, target: 60 }) },
          ],
        }],
      },
    });
    await context.addInitScript(counter + init);
    await context.route("**/landing/home.js", (route) => route.fulfill({ body: home, contentType: "text/javascript" }));
    const page = await context.newPage();
    const fetched = [];
    page.on("request", (r) => r.url().includes("/landing/eggs/") && fetched.push(new URL(r.url()).pathname));
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => ["error", "warning"].includes(message.type()) && errors.push(message.text()));
    assert.ok((await page.goto(base + path)).ok(), "home responds");
    return { context, page, fetched };
  }
  const live = (page) => page.locator(".overlook[data-live]").waitFor({ timeout: 20000 });
  const reset = (page) => page.evaluate(() => Object.keys(window.__video).forEach((k) => (window.__video[k] = 0)));
  const read = (page) => page.evaluate(() => ({ ...window.__video }));
  const status = (page) => page.locator(".egg-status").innerText();
  const playing = (page) => page.locator(".overlook").evaluate((el) => el.dataset.video ?? "");
  const media = (page) =>
    page.evaluate(() => {
      const v = document.querySelector(".egg-media");
      return v && { time: v.currentTime, paused: v.paused, muted: v.muted, ready: v.readyState, src: !!v.getAttribute("src"), duration: v.duration, audio: v.webkitAudioDecodedByteCount ?? -1 };
    });
  const until = (page, test, what, timeout = 15000) =>
    page.waitForFunction(test, null, { timeout }).catch(() => assert.fail(`timed out waiting for ${what}`));
  const started = (page) => until(page, () => { const v = document.querySelector(".egg-media"); return v && !v.paused && v.currentTime > 0.3; }, "the video to play");
  // The middle of the tow banner's visible part, in CSS pixels, once at least 40 px of
  // it is in view (on a phone the plane spends a while beyond the edges).
  const banner = async (page) => {
    await page.evaluate(async () => { window.__project ??= (await import("/landing/survey.js")).project; });
    return page.waitForFunction(() => {
      const project = window.__project;
      const world = window.__world();
      const box = document.querySelector(".park-canvas").getBoundingClientRect();
      const [a, b] = [world.cloth.from, world.cloth.to].map((p) => project(p, world.frame, box.width, box.height));
      if (a[2] <= 0 || b[2] <= 0) return false;
      const left = Math.max(8, Math.min(a[0], b[0])), right = Math.min(box.width - 8, Math.max(a[0], b[0]));
      if (right - left < 40) return false;
      const x = (left + right) / 2, y = a[1] + ((b[1] - a[1]) * (x - a[0])) / (b[0] - a[0] || 1);
      return { x: box.x + x, y: box.y + y, seen: true };
    }, null, { timeout: 40000, polling: 200 }).then((h) => h.jsonValue());
  };
  const plate = (page, id) => page.locator(`[data-sign="${id}"][data-hit]`);

  // Desktop at night, High: the Rickroll grows out of the tow banner.
  {
    const { context, page, fetched } = await open({});
    await live(page);
    await page.waitForTimeout(4000);
    assert.deepEqual(fetched, [], "no egg file loads with the page");
    await reset(page);
    await page.waitForTimeout(1500);
    const idle = await read(page);
    assert.deepEqual([idle.map, idle.screen, idle.grade, idle.uploads], [0, 0, 0, 0], "without an egg the city draws nothing new");

    // Pause first, so the banner holds still for both taps and the view can be compared.
    await plate(page, "pause").click();
    await page.waitForTimeout(1500);
    const clip = { x: 0, y: 0, width: 1440, height: 760 };
    let at = await banner(page);
    assert.ok(at.seen, "the banner is in view");
    await page.mouse.click(at.x, at.y);
    assert.match(await status(page), /Never gonna/, "the first tap tunes the banner");
    assert.equal(await playing(page), "", "one tap is only the banner");
    assert.deepEqual(fetched, [], "the banner alone loads nothing");
    // The tuned banner, held by Pause, is the city to come back to.
    await page.waitForTimeout(2500);
    const before = await page.screenshot({ clip });
    at = await banner(page);
    await page.mouse.click(at.x, at.y);
    assert.equal(await playing(page), "rickroll", "a second tap on the tuned banner plays it");
    assert.deepEqual(fetched, ["/landing/eggs/rick.mp4"], "the file loads on the trigger");
    // Under Pause the windows hold a frame and the sound waits for Play.
    await until(page, () => document.querySelector(".egg-media")?.readyState >= 2, "the held frame");
    await page.waitForTimeout(3500);
    let m = await media(page);
    assert.ok(m.paused && Math.abs(m.time - 20) < 0.5, `Pause holds the video on its still: ${JSON.stringify(m)}`);
    assert.equal(await plate(page, "video-stop").isVisible(), true);
    assert.equal(await plate(page, "video-mute").isVisible(), true);
    for (const id of ["time", "sound", "postcard", "view"]) assert.equal(await plate(page, id).count(), 0, `${id} gives way on the billboard`);
    assert.equal(await page.locator('[data-sign="pause"]').getAttribute("aria-label"), "Pause the video");
    const held = await page.screenshot({ clip });
    await reset(page);
    await page.waitForTimeout(600);
    assert.ok(same(held, await page.screenshot({ clip })), "Pause holds the picture");
    assert.equal((await read(page)).uploads, 0, "a held video uploads nothing");
    assert.ok(!same(held, before), "the egg changes the view");
    await page.screenshot({ path: join(out, "rick-paused.png") });

    // Stop, still under Pause: the city comes back exactly as it was.
    await plate(page, "video-stop").click();
    assert.equal(await playing(page), "", "Stop ends the egg");
    assert.match(await status(page), /stopped/);
    m = await media(page);
    assert.ok(m.paused && !m.src, "the media is let go");
    await page.waitForTimeout(2700);
    // Off the directory, so no plate is lit by the pointer (Pause holds the lean).
    await page.mouse.move(at.x, at.y);
    await page.waitForTimeout(300);
    const back = await page.screenshot({ clip });
    assert.ok(same(back, before), "stopping gives back the exact city");
    await reset(page);
    await page.waitForTimeout(800);
    const after = await read(page);
    assert.deepEqual([after.map, after.screen, after.grade, after.uploads], [0, 0, 0, 0], "nothing left drawing after Stop");
    assert.equal(await page.evaluate(() => document.activeElement === document.body), false, "focus doesn't drop to the body");

    // Typed, still under Pause: held again, and the file is reused.
    await page.locator("#main").focus();
    await page.keyboard.type("rickroll");
    assert.equal(await playing(page), "rickroll", "typing rickroll plays it");
    await until(page, () => document.querySelector(".egg-media")?.readyState >= 2, "the held frame");
    assert.deepEqual(fetched, ["/landing/eggs/rick.mp4"], "a replay reuses the file");

    // Play: the song starts from the top with sound, and the windows follow it.
    await plate(page, "pause").click();
    await started(page);
    m = await media(page);
    assert.ok(m.time < 3 && !m.muted, `Play starts the song from the top, with sound: ${JSON.stringify(m)}`);
    assert.match(await status(page), /Stop it on the directory/, "the status follows Play");
    await page.waitForTimeout(4000);
    await reset(page);
    const t0 = (await media(page)).time;
    await page.waitForTimeout(4000);
    const n = await read(page);
    const t1 = (await media(page)).time;
    assert.ok((await media(page)).audio > 0, "the sound is being decoded, not only unmuted");
    console.log("rickroll 4 s:", JSON.stringify(n), "media advanced", (t1 - t0).toFixed(2), "s");
    assert.ok(Math.abs(t1 - t0 - 4) < 0.6, "the media clock runs in real time");
    assert.equal(n.screen, n.frames, "one screen draw a frame");
    assert.equal(n.grade, n.frames, "one grade a frame");
    assert.ok(n.uploads >= 4 * 20 && n.uploads <= 4 * 26 + 4, `the picture uploads once per video frame (25 fps): ${n.uploads}`);
    await page.screenshot({ path: join(out, "rick-night.png") });

    // Pause holds the video and its sound together, and Play lets both go.
    await plate(page, "pause").click();
    // The pointer's move to the plate leans the view; let the lean settle.
    await page.waitForTimeout(2500);
    m = await media(page);
    assert.ok(m.paused, "Pause pauses the media");
    const frozen = await page.screenshot({ clip });
    await page.waitForTimeout(700);
    assert.equal((await media(page)).time, m.time, "the media clock holds");
    const frozen2 = await page.screenshot({ clip });
    assert.ok(same(frozen, frozen2), "the windows hold");
    await plate(page, "pause").click();
    await started(page);

    // Mute only silences the video; the site's saved Sound choice is untouched.
    const soundBefore = await page.evaluate(() => JSON.stringify(localStorage));
    await plate(page, "video-mute").click();
    assert.equal((await media(page)).muted, true, "Mute mutes");
    assert.equal(await page.locator('[data-sign="video-mute"]').getAttribute("aria-pressed"), "true");
    await plate(page, "video-mute").click();
    assert.equal((await media(page)).muted, false, "Unmute brings the sound back");
    assert.equal(await page.evaluate(() => JSON.stringify(localStorage)), soundBefore, "nothing is saved");

    await plate(page, "video-stop").click();
    assert.equal(await playing(page), "");
    assert.equal((await media(page)).paused, true, "Stop stops the sound");

    // The end of the song ends the egg by itself.
    await page.locator("#main").focus();
    await page.keyboard.type("rickroll");
    await started(page);
    await page.evaluate(() => { const v = document.querySelector(".egg-media"); v.currentTime = v.duration - 1.2; });
    await until(page, () => !document.querySelector(".overlook").dataset.video, "the song to end");
    assert.match(await status(page), /whole song/);

    // A video gives way to the Matrix, and the Matrix to a video.
    await page.keyboard.type("bad apple");
    await started(page);
    assert.equal(await playing(page), "apple");
    await page.keyboard.type("neo");
    assert.equal(await playing(page), "", "the Matrix stops the video");
    assert.equal((await media(page)).paused, true);
    await page.keyboard.type("bad apple");
    assert.equal(await playing(page), "apple", "a video leaves the Matrix");
    assert.equal(await page.locator(".overlook").evaluate((el) => el.hasAttribute("data-matrix")), false);
    await started(page);
    await page.keyboard.press("Escape");
    assert.equal(await playing(page), "", "Esc stops a video");
    await context.close();
  }

  // Bad Apple!! by flipping Night four times, in black and white; by day too.
  for (const scheme of ["dark", "light"]) {
    const { context, page, fetched } = await open({ scheme });
    await live(page);
    await page.waitForTimeout(3000);
    for (let i = 0; i < 3; i++) await plate(page, "time").click();
    assert.equal(await playing(page), "", "three flips are only the weather");
    await plate(page, "time").click();
    assert.equal(await playing(page), "apple", "the fourth flip plays Bad Apple!!");
    assert.deepEqual(fetched, ["/landing/eggs/bad-apple.mp4"]);
    await started(page);
    await page.evaluate(() => { document.querySelector(".egg-media").currentTime = 94; });
    await page.waitForTimeout(4000);
    await page.screenshot({ path: join(out, `apple-${scheme === "dark" ? "night" : "day"}.png`) });
    await page.locator('[data-egg="apple"]').evaluate((b) => b.getAttribute("aria-pressed")).then((v) => assert.equal(v, "true"));
    await plate(page, "video-stop").click();
    assert.equal(await playing(page), "");
    await context.close();
  }

  // Low: the windows still play, and nothing is left drawing after.
  {
    const { context, page } = await open({ preset: "low" });
    await live(page);
    await page.waitForTimeout(3000);
    await page.locator("#main").focus();
    await page.keyboard.type("bad apple");
    await started(page);
    await page.waitForTimeout(3000);
    await reset(page);
    await page.waitForTimeout(2000);
    const low = await read(page);
    assert.ok(low.screen === low.frames && low.grade === low.frames && low.uploads > 40, `Low plays: ${JSON.stringify(low)}`);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(2500);
    await reset(page);
    await page.waitForTimeout(1000);
    const after = await read(page);
    assert.deepEqual([after.screen, after.grade, after.uploads], [0, 0, 0], "Low leaves nothing drawing");
    await context.close();
  }

  // Phone, by touch: two taps on the banner, and four on Night.
  for (const scheme of ["dark", "light"]) {
    const { context, page } = await open({ width: 390, height: 844, scale: 3, mobile: true, scheme, preset: "medium" });
    await live(page);
    await page.waitForTimeout(3000);
    // The tow banner starts in view on a phone too: tap it once to tune it, then again.
    let at = await banner(page);
    await page.touchscreen.tap(at.x, at.y);
    assert.match(await status(page), /Never gonna/, "a tap tunes the banner on a phone");
    await page.waitForTimeout(1200);
    at = await banner(page);
    await page.touchscreen.tap(at.x, at.y);
    assert.equal(await playing(page), "rickroll", "a second tap plays it on a phone");
    await started(page);
    assert.equal((await media(page)).muted, false, "a tap is enough for sound");
    for (const id of ["pause", "video-mute", "video-stop"]) {
      const box = await plate(page, id).boundingBox();
      assert.ok(box.width >= 44 && box.height >= 44, `${id} is a full touch target`);
    }
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 390);
    await page.waitForTimeout(5000);
    await page.screenshot({ path: join(out, `phone-rick-${scheme === "dark" ? "night" : "day"}.png`) });
    await plate(page, "video-stop").tap();
    assert.equal(await playing(page), "");
    for (let i = 0; i < 4; i++) await plate(page, "time").tap();
    assert.equal(await playing(page), "apple", "four taps on Night play Bad Apple!! on a phone");
    await started(page);
    await page.evaluate(() => { document.querySelector(".egg-media").currentTime = 62; });
    await page.waitForTimeout(4000);
    await page.screenshot({ path: join(out, `phone-apple-${scheme === "dark" ? "night" : "day"}.png`) });
    await plate(page, "video-stop").tap();
    await context.close();
  }

  // Reduced motion: the still, and the egg as sound only, with Mute and Stop on the still's directory.
  {
    const { context, page } = await open({ motion: "reduce" });
    await page.locator(".park-still").waitFor({ state: "visible", timeout: 8000 });
    await page.locator("#main").focus();
    await page.keyboard.type("rickroll");
    assert.equal(await playing(page), "rickroll");
    await started(page);
    assert.equal(await page.locator(".overlook").evaluate((el) => el.hasAttribute("data-live")), false, "the city stays still");
    await plate(page, "video-mute").waitFor();
    assert.equal(await plate(page, "pause").count(), 0, "no Pause without the live city");
    assert.match(await status(page), /Sound only/);
    await page.screenshot({ path: join(out, "still-rick.png") });
    await plate(page, "video-mute").click();
    assert.equal((await media(page)).muted, true);
    await plate(page, "video-stop").click();
    assert.equal(await playing(page), "", "Stop on the still's directory stops it");
    await plate(page, "about-still").waitFor({ state: "attached", timeout: 3000 }).catch(() => assert.fail("the still's own plates come back"));
    await context.close();
  }

  // A browser that holds back sound plays the egg muted; on the plain page the egg's own
  // button, pressed again, brings the sound. The refusal is simulated: play() refuses
  // with NotAllowedError whenever the element isn't muted.
  {
    const refuse = `;{const play = HTMLMediaElement.prototype.play;
      HTMLMediaElement.prototype.play = function () {
        return this.muted ? play.call(this) : Promise.reject(new DOMException("No sound without a gesture", "NotAllowedError"));
      };}`;
    const { context, page } = await open({ path: "?view=2d", init: refuse });
    await page.locator(".park-credit > summary").click();
    await page.locator(".park-secrets summary").click();
    await page.locator('[data-egg="apple"]').click();
    await started(page);
    assert.equal((await media(page)).muted, true, "a refused egg plays muted");
    {
      assert.match(await status(page), /Playing muted\. Press Bad Apple!! again for sound/);
      await page.locator('[data-egg="apple"]').click();
      const m = await media(page);
      assert.ok(!m.muted && !m.paused, "the next press brings the sound and keeps playing");
      assert.equal(await playing(page), "apple");
      await page.locator('[data-egg="apple"]').click();
      assert.equal(await playing(page), "", "and the press after that stops it");
    }
    await context.close();
  }

  // Reduced motion switched on mid-song: the city gives way to its still and the song
  // carries on as sound only; a paused song stops quietly.
  {
    const { context, page } = await open({});
    await live(page);
    await page.waitForTimeout(2500);
    await page.locator("#main").focus();
    await page.keyboard.type("rickroll");
    await started(page);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.locator(".park-still").waitFor({ state: "visible", timeout: 8000 });
    const t = (await media(page)).time;
    await page.waitForTimeout(1500);
    const m = await media(page);
    assert.ok(!m.paused && m.time > t + 1, "the song carries on");
    assert.equal(await playing(page), "rickroll");
    assert.match(await status(page), /sound only now/);
    await plate(page, "video-stop").waitFor({ timeout: 3000 });
    assert.equal(await plate(page, "pause").count(), 0);
    await plate(page, "video-stop").click();
    assert.equal(await playing(page), "");
    await context.close();
  }
  {
    const { context, page } = await open({});
    await live(page);
    await page.waitForTimeout(2500);
    await plate(page, "pause").click();
    await page.locator("#main").focus();
    await page.keyboard.type("rickroll");
    await until(page, () => document.querySelector(".egg-media")?.readyState >= 2, "the held frame");
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.locator(".park-still").waitFor({ state: "visible", timeout: 8000 });
    assert.equal(await playing(page), "", "a paused song stops with the city");
    assert.equal((await media(page)).paused, true);
    await context.close();
  }

  // The plain page: sound only from Park secrets, and Esc stops it.
  {
    const { context, page } = await open({ path: "?view=2d" });
    await page.locator(".park-credit > summary").click();
    await page.locator(".park-secrets summary").click();
    await page.locator('[data-egg="apple"]').click();
    await started(page);
    assert.equal(await playing(page), "apple");
    await page.locator("#main").focus();
    await page.keyboard.press("Escape");
    assert.equal(await playing(page), "");
    await page.locator('[data-egg="rickroll"]').click();
    await started(page);
    await page.locator('[data-egg="rickroll"]').click();
    assert.equal(await playing(page), "", "the secrets button stops it again");
    await context.close();
  }

  assert.deepEqual(errors, []);
  console.log("video checks passed; screenshots in", out);
} finally {
  await browser.close();
  server?.close();
}
