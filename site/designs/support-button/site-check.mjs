// Browser QA against the built landing. See README.md for the command.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const pw = await import(process.env.PLAYWRIGHT || "playwright");
const origin = process.env.BASE || "http://127.0.0.1:5971";
const out = process.env.OUT || ".shots/support";
const requireWorld = process.env.REQUIRE_WORLD === "1";
fs.mkdirSync(out, { recursive: true });

const selector = 'support-button[version="instrument"]';
const readButton = (page) => page.locator(selector).evaluate((b) => ({
  ...b.pos, hits: b.hits, state: b.state, slips: b.slips,
}));

async function catchKey(page, touch) {
  for (let attempt = 0; attempt < 30; attempt++) {
    const before = await readButton(page);
    if (touch) await page.touchscreen.tap(before.x, before.y);
    else await page.mouse.click(before.x, before.y);
    const after = await readButton(page);
    if (after.hits > before.hits || after.state !== before.state) return;
    await page.waitForTimeout(touch ? 550 : 120);
  }
  assert.fail("Could not catch the support key");
}

function overlaps(a, b) {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

async function exercise(browser, engine, mode) {
  const touch = mode === "touch";
  const calm = mode === "calm";
  const width = touch || calm ? 390 : 1280;
  const context = await browser.newContext({
    viewport: { width, height: width === 390 ? 844 : 900 },
    hasTouch: touch,
    colorScheme: calm ? "dark" : "light",
    reducedMotion: calm ? "reduce" : "no-preference",
  });
  try {
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(origin + (calm ? "/?view=2d" : "/"));
    const element = page.locator(selector);
    const key = element.getByRole("button", { name: "Support", exact: true });
    await key.waitFor();
    await element.locator(".root[data-ready]").waitFor({ state: "attached" });
    await page.evaluate(() => document.fonts.ready);
    assert.equal(await element.count(), 1);
    assert.equal(await page.locator('#support-desk, iframe[src*="/support/"]').count(), 0);
    assert.equal((await page.request.get(origin + "/support/desk.html")).status(), 404);
    assert(await element.evaluate((b) => !b.audio && b.ownerDocument.defaultView === window));
    if (!calm) {
      if (requireWorld) await page.locator(".overlook[data-live]").waitFor({ state: "attached", timeout: 20000 });
      else await page.locator(".overlook[data-starting]").waitFor({ state: "detached", timeout: 20000 });
    }
    const liveWorld = await page.locator(".overlook[data-live]").count() > 0;
    const tag = `${engine}-${width}-${liveWorld ? "world" : "plain"}`;
    const shot = (beat) => page.screenshot({ path: path.join(out, `${tag}-${beat}.png`) });
    const keyBox = await key.boundingBox();
    const titleBox = await page.locator(".overlook-title").boundingBox();
    assert(keyBox.x > width / 2 && keyBox.y >= titleBox.y && keyBox.y + keyBox.height <= titleBox.y + titleBox.height);
    for (const target of [".bearing", ".overlook-title h1", ".park-sign", ".park-tools"]) {
      const box = await page.locator(target).boundingBox();
      if (box) assert(!overlaps(keyBox, box), `Support overlaps ${target} on entry`);
    }
    assert(await page.evaluate(() => document.documentElement.scrollWidth === document.documentElement.clientWidth));
    await shot("entry");

    // WebKit on macOS uses Option-Tab to include links in the tab order.
    const tabToPlain = () => page.keyboard.press(engine === "webkit" ? "Alt+Tab" : "Tab");
    await tabToPlain();
    assert(await page.locator(".skip").evaluate((link) => link.matches(":focus")));
    if (calm) {
      await page.keyboard.press("Tab");
      assert(await key.evaluate((button) => button.matches(":focus-visible")));
      await page.keyboard.press("Enter");
    } else if (touch) {
      const home = await readButton(page);
      await page.touchscreen.tap(home.x - 55, home.y + 65);
      await page.waitForFunction(({ x, y }) => {
        const b = document.querySelector("support-button");
        return Math.hypot(b.pos.x - x, b.pos.y - y) > 50;
      }, home);
      const before = await readButton(page);
      await page.touchscreen.tap(before.x, before.y);
      assert.equal((await readButton(page)).slips, before.slips - 1);
      await catchKey(page, touch);
    } else {
      // Start over the park itself, outside the widget's hit area.
      const view = await page.locator(".park-view").boundingBox();
      await page.mouse.move(view.x + view.width / 2, view.y + view.height / 3);
      await page.waitForFunction(() => document.querySelector("support-button").eye.some((e) => e.x < -0.5));
      const home = await readButton(page);
      await page.mouse.move(home.x - 18, home.y + 12);
      await page.waitForFunction(() => {
        const b = document.querySelector("support-button");
        return Math.hypot(b.pos.x - b.home.x, b.pos.y - b.home.y) > 60;
      });
      await catchKey(page, touch);
    }

    await element.locator('[data-mood="annoyed"]').waitFor({ state: "attached" });
    await page.waitForFunction(() => {
      const b = document.querySelector("support-button");
      return b.sound && b.audio?.state === "running" && performance.now() >= b.hitLock;
    });
    if (calm) await page.keyboard.press("Enter");
    else await catchKey(page, touch);

    const live = element.locator('[role="status"]');
    for (const [beat, words] of [["threat", "threatening"], ["barrage", "MUDA"], ["dozer", "bulldozer"], ["grief", "good grief"]]) {
      await live.filter({ hasText: words }).waitFor({ state: "attached", timeout: 15000 });
      if (beat === "barrage") {
        assert.match(await live.textContent(), calm ? /focus ring/ : touch ? /spot you tapped/ : /your cursor/);
        if (liveWorld && touch) {
          const pause = page.getByRole("button", { name: "Pause flight" });
          await pause.tap();
          assert.equal(await pause.getAttribute("aria-pressed"), "true");
        }
        if (!calm) {
          const view = await page.locator(".park-view").boundingBox();
          const target = { x: Math.round(width * (touch ? .78 : .6)), y: Math.round(view.y + view.height * .48) };
          if (touch) await page.touchscreen.tap(target.x, target.y);
          else await page.mouse.move(target.x, target.y);
          await page.waitForFunction(({ x, y }) => {
            const b = document.querySelector("support-button");
            const at = b.scene?.target();
            return at && Math.hypot(at.x - x, at.y - y) < 2;
          }, target);
        }
        await page.waitForTimeout(450);
        await shot(beat);
      }
      if (beat === "dozer") {
        await page.waitForTimeout(450);
        await shot(beat);
      }
    }
    const sign = element.getByRole("button", { name: "Dismiss this sign" });
    await sign.waitFor();
    if (calm) {
      assert(await sign.evaluate((button) => button.matches(":focus")));
      await page.keyboard.press("Escape");
      assert(await page.locator("main").evaluate((main) => main.matches(":focus")));
      await sign.waitFor({ state: "hidden" });

      // Exercise both Escape paths with ordinary keyboard input.
      await page.reload();
      await tabToPlain();
      await page.keyboard.press("Tab");
      assert(await key.evaluate((button) => button.matches(":focus-visible")));
      await page.keyboard.press("Escape");
      await key.waitFor({ state: "hidden" });
      assert.equal(await element.evaluate((b) => b.state), "gone");
      assert(await page.locator("main").evaluate((main) => main.matches(":focus")));
    } else {
      const blog = page.getByRole("link", { name: "Blog", exact: true });
      await (touch ? blog.tap() : blog.click());
      await page.waitForURL("**/blog/");
      assert.equal(await page.locator("support-button").count(), 0);
    }
    assert.deepEqual(errors, []);
    console.log(`${engine} ${width}px ${mode} on ${liveWorld ? "world" : "plain"} passed`);
  } finally {
    await context.close();
  }
}

for (const engine of (process.env.ENGINES || "chromium,webkit").split(",")) {
  // Chromium's full headless browser can use the Mac GPU. The headless shell falls back.
  const options = engine === "chromium" ? { channel: "chromium", args: ["--enable-unsafe-webgpu"] } : {};
  const browser = await pw[engine].launch(options);
  try {
    for (const mode of ["pointer", "touch", "calm"]) await exercise(browser, engine, mode);
  } finally {
    await browser.close();
  }
}
