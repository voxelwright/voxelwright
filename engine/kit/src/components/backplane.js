// The cover laps the inner edge of a gasket. Its seat follows the actual
// cover, including the different enclosure margins on a narrow desk.
function buildCasting(live, model) {
  const { el, vx, cssW, cssH, W, H } = live;
  const cover = el.parentElement.querySelector('.faceplate');
  const left = cover.offsetLeft - el.offsetLeft - (cssW - W * vx) / 2;
  const top = cover.offsetTop - el.offsetTop - (cssH - H * vx) / 2;
  const x0 = Math.round(left / vx) - 1, y0 = Math.round(top / vx) - 1;
  const x1 = Math.round((left + cover.offsetWidth) / vx);
  const y1 = Math.round((top + cover.offsetHeight) / vx);
  const bed = model.part('casting');

  // A two-course upstand and a lower, wider rubber ledge. Stepping the
  // diagonal joint through the corners keeps the seat continuous there.
  for (let y = y0; y <= y1; y++) {
    const dy = Math.min(y - y0, y1 - y);
    for (let x = x0; x <= x1; x++) {
      const dx = Math.min(x - x0, x1 - x);
      const edge = Math.min(dx, dy, Math.floor((dx + dy - 3) / 1.5));
      if (edge === 0) bed.box(x, y, 0, 1, 1, 2, 'slate');
      if (edge === 1 || edge === 2) bed.plot(x, y, 0, 'gasket');
    }
  }
  live.faceZ = 2;
}

// Board underneath a removable front plate. Polished rails, solder pads and
// the four LED packages stay fixed when a different diffuser is installed.
export const backplane = {
  name: 'backplane', selector: '.vx-backplane', pad: 4,
  build(live, m) {
    const { W, H } = live;
    if (W < 20 || H < 12) return;
    if (live.el.hasAttribute('data-vx-casting')) buildCasting(live, m);
    if (!live.look.materials.chalk?.transmission) return;
    const traces = m.part('traces'), solder = m.part('solder');
    const packages = m.part('packages'), lamps = m.part('emitters');
    if (m.byName.casting) {
      // The PCB clears the underside of the ledge even at the LED packages.
      // Offset by half the distance from PCB to lip to retain its registration.
      live.well = [0, 0, W, H];
      for (const part of [traces, solder, packages, lamps]) {
        part.tz = -4;
        part.tx = part.ty = (live.faceZ - part.tz) / 2;
        part.sunk = true;
      }
    }
    const bus = Math.floor(H * .57);
    for (let channel = 0; channel < 4; channel++) {
      const x = Math.floor((channel + .5) * W / 4);
      const y = bus + channel * 2;
      // Each switch takes a separate track to the header. Its copper pad,
      // package and diffuser are on successive courses.
      traces.box(x, y, 0, W - 3 - x, 1, 1, 'warm-metal');
      traces.box(x, y, 0, 1, H - 4 - y, 1, 'warm-metal');
      for (const end of [y, H - 5]) {
        solder.slab(x - 1, end - 1, 1, 3, 3, 1, 'steel', 1);
        packages.box(x - 1, end, 2, 3, 1, 1, 'gasket');
      }
      lamps.box(x - 1, H - 5, 3, 2, 1, 1, live.look.tooling ? 'backlight' : 'light');
    }
    // Mounted components visible through the left and right window in the lid.
    for (const x of [3, W - 8]) {
      for (let y = 6; y < bus; y += 5) {
        solder.box(x, y, 0, 4, 2, 1, 'steel');
        packages.box(x + 1, y, 1, 2, 2, 1, 'gasket');
      }
    }
  },
};
