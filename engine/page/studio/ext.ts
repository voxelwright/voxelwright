// Extensible AI Game-Dev IDE Registry (#98).
// Built-in dev tools (Voxel Inspector, Render Pass Lab, Sound Patch Lab, City Tile Inspector, Workshop)
// AND engine plugins (`engine/plugins/*/page.ts`) register panels, T3 bug-context collectors,
// dynamic MCP Game-Use tools, and quick-launch playbooks through this single registry.
import type {
  GameContextRecord,
  StudioActionDef,
  StudioCtx,
  StudioExtension,
  StudioGameToolDef,
  StudioPanelDef,
} from './types.ts'

export interface AdvertisedGameTool {
  name: string
  extensionId: string
  description: string
  schema: Record<string, unknown>
  access: 'observe' | 'act'
}

export class StudioExtensionRegistry {
  #exts = new Map<string, StudioExtension>()
  #listeners = new Set<() => void>()

  register(ext: StudioExtension): () => void {
    if (!ext || !/^[a-z0-9][a-z0-9-]{0,31}$/.test(ext.id)) {
      throw new Error(`Invalid StudioExtension id: "${String(ext?.id)}"`)
    }
    this.#exts.set(ext.id, ext)
    this.#notify()
    return () => this.unregister(ext.id)
  }

  unregister(id: string): void {
    if (this.#exts.delete(id)) this.#notify()
  }

  onChange(fn: () => void): () => void {
    this.#listeners.add(fn)
    return () => this.#listeners.delete(fn)
  }

  #notify(): void {
    for (const fn of this.#listeners) {
      try { fn() } catch { /* isolate */ }
    }
  }

  list(): StudioExtension[] {
    return [...this.#exts.values()]
  }

  panels(): Array<StudioPanelDef & { extensionId: string }> {
    const out: Array<StudioPanelDef & { extensionId: string }> = []
    for (const ext of this.#exts.values()) {
      for (const p of ext.panels ?? []) out.push({ ...p, extensionId: ext.id })
    }
    return out
  }

  actions(): Array<StudioActionDef & { extensionId: string }> {
    const out: Array<StudioActionDef & { extensionId: string }> = []
    for (const ext of this.#exts.values()) {
      for (const a of ext.actions ?? []) out.push({ ...a, extensionId: ext.id })
    }
    return out
  }

  advertisedGameTools(): AdvertisedGameTool[] {
    const out: AdvertisedGameTool[] = []
    for (const ext of this.#exts.values()) {
      for (const t of ext.gameTools ?? []) {
        const name = t.name.startsWith('game_') ? t.name : `game_ext_${ext.id.replace(/-/g, '_')}_${t.name.replace(/-/g, '_')}`
        out.push({
          name,
          extensionId: ext.id,
          description: t.description,
          schema: t.schema,
          access: t.access,
        })
      }
    }
    return out
  }

  async runGameTool(name: string, ctx: StudioCtx, args: Record<string, unknown>): Promise<unknown> {
    for (const ext of this.#exts.values()) {
      for (const t of ext.gameTools ?? []) {
        const full = t.name.startsWith('game_') ? t.name : `game_ext_${ext.id.replace(/-/g, '_')}_${t.name.replace(/-/g, '_')}`
        if (full === name || t.name === name) {
          return await t.run(ctx, args)
        }
      }
    }
    throw new Error(`Unknown Studio extension tool: ${name}`)
  }

  async collectContextRecords(ctx: StudioCtx): Promise<GameContextRecord[]> {
    const out: GameContextRecord[] = []
    for (const ext of this.#exts.values()) {
      for (const c of ext.collectors ?? []) {
        try {
          const payload = await c.collect(ctx)
          if (payload && typeof payload === 'object') {
            const kind = c.kind.startsWith('game-') ? c.kind : `game-${c.kind}`
            out.push({ kind, label: c.label, payload })
          }
        } catch {
          /* individual collector errors never break bug capture */
        }
      }
    }
    return out
  }
}
