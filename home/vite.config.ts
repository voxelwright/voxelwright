import { defineConfig } from 'vite'

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

export default defineConfig({
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
