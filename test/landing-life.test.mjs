import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { city } from "../static/landing/shaders.js";
import { surveyCamera, project } from "../static/landing/survey.js";
import {
  windowsShader,
  windowClock,
  gulls,
  flockCentre,
  FLOCKS,
  WANDER,
  BOB,
  SPREAD,
} from "../static/landing/life.js";

const index = JSON.parse(readFileSync(new URL("../static/landing/place.json", import.meta.url)));
const bytes = gunzipSync(readFileSync(new URL("../static/landing/ina.faces.gz", import.meta.url)));
const faces = new Uint8Array(bytes.length);
for (let j = 0; j < 20; j++) for (let i = 0; i < index.faces; i++) faces[i * 20 + j] = bytes[j * index.faces + i];
const words = new Uint32Array(faces.buffer);
const turn = (index.turn * Math.PI) / 180;

// Every roof: centre, half diagonal, top, all in pack cells.
const roofs = [];
{
  let first = 0;
  for (const b of index.blocks) {
    const c0 = b.c0 ?? [Math.cos(turn), 0, -Math.sin(turn)],
      c2 = b.c2 ?? [Math.sin(turn), 0, Math.cos(turn)];
    for (let i = first; i < first + b.faces; i++) {
      const w0 = words[i * 5],
        w2 = words[i * 5 + 2];
      if (((w2 >> 10) & 3) !== 0) continue;
      const lu = w0 >>> 22,
        lw = w2 & 0x3ff;
      const x = (w0 & 0x7ff) + lu / 2,
        z = ((w0 >> 11) & 0x7ff) + lw / 2;
      roofs.push([
        b.pos[0] + (c0[0] * x + c2[0] * z) * b.cell,
        b.pos[2] + (c0[2] * x + c2[2] * z) * b.cell,
        (Math.hypot(lu, lw) * b.cell) / 2,
        words[i * 5 + 1] >>> 16,
      ]);
    }
    first += b.faces;
  }
}

test("a zero window clock keeps the original lit pattern, and the clock moves in whole steps", () => {
  const patched = windowsShader(city);
  assert.notEqual(patched, city);
  assert.match(patched, /g\.pad1/);
  // With pad1 = 0, turn = floor(fract(seed * 7.31)) = 0, so the hash is sin(pick) as before.
  assert.match(patched, /let window = fract\(sin\(pick \+ turn \* 1\.618\) \* 437\.15\);/);
  assert.match(patched, /let pick = dot\(floor\(vec2f\(fx,fy\)\),vec2f\(12\.31,78\.19\)\) \+ f32\(in\.id\);/);
  assert.throws(() => windowsShader("struct Out {}"), /window pattern/);
  assert.equal(windowClock(0), 0);
  assert.equal(windowClock(0.99), 0);
  assert.equal(windowClock(7.4), 7);
});

test("every gull clears the roofs under its orbit by at least 10 m", () => {
  const anchor = index.blocks[0].pos;
  const flock = gulls(index, anchor);
  assert.equal(flock.length, FLOCKS.reduce((n, f) => n + f.birds, 0) * 8);
  for (const f of FLOCKS) {
    const [cx, cy, cz] = flockCentre(index, f);
    // Orbit, wander, the spread of radii and a wingspan, in cells.
    const reach = (f.radius * (1 + WANDER) + 4 + 1) * 10;
    let highest = 0;
    for (const [x, z, half, top] of roofs) {
      if (Math.hypot(x - cx, z - cz) - half < reach) highest = Math.max(highest, top);
    }
    const lowest = cy - (SPREAD + BOB + 0.5) * 10;
    assert.ok(lowest - highest >= 100, `flock at ${f.bearing}° clears ${(lowest - highest) / 10} m`);
  }
});

test("every flock circles inside the surveyed view, above the horizon", () => {
  const home = surveyCamera(index);
  const [w, h] = index.camera.size;
  for (const f of FLOCKS) {
    const [x, y, d] = project(flockCentre(index, f), home, w, h);
    assert.ok(d > 0 && x > w * 0.15 && x < w * 0.85, `flock at ${f.bearing}° x ${x}`);
    assert.ok(y > h * 0.1 && y < h * 0.5, `flock at ${f.bearing}° y ${y}`);
  }
});
