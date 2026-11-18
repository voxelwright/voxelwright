// What every part's page does: take the parts the page names, turn the page into voxels, and say
// when it is ready. A page calls show(part, part, ...) with the parts it is about.
import { adopt, define, ready, live, getStage, theme, MATERIALS } from '../../src/index.js';

export function show(...parts) {
  for (const part of parts) define(part);
  adopt();
  window.vx = { live, theme, MATERIALS, get stage() { return getStage(); } };
  return ready().then(() => { document.documentElement.dataset.ready = '1'; });
}
