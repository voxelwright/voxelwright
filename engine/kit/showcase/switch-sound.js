import { prepareSwitchSound, sound } from '../src/core/sound.js';

// Consent follows the visitor through the showcase in this tab. Audio in a new
// document is armed on user activation, including the click following a touch.
export function connectSound(input) {
  const key = 'vx-showcase-switch-sound';
  let enabled = false;
  function restoreChoice() {
    try { enabled = sessionStorage.getItem(key) === 'on'; } catch {}
    if (input) input.checked = enabled;
    if (enabled) prepareSwitchSound();
    else sound(false);
  }
  restoreChoice();
  addEventListener('pageshow', event => {
    if (event.persisted) restoreChoice();
  });
  function arm(event) {
    if (!event.repeat && enabled) sound(true);
  }
  document.addEventListener('pointerdown', arm, true);
  document.addEventListener('pointerup', arm, true);
  document.addEventListener('click', arm, true);
  document.addEventListener('keydown', arm, true);
  input?.addEventListener('change', () => {
    enabled = input.checked;
    sound(enabled);
    try { sessionStorage.setItem(key, input.checked ? 'on' : 'off'); } catch {}
  });
}
