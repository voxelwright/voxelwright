// Voxelmorphism. Plain HTML and CSS carry the interface; this turns each control into voxels
// where WebGL2 is available. Without it, or with data-vx-plain on <html>, the CSS stands alone.

import { Stage } from './core/stage.js';
import { Renderer } from './core/gl.js';
import { button } from './components/button.js';

export { Model, Part } from './core/model.js';
export { MATERIALS, LIGHTS, defineMaterial } from './core/materials.js';
export { Spring, assemble, crumble, PRESS, RELEASE, SLIDE, CALM } from './core/motion.js';
export { layout as layoutText, measure as measureText } from './core/font.js';

export const components = [button];
let stage = null;

export function plain() {
  return document.documentElement.hasAttribute('data-vx-plain') || !Renderer.supported();
}

/** The stage, made on first use. Null when the page is plain. */
export function getStage() {
  if (stage || plain()) return stage;
  try { stage = new Stage(); } catch { stage = null; }
  return stage;
}

/** Turn every Voxelmorphism element under root into voxels. Safe to call again after adding nodes. */
export function adopt(root = document) {
  const st = getStage();
  if (!st) return null;
  for (const def of components) {
    const found = root.querySelectorAll ? [...root.querySelectorAll(def.selector)] : [];
    if (root.matches?.(def.selector)) found.unshift(root);
    for (const el of found) st.add(el, def);
  }
  return st;
}

/** Give an element back to plain CSS. */
export function release(el) {
  stage?.remove(el);
}

/** The live model behind an element, for code that wants to play an effect on it. */
export function live(el) {
  return stage?.lives.get(el) ?? null;
}

/** Register a component of your own: { name, selector, build(live, model), pose?, bind?, step? }. */
export function define(def) {
  components.push(def);
}
