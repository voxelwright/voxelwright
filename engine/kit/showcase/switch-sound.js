import { sound } from '../src/core/sound.js';

// Consent follows the visitor through the showcase in this tab. Audio in a new
// document is armed on user activation, including the click following a touch.
export function connectSound(input) {
  const key = 'vx-showcase-switch-sound';
  function restoreChoice() {
    try { input.checked = sessionStorage.getItem(key) === 'on'; } catch {}
    if (!input.checked) sound(false);
  }
  restoreChoice();
  addEventListener('pageshow', event => {
    if (event.persisted) restoreChoice();
  });
  function arm(event) {
    if (!event.repeat && input.checked && !sound()) sound(true);
  }
  document.addEventListener('click', arm, true);
  document.addEventListener('keydown', arm, true);
  input.addEventListener('change', () => {
    sound(input.checked);
    try { sessionStorage.setItem(key, input.checked ? 'on' : 'off'); } catch {}
  });
}
