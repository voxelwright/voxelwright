// Adapted from Village player/stage.ts (#425). Sample presented frame intervals,
// separately from simulation dt. Only active, consecutive draws supply evidence.
import { SCALE } from "./sky.js";

const step = (v) => Math.round(v * 20) / 20;

export function pacing(settings, canLower = () => false) {
  let scale,
    previous,
    due,
    lastDraw,
    samples,
    elapsed,
    warmup,
    ceiling,
    retry,
    hold,
    rose,
    slow,
    late,
    lateWindows,
    stalled,
    refresh;
  function resume() {
    previous = lastDraw = null;
    due = samples = elapsed = slow = late = lateWindows = 0;
    warmup = 2;
    stalled = false;
    refresh = 1000 / 60;
  }
  function configure(startingScale = settings.scale) {
    scale = settings.dynamic ? Math.min(settings.scale, startingScale) : settings.scale;
    ceiling = Infinity;
    retry = 0;
    hold = 8000;
    rose = -Infinity;
    resume();
  }
  configure();
  return {
    get scale() {
      return scale;
    },
    resume,
    configure,
    frame(now, nativePixels, sample = true) {
      const budget = 1000 / settings.target;
      if (previous !== null && now - previous > 1000) {
        // One long interruption is suspension. Consecutive multi-second frames
        // while visible also need a route out.
        if (sample && stalled) return "plain";
        resume();
        stalled = true;
      } else {
        stalled = false;
        if (previous !== null && now > previous + 3) refresh = Math.min(refresh, now - previous);
      }
      previous = now;
      if (now + 1 < due) return "skip";
      // Preserve cadence on displays whose refresh is not a multiple of target.
      if (!due || now - due >= budget) due = now;
      due += budget;
      const gap = lastDraw === null ? 0 : now - lastDraw;
      lastDraw = now;
      if (!sample) {
        samples = elapsed = slow = late = lateWindows = 0;
        warmup = 2;
        return "draw";
      }
      if (warmup) {
        warmup--;
        return "draw";
      }
      elapsed += gap;
      samples++;
      if (elapsed < 450 || samples < 2) return "draw";

      const mean = elapsed / samples;
      const floor = Math.min(settings.scale, Math.max(SCALE.least, step(Math.sqrt(300000 / nativePixels))));
      const atFloor = !settings.dynamic || scale <= floor;
      slow = atFloor && mean > 55 ? slow + elapsed : 0;

      // A 60 Hz display cannot establish a missed 120 Hz deadline from rAF
      // alone. Cap the steering budget at the shortest observed refresh.
      const available = Math.max(budget, refresh);
      late = atFloor && mean > available * 1.2 ? late + elapsed : 0;
      if (late >= 1350 && canLower()) return "lower";
      if (slow >= 2200) return "plain";
      // Require consecutive slow windows so a single hitch cannot resize the canvas.
      lateWindows = !atFloor && mean > available * 1.25 ? lateWindows + 1 : 0;
      if (lateWindows >= 3) {
        if (now - rose < 3000) {
          ceiling = scale;
          retry = now + hold;
          hold = Math.min(128000, hold * 2);
        }
        scale = Math.max(floor, step(Math.min(scale - 0.05, scale * Math.sqrt((1.2 * available) / mean))));
        lateWindows = 0;
        warmup = 2;
      } else if (settings.dynamic && mean <= available * 1.08 && scale < settings.scale) {
        const next = Math.min(settings.scale, Math.max(floor, step(scale + 0.05)));
        if (next < ceiling || now >= retry) {
          scale = next;
          rose = now;
          warmup = 2;
        }
      }
      elapsed = samples = 0;
      return "draw";
    },
  };
}
