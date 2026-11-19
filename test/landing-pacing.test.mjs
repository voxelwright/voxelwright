import assert from "node:assert/strict";
import test from "node:test";
import { pacing } from "../static/landing/pacing.js";
import { sound } from "../static/landing/sky.js";

const pixels = 2000000;
test("a fixed 30 fps target on a 120 Hz display skips three of four draws", () => {
  const pace = pacing({ target: 30, scale: 0.65, dynamic: false });
  const draws = Array.from({ length: 240 }, (_, i) => pace.frame((i * 1000) / 120, pixels));
  assert.equal(draws.filter((a) => a === "draw").length, 60);
  assert.equal(pace.scale, 0.65);
});

test("sustained late frames shrink the picture, then leave live at the floor", () => {
  const pace = pacing({ target: 60, scale: 0.8, dynamic: true });
  let now = 0;
  while (now < 4000) {
    pace.frame(now, pixels);
    now += 1000 / 60;
  }
  assert.equal(pace.scale, 0.8);
  let action;
  while (now < 11000 && action !== "plain") {
    action = pace.frame(now, pixels);
    now += 80;
  }
  assert.equal(action, "plain");
  assert.equal(pace.scale, 0.4);
});

test("a suspension, paused draws and warmup do not count toward fallback", () => {
  const pace = pacing({ target: 60, scale: 0.3, dynamic: true });
  for (const t of [0, 17, 34, 5000, 5017, 5034]) assert.notEqual(pace.frame(t, pixels), "plain");
  pace.resume();
  for (let i = 0; i < 40; i++) assert.equal(pace.frame(10000 + i * 90, pixels, false), "draw");
  assert.equal(pace.frame(13600, pixels), "draw");
});

test("an unchosen quality can step down first, and corrupt old settings are filtered", () => {
  const pace = pacing({ target: 60, scale: 0.3, dynamic: true }, () => true);
  const actions = Array.from({ length: 23 }, (_, i) => pace.frame(i * 90, pixels));
  assert(actions.includes("lower"));
  assert.deepEqual(sound({ preset: "high", scale: -1, dynamic: "true", target: 300 }), {
    preset: "high",
    scale: 0.3,
  });
});
