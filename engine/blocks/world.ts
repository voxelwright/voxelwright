// Parts of the Voxelmorphism kit standing in the world (#430): the same block pass that draws them in a page
// (pass.ts), given the world's own eye and depth through the stage's `passes`, and the world's sun and hour for
// the kit's light. The kit still makes each part from real HTML and moves it (a press, a build): the HTML is there
// and not seen, and where the kit would paint a part's canvas its cubes are kept and drawn into the world.
//
// The kit is not the engine's: it is asked for by address (`kit`, the folder its package is in).
import { blocks, type Frame, type Light } from './pass.ts'
import { FAR, NEAR, type V3 } from '../probe/gpu.ts'
import type { Stage } from '../player/stage.ts'

export interface Standing {
  /** Where the panel's top left corner is in the world, cells. */
  at: V3
  /** Along the panel to its right and down it, and out of its face towards whoever reads it: each of length 1. */
  right: V3
  down: V3
  out: V3
  /** How many cells of the world a cube of the kit is. */
  cube: number
  /** The panel as HTML, in the kit's own markup. */
  html: string
}

const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const mix = (a: number, b: number, t: number) => a + (b - a) * t

/** Stands a panel of the kit's parts in the stage's world. Resolves to the element the parts are under: change it as any page would, and the world shows it. */
export async function stand(on: Stage, kit: string, where: Standing): Promise<HTMLElement> {
  const base = new URL(kit.endsWith('/') ? kit : `${kit}/`, location.href)
  // The address comes from whoever wrote the page's address: what it names is run as this page's own, so it must be this site's.
  if (base.origin !== location.origin) throw new Error('the kit is read from this site only')
  await new Promise<void>((done, failed) => {
    const sheet = Object.assign(document.createElement('link'), { rel: 'stylesheet', href: new URL('voxelmorphism.css', base).href })
    sheet.onload = () => done(); sheet.onerror = () => failed(new Error('the kit\'s stylesheet could not be read'))
    document.head.append(sheet)
  })
  const { use, adopt, ready, LIGHTS } = await import(new URL('src/index.js', base).href) as { use(r: unknown): Promise<unknown>; adopt(root?: Element): unknown; ready(): Promise<{ lives: Map<Element, { canvas: HTMLCanvasElement; faceZ: number; vx: number; el: HTMLElement }> } | null>; LIGHTS: { day: Light; night: Light } }

  // The panel as a page would hold it: laid out by the browser and seen by nobody. `visibility: hidden` keeps it
  // from screen readers too.
  const panel = document.createElement('div')
  panel.id = 'standing'
  panel.style.cssText = 'position: fixed; left: 0; top: 0; visibility: hidden; pointer-events: none'
  panel.innerHTML = where.html
  document.body.append(panel)
  const night = () => on.march.day < 0.5
  document.documentElement.dataset.theme = night() ? 'dark' : 'light'

  // Where the kit would paint a part, its cubes are kept.
  const kept = new Map<HTMLCanvasElement, Frame>()
  void use({ ownsCanvas: true, draw(frame: Frame, canvas: HTMLCanvasElement) { kept.set(canvas, frame); return true } })
  adopt(panel)
  const stage = await ready()
  if (!stage) throw new Error('the kit stayed plain')

  const pass = await blocks(on.gpu.device, on.gpu.format, { world: true })
  let warned = false
  on.passes.push((encoder, to, v) => {
    const theme = night() ? 'dark' : 'light'
    if (document.documentElement.dataset.theme !== theme) document.documentElement.dataset.theme = theme
    // The kit's light, with the world's sun: as bright as the hour, and from where the sun stands as the panel sees it.
    const day = on.march.day, sun = on.march.sun.s, a = LIGHTS.night, b = LIGHTS.day
    const toSun: V3 = [dot(sun, where.right), dot(sun, where.down), dot(sun, where.out)], facing = toSun[2] > 0.08
    const light: Light = {
      // A sun behind the panel lights nothing on it, and throws no shadow across it.
      toLight: facing ? toSun : b.toLight, sun: facing ? mix(a.sun, b.sun, day) : 0,
      ambient: { top: mix(a.ambient.top, b.ambient.top, day), front: mix(a.ambient.front, b.ambient.front, day), side: mix(a.ambient.side, b.ambient.side, day), under: mix(a.ambient.under, b.ambient.under, day) },
      ambientTint: a.ambientTint.map((n, i) => mix(n, b.ambientTint[i], day)), highlight: a.highlight.map((n, i) => mix(n, b.highlight[i], day)),
      shadow: a.shadow.map((n, i) => (i === 3 && !facing ? 0 : mix(n, b.shadow[i], day))), seam: mix(a.seam, b.seam, day), glow: mix(a.glow, b.glow, day),
    }
    const box = panel.getBoundingClientRect(), [W, H] = to.size, k = FAR / (FAR - NEAR), t = v.tanHalf, aspect = W / H
    pass.reserve([...stage.lives.values()].reduce((n, live) => n + (kept.get(live.canvas)?.count ?? 0), 0))
    for (const live of stage.lives.values()) {
      const frame = kept.get(live.canvas)
      if (!frame || !live.el.isConnected) continue
      // A part's own cubes start at its element's corner, and a part on another stands on that one's face.
      const r = live.el.getBoundingClientRect(), vx = live.vx
      let lift = 0
      for (let up = live.el.parentElement; up && up !== panel; up = up.parentElement) lift += stage.lives.get(up)?.faceZ ?? 0
      const rem = [(r.width - Math.floor(r.width / vx + 0.01) * vx) / 2, (r.height - Math.floor(r.height / vx + 0.01) * vx) / 2]
      const off = [(r.left - box.left + rem[0]) / vx, (r.top - box.top + rem[1]) / vx, lift]
      const o = [0, 1, 2].map((i) => where.at[i] + (where.right[i] * off[0] + where.down[i] * off[1] + where.out[i] * off[2]) * where.cube - v.eye[i]) as unknown as V3
      const column = (b: V3, scale: number) => { const d = dot(b, v.forward) * scale; return [(dot(b, v.right) * scale) / (t * aspect), (dot(b, v.up) * scale) / t, k * d, d] }
      const d0 = dot(o, v.forward)
      const clip = new Float32Array([...column(where.right, where.cube), ...column(where.down, where.cube), ...column(where.out, where.cube), dot(o, v.right) / (t * aspect), dot(o, v.up) / t, k * (d0 - NEAR), d0])
      // What takes the part's shadow is the part of the page its picture would have been.
      const { ox, oy, s } = frame, area = [-ox / s, -oy / s, (frame.wpx - ox) / s, (frame.hpx - oy) / s] as const
      // All of a panel is drawn in one lot: what is laid is written to the device at once, and the world's commands
      // are sent once a frame.
      if (!pass.lay({ ...frame, light }, { clip, area })) { if (!warned) console.warn('blocks: the panel is more than one lot holds (64 parts, one map of depths); the rest of it is not drawn'); warned = true; break }
    }
    pass.draw(encoder, to.color, to.size, { depth: to.depth })
  })
  return panel
}
