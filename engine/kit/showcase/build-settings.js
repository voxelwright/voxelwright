import { adopt, defineLook, fitInstrument, getStage, LOOKS, release } from '../src/index.js';

const key = 'vx-instrument-build';
let current;
let plainByPreference = false;
const instrumentLooks = new Map();

// A local casting can have its own parts and still use the installed key material.
export function defineInstrumentLook(name, options) {
  instrumentLooks.set(name, options);
}

function fit(choice) {
  const fitted = fitInstrument(choice);
  const base = LOOKS.instrument;
  for (const [name, options] of instrumentLooks) {
    const previous = LOOKS[name];
    if (previous?.tooling === base.tooling && previous.illuminant === base.illuminant &&
        previous.dimmer === base.dimmer) continue;
    defineLook(name, { ...options, from: 'instrument', finishes: { ...base.finishes, ...options.finishes } });
    if (previous) for (const item of getStage()?.lives.values() ?? []) {
      if (item.look === previous) item.retint();
    }
  }
  return fitted;
}

function restoreRendererPreference() {
  let saved;
  try { saved = localStorage.getItem('vx-plain'); } catch { return; }
  const root = document.documentElement;
  if (saved === '1' && !root.hasAttribute('data-vx-plain')) {
    plainByPreference = true;
    root.setAttribute('data-vx-plain', '');
    release();
  } else if (saved !== '1' && plainByPreference) {
    plainByPreference = false;
    root.removeAttribute('data-vx-plain');
    adopt();
  }
}

export function recall() {
  restoreRendererPreference();
  try { current = JSON.parse(sessionStorage.getItem(key)); }
  catch { current = null; }
  current = fit(current);
  return current;
}
export function change(fields) {
  current = fit({ ...current, ...fields });
  try { sessionStorage.setItem(key, JSON.stringify(current)); } catch {}
  return current;
}
