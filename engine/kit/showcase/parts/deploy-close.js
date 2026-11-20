// A low thumb plate. The stem bottoms on the bed after one course of travel.
import { defineLook, hole, live } from '../../src/index.js';

const thumbPlate = {
  build(key, model) {
    const { W, H } = key;
    if (W < 8 || H < 8) return; // the details are hidden
    hole(key, model, { x: -1, y: 1, w: W + 2, h: H - 2, depth: 5, wall: 'gasket', floor: 'slate' });
    // The steel collar caps the liner. One clear cell surrounds the plate.
    const socket = model.part('socket');
    socket.slab(-2, 0, 0, W + 4, H, 1, 'steel', 1).carve(-1, 1, 0, W + 2, H - 2, 1);
    const cx = Math.floor(W / 2), cy = Math.floor(H / 2);
    const cap = model.part('cap');
    cap.grounded = false;
    cap.slab(0, 2, 0, W, H - 4, 1, 'lamp-cap', 1);
    cap.slab(1, 2, 1, W - 2, H - 5, 1, 'lamp-cap', 1);
    cap.box(cx - 1, cy, -3, 3, 1, 3, 'steel');
    // A flush locator window in the collar has a dark fitting at zero power.
    // The liner masks it below the lip. Only the adjacent opal edge transmits it.
    socket.box(cx - 1, 0, 0, 2, 1, 1, 'backlight');
    if (key.look.materials['lamp-cap']?.transmission) cap.box(cx - 1, 2, 1, 2, 1, 1, 'key');
    key.faceZ = key.state.top = 2;
    key.state.off = key.el.matches(':disabled, [aria-disabled="true"]');
    key.glowRadius = 1;
    key.glowStrength = .012;
    model.keyTravel = 2;
    key.label(key.el.querySelector('.vx-label'), () => 2 + cap.tz);
  },

  pose(key) {
    const cap = key.model.byName.cap;
    if (!cap) return;
    const press = key.spring('press');
    const hover = press.target < 0 ? 0 : key.spring('hover').x;
    cap.tz = Math.max(-key.model.keyTravel, press.x + hover);
  },
};

// Use the selected instrument's cap, collar finish and dimmer on this button.
export function fitClose(el) {
  defineLook('deploy-close', { from: 'instrument', parts: { button: thumbPlate } });
  el.style.setProperty('--vx-look', 'deploy-close');
  live(el)?.retint();
}
