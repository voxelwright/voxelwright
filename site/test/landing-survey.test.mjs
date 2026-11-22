import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { surveyPoint, surveyCamera, framing, cropCamera, project } from "../static/landing/survey.js";

const index = JSON.parse(readFileSync(new URL("../static/landing/place.json", import.meta.url)));
const home = surveyCamera(index);
function near(actual, expected, tolerance = 1e-6) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} differs from ${expected}`);
}

test("the Ina camera and new fixtures use the native Bay survey frame", () => {
  // The solved eye in Village's landing/ina/camera.json, before export rounding.
  const eye = surveyPoint(551646.66417, 4183597.73738, 86.98487);
  eye.forEach((v, i) => near(v, home.eye[i], 0.06));
  const a = surveyPoint(552000, 4183460, 64.6);
  const b = surveyPoint(552001, 4183461, 65.6);
  b.forEach((v, i) => near(v - a[i], [10, 10, -10][i]));
});

test("the still, live props and hit regions project the same points at each viewport", () => {
  const points = [surveyPoint(552006.66, 4183455.89, 64.6), surveyPoint(551798.7, 4183480.5, 59)];
  const cabinet = { left: 615, top: 360, right: 955, bottom: 798 };
  for (const [width, height] of [
    [390, 844],
    [1280, 860],
    [844, 390],
    [2560, 900],
  ]) {
    for (const open of [true, false]) {
      const crop = framing(index, width, height, cabinet, open);
      const frame = cropCamera(home, index, crop);
      for (const point of points) {
        const [sx, sy, depth] = project(point, home, ...index.camera.size);
        const [x, y, d] = project(point, frame, width, height);
        near(x, crop.left + sx * crop.scale);
        near(y, crop.top + sy * crop.scale);
        near(d, depth);
      }
    }
  }
});

test("leaning the head keeps the park directory on its ray and the rest pose exact", async () => {
  const { lean } = await import("../static/landing/survey.js");
  const pivot = surveyPoint(551658.15, 4183592.61, 85.05);
  const far = surveyPoint(552006.66, 4183455.89, 70);
  assert.equal(lean(home, pivot, 0, 0), home);
  const still = project(pivot, home, 1440, 900);
  const before = project(far, home, 1440, 900);
  for (const [side, rise] of [[0.25, 0], [0, 0.1], [-0.25, -0.1]]) {
    const leaned = lean(home, pivot, side, rise);
    const at = project(pivot, leaned, 1440, 900);
    near(at[0], still[0], 1e-6);
    near(at[1], still[1], 1e-6);
    // The rooftop marquee 380 m out slides behind the directory, but only a little.
    const moved = Math.hypot(...project(far, leaned, 1440, 900).slice(0, 2).map((v, i) => v - before[i]));
    assert.ok(moved > 5 && moved < 60, `marquee moved ${moved}px`);
  }
});

test("tower beacons sit on the tallest surveyed roofs", async () => {
  const { gunzipSync } = await import("node:zlib");
  const { findBeacons } = await import("../static/landing/beacons.js");
  const bytes = gunzipSync(readFileSync(new URL("../static/landing/ina.faces.gz", import.meta.url)));
  const faces = new Uint8Array(bytes.length);
  for (let j = 0; j < 20; j++) for (let i = 0; i < index.faces; i++) faces[i * 20 + j] = bytes[j * index.faces + i];
  const lamps = findBeacons(faces, index);
  assert.ok(lamps.length >= 6 && lamps.length <= 14);
  // Salesforce Tower's crown, at Fremont and Mission, stands about 326 m over the street.
  const crown = surveyPoint(553097, 4182672, 331);
  assert.ok(Math.hypot(lamps[0][0] - crown[0], lamps[0][2] - crown[2]) < 20 * 10);
  assert.ok(Math.abs(lamps[0][1] - crown[1]) < 5 * 10);
  for (const lamp of lamps) assert.ok(lamp[1] >= surveyPoint(0, 0, 140)[1]);
});
