// Avatar. A picture or initials set in a small window cut into the surface.
// Tool: a window (a hole), lit from its rim by the room's warm light like any well at rest. It has
// no bezel: nothing moves in it, so its edge is the surface's own. Nothing
// stands up: an avatar is looked at, not pressed.
// Markup: <span class="vx-avatar"><img src="mina.jpg" alt="Mina Okafor"></span>
//         <span class="vx-avatar" role="img" aria-label="Ada Lindqvist"><span class="vx-avatar-initials" aria-hidden="true">AL</span></span>
//         <span class="vx-avatar"><img src="…" alt="Tomas Reyes"><span class="vx-avatar-initials" aria-hidden="true">TR</span></span>
// Behaviour: a picture that cannot be had is taken away (data-vx-empty on the well), the
// initials behind it show, and the well takes the picture's alt as its own name, so the person
// is still named once. It is the same with no voxels.

import { hole, halo, warmth, lightName, ring } from '../core/light.js';
import { listeners } from './util.js';

export const avatar = {
  name: 'avatar',
  selector: '.vx-avatar',
  pad: 7,
  glowRadius: 3.2,
  glowStrength: halo(0.05),

  build(live, m) {
    const mounted = live.el.dataset.vxMount === 'portrait';
    const D = Math.min(2, live.look.well) * (mounted ? 2 : 1);
    const { walls } = hole(live, m, { depth: D, wall: mounted ? 'gasket' : lightName(live.el, 'light-warm'), floor: 'floor' });
    if (mounted) {
      // A single stamped flange captures the print. The lower return catches
      // warm light inside the opening while the rubber lining stays dark.
      ring(m.part('retainer'), -1, -1, 0, live.W + 2, live.H + 2, 'steel', 1);
      walls.box(3, live.H, -D, live.W - 6, 1, 1, 'warm-metal');
    }
    // the CSS lays what is in the well on its floor, and must know how deep that is
    if (live.state.deep !== D) live.el.style.setProperty('--vx-avatar-deep', live.state.deep = D);
  },

  pose(live) { live.glowStrength = halo(0.05) * warmth(live); },

  bind(live) {
    const on = listeners();
    avatar.plain(live.el, on);
    return on.done;
  },

  plain(el, on) {
    const img = el.querySelector(':scope > img');
    if (!img) return;
    // data-vx-empty="named" says the name on the well is ours, to take back if the picture comes
    const gone = () => {
      const take = !!img.alt && !el.hasAttribute('aria-label');
      if (take) { el.setAttribute('role', 'img'); el.setAttribute('aria-label', img.alt); }
      if (take || el.dataset.vxEmpty !== 'named') el.setAttribute('data-vx-empty', take ? 'named' : '');
    };
    const here = () => {
      if (el.dataset.vxEmpty === 'named') { el.removeAttribute('role'); el.removeAttribute('aria-label'); }
      el.removeAttribute('data-vx-empty');
    };
    on(img, 'error', gone);
    on(img, 'load', here);
    // it may have failed before anyone was listening, or have nothing to load at all
    if (!img.getAttribute('src')) gone();
    else if (img.complete) img.decode().catch(() => { if (img.isConnected) gone(); });
  },
};
