// Code rain for the window screen. Each column of windows carries drops of light
// that fall down the facades: a pale head, a green tail that fades behind it, and
// cells that flicker as their glyph changes. Windows are pixels here, so a glyph
// reads as a flicker in one pane. Original to this site; no font, sprite or footage.
const hash = (n) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};
export const HEAD = [200, 255, 210];
export const TAIL = [20, 235, 90];
// Between drops a pane is dark glass: the picture covers 90% of its usual look.
export const DARK = 230;
const DROPS = 3;

export function codeRain() {
  return {
    moving: true,
    rows: 110,
    gain: 1.35,
    draw(px, w, h, t) {
      for (let i = 0; i < px.length; i += 4) {
        px[i] = px[i + 1] = px[i + 2] = 0;
        px[i + 3] = DARK;
      }
      for (let x = 0; x < w; x++) {
        for (let k = 0; k < DROPS; k++) {
          const seed = x * 7.13 + k * 101.7;
          const speed = 9 + hash(seed) * 22; // Rows a second.
          const length = 6 + hash(seed + 1) * 30;
          const period = h + length + 4 + hash(seed + 2) * h;
          // Every drop starts above the top, so the rain arrives rather than appears.
          const raw = t * speed - hash(seed + 3) * h * 0.9 - k * period * 0.4;
          if (raw < 0) continue;
          const head = raw % period;
          const top = Math.max(0, Math.ceil(head - length));
          const bottom = Math.min(h - 1, Math.floor(head));
          for (let y = top; y <= bottom; y++) {
            const d = head - y;
            const fade = (1 - d / length) ** 1.6;
            const swap = Math.floor(t * (6 + hash(x * 3.1 + y) * 10) + hash(x + y * 9.7) * 9);
            const flicker = 0.62 + 0.38 * hash(x * 131 + y * 17 + swap * 0.37);
            const c = d < 1 ? HEAD : TAIL;
            const b = (d < 1 ? 1 : fade * flicker);
            const i = (y * w + x) * 4;
            px[i] = Math.max(px[i], c[0] * b);
            px[i + 1] = Math.max(px[i + 1], c[1] * b);
            px[i + 2] = Math.max(px[i + 2], c[2] * b);
          }
        }
      }
    },
  };
}
