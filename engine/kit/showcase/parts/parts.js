// What every part's page does: take the parts the page names, turn the page into voxels, and say
// when it is ready. A page calls show(part, part, ...) with the parts it is about.
import { adopt, define, ready, live, getStage, theme, MATERIALS } from '../../src/index.js';

import { recall } from '../build-settings.js';
import { connectSound } from '../switch-sound.js';

addEventListener('pageshow', event => { if (event.persisted) recall(); });

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
  const desk = document.createElement('a');
  desk.href = '../';
  desk.textContent = 'Configure instrument';
  footer.append(list, desk, label);
  const nav = document.createElement('nav');
  nav.className = 'part-nav';
  nav.setAttribute('aria-label', 'Instrument library');
  const home = desk.cloneNode(false);
  home.textContent = 'Village Instruments';
  const browse = list.cloneNode(false);
  browse.textContent = 'Browse parts';
  nav.append(home, browse);
  document.body.prepend(nav);
  document.body.append(footer);
  connectSound(input);
}

export function show(...parts) {
  recall();
  for (const part of parts) define(part);
  if (!document.querySelector('#catalog-sound')) connectPartFooter();
  adopt();
  window.vx = { live, theme, MATERIALS, get stage() { return getStage(); } };
  return ready().then(() => { document.documentElement.dataset.ready = '1'; });
}
