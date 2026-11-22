// The sign painter supplies enamel and lettering to the mesh's front faces.
export const atlasSize = [1024, 1792];
export const areas = {
  voxel: [0, 0, 1024, 288],
  station: [0, 304, 1024, 548],
  settings: [0, 872, 1024, 896],
};

const cream = "#fff1ce",
  brass = "#f6cb73",
  green = "#123d39",
  dark = "#082a29",
  phosphor = "#8dffa8";
function label(ctx, text, x, y, size, options = {}) {
  const { colour = cream, align = "left", weight = 650, font = "\"IBM Plex Sans\", sans-serif", max = 960 } = options;
  ctx.font = weight + " " + size + "px " + font;
  ctx.fillStyle = colour;
  ctx.textAlign = align;
  ctx.textBaseline = "middle";
  ctx.fillText(text, x, y, max);
}
function line(c, x, y, x2, y2, colour, size = 2) {
  c.strokeStyle = colour;
  c.lineWidth = size;
  c.beginPath();
  c.moveTo(x, y);
  c.lineTo(x2, y2);
  c.stroke();
}
function disc(c, x, y, r, colour) {
  c.beginPath();
  c.arc(x, y, r, 0, Math.PI * 2);
  c.fillStyle = colour;
  c.fill();
}
function enamel(c, w, h) {
  const grad = c.createLinearGradient(0, 0, w * 0.55, h);
  grad.addColorStop(0, "#21524a");
  grad.addColorStop(1, green);
  c.fillStyle = grad;
  c.fillRect(0, 0, w, h);
  c.strokeStyle = "#c4c599";
  c.lineWidth = 3;
  c.strokeRect(11, 11, w - 22, h - 22);
  for (const x of [22, w - 22])
    for (const y of [23, h - 23]) {
      disc(c, x, y, 6, "#76877a");
      disc(c, x - 1, y - 2, 3, "#d8dac0");
      line(c, x - 2, y + 2, x + 2, y - 2, "#394842");
    }
}
function cube(c, x, y, r) {
  const poly = (points, colour) => {
    c.fillStyle = colour;
    c.beginPath();
    points.forEach(([a, b], i) => (i ? c.lineTo(x + a * r, y + b * r) : c.moveTo(x + a * r, y + b * r)));
    c.closePath();
    c.fill();
  };
  poly(
    [
      [0, -1],
      [1, -0.47],
      [0, 0.07],
      [-1, -0.47],
    ],
    "#ffda85",
  );
  poly(
    [
      [-1, -0.47],
      [0, 0.07],
      [0, 1.15],
      [-1, 0.62],
    ],
    "#e4973f",
  );
  poly(
    [
      [0, 0.07],
      [1, -0.47],
      [1, 0.62],
      [0, 1.15],
    ],
    "#faaf4c",
  );
}
function symbol(c, id, x, y, r, ink, state) {
  c.save();
  c.translate(x, y);
  c.scale(r, r);
  c.fillStyle = ink;
  c.strokeStyle = ink;
  c.lineWidth = 0.14;
  c.lineCap = "round";
  if (id === "pause") {
    if (state.paused) {
      c.beginPath();
      c.moveTo(-0.55, -0.83);
      c.lineTo(0.75, 0);
      c.lineTo(-0.55, 0.83);
      c.closePath();
      c.fill();
    } else {
      c.fillRect(-0.62, -0.72, 0.43, 1.44);
      c.fillRect(0.18, -0.72, 0.43, 1.44);
    }
  } else if (id === "time") {
    if (state.night) {
      disc(c, 0, 0, 0.46, ink);
      for (let i = 0; i < 8; i++) {
        c.rotate(Math.PI / 4);
        line(c, 0, -0.7, 0, -0.95, ink, 0.13);
      }
    } else {
      c.beginPath();
      c.arc(0, 0, 0.83, -1.24, 1.0, true);
      c.bezierCurveTo(-0.43, 0.63, -0.54, -0.44, 0.27, -0.79);
      c.fill();
    }
  } else if (id === "video-stop") {
    c.fillRect(-0.62, -0.62, 1.24, 1.24);
  } else if (id === "sound" || id === "video-mute") {
    // A loudspeaker. Waves offer sound; a slash offers silence.
    c.beginPath();
    c.moveTo(-0.95, -0.32);
    c.lineTo(-0.5, -0.32);
    c.lineTo(-0.02, -0.8);
    c.lineTo(-0.02, 0.8);
    c.lineTo(-0.5, 0.32);
    c.lineTo(-0.95, 0.32);
    c.closePath();
    c.fill();
    if (id === "sound" ? state.sound : !state.muted) {
      line(c, 0.25, -0.5, 0.95, 0.5, ink, 0.15);
      line(c, 0.25, 0.5, 0.95, -0.5, ink, 0.15);
    } else
      for (const r of [0.42, 0.78]) {
        c.beginPath();
        c.arc(0.02, 0, r, -0.85, 0.85);
        c.stroke();
      }
  } else if (id === "postcard") {
    // A picture postcard: the card, a stamp in its corner and a skyline across it.
    c.lineWidth = 0.13;
    c.lineJoin = "round";
    c.strokeRect(-0.95, -0.66, 1.9, 1.32);
    c.fillRect(0.36, -0.48, 0.42, 0.46);
    c.beginPath();
    c.moveTo(-0.78, 0.48);
    c.lineTo(-0.78, 0.12);
    c.lineTo(-0.52, 0.12);
    c.lineTo(-0.52, -0.22);
    c.lineTo(-0.3, -0.4);
    c.lineTo(-0.3, 0.2);
    c.lineTo(-0.06, 0.2);
    c.lineTo(-0.06, 0.04);
    c.lineTo(0.2, 0.04);
    c.lineTo(0.2, 0.48);
    c.closePath();
    c.fill();
    line(c, 0.36, 0.2, 0.78, 0.2, ink, 0.1);
    line(c, 0.36, 0.38, 0.78, 0.38, ink, 0.1);
  } else if (id === "view") {
    for (let i = 0; i < 3; i++) {
      const yy = (i - 1) * 0.58,
        knob = i === 1 ? 0.42 : -0.33;
      line(c, -0.85, yy, 0.85, yy, ink, 0.13);
      disc(c, knob, yy, 0.21, ink);
    }
  }
  c.restore();
}
function plate(c, state, row, w, h, text, icon = false) {
  const [id, u, v, uw, vh] = row;
  const x = u * w,
    y = v * h,
    ww = uw * w,
    hh = vh * h;
  const active = [state.hover, state.focus, state.pressed].includes(id);
  // The way out of the Matrix is lettered like a terminal: phosphor green on the dark plate.
  const ink = active ? dark : id === "matrix-exit" ? phosphor : cream;
  c.fillStyle = active ? (state.pressed === id ? "#ddaa54" : "#eec17e") : dark;
  c.fillRect(x + 2, y + 3, ww - 4, hh - 6);
  if (state.focus === id) {
    c.strokeStyle = dark;
    c.lineWidth = 3;
    c.strokeRect(x + 8, y + 9, ww - 16, hh - 18);
  }
  if (id === "sound" || id === "postcard") {
    const nudge = id === "sound" ? hh * 0.04 : 0;
    symbol(c, id, x + ww / 2 - nudge, y + hh * 0.5, Math.min(hh * 0.2, ww * 0.2), ink, state);
  } else if (icon) {
    const size = Math.min(57, ww * 0.174);
    c.font = "650 " + size + "px \"IBM Plex Sans\", sans-serif";
    const start = x + (ww - Math.min(c.measureText(text).width, ww * 0.68) - size * 0.99) / 2;
    symbol(c, id, start + size * 0.32, y + hh * 0.5, size * 0.33, ink, state);
    label(c, text, start + size * 0.96, y + hh * 0.53, size, { colour: ink, max: ww * 0.68 });
  } else {
    label(c, text, x + ww / 2, y + hh * 0.53, Math.min(57, ww * 0.13), {
      align: "center",
      colour: ink,
      max: ww * 0.91,
    });
  }
}
export function paintBoards(atlas, state) {
  const ctx = atlas.getContext("2d");
  function paint(key, height, paintFace) {
    const [x, y, w, h] = areas[key];
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(w / 1024, h / height);
    ctx.beginPath();
    ctx.rect(0, 0, 1024, height);
    ctx.clip();
    paintFace(ctx, 1024, height);
    ctx.restore();
  }
  paint("voxel", 300, (c, w, h) => {
    const active = [state.hover, state.focus].includes("voxel");
    c.fillStyle = active ? "#205678" : "#173a58";
    c.fillRect(0, 0, w, h);
    c.strokeStyle = active ? "#ffe399" : "#a5c8c4";
    c.lineWidth = 5;
    c.strokeRect(14, 14, w - 28, h - 28);
    cube(c, 138, 142, 81);
    line(c, 253, 37, 253, 263, "#6c9b9e", 3);
    label(c, "VOXEL", 291, 91, 135, { weight: 850, max: 680 });
    label(c, "MORPHISM", 291, 215, 124, { weight: 850, max: 680 });
  });
  paint("station", (1024 * state.cabinet.body.h) / state.cabinet.body.w, (c, w, h) => {
    enamel(c, w, h);
    // The billboard's header names what is playing.
    label(c, state.playing ? "NOW PLAYING  ·  " + state.playing.toUpperCase() : "INA COOLBRITH PARK  ·  SAN FRANCISCO", w / 2, 61, 38, {
      align: "center",
      colour: brass,
      weight: 700,
      max: w - 92,
    });
    label(c, state.title, w / 2, 150, 101, {
      align: "center",
      font: '"Source Serif 4", Georgia, serif',
      weight: 560,
      max: w - 112,
    });
    const labels = {
      time: state.night ? "Day" : "Night",
      pause: state.paused ? "Play" : "Pause",
      sound: state.sound ? "Mute" : "Sound",
      view: state.open ? "Close" : "View",
      "local-blog": state.broken ? "LOG" : "Blog",
      "local-voxel": "Voxelmorphism",
      "about-still": "About",
      "support-still": "Support",
      "plain-still": "Plain page",
      car: "Cable car",
      "matrix-exit": "Exit the Matrix",
      "video-mute": state.muted ? "Unmute" : "Mute",
      "video-stop": "Stop",
    };
    for (const row of state.stationRows)
      plate(c, state, row, w, h, labels[row[0]], ["view", "time", "pause", "sound", "video-mute", "video-stop"].includes(row[0]));
  });
  if (!state.open) return;
  paint("settings", (1024 * state.cabinet.menu.h) / state.cabinet.menu.w, (c, w, h) => {
    enamel(c, w, h);
    label(c, "View settings", 51, 68, 68, { font: '"Source Serif 4", Georgia, serif' });
    const names = {
      preset: "Quality",
      scale: "Resolution",
      dynamic: "Dynamic resolution",
      target: "Frame target",
    };
    const options = state.settings ?? {};
    const quality = options.preset || "";
    const values = {
      preset: quality.charAt(0).toUpperCase() + quality.slice(1) + "  ▾",
      scale: Math.round(options.scale * 100) + "%",
      dynamic: options.dynamic ? "On" : "Off",
      target: options.target + " fps  ▾",
    };
    for (const row of state.menuRows) {
      const [id, u, v, uw, vh] = row;
      const x = u * w,
        y = v * h,
        ww = uw * w,
        hh = vh * h;
      if (!(id in names)) {
        plate(
          c,
          state,
          row,
          w,
          h,
          { about: "About this view", support: "Support", plain: "Plain page", car: "Cable car" }[id],
        );
        continue;
      }
      const active = [state.focus, state.hover].includes(id);
      c.fillStyle = active ? "#345f51" : dark;
      c.fillRect(x, y + 2, ww, hh - 4);
      label(c, names[id], x + 22, y + hh * 0.53, 51, { max: ww * 0.6 });
      label(c, values[id], x + ww - 22, y + hh * 0.53, 48, { align: "right", colour: brass });
      if (id === "scale") {
        const x0 = x + ww * 0.43,
          x1 = x + ww * 0.77,
          yy = y + hh * 0.51;
        line(c, x0, yy, x1, yy, "#8da49a", 6);
        disc(c, x0 + ((x1 - x0) * (options.scale - 0.3)) / 0.7, yy, 13, brass);
      }
      if (active) {
        c.strokeStyle = brass;
        c.lineWidth = 4;
        c.strokeRect(x + 3, y + 5, ww - 6, hh - 10);
      }
    }
  });
}
