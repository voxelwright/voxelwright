// What a realm puts in a person's hands (#264, the HANDS lane): the page's side. The world's rules offer things to
// do (rules/hands.mjs); here each becomes a key and a button, a phone's to touch, and an aimed one an entry the
// wand's wheel turns to. Nothing here knows what any of them means: an offer is an id, a word to show and how it
// is done (tapped or held), and doing one tells the world who did it and which way their eyes looked. What the
// aim met is the world's to find, not the page's: it knows where everyone stands.
//
// What a realm shows (a line, meters, a score, a choice) is drawn here too, in a panel of the page's one layer:
// a rule's own words and numbers, with nothing here that knows a health bar from a lap count.
//
// And holding a thing: a made thing looked at from near enough can be picked up, and what is held put down where
// the eye looks, on a key and a button of the page's own beside the realm's.
//
// The word of an offer, and every word shown, is text a rule wrote (and a rule is text someone or their model wrote): it is shown as
// text, never as markup.
import type { Hud } from './hud.ts'
import { FREE } from './keys.ts'
import type { Input } from './input.ts'
import type { Link, Offer, Shown } from './link.ts'
import type { Thing, Things } from './things.ts'

/** An offer as this page has it: with the key it is on. */
export interface Offered extends Offer { code: string }
export interface Hands {
  /** What is offered to this page, each with its key. */
  readonly offered: readonly Offered[]
  /** Does one: a tap, or a hold's going down or coming up. */
  do(offer: Offer, phase?: 'down' | 'up'): void
  /** Once a frame: a held key that has come up is let go. */
  frame(): void
  /** What is shown to this page. */
  readonly shown: readonly Shown[]
  /** What this page's person holds, or null. */
  readonly holding: Thing | null
  /** The made thing the eye is on, near enough to pick up, or null. */
  readonly reach: Thing | null
  /** Picks a made thing up (by its id), wherever it is. */
  take(id: string): void
  /** Throws what is held the way the eye looks. */
  toss(): void
  /** Puts down what is held: where the eye looks, or at a place. */
  put(at?: readonly [number, number, number]): void
  /** Told whenever what is offered changes. */
  onchange: (() => void) | null
}

/** How near (cells) a thing must be to be picked up, and to put one down: from the person on foot, from the eye when they fly as one. */
const REACH = 45

/**
 * @param made   the made things of this world
 * @param ahead  the first cell the eye meets, and how far off; null for the sky
 */
export function hands(far: Link | null, keys: Input, over: Hud, aim: () => { from: readonly [number, number, number]; to: readonly [number, number, number] }, made: Things | null = null, ahead: () => Promise<{ cell: [number, number, number]; far: number } | null> = async () => null): Hands {
  let offered: Offered[] = []
  /** Holds that are down, by rule and id: a key's, or a finger's. */
  const down = new Map<string, { offer: Offered; key: boolean }>()
  const panel = over.panel('offers')
  const name = (o: Offer) => `${o.rule}/${o.id}`
  const send = (o: Offer, phase: 'down' | 'up') => { const a = aim(); far?.act(o.rule, o.id, phase, a.from, a.to) }
  const press = (o: Offered, key: boolean) => { if (down.has(name(o))) return; down.set(name(o), { offer: o, key }); send(o, 'down'); draw() }
  const lift = (o: Offer) => { if (!down.delete(name(o))) return; send(o, 'up'); draw() }
  // Holding: what this page's person holds, and the thing in reach of the eye.
  let reach: Thing | null = null, looking = false, since = 0
  const holding = () => { if (far && made) for (const t of made.all.values()) if (t.held === far.me) return t; return null }
  const HOLD = 'KeyG', THROW = 'KeyT'
  const grasp = () => { const h = holding(); if (h) self.put(); else if (reach) self.take(reach.id) }
  const draw = () => {
    const h = holding(), own: HTMLElement[] = []
    if (h || reach) {
      const b = document.createElement('button'), k = document.createElement('kbd')
      k.textContent = HOLD.slice(3)
      b.append(k, h ? `Put down ${h.name}` : `Pick up ${reach!.name}`)
      b.dataset.own = h ? 'put' : 'hold'
      b.addEventListener('click', () => { grasp(); b.blur() })
      own.push(b)
    }
    // A full hand can always throw: whether or not a realm offers a throw of its own.
    if (h) {
      const b = document.createElement('button'), k = document.createElement('kbd')
      k.textContent = THROW.slice(3)
      b.append(k, `Throw ${h.name}`)
      b.dataset.own = 'throw'
      b.addEventListener('click', () => { self.toss(); b.blur() })
      own.push(b)
    }
    panel.replaceChildren(...own, ...offered.map((o) => {
      const b = document.createElement('button'), k = document.createElement('kbd')
      k.textContent = o.code.slice(3)
      b.append(k, o.word)
      b.classList.toggle('on', down.has(name(o)))
      b.setAttribute('aria-label', o.word)
      if (o.hold) {
        // Held for as long as the finger or the button is down, wherever it then goes.
        b.addEventListener('pointerdown', (e) => { e.preventDefault(); b.setPointerCapture(e.pointerId); press(o, false) })
        for (const end of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) b.addEventListener(end, () => lift(o))
      } else b.addEventListener('click', () => { send(o, 'down'); b.blur() })
      return b
    }))
    panel.hidden = offered.length === 0 && own.length === 0
  }
  const self: Hands = {
    get offered() { return offered },
    get holding() { return holding() },
    get reach() { return reach },
    take(id) { void far?.ask({ hold: id }) },
    toss() { if (holding()) void far?.ask({ throw: true, to: [...aim().to] }) },
    put(at) {
      if (at) { void far?.ask({ put: true, at: at.map(Math.round) }); return }
      // Where the eye looks, if that is near; else at the feet.
      void ahead().then((met) => far?.ask(met && met.far <= REACH ? { put: true, at: [met.cell[0], met.cell[1] + 1, met.cell[2]] } : { put: true }))
    },
    get shown() { return shown },
    onchange: null,
    do(o, phase) { if (phase === 'up') lift(o); else if (o.hold) { const mine = offered.find((x) => name(x) === name(o)); if (mine) press(mine, false) } else send(o, 'down') },
    frame() {
      for (const { offer, key } of [...down.values()]) if (key && !keys.held(offer.code)) lift(offer)
      // A few times a second, with things in the world and an empty hand: what made thing the eye is on.
      const now = performance.now()
      if (!made || !far || looking || now - since < 250 || !made.all.size) return
      since = now
      if (holding()) { if (reach) { reach = null; draw() } return }
      looking = true
      void ahead().then((met) => { const t = met && met.far <= REACH ? made.at(met.cell) : null; if (t !== reach) { reach = t; draw() } }).finally(() => { looking = false })
    },
  }
  if (far) far.onoffers = (all) => {
    // Those for everyone or for this page; each on the key it asked for if no other offer has it, or the next of the
    // letters the page never listens for (keys.ts).
    const mine = all.filter((o) => o.to === null || o.to.includes(far.me)), taken = new Set<string>()
    const next: Offered[] = []
    for (const o of mine) if (o.key && !taken.has(o.key)) { taken.add(o.key); next.push({ ...o, code: o.key }) } else next.push({ ...o, code: '' })
    for (const o of next) if (!o.code) { o.code = FREE.find((k) => !taken.has(k)) ?? ''; taken.add(o.code) }
    // A hold whose offer is gone is let go of without a word: there is nobody to tell.
    for (const key of [...down.keys()]) if (!next.some((o) => name(o) === key)) down.delete(key)
    offered = next.filter((o) => o.code)
    draw()
    self.onchange?.()
  }
  // What a realm shows: each a card of a line, a score, meters and picks, in the order the rules gave them.
  let shown: Shown[] = []
  const cards = over.panel('shown')
  cards.hidden = true
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text = '') => { const e = document.createElement(tag); e.className = cls; if (text) e.textContent = text; return e }
  if (far) far.onshown = (all) => {
    shown = all.filter((s) => s.to === null || s.to.includes(far.me))
    cards.replaceChildren(...shown.map((s) => {
      const card = el('div', 'card')
      card.dataset.show = `${s.rule}/${s.id}`
      if (s.score) { const score = el('div', 'score'); score.append(el('b', '', s.score.value), el('span', '', s.score.label)); card.append(score) }
      const body = el('div', 'body')
      if (s.line) body.append(el('p', 'line', s.line))
      for (const m of s.meters) {
        const meter = el('div', 'meter'), bar = el('i', ''), fill = el('i', '')
        // How full is a number the world checked, and the colour a pattern it checked: nothing else of a rule's reaches a style.
        fill.style.width = `${Math.round(Math.max(0, Math.min(1, m.full)) * 100)}%`
        if (/^#[0-9a-f]{6}$/.test(m.colour)) fill.style.background = m.colour
        bar.append(fill)
        meter.setAttribute('role', 'meter'); meter.setAttribute('aria-label', m.label); meter.setAttribute('aria-valuenow', String(m.full))
        meter.append(el('span', '', m.label), bar)
        body.append(meter)
      }
      if (s.choice) {
        const picks = el('div', 'picks')
        for (const c of s.choice) { const b = el('button', '', c.word); b.addEventListener('click', () => { far.pick(s.rule, s.id, c.id); b.blur() }); picks.append(b) }
        body.append(picks)
      }
      card.append(body)
      return card
    }))
    cards.hidden = shown.length === 0
  }
  // A key that is offered is the realm's while it is: under the wand's keys, over the page's own.
  keys.push({
    name: 'offered',
    key(code, e) {
      if (code === HOLD && !e.repeat && (holding() || reach)) { grasp(); return true }
      if (code === THROW && !e.repeat && holding()) { self.toss(); return true }
      const o = offered.find((x) => x.code === code)
      if (!o) return false
      if (e.repeat) return true
      if (o.hold) press(o, true); else send(o, 'down')
      return true
    },
  })
  // A thing picked up or put down by anyone changes what the key says.
  made?.on(() => draw())
  draw()
  return self
}
