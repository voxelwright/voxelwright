import { adopt, ready, getStage, live } from '../src/index.js';
import { cases, lamps } from '../src/looks/instrument.js';
import { recall, change } from './build-settings.js';
import { connectSound } from './switch-sound.js';

const $ = selector => document.querySelector(selector);
let build = recall();
const hardware = $('.hardware');
const gain = $('#gain'), contour = $('#contour'), screen = $('#scope');
const keys = [...document.querySelectorAll('[data-lamp]')];
let scan = 1, sweepFrame = 0;
const phosphor = document.createElement('canvas');
phosphor.width = screen.width;
phosphor.height = screen.height;
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');

function drawScope(rescan = false) {
  cancelAnimationFrame(sweepFrame);
  const sweep = rescan === true && !reduceMotion.matches;
  const ctx = (sweep ? phosphor : screen).getContext('2d');
  if (!ctx) return;
  const { width: w, height: h } = screen;
  const color = lamps[build.lamp].hue;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = color;
  ctx.globalAlpha = .16;
  for (let x = 4; x < w; x += 14) for (let y = 5; y < h; y += 14) ctx.fillRect(x,y,2,2);
  // An etched wire terrain. The fader changes its spatial frequency, and the
  // switches select a cut through it. The scope rests when the controls do.
  const cut = Object.keys(lamps).indexOf(build.lamp) * .8 + (scan - 1) * .52;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.7;
  for (let row = 0; row < 16; row++) {
    ctx.globalAlpha = (.32 + .68 * build.level / 10) * (.45 + row / 28);
    ctx.beginPath();
    for (let x = 0; x <= w; x += 3) {
      const u = x / w, t = (row - 7) / 15;
      const hill = Math.exp(-((u-.53+t*.28)**2)*11 - t*t*2.2);
      const ridge = .52 + .25*Math.sin(u * (8 + Number(contour.value)) + cut + t * 4.3) + .16*Math.cos(u*29-t*3);
      const y = 31 + row * 5.4 - 80 * hill * ridge;
      if (!x) ctx.moveTo(x,y); else ctx.lineTo(x,y);
    }
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  $('#contour-out').value = contour.value.padStart(2,'0');
  if (!sweep) return;
  const display = screen.getContext('2d');
  const start = performance.now();
  // Replace the previous trace a strip at a time. A second scan starts from
  // the phosphor already visible, and touching the fader takes over at once.
  let left = 0;
  function expose(now) {
    const edge = Math.round(w * Math.min(1, (now - start) / 210));
    if (edge > left) {
      display.clearRect(left, 0, edge - left, h);
      display.drawImage(phosphor, left, 0, edge - left, h, left, 0, edge - left, h);
      left = edge;
    }
    if (left < w) sweepFrame = requestAnimationFrame(expose);
  }
  sweepFrame = requestAnimationFrame(expose);
}
function sync() {
  $('#caps').value = build.caps;
  for (const input of document.querySelectorAll('[name="shell"],[name="profile"],[name="rail"]')) input.checked = build[input.name] === input.value;
  gain.value = build.level;
  hardware.toggleAttribute('data-unlit', build.level === 0);
  $('#gain-out').value = String(build.level).padStart(2, '0');
  $('#shell-name').value = cases[build.shell].name;
  $('#display-lamp').textContent = lamps[build.lamp].name.toUpperCase();
  for (const key of keys) {
    const pressed = String(key.dataset.lamp === build.lamp);
    if (key.getAttribute('aria-pressed') !== pressed) key.setAttribute('aria-pressed', pressed);
  }
  drawScope();
}
function apply(fields) {
  build = change(fields);
  sync();
}
for (const input of document.querySelectorAll('[name="shell"],[name="profile"],[name="rail"]')) {
  input.addEventListener('change', () => apply({ [input.name]: input.value }));
}
$('#caps').addEventListener('change', e => apply({ caps: e.target.value }));
for (const key of keys) key.addEventListener('click', () => apply({ lamp: key.dataset.lamp }));
gain.addEventListener('input', () => apply({ level: gain.valueAsNumber }));
contour.addEventListener('input', () => drawScope());
reduceMotion.addEventListener('change', () => drawScope());
$('#scan').addEventListener('click', () => {
  scan++;
  $('#sweep').value = 'FIELD SCOPE / ' + String(scan).padStart(2,'0');
  drawScope(true);
});
addEventListener('pageshow', event => {
  if (event.persisted) { build = recall(); sync(); }
});
// Pause the optional light cycle when the enclosure leaves the workbench viewport.
if ('IntersectionObserver' in window) {
  new IntersectionObserver(([entry]) => {
    hardware.toggleAttribute('data-out-of-view', !entry.isIntersecting);
  }).observe(hardware);
}
connectSound($('#sound'));
sync();
adopt();
window.vx = { live, get stage() { return getStage(); } };
await ready();
document.documentElement.dataset.ready = '1';
