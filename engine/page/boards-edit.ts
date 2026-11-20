// The billboards' editor (#450, `?boards=edit`, served by `node sf/boards.mjs edit`): a panel over the realm to add a
// board on the roof one is looking at, to move, turn and size it where it stands, to say what it shows and where it
// leads, and to save the file (sf/boards.json). Every change is laid in the world at once. Loaded only when asked for:
// a visitor's page never fetches it.
import type { Board, SignsFile } from './boards.ts'
import type { Input } from './input.ts'
import type { View } from './march.ts'

interface Needs {
  records: Board[]
  editing: { add(b: Board): void; change(id: string, to: Partial<Board>): void; remove(id: string): void; file(): SignsFile; save(): Promise<string> }
  propose(count?: number, size?: number): Omit<Board, 'id' | 'name' | 'content' | 'to'>[]
  pick(): Promise<{ t: number } | null>
  view(): View
  feet(x: number, z: number): number
  input: Input
  fly(id: string): void
}

export function panel(o: Needs): { select(id: string): void; readonly selected: string | null } {
  let selected: string | null = o.records[0]?.id ?? null, offers: ReturnType<Needs['propose']> = [], offer = 0
  const box = document.createElement('form')
  box.style.cssText = 'position:fixed;left:12px;top:56px;z-index:40;width:270px;padding:10px 12px;border-radius:10px;background:#10141cee;color:#e8ecf2;font:13px/1.35 system-ui,sans-serif;display:grid;gap:6px;pointer-events:auto'
  box.onsubmit = (e) => e.preventDefault()
  // Letters typed here are letters, not steps (input.ts): a text mode while a field has the focus.
  let typing: (() => void) | null = null
  box.addEventListener('focusin', () => { typing ??= o.input.push({ name: 'boards', solid: true, text: true }) })
  box.addEventListener('focusout', () => { typing?.(); typing = null })
  const said = document.createElement('output')
  said.style.cssText = 'color:#9fd0a8;min-height:1.3em'
  const say = (text: string) => { said.textContent = text }
  const now = () => o.records.find((b) => b.id === selected) ?? null
  /** An element with its properties set. Typed as an input: every one made here is read by its `value`, if at all. */
  const el = (tag: string, props: object = {}, ...kids: (Node | string)[]) => { const e = Object.assign(document.createElement(tag), props) as HTMLInputElement; e.append(...kids); return e }
  const field = (label: string, input: HTMLElement) => { const l = el('label', {}, label, input); l.style.cssText = 'display:grid;grid-template-columns:74px 1fr;gap:6px;align-items:center'; input.style.cssText += ';font:inherit;padding:3px 6px;border-radius:5px;border:1px solid #445;background:#1b2230;color:inherit;min-width:0'; return l }
  const button = (text: string, act: () => unknown, title = '') => { const b = el('button', { type: 'button', textContent: text, title }); b.style.cssText = 'font:inherit;padding:4px 8px;border-radius:6px;border:0;background:#2b3a55;color:#fff;cursor:pointer'; b.onclick = () => void act(); return b }
  const row = (...kids: Node[]) => { const r = el('div', {}, ...kids); r.style.cssText = 'display:flex;gap:4px;flex-wrap:wrap'; return r }
  const set = (to: Partial<Board>) => { if (selected) { o.editing.change(selected, to); if (to.id) selected = to.id; draw() } }
  /** A new board where the eye looks: on the roof there, facing back towards the eye. */
  const here = async (): Promise<Pick<Board, 'building' | 'at' | 'facing'> | null> => {
    const hit = await o.pick(), v = o.view()
    if (!hit) return null
    const x = Math.round(v.eye[0] + v.forward[0] * (hit.t + 8)), z = Math.round(v.eye[2] + v.forward[2] * (hit.t + 8))
    const facing = (Math.abs(v.forward[0]) > Math.abs(v.forward[2]) ? (v.forward[0] > 0 ? 0 : 2) : v.forward[2] > 0 ? 1 : 3) as Board['facing']
    return { building: [x, z], at: [x, o.feet(x, z), z], facing }
  }
  const fresh = (place: Pick<Board, 'building' | 'at' | 'facing'>, more: Partial<Board> = {}) => {
    let n = o.records.length + 1
    while (o.records.some((b) => b.id === `board-${n}`)) n++
    const b: Board = { id: `board-${n}`, name: `Board ${n}`, type: 'lettering', size: 4, content: { text: 'NEW' }, ...place, ...more }
    o.editing.add(b); selected = b.id; draw()
  }
  /** Moves the selected board along its face (`along`), out from it (`out`) or up, in cells. */
  const move = (along: number, out: number, up: number) => {
    const b = now()
    if (!b) return
    const n = [[-1, 0], [0, -1], [1, 0], [0, 1]][b.facing], r = [n[1], -n[0]]
    set({ at: [b.at[0] + r[0] * along + n[0] * out, b.at[1] + up, b.at[2] + r[1] * along + n[1] * out] })
  }
  const draw = () => {
    const b = now()
    const which = el('select', { onchange: () => { selected = which.value; draw() } }, ...o.records.map((r) => el('option', { value: r.id, textContent: `${r.id} (${r.type})`, selected: r.id === selected })))
    const kids: Node[] = [el('strong', { textContent: 'Billboards' }), field('board', which)]
    if (b) {
      const id = el('input', { value: b.id, onchange: () => { const to = id.value.trim(); if (to && !o.records.some((r) => r.id === to)) set({ id: to }) } })
      const name = el('input', { value: b.name, onchange: () => set({ name: name.value }) })
      const type = el('select', { onchange: () => set(type.value === 'digital' ? { type: 'digital', size: [12, 5] } : { type: 'lettering', size: 4, content: 'text' in b.content ? b.content : { text: 'NEW' } }) }, el('option', { value: 'lettering', textContent: 'lettering', selected: b.type === 'lettering' }), el('option', { value: 'digital', textContent: 'digital', selected: b.type === 'digital' }))
      const shows = el('input', { value: 'text' in b.content ? b.content.text.replace(/\n/g, '\\n') : b.content.image, title: 'Words (\\n for a new line), or for a digital board the address of an image', onchange: () => set({ content: b.type === 'digital' && /^(https?:|\/|\.\/|data:)/.test(shows.value) ? { image: shows.value } : { text: shows.value.replace(/\\n/g, '\n') } }) })
      const to = el('input', { value: b.to ?? '', placeholder: '/blog/', onchange: () => set({ to: to.value.trim() || undefined }) })
      const size = el('input', { value: Array.isArray(b.size) ? b.size.join(' x ') : String(b.size), title: 'Lettering: a letter\'s height in metres (4 reads from the park). Digital: wide x high, metres', onchange: () => { const n = size.value.split(/[x, ]+/).map(Number).filter((v) => v > 0); if (b.type === 'digital' ? n.length === 2 : n.length === 1) set({ size: b.type === 'digital' ? [n[0], n[1]] : n[0] }) } })
      const lift = el('input', { value: String(b.lift ?? 1.6), type: 'number', step: '0.8', onchange: () => set({ lift: Number(lift.value) }) })
      kids.push(field('id', id), field('name', name), field('type', type), field('shows', shows), field('leads to', to), field('size, m', size), field('lift, m', lift),
        row(button('←', () => move(-8, 0, 0), 'along its face'), button('→', () => move(8, 0, 0)), button('out', () => move(0, 8, 0), 'towards where it faces'), button('in', () => move(0, -8, 0)), button('↑', () => move(0, 0, 8)), button('↓', () => move(0, 0, -8)), button('turn', () => set({ facing: ((b.facing + 1) % 4) as Board['facing'] }), 'a quarter turn')),
        row(button('here', async () => { const p = await here(); if (p) set(p); else say('nothing ahead to stand it on') }, 'move it to the roof straight ahead'), button('fly to', () => o.fly(b.id)), button('remove', () => { o.editing.remove(b.id); selected = o.records[0]?.id ?? null; draw() })))
    }
    kids.push(row(button('new here', async () => { const p = await here(); if (p) fresh(p); else say('nothing ahead to stand it on') }, 'a board on the roof straight ahead'), button('propose', () => { if (!offers.length) { offers = o.propose(12); offer = 0 } if (!offers.length) return say('no roof found from the park'); fresh(offers[offer++ % offers.length]); say(`roof ${((offer - 1) % offers.length) + 1} of ${offers.length} proposed`) }, 'a board on the next roof the rule proposes'), button('save', async () => say(await o.editing.save()))), said)
    box.replaceChildren(...kids)
  }
  draw()
  document.body.append(box)
  return { select(id) { selected = id; draw() }, get selected() { return selected } }
}
