import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { defineConfig, type Plugin } from 'vite'

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

export default defineConfig({
  plugins: [villagerLaunch],
  server: {
    proxy: {
      '/villager/api': {
        target: `http://127.0.0.1:${port}`,
        rewrite: (path) => path.replace(/^\/villager\/api/, ''),
      },
    },
  },
})
