// A prototype of the landing: a personal site's links as signs of different kinds on the
// buildings of the city. The signs are the kit's own lettering part; this page gives them two
// materials of a sign's kind and says what a press would open.
import { adopt, ready, getStage, live, refresh, defineMaterial } from '/packages/voxelmorphism/src/index.js';

const root = document.documentElement;

// Cut-out letters: painted steel in the bridge's orange by day, lit from themselves at night.
defineMaterial('tube', { day: '#d4421c', night: '#ffb38a', jitter: 0.012, glow: 1 });
defineMaterial('tube-hot', { day: '#ff6a2b', night: '#fff0dc', jitter: 0.012, glow: 1 });
// A digital board: a dark matte face, and cubes that are lit by day as well as by night.
defineMaterial('screen', { day: '#15171d', night: '#0b0c11', jitter: 0.01 });
defineMaterial('pixel', { day: '#ffcf4a', night: '#ffd75e', jitter: 0.03, glow: 1 });
defineMaterial('pixel-hot', { day: '#fff1b0', night: '#fff6d6', jitter: 0.03, glow: 1 });

const q = new URLSearchParams(location.search);
const setTheme = (v) => { root.dataset.theme = v; };
setTheme(q.get('theme') || 'light');
for (const input of document.querySelectorAll('.hours input')) {
  input.checked = input.value === root.dataset.theme;
  input.addEventListener('change', () => setTheme(input.value));
}

const said = document.getElementById('said');
for (const a of document.querySelectorAll('.signs a')) {
  // aimed: the sign answers before it is pressed
  const cool = a.dataset.vxInk, hot = cool + '-hot';
  const aim = (on) => { a.dataset.vxInk = on ? hot : cool; refresh(a); };
  a.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') aim(true); });
  a.addEventListener('pointerleave', () => aim(false));
  a.addEventListener('focus', () => aim(true));
  a.addEventListener('blur', () => aim(false));
  // pressed: the kit breaks the letters; here the page only says what would open
  a.addEventListener('click', (e) => { e.preventDefault(); said.textContent = `${a.textContent.trim()} was pressed: it breaks, then the page opens ${a.dataset.opens}.`; });
}

adopt();
window.vx = { live, get stage() { return getStage(); } };
ready().then(() => { root.dataset.ready = '1'; });
