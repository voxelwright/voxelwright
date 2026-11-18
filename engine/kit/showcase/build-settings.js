import { fitInstrument } from '../src/index.js';

const key = 'vx-instrument-build';
let current;
export function recall() {
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
