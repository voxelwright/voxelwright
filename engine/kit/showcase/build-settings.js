import { adopt, fitInstrument, release } from '../src/index.js';

const key = 'vx-instrument-build';
let current;
let plainByPreference = false;

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
  current = fitInstrument(current);
  return current;
}
export function change(fields) {
  current = fitInstrument({ ...current, ...fields });
  try { sessionStorage.setItem(key, JSON.stringify(current)); } catch {}
  return current;
}
