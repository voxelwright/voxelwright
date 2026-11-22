// Postcards from the overlook. home.js hands over a frame (the live canvas read in the task
// that submitted it, the still drawn over its poster, or the poster alone on the plain page);
// this module prints it as a picture postcard and offers it to keep or share.
// The layout helpers at the top are pure, so the tests can import them without a page.

const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export const DOMAIN = "zahynailo.dev";
export const PLACE = "Ina Coolbrith Park";

// A 6 by 4 inch card at 300 dpi, turned to match the view it was taken from.
// The bottom margin is wider: the caption is printed there, as on a real card.
export function cardLayout(frameWidth, frameHeight) {
  const portrait = frameHeight > frameWidth;
  const [width, height] = portrait ? [1200, 1800] : [1800, 1200];
  const margin = portrait ? 44 : 48;
  const band = portrait ? 176 : 136;
  return {
    portrait,
    width,
    height,
    photo: { x: margin, y: margin, w: width - margin * 2, h: height - margin - band },
    band: { x: margin, y: height - band, w: width - margin * 2, h: band },
  };
}

// The source rectangle that covers a destination of another shape, anchored as a fraction
// of the spare width and height (0.5 keeps the middle).
export function cover(sw, sh, dw, dh, ax = 0.5, ay = 0.5) {
  const scale = Math.max(dw / sw, dh / sh);
  const w = dw / scale,
    h = dh / scale;
  return { sx: (sw - w) * ax, sy: (sh - h) * ay, sw: w, sh: h };
}

export function dateLabel(date) {
  return `${date.getDate()} ${months[date.getMonth()]} ${date.getFullYear()}`;
}

export function fileName(date) {
  const two = (n) => String(n).padStart(2, "0");
  return `zahynailo-postcard-${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}.png`;
}

export function altText({ night, date }) {
  return `Postcard: “Greetings from San Francisco” over the ${night ? "night" : "daytime"} skyline from ${PLACE}, ${dateLabel(date)}, ${DOMAIN}.`;
}

/* ---------- Printing (needs a page) ---------- */

const paper = "#fbfaf6",
  ink = "#1c2730",
  quiet = "#55606b";
// The Voxelmorphism cube's golds, lit from the top left like the kit's voxels.
const gold = { face: "#ffc65a", light: "#ffe6a3", shade: "#e39b3d", side: "#b9662a", deep: "#7c3d18" };

function canvas(w, h) {
  const c = document.createElement("canvas");
  c.width = Math.round(w);
  c.height = Math.round(h);
  return c;
}

// The kit's Vox Block glyphs, ten cells to the em, set as solid voxels: an extruded body, then
// the face with each cell bevelled. The bevels are drawn on a layer so they stay inside the glyphs.
function voxelLine(c, text, x, baseline, cell) {
  const size = cell * 10;
  const font = `400 ${size}px "Vox Block", "IBM Plex Sans", sans-serif`;
  c.font = font;
  c.textAlign = "left";
  c.textBaseline = "alphabetic";
  const depth = Math.max(4, Math.round(cell * 0.85));
  c.save();
  c.shadowColor = "rgba(4, 10, 24, 0.55)";
  c.shadowBlur = cell * 1.4;
  c.shadowOffsetY = cell * 0.5;
  c.fillStyle = gold.deep;
  c.fillText(text, x + depth * 0.6, baseline + depth);
  c.restore();
  for (let k = depth; k > 0; k--) {
    c.fillStyle = k > depth * 0.55 ? gold.deep : gold.side;
    c.fillText(text, x + k * 0.6, baseline + k);
  }
  const m = c.measureText(text);
  const ascent = Math.ceil(m.actualBoundingBoxAscent),
    descent = Math.ceil(m.actualBoundingBoxDescent);
  const left = x - cell,
    top = baseline - ascent - cell;
  const layer = canvas(m.width + cell * 2, ascent + descent + cell * 2);
  const l = layer.getContext("2d");
  l.font = font;
  l.textBaseline = "alphabetic";
  l.fillStyle = gold.face;
  l.fillText(text, x - left, baseline - top);
  l.globalCompositeOperation = "source-atop";
  const bevel = Math.max(1, Math.round(cell * 0.16));
  const ox = x - left,
    oy = baseline - top;
  for (let i = -1; ox + i * cell < layer.width; i++)
    for (let j = -2; oy - j * cell > 0; j++) {
      const px = ox + i * cell,
        py = oy - (j + 1) * cell;
      l.fillStyle = gold.light;
      l.fillRect(px, py, cell, bevel);
      l.fillRect(px, py, bevel, cell);
      l.fillStyle = gold.shade;
      l.fillRect(px, py + cell - bevel, cell, bevel);
      l.fillRect(px + cell - bevel, py, bevel, cell);
    }
  c.drawImage(layer, left, top);
  return { width: m.width, ascent };
}

function fitCell(c, lines, width, most) {
  c.font = '400 100px "Vox Block", "IBM Plex Sans", sans-serif';
  const widest = Math.max(...lines.map((t) => c.measureText(t).width));
  return Math.max(4, Math.min(most, Math.floor((width * 10) / widest)));
}

function text(c, value, x, y, font, colour, align = "left") {
  c.font = font;
  c.fillStyle = colour;
  c.textAlign = align;
  c.textBaseline = "alphabetic";
  c.fillText(value, x, y);
}

export async function fontsReady() {
  await Promise.allSettled([
    document.fonts.load('400 100px "Vox Block"', "SAN FRANCISCO"),
    document.fonts.load('600 60px "Source Serif 4"', "Greetings from Ina Coolbrith Park"),
    document.fonts.load('500 30px "IBM Plex Sans"', "San Francisco 0123456789"),
    document.fonts.load('650 30px "IBM Plex Sans"', DOMAIN),
  ]);
}

// frame: a canvas or decoded image of the view. anchor: where to keep the frame when its shape
// differs from the card's photo window.
export async function printCard(frame, { night = false, date = new Date(), anchor = [0.5, 0.5] } = {}) {
  await fontsReady();
  const fw = frame.naturalWidth || frame.width,
    fh = frame.naturalHeight || frame.height;
  const layout = cardLayout(fw, fh);
  const card = canvas(layout.width, layout.height);
  const c = card.getContext("2d");
  c.fillStyle = paper;
  c.fillRect(0, 0, layout.width, layout.height);

  const { x, y, w, h } = layout.photo;
  const crop = cover(fw, fh, w, h, ...anchor);
  c.imageSmoothingEnabled = true;
  c.imageSmoothingQuality = "high";
  c.drawImage(frame, crop.sx, crop.sy, crop.sw, crop.sh, x, y, w, h);
  // A dusk-coloured scrim under the greeting, so the lettering reads over a bright day.
  const scrim = c.createLinearGradient(0, y + h * 0.42, 0, y + h);
  scrim.addColorStop(0, "rgba(8, 18, 34, 0)");
  scrim.addColorStop(1, night ? "rgba(8, 18, 34, 0.45)" : "rgba(8, 18, 34, 0.5)");
  c.fillStyle = scrim;
  c.fillRect(x, y, w, h);
  c.strokeStyle = "rgba(20, 30, 40, 0.18)";
  c.lineWidth = 2;
  c.strokeRect(x + 1, y + 1, w - 2, h - 2);

  // Greetings from / SAN FRANCISCO, set low in the picture where the park directory stood.
  const pad = layout.portrait ? 52 : 64;
  const lines = layout.portrait ? ["SAN", "FRANCISCO"] : ["SAN FRANCISCO"];
  const cell = fitCell(c, lines, w - pad * 2, layout.portrait ? 19 : 21);
  const depth = Math.max(4, Math.round(cell * 0.85));
  c.font = `400 ${cell * 10}px "Vox Block", "IBM Plex Sans", sans-serif`;
  const cap = Math.ceil(c.measureText(lines[0]).actualBoundingBoxAscent);
  const lead = cap + depth + cell * 2;
  let baseline = y + h - pad - depth - lead * (lines.length - 1);
  const greetingSize = Math.round(cell * 4.4);
  c.save();
  c.shadowColor = "rgba(4, 10, 24, 0.6)";
  c.shadowBlur = greetingSize * 0.18;
  c.shadowOffsetY = greetingSize * 0.04;
  // "from" has no descender, so its baseline sits a voxel and a half above the caps.
  text(c, "Greetings from", x + pad, baseline - cap - cell * 1.8, `600 ${greetingSize}px "Source Serif 4", Georgia, serif`, "#fff5de");
  c.restore();
  for (const line of lines) {
    voxelLine(c, line, x + pad, baseline, cell);
    baseline += lead;
  }

  // The caption, printed in the bottom margin.
  const band = layout.band;
  const first = band.y + band.h * 0.44,
    second = band.y + band.h * 0.74;
  const big = layout.portrait ? 46 : 42,
    small = layout.portrait ? 30 : 27;
  text(c, PLACE, band.x, first, `600 ${big}px "Source Serif 4", Georgia, serif`, ink);
  text(c, "San Francisco", band.x, second, `500 ${small}px "IBM Plex Sans", sans-serif`, quiet);
  const right = band.x + band.w;
  text(c, dateLabel(date), right, first - (big - small) * 0.35, `500 ${small}px "IBM Plex Sans", sans-serif`, quiet, "right");
  text(c, DOMAIN, right, second, `650 ${small}px "IBM Plex Sans", sans-serif`, ink, "right");
  return card;
}

/* ---------- The preview ---------- */

export function postcardDialog(dialog) {
  const print = dialog.querySelector(".postcard-print");
  const save = dialog.querySelector("[data-postcard-save]");
  const share = dialog.querySelector("[data-postcard-share]");
  const close = dialog.querySelector("[data-postcard-close]");
  const status = dialog.querySelector(".postcard-status");
  let url = "",
    file = null,
    back = null;
  close.addEventListener("click", () => dialog.close());
  // A press on the backdrop (outside the sheet) puts the card down too.
  dialog.addEventListener("click", (e) => {
    if (e.target !== dialog) return;
    const r = dialog.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) dialog.close();
  });
  share.addEventListener("click", async () => {
    // The file was made with the card, so nothing is awaited before share() and the press
    // still counts as the gesture it needs.
    try {
      await navigator.share({ files: [file], title: "Greetings from San Francisco", text: `${PLACE}, from ${DOMAIN}` });
      status.textContent = "Postcard shared.";
    } catch (error) {
      if (error?.name !== "AbortError") status.textContent = "This browser couldn’t share it. Download the PNG instead.";
    }
  });
  save.addEventListener("click", () => {
    status.textContent = "Postcard downloaded.";
  });
  dialog.addEventListener("close", () => {
    const target = back;
    back = null;
    // Keep the address alive until the download it may have started has read it.
    const old = url;
    setTimeout(() => URL.revokeObjectURL(old), 60000);
    target?.();
  });
  return {
    get open() {
      return dialog.open;
    },
    async show(card, { night, date, keyed = false }, returnFocus) {
      const blob = await new Promise((resolve, reject) =>
        card.toBlob((b) => (b ? resolve(b) : reject(Error("The postcard could not be printed"))), "image/png"),
      );
      const name = fileName(date);
      file = new File([blob], name, { type: "image/png" });
      url = URL.createObjectURL(blob);
      print.width = card.width;
      print.height = card.height;
      print.alt = altText({ night, date });
      print.src = url;
      dialog.toggleAttribute("data-portrait", card.height > card.width);
      dialog.toggleAttribute("data-keyed", keyed);
      save.href = url;
      save.download = name;
      let canShare = false;
      try {
        canShare = !!navigator.canShare?.({ files: [file] });
      } catch {}
      share.hidden = !canShare;
      status.textContent = "";
      await print.decode().catch(() => {});
      back = returnFocus;
      dialog.showModal();
      save.focus();
    },
  };
}

// The shutter: the view goes white for an instant and fades back as the print comes out.
// Under reduced motion there is no flash; the preview simply fades in.
export function shutter(flash) {
  const calm = matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (calm || !flash) return () => {};
  flash.removeAttribute("data-fade");
  flash.setAttribute("data-on", "");
  return () => {
    flash.setAttribute("data-fade", "");
    flash.removeAttribute("data-on");
  };
}
