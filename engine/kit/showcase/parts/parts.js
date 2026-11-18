// What every part's page does: take the parts the page names, turn the page into voxels, and say
// when it is ready. A page calls show(part, part, ...) with the parts it is about.
import { adopt, define, ready, live, getStage, theme, MATERIALS } from '../../src/index.js';

import { connectSound } from '../switch-sound.js';

function connectPartFooter() {
  if (document.querySelector('.part-footer')) return;
  const footer = document.createElement('footer');
  footer.className = 'part-footer';
  const list = document.createElement('a');
  list.href = './';
  list.textContent = 'Parts catalog';
  const label = document.createElement('label');
  const input = document.createElement('input');
  input.type = 'checkbox';
  label.append(input, ' Switch sound');
  footer.append(list, label);
  document.body.append(footer);
  connectSound(input);
}

export function show(...parts) {
  for (const part of parts) define(part);
  if (!document.querySelector('#catalog-sound')) connectPartFooter();
  adopt();
  window.vx = { live, theme, MATERIALS, get stage() { return getStage(); } };
  return ready().then(() => { document.documentElement.dataset.ready = '1'; });
}
