// npm run cards: paints the share cards, the pictures a link to this site shows on X, LinkedIn,
// iMessage, Slack and Discord. Each is the city's GPU-free still (the published poster and the
// real sign painter from static/landing/) with the page's title on the park sign, 1200 × 630.
// Writes static/og/, which is committed; the build only links the cards (generator/pages.mjs,
// shareCard) and `npm run check` fails when a page links one that isn't there.
//
// Needs Chrome and Playwright, which are not dependencies of the site:
//   PLAYWRIGHT=/path/to/node_modules/playwright npm run cards
// One card to look at, not committed:
//   npm run cards -- --title "A title to try" --out /tmp/card.png
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { createRequire } from "node:module";
import { build } from "../generator/build.mjs";
import { shareCard, CARD } from "../generator/pages.mjs";
import { startServer } from "./serve.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const OG = path.join(ROOT, "static", "og");
const BUDGET = 300 * 1024;

/** The cards the site links, from a production build: [{ file, title, plates }]. Drafts never get one. */
export function cardJobs(pages, site) {
  const host = new URL(site.origin).host;
  const jobs = new Map();
  for (const page of pages) {
    const card = shareCard(page);
    if (!card || jobs.has(card)) continue;
    const home = page.kind === "home";
    jobs.set(card, {
      file: card.replace(/^\/og\//, ""),
      title: home ? site.title : page.title,
      // the plates under the title: the home card keeps the sign's own two places
      plates: home ? ["Blog", "Voxelmorphism"] : [site.author, host],
    });
  }
  return [...jobs.values()];
}

// ---------------------------------------------------------------------------
// The card page. It runs in Chrome on the site's own origin, so the landing's modules load as
// they do on the home page. Nothing here changes how they draw; the title is painted over the
// enamel that paintBoards lays down, in the sign's own faces and colours.

const PAGE = `<!doctype html>
<meta charset="utf-8">
<style>
@font-face { font-family: "IBM Plex Sans"; src: url(/vendor/village/kit/fonts/ibm-plex-sans/ibm-plex-sans-latin-wght-normal.woff2) format("woff2"); font-weight: 100 700; }
@font-face { font-family: "Source Serif 4"; src: url(/fonts/source-serif-4/source-serif-4-latin-opsz-normal.woff2) format("woff2"); font-weight: 200 900; }
html, body { margin: 0; background: #000; }
</style>
<script type="module" src="/__cards/card.js"></script>
`;

const SCRIPT = String.raw`
import { signScene } from "/landing/signs.js";
import { drawStill } from "/landing/sign-renderer.js";
import { paintBoards, areas } from "/landing/sign-paint.js";
import { surveyCamera, cropCamera, project, cellsPerMetre } from "/landing/survey.js";

const W = ${CARD.width}, H = ${CARD.height}, R = devicePixelRatio;
const cream = "#fff1ce", dark = "#082a29";
const serif = '"Source Serif 4"', sans = '"IBM Plex Sans"';

const index = await (await fetch("/landing/place.json")).json();
const poster = new Image();
poster.src = "/landing/ina.webp";
await poster.decode();
for (const font of ["560 40px " + serif, "650 40px " + sans, "700 40px " + sans])
  if (!(await document.fonts.load(font)).length) throw Error("The sign's face did not load: " + font);

const distance = (a, b) => Math.hypot(...a.map((v, i) => v - b[i]));

// Words in lines no wider than max, as even as they can be.
function wrap(c, words, max) {
  const greedy = (limit) => {
    const lines = [];
    for (const word of words) {
      const last = lines.at(-1);
      if (last && c.measureText(last + " " + word).width <= limit) lines[lines.length - 1] = last + " " + word;
      else lines.push(word);
    }
    return lines;
  };
  const lines = greedy(max);
  let lo = 0, hi = max;
  while (hi - lo > 1) {
    const mid = (lo + hi) / 2;
    if (greedy(mid).length <= lines.length) hi = mid;
    else lo = mid;
  }
  return greedy(hi);
}

// The title: as large as fits, up to four lines, never squeezed.
function fitTitle(c, title, box) {
  const words = title.trim().split(/\s+/);
  for (let size = box.largest; size >= 40; size -= 2) {
    c.font = "560 " + size + "px " + serif;
    const lines = wrap(c, words, box.width);
    const leading = size * (lines.length > 1 ? 1.1 : 1);
    if (lines.length <= 4 && lines.every((l) => c.measureText(l).width <= box.width) && lines.length * leading <= box.height)
      return { size, lines, leading };
  }
  throw Error("The title does not fit on the sign: " + title);
}

function label(c, text, x, y, size, max, weight, font) {
  for (; size > 12; size -= 1) {
    c.font = weight + " " + size + "px " + font;
    if (c.measureText(text).width <= max) break;
  }
  c.fillStyle = cream;
  c.textAlign = "center";
  c.textBaseline = "middle";
  c.fillText(text, x, y);
}

window.paintCard = ({ title, plates, frame }) => {
  const scene = signScene(index, title);
  scene.update({ live: false, offline: false, night: false, broken: false });
  // A square view gives the directory its tall (compact) cabinet: more enamel for the title.
  scene.size(1000, 1000);
  const board = scene.hits.find((hit) => hit.id === "station-face").points;
  const across = distance(board[0], board[1]) / cellsPerMetre,
    tall = distance(board[0], board[3]) / cellsPerMetre;

  // The real painter lays the enamel, frame, rivets and the park's name; the title is left blank.
  const face = 1024 * (tall / across);
  paintBoards(scene.atlas, {
    title: "", hover: "", focus: "", pressed: "", night: false, paused: false, sound: false,
    open: false, broken: false, cabinet: { body: { w: across, h: tall } }, stationRows: [],
  });
  const c = scene.atlas.getContext("2d");
  const [ax, ay, aw, ah] = areas.station;
  c.save();
  c.translate(ax, ay);
  c.scale(aw / 1024, ah / face);
  // Plates sit where the sign's bottom row of plates sits (signs.js), and look like them.
  const v = 1 - 0.34 / tall, vh = 0.32 / tall;
  let u = 0.025;
  for (const text of plates) {
    const w = 0.95 / plates.length;
    const x = u * 1024, y = v * face, ww = w * 1024, hh = vh * face;
    c.fillStyle = dark;
    c.fillRect(x + 2, y + 3, ww - 4, hh - 6);
    label(c, text, x + ww / 2, y + hh * 0.53, Math.min(57, ww * 0.13), ww * 0.84, 650, sans);
    u += w;
  }
  const top = 98, bottom = v * face - 12;
  const fit = fitTitle(c, title, { width: 1024 - 124, height: bottom - top, largest: 160 });
  c.font = "560 " + fit.size + "px " + serif;
  c.fillStyle = cream;
  c.textAlign = "center";
  c.textBaseline = "middle";
  const first = (top + bottom) / 2 - ((fit.lines.length - 1) * fit.leading) / 2;
  fit.lines.forEach((line, i) => c.fillText(line, 512, first + i * fit.leading));
  c.restore();

  // One crop for the poster and the camera, as on the home page (survey.js framing).
  const [sw, sh] = index.camera.size;
  const home = surveyCamera(index);
  const p = board.map((point) => project(point, home, sw, sh));
  const centre = [(Math.min(...p.map((q) => q[0])) + Math.max(...p.map((q) => q[0]))) / 2,
    (Math.min(...p.map((q) => q[1])) + Math.max(...p.map((q) => q[1]))) / 2];
  const s = frame.scale;
  const left = Math.min(0, Math.max(W - sw * s, frame.x * W - centre[0] * s));
  const shift = Math.min(0, Math.max(H - sh * s, frame.y * H - centre[1] * s));
  const crop = { scale: s, left, top: shift, width: W, height: H };
  const camera = cropCamera(home, index, crop);

  const signs = document.createElement("canvas");
  signs.width = W * R;
  signs.height = H * R;
  signs.getContext("2d").imageSmoothingQuality = "high";
  drawStill(signs, scene, camera, W, H, index.sun.vector);

  const big = document.createElement("canvas");
  big.width = W * R;
  big.height = H * R;
  const b = big.getContext("2d");
  b.imageSmoothingQuality = "high";
  b.drawImage(poster, left * R, shift * R, sw * s * R, sh * s * R);
  b.drawImage(signs, 0, 0);
  const out = document.createElement("canvas");
  out.width = W;
  out.height = H;
  const o = out.getContext("2d");
  o.imageSmoothingQuality = "high";
  o.drawImage(big, 0, 0, W, H);
  const data = o.getImageData(0, 0, W, H).data;
  let text = "";
  for (let i = 0; i < data.length; i += 0x8000) text += String.fromCharCode(...data.subarray(i, i + 0x8000));
  return btoa(text);
};
window.cardReady = true;
`;

// ---------------------------------------------------------------------------
// PNG out, with no dependency: at most 256 colours, then an indexed PNG through node:zlib.
// A truecolour city is several times the size a share card should be.

// Distance between colours, weighted for the eye (green most, blue next).
const W8 = [2, 4, 3];
const near = (a, b) => W8[0] * (a[0] - b[0]) ** 2 + W8[1] * (a[1] - b[1]) ** 2 + W8[2] * (a[2] - b[2]) ** 2;

/** Up to `count` [r, g, b] colours for a picture: variance median cut, then a few k-means rounds. */
export function palette(rgba, count = 256) {
  const hist = new Map();
  for (let i = 0; i < rgba.length; i += 4) {
    const key = (rgba[i] << 16) | (rgba[i + 1] << 8) | rgba[i + 2];
    hist.set(key, (hist.get(key) ?? 0) + 1);
  }
  const colours = [...hist.keys()].map((k) => [(k >> 16) & 255, (k >> 8) & 255, k & 255]);
  const weights = [...hist.values()];
  const stats = (box) => {
    let n = 0;
    const sum = [0, 0, 0], sq = [0, 0, 0];
    for (const i of box) {
      const w = weights[i];
      n += w;
      for (let k = 0; k < 3; k++) {
        sum[k] += colours[i][k] * w;
        sq[k] += colours[i][k] ** 2 * w;
      }
    }
    const error = sq.map((v, k) => (v - sum[k] ** 2 / n) * W8[k]);
    return { error: error[0] + error[1] + error[2], axis: error.indexOf(Math.max(...error)) };
  };
  const boxes = [colours.map((_, i) => i)].map((box) => ({ box, ...stats(box) }));
  while (boxes.length < count) {
    let pick = -1;
    for (const [i, b] of boxes.entries()) if (b.box.length > 1 && (pick < 0 || b.error > boxes[pick].error)) pick = i;
    if (pick < 0) break;
    const { box, axis } = boxes[pick];
    box.sort((a, b) => colours[a][axis] - colours[b][axis]);
    // split at the weighted median
    const total = box.reduce((s, i) => s + weights[i], 0);
    let at = 0;
    for (let seen = 0; at < box.length - 1 && seen + weights[box[at]] <= total / 2; at++) seen += weights[box[at]];
    at = Math.max(1, at);
    const parts = [box.slice(0, at), box.slice(at)];
    boxes.splice(pick, 1, ...parts.map((part) => ({ box: part, ...stats(part) })));
  }
  let centres = boxes.map(({ box }) => mean(box));
  function mean(members) {
    let n = 0;
    const sum = [0, 0, 0];
    for (const i of members) {
      n += weights[i];
      for (let k = 0; k < 3; k++) sum[k] += colours[i][k] * weights[i];
    }
    return sum.map((v) => v / n);
  }
  for (let round = 0; round < 4; round++) {
    const groups = centres.map(() => []);
    for (const [i, c] of colours.entries()) {
      let best = 0, d = Infinity;
      for (const [j, centre] of centres.entries()) {
        const e = near(c, centre);
        if (e < d) [d, best] = [e, j];
      }
      groups[best].push(i);
    }
    centres = groups.map((g, j) => (g.length ? mean(g) : centres[j]));
  }
  return centres.map((c) => c.map(Math.round));
}

/** Indices into `colours` for every pixel, nearest for the eye, with optional error diffusion. */
export function remap(rgba, width, height, colours, dither = 0) {
  const out = new Uint8Array(width * height);
  const cache = new Map();
  const nearest = (r, g, b) => {
    const key = (r << 16) | (g << 8) | b;
    let best = cache.get(key);
    if (best !== undefined) return best;
    let d = Infinity;
    for (const [i, colour] of colours.entries()) {
      const e = near([r, g, b], colour);
      if (e < d) [d, best] = [e, i];
    }
    cache.set(key, best);
    return best;
  };
  const err = new Float32Array((width + 2) * 2 * 3);
  for (let y = 0; y < height; y++) {
    const row = (y & 1) * (width + 2) * 3,
      next = ((y + 1) & 1) * (width + 2) * 3;
    err.fill(0, next, next + (width + 2) * 3);
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4,
        e = row + (x + 1) * 3;
      const want = [0, 1, 2].map((k) => Math.max(0, Math.min(255, Math.round(rgba[i + k] + err[e + k]))));
      const index = nearest(...want);
      out[y * width + x] = index;
      for (let k = 0; k < 3; k++) {
        const q = (want[k] - colours[index][k]) * dither;
        err[e + 3 + k] += (q * 7) / 16;
        err[next + x * 3 + k] += (q * 3) / 16;
        err[next + (x + 1) * 3 + k] += (q * 5) / 16;
        err[next + (x + 2) * 3 + k] += q / 16;
      }
    }
  }
  return out;
}

const CRC = Array.from({ length: 256 }, (_, n) => {
  for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC[(c ^ byte) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "latin1");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

/** An 8-bit indexed PNG. */
export function indexedPng(indices, width, height, colours) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 3, 0, 0, 0], 8);
  const raw = Buffer.alloc((width + 1) * height);
  for (let y = 0; y < height; y++) raw.set(indices.subarray(y * width, (y + 1) * width), y * (width + 1) + 1);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("PLTE", Buffer.from(colours.flat())),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9, memLevel: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** An indexed PNG of an opaque RGBA picture: as many colours as the budget allows, no dither. */
export function encodeCard(rgba, width, height) {
  let png;
  for (const count of [256, 240, 224, 208, 192]) {
    const colours = palette(rgba, count);
    png = indexedPng(remap(rgba, width, height, colours, 0), width, height, colours);
    if (png.length <= BUDGET) break;
  }
  return png;
}

// ---------------------------------------------------------------------------

// The framing: the poster at 1.1× its own pixels, which keeps the skyline, the BLOG marquee and
// the Voxelmorphism board in view while the park sign is large enough to read in a feed; the
// sign's centre at 36% across and 66% down. Try others with --scale, --x and --y.
export const FRAME = { scale: 1.1, x: 0.36, y: 0.66 };

export async function renderCards(jobs, { root, frame = FRAME }) {
  const require = createRequire(import.meta.url);
  const { chromium } = require(process.env.PLAYWRIGHT ?? "playwright");
  const server = await startServer({ root, port: 0, host: "127.0.0.1" });
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ channel: "chrome" });
  try {
    const page = await browser.newPage({ viewport: { width: CARD.width, height: CARD.height }, deviceScaleFactor: 2 });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route(`${base}/__cards/**`, (route) => {
      const script = route.request().url().endsWith(".js");
      route.fulfill({ contentType: script ? "text/javascript" : "text/html", body: script ? SCRIPT : PAGE });
    });
    await page.goto(`${base}/__cards/`);
    await page.waitForFunction(() => window.cardReady || null, null, { timeout: 30000 }).catch(() => {
      throw Error(`The card page did not start: ${errors.join("; ") || "no error reported"}`);
    });
    const results = [];
    for (const job of jobs) {
      const rgba = Buffer.from(await page.evaluate((args) => window.paintCard(args), { ...job, frame }), "base64");
      results.push({ ...job, rgba });
    }
    return results;
  } finally {
    await browser.close();
    server.close();
  }
}

async function main(args) {
  const option = (name) => {
    const i = args.indexOf(name);
    return i < 0 ? undefined : args[i + 1];
  };
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "site-cards-"));
  try {
    const { pages, site } = await build({ outDir: tmp });
    let jobs = cardJobs(pages, site);
    const title = option("--title");
    if (title) jobs = [{ file: option("--out") ?? "preview.png", title, plates: [site.author, new URL(site.origin).host] }];
    const frame = { ...FRAME, ...(option("--scale") && { scale: Number(option("--scale")) }), ...(option("--x") && { x: Number(option("--x")) }), ...(option("--y") && { y: Number(option("--y")) }) };
    const cards = (await renderCards(jobs, { root: tmp, frame })).map((card) => ({ ...card, png: encodeCard(card.rgba, CARD.width, CARD.height) }));
    if (title) {
      const file = path.resolve(jobs[0].file);
      fs.writeFileSync(file, cards[0].png);
      console.log(`${file}  ${Math.round(cards[0].png.length / 1024)} KB`);
      return;
    }
    // static/og holds exactly the cards the site links: stale ones (an unpublished post) go.
    const keep = new Set(cards.map((card) => path.join(OG, card.file)));
    for (const file of fs.existsSync(OG) ? walk(OG) : []) if (file.endsWith(".png") && !keep.has(file)) fs.rmSync(file);
    for (const card of cards) {
      const file = path.join(OG, card.file);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, card.png);
      const kb = Math.round(card.png.length / 1024);
      console.log(`static/og/${card.file}  ${kb} KB  “${card.title}”${card.png.length > BUDGET ? "  (over the 300 KB budget)" : ""}`);
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
}

if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) await main(process.argv.slice(2));
