import { adopt, fitInstrument, ready } from '../src/index.js';
import { caps, cases } from '../src/looks/instrument.js';
import { recall } from './build-settings.js';
import { connectSound } from './switch-sound.js';

const capPicker = document.querySelector('#caps');
const casePicker = document.querySelector('#shell');
const profiles = [...document.querySelectorAll('[name=profile]')];
const key = document.querySelector('button[data-lamp="tide"]');
for (const [value, cap] of Object.entries(caps)) capPicker.add(new Option(cap.name, value));
for (const [value, shell] of Object.entries(cases)) casePicker.add(new Option(shell.name, value));

// Start with the owner's current desk build. The tester can then be tried
// independently without replacing the lamp or keycaps chosen on the desk.
let build = recall();
function fit(fields) {
  build = fitInstrument({ ...build, ...fields, lamp: 'tide' });
  capPicker.value = build.caps;
  casePicker.value = build.shell;
  for (const radio of profiles) radio.checked = radio.value === build.profile;
}
fit();
capPicker.addEventListener('change', () => fit({ caps: capPicker.value }));
casePicker.addEventListener('change', () => fit({ shell: casePicker.value }));
for (const radio of profiles) radio.addEventListener('change', () => fit({ profile: radio.value }));
key.addEventListener('click', () => key.setAttribute('aria-pressed', String(key.getAttribute('aria-pressed') !== 'true')));
connectSound(document.querySelector('#sound'));
adopt();
await ready();
document.documentElement.dataset.ready = '1';
