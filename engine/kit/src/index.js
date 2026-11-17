// Voxelmorphism. Plain HTML and CSS carry the interface; this turns each control into voxels
// where a renderer is available. Without one, or with data-vx-plain on <html>, the CSS stands alone.

import { Stage } from './core/stage.js';
import { Renderer } from './core/gl.js';
import { button } from './components/button.js';
import { toggle } from './components/toggle.js';
import { slider } from './components/slider.js';
import { field } from './components/field.js';
import { card } from './components/card.js';
import { list } from './components/list.js';
import { tabs } from './components/tabs.js';
import { meter } from './components/meter.js';
import { menu } from './components/menu.js';
import { dialog } from './components/dialog.js';
import { toastDef, makeToast } from './components/toast.js';
import { lettering } from './components/lettering.js';
import { block } from './components/block.js';

export { Model, Part } from './core/model.js';
export { MATERIALS, LIGHTS, defineMaterial } from './core/materials.js';
export { Spring, assemble, crumble, PRESS, RELEASE, SLIDE, CALM } from './core/motion.js';
export { FONTS, registerFont, makeFont, layout as layoutText, measure as measureText } from './core/fonts/index.js';

export { plant, pot, STAGES, stageOf } from './core/plant.js';
export { sound, cue } from './core/sound.js';

export const components = [button, toggle, slider, field, card, list, tabs, meter, menu, dialog, toastDef, lettering, block];
let stage = null;

// The renderer. By default the kit makes its own (WebGL2). use() hands it another.
let given;          // undefined: the default; null: none, the page stays plain; else a renderer
let pending = null; // a promise while a handed renderer is still on its way
let waiting = [];   // what adopt() and release() were asked for meanwhile, in order

/**
 * Hand the kit a renderer: anything with draw(frame, ctx2d), or a promise for one (a WebGPU
 * device takes a moment). Call it before adopt(). While the promise is open the page is plain and
 * adopt() remembers what it was asked for; if it settles on nothing, the page stays plain.
 * Returns a promise for the stage, or null.
 */
export function use(renderer) {
  if (stage) throw new Error('voxelmorphism: use() must come before the first adopt()');
  const mine = (pending = Promise.resolve(renderer).catch(() => null).then((r) => {
    if (pending !== mine) return stage; // a later use() replaced this one
    given = r && typeof r.draw === 'function' ? r : null;
    pending = null;
    const roots = waiting; waiting = [];
    for (const [act, root] of roots) if (root === document || root.isConnected) act(root);
    return stage;
  }));
  return mine;
}

/** Resolves once it is known whether the page is live: to the stage, or to null if it is plain. */
export function ready() {
  return pending ? pending.then(() => ready()) : Promise.resolve(getStage());
}

/** True while the CSS stands alone: by choice, for want of a renderer, or while one is on its way. */
export function plain() {
  if (document.documentElement.hasAttribute('data-vx-plain') || pending) return true;
  return given === undefined ? !Renderer.supported() : given === null;
}

/** The stage, made on first use. Null when the page is plain. */
export function getStage() {
  if (stage || plain()) return stage;
  try { stage = new Stage(given ?? new Renderer()); } catch { stage = null; }
  return stage;
}

/**
 * Turn every Voxelmorphism element under root into voxels. Safe to call again after adding nodes.
 * Returns the stage, or null if the page is plain (if a renderer is on its way, the call is kept
 * and made when it arrives).
 */
export function adopt(root = document) {
  if (pending && !document.documentElement.hasAttribute('data-vx-plain')) {
    waiting.push([adopt, root]);
    return null;
  }
  const st = getStage();
  if (!st) return null;
  for (const def of components) {
    const found = root.querySelectorAll ? [...root.querySelectorAll(def.selector)] : [];
    if (root.matches?.(def.selector)) found.unshift(root);
    for (const el of found) st.add(el, def);
  }
  return st;
}

/** Give an element, and everything under it, back to plain CSS. */
export function release(root = document) {
  if (pending) { waiting.push([release, root]); return; }
  if (!stage) return;
  for (const el of [...stage.lives.keys()]) if (root === document || root === el || root.contains(el)) stage.remove(el);
}

/** The live model behind an element, for code that wants to play an effect on it. */
export function live(el) {
  return stage?.lives.get(el) ?? null;
}

/** Register a component of your own: { name, selector, build(live, model), pose?, bind?, step? }. */
export function define(def) {
  components.push(def);
}

/** Show a toast: toast('Watered.', { kind: 'done' | 'failed' | 'note', duration }). Works plain too. */
export const toast = makeToast((el) => adopt(el), (el) => live(el));

/** Close a dialog the way its own buttons do: it crumbles, then closes. */
export function closeDialog(el, value) {
  const l = live(el);
  if (l?.state.leave) return l.state.leave(value);
  el.close(value);
}
