// workerd treats named entrypoint exports as handlers. Expose only the shared fetch handler.
export { default } from './worker.mjs'
