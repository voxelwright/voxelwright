// Voxelmorphism. Plain HTML and CSS carry the interface; this turns each control into voxels
// where a renderer is available. Without one, or with data-vx-plain on <html>, the CSS stands alone.

import { Stage } from './core/stage.js';
import { Renderer } from './core/gl.js';
import { renderer as engine } from './engine.js';
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
import { groove, recess, lamp, pointer, applyTheme } from './looks/lit.js';
import { behave, unbehave } from './plain.js';

export { Model, Part } from './core/model.js';
export { MATERIALS, LIGHTS, defineMaterial } from './core/materials.js';
export { LOOKS, defineLook } from './core/look.js';
export { FULL, halo, byTheme, warmth, lightName, kindOf, ring, hole } from './core/light.js';
export { THEMES } from './looks/lit.js';
export { listeners, clamp } from './components/util.js';
export { wrapLabel } from './components/util.js';
export { Spring, assemble, crumble, PRESS, RELEASE, SLIDE, CALM } from './core/motion.js';
export { FONTS, registerFont, makeFont, layout as layoutText, measure as measureText } from './core/fonts/index.js';

export { plant, pot, STAGES, stageOf } from './core/plant.js';
export { sound, cue } from './core/sound.js';

export const components = [button, toggle, slider, field, card, list, tabs, meter, menu, dialog, toastDef, lettering, block, groove, recess, lamp, pointer];
let stage = null;

// The renderer. By default it is the Village engine's (WebGPU, src/engine.js). use() hands the
// kit another. Where there is no WebGPU the kit's own WebGL2 renderer (core/gl.js) still stands
// in; it goes once the plain version looks right, and such a browser then gets the plain page.
let given;          // undefined: the default; null: none, the page stays plain; else a renderer
let pending = null; // a promise while a renderer is still on its way
let waiting = [];   // what adopt() and release() were asked for meanwhile, in order

// Ask for the default renderer, once, the first time the page wants voxels. A WebGPU device
// takes a moment, so the page is plain until it arrives, exactly as with use(). A page that is
// plain by choice asks for nothing, and neither does one that was handed a renderer (or null).
function auto() {
  if (given !== undefined || pending || stage || typeof document === 'undefined') return;
  if (document.documentElement.hasAttribute('data-vx-plain')) return;
  if (!globalThis.navigator?.gpu) return; // no WebGPU: given stays undefined, and WebGL2 stands in
  use(engine().then((r) => r ?? own(), own));
}
// The stand-in, or null where there is no WebGL2 either.
function own() {
  try { return Renderer.supported() ? new Renderer() : null; } catch { return null; }
}

/**
 * Hand the kit a renderer: anything with draw(frame, target), or a promise for one (a WebGPU
 * device takes a moment). target is the part's 2D context; a renderer with ownsCanvas: true is
 * given the part's canvas element instead and takes its own context on it (the kit still makes
 * and sizes the canvas, and never reads it back). The kit sets two hooks on the renderer:
 * onrestore(), to call after a lost context or device is back (every part is drawn again), and
 * onfail(), to call if it can never draw again (every part goes back to plain CSS, and the
 * document hears a `vx-plain` event). Call use() before adopt(). While the promise is open the page is plain and
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

// The fonts for the words on keys. A menu's items are not drawn until it first opens, so without
// this their font would arrive mid-build, resize the menu and cut its assembly short.
let keyFonts = null;
function loadKeyFonts() {
  if (keyFonts || typeof document === 'undefined' || !document.fonts?.load) return keyFonts ?? Promise.resolve();
  const family = getComputedStyle(document.documentElement).getPropertyValue('--vx-key-font').trim();
  keyFonts = family ? Promise.all([400, 700].map((w) => document.fonts.load(`${w} 20px ${family}`).catch(() => {}))) : Promise.resolve();
  return keyFonts;
}

/**
 * Resolves once it is known whether the page is live, and the fonts for key labels are in:
 * to the stage, or to null if the page is plain.
 */
export function ready() {
  auto();
  if (pending) return pending.then(() => ready());
  return loadKeyFonts().then(() => getStage());
}

/** True while the CSS stands alone: by choice, for want of a renderer, or while one is on its way. */
export function plain() {
  auto();
  if (document.documentElement.hasAttribute('data-vx-plain') || pending) return true;
  return given === undefined ? !Renderer.supported() : given === null;
}

/** The stage, made on first use. Null when the page is plain. */
export function getStage() {
  if (stage || plain()) return stage;
  try { stage = new Stage(given ?? new Renderer()); } catch { stage = null; }
  if (stage) stage.onfail = fail;
  return stage;
}

// The renderer can never draw again (a device lost, and no other to be had). Every part goes
// back to plain CSS with its behaviour, and the page stays plain from here on.
function fail() {
  const st = stage;
  if (!st) return;
  for (const el of [...st.lives.keys()]) { st.remove(el); behave(el); }
  stage = null;
  given = null;
  document.dispatchEvent(new CustomEvent('vx-plain'));
}

/**
 * Turn every Voxelmorphism element under root into voxels. Safe to call again after adding nodes.
 * Returns the stage, or null if the page is plain (if a renderer is on its way, the call is kept
 * and made when it arrives).
 */
export function adopt(root = document) {
  auto();
  if (pending && !document.documentElement.hasAttribute('data-vx-plain')) {
    waiting.push([adopt, root]);
    return null;
  }
  loadKeyFonts();
  const st = getStage();
  // plain: no voxels, but tabs, dialogs and menus still get their behaviour
  if (!st) { behave(root); return null; }
  for (const def of components) {
    const found = root.querySelectorAll ? [...root.querySelectorAll(def.selector)] : [];
    if (root.matches?.(def.selector)) found.unshift(root);
    for (const el of found) { unbehave(el); st.add(el, def); }
  }
  return st;
}

/** Give an element, and everything under it, back to plain CSS. */
export function release(root = document) {
  if (pending) { waiting.push([release, root]); return; }
  if (!stage) return;
  for (const el of [...stage.lives.keys()]) if (root === document || root === el || root.contains(el)) { stage.remove(el); behave(el); }
}

/**
 * Say that an element changed in a way the kit cannot hear. Setting a slider's value or a
 * switch's checked from code is heard by itself; call this after changing anything else that a
 * part is drawn from (its text, its attributes, its children). It rebuilds the part.
 */
export function refresh(el) {
  stage?.lives.get(el)?.rebuild();
}

/** The live model behind an element, for code that wants to play an effect on it. */
export function live(el) {
  return stage?.lives.get(el) ?? null;
}

/**
 * Set the lit look's theme: 'bay', 'rose', 'dusk', or an object shaped like one of THEMES. Every
 * part that is drawn is recoloured, and the stylesheet's tokens follow.
 */
export function theme(t) {
  const th = applyTheme(t);
  if (stage) for (const l of stage.lives.values()) { l.model.tint(l.theme, l.look); l.invalidate(); }
  return th;
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
