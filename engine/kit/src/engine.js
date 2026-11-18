// The Village engine's renderer for the kit: WebGPU, one canvas per part.
//
//   import { use, adopt } from './index.js';
//   import { renderer } from './engine.js';
//   use(renderer());   // resolves to the renderer, or to null where there is no WebGPU: the page then stays plain
//   adopt();
//
// It is the engine's own source (engine/blocks), by its .ts name. Every engine server strips the types from a .ts as it
// is asked for (blocks/serve.mjs, the kit's tools/serve.mjs), and the built folder (player/build.mjs) writes it as .js.
export { renderer } from '../../blocks/renderer.ts';
