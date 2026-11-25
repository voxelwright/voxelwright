import test from "node:test";
import assert from "node:assert/strict";
import { statSync } from "node:fs";
import { join } from "node:path";
import { eggOverlay, landingVideos } from "../lib/egg-overlay.mjs";
import { moody, MOOD, PALETTES, reads, lampsUnder, fogUnder } from "../static/landing/mood.js";
import { fitVideo, videoProgram } from "../static/landing/video.js";
import { pictureSize } from "../static/landing/screen.js";

// The Globals block as place.js fills it: 56 floats, each its own index.
const globals = () => Float32Array.from({ length: 56 }, (_, i) => i / 100 + 0.01);

test("every palette is the ordinary scene at mood 0", () => {
  for (const [name, p] of Object.entries(PALETTES)) {
    assert.deepEqual(Object.keys(p).sort(), Object.keys(MOOD).sort(), `${name} has every term`);
    assert.deepEqual(moody(globals(), 0, p), globals(), `${name} leaves the light alone`);
    assert.equal(lampsUnder(0, p), 1, `${name} keeps the lamps at 0`);
    assert.equal(fogUnder(0, p), 1, `${name} keeps the marine layer at 0`);
  }
  assert.equal(PALETTES.matrix, MOOD, "the Matrix is the default");
});

test("a full mood turns the light toward its palette, and leaves the camera and clocks", () => {
  for (const [name, p] of Object.entries(PALETTES)) {
    const plain = globals();
    const full = moody(globals(), 1, p);
    assert.equal(full[52], Math.fround(p.deck), `${name}: weather.x carries the deck`);
    assert.equal(full[54], Math.fround(plain[54] * p.lamps), `${name}: the lamps`);
    assert.deepEqual([...full.subarray(32, 35)], p.zenith.map(Math.fround), `${name}: the zenith`);
    for (const i of [0, 1, 2, 3, 11, 16, 17, 18, 21, 22]) assert.equal(full[i], plain[i], `${name}: index ${i} stays`);
  }
});

test("the moods differ where they should", () => {
  assert.equal(reads(PALETTES.matrix), false, "the Matrix grade stays a multiply");
  assert.equal(PALETTES.apple.saturation, 0, "Bad Apple is black and white");
  assert.equal(reads(PALETTES.apple), true);
  assert.ok(PALETTES.rick.lamps > 0 && PALETTES.rick.scan > 0, "the Rickroll keeps some lamps and a tape's lines");
  assert.ok(PALETTES.rick.fog < 1, "and thins the haze so the windows stay legible");
});

test("a video fits the windows' band, and a tall phone crops its sides", () => {
  const [w, h] = pictureSize(16 / 10, 128);
  const wide = fitVideo(w, h, 4 / 3);
  assert.ok(wide.width <= w + 1e-9 && wide.y >= h * 0.1 - 1e-9 && wide.y + wide.height <= h * 0.98 + 1e-9, "a wide view shows it whole");
  assert.ok(Math.abs(wide.x + wide.width / 2 - w / 2) < 1e-9, "centred");
  const [pw, ph] = pictureSize(390 / 844, 128);
  const tall = fitVideo(pw, ph, 4 / 3);
  assert.ok(tall.width > pw && tall.width <= pw * 2 + 1e-9, "a phone crops at most half its width");
  assert.ok(tall.height <= ph * 0.88 + 1e-9);
});

test("a video program repaints only on a new frame, and holds its last as it fades", () => {
  const media = { readyState: 1, videoWidth: 160, videoHeight: 120, currentTime: 0, addEventListener() {}, removeEventListener() {} };
  const program = videoProgram(media);
  assert.equal(program.moving, true);
  assert.equal(program.key(), -1, "nothing before the first frame");
  media.readyState = 4;
  media.currentTime = 1.5;
  assert.equal(program.key(), 1.5, "the element's time is the clock");
  assert.equal(program.key(), 1.5, "the same frame, the same key");
  program.dispose();
  media.currentTime = 2;
  assert.equal(program.key(), 1.5, "a stopped video holds its last picture");
});

test("private window videos fit the landing budget", { skip: !eggOverlay && "private egg overlay is absent" }, () => {
  for (const file of landingVideos) {
    const size = statSync(join(eggOverlay, file)).size;
    assert.ok(size > 0 && size < 4 * 1024 * 1024, `${file} is ${size} bytes`);
  }
});
