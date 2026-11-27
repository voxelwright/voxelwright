// The street's page in development (#118 spike). The page asks its own server where the
// world is (/where) and how it is doing (/stats); both are passed on to the world process
// on this machine, so the page has one origin whether it is opened here or over the tailnet.
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

const world = `http://127.0.0.1:${process.env.STREET_HTTP ?? 4434}`
// Only this folder (page, src and node_modules) and the home's src, which holds the engine's World, may be served.
const allow = [fileURLToPath(new URL('.', import.meta.url)), fileURLToPath(new URL('../home/src', import.meta.url))]
// Local names only, unless STREET_ALLOWED_HOST names the one host (a tailnet name, say) the page is opened by.
const allowedHosts = process.env.STREET_ALLOWED_HOST ? [process.env.STREET_ALLOWED_HOST] : []
export default defineConfig({
  root: 'client',
  // The page runs the engine's World from home/src, which brings its own three: one copy only, or a mesh made by one is a stranger to the other's renderer.
  resolve: { dedupe: ['three', 'cordis'] },
  server: { port: 5318, strictPort: true, allowedHosts, proxy: { '/where': world, '/stats': world }, fs: { allow } },
})
