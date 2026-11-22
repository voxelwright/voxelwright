// Village's Bay frame. Survey inputs are NAD83 / UTM zone 10N (EPSG:26910)
// and metres over NAVD88. The city pack stores east, up, south in 10 cm cells.
export const cellsPerMetre = 10;
export function surveyPoint(easting, northing, elevation) {
  return [
    (easting - 500000) * cellsPerMetre,
    (elevation - 1) * cellsPerMetre,
    (4250000 - northing) * cellsPerMetre,
  ];
}
const radians = (degrees) => (degrees * Math.PI) / 180;
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

export function surveyCamera(index, flight = 0) {
  const c = index.camera;
  const yaw = radians(c.look[0] - flight * 8),
    pitch = radians(c.look[1] - Math.abs(flight) * 2.2);
  const sy = Math.sin(yaw),
    cy = Math.cos(yaw),
    sp = Math.sin(pitch),
    cp = Math.cos(pitch);
  const level = [cy, 0, sy],
    plumb = [-sy * sp, cp, cy * sp];
  const forward = [sy * cp, sp, -cy * cp];
  const roll = radians(c.roll);
  return {
    eye: c.at.map(
      (v, i) =>
        v * cellsPerMetre + Math.abs(flight) * (forward[i] * 26 + (i === 1 ? 65 : 0)) + flight * level[i] * 12,
    ),
    right: level.map((v, i) => v * Math.cos(roll) + plumb[i] * Math.sin(roll)),
    up: plumb.map((v, i) => v * Math.cos(roll) - level[i] * Math.sin(roll)),
    forward,
    tanHalf: Math.tan(radians(c.fov) / 2),
  };
}

const sub = (a, b) => a.map((v, i) => v - b[i]);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (v) => {
  const l = Math.hypot(...v);
  return v.map((x) => x / l);
};

// Shift the eye by a head's lean, in metres along the level right axis and up,
// and turn the camera so the pivot stays on the very same view ray. The park
// directory holds still on screen while the city slides behind it. The rest
// pose is returned untouched, so the surveyed camera stays exact.
export function lean(camera, pivot, side, rise) {
  if (!side && !rise) return camera;
  const level = unit([camera.right[0], 0, camera.right[2]]);
  const eye = camera.eye.map((v, i) => v + cellsPerMetre * (level[i] * side + (i === 1 ? rise : 0)));
  const a = unit(sub(pivot, camera.eye)),
    b = unit(sub(pivot, eye));
  const axis = cross(a, b),
    s = Math.hypot(...axis),
    c = dot(a, b);
  if (s < 1e-12) return { ...camera, eye };
  const k = axis.map((v) => v / s);
  const turn = (v) => {
    const kv = cross(k, v),
      along = dot(k, v) * (1 - c);
    return v.map((x, i) => x * c + kv[i] * s + k[i] * along);
  };
  return { ...camera, eye, right: turn(camera.right), up: turn(camera.up), forward: turn(camera.forward) };
}

export function project(point, camera, width, height) {
  const rel = point.map((v, i) => v - camera.eye[i]);
  const depth = dot(rel, camera.forward);
  const focal = height / (2 * camera.tanHalf);
  return [
    width / 2 + (dot(rel, camera.right) * focal) / depth,
    height / 2 - (dot(rel, camera.up) * focal) / depth,
    depth,
  ];
}

// Crop the calibrated image at one uniform magnification. The shifted lens keeps
// the park directory in reach on tall screens and the surveyed rays on the poster.
export function framing(index, width, height, stationBounds, settingsOpen) {
  const [sw, sh] = index.camera.size;
  const { left: x0, right: x1, top: y0, bottom: y1 } = stationBounds;
  const boardWidth = x1 - x0,
    boardHeight = y1 - y0;
  const cover = Math.max(width / sw, height / sh);
  // On a short landscape screen the lower part of the survey frame still
  // contains both roofs. Move the crop in until the controls are readable.
  const scale = settingsOpen
    ? Math.min((width * 0.9) / boardWidth, (height * 0.88) / boardHeight)
    : Math.min((width * 0.92) / boardWidth, Math.max(cover, Math.min(295, width * 0.9) / boardWidth));
  const left = settingsOpen
    ? width / 2 - ((x0 + x1) * scale) / 2
    : clamp((width - sw * scale) / 2, width * 0.04 - x0 * scale, width * 0.96 - x1 * scale);
  const top = settingsOpen ? height / 2 - ((y0 + y1) * scale) / 2 : height - sh * scale;
  return { scale, left, top, width, height };
}

export function cropCamera(camera, index, crop) {
  const [w, h] = index.camera.size;
  const focal = (crop.scale * h) / (2 * camera.tanHalf);
  const dx = (crop.left + (crop.scale * w) / 2 - crop.width / 2) / focal;
  const dy = (crop.height / 2 - crop.top - (crop.scale * h) / 2) / focal;
  // Projection covectors implement a lens shift in the existing Village passes.
  // Sky rays use the inverse shift and the orthonormal camera axes.
  return {
    ...camera,
    tanHalf: crop.height / (2 * focal),
    right: camera.right.map((v, i) => v + dx * camera.forward[i]),
    up: camera.up.map((v, i) => v + dy * camera.forward[i]),
    skyRight: camera.right,
    skyUp: camera.up,
    skyForward: camera.forward.map((v, i) => v - dx * camera.right[i] - dy * camera.up[i]),
  };
}
