// A toy made from a sentence (#88), on trial until the person decides, as furnishing does it:
// Keep, Undo or Try another, on a paper tag over the toy. It is built all at once. Undo takes
// that toy out and nothing else: rules, fire, other toys and what it pushed stay as they are. A
// new toy (another ask, or Try another) is built before the one on trial is taken out, so when it
// cannot be built the world is exactly as it was. Kept toys stay for this visit only (a reload
// clears them), at most MAX_KEPT, one to a surface. The tag follows the toy only while shown.
import * as THREE from 'three/webgpu'
import type { Context } from 'cordis'
import type { World } from '../engine/world'
import type { ToySpec } from '../engine/toy'
import { HAND, tagCss } from '../build/sketch'

export type Built = { ok: true; id: string } | { ok: false; reason: string }
/** `on` is the surface's label: one toy to a surface. */
interface Trial { toy: ToySpec; text: string; person: string; note: string; on: string; height: number }

/** Kept toys at most, for the visit: each costs every step while it exists. */
export const MAX_KEPT = 3

const AGAIN = ' (another take: a clearly different design)'

export class MadeToys {
  private trial: Trial | null = null
  private kept: { id: string; on: string }[] = []
  private count = 0
  private tag: HTMLDivElement | null = null
  private busy = false
  private readonly at = new THREE.Vector3()
  /** Set by the ask path: asks again for another take of `text`, and says how it went. */
  again?: (text: string, person: string) => Promise<{ ok: boolean }>

  constructor(private ctx: Context, private world: World) {
    ctx.on('village/frame', () => this.follow())
    ctx.effect(() => () => this.close(), 'made toy tag')
  }

  /** A fresh id for the next made toy. */
  nextId() {
    return `made-${++this.count}`
  }

  /** Why a new toy cannot go on the surface labelled `on`, or null: a kept toy stands there, or the kept toys are at the cap. */
  blocked(on: string): string | null {
    if (this.kept.length >= MAX_KEPT) return `${MAX_KEPT} toys are kept already, as many as the home holds for this visit`
    return this.kept.some((k) => k.on === on) ? `there's already a toy on ${on}` : null
  }

  /**
   * Builds a checked toy, all at once. It goes in before the toy on trial (not kept) comes out, so a
   * toy that cannot be built leaves everything as it was, the one on trial included.
   */
  build(toy: ToySpec, asked: { text: string; person: string; note: string; on: string; height: number }): Built {
    const why = this.blocked(asked.on)
    if (why) return { ok: false, reason: why }
    try {
      this.world.addToy(toy)
    } catch (error) {
      return { ok: false, reason: plainReason(error) }
    }
    // Added and taken out in the same task: no step runs between, so the two never meet.
    if (this.trial) this.world.removeToy(this.trial.toy.id)
    this.trial = { toy, ...asked }
    this.show()
    return { ok: true, id: toy.id }
  }

  keep() {
    if (!this.trial) return false
    this.kept.push({ id: this.trial.toy.id, on: this.trial.on })
    this.trial = null
    this.close()
    return true
  }

  undo() {
    if (!this.trial) return false
    this.world.removeToy(this.trial.toy.id)
    this.trial = null
    this.close()
    return true
  }

  /** Try another: the toy you have stays until the new one is built. */
  async another() {
    const trial = this.trial
    if (!trial || this.busy || !this.again) return null
    this.busy = true
    this.hint('Making another…')
    try {
      const r = await this.again(trial.text.replace(AGAIN, '').slice(0, 300 - AGAIN.length) + AGAIN, trial.person)
      if (this.trial === trial) this.hint(r.ok ? trial.note : "Another one didn't come out, so the one you have is still here.")
      return r
    } finally {
      this.busy = false
      this.render()
    }
  }

  state() {
    return { trial: this.trial ? { id: this.trial.toy.id, label: this.trial.toy.label, on: this.trial.on, parts: this.trial.toy.parts.length, text: this.trial.text } : null, kept: this.kept.map((k) => k.id), keptOn: this.kept.map((k) => k.on), busy: this.busy, tag: this.tag ? this.tag.querySelector('.hint')?.textContent ?? '' : null }
  }

  // ── The tag ──────────────────────────────────────────────────────────────

  private show() {
    if (!this.tag) {
      const style = document.createElement('style')
      style.textContent = css()
      const tag = document.createElement('div')
      tag.className = 'made-tag'
      tag.setAttribute('role', 'dialog')
      tag.append(style)
      for (const [cls, text] of [['title', ''], ['hint', '']]) {
        const el = document.createElement(cls === 'title' ? 'strong' : 'div')
        el.className = cls
        el.textContent = text
        tag.append(el)
      }
      const row = document.createElement('div')
      row.className = 'row'
      for (const [act, label] of [['undo', 'Undo'], ['another', 'Try another'], ['keep', 'Keep']] as const) {
        const b = document.createElement('button')
        b.type = 'button'
        b.dataset.made = act
        b.textContent = label
        b.addEventListener('click', () => void (act === 'keep' ? this.keep() : act === 'undo' ? this.undo() : this.another()))
        row.append(b)
      }
      tag.append(row)
      const visit = document.createElement('div')
      visit.className = 'visit'
      visit.textContent = 'Kept toys stay until the page reloads.'
      tag.append(visit)
      document.body.append(tag)
      this.tag = tag
    }
    this.render()
    this.follow()
  }

  private render() {
    const t = this.trial, tag = this.tag
    if (!t || !tag) return
    tag.querySelector('.title')!.textContent = t.toy.label
    if (!this.busy) this.hint(t.note)
    for (const b of tag.querySelectorAll('button')) b.disabled = this.busy
  }

  private hint(text: string) {
    const el = this.tag?.querySelector('.hint')
    if (el) el.textContent = text
  }

  private close() {
    this.tag?.remove()
    this.tag = null
  }

  /** Over the toy's top, on screen; docked at the bottom when it is off screen. */
  private follow() {
    const t = this.trial, tag = this.tag
    if (!t || !tag) return
    const camera = this.ctx.stage.camera
    const [x, y, z] = t.toy.frame.at
    this.at.set(x, y + t.height, z).project(camera)
    const w = innerWidth, h = innerHeight
    const sx = (this.at.x + 1) / 2 * w, sy = (1 - this.at.y) / 2 * h
    const off = this.at.z > 1 || sx < 0 || sx > w || sy < 0 || sy > h || w < 520
    tag.classList.toggle('docked', off)
    if (off) tag.style.transform = ''
    else {
      const r = tag.getBoundingClientRect()
      const left = Math.min(w - r.width - 12, Math.max(12, sx - r.width / 2))
      const top = Math.max(12, sy - r.height - 18)
      tag.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px) rotate(-0.6deg)`
      tag.style.setProperty('--tail', `${Math.round(Math.min(r.width - 20, Math.max(20, sx - left)))}px`)
    }
  }
}

/** A world refusal in the family's words: the engine names parts by key (`made-1/ramp-2`). */
function plainReason(error: unknown) {
  return String((error as Error)?.message ?? error).replace(/\bmade-\d+\//g, '').replace(/\bmade-\d+: /g, '').slice(0, 160)
}

function css() {
  return `
  .made-tag { position: fixed; left: 0; top: 0; z-index: 40; display: grid; gap: 6px; min-width: 240px; max-width: min(340px, calc(100vw - 24px));
    padding: 14px 18px 12px 20px; font: 600 15px/1.25 ${HAND}; will-change: transform; }
  ${tagCss('.made-tag', '.made-tag button[data-made=keep]', '.made-tag button[data-made=undo], .made-tag button[data-made=another]', ':disabled')}
  .made-tag::after { content: ''; position: absolute; left: var(--tail, 50%); bottom: -8px; width: 16px; height: 16px; margin-left: -8px; rotate: 45deg;
    background: #f4e6cb; border-radius: 0 0 4px 0; box-shadow: 3px 3px 5px rgba(60, 30, 10, 0.12); }
  .made-tag strong { font: 700 20px/1.1 ${HAND}; letter-spacing: 0.01em; position: relative; z-index: 1; }
  .made-tag .hint { font: 500 15px/1.4 ui-rounded, "SF Pro Rounded", system-ui, sans-serif; color: #5e4434; min-height: 1.4em; position: relative; z-index: 1; }
  .made-tag .visit { font: 500 12.5px/1.3 ui-rounded, "SF Pro Rounded", system-ui, sans-serif; color: #8a6d58; text-align: right; position: relative; z-index: 1; }
  .made-tag .row { display: flex; gap: 8px; justify-content: flex-end; margin-top: 4px; position: relative; z-index: 1; }
  .made-tag button[data-made=another] { padding: 0 14px 2px; }
  .made-tag button:disabled { opacity: 0.55; cursor: progress; }
  .made-tag.docked { left: 12px; right: 12px; top: auto; bottom: calc(14px + env(safe-area-inset-bottom)); max-width: none; transform: none !important; rotate: -0.6deg; }
  .made-tag.docked::after { display: none; }
  .made-tag.docked .row button { flex: 1; min-height: 48px; font-size: 18px; }
  `
}
