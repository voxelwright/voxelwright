// Authored fixtures in metres. Each origin is a footing in the city survey.
// Local X runs along the face, Y is up and positive Z points out of the sign.
import { cellsPerMetre, surveyPoint, project, surveyCamera, cropCamera, framing, lean } from "./survey.js";
import { paintBoards, atlasSize } from "./sign-paint.js";

function mount(e, n, h, angle) {
  const base = surveyPoint(e, n, h);
  const a = (angle * Math.PI) / 180,
    c = Math.cos(a),
    s = Math.sin(a);
  return (x, y, z = 0) => [
    base[0] + cellsPerMetre * (c * x - s * z),
    base[1] + cellsPerMetre * y,
    base[2] + cellsPerMetre * (s * x + c * z),
  ];
}
// The west roofline on DataSF building 3174 and the flat roof on 1374.
const blogRoof = mount(552006.66, 4183455.89, 64.6, 80.53);
const voxelRoof = mount(551798.7, 4183480.5, 59.0, 170.53);
const park = mount(551658.15, 4183592.61, 80.15, 107);
const width = 2.12,
  sill = 4.52,
  lower = 0.79,
  extra = 0.32,
  lid = 2.12;
const bottom = sill - 0.025;
const metal = "#344642",
  zinc = "#8a9990",
  ivory = "#eee0ad";

const shapes = {
  B: ["11110", "11011", "11011", "11110", "11011", "11011", "11110"],
  L: ["11000", "11000", "11000", "11000", "11000", "11000", "11111"],
  O: ["01110", "11011", "11011", "11011", "11011", "11011", "01110"],
  G: ["01111", "11000", "11000", "11011", "11011", "11011", "01111"],
};

function builder() {
  const faces = [],
    hits = [],
    lamps = [];
  let at,
    fixture = 0;
  const face = (points, colour, emit = 0, area = null) =>
    faces.push({ points: points.map((p) => at(...p)), colour, emit, area, fixture });
  function solid(outline, z, depth, colour, front = colour, emit = 0) {
    const frontEdge = outline.map(([x, y]) => [x, y, z]);
    const backEdge = outline.map(([x, y]) => [x, y, z - depth]);
    face(frontEdge, front, emit);
    face([...backEdge].reverse(), colour);
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      face([frontEdge[j], frontEdge[i], backEdge[i], backEdge[j]], colour);
    }
  }
  // Clockwise as seen from the overlook, starting at the top left.
  const rect = (x, y, w, h) => [
    [x, y + h],
    [x + w, y + h],
    [x + w, y],
    [x, y],
  ];
  const box = (x, y, z, w, h, d, colour, front, emit) => solid(rect(x, y, w, h), z, d, colour, front, emit);
  function strut(x0, y0, x1, y1, z, thick, depth, colour) {
    const k = thick / (2 * Math.hypot(x1 - x0, y1 - y0));
    const dx = -(y1 - y0) * k,
      dy = (x1 - x0) * k;
    solid(
      [
        [x0 + dx, y0 + dy],
        [x1 + dx, y1 + dy],
        [x1 - dx, y1 - dy],
        [x0 - dx, y0 - dy],
      ],
      z,
      depth,
      colour,
    );
  }
  function trestle(w, h, thick, depth) {
    for (const sign of [-1, 1]) {
      const x = (sign * w) / 2;
      box(x - thick, -0.08, -0.2, thick * 2, h + 0.08, depth, metal);
      box(x - thick * 1.75, -0.08, 0, thick * 3.5, 0.17, depth + 0.45, zinc);
    }
    strut(-w / 2, 0, w / 2, h, -0.24, thick, depth / 3, zinc);
    strut(-w / 2, h, w / 2, 0, -0.31, thick, depth / 3, zinc);
  }
  // A hit rectangle uses the very same surface coordinates as its painted plate.
  function hit(id, x, y, w, h, z) {
    hits.push({ id, points: rect(x, y, w, h).map(([sx, sy]) => at(sx, sy, z)) });
  }
  function panel(area, x, y, z, w, h, controls) {
    face(
      rect(x, y, w, h).map(([sx, sy]) => [sx, sy, z]),
      "#ffffff",
      0,
      area,
    );
    if (area !== "voxel") hit(area + "-face", x, y, w, h, z);
    for (const [id, u, v, du, dv] of controls) hit(id, x + u * w, y + (1 - v - dv) * h, du * w, dv * h, z);
  }
  return {
    faces,
    hits,
    lamps,
    lamp(x, y, z, radius, gain) {
      lamps.push({ at: at(x, y, z), radius: radius * cellsPerMetre, gain });
    },
    mount(fn) {
      at = fn;
      fixture++;
    },
    box,
    strut,
    trestle,
    hit,
    panel,
  };
}

function blogSign(m, state) {
  m.mount(blogRoof);
  const cell = 1.6,
    span = 23 * cell;
  const baseline = 5.9; // Clear the raised section of the roof in front of the marquee.
  const lit = [state.focus, state.hover].includes("blog");
  m.trestle(span * 0.68, baseline, 0.25, 0.95);
  m.box(-span / 2 - 0.7, baseline - 0.48, 1.5, span + 2.1, 0.48, 2.9, metal, zinc);
  m.box(-span / 2, baseline + 1.3, -0.34, span, 0.32, 0.55, metal);
  for (const [i, letter] of [..."BLOG"].entries()) {
    if (i === 0 && state.broken) continue;
    const start = -span / 2 + i * 6 * cell;
    shapes[letter].forEach((row, line) => {
      const y = baseline + (6 - line) * cell;
      for (const run of row.matchAll(/1+/g)) {
        const x = start + (run.index + (6 - line) * 0.096) * cell,
          w = run[0].length * cell;
        m.box(x, y, 1.0, w, cell, 1.25, "#8b2920", lit ? "#ff793f" : "#eb4431", lit ? 0.97 : 0.72);
        for (let col = 0; col < run[0].length; col++) {
          const lamp = lit ? 0.32 : 0.24;
          const bulbX = x + (col + 0.5) * cell,
            bulbY = y + cell * 0.5;
          m.box(bulbX - lamp / 2, bulbY - lamp / 2, 1.08, lamp, lamp, 0.09, "#b87543", "#ffdf9a", 1);
          m.lamp(bulbX, bulbY, 1.13, lit ? 1.12 : 0.86, lit ? 1 : 0.65);
        }
      }
    });
  }
  m.hit("blog", -span / 2, baseline - 0.45, span + 1, 12, 1.1);
}

function voxelSign(m, state) {
  m.mount(voxelRoof);
  const w = 23.4,
    h = 6.9,
    y = 2.85;
  m.trestle(16.5, y + 0.55, 0.19, 0.65);
  m.box(-w / 2 - 0.18, y - 0.22, 0, w + 0.36, h + 0.44, 1.12, "#152f45", "#e0bb72");
  m.box(-w / 2, y, 0.15, w, h, 0.2, "#174965");
  m.panel("voxel", -w / 2, y, 0.17, w, h, [["voxel", 0, 0, 1, 1]]);
  // Enamel floodlights and the service ledge stand proud of the face.
  m.box(-w / 2 - 0.45, y - 0.34, 0.88, w + 0.9, 0.17, 1.9, metal, zinc);
  for (const x of [-w * 0.29, w * 0.29]) {
    m.box(x - 0.075, y + h + 0.15, 0.1, 0.15, 0.45, 1.0, zinc);
    m.box(x - 0.47, y + h + 0.48, 0.8, 0.94, 0.24, 0.64, metal, ivory, 0.6);
    m.lamp(x, y + h + 0.6, 0.88, 1.05, 0.75);
  }
}

// Two hinges let the display open alongside the directory in a short window.
function cabinet(compact, open, wing) {
  const body = { x: -width / 2, y: sill, w: width, h: lower + (compact ? extra : 0) };
  const menu = !open
    ? null
    : {
        w: width,
        x: wing ? width / 2 + 0.085 : body.x,
        y: wing ? sill : sill + body.h + 0.062,
        h: lid,
      };
  return { body, menu };
}
function station(m, state) {
  m.mount(park);
  const { body, menu } = state.cabinet;
  const h = body.h;
  for (const x of [-width * 0.36, width * 0.36]) {
    m.box(x - 0.045, 0, -0.045, 0.09, sill + 0.12, 0.13, metal, zinc);
    m.box(x - 0.064, sill - 0.36, -0.025, 0.128, 0.16, 0.17, "#657169");
  }
  m.strut(-width * 0.36, sill - 0.58, -width * 0.36 + 0.42, sill, -0.07, 0.036, 0.05, zinc);
  m.strut(width * 0.36, sill - 0.58, width * 0.36 - 0.42, sill, -0.07, 0.036, 0.05, zinc);
  m.box(-width / 2 - 0.025, bottom, 0, width + 0.05, h + 0.05, 0.12, metal, "#c1b885");
  m.panel("station", -width / 2, sill, 0.012, width, h, state.stationRows);
  if (menu) {
    const { x, y, h } = menu;
    m.box(x - 0.025, y - 0.023, -0.02, width + 0.05, h + 0.046, 0.12, metal, "#bcb383");
    m.panel("settings", x, y, -0.005, width, h, state.menuRows);
    for (const k of [0.16, 0.84]) {
      if (state.wing) m.box(width / 2 - 0.05, sill + k * body.h, 0.035, 0.18, 0.075, 0.05, zinc);
      else m.box(x + width * k - 0.1, y - 0.09, 0.035, 0.2, 0.085, 0.05, zinc);
    }
  }
  // Folded steel rain caps with a warm strip under each overhang.
  for (const panel of [body, menu].filter(Boolean)) {
    const top = panel.y + panel.h;
    m.box(panel.x - 0.054, top + 0.021, 0.065, width + 0.108, 0.034, 0.24, metal, zinc);
    m.box(panel.x + width * 0.04, top + 0.016, 0.071, width * 0.92, 0.012, 0.035, metal, ivory, 0.62);
  }
}

function bounds(points, camera, w, h) {
  const p = points.map((point) => project(point, camera, w, h));
  return {
    left: Math.min(...p.map((p) => p[0])),
    top: Math.min(...p.map((p) => p[1])),
    right: Math.max(...p.map((p) => p[0])),
    bottom: Math.max(...p.map((p) => p[1])),
  };
}

export function signScene(index, title) {
  const home = surveyCamera(index);
  const [sw, sh] = index.camera.size;
  const atlas = document.createElement("canvas");
  [atlas.width, atlas.height] = atlasSize;
  let revision = 0,
    faces = [],
    hits = [],
    lamps = [],
    crop;
  const state = {
    title,
    open: false,
    live: false,
    compact: false,
    hover: "",
    focus: "",
    pressed: "",
    broken: false,
    postcard: false,
    // During an egg on the window screen the directory is a digital billboard with its
    // own controls: "matrix" (the way out) or "video" (Pause, Mute, Stop). 'playing'
    // is the video's title for the header and 'muted' its sound.
    billboard: "",
    playing: "",
    muted: false,
  };
  let lastW = 0,
    lastH = 0,
    pending = true;
  function rebuild(w, h) {
    lastW = w;
    lastH = h;
    pending = false;
    state.compact = state.open || w / h < 1.32 || h < 500;
    state.wing = state.open && w / h >= 1.65;
    state.cabinet = cabinet(state.compact, state.open, state.wing);
    const boards = Object.values(state.cabinet).filter(Boolean);
    const corners = boards.flatMap(({ x, y, h }) =>
      [x - 0.06, x + width + 0.06].flatMap((xx) => [park(xx, y - 0.07), park(xx, y + h + 0.07)]),
    );
    crop = framing(index, w, h, bounds(corners, home, sw, sh), state.open);
    // Regions are fractions of the enamel face, shared by ink and native hit targets.
    // Sound and Postcard are narrow, icon-only plates so the worded plates keep their size.
    // At 0.65 of a worded plate they stay at least 44 px wide on a 390 px phone.
    const row = (ids, y, h) => {
      const weight = (id) => (id === "sound" || id === "postcard" ? 0.65 : 1);
      const total = ids.reduce((sum, id) => sum + weight(id), 0);
      let u = 0.025;
      return ids.map((id) => {
        const w = (0.95 * weight(id)) / total;
        u += w;
        return [id, u - w, y, w, h];
      });
    };
    const height = state.cabinet.body.h;
    state.stationRows = [
      ...(state.compact ? row(["local-blog", "local-voxel"], 0.44 / height, extra / height) : []),
      ...row(
        state.live && state.billboard === "matrix"
          ? ["matrix-exit"]
          : state.billboard === "video"
          ? // Without the live city (the still) the video is sound only, and has no Pause.
            [...(state.live ? ["pause"] : []), "video-mute", "video-stop"]
          : state.live
          ? ["time", "pause", "sound", "postcard", "view"]
          : [state.offline ? "car" : "about-still", "support-still", "plain-still", "postcard"],
        1 - 0.34 / height,
        0.32 / height,
      ),
    ];
    state.menuRows = [
      ...["preset", "scale", "dynamic", "target"].map((id, i) => [id, 0.035, 0.15 + i * 0.148, 0.93, 0.148]),
      ...row(["about", "support"], 0.75, 0.115),
      ...row(["plain"], 0.865, 0.12),
      ...(state.offline ? [["car", 0.55, 0.02, 0.42, 0.115]] : []),
    ];
    // A postcard is taken without the directory (fixture 3) and with no sign lit by a pointer
    // or focus. Its hits, cabinet and crop stay, so the camera and the native controls hold still.
    const look = state.postcard ? { ...state, hover: "", focus: "", pressed: "" } : state;
    const mesh = builder();
    blogSign(mesh, look);
    voxelSign(mesh, look);
    station(mesh, look);
    ({ faces, hits, lamps } = mesh);
    if (state.postcard) faces = faces.filter((face) => face.fixture !== 3);
    paintBoards(atlas, look);
    revision++;
  }
  return {
    atlas,
    get faces() {
      return faces;
    },
    get hits() {
      return hits;
    },
    get lamps() {
      return lamps;
    },
    get revision() {
      return revision;
    },
    update(change) {
      const keys = Object.keys(change);
      if (keys.length && keys.every((key) => state[key] === change[key])) return false;
      Object.assign(state, change);
      pending = true;
      return true;
    },
    size(w, h) {
      if (pending || w !== lastW || h !== lastH) rebuild(w, h);
    },
    camera(flight, side = 0, rise = 0) {
      const body = state.cabinet.body;
      const pivot = park(0, body.y + body.h / 2, 0);
      return cropCamera(lean(surveyCamera(index, flight), pivot, side, rise), index, crop);
    },
    get crop() {
      return crop;
    },
  };
}
