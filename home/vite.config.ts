import { join } from 'node:path'
import { build, defineConfig, type Plugin } from 'vite'

// The villager host (host/src/villager.ts) listens on 127.0.0.1. The dev server
// forwards /villager/api/* to it, so the page and the API share an origin. The
// page gets its person's token from the link the host prints, never from here.
const port = Number(process.env.VILLAGER_PORT ?? 5190)

// Page scripts, promoted plugins included, may talk only to this origin: the
// API and Vite's HMR websocket ('self' covers ws: on the same host and port).
// Styles stay inline-capable because Vite injects CSS as <style> tags in dev.
const csp = [
  "default-src 'self'",
  "script-src 'self'",
  "connect-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
  "object-src 'none'",
].join('; ')

// #42 prop sandbox, dev only: `virtual:prop-box` is the sandbox worker bundled into one
// self-contained script (three core, the painters, the serializer) and exported as a
// string. The sealed iframe has no network, so the page hands it this text to start
// its worker from a blob. Only src/props/load.ts imports it, behind the ?props= flag.
const propBox: Plugin = {
  name: 'prop-box',
  apply: 'serve',
  resolveId: (id) => (id === 'virtual:prop-box' ? '\0virtual:prop-box' : undefined),
  async load(id) {
    if (id !== '\0virtual:prop-box') return
    const entry = join(import.meta.dirname, 'src/props/box/worker.ts')
    const out = await build({
      configFile: false,
      logLevel: 'warn',
      resolve: { alias: [{ find: /^three\/webgpu$/, replacement: 'three' }] },
      build: { write: false, minify: true, lib: { entry, formats: ['iife'], name: 'propBox' } },
    })
    const chunk = (Array.isArray(out) ? out[0] : out as { output: { type: string; code?: string; moduleIds?: string[] }[] }).output[0]
    for (const file of chunk.moduleIds ?? []) if (!file.startsWith('\0') && !file.includes('node_modules')) this.addWatchFile(file)
    return `export default ${JSON.stringify(chunk.code)}`
  },
}

export default defineConfig({
  plugins: [propBox],
  // No SPA fallback: an unknown path is a 404, not the page.
  appType: 'mpa',
  server: {
    headers: { 'content-security-policy': csp },
    proxy: {
      '/villager/api': {
        target: `http://127.0.0.1:${port}`,
        rewrite: (path) => path.replace(/^\/villager\/api/, ''),
      },
    },
  },
})
