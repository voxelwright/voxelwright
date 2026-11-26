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
import { radial, TOOL_ICONS } from './radial.ts'

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

const JUMP_SVG = '<svg class="hud-ic ic-jump" viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 15V5"/><path d="M5.5 9.5L10 5l4.5 4.5"/></svg>'
const CHUTE_SVG = '<svg class="hud-ic ic-chute" viewBox="0 0 20 20" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 10.5a7 7 0 0 1 14 0H3z"/><path d="M4.5 10.5L10 16.5l5.5-6"/><path d="M10 10.5v6"/></svg>'
const FLY_SVG = '<svg class="hud-ic ic-fly" viewBox="0 0 20 20" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 13c2.5-5 6-7.5 15-8-1.8 4.2-4.8 7-9.2 7.5"/><path d="M7.5 12.5L5 16.5"/></svg>'
const WALK_SVG = '<svg class="hud-ic ic-walk" viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 4.5v10.5"/><path d="M5.5 10.5L10 15l4.5-4.5"/><path d="M5 17.5h10"/></svg>'
const DOWN_SVG = '<svg class="hud-ic" viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 5v10"/><path d="M5.5 10.5L10 15l4.5-4.5"/></svg>'
const DRIVE_ICONS: Record<string, string> = {
  drift: '<svg class="hud-ic" viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 15.5c1.5-5 4.5-7 11-7"/><path d="M12.5 5.5L15.5 8.5 12.5 11.5"/><path d="M4.5 11.5c1-2.5 2.8-4 5.5-4.5" opacity="0.55"/></svg>',
  horn: '<svg class="hud-ic" viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 8.5h3.2L12 5v10l-5.3-3.5H3.5z"/><path d="M15 7.5a3.5 3.5 0 0 1 0 5"/><path d="M17 5.5a6.5 6.5 0 0 1 0 9" opacity="0.6"/></svg>',
  cam: '<svg class="hud-ic" viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2.5" y="6" width="10.5" height="8" rx="1.5"/><path d="M13 8.8l4.5-2.3v7L13 11.2z"/></svg>',
  seat: '<svg class="hud-ic" viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="10" cy="10" r="6.5"/><circle cx="10" cy="10" r="1.6"/><path d="M4 9.5h4.4M11.6 9.5H16M10 11.6V16"/></svg>',
  leave: '<svg class="hud-ic" viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 4H4.5v12H8"/><path d="M10 10h6.5"/><path d="M13.5 7l3 3-3 3"/></svg>',
  radio: '<svg class="hud-ic" viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="7" width="14" height="9" rx="1.5"/><path d="M6 7l7-3.5"/><circle cx="7.5" cy="11.5" r="2"/><path d="M12 10h2.5M12 13h2.5"/></svg>',
  lights: '<svg class="hud-ic" viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9.5 6a4 4 0 0 0 0 8H11V6H9.5z"/><path d="M13.5 7l3.5-1M13.5 10H17.5M13.5 13l3.5 1"/></svg>',
  rear: '<svg class="hud-ic" viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5.5 8.5L3 11l2.5 2.5"/><path d="M3.5 11h9a3.5 3.5 0 0 0 0-7H9"/></svg>',
  boost: '<svg class="hud-ic" viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 2.5L4.5 11h5l-1 6.5L15.5 9h-5l.5-6.5z"/></svg>',
}
const toolSvg = (toolName: string) => {
  const path = TOOL_ICONS[toolName]
  return path
    ? `<svg class="tool-ic" viewBox="0 0 64 32" aria-hidden="true">${path}</svg>`
    : `<span class="tool-glyph" aria-hidden="true">${toolName.slice(0, 1).toUpperCase()}</span>`
}

const STYLE = /* css */ `
/* ── Voxelmorphism v1 "slim" look for live gameplay HUD (First View stays on classic "lit" look) ── */
html:not(.first)[data-hud] :is(#realm, #over, #lobby-tag) {
  --vx-look: slim;
  --vx-ink: #f0f4fa;
  --vx-ink-quiet: #9eb0ca;
  --lit-legend: #f0f4fa;
  --vx-on-enamel: #ffffff;
  --vx-danger-text: #ff7e70;
  --vx-danger-legend: #ff8e80;
  --vx-key: #242d3e;
  --vx-chalk: #1a2130;
  --vx-chalk-top: #37445a;
  --vx-chalk-side: #111620;
  --vx-slate: #151c28;
  --vx-floor: #111620;
  --vx-steel: #4e5d75;
  --vx-enamel: #2154e4;
  --vx-enamel-top: #4b79ff;
  --vx-enamel-side: #173bb0;
  --hud-font: "IBM Plex Sans", -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
}

/* Fine 2px voxel pitch for sleek low-profile in-play keys; 3px for the Settings enclosure. */
html:not(.first)[data-hud] #realm :is(.fold, .lobbies, .home-key, .held, .toolkey, .act .vx-button, .cue, .float, .float .cap),
html:not(.first)[data-hud] #lobby-tag,
html:not(.first)[data-hud] #ask-row .ask-voxel,
html:not(.first)[data-hud] [data-panel="living"] .vx-button,
html:not(.first)[data-hud] [data-panel="wand-take"] .vx-button {
  --vx: 2px;
}
html:not(.first)[data-hud] #realm .sky {
  --vx: 3px;
  border-top: 0;
  --vx-key-size: 13px;
}

/* In play, Credits moves into the Settings panel header and Mapillary attribution sits cleanly inside #minimap. */
html:not(.first)[data-hud] #first .corner { display: none !important; }
/* While the Settings panel or radial pie wheel is open, hide overlapping corner chrome cleanly. */
html:not(.first)[data-hud]:has(#realm.open) :is(#ask:not(.open), #realm .held),
html:not(.first)[data-hud].choosing #ask:not(.open) { visibility: hidden !important; }

#realm[data-hud] .help, #realm[data-hud] .stick { display: none !important; }

/* ── Shared crisp typography & surface polish for slim voxel buttons ── */
html:not(.first)[data-hud] #realm :is(.fold, .lobbies, .home-key, .held, .toolkey, .act .vx-button),
html:not(.first)[data-hud] #lobby-tag,
html:not(.first)[data-hud] [data-panel="living"] .vx-button,
html:not(.first)[data-hud] [data-panel="wand-take"] .vx-button {
  font: 600 12.5px/1 var(--hud-font);
  letter-spacing: 0.015em;
  color: var(--lit-legend);
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.45);
  transition: opacity 0.25s ease-out;
}
html:not(.first)[data-hud] #realm .act .use,
html:not(.first)[data-hud] #realm .act .up.chute {
  color: #ffffff;
}

/* Settings gear button in play: crisp low-profile slim voxel key with inlaid pearl-ivory gear relief. */
html:not(.first)[data-hud] #realm .fold {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  top: max(18px, env(safe-area-inset-top));
  right: max(18px, env(safe-area-inset-right));
  inline-size: 40px;
  block-size: 40px;
  min-inline-size: 40px;
  min-block-size: 40px;
  padding: 0;
}
html:not(.first)[data-hud] #realm.folds .sky { top: calc(max(18px, env(safe-area-inset-top)) + 52px); right: max(18px, env(safe-area-inset-right)); }

/* Servers / active lobby badge in play: slim voxel key at top-left. */
html:not(.first)[data-hud] #realm .lobbies,
html:not(.first)[data-hud] #lobby-tag {
  top: max(18px, env(safe-area-inset-top));
  left: max(18px, env(safe-area-inset-left));
  display: inline-flex;
  align-items: center;
  gap: 8px;
  block-size: 38px;
  min-block-size: 38px;
  padding: 0 14px;
}
html:not(.first)[data-hud]:has(#realm .lobbies, #lobby-tag) #card { top: calc(max(18px, env(safe-area-inset-top)) + 50px); }

/* ── Contextual cues: slim 2-course smoked voxel card with miniature voxel keycap ── */
#realm .cues { position: absolute; left: 0; top: 0; display: grid; gap: 6px; pointer-events: none !important; }
html:has(#choice:not([hidden]), #ask.open, #connect[open], #ai-line:not([hidden])) #realm .cues { visibility: hidden; }
#realm .cue {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  padding: 6px 12px 6px 10px;
  border-top: 0;
  color: var(--vx-ink);
  font: 500 12.5px/1.2 var(--hud-font);
  white-space: nowrap;
  opacity: 0;
  translate: -4px 0;
  transition: opacity 0.25s ease-out, translate 0.3s cubic-bezier(0.23, 1, 0.32, 1);
}
#realm .cue.on { opacity: 1; translate: 0 0; }
#realm .cue:not(.on) { position: absolute; }
#realm .cue .vx-kbd {
  --vx: 2px;
  min-inline-size: 20px;
  min-block-size: 20px;
  padding: 0 6px;
  font: 600 11px/1 var(--vx-mono);
  color: #f4f7fc;
}

/* ── Floating hollow stepped octagonal voxel thumbstick gimbal + sculpted concave voxel cap ── */
#realm .float {
  position: absolute;
  left: 0;
  top: 0;
  inline-size: 108px;
  block-size: 108px;
  margin: -54px 0 0 -54px;
  background: none;
  box-shadow: none;
  pointer-events: none !important;
  opacity: 0;
  transition: opacity 0.12s ease-out;
}
#realm .float.on { opacity: 1; }
#realm .float .cap {
  position: absolute;
  left: 50%;
  top: 50%;
  inline-size: 40px;
  block-size: 40px;
  margin: -20px 0 0 -20px;
  min-inline-size: 0;
  min-block-size: 0;
  padding: 0;
  pointer-events: none;
}

/* ── Held tool slim voxel key (desktop bottom-right) & pie wheel ── */
#realm .held { display: none; }
#realm .wheel { z-index: 3; pointer-events: none !important; }
#realm .tool-ic { inline-size: 24px; block-size: 12px; fill: currentColor; flex: none; opacity: 0.94; }
#realm .tool-glyph { display: inline-grid; place-items: center; inline-size: 18px; block-size: 18px; border-radius: 3px; border: 1.5px solid currentColor; font-size: 10px; flex: none; }

@media (prefers-reduced-motion: reduce) {
  #realm .cue, #realm .float, #realm[data-hud] :is(.tools, .act, .act *, .held, .fold, .home-key) { transition: none !important; }
  #realm .cue { translate: none; }
}

/* ── wheel ── */
#realm[data-hud="wheel"] .tools { display: none; }
html:not(.first)[data-hud="wheel"] #realm .held {
  display: inline-flex;
  align-items: center;
  position: absolute;
  right: max(18px, env(safe-area-inset-right));
  bottom: max(18px, env(safe-area-inset-bottom));
  block-size: 40px;
  min-block-size: 40px;
  padding: 0 14px 0 10px;
}
html:not(.first)[data-hud="wheel"] #realm .held .vx-label { gap: 8px; }
html:not(.first)[data-hud="wheel"].away #realm .held { opacity: 0.78; }
#realm .held .vx-kbd {
  --vx: 2px;
  min-inline-size: 20px;
  min-block-size: 20px;
  padding: 0 5px;
  font: 600 11px/1 var(--vx-mono);
  color: #f4f7fc;
}
#realm .toolkey { touch-action: none; }

/* ── context & quiet ── */
#realm[data-hud="context"] .tools { left: auto; right: max(16px, env(safe-area-inset-right)); bottom: auto; top: 50%; transform: translateY(-50%); }
#realm[data-hud="quiet"] .tools { left: auto; right: max(16px, env(safe-area-inset-right)); bottom: auto; top: 50%; transform: translateY(-50%); transition: opacity 0.3s ease-out; }
html[data-hud].hung #aim, html.choosing #aim, html.drawer #aim, html:has(#ask.open) #aim { visibility: hidden; }
#realm[data-hud="quiet"]:not(.flash) .tools { opacity: 0; pointer-events: none; }
@media (pointer: fine) { html[data-hud="quiet"]:not(.away) #realm[data-hud="quiet"] .tools { opacity: 1; pointer-events: auto; } }

/* Active play fade (pointer locked on desktop): fade secondary chrome so San Francisco fills the screen. */
html:is([data-hud="quiet"], [data-hud="wheel"]).away :is(#first .credits, #realm .fold, #realm .sky, #hud) { opacity: 0 !important; pointer-events: none !important; transition: opacity 0.35s ease-out; }
html:is([data-hud="quiet"], [data-hud="wheel"]).away #ask:not(.open) { opacity: 0 !important; pointer-events: none !important; }
html:is([data-hud="quiet"], [data-hud="wheel"]).away:not(.arrived) #where { opacity: 0 !important; transition: opacity 0.4s ease-out; }
html[data-hud="quiet"] :is(#where, #first .credits, #realm .fold) { transition: opacity 0.25s ease-out; }

/* ── Collapsed Ask trigger: real slim voxel keycap behind ✦ Make ↵ (desktop) and ✦ (mobile) ── */
html:not(.first)[data-hud] #ask:not(.open) #ask-row {
  position: relative;
  background: transparent;
  border-color: transparent;
  box-shadow: none;
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
}
html:not(.first)[data-hud] #ask:not(.open) #ask-row > :not(.ask-voxel) { position: relative; z-index: 1; }
html:not(.first)[data-hud] #ask:not(.open) #ask-row .ask-voxel {
  display: block;
  position: absolute;
  inset: 0;
  min-inline-size: 0;
  min-block-size: 0;
  padding: 0;
  pointer-events: none;
  z-index: 0;
}
html:not(.first)[data-hud] #ask.open #ask-row .ask-voxel { display: none; }

@media (pointer: fine) {
  html:not(.first)[data-hud] #ask:not(.open) {
    left: auto;
    right: max(18px, env(safe-area-inset-right));
    bottom: calc(max(18px, env(safe-area-inset-bottom)) + 48px);
    transform: none;
    width: auto;
  }
  html:not(.first)[data-hud] #ask:not(.open) #ask-row {
    gap: 4px;
    padding: 4px 8px 4px 10px;
    block-size: 36px;
    box-sizing: border-box;
  }
  html:not(.first)[data-hud] #ask:not(.open) #line {
    width: 46px;
    flex: none;
    padding: 0 2px;
    font-size: 12.5px;
    font-weight: 600;
    cursor: pointer;
  }
  html:not(.first)[data-hud] #ask:not(.open) :is(#ask-picture, #ask-camera, #ask-which) { display: none; }
  html:not(.first) #where { bottom: calc(env(safe-area-inset-bottom, 0px) + 176px) !important; left: max(20px, env(safe-area-inset-left)) !important; font-size: 13px !important; letter-spacing: 0.01em; }
  html[data-hud] [data-panel="wand-take"] { bottom: calc(env(safe-area-inset-bottom, 0px) + 206px); left: max(18px, env(safe-area-inset-left)); }
}

/* Street name: appears smoothly on arrival and fades out cleanly. */
html[data-hud] #where { transition: opacity 0.55s ease-out; }
html[data-hud]:not(.arrived) #where { opacity: 0; }

/* The line to say something on (eggs.ts) at the top, in the middle. */
@media (pointer: fine) { html[data-hud] #realm .egg-line { bottom: auto !important; top: 20px !important; } }

/* The wand's key (non-wheel modes) & wand bar. */
html:not(.first)[data-hud] [data-panel="wand-take"] button.vx-button { display: inline-flex; align-items: center; gap: 6px; block-size: 38px; min-block-size: 38px; padding: 0 12px; }
html[data-hud="wheel"] [data-panel="wand-take"] { display: none !important; }
html[data-hud] [data-panel="wand"] { bottom: auto; top: max(68px, calc(env(safe-area-inset-top) + 56px)); }

/* ── Mobile / Touch layout: clean top corners, hollow voxel thumbstick gimbal, compact slim voxel thumb cluster ── */
@media (pointer: coarse) {
  #realm[data-hud] .act { position: absolute; inset: 0; display: block; pointer-events: none !important; }
  #realm[data-hud] .act .fly { display: contents; }
  #realm[data-hud] .act :is(.use, .up, .down, .walks, .toolkey) {
    position: absolute;
    right: calc(env(safe-area-inset-right, 0px) + 14px + var(--x) - var(--w) / 2);
    bottom: calc(env(safe-area-inset-bottom, 0px) + 14px + var(--y) - var(--h) / 2);
    inline-size: var(--w);
    block-size: var(--h);
    min-inline-size: 0;
    min-block-size: 0;
    padding: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    pointer-events: auto;
    transition: opacity 0.28s ease-out, bottom 0.2s cubic-bezier(0.23, 1, 0.32, 1);
  }
  #realm[data-hud] .act :is(.use, .up, .down, .walks, .toolkey) .vx-label {
    display: inline-flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 2px;
  }
  #realm[data-hud] .act .hud-lbl { font: 600 9.5px/1 var(--hud-font); letter-spacing: 0.02em; opacity: 0.9; }
  html:not(.first)[data-hud] #realm .act .use {
    --w: 58px;
    --h: 58px;
    --x: 29px;
    --y: 29px;
  }
  #realm[data-hud] .act .use .tool-ic { inline-size: 26px; block-size: 13px; }
  #realm[data-hud] .act .use .hud-lbl { font-size: 10px; opacity: 0.95; }

  #realm[data-hud] .act :is(.up, .down, .walks) { --w: 48px; --h: 48px; --x: 29px; }
  #realm[data-hud] .act .up { --y: 94px; }
  #realm[data-hud] .act .walks { --y: 154px; }
  #realm[data-hud] .act .down { --y: 214px; }
  #realm[data-hud] .act .down[hidden] { display: none; }

  /* Contextual icon swapping on mobile action keys. */
  #realm[data-hud] .act .up .ic-chute { display: none; }
  #realm[data-hud] .act .up.chute .ic-jump { display: none; }
  #realm[data-hud] .act .up.chute .ic-chute { display: block; }
  #realm[data-hud] .act .walks .ic-walk { display: none; }
  #realm[data-hud] .act .walks.flying .ic-fly { display: none; }
  #realm[data-hud] .act .walks.flying .ic-walk { display: block; }

  /* Tool switcher: compact slim voxel key right in thumb reach above Fly (shifts up cleanly while flying). */
  #realm[data-hud] .act .toolkey {
    --w: 54px;
    --h: 48px;
    --x: 29px;
    --y: 214px;
    padding: 0 4px;
  }
  html.flying #realm[data-hud] .act .toolkey { --y: 274px; }
  #realm[data-hud] .act .toolkey .tool-ic { inline-size: 24px; block-size: 12px; }
  #realm[data-hud] .act .toolkey .name { font: 600 9px/1 var(--hud-font); max-inline-size: 46px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; opacity: 0.9; }

  /* Landscape phone: compact 2x2 thumb cluster at bottom-right + compact slim voxel tool pill under top-right settings. */
  @media (orientation: landscape) {
    #realm[data-hud] .act .use { --w: 56px; --h: 56px; --x: 28px; --y: 28px; }
    #realm[data-hud] .act :is(.up, .down, .walks) { --w: 46px; --h: 46px; }
    #realm[data-hud] .act .up { --x: 90px; --y: 28px; }
    #realm[data-hud] .act .walks { --x: 28px; --y: 90px; }
    #realm[data-hud] .act .down { --x: 90px; --y: 90px; }
    #realm[data-hud] .act .toolkey {
      --w: 112px;
      --h: 44px;
      --x: 56px;
      bottom: auto;
      top: calc(env(safe-area-inset-top, 0px) + 66px);
      padding: 0 10px;
    }
    #realm[data-hud] .act .toolkey .vx-label { flex-direction: row; gap: 7px; }
    html.flying #realm[data-hud] .act .toolkey { bottom: auto; }
    #realm[data-hud] .act .toolkey .name { font-size: 11.5px; max-inline-size: 72px; }
  }

  #realm[data-hud].open .act .toolkey { display: none; }
  #realm[data-hud].choosing .act .toolkey { opacity: 0; }
  #realm[data-hud].choosing .act :is(.use, .up, .down, .walks) { visibility: hidden; }
  html:not(.first)[data-hud="wheel"] #realm .held,
  #realm[data-hud="wheel"] .held { display: none !important; }
  #realm:is([data-hud="context"], [data-hud="quiet"]) .tools { display: none; }

  /* Contextual auto-dimming when idle so the city shines through. */
  #realm[data-hud="quiet"].rest .act :is(.use, .up, .down, .walks, .toolkey) { opacity: 0.22; }
  #realm[data-hud="wheel"].rest .act :is(.use, .up, .down, .walks, .toolkey) { opacity: 0.7; }
  html[data-hud="wheel"].away :is(#first .credits, #realm .fold, #realm .home-key) { opacity: 0.86 !important; pointer-events: auto !important; }
  html[data-hud="wheel"].away #ask:not(.open) { opacity: 0.72 !important; pointer-events: auto !important; }

  /* Clean top-right slim voxel utility keys: Back chevron + Settings gear side by side, matching minimap top-left. */
  html:not(.first)[data-hud] #realm .fold {
    top: calc(env(safe-area-inset-top, 0px) + 14px);
    right: max(14px, calc(env(safe-area-inset-right) + 14px));
    inline-size: 44px;
    block-size: 44px;
    min-inline-size: 44px;
    min-block-size: 44px;
  }
  html:not(.first)[data-hud="wheel"] #realm .home-key {
    position: absolute;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    top: calc(env(safe-area-inset-top, 0px) + 14px);
    right: calc(max(14px, env(safe-area-inset-right) + 14px) + 52px);
    left: auto;
    inline-size: 44px;
    block-size: 44px;
    min-inline-size: 44px;
    min-block-size: 44px;
    padding: 0;
  }

  /* Servers / lobby tag on touch: tucked cleanly under the top-left minimap. */
  html:not(.first)[data-hud] #realm .lobbies,
  html:not(.first)[data-hud] #lobby-tag {
    top: calc(env(safe-area-inset-top, 0px) + 96px);
    left: max(14px, calc(env(safe-area-inset-left) + 14px));
    block-size: 36px;
    min-block-size: 36px;
    padding: 0 12px;
    font-size: 12px;
  }

  /* Ask bar on touch: compact 44x44 slim voxel sparkle button at bottom-left, vanishing while thumb steers! */
  html:not(.first)[data-hud] #ask:not(.open) {
    left: max(14px, calc(env(safe-area-inset-left) + 14px));
    bottom: calc(env(safe-area-inset-bottom, 0px) + 14px);
    transform: none;
    width: 44px;
  }
  html:not(.first)[data-hud] #ask:not(.open) #ask-row {
    width: 44px;
    height: 44px;
    padding: 0;
    justify-content: center;
  }
  html:not(.first)[data-hud] #ask:not(.open) :is(#line, #ask-picture, #ask-camera, #ask-which, .ask-kbd) { display: none; }
  html:not(.first)[data-hud].thumb-down #ask:not(.open) { opacity: 0 !important; pointer-events: none !important; }
  html:not(.first)[data-hud]:has(#ask.open) #realm .act { visibility: hidden; }
  html:not(.first)[data-hud] #ask.open {
    left: 50%;
    transform: translateX(-50%);
    width: calc(100vw - max(28px, env(safe-area-inset-left) + env(safe-area-inset-right) + 28px));
    bottom: calc(max(14px, env(safe-area-inset-bottom) + 10px) + var(--lift, 0px));
  }

  /* Sky panel drawer clears top utility icons cleanly (including its 3D slim bevel). */
  html:not(.first)[data-hud] #realm .sky,
  html:not(.first)[data-hud] #realm.folds .sky { top: calc(env(safe-area-inset-top, 0px) + 74px); right: max(12px, env(safe-area-inset-right)); }
  /* Say card (.egg-line) sits cleanly in the upper sky, compact and clear of the parachute canopy. */
  html:not(.first)[data-hud] #realm .egg-line { --vx: 2px; --vx-key-size: 12px; border-top: 0; padding: 10px 12px !important; gap: 6px !important; top: calc(env(safe-area-inset-top, 0px) + 74px) !important; }
  html:not(.first)[data-hud] #realm .egg-line .vx-button { --vx: 2px; min-block-size: 30px; padding: 0 9px; font-size: 12px; }
  @media (orientation: landscape) {
    html:not(.first)[data-hud] #realm .sky,
    html:not(.first)[data-hud] #realm.folds .sky,
    html:not(.first)[data-hud] #realm .sky:has(.part.res) {
      top: max(18px, calc(env(safe-area-inset-top, 0px) + 12px));
      left: calc(max(12px, env(safe-area-inset-left, 0px)) + 12px);
      right: auto;
      inline-size: min(calc(100vw - env(safe-area-inset-left, 0px) - env(safe-area-inset-right, 0px) - 96px), 540px);
      padding-block: calc(var(--vx) * 2.5);
      gap: calc(var(--vx) * 2);
    }
    html[data-hud] [data-panel="wand"] { top: 68px; }
    html:not(.first)[data-hud] #realm .egg-line {
      top: max(16px, calc(env(safe-area-inset-top, 0px) + 12px)) !important;
      max-inline-size: calc(100vw - env(safe-area-inset-left, 0px) - env(safe-area-inset-right, 0px) - 120px) !important;
      padding: 8px 12px !important;
      gap: 4px !important;
    }
    html:not(.first)[data-hud] #realm .egg-line .vx-button { min-block-size: 26px; padding: 0 8px; font-size: 11px; }
  }

  /* Wand key (non-wheel modes) & wand bar. */
  html[data-hud] [data-panel="wand-take"] { bottom: auto; top: calc(env(safe-area-inset-top, 0px) + 96px); left: max(14px, calc(env(safe-area-inset-left) + 14px)); }
  html[data-hud] [data-panel="wand-take"] button.vx-button { min-block-size: 44px; }
  html[data-hud] [data-panel="wand-take"] .vx-kbd { display: none; }
  html[data-hud] [data-panel="wand"] { top: calc(env(safe-area-inset-top, 0px) + 100px); }

  /* Sky drawer open: gameplay chrome steps aside cleanly. */
  html[data-hud].drawer :is([data-panel="wand-take"], #where, #realm .home-key, #realm .lobbies, #lobby-tag, #ask:not(.open), #realm .act :is(.use, .up, .down, .walks, .toolkey)) { visibility: hidden; }
  html:not(.first)[data-hud] #where {
    bottom: auto !important;
    top: calc(env(safe-area-inset-top, 0px) + 94px) !important;
    left: max(16px, calc(env(safe-area-inset-left) + 16px)) !important;
    font-size: 12.5px !important;
  }

  /* Optional on-foot bottom-left utility slot beside ✦ (e.g. Summon Car G): vanishes while steering, riding, choosing, or drawer open. */
  html:not(.first)[data-hud] #realm .foot-summon,
  html:not(.first)[data-hud] [data-panel="summon"] .vx-button {
    position: absolute;
    left: calc(max(14px, env(safe-area-inset-left) + 14px) + 52px);
    bottom: calc(env(safe-area-inset-bottom, 0px) + 14px);
    inline-size: 44px;
    block-size: 44px;
    min-inline-size: 44px;
    min-block-size: 44px;
    padding: 0;
    --vx: 2px;
  }
  html:not(.first)[data-hud]:is(.thumb-down, .riding, .drawer, .choosing) :is(#realm .foot-summon, [data-panel="summon"]),
  html:not(.first)[data-hud]:has(#ask.open) :is(#realm .foot-summon, [data-panel="summon"]) { opacity: 0 !important; pointer-events: none !important; }

  /* Riding keys (living.ts): compact slim voxel cluster at bottom-right, leaving bottom-left clear for thumbstick & radio-yt (216x200). */
  html[data-hud] [data-panel="living"] { right: calc(env(safe-area-inset-right, 0px) + 14px); bottom: calc(env(safe-area-inset-bottom, 0px) + 14px); gap: 8px; }
  html[data-hud] [data-panel="living"] .vx-button { min-inline-size: 74px; min-block-size: 44px; padding: 0 14px; display: inline-flex; align-items: center; justify-content: center; font-size: 12.5px; }
  html[data-hud].driving [data-panel="living"] {
    display: grid;
    grid-template-columns: 52px 58px;
    grid-auto-rows: 48px;
    gap: 8px;
    align-items: stretch;
    justify-items: stretch;
  }
  html[data-hud].driving [data-panel="living"] .vx-button {
    inline-size: 100%;
    block-size: 100%;
    min-inline-size: 44px;
    min-block-size: 44px;
    padding: 0;
  }
  html[data-hud].driving [data-panel="living"] .vx-button .vx-label {
    display: inline-flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 2px;
  }
  html[data-hud].driving [data-panel="living"] .vx-button .hud-lbl { font: 600 9px/1 var(--hud-font); letter-spacing: 0.02em; opacity: 0.92; }
  /* Primary right thumb column: Drift (bottom), Horn (middle), Get off (top); left utility column: Seat, Cam, Radio/extras. */
  html[data-hud].driving [data-panel="living"] [data-act="drift"] { grid-column: 2; grid-row: 3; }
  html[data-hud].driving [data-panel="living"] [data-act="horn"] { grid-column: 2; grid-row: 2; }
  html[data-hud].driving [data-panel="living"] [data-act="leave"] { grid-column: 2; grid-row: 1; }
  html[data-hud].driving [data-panel="living"] [data-act="seat"] { grid-column: 1; grid-row: 3; }
  html[data-hud].driving [data-panel="living"] [data-act="cam"] { grid-column: 1; grid-row: 2; }
  html[data-hud].driving [data-panel="living"] [data-act="radio"] { grid-column: 1; grid-row: 1; }
  @media (orientation: landscape) {
    html[data-hud]:not(.driving) [data-panel="living"]:has(> :nth-child(5)) { flex-wrap: wrap-reverse; block-size: calc(3 * 44px + 2 * 10px); inline-size: calc(2 * 96px + 10px); column-gap: 10px; }
    html[data-hud].driving [data-panel="living"] { grid-auto-rows: 46px; }
  }
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
  const short = (name: string) => name

  // ── The safe area, as the page has it (env() read through a probe) ──
  const probe = document.createElement('div')
  probe.style.cssText = 'position:fixed;inset:0;visibility:hidden;pointer-events:none;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)'
  document.body.append(probe)
  const safe = () => { const s = getComputedStyle(probe); return { top: parseFloat(s.paddingTop) || 0, right: parseFloat(s.paddingRight) || 0, bottom: parseFloat(s.paddingBottom) || 0, left: parseFloat(s.paddingLeft) || 0 } }
  const meets = (a: Box, b: Box) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
  /** How far a kit part's solid stands up and to the left of its face (half its --vx-face-z, SPEC), and the voxel drawn past it all round, CSS px. */
  const solidOf = (el: HTMLElement) => {
    if (!el.hasAttribute('data-vx-live')) return { lift: 0, bleed: 0 }
    const cv = el.querySelector<HTMLElement>(':scope > .vx-canvas')
    if (!cv || !cv.checkVisibility()) return { lift: 0, bleed: 0 }
    const cs = getComputedStyle(el), vx = parseFloat(cs.getPropertyValue('--vx')) || 4
    return { lift: (parseFloat(cs.getPropertyValue('--vx-face-z')) || 0) * 0.5 * vx, bleed: vx }
  }

  // ── Kit adoption & live look transitions (First View stays on lit; gameplay switches to slim) ──
  const pendingKit: ((k: Kit) => void)[] = []
  const kitDo = (fn: (k: Kit) => void) => { if (o.ui.kit) fn(o.ui.kit); else pendingKit.push(fn) }
  const flushKit = () => {
    const k = o.ui.kit
    if (!k || !pendingKit.length) return
    while (pendingKit.length) pendingKit.shift()!(k)
  }
  const adoptOne = (el: HTMLElement | null) => {
    if (!el) return
    kitDo((k) => { if (!el.hasAttribute('data-vx-live')) k.adopt(el) })
  }
  const refreshAll = (k: Kit) => {
    for (const el of root.querySelectorAll<HTMLElement>('[data-vx-live]')) if (el.offsetWidth && el.offsetHeight) k.refresh?.(el)
    for (const sel of ['#lobby-tag', '#ask-row .ask-voxel', '[data-panel="wand-take"] button', '[data-panel="living"] .vx-button', '[data-panel="summon"] .vx-button']) {
      for (const el of document.querySelectorAll<HTMLElement>(sel)) {
        if (!el.hasAttribute('data-vx-live')) k.adopt(el)
        else if (el.offsetWidth && el.offsetHeight) k.refresh?.(el)
      }
    }
  }

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
  kitDo((k) => k.adopt(cues))
  const said = new Map<HTMLElement, string>()
  const say = (el: HTMLElement, key: string, words: string) => {
    if (said.get(el) === key + words) return
    said.set(el, key + words)
    const kbd = el.querySelector<HTMLElement>('.vx-kbd')!
    const kbdLbl = kbd.querySelector<HTMLElement>(':scope > .vx-label') ?? kbd
    kbdLbl.textContent = key
    el.querySelector('.words')!.textContent = words
    if (o.ui.kit) {
      if (!el.hasAttribute('data-vx-live')) o.ui.kit.adopt(el)
      else { o.ui.kit.refresh?.(kbd); o.ui.kit.refresh?.(el) }
    }
  }

  // ── The stick that comes under the thumb (hollow stepped octagonal voxel gimbal + concave cap) ──
  const float = document.createElement('div')
  float.className = 'vx-recess float'
  float.setAttribute('aria-hidden', 'true')
  float.innerHTML = '<span class="vx-button cap" data-vx-stick-cap tabindex="-1"></span>'
  root.append(float)
  const cap = float.querySelector<HTMLElement>('.cap')!
  kitDo((k) => k.adopt(float))

  // ── The tool's key: on a desk (wheel) the held tool and its key; by touch, among the thumb's keys ──
  const held = Object.assign(document.createElement('button'), { className: 'vx-button held', type: 'button', innerHTML: '<kbd class="vx-kbd">E</kbd><span class="ic"></span><span class="name"></span>' })
  held.setAttribute('aria-haspopup', 'dialog')
  root.append(held)
  const toolkey = Object.assign(document.createElement('button'), { className: 'vx-button toolkey', type: 'button', innerHTML: '<span class="ic"></span><span class="name"></span>' })
  root.querySelector('.act')?.append(toolkey)
  adoptOne(held)
  adoptOne(toolkey)
  const next = (step: number) => { const n = o.tools.length; o.pickTool((((o.tool() + step) % n) + n) % n) }
  // What the wheel chooses from: the tools, and the wand after them (with the wheel it is a tool as they are: Q still
  // takes it up and puts it away). Held, it is what is chosen; any other choice puts it away.
  const WAND = o.wand && mode === 'wheel' ? o.tools.length : -1
  const choices = WAND < 0 ? [...o.tools] : [...o.tools, 'Wand'], n = choices.length
  const current = () => (WAND >= 0 && o.wand!.held ? WAND : o.tool())
  const take = (i: number) => { if (i === WAND) { o.wand!.held = true; return } if (o.wand && WAND >= 0) o.wand.held = false; o.pickTool(i) }
  const name = (i: number) => choices[i] ?? ''

  // ── Back to the view, with the wheel by touch: slim voxel key with inlaid pearl-ivory chevron relief ──
  const home = Object.assign(document.createElement('button'), { className: 'vx-button home-key', type: 'button', hidden: true })
  home.dataset.vxIcon = 'back'
  home.setAttribute('data-vx-icon-only', '')
  home.setAttribute('aria-label', 'Back to the view')
  home.title = 'Back to the view'
  home.addEventListener('click', () => o.back?.go())
  if (mode === 'wheel' && o.back) { root.append(home); adoptOne(home) }

  // ── Sleek SVG icon decoration for touch action keys (.use, .up, .down, .walks) ──
  const styledKeys = new WeakSet<HTMLElement>()
  const decorateAction = (el: HTMLElement | null, svg: string, fallback: string) => {
    if (!el || styledKeys.has(el)) return
    styledKeys.add(el)
    const host = el.querySelector<HTMLElement>(':scope > .vx-label') ?? el
    const label = host.textContent?.trim() || fallback
    const canvas = el.querySelector(':scope > .vx-canvas')
    host.innerHTML = `${svg}<span class="hud-lbl"></span>`
    host.querySelector('.hud-lbl')!.textContent = label
    if (canvas && host === el) el.prepend(canvas)
  }

  // ── The wand's key (non-wheel modes) ──
  let wandKey: HTMLButtonElement | null = null
  const wandKeyed = () => {
    const el = wandKey ?? document.querySelector<HTMLButtonElement>('[data-panel="wand-take"] button')
    if (!el) return
    if (!wandKey) {
      wandKey = el
      el.classList.add('vx-button')
      el.querySelector('i')?.replaceWith(Object.assign(document.createElement('kbd'), { className: 'vx-kbd', textContent: 'Q' }))
      adoptOne(el)
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
  let dismissedAt = 0
  addEventListener('pointerdown', (e) => { if (open && e.pointerType === 'touch' && !disc.contains(e.target as Node) && e.target !== toolkey) taps.set(e.pointerId, { x: e.clientX, y: e.clientY, t: performance.now() }) }, true)
  addEventListener('pointerup', (e) => { const t = taps.get(e.pointerId); taps.delete(e.pointerId); if (open && t && performance.now() - t.t < 350 && Math.hypot(e.clientX - t.x, e.clientY - t.y) < 12) { dismissedAt = performance.now(); choose(false) } }, true)
  addEventListener('click', (e) => { if (performance.now() - dismissedAt < 350) { e.preventDefault(); e.stopImmediatePropagation() } }, true)
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
  const idle = (now: number) => down.size === 0 && now - touched > 5000 && !root.classList.contains('open')

  // ── Every frame ──
  let shownTool = -1, b: Box | null = null, inside = false, stickOver = false, panelWas = false
  let appliedLook: 'lit' | 'slim' | null = null, floatShown = false, askWasOpen = false, lastTouch = coarse.matches
  const did = { chute: 0, flew: false, landed: 0 }
  let wasOn = true, wasCanopy = false, flyingSince = 0, afootMs = 0, offSince = 0
  const place = (el: HTMLElement, x: number, y: number) => { el.style.translate = `${Math.round(x)}px ${Math.round(y)}px` }
  o.watch((gap) => {
    flushKit()
    const eng = o.engaged()
    const wantLook = eng ? 'slim' : 'lit'
    // (Back in the first view, the key goes with the rest: asked before the frame is left to it.)
    const homeShown = coarse.matches && eng && !!o.back?.can()
    if (home.hidden === homeShown) {
      home.hidden = !homeShown
      if (homeShown && o.ui.kit) o.ui.kit.refresh?.(home)
    }
    if (o.ui.kit && wantLook !== appliedLook) {
      appliedLook = wantLook
      refreshAll(o.ui.kit)
    }
    if (!eng) return
    wandKeyed()
    // Ensure Ask collapsed trigger voxel backing & dynamically mounted riding keys are adopted into slim.
    if (o.ui.kit) {
      const askVoxel = document.querySelector<HTMLElement>('#ask-row .ask-voxel')
      const askOpen = !!document.getElementById('ask')?.classList.contains('open')
      if (askVoxel && !askOpen && askVoxel.offsetWidth && askVoxel.offsetHeight) {
        if (!askVoxel.hasAttribute('data-vx-live')) o.ui.kit.adopt(askVoxel)
        else if (askWasOpen || lastTouch !== coarse.matches) o.ui.kit.refresh?.(askVoxel)
      }
      askWasOpen = askOpen
      if (html.classList.contains('riding')) {
        const driving = html.classList.contains('driving')
        for (const el of document.querySelectorAll<HTMLElement>('[data-panel="living"] .vx-button')) {
          if (driving && coarse.matches) {
            const act = el.dataset.act ?? ''
            if (DRIVE_ICONS[act]) decorateAction(el, DRIVE_ICONS[act], el.textContent?.trim() || act)
          }
          if (!el.hasAttribute('data-vx-live') && el.offsetWidth && el.offsetHeight) o.ui.kit.adopt(el)
        }
      } else {
        for (const el of document.querySelectorAll<HTMLElement>('[data-panel="summon"] .vx-button:not([data-vx-live])')) {
          if (el.offsetWidth && el.offsetHeight) o.ui.kit.adopt(el)
        }
      }
      if (lastTouch !== coarse.matches) {
        lastTouch = coarse.matches
        refreshAll(o.ui.kit)
      }
    }
    // Decorate touch action buttons with crisp SVG icons once mounted.
    if (coarse.matches) {
      decorateAction(root.querySelector<HTMLElement>('.act .use'), '<span class="ic"></span>', 'Use')
      decorateAction(root.querySelector<HTMLElement>('.act .up'), JUMP_SVG + CHUTE_SVG, 'Jump')
      decorateAction(root.querySelector<HTMLElement>('.act .walks'), FLY_SVG + WALK_SVG, 'Fly')
      decorateAction(root.querySelector<HTMLElement>('.act .down'), DOWN_SVG, 'Down')
    }
    // (Come in: where one is, said once on arrival.)
    if (!inside) { inside = true; named(); afootMs = 0; wasOn = o.me.on }
    if (tools && tools.dataset.vxWay !== 'down') { tools.dataset.vxWay = 'down'; o.ui.kit?.refresh?.(tools) }
    const now = performance.now(), s = safe(), vw = innerWidth, vh = innerHeight, touch = coarse.matches
    b = body()
    const all = parts()
    // The tool's name and crisp icon on its keys (and on the mobile Use button).
    const t = current()
    if (t !== shownTool) {
      shownTool = t
      const label = name(t), ic = toolSvg(label)
      held.querySelector('.ic')!.innerHTML = ic
      held.querySelector('.name')!.textContent = label
      held.setAttribute('aria-label', `Tool: ${label}. Choose another (E)`)
      toolkey.querySelector('.ic')!.innerHTML = ic
      toolkey.querySelector('.name')!.textContent = short(label)
      toolkey.setAttribute('aria-label', mode === 'wheel' ? `Tool: ${label}. Hold and slide to choose another` : `Tool: ${label}. Tap for the next`)
      const useIc = root.querySelector<HTMLElement>('.act .use .ic')
      if (useIc) useIc.innerHTML = ic
      if (o.ui.kit) {
        if (held.offsetWidth) o.ui.kit.refresh?.(held)
        if (toolkey.offsetWidth) o.ui.kit.refresh?.(toolkey)
      }
    }
    // Ensure Use icon is populated once decorated even if tool did not change this frame.
    if (touch) {
      const useIc = root.querySelector<HTMLElement>('.act .use .ic')
      if (useIc && !useIc.firstElementChild) useIc.innerHTML = toolSvg(name(t))
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
    // On mobile the Fly button is already visible in the thumb cluster: no redundant floating banner over the character.
    // On desktop show a brief, subtle [B] Fly cue for 12s of on-foot time on first arrival.
    if (!o.vehicle?.() && o.me.on && !o.me.aloft) afootMs += Math.min(gap, 100)
    const cueFly = !touch && !o.vehicle?.() && o.me.on && !o.me.aloft && !did.flew && afootMs < 12_000
    const cueLand = !touch && !o.me.on && did.landed < 2 && now - flyingSince < 5000
    if (cueChute) say(chute, touch ? 'Chute' : 'Space', 'Parachute')
    if (cueFly) say(fly, 'B', 'Fly')
    if (cueLand) say(land, 'B', 'Walk')
    const drawer = touch && root.classList.contains('open'), free = !open && !drawer && !root.querySelector('.egg-line:not([hidden])') && !document.querySelector('#choice:not([hidden]), #ask.open, #connect[open], #ai-line:not([hidden])')
    html.classList.toggle('drawer', drawer)
    for (const [el, want] of [[chute, cueChute && free], [fly, cueFly && free], [land, cueLand && free]] as const) {
      const was = el.classList.contains('on')
      el.classList.toggle('on', want)
      if (want && !was && o.ui.kit) {
        const kbd = el.querySelector<HTMLElement>('.vx-kbd')
        if (kbd) o.ui.kit.refresh?.(kbd)
        o.ui.kit.refresh?.(el)
      }
    }
    // Beside the body, on the side with more room; with no body seen, in the middle a third of the way up.
    if (cueChute || cueFly || cueLand) {
      const w = cues.offsetWidth, h = cues.offsetHeight
      const shown = [chute, fly, land].find((el) => el.classList.contains('on')) ?? fly, { lift, bleed } = solidOf(shown), up = lift + bleed, gap = 18
      let x: number, y: number
      if (b) {
        const right = vw - s.right - 16 - b.right, left = b.left - s.left - 16
        const room = w + up + bleed + gap
        if (right >= room || left >= room) {
          x = right >= room ? b.right + up + gap : b.left - bleed - gap - w
          y = Math.max(s.top + 72, Math.min(vh - s.bottom - h - 120, (b.top + b.bottom) / 2 - h))
        } else { x = (b.left + b.right - w) / 2; y = Math.max(s.top + 88, b.top - h - bleed - 28) }
      } else { x = (vw - w) / 2; y = vh * 0.62 }
      x = Math.max(s.left + 12 + up, Math.min(vw - s.right - 12 - w - bleed, x))
      // Clear of the keys, minimap and ask pill too: where the cue would meet one, it goes up above them.
      const keys = [...root.querySelectorAll<HTMLElement>('.act .use, .act .up, .act .down, .act .walks, .act .toolkey, .held'), ...document.querySelectorAll<HTMLElement>('#minimap, #ask-row')].filter((el) => el.offsetParent).map((el) => { const r = el.getBoundingClientRect(), k = solidOf(el); return { left: r.left - k.lift - k.bleed, top: r.top - k.lift - k.bleed, right: r.right + k.bleed, bottom: r.bottom + k.bleed } })
      for (const k of keys) if (x - up < k.right && x + w + bleed > k.left && y - up < k.bottom && y + h + bleed > k.top) y = Math.min(y, k.top - gap - h - bleed)
      y = Math.max(s.top + 20 + up, y)
      place(cues, x, y)
      const card: Box = { left: x - up, top: y - up, right: x + w + bleed, bottom: y + h + bleed }
      cues.style.visibility = all.some((p) => meets(card, { left: p.left - 12, top: p.top - 12, right: p.right + 12, bottom: p.bottom + 12 })) || card.top < s.top || card.bottom > vh - s.bottom || card.left < s.left || card.right > vw - s.right ? 'hidden' : ''
    }
    // The stick, where the thumb is; not drawn at all where that is over the body (the thumb is the mark then, and the body is seen).
    const th = o.input.thumb, r = 56
    html.classList.toggle('thumb-down', !!th)
    const well = (m: number): Box | null => th && { left: th.from[0] - r - m, top: th.from[1] - r - m, right: th.from[0] + r + m, bottom: th.from[1] + r + m }
    const near = (m: number) => { const w = well(m); return !!w && all.some((p) => meets(w, p)) }
    stickOver = !!th && (stickOver ? near(16) : near(0))
    const over = stickOver
    const stickNow = !!th && !over
    float.classList.toggle('on', stickNow)
    if (stickNow && !floatShown && o.ui.kit) {
      o.ui.kit.refresh?.(float)
      o.ui.kit.refresh?.(cap)
    }
    floatShown = stickNow
    if (stickNow && th) {
      place(float, th.from[0], th.from[1])
      let dx = th.at[0] - th.from[0], dy = th.at[1] - th.from[1]
      const far = Math.hypot(dx, dy)
      if (far > 32) { dx *= 32 / far; dy *= 32 / far }
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
