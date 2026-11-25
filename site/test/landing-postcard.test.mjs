import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { cardLayout, cover, dateLabel, fileName, altText } from "../static/landing/postcard.js";

test("the card turns with the view and keeps a wider printed margin at the foot", () => {
  const wide = cardLayout(1280, 860);
  assert.equal(wide.portrait, false);
  assert.deepEqual([wide.width, wide.height], [1800, 1200]);
  const tall = cardLayout(390, 844);
  assert.equal(tall.portrait, true);
  assert.deepEqual([tall.width, tall.height], [1200, 1800]);
  for (const card of [wide, tall]) {
    const { photo, band } = card;
    assert.equal(photo.x, photo.y, "the same margin at the side and the top");
    assert.equal(photo.x * 2 + photo.w, card.width);
    assert.equal(photo.y + photo.h, band.y, "the caption band starts under the photo");
    assert.ok(band.h > photo.x * 2, "the caption margin is the wide one");
    assert.equal(band.y + band.h, card.height);
  }
});

test("the photo window covers its frame without stretching", () => {
  for (const [sw, sh, dw, dh] of [
    [2560, 1720, 1704, 1016],
    [780, 1688, 1112, 1580],
    [2018, 864, 1704, 1016],
  ]) {
    const c = cover(sw, sh, dw, dh);
    assert.ok(Math.abs(c.sw / c.sh - dw / dh) < 1e-9, "same shape as the window");
    assert.ok(c.sx >= -1e-9 && c.sy >= -1e-9 && c.sx + c.sw <= sw + 1e-9 && c.sy + c.sh <= sh + 1e-9, "inside the frame");
    assert.ok(Math.abs(c.sw - sw) < 1e-9 || Math.abs(c.sh - sh) < 1e-9, "one side is kept whole");
  }
  const left = cover(2018, 864, 1704, 1016, 0, 0.5);
  assert.equal(left.sx, 0);
  const anchored = cover(2018, 864, 1704, 1016, 0.45, 0.5);
  assert.ok(Math.abs(anchored.sx - (2018 - anchored.sw) * 0.45) < 1e-9);
});

test("the date is written out, and the file is named by it", () => {
  const date = new Date(2026, 10, 19, 23, 59);
  assert.equal(dateLabel(date), "19 November 2026");
  assert.equal(fileName(date), "zahynailo-postcard-2026-11-19.png");
  assert.equal(fileName(new Date(2027, 0, 5)), "zahynailo-postcard-2027-01-05.png");
  assert.match(altText({ night: true, date }), /^Postcard: “Greetings from San Francisco” over the night skyline from Ina Coolbrith Park, 19 November 2026, zahynailo\.dev\.$/);
  assert.match(altText({ night: false, date }), /daytime/);
});

test("every postcard control has an HTML twin and a labelled dialog", async () => {
  const { homePage } = await import("../generator/landing.mjs");
  const { html } = homePage({ title: "Pavlo Zahynailo", description: "", origin: "https://zahynailo.dev" }, [], false);
  assert.match(html, /<button type="button" data-sign="postcard" aria-haspopup="dialog"[^>]*>Make a postcard<\/button>/);
  assert.match(html, /data-postcard-plain aria-haspopup="dialog" hidden>Make a postcard<\/button>/);
  assert.match(html, /<dialog class="vx-dialog postcard" aria-labelledby="postcard-title">\s*<header id="postcard-title">Your postcard<\/header>/);
  // The dialog sits outside the view, so a pointer over it never leans the camera.
  const view = html.slice(html.indexOf('<div class="park-view">'), html.indexOf("</figure>"));
  assert.ok(!view.includes("<dialog"));
  const signs = readFileSync(new URL("../static/landing/signs.js", import.meta.url), "utf8");
  assert.match(signs, /\["time", "pause", "sound", "postcard", "view"\]/);
  assert.match(signs, /"plain-still", "postcard"\]/);
});
