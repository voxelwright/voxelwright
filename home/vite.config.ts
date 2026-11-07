import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { build, defineConfig, type Plugin } from 'vite'

// The villager host (host/src/villager.ts) writes its port and per-launch token
// to <VILLAGE_ROOT>/villager/launch.json. The dev server hands the token to
// same-origin pages at /villager/launch and forwards /villager/api/* to the host,
// so the page and the API share an origin.
const root = process.env.VILLAGE_ROOT ?? join(homedir(), '.village')
const port = Number(process.env.VILLAGER_PORT ?? 5190)

const villagerLaunch: Plugin = {
  name: 'villager-launch',
  configureServer(server) {
    server.middlewares.use('/villager/launch', async (req, res) => {
      res.setHeader('cache-control', 'no-store')
      const site = req.headers['sec-fetch-site']
      if (site && site !== 'same-origin') {
        res.statusCode = 403
        return res.end()
      }
      try {
        const { token } = JSON.parse(await readFile(join(root, 'villager', 'launch.json'), 'utf8'))
        res.setHeader('content-type', 'application/json')
        res.end(JSON.stringify({ token }))
      } catch {
        res.statusCode = 503
        res.end()
      }
    })
  },
}

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
  plugins: [villagerLaunch, propBox],
  server: {
    proxy: {
      '/villager/api': {
        target: `http://127.0.0.1:${port}`,
        rewrite: (path) => path.replace(/^\/villager\/api/, ''),
      },
    },
  },
})
