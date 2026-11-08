// The world-rules panel (#74), a workshop tool kept off any warm product surface (the home
// shows it in dev builds with ?physics=panel only). Every rule's slider comes from rules.ts FIELDS, presets apply
// all at once, a line of text asks for rules in words (the host app supplies `ask`), and each gadget's knobs tune
// live. Returns its removal.
import { FIELDS, PRESETS, ruleKeys, type Rules } from './rules'
import type { Stats, World } from './world'

const CSS = `
.physics-panel { position: fixed; right: 12px; top: 12px; z-index: 40; width: 280px; max-height: calc(100vh - 24px); overflow: auto;
  padding: 10px 12px; border-radius: 8px; background: rgba(36, 28, 22, .9); color: #f1e6d2; font: 12px/1.35 ui-monospace, Menlo, monospace; }
.physics-panel h3 { margin: 10px 0 4px; font-size: 12px; color: #e6b85a; font-weight: 600; }
.physics-panel label { display: grid; grid-template-columns: 92px 1fr 46px; gap: 6px; align-items: center; margin: 2px 0; }
.physics-panel input[type=range] { width: 100%; }
.physics-panel output { text-align: right; }
.physics-panel button { margin: 2px 4px 2px 0; padding: 2px 8px; border-radius: 4px; border: 1px solid #8a6a4a; background: #4a3a2c; color: inherit; font: inherit; cursor: pointer; }
.physics-panel form { display: flex; gap: 4px; }
.physics-panel input[type=text] { flex: 1; min-width: 0; padding: 2px 4px; border-radius: 4px; border: 1px solid #8a6a4a; background: #2a201a; color: inherit; font: inherit; }
.physics-panel .note { color: #cdbb9e; min-height: 1.3em; }
`

/** What asking for rules in words came to: the new rules' note, or why they stayed as they were. */
export type Answer = { ok: true; note: string; clamped: string[] } | { ok: false; why: string; reason?: string }

export function panel(world: World, ask: (text: string) => Promise<Answer>, stats: () => Stats): () => void {
  const root = document.createElement('aside')
  root.className = 'physics-panel'
  root.setAttribute('aria-label', 'World rules')
  const style = document.createElement('style')
  style.textContent = CSS
  const sliders = new Map<string, { input: HTMLInputElement; out: HTMLOutputElement }>()

  const slider = (parent: HTMLElement, name: string, range: { min: number; max: number; step: number }, value: number, set: (v: number) => void) => {
    const label = document.createElement('label')
    const text = document.createElement('span')
    text.textContent = name
    const input = document.createElement('input')
    input.type = 'range'
    input.min = String(range.min)
    input.max = String(range.max)
    input.step = String(range.step)
    input.value = String(value)
    const out = document.createElement('output')
    const digits = range.step < 0.01 ? 3 : 2
    out.textContent = (+value).toFixed(digits)
    input.addEventListener('input', () => {
      out.textContent = (+input.value).toFixed(digits)
      set(+input.value)
    })
    label.append(text, input, out)
    parent.append(label)
    return { input, out }
  }
  const heading = (text: string) => {
    const h = document.createElement('h3')
    h.textContent = text
    root.append(h)
  }

  heading('Presets')
  const presets = document.createElement('div')
  for (const [name, p] of Object.entries(PRESETS)) {
    const b = document.createElement('button')
    b.type = 'button'
    b.textContent = p.label
    b.addEventListener('click', () => world.preset(name))
    presets.append(b)
  }
  const reset = document.createElement('button')
  reset.type = 'button'
  reset.textContent = 'Reset toys'
  reset.addEventListener('click', () => world.reset())
  presets.append(reset)
  root.append(presets)

  heading('Tell the world')
  const form = document.createElement('form')
  const field = document.createElement('input')
  field.type = 'text'
  field.placeholder = 'low gravity, bouncier…'
  const go = document.createElement('button')
  go.textContent = 'Ask'
  form.append(field, go)
  const note = document.createElement('div')
  note.className = 'note'
  form.addEventListener('submit', async (e) => {
    e.preventDefault()
    const text = field.value.trim()
    if (!text) return
    note.textContent = '…'
    const r = await ask(text)
    note.textContent = r.ok ? `${r.note}${r.clamped.length ? ` (clamped: ${r.clamped.join(', ')})` : ''}` : `Unchanged: ${r.why}${r.reason ? `, ${r.reason}` : ''}`
  })
  root.append(form, note)

  heading('Rules')
  // Each slider sends the whole rules object with one field changed: still one atomic change.
  for (const key of ruleKeys()) {
    if (key === 'gravity') {
      for (const [i, axis] of ['x', 'y', 'z'].entries()) {
        sliders.set(`gravity${i}`, slider(root, `gravity ${axis}`, FIELDS.gravity, world.rules.gravity[i], (v) => {
          const g = [...world.rules.gravity] as Rules['gravity']
          g[i] = v
          world.setRules({ gravity: g }, 'panel')
        }))
      }
    } else sliders.set(key, slider(root, key, FIELDS[key], world.rules[key] as number, (v) => world.setRules({ [key]: v }, 'panel')))
  }

  heading('Gadgets')
  for (const g of world.knobs()) {
    const box = document.createElement('div')
    const name = document.createElement('div')
    name.textContent = `${g.id.split('/').pop()} (${g.kind})`
    name.style.color = '#cdbb9e'
    box.append(name)
    for (const [knob, value] of Object.entries(g.knobs)) slider(box, knob, g.ranges[knob], value, (v) => world.setKnob(g.id, knob, v))
    root.append(box)
  }

  const meter = document.createElement('div')
  meter.className = 'note'
  root.append(meter)

  const show = () => {
    const r = world.rules
    for (const key of ruleKeys()) {
      if (key === 'gravity') r.gravity.forEach((v, i) => { const s = sliders.get(`gravity${i}`)!; s.input.value = String(v); s.out.textContent = v.toFixed(2) })
      else { const s = sliders.get(key)!; s.input.value = String(r[key]); s.out.textContent = (r[key] as number).toFixed(2) }
    }
  }
  const tick = setInterval(() => {
    const s = stats()
    meter.textContent = `step ${s.stepMs.median} ms (p95 ${s.stepMs.p95}), ${s.bodies} bodies, ${s.followers} followers`
    show()
  }, 500)
  document.head.append(style)
  document.body.append(root)
  return () => {
    clearInterval(tick)
    root.remove()
    style.remove()
  }
}
