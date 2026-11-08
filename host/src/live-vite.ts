// A Vite plugin the live server adds on top of the home's own config, so the
// running page picks up promoted and rolled-back plugin files without a reload
// and without any change in home/.
//
// An edited plugin file already hot-swaps itself (each plugin ends with
// import.meta.hot.accept → kernel replace). A new or deleted file is different:
// main.ts finds plugins through import.meta.glob and does not accept updates,
// so Vite would reload the whole page. This plugin takes over those two events
// for home/src/plugins/*.ts: it marks main.ts stale (a later reload sees the new
// set) and tells the page to load or unload just that plugin through the dev
// kernel (window.village.kernel, dev builds only).
import { basename } from 'node:path'

const CLIENT_ID = 'virtual:village-live'
const RESOLVED = '\0' + CLIENT_ID
const NAME_RE = /\bname\s*:\s*['"]([\w-]+)['"]/

const client = `
const hot = import.meta.hot
const kernel = () => window.village && window.village.kernel
hot.on('village:plugin-added', async ({ url }) => {
  try {
    const mod = await import(/* @vite-ignore */ url + '?t=' + Date.now())
    kernel().load(mod.default)
    console.info('[village-live] loaded', mod.default.name)
  } catch (error) {
    console.error('[village-live] could not load', url, error)
  }
})
hot.on('village:plugin-removed', async ({ name }) => {
  if (name && kernel()) await kernel().unload(name)
  console.info('[village-live] unloaded', name)
})
`

interface ModuleNode { id: string | null }
interface HotUpdateOptions { type: 'create' | 'update' | 'delete'; file: string; modules: ModuleNode[]; timestamp: number }

export function liveReload(pluginsDir: string) {
  const prefix = pluginsDir.endsWith('/') ? pluginsDir : pluginsDir + '/'
  const isPluginFile = (file: string) => file.startsWith(prefix) && file.endsWith('.ts') && !file.slice(prefix.length).includes('/') && basename(file) !== 'rooms.ts'
  /** Plugin file → its declared name, read when Vite serves it, for unloading after the file is gone. */
  const names = new Map<string, string>()
  return {
    name: 'village-live',
    enforce: 'post' as const,
    resolveId: (id: string) => (id === CLIENT_ID ? RESOLVED : undefined),
    load: (id: string) => (id === RESOLVED ? client : undefined),
    transform(code: string, id: string) {
      const file = id.split('?')[0]
      if (isPluginFile(file)) {
        const name = code.match(NAME_RE)?.[1]
        if (name) names.set(file, name)
      }
      return undefined
    },
    transformIndexHtml: () => [{ tag: 'script', attrs: { type: 'module', src: `/@id/${CLIENT_ID}` }, injectTo: 'body' as const }],
    hotUpdate(this: { environment: { name: string; moduleGraph: { invalidateModule: (m: unknown, seen: Set<unknown>, ts: number, hmr: boolean) => void }; hot: { send: (event: string, data: unknown) => void } } }, options: HotUpdateOptions) {
      if (options.type === 'update' || !isPluginFile(options.file)) return
      const env = this.environment
      if (env.name !== 'client') return []
      // The glob importer (main.ts) arrives in modules; mark it stale without sending it.
      for (const mod of options.modules) env.moduleGraph.invalidateModule(mod, new Set(), options.timestamp, true)
      const url = '/' + options.file.slice(options.file.lastIndexOf('/src/plugins/') + 1)
      if (options.type === 'create') env.hot.send('village:plugin-added', { url })
      else {
        const name = names.get(options.file) ?? basename(options.file, '.ts')
        names.delete(options.file)
        env.hot.send('village:plugin-removed', { name })
      }
      return []
    },
  }
}
