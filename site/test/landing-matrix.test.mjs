import test from "node:test";
import assert from "node:assert/strict";
import { city, cloud } from "../static/landing/shaders.js";
import { windowsShader } from "../static/landing/life.js";
import { screenShader, pictureSize, testCard, ROWS } from "../static/landing/screen.js";
import { moody, moodSky, MOOD } from "../static/landing/mood.js";
import { codeRain, DARK } from "../static/landing/matrix.js";

// The Globals block as place.js fills it: 56 floats, each its own index.
const globals = () => Float32Array.from({ length: 56 }, (_, i) => i / 100 + 0.01);

test("the window map is added beside the city's fragment, which stays as it was", () => {
  const before = windowsShader(city);
  const after = screenShader(before);
  const fs = before.slice(before.indexOf("@fragment fn fs"));
  assert.ok(after.includes(fs), "the city fragment is unchanged");
  assert.match(after, /@fragment fn panes\(in: Out\)/);
  assert.match(after, /@builtin\(position\) @invariant pos: vec4f/);
  assert.throws(() => screenShader(before.replace("@builtin(position) pos: vec4f,", "")), /output moved/);
});

test("the overcast deck replaces the sky only while the mood is up", () => {
  const sky = moodSky(cloud);
  assert.ok(sky.startsWith(cloud.slice(0, cloud.lastIndexOf("  return col;\n}"))), "the sky is unchanged up to its end");
  assert.match(sky, /if \(g\.weather\.x > 0\.0\) \{ col = mix\(col, overcast\(rd\), g\.weather\.x\); \}\n  return col;\n\}/);
  assert.match(sky, /fn overcast\(rd: vec3f\) -> vec3f/);
  assert.throws(() => moodSky("fn other() {}"), /ending moved/);
});

test("a zero mood leaves the scene's light alone, a full one turns it", () => {
  const plain = globals();
  assert.deepEqual(moody(globals(), 0), plain);
  const full = moody(globals(), 1);
  assert.equal(full[52], 1, "weather.x carries the deck");
  assert.equal(full[54], 0, "the city's lamps and lit windows go out");
  assert.deepEqual([...full.subarray(32, 35)], MOOD.zenith.map(Math.fround));
  assert.ok(full[15] < plain[15], "less daylight");
  for (const i of [0, 1, 2, 3, 11, 16, 17, 18, 21, 22]) assert.equal(full[i], plain[i], `camera, clock, sun, moon and windows stay (${i})`);
});

test("the picture keeps square pixels at any aspect", () => {
  assert.deepEqual(pictureSize(16 / 10), [144, ROWS]);
  assert.deepEqual(pictureSize(390 / 844, 110), [51, 110]);
  assert.deepEqual(pictureSize(100, 110), [512, 110]);
});

test("the code rain arrives from above, then fills the screen", () => {
  const [w, h] = pictureSize(16 / 10, 110);
  const px = new Uint8ClampedArray(w * h * 4);
  const rain = codeRain();
  const lit = (t) => {
    rain.draw(px, w, h, t);
    let n = 0;
    for (let i = 0; i < px.length; i += 4) {
      assert.equal(px[i + 3], DARK);
      if (px[i + 1] > 40) n++;
    }
    return n;
  };
  assert.equal(lit(0), 0, "nothing at the first frame");
  const early = lit(1);
  const later = lit(8);
  assert.ok(early > 0 && later > early * 2, `${early} then ${later} lit panes`);
  assert.ok(later < w * h * 0.6, "rain, not a wash");
  // The same time draws the same picture, so Pause holds a frame.
  const a = px.slice();
  rain.draw(px, w, h, 8);
  assert.deepEqual(px, a);
  // Each drop's head is the brightest green.
  const greenest = Math.max(...Array.from({ length: w * h }, (_, i) => px[i * 4 + 1]));
  assert.equal(greenest, 255);
});

test("the test card is a still picture with a grid", () => {
  const card = testCard();
  assert.equal(card.moving, false);
  const px = new Uint8ClampedArray(16 * 16 * 4);
  card.draw(px, 16, 16, 0);
  assert.deepEqual([...px.subarray(0, 4)], [255, 255, 255, 255]);
});
