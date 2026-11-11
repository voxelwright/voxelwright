// Starts the world process (#118). The engine's World is written for a bundler, so the
// whole process is loaded through Vite's in-process module runner: one loader, one copy of
// the solver and of the engine's registries. Usage: node run.mjs [the options of src/server.ts]
import { createServer } from 'vite'

const vite = await createServer({ root: new URL('.', import.meta.url).pathname, configFile: false, appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false, watch: null, fs: { allow: ['..'] } }, optimizeDeps: { noDiscovery: true }, logLevel: 'warn' })
await vite.ssrLoadModule('/src/server.ts')
