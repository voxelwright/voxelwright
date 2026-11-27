// Waymo-style In-Car Radio & Connected Media Picker UI:
// Compact, dark automotive infotainment modal (`<dialog id="radio-picker">`) opened from Settings (`Radio…`),
// driving shortcut (`R` or `Shift+N`), or tapping the `[data-panel="radio-toast"]` pill. Zero permanent HUD
// clutter while cruising; clears the car, minimap, drive-hud, stunts, controls card, and phone safe areas,
// and honors `prefers-reduced-motion: reduce`. All user/provider strings are rendered via `textContent` only.
import type { Input } from './input.ts'
import {
  CURATED_PLAYLISTS,
  type PlaylistItem,
  type ProviderId,
  type Radio,
  type RadioState,
  type YouTubeProvider,
} from './sound/radio.ts'
import {
  canonicalSpotifyRedirectUri,
  parseApplePlaylistId,
  parseSpotifyPlaylistUri,
  parseYouTubeSource,
} from './sound/radio-providers.ts'

export interface RadioPicker {
  open(tab?: ProviderId): void
  close(): void
  toggle(): void
  readonly isOpen: boolean
  dispose(): void
}

const STYLE = /* css */ `
#radio-picker {
  --rp-accent: #ff4fa0;
  --rp-bg: rgba(13, 17, 24, 0.94);
  --rp-surface: rgba(255, 255, 255, 0.06);
  --rp-surface-hover: rgba(255, 255, 255, 0.11);
  --rp-border: rgba(255, 255, 255, 0.12);
  --rp-ink: #f2f5fa;
  --rp-muted: rgba(226, 232, 242, 0.68);
  inset: env(safe-area-inset-top, 0px) env(safe-area-inset-right, 0px) env(safe-area-inset-bottom, 0px) env(safe-area-inset-left, 0px);
  margin: auto;
  padding: 0;
  width: min(444px, calc(100vw - env(safe-area-inset-left, 0px) - env(safe-area-inset-right, 0px) - 24px));
  max-height: min(640px, calc(100dvh - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px) - 24px), calc(var(--seen, 100dvh) - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px) - 20px));
  border: 1px solid var(--rp-border);
  border-radius: 20px;
  background: var(--rp-bg);
  color: var(--rp-ink);
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.62), 0 0 0 1px rgba(255, 255, 255, 0.04) inset;
  backdrop-filter: blur(22px);
  -webkit-backdrop-filter: blur(22px);
  font: 400 13.5px/1.45 -apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif;
  overflow: hidden;
  user-select: none;
  -webkit-user-select: none;
}
#radio-picker::backdrop {
  background: rgba(6, 9, 14, 0.48);
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
}
#radio-picker[open] { display: flex; flex-direction: column; }
#radio-picker [hidden] { display: none !important; }
#radio-picker * { box-sizing: border-box; }
#radio-picker :is(button, input, [role="button"]):focus:not(:focus-visible) { outline: none; }
#radio-picker :is(button, input, [role="button"]):focus-visible { outline: 2px solid color-mix(in srgb, var(--rp-accent) 85%, #fff); outline-offset: 2px; }

#radio-picker .rp-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 14px 16px 10px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.07);
}
#radio-picker .rp-head-left { display: flex; align-items: center; gap: 9px; min-width: 0; }
#radio-picker .rp-title { margin: 0; font: 700 15px/1.15 -apple-system, system-ui, sans-serif; letter-spacing: -0.01em; color: #fff; }
#radio-picker .rp-pill {
  padding: 2px 7px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.09);
  color: var(--rp-muted);
  font: 600 10.5px/1.3 -apple-system, system-ui, sans-serif;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
#radio-picker .rp-pill.live { background: color-mix(in srgb, var(--rp-accent) 22%, transparent); color: #fff; }
#radio-picker .rp-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border: 0;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.07);
  color: #e4eaf3;
  font: 500 20px/1 -apple-system, system-ui, sans-serif;
  cursor: pointer;
  touch-action: manipulation;
}
#radio-picker .rp-close:hover { background: rgba(255, 255, 255, 0.14); }
@media (pointer: coarse) { #radio-picker .rp-close { width: 44px; height: 44px; } }

/* Now Playing Hero */
#radio-picker .rp-now {
  position: relative;
  display: grid;
  grid-template-columns: 62px minmax(0, 1fr);
  gap: 12px;
  padding: 14px 16px;
  background:
    radial-gradient(120% 140% at 0% 0%, color-mix(in srgb, var(--rp-accent) 28%, transparent) 0%, transparent 65%),
    rgba(255, 255, 255, 0.025);
  border-bottom: 1px solid rgba(255, 255, 255, 0.07);
}
#radio-picker .rp-art {
  position: relative;
  width: 62px;
  height: 62px;
  border-radius: 13px;
  overflow: hidden;
  background: linear-gradient(135deg, color-mix(in srgb, var(--rp-accent) 78%, #10141c), #161d29);
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 8px 20px rgba(0, 0, 0, 0.36);
}
#radio-picker .rp-art img { width: 100%; height: 100%; object-fit: cover; display: block; }
#radio-picker .rp-art-glyph { font: 700 24px/1 -apple-system, system-ui, sans-serif; color: rgba(255, 255, 255, 0.92); }
#radio-picker .rp-meta { display: flex; flex-direction: column; justify-content: center; gap: 3px; min-width: 0; }
#radio-picker .rp-badges { display: flex; align-items: center; gap: 6px; }
#radio-picker .rp-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 7px;
  border-radius: 6px;
  background: color-mix(in srgb, var(--rp-accent) 22%, rgba(255, 255, 255, 0.08));
  color: #fff;
  font: 700 10px/1.2 -apple-system, system-ui, sans-serif;
  letter-spacing: 0.07em;
  text-transform: uppercase;
}
#radio-picker .rp-duck {
  padding: 2px 6px;
  border-radius: 6px;
  background: rgba(255, 174, 52, 0.2);
  color: #ffc766;
  font: 700 10px/1.2 -apple-system, system-ui, sans-serif;
  letter-spacing: 0.05em;
  text-transform: uppercase;
}
#radio-picker .rp-track-title { font: 700 15px/1.25 -apple-system, system-ui, sans-serif; color: #fff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
#radio-picker .rp-track-artist { font: 500 12.5px/1.25 -apple-system, system-ui, sans-serif; color: var(--rp-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

/* Transport + Volume */
#radio-picker .rp-transport {
  grid-column: 1 / -1;
  display: flex;
  align-items: center;
  gap: 8px;
  padding-top: 2px;
}
#radio-picker .rp-ctrl {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 36px;
  height: 36px;
  border: 0;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.09);
  color: #fff;
  font: 600 14px/1 -apple-system, system-ui, sans-serif;
  cursor: pointer;
  touch-action: manipulation;
  transition: background 0.14s ease, transform 0.12s ease;
}
#radio-picker .rp-ctrl:hover { background: rgba(255, 255, 255, 0.16); }
#radio-picker .rp-ctrl:active { transform: scale(0.95); }
#radio-picker .rp-ctrl.play {
  min-width: 40px;
  height: 40px;
  background: var(--rp-accent);
  color: #0b0e14;
  font-size: 15px;
  font-weight: 800;
  box-shadow: 0 4px 16px color-mix(in srgb, var(--rp-accent) 44%, transparent);
}
@media (pointer: coarse) {
  #radio-picker .rp-ctrl { min-width: 44px; height: 44px; }
  #radio-picker .rp-ctrl.play { min-width: 46px; height: 46px; }
}
#radio-picker .rp-vol {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 7px;
  margin-left: 6px;
  min-width: 0;
}
#radio-picker .rp-vol span { font-size: 12px; color: var(--rp-muted); flex: none; }
#radio-picker .rp-vol input[type="range"] {
  flex: 1;
  min-width: 60px;
  accent-color: var(--rp-accent);
  cursor: pointer;
}

/* Provider switcher */
#radio-picker .rp-providers {
  display: grid;
  grid-auto-flow: column;
  grid-auto-columns: 1fr;
  gap: 6px;
  padding: 10px 16px 8px;
}
#radio-picker .rp-prov {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 36px;
  padding: 6px 6px;
  border: 1px solid rgba(255, 255, 255, 0.09);
  border-radius: 11px;
  background: rgba(255, 255, 255, 0.04);
  color: var(--rp-muted);
  font: 600 12px/1 -apple-system, system-ui, sans-serif;
  white-space: nowrap;
  cursor: pointer;
  touch-action: manipulation;
  transition: background 0.14s ease, border-color 0.14s ease, color 0.14s ease;
}
#radio-picker .rp-prov:hover { background: rgba(255, 255, 255, 0.09); color: #fff; }
#radio-picker .rp-prov.on {
  background: rgba(255, 255, 255, 0.14);
  border-color: color-mix(in srgb, var(--prov-color, #fff) 72%, rgba(255, 255, 255, 0.25));
  color: #fff;
}
#radio-picker .rp-prov .dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.24);
  flex: none;
}
#radio-picker .rp-prov .dot.live { background: #1DB954; box-shadow: 0 0 6px rgba(29, 185, 84, 0.8); }
#radio-picker .rp-prov[data-provider="youtube"] .dot.live { background: #FF0033; box-shadow: 0 0 6px rgba(255, 0, 51, 0.85); }
#radio-picker .rp-prov[data-provider="apple"] .dot.live { background: #FA243C; box-shadow: 0 0 6px rgba(250, 36, 60, 0.8); }
#radio-picker .rp-prov[data-provider="fm"] .dot.live { background: #ff4fa0; box-shadow: 0 0 6px rgba(255, 79, 160, 0.7); }
@media (pointer: coarse) { #radio-picker .rp-prov { min-height: 44px; } }

/* Scrollable body */
#radio-picker .rp-body {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  padding: 4px 16px 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

/* Account card (Spotify / Apple Music) */
#radio-picker .rp-acct {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 11px 12px;
  border-radius: 13px;
  background: rgba(255, 255, 255, 0.045);
  border: 1px solid rgba(255, 255, 255, 0.08);
}
#radio-picker .rp-acct-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
#radio-picker .rp-acct-info { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
#radio-picker .rp-acct-title { font: 600 13px/1.25 -apple-system, system-ui, sans-serif; color: #fff; }
#radio-picker .rp-acct-sub { font: 400 11.5px/1.3 -apple-system, system-ui, sans-serif; color: var(--rp-muted); }
#radio-picker .rp-acct-actions { display: flex; align-items: center; gap: 6px; }
#radio-picker .rp-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 34px;
  padding: 0 12px;
  border: 0;
  border-radius: 9px;
  background: rgba(255, 255, 255, 0.11);
  color: #fff;
  font: 600 12.5px/1 -apple-system, system-ui, sans-serif;
  cursor: pointer;
  touch-action: manipulation;
  white-space: nowrap;
}
#radio-picker .rp-btn:hover { background: rgba(255, 255, 255, 0.18); }
#radio-picker .rp-btn.primary { background: var(--rp-accent); color: #0a0d12; font-weight: 700; }
#radio-picker .rp-btn.danger { background: rgba(255, 69, 58, 0.16); color: #ff8c85; }
@media (pointer: coarse) { #radio-picker .rp-btn { min-height: 44px; padding: 0 14px; } }

#radio-picker .rp-form { display: flex; flex-direction: column; gap: 6px; }
#radio-picker .rp-input-row { display: flex; gap: 6px; }
#radio-picker input[type="text"], #radio-picker input[type="password"] {
  flex: 1;
  min-width: 0;
  min-height: 36px;
  padding: 6px 10px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 9px;
  background: rgba(6, 9, 14, 0.55);
  color: #fff;
  font: 500 16px/1.3 -apple-system, system-ui, sans-serif;
  user-select: text;
  -webkit-user-select: text;
}
#radio-picker .rp-hint { margin: 0; font-size: 11.5px; color: var(--rp-muted); line-height: 1.4; overflow-wrap: anywhere; }
#radio-picker .rp-hint code { font: 500 11px ui-monospace, monospace; padding: 1px 4px; border-radius: 4px; background: rgba(255, 255, 255, 0.08); color: #e2e8f2; }
#radio-picker .rp-err { margin: 0; font: 600 12px/1.35 -apple-system, system-ui, sans-serif; color: #ff857d; }

/* Sub-tabs (Curated SF | Your Playlists) */
#radio-picker .rp-tabs {
  display: inline-flex;
  gap: 4px;
  padding: 3px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.05);
  align-self: flex-start;
}
#radio-picker .rp-tab {
  min-height: 30px;
  padding: 0 11px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--rp-muted);
  font: 600 12px/1 -apple-system, system-ui, sans-serif;
  cursor: pointer;
  touch-action: manipulation;
}
#radio-picker .rp-tab.on { background: rgba(255, 255, 255, 0.14); color: #fff; }
@media (pointer: coarse) { #radio-picker .rp-tab { min-height: 38px; padding: 0 14px; } }

/* Playlist list */
#radio-picker .rp-list { display: flex; flex-direction: column; gap: 6px; }
#radio-picker .rp-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 8px 10px;
  border: 1px solid rgba(255, 255, 255, 0.07);
  border-radius: 12px;
  background: var(--rp-surface);
  color: var(--rp-ink);
  text-align: left;
  cursor: pointer;
  touch-action: manipulation;
  transition: background 0.14s ease, border-color 0.14s ease;
}
#radio-picker .rp-item:hover { background: var(--rp-surface-hover); }
#radio-picker .rp-item.active {
  background: color-mix(in srgb, var(--item-accent, var(--rp-accent)) 18%, rgba(255, 255, 255, 0.06));
  border-color: color-mix(in srgb, var(--item-accent, var(--rp-accent)) 65%, rgba(255, 255, 255, 0.2));
}
#radio-picker .rp-swatch {
  width: 38px;
  height: 38px;
  border-radius: 9px;
  flex: none;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, color-mix(in srgb, var(--item-accent, #ff4fa0) 76%, #0f141e), #1b2230);
  color: #fff;
  font: 700 12px/1 ui-monospace, monospace;
}
#radio-picker .rp-swatch img { width: 100%; height: 100%; object-fit: cover; display: block; }
#radio-picker .rp-item-text { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
#radio-picker .rp-item-name { font: 600 13.5px/1.2 -apple-system, system-ui, sans-serif; color: #fff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
#radio-picker .rp-item-sub { font: 400 11.5px/1.2 -apple-system, system-ui, sans-serif; color: var(--rp-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
#radio-picker .rp-item-right { display: flex; align-items: center; gap: 6px; flex: none; }
#radio-picker .rp-tag {
  padding: 2px 6px;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.08);
  color: var(--rp-muted);
  font: 600 10.5px/1.2 ui-monospace, monospace;
}
#radio-picker .rp-preview-btn {
  padding: 5px 8px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.07);
  color: #e4eaf3;
  font: 600 11px/1 -apple-system, system-ui, sans-serif;
  cursor: pointer;
}
#radio-picker .rp-preview-btn:hover { background: rgba(255, 255, 255, 0.16); }
#radio-picker .rp-embed-wrap {
  border-radius: 12px;
  overflow: hidden;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: #0b0e14;
}
#radio-picker .rp-embed-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 10px;
  font-size: 11.5px;
  color: var(--rp-muted);
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}
#radio-picker .rp-embed-wrap iframe { display: block; width: 100%; height: 152px; border: 0; }
#radio-picker .rp-empty {
  padding: 16px 12px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.035);
  text-align: center;
  color: var(--rp-muted);
  font-size: 12.5px;
}

/* Landscape phone: two-column compact view so controls + playlists fit cleanly without cramped scrolling */
@media (pointer: coarse) and (orientation: landscape) {
  #radio-picker {
    width: min(680px, calc(100vw - env(safe-area-inset-left, 0px) - env(safe-area-inset-right, 0px) - 24px));
    max-height: calc(100dvh - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px) - 16px);
  }
  #radio-picker .rp-head { padding: 8px 14px 6px; }
  #radio-picker .rp-now { padding: 8px 14px; gap: 8px 12px; }
  #radio-picker .rp-providers { padding: 6px 14px; }
  #radio-picker .rp-art { width: 46px; height: 46px; }
}

@media (prefers-reduced-motion: reduce) {
  #radio-picker .rp-ctrl, #radio-picker .rp-prov, #radio-picker .rp-item { transition: none !important; }
  #radio-picker .rp-ctrl:active { transform: none !important; }
}
`

export function createRadioPicker(opts: { radio: Radio; input: Input }): RadioPicker {
  const { radio, input } = opts
  let styleEl: HTMLStyleElement | null = null
  let dialog: HTMLDialogElement | null = null
  let leaveInput: (() => void) | null = null
  let selectedProvider: ProviderId = 'fm'
  let subTab: 'curated' | 'yours' = 'curated'
  let previewEmbed: { title: string; url: string } | null = null
  let customUrlStatus = ''
  let customUrlBad = false
  let spotifyIdDraft = ''
  let appleTokDraft = ''
  let unsubRadio: (() => void) | null = null

  const ensureStyle = () => {
    if (styleEl) return
    styleEl = document.createElement('style')
    styleEl.textContent = STYLE
    document.head.append(styleEl)
  }

  const fitViewport = () => {
    if (!dialog) return
    dialog.style.setProperty('--seen', `${Math.round(visualViewport?.height ?? innerHeight)}px`)
  }

  const build = () => {
    ensureStyle()
    const d = document.createElement('dialog')
    d.id = 'radio-picker'
    d.setAttribute('aria-labelledby', 'rp-title')
    d.innerHTML = /* html */ `
      <header class="rp-head">
        <div class="rp-head-left">
          <h2 class="rp-title" id="rp-title">Car Radio</h2>
          <span class="rp-pill rp-drive-pill"></span>
        </div>
        <button class="rp-close" type="button" aria-label="Close radio picker">&times;</button>
      </header>
      <section class="rp-now" aria-label="Now playing">
        <div class="rp-art">
          <img class="rp-art-img" alt="" hidden>
          <span class="rp-art-glyph" aria-hidden="true">&#9835;</span>
        </div>
        <div class="rp-meta">
          <div class="rp-badges">
            <span class="rp-badge"></span>
            <span class="rp-duck" hidden>Ducked</span>
          </div>
          <div class="rp-track-title"></div>
          <div class="rp-track-artist"></div>
        </div>
        <div class="rp-transport">
          <button class="rp-ctrl rp-prev" type="button" aria-label="Previous track or station" title="Previous (,)">&#9198;</button>
          <button class="rp-ctrl play rp-play" type="button" aria-label="Play or pause" title="Play / Pause">&#9654;</button>
          <button class="rp-ctrl rp-next" type="button" aria-label="Next track or station" title="Next (.)">&#9197;</button>
          <label class="rp-vol">
            <span aria-hidden="true"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg></span>
            <input class="rp-vol-range" type="range" min="0" max="100" step="2" aria-label="Radio volume">
          </label>
        </div>
      </section>
      <div class="rp-providers" role="tablist" aria-label="Music source">
        <button class="rp-prov" type="button" role="tab" data-provider="fm" style="--prov-color:#ff4fa0"><span class="dot"></span>FM Radio</button>
        <button class="rp-prov" type="button" role="tab" data-provider="youtube" style="--prov-color:#FF0033"><span class="dot"></span>YouTube Music</button>
        <button class="rp-prov" type="button" role="tab" data-provider="spotify" style="--prov-color:#1DB954" hidden><span class="dot"></span>Spotify</button>
        <button class="rp-prov" type="button" role="tab" data-provider="apple" style="--prov-color:#FA243C" hidden><span class="dot"></span>Apple Music</button>
      </div>
      <div class="rp-body"></div>`
    document.body.append(d)
    dialog = d

    const releaseInput = () => { leaveInput?.(); leaveInput = null }
    d.querySelector<HTMLButtonElement>('.rp-close')!.addEventListener('click', () => close())
    d.addEventListener('click', (e) => { if (e.target === d) close() })
    d.addEventListener('cancel', releaseInput)
    d.addEventListener('close', releaseInput)

    d.querySelector<HTMLButtonElement>('.rp-prev')!.addEventListener('click', () => void radio.prevTrack())
    d.querySelector<HTMLButtonElement>('.rp-play')!.addEventListener('click', () => void radio.togglePlay())
    d.querySelector<HTMLButtonElement>('.rp-next')!.addEventListener('click', () => void radio.nextTrack())
    const vol = d.querySelector<HTMLInputElement>('.rp-vol-range')!
    vol.addEventListener('input', () => radio.setVolume(Number(vol.value) / 100))

    for (const btn of d.querySelectorAll<HTMLButtonElement>('.rp-prov')) {
      btn.addEventListener('click', () => {
        selectedProvider = btn.dataset.provider as ProviderId
        subTab = 'curated'
        previewEmbed = null
        customUrlStatus = ''
        render(radio.state)
      })
    }

    visualViewport?.addEventListener('resize', fitViewport)
    fitViewport()
  }

  const makePlaylistRow = (item: PlaylistItem, isActive: boolean, connected: boolean) => {
    const row = document.createElement('div')
    row.className = `rp-item${isActive ? ' active' : ''}`
    row.style.setProperty('--item-accent', item.accent)
    row.setAttribute('role', 'button')
    row.tabIndex = 0
    row.dataset.playlistId = item.id

    const sw = document.createElement('div')
    sw.className = 'rp-swatch'
    if (item.artwork) {
      const img = document.createElement('img')
      img.src = item.artwork
      img.alt = ''
      sw.append(img)
    } else {
      sw.textContent = item.freq ? item.freq : item.provider === 'youtube' ? 'YT' : item.provider === 'spotify' ? 'SP' : item.provider === 'apple' ? 'AM' : 'FM'
    }

    const txt = document.createElement('div')
    txt.className = 'rp-item-text'
    const nm = document.createElement('div')
    nm.className = 'rp-item-name'
    nm.textContent = item.name
    const sub = document.createElement('div')
    sub.className = 'rp-item-sub'
    sub.textContent = item.subtitle ?? (item.trackCount !== undefined ? `${item.trackCount} tracks` : '')
    txt.append(nm, sub)

    const right = document.createElement('div')
    right.className = 'rp-item-right'
    if (item.freq) {
      const tag = document.createElement('span')
      tag.className = 'rp-tag'
      tag.textContent = `${item.freq} FM`
      right.append(tag)
    } else if (item.trackCount !== undefined) {
      const tag = document.createElement('span')
      tag.className = 'rp-tag'
      tag.textContent = `${item.trackCount}`
      right.append(tag)
    }
    if (isActive) {
      const tag = document.createElement('span')
      tag.className = 'rp-tag'
      tag.textContent = 'ON'
      right.append(tag)
    } else if (!connected && item.embedUrl) {
      const prevBtn = document.createElement('button')
      prevBtn.type = 'button'
      prevBtn.className = 'rp-preview-btn'
      prevBtn.textContent = 'Preview'
      prevBtn.addEventListener('click', (e) => {
        e.stopPropagation()
        previewEmbed = { title: item.name, url: item.embedUrl! }
        render(radio.state)
      })
      right.append(prevBtn)
    }

    const activate = () => {
      previewEmbed = null
      void radio.selectPlaylist(item, { playSfx: true, showUi: true })
    }
    row.addEventListener('click', activate)
    row.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate() } })

    row.append(sw, txt, right)
    return row
  }

  const render = (st: RadioState) => {
    if (!dialog) return
    if (selectedProvider !== 'fm' && !st.enabled[selectedProvider]) selectedProvider = 'fm'
    const accent = st.active
      ? st.station.accent
      : selectedProvider === 'youtube'
        ? '#FF0033'
        : selectedProvider === 'spotify'
          ? '#1DB954'
          : selectedProvider === 'apple'
            ? '#FA243C'
            : '#ff4fa0'
    dialog.style.setProperty('--rp-accent', accent)

    // Header pill
    const pill = dialog.querySelector<HTMLElement>('.rp-drive-pill')!
    pill.textContent = st.driving ? 'In Car' : 'Parked'
    pill.classList.toggle('live', st.driving)

    // Now Playing hero
    const artImg = dialog.querySelector<HTMLImageElement>('.rp-art-img')!
    const artGlyph = dialog.querySelector<HTMLElement>('.rp-art-glyph')!
    const artUrl = st.track?.artwork ?? st.playlist?.artwork
    if (artUrl) { artImg.src = artUrl; artImg.hidden = false; artGlyph.hidden = true }
    else { artImg.removeAttribute('src'); artImg.hidden = true; artGlyph.hidden = false }

    const badge = dialog.querySelector<HTMLElement>('.rp-badge')!
    badge.textContent = !st.active && st.station.id === 'off'
      ? 'RADIO OFF'
      : st.provider === 'youtube'
        ? 'YOUTUBE MUSIC'
        : st.provider === 'spotify'
          ? 'SPOTIFY'
          : st.provider === 'apple'
            ? 'APPLE MUSIC'
            : st.station.freq ? `FM ${st.station.freq}` : 'FM'

    const duckEl = dialog.querySelector<HTMLElement>('.rp-duck')!
    duckEl.hidden = st.ducking < 0.08

    const titleEl = dialog.querySelector<HTMLElement>('.rp-track-title')!
    const artistEl = dialog.querySelector<HTMLElement>('.rp-track-artist')!
    if (st.track) {
      titleEl.textContent = st.track.title
      artistEl.textContent = st.track.artist
    } else if (st.station.id === 'off') {
      titleEl.textContent = 'Radio Off'
      artistEl.textContent = st.driving ? 'Pick an FM station or stream YouTube Music' : 'Hop in a car to cruise with music'
    } else {
      titleEl.textContent = st.station.name
      artistEl.textContent = st.station.freq ? `${st.station.freq} FM · Live Procedural` : st.provider
    }

    const playBtn = dialog.querySelector<HTMLButtonElement>('.rp-play')!
    playBtn.textContent = st.playing ? '❚❚' : '▶'
    playBtn.setAttribute('aria-label', st.playing ? 'Pause' : 'Play')

    const vol = dialog.querySelector<HTMLInputElement>('.rp-vol-range')!
    if (document.activeElement !== vol) vol.value = String(Math.round(st.volume * 100))

    // Provider tabs (hide disabled providers like Spotify/Apple until enabled).
    for (const btn of dialog.querySelectorAll<HTMLButtonElement>('.rp-prov')) {
      const id = btn.dataset.provider as ProviderId
      const isEnabled = id === 'fm' || st.enabled[id]
      btn.hidden = !isEnabled
      btn.classList.toggle('on', id === selectedProvider)
      btn.setAttribute('aria-selected', String(id === selectedProvider))
      const dot = btn.querySelector<HTMLElement>('.dot')!
      const isLive = id === 'fm'
        ? st.provider === 'fm' && st.active
        : id === 'youtube'
          ? st.provider === 'youtube' && st.active
          : st.providers[id].status === 'ready' || st.providers[id].status === 'connected'
      dot.classList.toggle('live', isLive)
    }

    // Body content
    const body = dialog.querySelector<HTMLElement>('.rp-body')!
    const focusedId = document.activeElement instanceof HTMLElement ? document.activeElement.id : ''
    body.replaceChildren()

    if (selectedProvider === 'fm') {
      const note = document.createElement('p')
      note.className = 'rp-hint'
      note.textContent = 'Built-in synthesized FM stations — zero audio assets, always available offline and as fallback.'
      const list = document.createElement('div')
      list.className = 'rp-list'
      for (const item of CURATED_PLAYLISTS.fm) {
        const isOn = st.provider === 'fm' && st.station.id === item.id
        list.append(makePlaylistRow(item, isOn, true))
      }
      // Radio Off row
      const offRow = makePlaylistRow(
        { id: 'off', provider: 'fm', name: 'Radio Off', subtitle: 'Silence car radio (press N anytime to tune)', uri: 'fm:off', accent: '#9aa5b1', mood: null },
        st.provider === 'fm' && st.station.id === 'off',
        true,
      )
      offRow.addEventListener('click', (e) => { e.stopImmediatePropagation(); radio.tune('off') }, true)
      list.append(offRow)
      body.append(note, list)
      return
    }

    // YouTube Music view (zero-login, works immediately via official YouTube IFrame Player API)
    if (selectedProvider === 'youtube') {
      const provSnap = st.providers.youtube
      const ytProv = radio.getProvider('youtube') as YouTubeProvider

      const infoCard = document.createElement('div')
      infoCard.className = 'rp-acct'
      const infoRow = document.createElement('div')
      infoRow.className = 'rp-acct-row'
      const infoText = document.createElement('div')
      infoText.className = 'rp-acct-info'
      const title = document.createElement('div')
      title.className = 'rp-acct-title'
      title.textContent = 'YouTube Music · Ready'
      const sub = document.createElement('div')
      sub.className = 'rp-acct-sub'
      sub.textContent = 'No account or API key needed · plays curated SF radios or any YouTube / YouTube Music playlist link.'
      infoText.append(title, sub)
      infoRow.append(infoText)
      infoCard.append(infoRow)
      if (provSnap.error) {
        const err = document.createElement('p')
        err.className = 'rp-err'
        err.textContent = provSnap.error
        infoCard.append(err)
      }
      body.append(infoCard)

      // Sub-tabs: Curated SF | Your Playlists
      const tabs = document.createElement('div')
      tabs.className = 'rp-tabs'
      tabs.setAttribute('role', 'tablist')
      const curatedTab = document.createElement('button')
      curatedTab.type = 'button'
      curatedTab.className = `rp-tab${subTab === 'curated' ? ' on' : ''}`
      curatedTab.dataset.tab = 'curated'
      curatedTab.textContent = 'Curated SF'
      curatedTab.addEventListener('click', () => { subTab = 'curated'; render(radio.state) })

      const yoursTab = document.createElement('button')
      yoursTab.type = 'button'
      yoursTab.className = `rp-tab${subTab === 'yours' ? ' on' : ''}`
      yoursTab.dataset.tab = 'yours'
      yoursTab.textContent = provSnap.playlists.length ? `Your Playlists (${provSnap.playlists.length})` : 'Your Playlists'
      yoursTab.addEventListener('click', () => { subTab = 'yours'; render(radio.state) })

      tabs.append(curatedTab, yoursTab)
      body.append(tabs)

      const list = document.createElement('div')
      list.className = 'rp-list'
      if (subTab === 'curated') {
        for (const item of CURATED_PLAYLISTS.youtube) {
          const isOn = st.provider === 'youtube' && st.playlist?.id === item.id && st.active
          list.append(makePlaylistRow(item, isOn, true))
        }
        body.append(list)
      } else {
        const form = document.createElement('div')
        form.className = 'rp-form'
        const customRow = document.createElement('div')
        customRow.className = 'rp-input-row'
        const urlIn = document.createElement('input')
        urlIn.id = 'rp-yt-playlist'
        urlIn.type = 'text'
        urlIn.placeholder = 'Paste YouTube or YouTube Music playlist / video URL…'
        const goBtn = document.createElement('button')
        goBtn.type = 'button'
        goBtn.className = 'rp-btn primary rp-yt-add'
        goBtn.textContent = 'Play & Save'
        const nameIn = document.createElement('input')
        nameIn.id = 'rp-yt-name'
        nameIn.type = 'text'
        nameIn.placeholder = 'Optional playlist name (e.g. Late Night Drive)'

        const playAndSave = () => {
          const parsed = parseYouTubeSource(urlIn.value)
          if (!parsed) {
            customUrlStatus = 'Paste a valid YouTube or YouTube Music playlist or video URL.'
            customUrlBad = true
            render(radio.state)
            return
          }
          customUrlStatus = ''
          customUrlBad = false
          const item = typeof ytProv.addSavedPlaylist === 'function'
            ? ytProv.addSavedPlaylist(urlIn.value, nameIn.value)
            : {
                id: `yt-custom-${parsed.id}`,
                provider: 'youtube' as const,
                name: nameIn.value.trim() || 'YouTube Playlist',
                subtitle: parsed.kind === 'playlist' ? 'YouTube Music Playlist' : 'YouTube Stream',
                uri: parsed.uri,
                artwork: parsed.artwork,
                accent: '#FF0033',
                curated: false,
              }
          if (item) {
            urlIn.value = ''
            nameIn.value = ''
            void radio.selectPlaylist(item, { playSfx: true, showUi: true })
          }
        }
        goBtn.addEventListener('click', playAndSave)
        urlIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); playAndSave() } })
        nameIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); playAndSave() } })
        customRow.append(urlIn, goBtn)
        form.append(customRow, nameIn)
        body.append(form)

        if (customUrlStatus) {
          const msg = document.createElement('p')
          msg.className = customUrlBad ? 'rp-err' : 'rp-hint'
          msg.textContent = customUrlStatus
          body.append(msg)
        }

        if (provSnap.playlists.length) {
          for (const item of provSnap.playlists) {
            const isOn = st.provider === 'youtube' && st.playlist?.id === item.id && st.active
            const row = makePlaylistRow(item, isOn, true)
            if (typeof ytProv.removeSavedPlaylist === 'function') {
              const del = document.createElement('button')
              del.type = 'button'
              del.className = 'rp-preview-btn rp-yt-del'
              del.textContent = '×'
              del.setAttribute('aria-label', `Remove ${item.name}`)
              del.addEventListener('click', (e) => {
                e.stopPropagation()
                ytProv.removeSavedPlaylist(item.id)
              })
              row.querySelector('.rp-item-right')?.append(del)
            }
            list.append(row)
          }
          body.append(list)
        } else {
          const empty = document.createElement('div')
          empty.className = 'rp-empty'
          empty.textContent = 'Paste any YouTube or YouTube Music playlist link above — saved lists stay in this browser for your next drive.'
          body.append(empty)
        }
      }

      if (focusedId) {
        const restore = dialog.querySelector<HTMLElement>(`#${focusedId}`)
        if (restore && restore !== document.activeElement) restore.focus()
      }
      return
    }

    // Spotify or Apple Music view (when enabled)
    const provSnap = st.providers[selectedProvider]
    const provider = radio.getProvider(selectedProvider)
    const connected = provSnap.status === 'ready' || provSnap.status === 'connected'

    // Account card
    const acct = document.createElement('div')
    acct.className = 'rp-acct'
    const topRow = document.createElement('div')
    topRow.className = 'rp-acct-row'
    const info = document.createElement('div')
    info.className = 'rp-acct-info'
    const atitle = document.createElement('div')
    atitle.className = 'rp-acct-title'
    const asub = document.createElement('div')
    asub.className = 'rp-acct-sub'
    const actions = document.createElement('div')
    actions.className = 'rp-acct-actions'

    if (connected) {
      const acctLabel = provSnap.accountName && provSnap.accountName !== provSnap.name ? ` · ${provSnap.accountName}` : ''
      atitle.textContent = `${provSnap.name} Connected${acctLabel}`
      asub.textContent = selectedProvider === 'spotify'
        ? (provSnap.premium === false ? 'Free account detected (Premium required for in-browser playback)' : 'OAuth PKCE session stored strictly in this browser')
        : 'MusicKit JS v3 session active in this browser'
      const refreshBtn = document.createElement('button')
      refreshBtn.type = 'button'
      refreshBtn.className = 'rp-btn'
      refreshBtn.textContent = 'Refresh'
      refreshBtn.addEventListener('click', () => void provider.loadUserPlaylists())

      const discBtn = document.createElement('button')
      discBtn.type = 'button'
      discBtn.className = 'rp-btn danger rp-disconnect'
      discBtn.textContent = 'Disconnect'
      discBtn.addEventListener('click', () => void provider.disconnect())
      actions.append(refreshBtn, discBtn)
    } else {
      atitle.textContent = `Connect ${provSnap.name}`
      asub.textContent = selectedProvider === 'spotify'
        ? 'OAuth 2.0 PKCE (Spotify Premium) · tokens stay in this browser'
        : 'MusicKit JS v3 · Apple Music subscription plays full tracks'
      const connBtn = document.createElement('button')
      connBtn.type = 'button'
      connBtn.className = 'rp-btn primary rp-connect'
      connBtn.textContent = provSnap.status === 'connecting' ? 'Connecting…' : `Connect ${provSnap.name}`
      connBtn.disabled = provSnap.status === 'connecting'
      connBtn.addEventListener('click', () => {
        if (selectedProvider === 'spotify') {
          const val = (dialog?.querySelector<HTMLInputElement>('#rp-spotify-client-id')?.value ?? spotifyIdDraft).trim()
          void provider.connect(val ? { clientId: val } : undefined)
        } else {
          const val = (dialog?.querySelector<HTMLInputElement>('#rp-apple-token')?.value ?? appleTokDraft).trim()
          void provider.connect(val ? { developerToken: val } : undefined)
        }
      })
      actions.append(connBtn)
    }
    info.append(atitle, asub)
    topRow.append(info, actions)
    acct.append(topRow)

    if (!connected) {
      const form = document.createElement('div')
      form.className = 'rp-form'
      if (selectedProvider === 'spotify') {
        const inp = document.createElement('input')
        inp.id = 'rp-spotify-client-id'
        inp.type = 'text'
        inp.placeholder = 'Spotify App Client ID (PKCE — no secret needed)'
        inp.autocomplete = 'off'
        inp.spellcheck = false
        inp.value = spotifyIdDraft
        inp.addEventListener('input', () => { spotifyIdDraft = inp.value })
        const redir = canonicalSpotifyRedirectUri()
        const hint = document.createElement('p')
        hint.className = 'rp-hint'
        hint.append(
          document.createTextNode('Add Redirect URI in Spotify Developer Dashboard: '),
          Object.assign(document.createElement('code'), { textContent: redir.uri }),
          document.createTextNode(redir.isLocalhost ? ' (Spotify requires 127.0.0.1 instead of localhost).' : '.'),
        )
        form.append(inp, hint)
      } else {
        const inp = document.createElement('input')
        inp.id = 'rp-apple-token'
        inp.type = 'password'
        inp.placeholder = 'Apple Music Developer Token (JWT)'
        inp.autocomplete = 'off'
        inp.spellcheck = false
        inp.value = appleTokDraft
        inp.addEventListener('input', () => { appleTokDraft = inp.value })
        const hint = document.createElement('p')
        hint.className = 'rp-hint'
        hint.textContent = 'Stays in this browser only and configures Apple MusicKit JS v3 directly.'
        form.append(inp, hint)
      }
      acct.append(form)
    }

    if (provSnap.error) {
      const err = document.createElement('p')
      err.className = 'rp-err'
      err.textContent = provSnap.error
      acct.append(err)
    }
    body.append(acct)

    // Sub-tabs: Curated SF vs Your Playlists
    const tabs = document.createElement('div')
    tabs.className = 'rp-tabs'
    tabs.setAttribute('role', 'tablist')
    const curatedTab = document.createElement('button')
    curatedTab.type = 'button'
    curatedTab.className = `rp-tab${subTab === 'curated' ? ' on' : ''}`
    curatedTab.dataset.tab = 'curated'
    curatedTab.textContent = 'Curated SF'
    curatedTab.addEventListener('click', () => { subTab = 'curated'; render(radio.state) })

    const yoursTab = document.createElement('button')
    yoursTab.type = 'button'
    yoursTab.className = `rp-tab${subTab === 'yours' ? ' on' : ''}`
    yoursTab.dataset.tab = 'yours'
    yoursTab.textContent = provSnap.playlists.length ? `Your Playlists (${provSnap.playlists.length})` : 'Your Playlists'
    yoursTab.addEventListener('click', () => { subTab = 'yours'; render(radio.state) })

    tabs.append(curatedTab, yoursTab)
    body.append(tabs)

    // Optional explicit embed preview (only when user clicked Preview while disconnected)
    if (previewEmbed && !connected) {
      const wrap = document.createElement('div')
      wrap.className = 'rp-embed-wrap'
      const bar = document.createElement('div')
      bar.className = 'rp-embed-bar'
      const lbl = document.createElement('span')
      lbl.textContent = `Preview · ${previewEmbed.title}`
      const hideBtn = document.createElement('button')
      hideBtn.type = 'button'
      hideBtn.className = 'rp-preview-btn'
      hideBtn.textContent = 'Close preview'
      hideBtn.addEventListener('click', () => { previewEmbed = null; render(radio.state) })
      bar.append(lbl, hideBtn)
      const frame = document.createElement('iframe')
      frame.src = previewEmbed.url
      frame.allow = 'autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture'
      frame.loading = 'lazy'
      frame.title = `${previewEmbed.title} preview`
      wrap.append(bar, frame)
      body.append(wrap)
    }

    const list = document.createElement('div')
    list.className = 'rp-list'

    if (subTab === 'curated') {
      for (const item of CURATED_PLAYLISTS[selectedProvider]) {
        const isOn = st.provider === selectedProvider && st.playlist?.id === item.id
        list.append(makePlaylistRow(item, isOn, connected))
      }
      body.append(list)
    } else {
      if (!connected) {
        const empty = document.createElement('div')
        empty.className = 'rp-empty'
        empty.textContent = `Connect ${provSnap.name} above to load your personal playlists and Liked library while driving.`
        body.append(empty)
      } else {
        // Quick play by custom playlist URL / URI
        const customRow = document.createElement('div')
        customRow.className = 'rp-input-row'
        const urlIn = document.createElement('input')
        urlIn.id = 'rp-custom-playlist'
        urlIn.type = 'text'
        urlIn.placeholder = selectedProvider === 'spotify' ? 'Paste Spotify playlist link or URI…' : 'Paste Apple Music playlist link or ID…'
        const goBtn = document.createElement('button')
        goBtn.type = 'button'
        goBtn.className = 'rp-btn primary'
        goBtn.textContent = 'Play'
        const playCustom = () => {
          const parsed = selectedProvider === 'spotify' ? parseSpotifyPlaylistUri(urlIn.value) : parseApplePlaylistId(urlIn.value)
          if (!parsed) {
            customUrlStatus = `Paste a valid ${provSnap.name} playlist URL or ID.`
            customUrlBad = true
            render(radio.state)
            return
          }
          customUrlStatus = ''
          customUrlBad = false
          void radio.selectPlaylist({
            id: `custom-${parsed}`,
            provider: selectedProvider,
            name: 'Custom Playlist',
            subtitle: `${provSnap.name} · Custom`,
            uri: parsed,
            accent: provSnap.accent,
            curated: false,
          })
        }
        goBtn.addEventListener('click', playCustom)
        urlIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); playCustom() } })
        customRow.append(urlIn, goBtn)
        body.append(customRow)
        if (customUrlStatus) {
          const msg = document.createElement('p')
          msg.className = customUrlBad ? 'rp-err' : 'rp-hint'
          msg.textContent = customUrlStatus
          body.append(msg)
        }

        if (provSnap.playlists.length) {
          for (const item of provSnap.playlists) {
            const isOn = st.provider === selectedProvider && st.playlist?.id === item.id
            list.append(makePlaylistRow(item, isOn, true))
          }
          body.append(list)
        } else {
          const empty = document.createElement('div')
          empty.className = 'rp-empty'
          empty.textContent = `No playlists loaded yet from ${provSnap.name}. Click Refresh above or paste a playlist link.`
          body.append(empty)
        }
      }
    }

    if (focusedId) {
      const restore = dialog.querySelector<HTMLElement>(`#${focusedId}`)
      if (restore && restore !== document.activeElement) restore.focus()
    }
  }

  const open = (tab?: ProviderId) => {
    if (!dialog) build()
    if (tab) selectedProvider = tab
    else if (radio.state.active) selectedProvider = radio.state.provider
    render(radio.state)
    if (!unsubRadio) {
      unsubRadio = radio.subscribe((st) => {
        if (dialog?.open) render(st)
      })
    }
    if (dialog!.open) return
    leaveInput = input.push({ name: 'radio-picker', solid: true, text: true })
    dialog!.showModal()
  }

  const close = () => {
    if (!dialog?.open) return
    previewEmbed = null
    leaveInput?.()
    leaveInput = null
    dialog.close()
  }

  const toggle = () => {
    if (dialog?.open) close()
    else open()
  }

  radio.onOpenPicker((tab) => open(tab))

  return {
    open,
    close,
    toggle,
    get isOpen() { return !!dialog?.open },
    dispose() {
      close()
      unsubRadio?.()
      unsubRadio = null
      radio.onOpenPicker(null)
      visualViewport?.removeEventListener('resize', fitViewport)
      dialog?.remove()
      dialog = null
      styleEl?.remove()
      styleEl = null
    },
  }
}
