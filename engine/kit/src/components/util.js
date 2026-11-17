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
