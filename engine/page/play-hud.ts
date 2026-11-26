// The game's controls in play (#450, issue owner's words of November 21): what is over the picture while someone walks,
// falls and flies, kept off their own body. Three ways to have them, side by side until the owner picks one
// (`?hud=wheel|context|quiet`). The wheel is what a page with no switch has; `?hud=classic` keeps the realm's controls as
// they were before (realm-ui.ts, explore.ts), to compare.
// The rules they follow, and where each came from, are in .agents/skills/game-hud.
//
//   wheel     At rest: the held tool's key and, by touch, the thumb's keys. E (or that key) opens a pie of the tools
//             over the middle of the picture (radial.ts): a tap leaves it open until a wedge is clicked; held, letting
//             go picks the wedge the mouse points at. The numbers, the arrows, Tab and Enter pick too, and Escape
//             leaves it as it was. By touch a tap on the tool's key opens it for a tap on a wedge, and a slide from
//             the key onto a wedge picks where it is let go. While the picture holds the pointer the corner keys
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
import { radial } from './radial.ts'

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
/* Step aside at once while the ask bar, a choice over it (connect offer), the connect panel or the line of the visitor's AI is shown. */
html:has(#choice:not([hidden]), #ask.open, #connect[open], #ai-line:not([hidden])) #realm .cues { visibility: hidden; }
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
/* The pie is over the middle of the picture, over the body too (owner, November 24): only its disc takes the pointer. */
#realm .wheel { z-index: 3; pointer-events: none !important; }
/* The tools' names as the realm's bank has them (realm-ui.ts, typeface.ts): the smaller key size, 5.5 cells before the words and 4 after. */
#realm :is(.held, .toolkey) { --vx-key-size: var(--vx-key-small); }
/* Less motion: things still come and go, at once, and nothing slides (where they are placed is their translate, and is kept). */
@media (prefers-reduced-motion: reduce) { #realm .cue, #realm .float, #realm[data-hud] :is(.tools, .act, .act *, .held) { transition: none !important; } #realm .cue { translate: none; } }

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
html[data-hud].hung #aim, html.choosing #aim { visibility: hidden; }
#realm[data-hud="quiet"]:not(.flash) .tools { opacity: 0; pointer-events: none; }
/* On a desk, with the pointer let go of (Esc), the bank is back with the rest. */
@media (pointer: fine) { html[data-hud="quiet"]:not(.away) #realm[data-hud="quiet"] .tools { opacity: 1; pointer-events: auto; } }
html:is([data-hud="quiet"], [data-hud="wheel"]).away :is(#first .credits, #realm .fold, #realm .sky, #hud) { opacity: 0 !important; pointer-events: none !important; transition: opacity 0.4s ease-out; }
/* (The place's name is not a control: in play it still says where one has come to, and goes.) */
html:is([data-hud="quiet"], [data-hud="wheel"]).away:not(.arrived) #where { opacity: 0 !important; transition: opacity 0.4s ease-out; }
html[data-hud="quiet"] :is(#where, #first .credits, #realm .fold) { transition: opacity 0.25s ease-out; }
/* On a desk the minimap occupies bottom-left once engaged: Credits stands beside it, and the street name & wand key stand above it. */
@media (pointer: fine) {
  html:not(.first) #first .corner { left: calc(max(18px, env(safe-area-inset-left)) + 264px); bottom: max(18px, env(safe-area-inset-bottom)); }
  html:not(.first) #where { bottom: calc(env(safe-area-inset-bottom, 0px) + 186px) !important; }
  html[data-hud] [data-panel="wand-take"] { bottom: calc(env(safe-area-inset-bottom, 0px) + 224px); left: max(18px, env(safe-area-inset-left)); }
}
/* The place's name says where one has come to, and goes (as a game names a region on arrival). */
html[data-hud] #where { transition: opacity 0.6s ease-out; }
html[data-hud]:not(.arrived) #where { opacity: 0; }

/* The line to say something on (eggs.ts) at the top, in the middle: at the bottom it was over the body (by touch realm-ui.ts has it there too). */
@media (pointer: fine) { html[data-hud] #realm .egg-line { bottom: auto !important; top: 20px !important; } }
/* The wand's key (wand.ts puts it in its panel): a kit key as the others are, latched down while the wand is in hand. */
html[data-hud] [data-panel="wand-take"] button.vx-button, html[data-hud] [data-panel="wand-take"] button.vx-button.on { --vx: 3px; --vx-key-size: var(--vx-key-small); padding: 0 calc(var(--vx) * 4) 0 calc(var(--vx) * 5); border-radius: 0; background: none; color: var(--_on); font: 400 var(--vx-key-size)/1 var(--vx-key-font); letter-spacing: 0; }
html[data-hud] [data-panel="wand-take"] .vx-kbd { margin-inline-end: 6px; }
/* With the wheel the wand is chosen among the tools: it has no key of its own. */
html[data-hud="wheel"] [data-panel="wand-take"] { display: none !important; }
/* The wand's bar (what a cast takes, wand.ts) at the top in the middle, under the line to say something on: at the bottom it was over the body. */
html[data-hud] [data-panel="wand"] { bottom: auto; top: max(72px, calc(env(safe-area-inset-top) + 56px)); }

@media (pointer: coarse) {
  /* The thumb's keys, placed one by one in the corner: each mode sets where (--x, --y: the key's middle from the corner, right and up). */
  #realm[data-hud] .act { position: absolute; inset: 0; display: block; pointer-events: none !important; }
  #realm[data-hud] .act .fly { display: contents; }
  #realm[data-hud] .act :is(.use, .up, .down, .walks, .toolkey) { position: absolute; right: calc(env(safe-area-inset-right, 0px) + 14px + var(--x) - var(--w) / 2); bottom: calc(env(safe-area-inset-bottom, 0px) + 12px + var(--y) - var(--h) / 2); inline-size: var(--w); block-size: var(--h); min-inline-size: 0; min-block-size: 0; padding: 0; justify-content: center; pointer-events: auto; --vx: 3px; --vx-key-size: var(--vx-key-small); transition: opacity 0.3s ease-out; }
  /* Sizes by the touch guidance (game-hud rule 16): 44 px a side at the least for a key used often, Use a little more. A
     key's solid stands up and to the left of its face by half its height (the kit's --vx-face-z): Use's by 16 px, the
     others' by 9; the keys keep that clear of one another. */
  #realm[data-hud] .act .use { --vx: 4px; --w: 60px; --h: 60px; --x: 30px; --y: 30px; }
  #realm[data-hud] .act :is(.up, .down, .walks) { --w: 64px; --h: 44px; --x: 32px; }
  /* Held upright, the keys stand in one column at the right edge, Use in the corner under the thumb and the key that
     sinks (flying) over them all: beside them it was on the BLOG board from the park (sf-boards). */
  #realm[data-hud] .act .up { --y: 108px; }
  #realm[data-hud] .act .walks { --y: 171px; }
  #realm[data-hud] .act .down { --y: 234px; }
  #realm[data-hud] .act .down[hidden] { display: none; }
  /* On its side the picture is low: the keys are two by two round the corner, Use in it. */
  @media (orientation: landscape) {
    #realm[data-hud] .act .up { --x: 118px; --y: 22px; }
    #realm[data-hud] .act .walks { --x: 32px; --y: 108px; }
    #realm[data-hud] .act .down { --x: 118px; --y: 108px; }
  }
  /* The tool's key is a secondary control: at the top, under the sky's key (Apple, Game controls: "Place secondary
     controls, like menus, at the top"). While the wheel is open its middle says the tool: the key is not shown twice. */
  #realm[data-hud] .act .toolkey { --h: 44px; --w: 96px; --x: 48px; bottom: auto; top: calc(env(safe-area-inset-top, 0px) + 86px); }
  #realm[data-hud].open .act .toolkey { display: none; }
  #realm[data-hud].choosing .act .toolkey { opacity: 0; }
  /* While the wheel is open the thumb's keys step aside: it is most of the screen's width. */
  #realm[data-hud].choosing .act :is(.use, .up, .down, .walks) { visibility: hidden; }
  #realm[data-hud="wheel"] .held { display: none; }
  /* (By touch the tool's key says the tool: the bank is not shown, nor flashed in quiet, where on its side it stood over the thumb's keys.) */
  #realm:is([data-hud="context"], [data-hud="quiet"]) .tools { display: none; }
  /* quiet: the keys faint a moment after the thumbs are lifted. */
  #realm[data-hud="quiet"].rest .act :is(.use, .up, .down, .walks, .toolkey) { opacity: 0.22; }
  /* wheel: the keys are kept, dimmed, at rest; the top keys stay (a phone has no Esc to bring them back). */
  #realm[data-hud="wheel"].rest .act :is(.use, .up, .down, .walks, .toolkey) { opacity: 0.72; }
  html[data-hud="wheel"].away :is(#first .credits, #realm .fold) { opacity: 1 !important; pointer-events: auto !important; }
  /* The top keys clear of the Dynamic Island (their solids stand 9 px over their faces), as small as the credits key, and
     what was in the bottom left corner, where the left thumb steers, under the credits key: the wand's key and the place's name. */
  html[data-hud] #realm .fold { top: calc(env(safe-area-inset-top, 0px) + 20px); right: max(14px, calc(env(safe-area-inset-right) + 8px)); --vx: 3px; --vx-key-size: var(--vx-key-small); min-inline-size: 64px; min-block-size: 44px; padding: 0; }
  html[data-hud] #realm .sky { top: calc(env(safe-area-inset-top, 0px) + 92px); }
  html[data-hud] #first .corner { top: calc(env(safe-area-inset-top, 0px) + 20px); left: max(22px, calc(env(safe-area-inset-left) + 16px)); }
  html[data-hud] #first .credits { min-block-size: 44px; }
  html[data-hud] [data-panel="wand-take"] { bottom: auto; top: calc(env(safe-area-inset-top, 0px) + 76px); left: max(22px, calc(env(safe-area-inset-left) + 16px)); }
  html[data-hud] [data-panel="wand-take"] button.vx-button { min-block-size: 44px; }
  /* Back to the view, with the wheel by touch: where the wand's key was, under the credits key (in the Sky panel it is
     two taps deep). */
  #realm[data-hud="wheel"] .home-key { position: absolute; top: calc(env(safe-area-inset-top, 0px) + 76px); left: max(22px, calc(env(safe-area-inset-left) + 16px)); --vx: 3px; --vx-key-size: var(--vx-key-small); min-inline-size: 64px; min-block-size: 44px; padding: 0 calc(var(--vx) * 4); }
  html[data-hud] [data-panel="wand-take"] .vx-kbd { display: none; }
  html[data-hud] [data-panel="wand"] { top: calc(env(safe-area-inset-top, 0px) + 200px); }
  /* On its side the picture is low, and the body's middle: the line and the bar at the top, between the top keys. */
  @media (orientation: landscape) { html[data-hud] [data-panel="wand"] { top: 72px; } html[data-hud] #realm .egg-line { top: 20px !important; } }
  /* On its side the panel's foot has three keys and two rows, and under the settings key it ran into the bottom's safe area:
     it opens to the left of that key, from the top, and no wider than leaves the credits key clear. */
  @media (orientation: landscape) { html[data-hud] #realm .sky { top: max(20px, env(safe-area-inset-top)); right: calc(env(safe-area-inset-right, 0px) + 88px); inline-size: min(calc(100vw - 2 * max(12px, env(safe-area-inset-left)) - 24px), 480px); } }
  /* The sky's panel open is a drawer over the picture, a menu: the keys of play and what stands under it step aside
     meanwhile (the settings key folds it again). */
  html[data-hud].drawer :is([data-panel="wand-take"], #where, #realm .home-key, #realm .act :is(.use, .up, .down, .walks, .toolkey)) { visibility: hidden; }
  html[data-hud] #where { bottom: auto !important; top: calc(env(safe-area-inset-top, 0px) + 136px); left: max(16px, env(safe-area-inset-left)) !important; }
  /* Riding (living.ts): the thing's keys are kit keys where the thumb's keys stood, a column on the corner from the bottom up,
     44 px tall (rule 16) and 19 px apart (each solid stands 9 px up and to the left of its face). On its side five keys
     are too tall for the picture: they stand in two columns, the first three on the right. */
  html[data-hud] [data-panel="living"] { right: calc(env(safe-area-inset-right, 0px) + 14px); bottom: calc(env(safe-area-inset-bottom, 0px) + 12px); gap: 19px; }
  html[data-hud] [data-panel="living"] .vx-button { --vx: 3px; --vx-key-size: var(--vx-key-small); min-inline-size: 72px; min-block-size: 44px; padding: 0 calc(var(--vx) * 4); justify-content: center; }
  @media (orientation: landscape) { html[data-hud] [data-panel="living"]:has(> :nth-child(5)) { flex-wrap: wrap-reverse; block-size: calc(3 * 44px + 2 * 19px); inline-size: calc(2 * 96px + 19px); column-gap: 19px; } }
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
  /** The wand (wand.ts), held or not: with the wheel it is chosen as the tools are, the last of them. */
  wand?: { held: boolean }
  /** Back to the view (explore.ts `back`), and whether it can be gone back from here: by touch the wheel has a key for it. */
  back?: { go(): void; can(): boolean }
  /** While riding (living.ts): the corners of the thing ridden (cells), which are kept clear as the body is; none with the eye in the seat. Null on foot. */
  vehicle?: () => readonly (readonly [number, number, number])[] | null
}): PlayHud {
  const asked = new URLSearchParams(location.search).get('hud')
  const mode = asked === 'classic' ? null : (HUDS as readonly string[]).includes(asked ?? '') ? (asked as HudMode) : 'wheel'
  const root = o.ui.root, html = document.documentElement

  /** Boxes round what is drawn of the body (CSS px): the figure, and under a canopy its lines and its dome, each turned as it faces. */
  const parts = (): Box[] => {
    const ridden = o.vehicle?.()
    if (ridden) {
      const seen = ridden.map((c) => o.project(c))
      if (!seen.length || seen.some((p) => !p)) return []
      const xs = seen.map((p) => p![0]), ys = seen.map((p) => p![1])
      return [{ left: Math.min(...xs), top: Math.min(...ys), right: Math.max(...xs), bottom: Math.max(...ys) }]
    }
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
  /** How far a kit part's solid stands up and to the left of its face (half its --vx-face-z, SPEC), and the voxel drawn past it all round, CSS px. */
  const solidOf = (el: HTMLElement) => { if (!el.hasAttribute('data-vx-live')) return { lift: 0, bleed: 0 }; const cs = getComputedStyle(el), vx = parseFloat(cs.getPropertyValue('--vx')) || 4; return { lift: (parseFloat(cs.getPropertyValue('--vx-face-z')) || 0) * 0.5 * vx, bleed: vx } }

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
  const next = (step: number) => { const n = o.tools.length; o.pickTool((((o.tool() + step) % n) + n) % n) }
  // What the wheel chooses from: the tools, and the wand after them (with the wheel it is a tool as they are: Q still
  // takes it up and puts it away). Held, it is what is chosen; any other choice puts it away.
  const WAND = o.wand && mode === 'wheel' ? o.tools.length : -1
  const choices = WAND < 0 ? [...o.tools] : [...o.tools, 'Wand'], n = choices.length
  const current = () => (WAND >= 0 && o.wand!.held ? WAND : o.tool())
  const take = (i: number) => { if (i === WAND) { o.wand!.held = true; return } if (o.wand && WAND >= 0) o.wand.held = false; o.pickTool(i) }
  const name = (i: number) => choices[i] ?? ''

  // ── Back to the view, with the wheel by touch: one tap, where in the Sky panel it is two (a desk has the backquote) ──
  const home = Object.assign(document.createElement('button'), { className: 'vx-button home-key', type: 'button', textContent: 'Back', hidden: true })
  home.setAttribute('aria-label', 'Back to the view')
  home.addEventListener('click', () => o.back?.go())
  if (mode === 'wheel' && o.back) { root.append(home); kitDo((k) => k.adopt(home)) }

  // ── The wand's key: wand.ts makes it in a panel of its own once the wand is ready. Here it becomes a kit key as the
  // others are, latched down while the wand is in hand (wand.ts marks that `on`). ──
  let wandKey: HTMLButtonElement | null = null
  const ridingKeys = new WeakSet<HTMLElement>()
  const wandKeyed = () => {
    const el = wandKey ?? document.querySelector<HTMLButtonElement>('[data-panel="wand-take"] button')
    if (!el) return
    if (!wandKey) {
      wandKey = el
      el.classList.add('vx-button')
      el.querySelector('i')?.replaceWith(Object.assign(document.createElement('kbd'), { className: 'vx-kbd', textContent: 'Q' }))
      kitDo((k) => k.adopt(el))
    }
    const on = String(el.classList.contains('on'))
    if (el.getAttribute('aria-pressed') !== on) el.setAttribute('aria-pressed', on)
  }

  // ── The wheel: a pie over the middle of the picture (radial.ts) ──
  // Opened by E (or a click on the held key, or by touch the tool's key). A tap leaves it open until a wedge is clicked
  // (or Escape, or E again); held, letting go picks the wedge pointed at, and a click while held picks too. A direction
  // points: the mouse's own on a desk (or, while the picture holds the pointer, how far it has moved since the wheel
  // came, shown by a dot), and by touch the finger's over the disc.
  const pie = radial(choices, 'Choose a tool')
  const wheel = pie.el
  wheel.classList.add('wheel')
  root.append(wheel)
  const slots = pie.slots
  let open = false, at = -1, aim: [number, number] = [0, 0], leave: (() => void) | null = null, openedAt = 0, byHold = false, byKeys = false
  /** Where the mouse was when the wheel came (a cursor at rest where the pie appears is no choice), CSS px, and whether it has moved since. */
  let from: [number, number] | null = null, moved = false
  /** How far the mouse may go from the middle while the picture holds it, radians of turn; inside the ring's share of it nothing is marked. */
  const REACH = 0.12, DEAD = REACH * 0.36
  const point = (i: number) => { at = i; pie.mark(i); if (i >= 0 && wheel.contains(document.activeElement)) slots[i].focus() }
  const step = (by: number) => point((((at < 0 ? current() : at) + by) % n + n) % n)
  const choose = (on: boolean, pick = false) => {
    if (on === open) return
    // (By touch the sky's panel open hides the tool's key: no wheel until it is folded.)
    if (on && coarse.matches && root.classList.contains('open')) return
    if (!on) {
      if (pick && at >= 0) take(at)
      // (The focus was on a tool of the wheel, which is now hidden: it goes back to the key that opened it.)
      const focused = wheel.contains(document.activeElement)
      open = false; pie.show(false); at = -1; root.classList.remove('choosing'); html.classList.remove('choosing'); leave?.(); leave = null; held.setAttribute('aria-expanded', 'false')
      // (Back to the key that opened it when the keyboard did; else the keys go back to the world, as realm-ui's do.)
      if (focused && byKeys) held.focus()
      else if (focused) (document.activeElement as HTMLElement).blur()
      byKeys = false
      return
    }
    open = true; openedAt = performance.now(); aim = [0, 0]; from = null; moved = false; at = -1
    pie.held(current()); pie.mark(-1); pie.dot(null); pie.show(true); root.classList.add('choosing'); html.classList.add('choosing'); held.setAttribute('aria-expanded', 'true')
    // While it is open the keys and the mouse are its own: the body stands, and the mouse points at a tool.
    leave = o.input.push({
      // Every key is its own while it is open (`every`: Enter, B, Q and the rest mean nothing else meanwhile), and a key
      // held down that repeats is not pressed again: holding E to aim must not pick on its first repeat.
      name: 'choosing', solid: true, every: true,
      key(code, e) {
        if (e.repeat) return true
        const d = /^Digit([1-9])$/.exec(code)
        if (d && Number(d[1]) <= n) { point(Number(d[1]) - 1); choose(false, true); return true }
        if (code === 'ArrowRight' || code === 'ArrowDown') { step(1); return true }
        if (code === 'ArrowLeft' || code === 'ArrowUp') { step(-1); return true }
        // (Tab goes round the tools and stays in the wheel: the tool focused is always the one marked, which Enter picks.)
        if (code === 'Tab') { e.preventDefault(); step(e.shiftKey ? -1 : 1); return true }
        if (code === 'Space') { e.preventDefault(); return true }
        // (Not Space: by touch the key that jumps sends one, and a jump is not a choice.) E again, or Enter, picks what is
        // marked; with nothing marked it puts the wheel away as it was.
        if (code === 'Enter' || code === 'KeyE') { e.preventDefault(); choose(false, true); return true }
        if (code === 'Escape') { choose(false); return true }
        return true
      },
      // A click while the picture holds the pointer: the wedge pointed at. On none, the wheel stays (it is put away by a choice, Escape or E).
      use() { if (at >= 0) choose(false, true); return true },
      wheel(dy) { step(dy > 0 ? 1 : -1); return true },
    })
  }
  // The mouse, free (no pointer lock): its direction from the middle marks, once it has moved from where it was when the wheel came.
  addEventListener('pointermove', (e) => {
    if (!open || e.pointerType === 'touch' || document.pointerLockElement) return
    if (!from) { from = [e.clientX, e.clientY]; return }
    if (!moved && Math.hypot(e.clientX - from[0], e.clientY - from[1]) < 4) return
    moved = true
    const i = pie.at(e.clientX, e.clientY)
    if (i !== at) point(i)
  })
  // A click or a tap on a wedge picks it where it was pressed: a tap on the tool's key opens the wheel, and the click of
  // that tap is no choice. (A click from the keys has no press, detail 0: the focused slot's own, below.)
  let pressed = -1
  const disc = wheel.querySelector<HTMLElement>('.pie')!
  disc.addEventListener('pointerdown', (e) => { pressed = pie.at(e.clientX, e.clientY, true); if (e.pointerType === 'touch' && pressed >= 0) point(pressed) })
  disc.addEventListener('click', (e) => {
    if (e.detail === 0) return
    const i = pie.at(e.clientX, e.clientY, true), was = pressed
    pressed = -1
    if (i >= 0 && i === was) { point(i); choose(false, true) }
  })
  slots.forEach((s, i) => s.addEventListener('click', (e) => { if (e.detail === 0) { point(i); choose(false, true) } }))
  // By touch, a tap away from the disc (not a thumb that steers: a short touch that stays where it was) puts it away as it was.
  const taps = new Map<number, { x: number; y: number; t: number }>()
  addEventListener('pointerdown', (e) => { if (open && e.pointerType === 'touch' && !disc.contains(e.target as Node) && e.target !== toolkey) taps.set(e.pointerId, { x: e.clientX, y: e.clientY, t: performance.now() }) }, true)
  addEventListener('pointerup', (e) => { const t = taps.get(e.pointerId); taps.delete(e.pointerId); if (open && t && performance.now() - t.t < 350 && Math.hypot(e.clientX - t.x, e.clientY - t.y) < 12) choose(false) }, true)
  addEventListener('pointercancel', (e) => taps.delete(e.pointerId), true)
  // E let go: held and pointed, that is the choice; held a while and pointed at nothing, put away as it was; a tap leaves it open.
  addEventListener('keyup', (e) => {
    if (e.code !== 'KeyE' || !open || !byHold) return
    if (at >= 0) choose(false, true)
    else if (performance.now() - openedAt > 280) choose(false)
    else byHold = false
  })

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
    byHold = false; byKeys = true; choose(true); point(current()); slots[at].focus()
  })
  // By touch: down on the tool's key opens the wheel; a slide onto a wedge and let go picks it, a tap leaves it open for a tap on one.
  let slide: { id: number; x: number; y: number; far: boolean } | null = null
  toolkey.addEventListener('pointerdown', (e) => {
    e.preventDefault()
    if (mode !== 'wheel') { next(1); flash(); return }
    if (open) { choose(false); return }
    toolkey.setPointerCapture(e.pointerId); byHold = false; slide = { id: e.pointerId, x: e.clientX, y: e.clientY, far: false }; choose(true)
  })
  // (Over the disc only: the key is off to one side of it, and a twitch of the finger there is no direction.)
  toolkey.addEventListener('pointermove', (e) => {
    if (!slide || slide.id !== e.pointerId || (!slide.far && Math.hypot(e.clientX - slide.x, e.clientY - slide.y) < 22)) return
    slide.far = true
    const i = pie.at(e.clientX, e.clientY, true)
    if (i !== at) point(i)
  })
  const lift = (e: PointerEvent) => { if (!slide || slide.id !== e.pointerId) return; const far = slide.far; slide = null; if (far) choose(false, at >= 0) }
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
    // (Back in the first view, the key goes with the rest: asked before the frame is left to it.)
    const homeShown = coarse.matches && o.engaged() && !!o.back?.can()
    if (home.hidden === homeShown) { home.hidden = !homeShown; if (homeShown) o.ui.kit?.refresh?.(home) }
    if (!o.engaged()) return
    wandKeyed()
    // The keys of a thing ridden (living.ts makes them each time one is got on): kit keys as the others are, once shown.
    if (coarse.matches) for (const el of document.querySelectorAll<HTMLElement>('[data-panel="living"] .vx-button')) if (!ridingKeys.has(el)) { ridingKeys.add(el); kitDo((k) => k.adopt(el)) }
    // (Come in: where one is, said once on arrival.)
    if (!inside) { inside = true; named(); since = performance.now(); wasOn = o.me.on }
    if (tools && tools.dataset.vxWay !== 'down') { tools.dataset.vxWay = 'down'; o.ui.kit?.refresh?.(tools) }
    const now = performance.now(), s = safe(), vw = innerWidth, vh = innerHeight, touch = coarse.matches
    b = body()
    const all = parts()
    // The tool's name, on its keys.
    const t = current()
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
    // (Riding takes the body off its feet and puts it down again: that is neither a flight nor a landing.)
    if (o.vehicle?.()) wasOn = true
    else {
      if (!o.me.on && wasOn) { did.flew = true; flyingSince = now }
      if (o.me.on && !wasOn) did.landed++
      wasOn = o.me.on
    }
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
    // (Nor, by touch, while the sky's panel is open: it is a drawer over the picture's middle then, and the cue would be on it.)
    // (Nor while the line to say something on, the ask bar, an offer over it, the connect panel or the line of the visitor's AI is shown.)
    const drawer = touch && root.classList.contains('open'), free = !open && !drawer && !root.querySelector('.egg-line:not([hidden])') && !document.querySelector('#choice:not([hidden]), #ask.open, #connect[open], #ai-line:not([hidden])')
    html.classList.toggle('drawer', drawer)
    chute.classList.toggle('on', cueChute && free); fly.classList.toggle('on', cueFly && free); land.classList.toggle('on', cueLand && free)
    // Beside the body, on the side with more room; with no body seen, in the middle a third of the way up.
    if (cueChute || cueFly || cueLand) {
      const w = cues.offsetWidth, h = cues.offsetHeight
      // (A card's solid stands up and to the left of its face, and a voxel past it all round: measured, as the check does.)
      const shown = [chute, fly, land].find((el) => el.classList.contains('on')) ?? fly, { lift, bleed } = solidOf(shown), up = lift + bleed, gap = 12
      let x: number, y: number
      if (b) {
        const right = vw - s.right - 16 - b.right, left = b.left - s.left - 16
        const room = w + up + bleed + gap
        if (right >= room || left >= room) {
          x = right >= room ? b.right + up + gap : b.left - bleed - gap - w
          y = Math.max(s.top + 72, Math.min(vh - s.bottom - h - 120, (b.top + b.bottom) / 2 - h))
        } else { x = (b.left + b.right - w) / 2; y = Math.max(s.top + 140, b.top - h - bleed - gap) }
      } else { x = (vw - w) / 2; y = vh * 0.62 }
      x = Math.max(s.left + 12 + up, Math.min(vw - s.right - 12 - w - bleed, x))
      // Clear of the keys too: where the card would meet one (by the solids of both), it goes up above them.
      const keys = [...root.querySelectorAll<HTMLElement>('.act .use, .act .up, .act .down, .act .walks, .held'), ...document.querySelectorAll<HTMLElement>('#minimap')].filter((el) => el.offsetParent).map((el) => { const r = el.getBoundingClientRect(), k = solidOf(el); return { left: r.left - k.lift - k.bleed, top: r.top - k.lift - k.bleed, right: r.right + k.bleed, bottom: r.bottom + k.bleed } })
      for (const k of keys) if (x - up < k.right && x + w + bleed > k.left && y - up < k.bottom && y + h + bleed > k.top) y = Math.min(y, k.top - gap - h - bleed)
      y = Math.max(s.top + 20 + up, y)
      place(cues, x, y)
      // Never over the body, nor in the safe area: where no place was found this frame (the body moving fast, a fall
      // beginning), the cue is not shown until there is one.
      const card: Box = { left: x - up, top: y - up, right: x + w + bleed, bottom: y + h + bleed }
      // (With a margin of 12 px round the body: in a fall it is somewhere else by the next frame.)
      cues.style.visibility = all.some((p) => meets(card, { left: p.left - 12, top: p.top - 12, right: p.right + 12, bottom: p.bottom + 12 })) || card.top < s.top || card.bottom > vh - s.bottom || card.left < s.left || card.right > vw - s.right ? 'hidden' : ''
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
    // tools hang in a column from where the tool's key is (it is not shown meanwhile), along the right edge, and a slide
    // down the column picks. While a tool is chosen the body stands: what is held to move it is let go each frame, before
    // it is read (person.ts). (Keys only: by touch a thumb on the stick still steers, as one moves while changing a weapon
    // in a game on a phone.)
    if (open) for (const code of MOVES) o.input.hold(code, false)
    // The sky's panel opened over the tools: the choice is left as it was. (As it opens: on a desk that came in by no
    // roof, the panel is open from the start, and was found to close the wheel the frame after E opened it.)
    const panelOpen = root.classList.contains('open')
    if (open && panelOpen && !panelWas) choose(false)
    panelWas = panelOpen
    // The head is not turned while a tool is chosen. With the picture holding the pointer, what the mouse moved is the
    // wheel's: a direction from the middle, kept within reach, shown by a dot (inside the ring nothing is marked).
    if (open) {
      const [r, u] = o.input.turn()
      if (!touch && o.input.locked) {
        aim = [aim[0] + r, aim[1] - u]
        const far = Math.hypot(aim[0], aim[1])
        if (far > REACH) aim = [(aim[0] * REACH) / far, (aim[1] * REACH) / far]
        if (far > DEAD * 0.4) { pie.dot([(aim[0] / REACH) * 0.94, (aim[1] / REACH) * 0.94]); const i = pie.towards(aim[0], aim[1], DEAD); if (i !== at) point(i) }
      }
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
