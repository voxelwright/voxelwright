import assert from 'node:assert/strict';

// Call after the showcase is ready, on the model host (for example, .vx-slider
// around the range input). A compound control may contain other model hosts.
export function inspectNativeVoxels(hosts, { plain = false, families = [] } = {}) {
  return hosts.evaluateAll(async (elements, { plain, families }) => {
    const { getStage, live, Model, Part } = await import('/kit/src/index.js');
    function problem(el) {
      const instance = live(el);
      if (plain) {
        return instance || el.querySelector(':scope > canvas.vx-canvas')
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
      const canvases = [...el.querySelectorAll('canvas')].filter(canvas => {
        const owner = live(canvas.parentElement);
        return owner === instance || owner?.canvas !== canvas;
      });
      if (canvases.length !== 1 || canvases[0] !== instance.canvas) {
        return 'expected one canvas owned by the live instance';
      }
      return null;
    }
    return elements.map(el => ({
      id: el.id,
      family: families.find(selector => el.matches(selector)),
      problem: problem(el),
    }));
  }, { plain, families });
}

export async function assertNativeVoxels(host, options) {
  const results = await inspectNativeVoxels(host, options);
  assert.equal(results.length, 1, `expected one specimen host for ${host}`);
  assert.equal(results[0].problem, null, `${host}: ${results[0].problem}`);
}
