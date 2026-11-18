// Browser side of the film gate. Project the top of each drawn plate cube into CSS pixels,
// then check the start, middle and end of every visible line's text against that footprint.
export function plateInk(live) {
  const plate = live.model.byName.panel || live.model.byName.body;
  const canvas = live.canvas.getBoundingClientRect();
  const scale = live.s / devicePixelRatio;
  const ox = canvas.left + live.ox / devicePixelRatio;
  const oy = canvas.top + live.oy / devicePixelRatio;
  const points = [];
  const clipped = getComputedStyle(live.el).clipPath !== 'none';
  const walker = document.createTreeWalker(live.el, NodeFilter.SHOW_TEXT);
  for (let node; (node = walker.nextNode());) {
    if (!node.textContent.trim() || node.parentElement.closest('canvas, script, style')) continue;
    if (!node.parentElement.checkVisibility({ opacityProperty: true, visibilityProperty: true })) continue;
    const range = document.createRange();
    range.selectNodeContents(node);
    for (const rect of range.getClientRects()) {
      if (!rect.width || !rect.height) continue;
      for (const fraction of [0.05, 0.5, 0.95]) {
        const x = Math.floor(rect.left + fraction * rect.width) + 0.5;
        const y = Math.floor(rect.top + rect.height / 2) + 0.5;
        if (x < 0 || x >= innerWidth || y < 0 || y >= innerHeight) continue;
        if (clipped && !live.el.contains(document.elementFromPoint(x, y))) continue;
        points.push({ x, y });
      }
    }
  }
  const checked = points.length;
  if (checked && plate && !plate.hidden) {
    let offset = 0;
    for (const part of live.model.parts) {
      if (part === plate) break;
      if (!part.hidden) offset += 8 * part.count;
    }
    const pos = live.pos;
    for (let i = 0; i < plate.count && points.length; i++, offset += 8) {
      const size = pos[offset + 3];
      const z = pos[offset + 2] + size / 2;
      if (size <= 0 || z <= 0) continue;
      const x = ox + (pos[offset] + z / 2) * scale;
      const y = oy + (pos[offset + 1] + z / 2) * scale;
      const half = size * scale / 2;
      for (let p = points.length - 1; p >= 0; p--) {
        if (Math.abs(points[p].x - x) <= half && Math.abs(points[p].y - y) <= half) points.splice(p, 1);
      }
    }
  }
  return { checked, unsupported: points.length };
}
