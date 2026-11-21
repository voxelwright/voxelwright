import { adopt, fitInstrument, ready } from '../src/index.js';
import { caps, cases } from '../src/looks/instrument.js';
import { recall } from './build-settings.js';
import { connectSound } from './switch-sound.js';

const capPicker = document.querySelector('#caps');
const casePicker = document.querySelector('#shell');
const dimmer = document.querySelector('#dimmer');
const levelOut = document.querySelector('#level-out');
const profiles = [...document.querySelectorAll('[name=profile]')];
const key = document.querySelector('button[data-lamp="tide"]');
for (const [value, cap] of Object.entries(caps)) capPicker.add(new Option(cap.name, value));
for (const [value, shell] of Object.entries(cases)) casePicker.add(new Option(shell.name, value));

// Start with the owner's current desk build. The tester can then be tried
// independently without replacing the lamp or keycaps chosen on the desk.
let build = recall();
function fit(fields) {
  build = { ...build, ...fields };
  const on = key.getAttribute('aria-pressed') === 'true';
  fitInstrument({ ...build, lamp: 'tide', level: on ? build.level : 0 });
  dimmer.value = build.level;
  levelOut.value = `${build.level * 10}%`;
  capPicker.value = build.caps;
  casePicker.value = build.shell;
  for (const radio of profiles) radio.checked = radio.value === build.profile;
}
fit();
dimmer.addEventListener('input', () => fit({ level: dimmer.valueAsNumber }));
capPicker.addEventListener('change', () => fit({ caps: capPicker.value }));
casePicker.addEventListener('change', () => fit({ shell: casePicker.value }));
for (const radio of profiles) radio.addEventListener('change', () => fit({ profile: radio.value }));
key.addEventListener('click', () => {
  if (key.matches(':disabled, [aria-disabled="true"]')) return;
  key.setAttribute('aria-pressed', String(key.getAttribute('aria-pressed') !== 'true'));
  fit();
});
connectSound(document.querySelector('#sound'));
adopt();
await ready();
document.documentElement.dataset.ready = '1';
