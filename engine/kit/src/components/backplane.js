// Board underneath a removable front plate. Polished rails, solder pads and
// the four LED packages stay fixed when a different diffuser is installed.
export const backplane = {
  name: 'backplane', selector: '.vx-backplane', pad: 4,
  build(live, m) {
    const { W, H } = live;
    if (W < 20 || H < 12 || !live.look.materials.chalk?.transmission) return;
    const traces = m.part('traces'), solder = m.part('solder');
    const packages = m.part('packages'), lamps = m.part('emitters');
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
