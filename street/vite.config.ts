// The street's page in development (#118 spike). The page asks its own server where the
// world is (/where) and how it is doing (/stats); both are passed on to the world process
// on this machine, so the page has one origin whether it is opened here or over the tailnet.
import { defineConfig } from 'vite'

const world = `http://127.0.0.1:${process.env.STREET_HTTP ?? 4434}`
export default defineConfig({
  root: 'client',
  // The page runs the engine's World from home/src, which brings its own three: one copy only, or a mesh made by one is a stranger to the other's renderer.
  resolve: { dedupe: ['three'] },
  server: { port: 5318, strictPort: true, allowedHosts: ['.ts.net'], proxy: { '/where': world, '/stats': world }, fs: { allow: ['../..'] } },
})
