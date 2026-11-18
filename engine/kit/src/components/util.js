/** Wrap an element's own content in a span the stage can move with a face. */
export function wrapLabel(el, cls = 'vx-label') {
  let label = el.querySelector(`:scope > .${cls}`);
  if (label) return label;
  label = document.createElement('span');
  label.className = cls;
  for (const n of [...el.childNodes]) if (!(n.nodeType === 1 && n.classList.contains('vx-canvas'))) label.append(n);
  el.append(label);
  return label;
}

/** Collect listeners so a component can drop them all at once. */
export function listeners() {
  const off = [];
  const on = (target, type, fn, opts) => { target.addEventListener(type, fn, opts); off.push(() => target.removeEventListener(type, fn, opts)); };
  on.watch = (target, opts, fn) => { const m = new MutationObserver(fn); m.observe(target, opts); off.push(() => m.disconnect()); };
  on.heed = (el, prop, fn) => { off.push(heed(el, prop, fn)); };
  on.done = () => { for (const f of off) f(); };
  return on;
}

/** A control inherits disabled from each enclosing fieldset (except its first legend). */
export function watchFieldsets(el, on, sync) {
  for (let set = el.closest('fieldset'); set; set = set.parentElement?.closest('fieldset')) {
    on.watch(set, { attributes: true, attributeFilter: ['disabled'] }, sync);
  }
}

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/**
 * Hear a property being set from code (input.value = 3, input.checked = true), which fires no
 * event. Returns an undo. The element keeps working exactly as before; fn runs after each set.
 */
export function heed(el, prop, fn) {
  const d = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), prop);
  if (!d?.set || Object.hasOwn(el, prop)) return () => {};
  Object.defineProperty(el, prop, { configurable: true, enumerable: d.enumerable, get() { return d.get.call(this); }, set(v) { const was = d.get.call(this); d.set.call(this, v); if (d.get.call(this) !== was) fn(); } });
  return () => { delete el[prop]; };
}
