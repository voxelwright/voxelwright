import assert from 'node:assert/strict';

// Call after the showcase is ready, on the model host (for example, .vx-slider
// around the range input). A compound control may contain other model hosts.
export function inspectNativeVoxels(hosts, { plain = false, families = [] } = {}) {
  return hosts.evaluateAll(async (elements, { plain, families }) => {
    const { getStage, live, Model, Part } = await import('/kit/src/index.js');
    const owners = new Map();
    for (const instance of getStage()?.lives.values() ?? []) owners.set(instance.canvas, instance);
    async function clippedAway(el, canvas) {
      for (let node = canvas; node && node !== el.parentElement; node = node.parentElement) {
        if (getComputedStyle(node).clipPath === 'none') continue;
        return new Promise(resolve => {
          const observer = new IntersectionObserver(([entry]) => {
            observer.disconnect();
            resolve(entry.intersectionRect.width === 0 || entry.intersectionRect.height === 0);
          }, { root: el.parentElement });
          observer.observe(canvas);
        });
      }
      return false;
    }
    async function problem(el) {
      const instance = live(el);
      if (plain) {
        return instance || [...el.querySelectorAll('canvas.vx-canvas')].some(canvas => !owners.has(canvas) || !el.contains(owners.get(canvas).el))
          ? 'expected plain DOM without a voxel model or canvas' : null;
      }
      if (!instance) return 'no live voxel instance';
      if (instance.stage !== getStage()) return 'instance is outside the shared voxel stage';
      if (!(instance.model instanceof Model) || !instance.model.parts.every(part => part instanceof Part)) {
        return 'geometry is outside the shared Model and Part classes';
      }
      if (!instance.model.parts.some(part => part.cells.size > 0 && part.count > 0)) {
        return 'no populated voxel parts';
      }
      if (!instance.model.parts.some(part => !part.hidden && part.count > 0)) return 'all populated parts are hidden';
      if (!instance.canvas.checkVisibility({ opacityProperty: true, visibilityProperty: true }) ||
          !instance.canvas.clientWidth || !instance.canvas.clientHeight) return 'voxel canvas is hidden';
      const canvases = [...el.querySelectorAll('canvas')].filter(canvas => {
        const owner = owners.get(canvas);
        return !owner || owner === instance || !el.contains(owner.el);
      });
      if (canvases.length !== 1 || canvases[0] !== instance.canvas) {
        return 'expected one canvas owned by the live instance';
      }
      if (await clippedAway(el, instance.canvas)) return 'voxel canvas is fully clipped';
      return null;
    }
    return Promise.all(elements.map(async el => ({
      id: el.id,
      family: families.find(selector => el.matches(selector)),
      problem: await problem(el),
    })));
  }, { plain, families });
}

export async function assertNativeVoxels(host, options) {
  const results = await inspectNativeVoxels(host, options);
  assert.equal(results.length, 1, `expected one specimen host for ${host}`);
  assert.equal(results[0].problem, null, `${host}: ${results[0].problem}`);
}
