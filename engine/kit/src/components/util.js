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
  on.done = () => { for (const f of off) f(); };
  return on;
}

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
