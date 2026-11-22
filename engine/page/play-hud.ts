// The game's controls in play (#450, issue owner's words of November 21): what is over the picture while someone walks,
// falls and flies, kept off their own body. Three ways to have them, side by side until the owner picks one
// (`?hud=wheel|context|quiet`); with none of them the realm's controls are as they were (realm-ui.ts, explore.ts).
// The rules they follow, and where each came from, are in .agents/skills/game-hud.
//
//   wheel     At rest: the held tool's key and, by touch, the thumb's keys. E (or that key) opens a ring of the tools
//             in the clear sky over the body: a direction of the mouse picks, as do the numbers, the arrows and Enter,
//             a click; holding E and letting it go picks what the mouse points at (moved, with the picture holding it, or hovered). By touch the tools drop as a column
//             from the tool's key, and a slide down it picks. While the picture holds the pointer the corner keys
//             step away; by touch the thumb's keys dim when no thumb has been down for three seconds.
//   context   At rest: what can be done now. On a desk the tools stand in a column down the right edge, and E and the
//             mouse's wheel go to the next; by touch the tool's key does. Nothing hides itself.
//   quiet     At rest: nothing but the picture. While the pointer is held by the picture every control is put away;
//             let go of it (Esc), or touch the screen, and they come back. A tool chosen shows its bank a moment.
//
// In all three: by touch the thumb's keys stand in one column at the right edge, Use in the corner, and the tool's key
// at the top; the stick is not drawn until a thumb is down, and is drawn where that thumb is unless that is over the
// body (the thumb is the mark then). What the help card said comes as a cue beside the body when it is of use: the
// parachute while falling, flying while stood still and never flown. The place's name shows on arrival. Nothing is
// ever laid over the body's parts (`parts()`, which test/sf-hud.mjs reads against every element of the page).
import type { Input } from './input.ts'
import type { Me } from './person.ts'

export const HUDS = ['wheel', 'context', 'quiet'] as const
/** The keys that move the body, let go while a tool is chosen. */
const MOVES = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ShiftLeft', 'ShiftRight', 'Space', 'KeyC', 'ControlLeft', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']
export type HudMode = (typeof HUDS)[number]
export interface Box { left: number; top: number; right: number; bottom: number }
type Kit = { adopt(root?: Element): void; refresh?(el: Element): void }

export interface PlayHud {
  /** Which way the controls are had, or null for the realm's own. */
  readonly mode: HudMode | null
  /** Where the body is on the screen now (CSS px, a box round its every corner, the canopy's too while one is open), or null when it is not seen. */
  body(): Box | null
  /** The same in parts: the figure, and under a canopy its lines and its dome. Nothing may be over any of them. */
  parts(): Box[]
  /** The wheel of tools (wheel only): whether it is open, and opens or closes it. */
  readonly choosing: boolean
  choose(open: boolean): void
}

const STYLE = /* css */ `
#realm[data-hud] .help, #realm[data-hud] .stick { display: none !important; }
#realm .cues { position: absolute; left: 0; top: 0; display: grid; gap: 8px; pointer-events: none !important; }
#realm .cue { --vx: 3px; margin: 0; padding: calc(var(--vx) * 2.5) calc(var(--vx) * 4); font-size: 14px; line-height: 1.3; white-space: nowrap; opacity: 0; translate: -6px 0; transition: opacity 0.25s ease-out, translate 0.35s cubic-bezier(0.23, 1, 0.32, 1); }
#realm .cue.on { opacity: 1; translate: 0 0; }
/* (A cue not shown takes no row: the grid is as tall as what it shows, and is placed by that.) */
#realm .cue:not(.on) { position: absolute; }
#realm .cue kbd { margin-inline-end: 8px; }
/* The floating stick: a well that comes under the thumb. */
#realm .float { position: absolute; left: 0; top: 0; inline-size: 116px; block-size: 116px; margin: -58px 0 0 -58px; pointer-events: none !important; opacity: 0; transition: opacity 0.12s ease-out; }
#realm .float.on { opacity: 1; }
#realm .float .cap { position: absolute; left: 50%; top: 50%; inline-size: 48px; block-size: 48px; margin: -24px 0 0 -24px; min-inline-size: 0; padding: 0; pointer-events: none; }
/* The held tool's key, and the wheel. */
#realm .held { display: none; }
#realm .wheel { position: absolute; inset: 0; pointer-events: none !important; }
#realm .wheel[hidden] { display: none; }
/* The tools' names as the realm's bank has them (realm-ui.ts, typeface.ts): the smaller key size, 5.5 cells before the words and 4 after. */
#realm :is(.wheel .slot, .held, .toolkey) { --vx-key-size: var(--vx-key-small); }
#realm .wheel .slot { position: absolute; left: 0; top: 0; --vx: 3px; min-inline-size: 104px; padding-inline: calc(var(--vx) * 5.5) calc(var(--vx) * 4); pointer-events: auto; white-space: nowrap; }
#realm .wheel .slot .n { margin-inline-end: 6px; color: var(--vx-ink-quiet); }
#realm .wheel .slot.at { --vx-key-tint: var(--vx-enamel); }
@media (pointer: coarse) { #realm .wheel .slot { min-inline-size: 120px; min-block-size: 44px; } }
/* Less motion: things still come and go, at once, and nothing slides (where they are placed is their translate, and is kept). */
@media (prefers-reduced-motion: reduce) { #realm .cue, #realm .float, #realm .wheel .slot, #realm[data-hud] :is(.tools, .act, .act *, .held) { transition: none !important; } #realm .cue { translate: none; } }

/* ── wheel ── */
#realm[data-hud="wheel"] .tools { display: none; }
#realm[data-hud="wheel"] .held { display: flex; position: absolute; right: max(16px, env(safe-area-inset-right)); bottom: max(16px, env(safe-area-inset-bottom)); --vx: 3px; }
#realm .held kbd { margin-inline-end: 6px; }
/* The tool's key owns its slide down the column: the browser is not to take it for a scroll or a zoom (which would cancel it). */
#realm .toolkey { touch-action: none; }

/* ── context: the tools down the right edge ── */
#realm[data-hud="context"] .tools { left: auto; right: max(16px, env(safe-area-inset-right)); bottom: auto; top: 50%; transform: translateY(-50%); }

/* ── quiet: put away while the picture holds the pointer ── */
#realm[data-hud="quiet"] .tools { left: auto; right: max(16px, env(safe-area-inset-right)); bottom: auto; top: 50%; transform: translateY(-50%); transition: opacity 0.3s ease-out; }
html[data-hud].hung #aim { visibility: hidden; }
#realm[data-hud="quiet"]:not(.flash) .tools { opacity: 0; pointer-events: none; }
/* On a desk, with the pointer let go of (Esc), the bank is back with the rest. */
@media (pointer: fine) { html[data-hud="quiet"]:not(.away) #realm[data-hud="quiet"] .tools { opacity: 1; pointer-events: auto; } }
html:is([data-hud="quiet"], [data-hud="wheel"]).away :is(#first .credits, #realm .fold, #realm .sky, #hud) { opacity: 0 !important; pointer-events: none !important; transition: opacity 0.4s ease-out; }
/* (The place's name is not a control: in play it still says where one has come to, and goes.) */
html:is([data-hud="quiet"], [data-hud="wheel"]).away:not(.arrived) #where { opacity: 0 !important; transition: opacity 0.4s ease-out; }
html[data-hud="quiet"] :is(#where, #first .credits, #realm .fold) { transition: opacity 0.25s ease-out; }
/* On a desk the wand's key was under the credits key, both in the bottom left corner: it stands over the place's name. */
@media (pointer: fine) { html[data-hud] [data-panel="wand-take"] { bottom: calc(env(safe-area-inset-bottom, 0px) + 92px); left: max(16px, env(safe-area-inset-left)); } }
/* The place's name says where one has come to, and goes (as a game names a region on arrival). */
html[data-hud] #where { transition: opacity 0.6s ease-out; }
html[data-hud]:not(.arrived) #where { opacity: 0; }

@media (pointer: coarse) {
  /* The thumb's keys, placed one by one in the corner: each mode sets where (--x, --y: the key's middle from the corner, right and up). */
  #realm[data-hud] .act { position: absolute; inset: 0; display: block; pointer-events: none !important; }
  #realm[data-hud] .act .fly { display: contents; }
  #realm[data-hud] .act :is(.use, .up, .down, .walks, .toolkey) { position: absolute; right: calc(env(safe-area-inset-right, 0px) + 14px + var(--x) - var(--w) / 2); bottom: calc(env(safe-area-inset-bottom, 0px) + 12px + var(--y) - var(--h) / 2); inline-size: var(--w); block-size: var(--h); min-inline-size: 0; min-block-size: 0; padding: 0; justify-content: center; pointer-events: auto; --vx: 3px; transition: opacity 0.3s ease-out; }
  #realm[data-hud] .act .use { --vx: 5px; --w: 84px; --h: 84px; --x: 42px; --y: 42px; }
  #realm[data-hud] .act :is(.up, .down, .walks, .toolkey) { --w: 68px; --h: 52px; }
  #realm[data-hud] .act .toolkey { --w: 84px; }
  #realm[data-hud] .act .down[hidden] { display: none; }
  #realm[data-hud="wheel"] .held { display: none; }
  #realm[data-hud="wheel"] .wheel .slot { min-inline-size: 92px; }
  /* Where each key's middle is from the corner (right, up). A key's solid stands up and to the left of its face by half its
     height (the kit's --vx-face-z): Use's by 20 px, the others' by 9; the keys keep that clear of one another. In a fall,
     held upright, the body reaches 240 px across from the left: the keys stand in one column at the right edge, Use in
     the corner under the thumb, and the key that sinks (flying) over them all: beside them it was on the BLOG board from the park (sf-boards). */
  #realm[data-hud] .act .up, #realm[data-hud] .act .walks { --w: 76px; }
  #realm[data-hud] .act .up { --x: 42px; --y: 140px; }
  #realm[data-hud] .act .walks { --x: 42px; --y: 210px; }
  /* The tool's key is a secondary control: at the top, under the sky's key (Apple, Game controls: "Place secondary controls, like menus, at the top"). */
  #realm[data-hud] .act .toolkey { --h: 48px; --w: 92px; --x: 46px; bottom: auto; top: calc(env(safe-area-inset-top, 0px) + 84px); }
  #realm[data-hud].open .act .toolkey { display: none; }
  #realm[data-hud] .act .down { --x: 42px; --y: 280px; }
  #realm[data-hud="context"] .tools { display: none; }
  /* quiet: a smaller Use, faint a moment after the thumbs are lifted. */
  #realm[data-hud="quiet"] .act .use { --vx: 4px; --w: 72px; --h: 72px; --x: 36px; --y: 36px; }
  #realm[data-hud="quiet"] .act .up { --x: 40px; --y: 124px; }
  #realm[data-hud="quiet"] .act .walks { --x: 40px; --y: 194px; }
  #realm[data-hud="quiet"] .act .down { --x: 40px; --y: 264px; }
  #realm[data-hud="quiet"].rest .act :is(.use, .up, .down, .walks, .toolkey) { opacity: 0.22; }
  /* wheel: the keys are kept, dimmed, at rest; the top keys stay (a phone has no Esc to bring them back). */
  #realm[data-hud="wheel"].rest .act :is(.use, .up, .down, .walks, .toolkey) { opacity: 0.45; }
  html[data-hud="wheel"].away :is(#first .credits, #realm .fold) { opacity: 1 !important; pointer-events: auto !important; }
  /* The top keys clear of the Dynamic Island (their solids stand 9 px over their faces), and what was in the bottom left
     corner, where the left thumb steers, under the credits key: the wand's key and the place's name. */
  html[data-hud] #realm .fold { top: calc(env(safe-area-inset-top, 0px) + 20px); }
  html[data-hud] #realm .sky { top: calc(env(safe-area-inset-top, 0px) + 80px); }
  html[data-hud] #first .credits { top: calc(env(safe-area-inset-top, 0px) + 20px); }
  html[data-hud] [data-panel="wand-take"] { bottom: auto; top: calc(env(safe-area-inset-top, 0px) + 76px); left: max(16px, env(safe-area-inset-left)); }
  html[data-hud] #where { bottom: auto !important; top: calc(env(safe-area-inset-top, 0px) + 130px); left: max(16px, env(safe-area-inset-left)) !important; }
}
`

export function playHud(o: {
  ui: { root: HTMLElement; readonly kit: Kit | null }
  me: Me
  input: Input
  /** Where a place in the world (the eye's cells) is on the screen, or null behind the eye. */
  project(at: readonly [number, number, number]): [number, number] | null
  /** The eye's cells to a body's: 1, or more with ?fine. */
  fine: number
  tools: readonly string[]
  tool(): number
  pickTool(i: number): void
  /** Called every frame with the gap since the last, ms. */
  watch(each: (gap: number) => void): void
  /** Whether the visitor is in (the first view is over). */
  engaged(): boolean
}): PlayHud {
  const asked = new URLSearchParams(location.search).get('hud')
  const mode = (HUDS as readonly string[]).includes(asked ?? '') ? (asked as HudMode) : null
  const root = o.ui.root, html = document.documentElement

  /** Boxes round what is drawn of the body (CSS px): the figure, and under a canopy its lines and its dome, each turned as it faces. */
  const parts = (): Box[] => {
    const f = o.me.feet
    if (!f || o.me.view === 'head') return []
    const ax = Math.cos(f.yaw), az = Math.sin(f.yaw), fx = Math.sin(f.yaw), fz = -Math.cos(f.yaw)
    /** A box about the feet (cells: 10 cm): so wide either side, so deep before and behind, from one height to another. */
    const shown = (wide: number, deep: number, lo: number, hi: number): Box | null => {
      let box: Box | null = null
      for (const sw of [-wide, wide]) for (const dy of [lo, hi]) for (const sd of [-deep, deep]) {
        const p = o.project([(f.at[0] + ax * sw + fx * sd) * o.fine, (f.at[1] + dy) * o.fine, (f.at[2] + az * sw + fz * sd) * o.fine])
        if (!p) continue
        box = box ? { left: Math.min(box.left, p[0]), top: Math.min(box.top, p[1]), right: Math.max(box.right, p[0]), bottom: Math.max(box.bottom, p[1]) } : { left: p[0], top: p[1], right: p[0], bottom: p[1] }
      }
      return box
    }
    // Arms and legs out in a fall; under a canopy the arms up to its lines, the lines, and the dome (35 by 25 cells, 3 m up).
    // (Measured against pictures of it: standing it is 0.5 m across, in a fall 1.1 m with its arms out.)
    const boxes = o.me.canopy ? [shown(4, 3, -1, 23), shown(3, 2, 18, 32), shown(18, 12, 33, 47)] : o.me.aloft ? [shown(6, 3, -3, 20)] : [shown(3, 2, -1, 20)]
    return boxes.filter((b): b is Box => !!b)
  }
  const body = (): Box | null => {
    const all = parts()
    return all.length ? all.reduce((a, b) => ({ left: Math.min(a.left, b.left), top: Math.min(a.top, b.top), right: Math.max(a.right, b.right), bottom: Math.max(a.bottom, b.bottom) })) : null
  }
  if (!mode) return { mode, body, parts, choosing: false, choose() {} }

  root.dataset.hud = mode
  html.dataset.hud = mode
  const style = document.createElement('style')
  style.textContent = STYLE
  document.head.append(style)
  const coarse = matchMedia('(pointer: coarse)')
  // (The kit may never come: ?kit=plain, or its import failed. Then what waits for it gives up after a minute, and the plain keys stand.)
  const kitDo = (run: (kit: Kit) => void) => { if (o.ui.kit) { run(o.ui.kit); return } let tries = 0; const wait = setInterval(() => { if (o.ui.kit) { clearInterval(wait); run(o.ui.kit) } else if (++tries > 300) clearInterval(wait) }, 200) }
  const short = (name: string) => name

  // ── The safe area, as the page has it (env() read through a probe) ──
  const probe = document.createElement('div')
  probe.style.cssText = 'position:fixed;inset:0;visibility:hidden;pointer-events:none;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)'
  document.body.append(probe)
  const safe = () => { const s = getComputedStyle(probe); return { top: parseFloat(s.paddingTop) || 0, right: parseFloat(s.paddingRight) || 0, bottom: parseFloat(s.paddingBottom) || 0, left: parseFloat(s.paddingLeft) || 0 } }
  const meets = (a: Box, b: Box) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top

  // ── The cues beside the body ──
  const cues = document.createElement('div')
  cues.className = 'cues'
  cues.setAttribute('role', 'status')
  root.append(cues)
  const cue = (id: string) => {
    const el = document.createElement('p')
    el.className = 'vx-card cue'
    el.dataset.cue = id
    el.innerHTML = '<kbd class="vx-kbd"></kbd><span class="words"></span>'
    cues.append(el)
    return el
  }
  const chute = cue('chute'), fly = cue('fly'), land = cue('land')
  const said = new Map<HTMLElement, string>()
  // (Its words are changed in place: the kit's solid is the element's own, and is drawn again for them.)
  const say = (el: HTMLElement, key: string, words: string) => {
    if (said.get(el) === key + words) return
    said.set(el, key + words)
    el.querySelector('kbd')!.textContent = key
    el.querySelector('.words')!.textContent = words
    // (Adopted once it has words: a keycap built empty has no top to carry its legend.)
    if (!el.hasAttribute('data-vx-live')) o.ui.kit?.adopt(el)
    else { o.ui.kit?.refresh?.(el); o.ui.kit?.refresh?.(el.querySelector('kbd')!) }
  }

  // ── The stick that comes under the thumb ──
  const float = document.createElement('div')
  float.className = 'vx-recess float'
  float.setAttribute('aria-hidden', 'true')
  float.innerHTML = '<span class="vx-button cap" tabindex="-1"></span>'
  root.append(float)
  const cap = float.querySelector<HTMLElement>('.cap')!
  kitDo((k) => k.adopt(float))

  // ── The tool's key: on a desk (wheel) the held tool and its key; by touch, among the thumb's keys ──
  const held = Object.assign(document.createElement('button'), { className: 'vx-button held', type: 'button', innerHTML: '<kbd class="vx-kbd">E</kbd><span class="name"></span>' })
  held.setAttribute('aria-haspopup', 'dialog')
  root.append(held)
  const toolkey = Object.assign(document.createElement('button'), { className: 'vx-button toolkey', type: 'button', innerHTML: '<span class="name"></span>' })
  root.querySelector('.act')?.append(toolkey)
  kitDo((k) => { k.adopt(held); k.adopt(toolkey) })
  const name = (i: number) => o.tools[i] ?? ''
  const next = (step: number) => { const n = o.tools.length; o.pickTool((((o.tool() + step) % n) + n) % n) }

  // ── The wheel ──
  const wheel = document.createElement('div')
  wheel.className = 'wheel'
  wheel.hidden = true
  wheel.setAttribute('role', 'dialog')
  wheel.setAttribute('aria-label', 'Choose a tool')
  wheel.innerHTML = `${o.tools.map((t, i) => `<button class="vx-button slot" type="button" data-i="${i}" aria-keyshortcuts="${i + 1}"><span class="n">${i + 1}</span>${t}</button>`).join('')}`
  root.append(wheel)
  const slots = [...wheel.querySelectorAll<HTMLButtonElement>('.slot')]
  let open = false, at = 0, aim: [number, number] = [0, 0], leave: (() => void) | null = null, openedAt = 0, byHold = false, adopted = false, byKeys = false
  const angleOf = (i: number) => Math.PI / 2 - (i / o.tools.length) * Math.PI * 2
  const point = (i: number) => { at = i; slots.forEach((s, j) => { s.classList.toggle('at', j === i); s.setAttribute('aria-pressed', String(j === o.tool())) }); if (wheel.contains(document.activeElement)) slots[i].focus() }
  /** Picks by a direction (x right, y up): the slot whose angle is nearest. */
  const towards = (x: number, y: number) => { const a = Math.atan2(y, x), n = o.tools.length; let best = 0, gap = 9; for (let i = 0; i < n; i++) { const d = Math.abs(Math.atan2(Math.sin(a - angleOf(i)), Math.cos(a - angleOf(i)))); if (d < gap) { gap = d; best = i } } if (best !== at) point(best) }
  const choose = (on: boolean, pick = false) => {
    if (on === open) return
    // (By touch the sky's panel open hides the tool's key the column hangs from: no wheel until it is folded.)
    if (on && coarse.matches && root.classList.contains('open')) return
    if (!on) {
      if (pick) o.pickTool(at)
      // (The focus was on a tool of the wheel, which is now hidden: it goes back to the key that opened it.)
      const focused = wheel.contains(document.activeElement)
      open = false; wheel.hidden = true; leave?.(); leave = null; held.setAttribute('aria-expanded', 'false')
      // (Back to the key that opened it when the keyboard did; else the keys go back to the world, as realm-ui's do.)
      if (focused && byKeys) held.focus()
      else if (focused) (document.activeElement as HTMLElement).blur()
      byKeys = false
      return
    }
    open = true; openedAt = performance.now(); aim = [0, 0]; point(o.tool()); wheel.hidden = false; held.setAttribute('aria-expanded', 'true')
    if (!adopted) { adopted = true; kitDo((k) => k.adopt(wheel)) }
    // While it is open the keys and the mouse are its own: the body stands, and the mouse points at a tool.
    leave = o.input.push({
      // Every key is its own while it is open (`every`: Enter, B, Q and the rest mean nothing else meanwhile), and a key
      // held down that repeats is not pressed again: holding E to aim must not pick on its first repeat.
      name: 'choosing', solid: true, every: true,
      key(code, e) {
        if (e.repeat) return true
        const d = /^Digit([1-9])$/.exec(code)
        if (d && Number(d[1]) <= o.tools.length) { point(Number(d[1]) - 1); choose(false, true); return true }
        if (code === 'ArrowRight' || code === 'ArrowDown') { point((at + 1) % o.tools.length); return true }
        if (code === 'ArrowLeft' || code === 'ArrowUp') { point((at + o.tools.length - 1) % o.tools.length); return true }
        // (Tab goes round the tools and stays in the wheel: the tool focused is always the one marked, which Enter picks.)
        if (code === 'Tab') { e.preventDefault(); point((at + (e.shiftKey ? o.tools.length - 1 : 1)) % o.tools.length); return true }
        if (code === 'Space') { e.preventDefault(); return true }
        // (Not Space: by touch the key that jumps sends one, and a jump is not a choice.)
        if (code === 'Enter' || code === 'KeyE') { e.preventDefault(); choose(false, true); return true }
        if (code === 'Escape') { choose(false); return true }
        return true
      },
      use() { choose(false, true); return true },
      wheel(dy) { point((at + (dy > 0 ? 1 : o.tools.length - 1)) % o.tools.length); return true },
    })
  }
  slots.forEach((s, i) => { s.addEventListener('click', () => { point(i); choose(false, true) }); s.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') point(i) }) })
  addEventListener('keyup', (e) => { if (e.code === 'KeyE' && open && byHold && performance.now() - openedAt > 280) choose(false, true) })

  // Keys: E opens the wheel (wheel) or goes to the next tool (context, quiet); a vehicle or a thing beside takes E first (its mode is over this one).
  const tools = mode === 'wheel' ? null : root.querySelector<HTMLElement>('.tools')
  // (realm-ui lays the bank along the bottom on a desk; here it stands in a column at the right edge.)
  // (Set every frame it is not so, below: realm-ui lays the bank again when the pointer's kind changes.)
  let flashUntil = 0
  const flash = () => { flashUntil = performance.now() + 1600 }
  o.input.push({
    name: 'tools',
    key(code, e) {
      if (code !== 'KeyE' || e.repeat || !o.engaged()) return false
      if (mode === 'wheel') { byHold = true; choose(true) } else { next(e.shiftKey ? -1 : 1); flash() }
      return true
    },
    // On foot the mouse's wheel goes through the tools (flying, it is still the speed).
    wheel(dy) { if (mode === 'wheel' || !o.me.on) return false; next(dy > 0 ? 1 : -1); flash(); return true },
  })
  // (Opened from the keyboard, a click with no pointer, the focus goes to the tool held, so a reader says where it is.)
  held.addEventListener('click', () => { byHold = false; choose(!open) })
  // Enter on the focused key opens the wheel there, the focus on the tool held: the key has it before the page's own (Enter
  // opens the line to ask on). Space is the world's even here (it jumps, and opens the canopy): the key does not take it.
  // Escape gives the keys back to the world.
  held.addEventListener('keydown', (e) => {
    if (open) return
    if (e.code === 'Space') { e.preventDefault(); return }
    if (e.code === 'Escape') { held.blur(); return }
    if (e.code !== 'Enter') return
    e.preventDefault(); e.stopPropagation()
    if (e.repeat) return
    byHold = false; byKeys = true; choose(true); slots[at].focus()
  })
  // By touch: down on the tool's key opens the wheel; a slide picks by its direction, a tap leaves it open for a tap on a tool.
  let slide: { id: number; x: number; y: number; far: boolean } | null = null
  toolkey.addEventListener('pointerdown', (e) => {
    e.preventDefault()
    if (mode !== 'wheel') { next(1); flash(); return }
    if (open) { choose(false); return }
    toolkey.setPointerCapture(e.pointerId); byHold = false; slide = { id: e.pointerId, x: e.clientX, y: e.clientY, far: false }; choose(true)
  })
  // (The thumb is over a tool of the column, or past its end: the nearest.)
  toolkey.addEventListener('pointermove', (e) => {
    if (!slide || slide.id !== e.pointerId || Math.hypot(e.clientX - slide.x, e.clientY - slide.y) < 22) return
    slide.far = true
    const mids = slots.map((el) => { const r = el.getBoundingClientRect(); return Math.hypot(r.left + r.width / 2 - e.clientX, r.top + r.height / 2 - e.clientY) })
    const near = mids.indexOf(Math.min(...mids))
    if (near !== at) point(near)
  })
  const lift = (e: PointerEvent) => { if (!slide || slide.id !== e.pointerId) return; const far = slide.far; slide = null; if (far) choose(false, true) }
  toolkey.addEventListener('pointerup', lift)
  // (A slide the system took away, a gesture of its own, is no choice: the wheel closes as it was.)
  toolkey.addEventListener('pointercancel', (e) => { if (!slide || slide.id !== e.pointerId) return; slide = null; choose(false) })
  // A press of the page's own that the hand made gives the keys back to the world (as realm-ui does).
  for (const el of [held, toolkey]) el.addEventListener('pointerup', () => setTimeout(() => el.blur()))

  // ── The place's name: shown for a few seconds when it changes (bay.ts writes it) ──
  let arrived = 0
  let placeName = ''
  const named = () => { arrived = performance.now() }
  // (bay.ts writes `street · nearest address` every half second: only another street is an arrival, not the next house number.)
  const street = (el: Element) => (el.textContent ?? '').split('·')[0].trim()
  const watchName = () => { const where = document.getElementById('where'); if (!where) return false; new MutationObserver(() => { const now = street(where); if (now !== placeName) { placeName = now; named() } }).observe(where, { childList: true, characterData: true, subtree: true }); placeName = street(where); return true }
  if (!watchName()) { const wait = setInterval(() => { if (watchName()) clearInterval(wait) }, 500) }

  // ── quiet: the controls are put away while the picture holds the pointer, and by touch a moment after the last touch ──
  // (Idle is no pointer down for three seconds: a thumb steering, or a finger on the hour's fader, is not idle however long it stays.)
  let touched = performance.now()
  const down = new Set<number>()
  addEventListener('pointerdown', (e) => { down.add(e.pointerId); touched = performance.now() }, true)
  for (const t of ['pointerup', 'pointercancel'] as const) addEventListener(t, (e) => { down.delete(e.pointerId); touched = performance.now() }, true)
  const idle = (now: number) => down.size === 0 && now - touched > 3000 && !root.classList.contains('open')

  // ── Every frame ──
  let shownTool = -1, b: Box | null = null, inside = false, stickOver = false, panelWas = false
  const did = { chute: 0, flew: false, landed: 0 }
  let wasOn = true, wasCanopy = false, flyingSince = 0, since = 0, offSince = 0
  const place = (el: HTMLElement, x: number, y: number) => { el.style.translate = `${Math.round(x)}px ${Math.round(y)}px` }
  o.watch(() => {
    if (!o.engaged()) return
    // (Come in: where one is, said once on arrival.)
    if (!inside) { inside = true; named(); since = performance.now(); wasOn = o.me.on }
    if (tools && tools.dataset.vxWay !== 'down') { tools.dataset.vxWay = 'down'; o.ui.kit?.refresh?.(tools) }
    const now = performance.now(), s = safe(), vw = innerWidth, vh = innerHeight, touch = coarse.matches
    b = body()
    const all = parts()
    // The tool's name, on its keys.
    const t = o.tool()
    if (t !== shownTool) {
      shownTool = t
      held.querySelector('.name')!.textContent = name(t)
      held.setAttribute('aria-label', `Tool: ${name(t)}. Choose another (E)`)
      toolkey.querySelector('.name')!.textContent = short(name(t))
      toolkey.setAttribute('aria-label', mode === 'wheel' ? `Tool: ${name(t)}. Hold and slide down to choose another` : `Tool: ${name(t)}. Tap for the next`)
      o.ui.kit?.refresh?.(held); o.ui.kit?.refresh?.(toolkey)
    }
    // What has been done, for the cues.
    if (o.me.canopy && !wasCanopy) did.chute++
    wasCanopy = o.me.canopy
    if (!o.me.on && wasOn) { did.flew = true; flyingSince = now }
    if (o.me.on && !wasOn) did.landed++
    wasOn = o.me.on
    // (Off one's feet for more than half a second is a fall; a hop on a roof is over before then.)
    const off = o.me.on && o.me.aloft && !o.me.canopy
    if (!off) offSince = 0
    else if (!offSince) offSince = now
    const falling = off && now - offSince > 500
    const cueChute = falling && did.chute < 3
    const cueFly = o.me.on && !o.me.aloft && !did.flew && now - since < 60_000
    const cueLand = !o.me.on && did.landed < 2 && now - flyingSince < 6000
    if (cueChute) say(chute, touch ? 'Chute' : 'Space', 'Open the parachute')
    if (cueFly) say(fly, touch ? 'Fly' : 'B', 'Take to the air')
    if (cueLand) say(land, touch ? 'Walk' : 'B', 'Back on your feet')
    // (Not while a tool is being chosen: the wheel has the room then.)
    chute.classList.toggle('on', cueChute && !open); fly.classList.toggle('on', cueFly && !open); land.classList.toggle('on', cueLand && !open)
    // Beside the body, on the side with more room; with no body seen, in the middle a third of the way up.
    if (cueChute || cueFly || cueLand) {
      const w = cues.offsetWidth, h = cues.offsetHeight
      let x: number, y: number
      if (b) {
        const right = vw - s.right - 16 - b.right, left = b.left - s.left - 16
        // (A card's solid stands up and to the left of its face: a gap of 24 px keeps it off the body.)
        if (right >= w + 24 || left >= w + 24) {
          x = right >= w + 24 ? b.right + 24 : b.left - 16 - w
          y = Math.max(s.top + 72, Math.min(vh - s.bottom - h - 120, (b.top + b.bottom) / 2 - h))
        } else { x = (b.left + b.right - w) / 2; y = Math.max(s.top + 140, b.top - h - 24) }
      } else { x = (vw - w) / 2; y = vh * 0.62 }
      x = Math.max(s.left + 12, Math.min(vw - s.right - 12 - w, x))
      // Clear of the keys too: where the card would meet one (by its solid, 12 px up and left), it goes up above them.
      const keys = [...root.querySelectorAll<HTMLElement>('.act .use, .act .up, .act .down, .act .walks, .held')].filter((el) => el.offsetParent).map((el) => el.getBoundingClientRect())
      for (const k of keys) if (x < k.right && x + w > k.left - 12 && y < k.bottom && y + h > k.top - 12) y = Math.min(y, k.top - 12 - h - 12)
      y = Math.max(s.top + 20, y)
      place(cues, x, y)
      // Never over the body, nor in the safe area: where no place was found this frame (the body moving fast, a fall
      // beginning), the cue is not shown until there is one. (Its solid stands 12 px up and to the left of the card.)
      const card: Box = { left: x - 12, top: y - 12, right: x + w, bottom: y + h }
      cues.style.visibility = all.some((p) => meets(card, p)) || card.top < s.top || card.bottom > vh - s.bottom || card.left < s.left || card.right > vw - s.right ? 'hidden' : ''
    }
    // The stick, where the thumb is; not drawn at all where that is over the body (the thumb is the mark then, and the body is seen).
    // (With a margin either way: put away as soon as the body meets it, as the body walks under a thumb that stays; back only
    // when the body is 16 px clear. Decided at the edge itself, it flickered as the body bobbed there.)
    const th = o.input.thumb, r = 62
    const well = (m: number): Box | null => th && { left: th.from[0] - r - m, top: th.from[1] - r - m, right: th.from[0] + r + m, bottom: th.from[1] + r + m }
    const near = (m: number) => { const w = well(m); return !!w && all.some((p) => meets(w, p)) }
    stickOver = !!th && (stickOver ? near(16) : near(0))
    const over = stickOver
    float.classList.toggle('on', !!th && !over)
    if (th && !over) {
      place(float, th.from[0], th.from[1])
      let dx = th.at[0] - th.from[0], dy = th.at[1] - th.from[1]
      const far = Math.hypot(dx, dy)
      if (far > 34) { dx *= 34 / far; dy *= 34 / far }
      cap.style.translate = `${Math.round(dx)}px ${Math.round(dy)}px`
    }
    // By touch, held upright, no ring of seven keys fits clear of the body and the top keys (measured at 390 x 844): the
    // tools drop in a column from the tool's key, along the right edge, and a slide down the column picks.
    // While a tool is chosen the body stands: what is held to move it is let go each frame, before it is read (person.ts).
    // (Keys only: by touch a thumb on the stick still steers, as one moves while changing a weapon in a game on a phone.)
    if (open) for (const code of MOVES) o.input.hold(code, false)
    // The sky's panel opened over the tools: the choice is left as it was. (As it opens: on a desk that came in by no
    // roof, the panel is open from the start, and was found to close the wheel the frame after E opened it.)
    const panelOpen = root.classList.contains('open')
    if (open && panelOpen && !panelWas) choose(false)
    panelWas = panelOpen
    if (open && touch) {
      o.input.turn()
      // Down to the thumb's keys (or the screen's foot), in two columns where one does not fit (a phone on its side).
      const k = toolkey.getBoundingClientRect(), w = slots[0].offsetWidth, h = slots[0].offsetHeight, top = k.bottom + 14
      const under = [...root.querySelectorAll<HTMLElement>('.act .use, .act .up, .act .walks, .act .down')].map((el) => el.getBoundingClientRect().top).filter((y) => y > top)
      const foot = Math.min(vh - s.bottom - 8, ...under.map((y) => y - 24))
      const rows = Math.max(1, Math.min(slots.length, Math.floor((foot - top + 12) / (h + 12)))), gap = rows >= slots.length ? Math.min(17, (foot - top - rows * h) / Math.max(1, rows - 1)) : 12
      // (Each by its own width, to the column's right edge: with the bank's padding the names are not all as wide.)
      const most = Math.max(w, ...slots.map((el) => el.offsetWidth))
      slots.forEach((el, i) => place(el, k.right - el.offsetWidth - Math.floor(i / rows) * (most + 12), top + (i % rows) * (h + gap)))
    }
    // The wheel, in the largest clear room over or beside the body.
    if (open && !touch) {
      // The head is not turned while a tool is chosen: what the mouse moved is the aim's (opened by holding E), or nobody's.
      const [r, u] = o.input.turn()
      if (o.input.locked && byHold) { aim = [Math.max(-0.12, Math.min(0.12, aim[0] + r)), Math.max(-0.12, Math.min(0.12, aim[1] + u))]; if (Math.hypot(aim[0], aim[1]) > 0.035) towards(aim[0], aim[1]) }
      // (A key's solid and its shadow are drawn 6 voxels past its box all round: that is room it takes.)
      const bleed = 18, sw = (slots[0].offsetWidth || 104) + bleed * 2, sh = (slots[0].offsetHeight || 44) + bleed * 2, pad = 8
      const area: Box = { left: s.left + pad, top: s.top + pad, right: vw - s.right - pad, bottom: vh - s.bottom - pad }
      const rooms: Box[] = b ? [{ ...area, bottom: Math.min(area.bottom, b.top - pad) }, { ...area, right: Math.min(area.right, b.left - pad) }, { ...area, left: Math.max(area.left, b.right + pad) }] : [area]
      const fit = (r: Box) => Math.min((r.right - r.left - sw) / 2, (r.bottom - r.top - sh) / 2)
      // Over the head while there is room for it there (the sky, on a roof): else beside the body, where there is more.
      const room = fit(rooms[0]) >= 100 ? rooms[0] : rooms.sort((p, q) => fit(q) - fit(p))[0]
      // (Tight: at 135 px the ring reads as one thing; at 170 its keys were seven things over the city.)
      const radius = Math.max(60, Math.min(135, fit(room)))
      const cx = Math.max(room.left + radius + sw / 2, Math.min(room.right - radius - sw / 2, b ? (b.left + b.right) / 2 : (room.left + room.right) / 2))
      const cy = (room.top + room.bottom) / 2
      slots.forEach((el, i) => place(el, cx + Math.cos(angleOf(i)) * radius - sw / 2 + bleed, cy - Math.sin(angleOf(i)) * radius - sh / 2 + bleed))
    }
    // quiet: away while the picture holds the pointer (a desk) or a while after the last touch; a tool chosen shows its bank.
    if (mode !== 'context') {
      html.classList.toggle('away', touch ? idle(now) : o.input.locked)
      root.classList.toggle('rest', touch && idle(now))
    }
    if (tools) root.classList.toggle('flash', now < flashUntil)
    html.classList.toggle('arrived', now - arrived < 4500)
    // Under the canopy the middle of the picture is the cloth: the aim's dot is put away until the feet are down.
    html.classList.toggle('hung', o.me.canopy)
  })
  return { mode, body, parts, get choosing() { return open }, choose: (on) => { byHold = false; choose(on) } }
}
