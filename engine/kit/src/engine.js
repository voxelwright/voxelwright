// The Village engine's renderer for the kit: WebGPU, one canvas per part.
//
//   import { use, adopt } from './index.js';
//   import { renderer } from './engine.js';
//   use(renderer());   // resolves to the renderer, or to null where there is no WebGPU: the page then stays plain
//   adopt();
//
// The modules under engine/ are a copy of the engine's built files, made by tools/sync-engine.mjs.
// engine/ENGINE.json says which engine commit they are. Do not edit them here.
export { renderer } from './engine/blocks/renderer.js';
