// Built-in AI Game-Dev IDE extensions (#98):
// Every core Voxelwright dev tool registers through the same `StudioExtension` interface that
// user/agent engine plugins (`engine/plugins/*/page.ts`) use — panels, T3 bug context collectors,
// dynamic MCP Game-Use tools (`game_ext_*`), and 1-click AI playbooks.
import type { PickInfo } from '../recorder.ts'
import type { StudioExtensionRegistry } from './ext.ts'
import type { StudioCtx, StudioExtension } from './types.ts'

const SF_LANDMARKS: Record<string, { label: string; at: [number, number, number]; look: [number, number] }> = {
  embarcadero: { label: 'Embarcadero & Market', at: [0, 48, 0], look: [-35, -14] },
  transamerica: { label: 'Transamerica Pyramid', at: [-260, 110, -420], look: [35, -12] },
  coit: { label: 'Coit Tower / Telegraph Hill', at: [-420, 145, -880], look: [140, -16] },
  ferry: { label: 'Ferry Building Waterfront', at: [380, 44, -220], look: [-110, -10] },
  civic: { label: 'Civic Center / Market St', at: [-980, 62, 620], look: [55, -12] },
  baybridge: { label: 'Bay Bridge Approach', at: [720, 96, 360], look: [-60, -14] },
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = '') => {
  const n = document.createElement(tag)
  if (cls) n.className = cls
  if (text) n.textContent = text
  return n
}

function makeVoxelInspectorExtension(): StudioExtension {
  let lastPick: (PickInfo & { farBuildingId?: number | null; farFace?: number | null }) | null = null
  return {
    id: 'voxel-inspector',
    title: 'Voxel & 3D Ray-Pick Inspector',
    panels: [
      {
        id: 'voxel-inspector',
        title: 'Voxel Pick',
        icon: '⌖',
        slot: 'rail',
        mount(container, ctx) {
          const root = el('div', 'st-ext-box')
          const out = el('pre', 'st-mono', 'Click "Pick Crosshair" to inspect voxel cell, material, geo street, and far building ID.')
          const bar = el('div', 'st-row')
          const pickBtn = el('button', 'st-btn primary', 'Pick Crosshair (0.5, 0.5)')
          const bugBtn = el('button', 'st-btn', 'Fire T3 Bug for Pick')
          const cutBtn = el('button', 'st-btn', 'Cut r=12')
          const igniteBtn = el('button', 'st-btn', 'Ignite')
          const blastBtn = el('button', 'st-btn danger', 'Blast')

          const refresh = async () => {
            pickBtn.disabled = true
            try {
              const p = await ctx.pickAt(0.5, 0.5)
              lastPick = p
              const g = ctx.engine.ground(p.cell[0], p.cell[2])
              const top = ctx.engine.top(p.cell[0], p.cell[2])
              out.textContent = JSON.stringify({
                cell: p.cell,
                distanceM: Number(p.distanceM.toFixed(2)),
                material: p.material,
                colourHex: `#${(p.colour >>> 0).toString(16).padStart(6, '0')}`,
                groundCellY: g,
                topCellY: top,
                farBuildingId: p.farBuildingId ?? null,
                farFace: p.farFace ?? null,
                geo: p.geo ?? null,
              }, null, 2)
            } finally {
              pickBtn.disabled = false
            }
          }

          pickBtn.onclick = () => void refresh()
          bugBtn.onclick = () => void ctx.fireBugInView(
            lastPick ? `Bug on picked cell [${lastPick.cell.join(',')}]${lastPick.geo?.street ? ` (${lastPick.geo.street})` : ''}${lastPick.farBuildingId ? ` building #${lastPick.farBuildingId}` : ''}` : 'Bug at current crosshair pick',
          )
          cutBtn.onclick = () => { if (lastPick) { ctx.engine.cut(lastPick.cell, 12); ctx.notice(`Cut r=12 at [${lastPick.cell.join(',')}]`, 2000) } }
          igniteBtn.onclick = () => { if (lastPick) { ctx.engine.ignite(lastPick.cell, 6); ctx.notice(`Ignited [${lastPick.cell.join(',')}]`, 2000) } }
          blastBtn.onclick = () => { ctx.engine.blast(24); ctx.notice('Blasted crosshair target', 2000) }

          bar.append(pickBtn, bugBtn, cutBtn, igniteBtn, blastBtn)
          root.append(bar, out)
          container.replaceChildren(root)
          void refresh()
          return () => { container.replaceChildren() }
        },
      },
    ],
    collectors: [
      {
        kind: 'game-voxel',
        label: 'Voxel Ground & Eye Context',
        collect(ctx) {
          const cx = Math.round(ctx.engine.pose.x * 10)
          const cy = Math.round(ctx.engine.pose.y * 10)
          const cz = Math.round(ctx.engine.pose.z * 10)
          return {
            eyeCell: [cx, cy, cz],
            eyeKind: ctx.engine.kind(cx, cy, cz),
            groundCellY: ctx.engine.ground(cx, cz),
            feetCellY: ctx.engine.feet(cx, cz),
            topCellY: ctx.engine.top(cx, cz),
            lastPick,
          }
        },
      },
    ],
    gameTools: [
      {
        name: 'sample_column',
        description: 'Sample voxel cell material kinds along a vertical column [x, z] in 10cm world cells.',
        access: 'observe',
        schema: {
          type: 'object',
          properties: {
            x: { type: 'integer', description: 'World cell X' },
            z: { type: 'integer', description: 'World cell Z' },
            yMin: { type: 'integer', description: 'Lowest cell Y (default ground-10)' },
            yMax: { type: 'integer', description: 'Highest cell Y (default top+10)' },
            step: { type: 'integer', description: 'Sampling stride in cells (default 2)' },
          },
          required: ['x', 'z'],
        },
        run(ctx, args) {
          const x = Math.round(Number(args.x))
          const z = Math.round(Number(args.z))
          const ground = ctx.engine.ground(x, z)
          const top = ctx.engine.top(x, z)
          const yMin = args.yMin !== undefined ? Math.round(Number(args.yMin)) : ground - 10
          const yMax = args.yMax !== undefined ? Math.round(Number(args.yMax)) : Math.max(top + 10, ground + 40)
          const step = Math.max(1, Math.min(20, Math.round(Number(args.step ?? 2))))
          const samples: Array<{ y: number; kind: number }> = []
          for (let y = yMin; y <= yMax && samples.length < 200; y += step) {
            const k = ctx.engine.kind(x, y, z)
            if (k !== 0) samples.push({ y, kind: k })
          }
          return { x, z, ground, feet: ctx.engine.feet(x, z), top, nonEmptyCount: samples.length, samples }
        },
      },
    ],
    actions: [
      {
        id: 'audit-picked-facade',
        title: 'Audit Geometry & Facade at Crosshair',
        async prompt(ctx) {
          const bookmark = ctx.captureBookmark()
          const pick = await ctx.pickAt(0.5, 0.5).catch(() => null)
          const shot = await ctx.captureFrame('color')
          return {
            title: `Facade & Voxel Audit: ${pick?.geo?.street || bookmark.where || bookmark.at.join(',')}`,
            text: `Inspect the voxel geometry, material shading, and facade continuity at ${bookmark.reproUrl}. Identify any seams, floating roofs, z-fighting, or wrong materials and fix them with a regression check.`,
            contextRecords: [
              { kind: 'game-frame', label: 'Audit Frame', payload: bookmark as unknown as Record<string, unknown> },
              ...(pick ? [{ kind: 'game-pick', label: 'Target Cell', payload: pick as unknown as Record<string, unknown> }] : []),
            ],
            files: [{ name: 'audit-frame.png', mimeType: 'image/png', dataBase64: shot.dataUrl, label: 'Current View', type: 'image' }],
            workspaceStrategy: { type: 'worktree', startFromOrigin: true },
            bookmark,
          }
        },
      },
    ],
  }
}

function makeRenderLabExtension(): StudioExtension {
  return {
    id: 'render-lab',
    title: 'WebGPU Render Pass & Lighting Lab',
    panels: [
      {
        id: 'render-lab',
        title: 'Render Lab',
        icon: '◐',
        slot: 'rail',
        mount(container, ctx) {
          const root = el('div', 'st-ext-box')
          const e = ctx.engine
          const flagsRow = el('div', 'st-row')
          const mkFlag = (bit: number, name: string) => {
            const b = el('button', `st-btn ${(e.flags & bit) ? 'on' : ''}`, name)
            b.onclick = () => {
              e.flags = (e.flags & bit) ? (e.flags & ~bit) : (e.flags | bit)
              b.classList.toggle('on', Boolean(e.flags & bit))
            }
            return b
          }
          const pauseBtn = el('button', `st-btn ${e.resting ? 'on' : ''}`, e.resting ? 'Resume Sim' : 'Pause Sim')
          pauseBtn.onclick = () => {
            e.pause(!e.resting)
            pauseBtn.classList.toggle('on', e.resting)
            pauseBtn.textContent = e.resting ? 'Resume Sim' : 'Pause Sim'
          }
          flagsRow.append(mkFlag(1, 'Shadows'), mkFlag(2, 'Mirrors'), mkFlag(4, 'Ray Heat'), pauseBtn)

          const sliders = el('div', 'st-grid')
          const mkRange = (label: string, min: number, max: number, step: number, val: number, onSet: (v: number) => void) => {
            const row = el('label', 'st-slider')
            const txt = el('span', '', `${label}: ${val.toFixed(2)}`)
            const inp = document.createElement('input')
            inp.type = 'range'; inp.min = String(min); inp.max = String(max); inp.step = String(step); inp.value = String(val)
            inp.oninput = () => {
              const n = Number(inp.value)
              txt.textContent = `${label}: ${n.toFixed(2)}`
              onSet(n)
            }
            row.append(txt, inp)
            return row
          }
          sliders.append(
            mkRange('Hour', 0, 24, 0.25, e.hour ?? 11, (v) => { e.hour = v }),
            mkRange('Rain', 0, 1, 0.05, e.rain ?? 0, (v) => { e.rain = v }),
            mkRange('Fog', 0, 1, 0.05, e.fog ?? 0, (v) => { e.fog = v }),
            mkRange('Scale', 0.35, 1.5, 0.05, e.scale ?? 1, (v) => { e.scale = v }),
            mkRange('FOV', 35, 105, 1, e.fov ?? 65, (v) => { e.fov = v }),
          )

          const perfOut = el('pre', 'st-mono', `frame=${e.frameMs.toFixed(1)} ms · gpu=${e.gpuMs.toFixed(1)} ms · cpu=${e.cpuMs.toFixed(1)} ms`)
          const actRow = el('div', 'st-row')
          const benchBtn = el('button', 'st-btn primary', 'Run GPU Passes Benchmark')
          const heatShotBtn = el('button', 'st-btn', 'Send Heat + Perf to T3')
          benchBtn.onclick = async () => {
            benchBtn.disabled = true
            perfOut.textContent = 'Running GPU pass timing (20 frames)…'
            try {
              const pacedMs = typeof e.paced === 'function' ? await e.paced(e.flags) : null
              const passes = typeof e.passes === 'function' ? await e.passes(e.flags, 20) : null
              perfOut.textContent = JSON.stringify({
                frameMs: Number(e.frameMs.toFixed(2)),
                gpuMs: Number(e.gpuMs.toFixed(2)),
                cpuMs: Number(e.cpuMs.toFixed(2)),
                pacedMs,
                passes,
                flags: e.flags,
                scale: e.scale,
              }, null, 2)
            } catch (err) {
              perfOut.textContent = `Benchmark failed: ${err instanceof Error ? err.message : String(err)}`
            } finally {
              benchBtn.disabled = false
            }
          }
          heatShotBtn.onclick = async () => {
            const bookmark = ctx.captureBookmark()
            const color = await ctx.captureFrame('color')
            const heat = await ctx.captureFrame('heat')
            ctx.openComposerWithDraft({
              title: `GPU Pass Optimization @ ${bookmark.where || bookmark.at.join(',')}`,
              text: `Analyze the raymarch step heatmap and frame timings at ${bookmark.reproUrl}. Find the hottest shader pass or marching region and optimize it while keeping visual parity.`,
              contextRecords: [
                { kind: 'game-perf', label: `Perf ${e.frameMs.toFixed(1)} ms`, payload: { frameMs: e.frameMs, gpuMs: e.gpuMs, cpuMs: e.cpuMs, scale: e.scale, flags: e.flags, worldStats: e.world?.stats ?? null } },
              ],
              files: [
                { name: 'scene-color.png', mimeType: 'image/png', dataBase64: color.dataUrl, label: 'Scene Color', type: 'image' },
                { name: 'scene-heat.png', mimeType: 'image/png', dataBase64: heat.dataUrl, label: 'Raymarch Heatmap', type: 'image' },
              ],
              workspaceStrategy: { type: 'worktree', startFromOrigin: true },
              bookmark,
            })
          }
          actRow.append(benchBtn, heatShotBtn)
          root.append(flagsRow, sliders, actRow, perfOut)
          container.replaceChildren(root)
          return () => { container.replaceChildren() }
        },
      },
    ],
    collectors: [
      {
        kind: 'game-render',
        label: 'Render Flags & GPU Timing',
        collect(ctx) {
          const e = ctx.engine
          return {
            frameMs: Number((e.frameMs ?? 0).toFixed(2)),
            gpuMs: Number((e.gpuMs ?? 0).toFixed(2)),
            cpuMs: Number((e.cpuMs ?? 0).toFixed(2)),
            scale: e.scale,
            fov: e.fov,
            flags: e.flags,
            graphicsPreset: e.graphics?.preset ?? null,
            gpuFaultCount: e.gpu?.faults?.length ?? 0,
          }
        },
      },
    ],
    gameTools: [
      {
        name: 'profile',
        description: 'Run paced GPU frame timing and per-pass WebGPU breakdown on the current camera view.',
        access: 'observe',
        schema: {
          type: 'object',
          properties: {
            frames: { type: 'integer', description: 'Number of timed frames (default 20)' },
          },
        },
        async run(ctx, args) {
          const n = Math.max(5, Math.min(60, Number(args.frames ?? 20)))
          const e = ctx.engine
          const pacedMs = typeof e.paced === 'function' ? await e.paced(e.flags) : null
          const passes = typeof e.passes === 'function' ? await e.passes(e.flags, n) : null
          return { frameMs: e.frameMs, gpuMs: e.gpuMs, cpuMs: e.cpuMs, scale: e.scale, flags: e.flags, pacedMs, passes }
        },
      },
    ],
    actions: [
      {
        id: 'profile-view',
        title: 'Profile & Optimize Current View (Heatmap + GPU Passes)',
        async prompt(ctx) {
          const bookmark = ctx.captureBookmark()
          const color = await ctx.captureFrame('color')
          const heat = await ctx.captureFrame('heat')
          return {
            title: `Perf Profile: ${bookmark.where || bookmark.at.join(',')}`,
            text: `Profile and optimize frame rendering at ${bookmark.reproUrl}. Run \`game_ext_render_lab_profile\` before and after your change and keep visual quality intact.`,
            contextRecords: [{ kind: 'game-frame', label: 'Perf Bookmark', payload: bookmark as unknown as Record<string, unknown> }],
            files: [
              { name: 'color.png', mimeType: 'image/png', dataBase64: color.dataUrl, label: 'Color Frame', type: 'image' },
              { name: 'heat.png', mimeType: 'image/png', dataBase64: heat.dataUrl, label: 'Raymarch Heat', type: 'image' },
            ],
            workspaceStrategy: { type: 'worktree', startFromOrigin: true },
            bookmark,
          }
        },
      },
    ],
  }
}

function makeCityTilesExtension(): StudioExtension {
  return {
    id: 'city-tiles',
    title: 'City Tiles, World Memory & Landmarks',
    panels: [
      {
        id: 'city-tiles',
        title: 'City & Tiles',
        icon: '▦',
        slot: 'rail',
        mount(container, ctx) {
          const root = el('div', 'st-ext-box')
          const stats = el('pre', 'st-mono')
          const update = () => {
            const b = ctx.captureBookmark()
            stats.textContent = JSON.stringify({
              where: b.where ?? null,
              at: b.at,
              look: b.look,
              mode: b.mode,
              settling: ctx.engine.settling,
              bodies: ctx.engine.bodies,
              burning: ctx.engine.burning,
              flowing: ctx.engine.flowing,
              worldStats: ctx.engine.world?.stats ?? null,
            }, null, 2)
          }
          const marks = el('div', 'st-row')
          for (const [key, lm] of Object.entries(SF_LANDMARKS)) {
            const btn = el('button', 'st-btn', lm.label)
            btn.dataset.landmark = key
            btn.onclick = () => {
              const cur = ctx.captureBookmark()
              ctx.teleportToBookmark({ ...cur, at: lm.at, look: lm.look, mode: 'flying' })
              ctx.notice(`Teleported to ${lm.label}`, 2000)
              update()
            }
            marks.append(btn)
          }
          const copyBtn = el('button', 'st-btn primary', 'Copy Repro URL')
          copyBtn.onclick = () => {
            const u = ctx.captureBookmark().reproUrl
            void navigator.clipboard?.writeText(u)
            ctx.notice('Copied repro URL', 1800)
          }
          root.append(el('div', 'st-label', 'SF Landmark Teleports'), marks, copyBtn, stats)
          container.replaceChildren(root)
          update()
          const iv = setInterval(update, 1000)
          return () => { clearInterval(iv); container.replaceChildren() }
        },
      },
    ],
    collectors: [
      {
        kind: 'game-tiles',
        label: 'Sector Pool & Tile Stats',
        collect(ctx) {
          return {
            settling: ctx.engine.settling,
            worldStats: ctx.engine.world?.stats ?? null,
            bodies: ctx.engine.bodies,
            burning: ctx.engine.burning,
            flowing: ctx.engine.flowing,
          }
        },
      },
    ],
    gameTools: [
      {
        name: 'teleport_landmark',
        description: `Teleport camera to a named San Francisco landmark (${Object.keys(SF_LANDMARKS).join(', ')}).`,
        access: 'act',
        schema: {
          type: 'object',
          properties: {
            landmark: { type: 'string', enum: Object.keys(SF_LANDMARKS) },
          },
          required: ['landmark'],
        },
        run(ctx, args) {
          const lm = SF_LANDMARKS[String(args.landmark)]
          if (!lm) throw new Error(`Unknown landmark: ${String(args.landmark)}`)
          const cur = ctx.captureBookmark()
          ctx.teleportToBookmark({ ...cur, at: lm.at, look: lm.look, mode: 'flying' })
          return { landmark: args.landmark, label: lm.label, bookmark: ctx.captureBookmark() }
        },
      },
    ],
  }
}

function makeSoundLabExtension(): StudioExtension {
  return {
    id: 'sound-lab',
    title: 'AudioWorklet Sound Patch Lab',
    panels: [
      {
        id: 'sound-lab',
        title: 'Sound Lab',
        icon: '♪',
        slot: 'rail',
        mount(container, ctx) {
          const root = el('div', 'st-ext-box')
          const info = el('pre', 'st-mono', JSON.stringify({
            hasEars: Boolean(ctx.engine.ears),
            hasVoice: Boolean(ctx.engine.ears?.voice),
            hasRadio: Boolean(ctx.engine.ears?.radio),
            hint: 'All game audio is synthesized in AudioWorklet patches (engine/page/sound/) judged automatically by engine/ears/.',
          }, null, 2))
          const tuneBtn = el('button', 'st-btn primary', 'Open T3 Sound Patch Tuning Thread')
          tuneBtn.onclick = () => {
            ctx.openComposerWithDraft({
              title: 'Tune Synth Sound Patch with engine/ears Judge',
              text: 'Inspect the procedural AudioWorklet patches in `engine/page/sound/` and run the `engine/ears/` sound judge climb check. Load the `game-sound` and `sound-judge` skills first, propose improvements, and verify zero clipping or regression.',
              workspaceStrategy: { type: 'worktree', startFromOrigin: true },
            })
          }
          root.append(info, tuneBtn)
          container.replaceChildren(root)
          return () => { container.replaceChildren() }
        },
      },
    ],
  }
}

function makeWorkshopPlusExtension(): StudioExtension {
  return {
    id: 'workshop-plus',
    title: 'Workshop Rules & Engine Gaps',
    panels: [
      {
        id: 'workshop-plus',
        title: 'Workshop',
        icon: '⚙',
        slot: 'rail',
        mount(container, ctx) {
          const root = el('div', 'st-ext-box')
          const desc = el('p', 'st-muted', 'Upgrade rule engine gaps into live T3 Code worktree threads or open the classic Workshop drawer.')
          const row = el('div', 'st-row')
          const openOld = el('button', 'st-btn', 'Toggle Classic Workshop')
          openOld.onclick = () => {
            if (ctx.engine.workshop) {
              ctx.engine.workshop.show(!ctx.engine.workshop.open)
            } else {
              ctx.notice('Classic Workshop requires local helper (engine/helper.mjs)', 2500)
            }
          }
          const newPlugin = el('button', 'st-btn primary', 'Build New Engine Plugin in T3')
          newPlugin.onclick = () => {
            ctx.openComposerWithDraft({
              title: 'New Voxelwright Engine Plugin',
              text: 'Design and build a new engine plugin under `engine/plugins/<name>/` (both world-side and page-side) that also registers a `StudioExtension` via `engine.studio?.registerExtension(...)`. Include an automated check in `engine/test/`.',
              workspaceStrategy: { type: 'worktree', startFromOrigin: true },
            })
          }
          row.append(openOld, newPlugin)
          root.append(desc, row)
          container.replaceChildren(root)
          return () => { container.replaceChildren() }
        },
      },
    ],
  }
}

export function registerBuiltInExtensions(registry: StudioExtensionRegistry): void {
  registry.register(makeVoxelInspectorExtension())
  registry.register(makeRenderLabExtension())
  registry.register(makeCityTilesExtension())
  registry.register(makeSoundLabExtension())
  registry.register(makeWorkshopPlusExtension())
}
