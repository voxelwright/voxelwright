// Made things heard and played (#247): a thing's record carries its `sounds` (patch.ts), the sound lane's own field.
// Struck, a thing answers with its own `hit` in place of its material's; and one that has a surface can be taken up
// and played where it stands: a button by it (and the E key) opens its surface over the picture, its keys are the
// instrument's until it is put away (E again, or Escape).
//
// What a record holds was written by someone's model: it is read through the check every time it changes, and a
// record that does not pass makes no sound and offers nothing.
import type { Hud } from '../hud.ts'
import type { Input } from '../input.ts'
import type { Thing, Things } from '../things.ts'
import { playable } from './instrument.ts'
import { sounds, type Patch, type Sounds } from './patch.ts'
import type { Sound } from './sound.ts'

/** Cells from the eye at which a thing can be taken up: four metres. */
const REACH = 40

export function played(voice: Sound, made: Things, hud: Hud, input: Input) {
  const read = new Map<string, Sounds | null>()
  const of = (t: Thing): Sounds | null => {
    let s = read.get(t.id)
    if (s === undefined) { const r = sounds(t.sounds); s = 'sounds' in r ? r.sounds : null; read.set(t.id, s) }
    return s
  }
  made.on((what, t) => { read.delete(t.id); if (what === 'gone' && out?.thing === t) put() })

  const offer = hud.panel('play-take'), stage = hud.panel('play')
  offer.style.cssText = 'position:fixed;left:50%;bottom:max(84px,env(safe-area-inset-bottom));transform:translateX(-50%);display:none;pointer-events:auto;z-index:3'
  stage.style.cssText = 'position:fixed;left:50%;bottom:max(10px,env(safe-area-inset-bottom));transform:translateX(-50%);width:min(96vw,900px);max-height:58vh;display:none;pointer-events:auto;border-radius:12px;background:rgba(12,16,22,0.72);padding:8px;box-sizing:border-box;touch-action:none;z-index:4'
  const button = document.createElement('button')
  button.type = 'button'
  button.style.cssText = 'border:0;border-radius:10px;padding:10px 16px;background:#e8ecf1;color:#10141a;font:600 14px -apple-system,system-ui,sans-serif;touch-action:manipulation'
  offer.append(button)
  let near: Thing | null = null, out: { thing: Thing; it: ReturnType<typeof playable>; pop: () => void; downs: Set<string> } | null = null

  const put = () => {
    if (!out) return
    out.it.close(); out.pop(); out = null
    stage.style.display = 'none'; stage.textContent = ''
  }
  const take = (t: Thing) => {
    const s = of(t)
    if (!s?.play || !s.surface || out) return
    document.exitPointerLock?.()
    stage.style.display = 'block'
    stage.style.aspectRatio = `${s.surface.size[0]} / ${s.surface.size[1]}`
    const it = playable(stage, voice, s.play, s.surface), downs = new Set<string>()
    // While it is out, the keys are its own; every other key is kept from the world under it.
    const pop = input.push({ name: 'playing', solid: true, every: true, key: (code, e) => { if (code === 'Escape' || code === 'KeyE') put(); else if (!e.repeat && it.key(code, true)) downs.add(code); return true }, use: () => true })
    out = { thing: t, it, pop, downs }
    offer.style.display = 'none'
  }
  button.addEventListener('click', () => { if (near) take(near) })
  input.always('KeyE', () => { if (out || !near) return false; take(near); return true })

  return {
    /** The thing's own sound for being struck, if a cell of it is there and its record has one. */
    hit(cell: readonly [number, number, number]): Patch | null { const t = made.at(cell); return (t && of(t)?.hit) || null },
    /** The thing's own sound for coming apart. */
    breaks(cell: readonly [number, number, number]): Patch | null { const t = made.at(cell); return (t && of(t)?.break) || null },
    /** Once a frame: which thing that can be played is in reach, and the keys that have come up. */
    frame(eye: readonly [number, number, number]) {
      if (out) {
        for (const code of out.downs) if (!input.held(code)) { out.downs.delete(code); out.it.key(code, false) }
        const t = out.thing
        if (Math.hypot(t.at[0] - eye[0], t.at[1] + t.size[1] / 2 - eye[1], t.at[2] - eye[2]) > REACH * 2.5) put()
        return
      }
      let best: Thing | null = null, least = REACH
      for (const t of made.all.values()) {
        const far = Math.hypot(t.at[0] - eye[0], t.at[1] + t.size[1] / 2 - eye[1], t.at[2] - eye[2])
        if (far < least && of(t)?.surface) { least = far; best = t }
      }
      if (best !== near) {
        near = best
        offer.style.display = near ? 'block' : 'none'
        // A name is text someone's model wrote: shown as text.
        if (near) button.textContent = `Play the ${near.name.slice(0, 40)} (E)`
      }
    },
    get playing() { return out?.thing.id ?? null },
    get near() { return near?.id ?? null },
    get instrument() { return out?.it ?? null },
    take: (id: string) => { const t = made.all.get(id); if (t) take(t) },
    put,
  }
}
