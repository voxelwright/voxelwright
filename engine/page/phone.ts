// Extensible GTA 6–inspired Handheld Smartphone OS for Voxelwright.
// Designed so DoorSmash is the flagship app while any future apps/games register cleanly via `registerApp()`.
// Opening the phone while driving transitions automatically into first-person driver's seat view (`alive.view(true)`)
// and docks the tilted phone cleanly in the lower-right cockpit hand without blocking driving controls or the road!
import type { Hud } from './hud.ts'
import type { Input } from './input.ts'
import { playDeliverySfx, type DeliverySfx } from './delivery-sound.ts'
import type { Sound } from './sound/sound.ts'

export interface PhoneNotification {
  id?: string
  appId: string
  title: string
  body: string
  accent?: string
  durationMs?: number
  sound?: DeliverySfx
  onClick?: () => void
}

export interface PhoneAppContext {
  close(): void
  goHome(): void
  openApp(appId: string): void
  notify(n: PhoneNotification): void
  sfx(kind: DeliverySfx): void
  setBadge(count: number | string | null): void
  setStatusChip(text: string | null): void
  readonly driving: boolean
}

export interface PhoneAppInstance {
  onShow?(): void
  onHide?(): void
  onTick?(dt: number): void
  onKey?(code: string): boolean | void
  destroy?(): void
}

export interface PhoneApp {
  id: string
  name: string
  subtitle?: string
  accent: string
  iconSvg: string
  /** Optional sort weight (lower appears earlier on home screen). */
  order?: number
  badge?: () => number | string | null
  mount(container: HTMLElement, ctx: PhoneAppContext): PhoneAppInstance
}

export interface PhoneOptions {
  hud: Hud
  input: Input
  hour: () => number
  engaged: () => boolean
  driving: () => boolean
  /** True when inside a map, settings drawer, radial wheel, or ask composer. */
  blocked: () => boolean
  /** Hook called when phone opens/closes so main.ts can switch driving into first-person seat & set on-foot reading pose. */
  onOpenChange?: (open: boolean, driving: boolean) => void
  /** Optional sound synthesizer getter. */
  sound?: () => Sound | null
  /** Optional driving telemetry getter for subtle cockpit phone vibration & corner sway. */
  telemetry?: () => { kmh: number; slip: number; drifting: boolean } | null
}

export interface RectBox {
  left: number
  top: number
  right: number
  bottom: number
}

export interface MobileDriveDock {
  left: number
  top: number
  width: number
  height: number
  orientation: 'portrait' | 'landscape'
}

/**
 * Computes a dashboard car-mount placement for the smartphone on mobile touch while driving
 * so steering & pedal controls stay 100% uncovered AND the windshield road sightline stays open!
 */
export function computeMobileDriveDock(opts: {
  vw: number
  vh: number
  safe: { top: number; bottom: number; left: number; right: number }
  controls: readonly RectBox[]
  topHudBottom: number
}): MobileDriveDock {
  const { vw, vh, safe, controls, topHudBottom } = opts
  const portrait = vh > vw
  if (portrait) {
    let clusterTop = vh - safe.bottom - 186
    for (const r of controls) {
      if ((r.top + r.bottom) * 0.5 >= vh * 0.45 && r.top < clusterTop) clusterTop = r.top
    }
    const topClear = Math.max(safe.top + 82, topHudBottom + 8)
    const avail = Math.max(140, clusterTop - 10 - topClear)
    // Keep upper ~44% of the clear band open for the first-person windshield road view!
    const height = Math.round(Math.min(avail - 4, Math.max(170, Math.min(248, avail * 0.56))))
    const width = Math.round(Math.max(220, Math.min(342, vw - safe.left - safe.right - 24)))
    const left = Math.round(safe.left + (vw - safe.left - safe.right - width) / 2)
    const top = Math.round(Math.max(topClear, clusterTop - 10 - height))
    return { left, top, width, height, orientation: 'portrait' }
  }

  // Landscape: dock neatly in the open dashboard gap BETWEEN the left & right thumb driving clusters!
  let leftLimit = safe.left + 14
  let rightLimit = vw - safe.right - 14
  let clusterTop = vh - safe.bottom - 170
  for (const r of controls) {
    const midY = (r.top + r.bottom) * 0.5
    if (midY < vh * 0.32) continue
    if (r.top < clusterTop) clusterTop = r.top
    const midX = (r.left + r.right) * 0.5
    if (midX < vw * 0.5) leftLimit = Math.max(leftLimit, r.right + 10)
    else rightLimit = Math.min(rightLimit, r.left - 10)
  }
  const topClear = Math.max(safe.top + 62, topHudBottom + 8)
  const gapW = rightLimit - leftLimit
  if (gapW >= 186) {
    const width = Math.round(Math.min(316, gapW))
    const left = Math.round(leftLimit + (gapW - width) / 2)
    const bottomEdge = vh - safe.bottom - 10
    const availH = Math.max(140, bottomEdge - topClear)
    const height = Math.round(Math.min(availH, Math.max(172, Math.min(232, availH * 0.80))))
    const top = Math.round(bottomEdge - height)
    return { left, top, width, height, orientation: 'landscape' }
  }
  // Fallback on very cramped landscape screens: dock cleanly above the thumb controls
  const width = Math.round(Math.max(220, Math.min(320, vw - safe.left - safe.right - 28)))
  const left = Math.round(safe.left + (vw - safe.left - safe.right - width) / 2)
  const availH = Math.max(120, clusterTop - 8 - topClear)
  const height = Math.round(Math.min(200, availH))
  const top = Math.round(Math.max(topClear, clusterTop - 8 - height))
  return { left, top, width, height, orientation: 'landscape' }
}

export interface PhoneOS {
  readonly open: boolean
  readonly activeAppId: string | null
  readonly apps: readonly PhoneApp[]
  registerApp(app: PhoneApp): void
  unregisterApp(id: string): void
  openPhone(appId?: string): void
  closePhone(): void
  toggle(appId?: string): void
  openApp(appId: string): void
  goHome(): void
  notify(n: PhoneNotification): void
  dismissNotification(): void
  setStatusChip(text: string | null): void
  frame(dt: number): void
  destroy(): void
}

const STYLE = /* css */ `
/* ── Smartphone OS Trigger Button (slim HUD-safe corner slot, hidden in first view / menus) ── */
[data-panel="phone-trigger"] {
  position: fixed;
  top: max(18px, calc(env(safe-area-inset-top, 0px) + 14px));
  right: calc(max(18px, env(safe-area-inset-right, 0px) + 14px) + 58px);
  z-index: 8;
  pointer-events: auto;
  display: flex;
  align-items: center;
}
html.first [data-panel="phone-trigger"],
html.map-open [data-panel="phone-trigger"],
html.drawer [data-panel="phone-trigger"],
html.choosing [data-panel="phone-trigger"],
html.phone-open [data-panel="phone-trigger"],
html[data-hud="quiet"].away [data-panel="phone-trigger"],
html:has(#ask.open, #radio-picker[open], #realm.open, #realm .egg-line:not([hidden])) [data-panel="phone-trigger"] {
  display: none !important;
}
/* On touch portrait/landscape, stay cleanly clear of .fold, #minimap, drive-hud, drive-util, and thumb pedals. */
@media (pointer: coarse) {
  [data-panel="phone-trigger"] {
    top: calc(env(safe-area-inset-top, 0px) + 14px);
    right: calc(max(14px, env(safe-area-inset-right, 0px) + 14px) + 56px);
  }
  html.riding [data-panel="phone-trigger"] {
    right: auto;
    left: max(14px, calc(env(safe-area-inset-left, 0px) + 14px));
    top: calc(env(safe-area-inset-top, 0px) + 98px);
  }
  html.riding.driving:has([data-panel="radio-yt"]:not([hidden])) [data-panel="phone-trigger"] {
    display: none !important;
  }
  html.riding [data-panel="phone-trigger"] .ph-trig-kbd { display: none; }
}
@media (pointer: coarse) and (orientation: landscape) {
  html.riding [data-panel="phone-trigger"] {
    left: calc(max(14px, env(safe-area-inset-left, 0px) + 14px) + 148px);
    top: calc(env(safe-area-inset-top, 0px) + 14px);
  }
}
.ph-trig {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 36px;
  padding: 0 11px 0 9px;
  border-radius: 9px;
  border: 1.5px solid rgba(110, 134, 170, 0.45);
  background: rgba(18, 24, 36, 0.78);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  color: #f0f4fa;
  font: 600 12px/1 -apple-system, BlinkMacSystemFont, "SF Pro Text", "IBM Plex Sans", system-ui, sans-serif;
  letter-spacing: 0.015em;
  cursor: pointer;
  touch-action: manipulation;
  box-shadow: 0 5px 18px rgba(0, 0, 0, 0.34), inset 0 1px 0 rgba(255, 255, 255, 0.14);
  transition: transform 0.14s ease, border-color 0.16s ease, background 0.16s ease;
}
@media (pointer: coarse) {
  .ph-trig { min-width: 44px; min-height: 44px; padding: 0 12px; }
  .ph-trig-lbl { display: none; }
}
.ph-trig:hover {
  transform: translateY(-1px);
  border-color: rgba(255, 92, 72, 0.78);
  background: rgba(24, 32, 48, 0.88);
}
.ph-trig-badge {
  position: absolute;
  top: -5px;
  right: -5px;
  min-width: 17px;
  height: 17px;
  padding: 0 4px;
  border-radius: 999px;
  background: #ff3b30;
  color: #fff;
  font: 800 10px/17px -apple-system, system-ui, sans-serif;
  text-align: center;
  box-shadow: 0 2px 8px rgba(255, 59, 48, 0.65);
}
.ph-trig-badge[hidden] { display: none; }
.ph-trig-kbd {
  padding: 2px 4px;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.12);
  color: rgba(240, 244, 250, 0.76);
  font: 600 10px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
}

/* ── Dynamic Island Notification Toast (top-right under Phone button so it never overlaps hud.notice) ── */
[data-panel="phone-toast"] {
  position: fixed;
  top: max(62px, calc(env(safe-area-inset-top, 0px) + 60px));
  right: max(18px, calc(env(safe-area-inset-right, 0px) + 16px));
  left: auto;
  transform: translateY(-12px) scale(0.95);
  z-index: 32;
  pointer-events: none;
  opacity: 0;
  transition: opacity 0.2s ease, transform 0.24s cubic-bezier(0.22, 1, 0.36, 1);
}
[data-panel="phone-toast"].show {
  opacity: 1;
  pointer-events: auto;
  transform: translateY(0) scale(1);
}
html.first [data-panel="phone-toast"],
html.map-open [data-panel="phone-toast"],
html.phone-open [data-panel="phone-toast"] { display: none !important; }
.ph-island {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 240px;
  max-width: min(390px, calc(100vw - 32px));
  padding: 9px 14px 9px 11px;
  border-radius: 22px;
  border: 1px solid rgba(255, 255, 255, 0.18);
  background: rgba(11, 13, 18, 0.92);
  backdrop-filter: blur(18px);
  -webkit-backdrop-filter: blur(18px);
  color: #f5f7fb;
  cursor: pointer;
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.52);
  text-align: left;
}
.ph-island-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex: none;
  box-shadow: 0 0 10px currentColor;
}
.ph-island-copy { min-width: 0; flex: 1; }
.ph-island-title {
  font: 700 12px/1.2 -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ph-island-body {
  font: 500 11.5px/1.25 -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
  color: rgba(235, 240, 248, 0.78);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-top: 2px;
}
.ph-island-cta {
  font: 700 10px/1 -apple-system, system-ui, sans-serif;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  padding: 5px 8px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.14);
  color: #fff;
  flex: none;
}

/* ── Handheld Smartphone Shell (GTA 6 style bottom-right device) ── */
[data-panel="phone"] {
  position: fixed;
  right: max(20px, calc(env(safe-area-inset-right, 0px) + 18px));
  bottom: max(18px, calc(env(safe-area-inset-bottom, 0px) + 16px));
  z-index: 30;
  pointer-events: none;
  perspective: 1100px;
  opacity: 0;
  transform: translateY(48px) scale(0.95);
  transition: opacity 0.22s ease, transform 0.28s cubic-bezier(0.2, 0.9, 0.25, 1);
}
[data-panel="phone"].open {
  opacity: 1;
  pointer-events: auto;
  transform: translateY(0) scale(1);
}
html.first [data-panel="phone"],
html.map-open [data-panel="phone"] { display: none !important; }
@media (prefers-reduced-motion: reduce) {
  [data-panel="phone"], [data-panel="phone-toast"] { transition: opacity 0.12s linear !important; transform: none !important; }
}
/* While driving in GTA 6 first-person cockpit view, lift above the drive-hud or dock hand-angled cleanly! */
html.riding.driving [data-panel="phone"] {
  bottom: max(106px, calc(env(safe-area-inset-bottom, 0px) + 102px));
}
@media (max-height: 690px) {
  html.riding.driving [data-panel="phone"] {
    bottom: max(14px, calc(env(safe-area-inset-bottom, 0px) + 12px));
  }
}
@media (max-width: 520px) {
  [data-panel="phone"]:not(.mobile-drive-dock) {
    right: 50%;
    transform: translateX(50%) translateY(40px) scale(0.95);
    bottom: max(12px, calc(env(safe-area-inset-bottom, 0px) + 10px));
  }
  [data-panel="phone"]:not(.mobile-drive-dock).open {
    transform: translateX(50%) translateY(0) scale(1);
  }
}

.ph-chassis {
  position: relative;
  box-sizing: border-box;
  width: min(326px, calc(100vw - 24px));
  height: min(566px, calc(100dvh - 110px));
  min-height: min(340px, calc(100dvh - 28px));
  border-radius: 36px;
  padding: 9px;
  background: linear-gradient(145deg, #2d3442 0%, #171b24 45%, #0c0f15 100%);
  box-shadow:
    0 24px 60px rgba(0, 0, 0, 0.68),
    0 0 0 1.5px rgba(255, 255, 255, 0.2),
    inset 0 1px 1px rgba(255, 255, 255, 0.25),
    inset 0 -2px 6px rgba(0, 0, 0, 0.65);
  display: flex;
  flex-direction: column;
  transform-origin: bottom right;
  transition: transform 0.22s ease;
  font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "IBM Plex Sans", system-ui, sans-serif;
  color: #f3f6fb;
  user-select: none;
  -webkit-user-select: none;
}
/* Compact mobile landscape on-foot fit so the chassis never overflows short screens */
@media (pointer: coarse) and (orientation: landscape) {
  [data-panel="phone"]:not(.mobile-drive-dock) {
    bottom: max(10px, calc(env(safe-area-inset-bottom, 0px) + 8px));
  }
  [data-panel="phone"]:not(.mobile-drive-dock) .ph-chassis {
    height: calc(100dvh - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px) - 20px);
    min-height: 220px;
    border-radius: 24px;
    padding: 6px;
  }
  [data-panel="phone"]:not(.mobile-drive-dock) .ph-screen { border-radius: 19px; }
  [data-panel="phone"]:not(.mobile-drive-dock) .ph-status { height: 24px; padding: 0 12px; }
  [data-panel="phone"]:not(.mobile-drive-dock) .ph-notch { display: none; }
}
/* Mobile touch dashboard car-mount mode while driving: leaves steering, pedals & windshield completely clear! */
[data-panel="phone"].mobile-drive-dock {
  right: auto !important;
  bottom: auto !important;
  perspective: none;
  transform: translateY(18px) scale(0.97);
}
[data-panel="phone"].mobile-drive-dock.open {
  transform: translateY(0) scale(1);
}
[data-panel="phone"].mobile-drive-dock .ph-chassis {
  min-height: 0;
  border-radius: 20px;
  padding: 5px;
  box-shadow:
    0 12px 32px rgba(0, 0, 0, 0.58),
    0 0 0 1.5px rgba(255, 255, 255, 0.22),
    inset 0 1px 1px rgba(255, 255, 255, 0.2);
  transform: none !important;
}
[data-panel="phone"].mobile-drive-dock .ph-screen { border-radius: 15px; }
[data-panel="phone"].mobile-drive-dock .ph-status { height: 22px; padding: 0 10px; font-size: 10px; }
[data-panel="phone"].mobile-drive-dock .ph-notch { display: none; }
[data-panel="phone"].mobile-drive-dock .ph-home { padding: 8px 10px; gap: 8px; }
[data-panel="phone"].mobile-drive-dock .ph-widget { padding: 8px 10px; border-radius: 12px; }
[data-panel="phone"].mobile-drive-dock .ph-widget-big { font-size: 15px; }
[data-panel="phone"].mobile-drive-dock .ph-app-ic { width: 42px; height: 42px; border-radius: 11px; }
[data-panel="phone"].mobile-drive-dock .ph-foot { height: 24px; padding: 0 10px 2px; }
[data-panel="phone"].mobile-drive-dock .ph-homebar { width: 64px; height: 3px; }
/* First-person cockpit handheld angle when driving on desktop */
[data-panel="phone"].driving-hand:not(.mobile-drive-dock) .ph-chassis {
  transform: rotateY(-7deg) rotateX(4deg) rotateZ(-1.4deg);
}
@media (prefers-reduced-motion: reduce) {
  [data-panel="phone"].driving-hand .ph-chassis { transform: none !important; }
}

.ph-screen {
  position: relative;
  flex: 1;
  min-height: 0;
  border-radius: 28px;
  overflow: hidden;
  background: radial-gradient(circle at 20% 10%, #1d2c4b 0%, #0e1422 52%, #090c13 100%);
  display: flex;
  flex-direction: column;
  border: 1px solid rgba(255, 255, 255, 0.08);
}

.ph-status {
  position: relative;
  flex: none;
  height: 34px;
  padding: 0 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  font: 700 11.5px/1 -apple-system, system-ui, sans-serif;
  color: rgba(245, 248, 252, 0.94);
  z-index: 4;
  background: linear-gradient(180deg, rgba(8, 10, 16, 0.62) 0%, rgba(8, 10, 16, 0) 100%);
}
.ph-notch {
  position: absolute;
  left: 50%;
  top: 7px;
  transform: translateX(-50%);
  width: 82px;
  height: 20px;
  border-radius: 12px;
  background: #06070a;
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.08);
  display: flex;
  align-items: center;
  justify-content: flex-end;
  padding-right: 7px;
}
.ph-cam {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: radial-gradient(circle at 35% 35%, #3c5b8c, #0a1020 70%);
}
.ph-status-r {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 10.5px;
  font-variant-numeric: tabular-nums;
}
.ph-chip {
  padding: 2px 6px;
  border-radius: 999px;
  background: rgba(52, 211, 153, 0.2);
  color: #6ee7b7;
  font: 700 10px/1.1 ui-monospace, SFMono-Regular, Menlo, monospace;
}
.ph-chip[hidden] { display: none; }

.ph-body {
  position: relative;
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* Home Screen */
.ph-home {
  flex: 1;
  display: flex;
  flex-direction: column;
  padding: 14px 16px 12px;
  gap: 14px;
  overflow-y: auto;
}
.ph-home[hidden] { display: none; }
.ph-widget {
  padding: 13px 14px;
  border-radius: 18px;
  background: linear-gradient(135deg, rgba(255, 255, 255, 0.12), rgba(255, 255, 255, 0.04));
  border: 1px solid rgba(255, 255, 255, 0.13);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.14);
}
.ph-widget-kicker {
  font: 700 10px/1.1 -apple-system, system-ui, sans-serif;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: rgba(210, 224, 245, 0.72);
}
.ph-widget-big {
  font: 800 22px/1.15 -apple-system, system-ui, sans-serif;
  letter-spacing: -0.02em;
  margin-top: 4px;
}
.ph-widget-sub {
  font: 500 11.5px/1.3 -apple-system, system-ui, sans-serif;
  color: rgba(226, 234, 246, 0.78);
  margin-top: 3px;
}
.ph-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 14px 10px;
}
.ph-app-btn {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 5px;
  border: 0;
  background: transparent;
  padding: 0;
  color: #f3f6fb;
  cursor: pointer;
  touch-action: manipulation;
}
.ph-app-ic {
  position: relative;
  width: 54px;
  height: 54px;
  border-radius: 15px;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 8px 18px rgba(0, 0, 0, 0.38), inset 0 1px 1px rgba(255, 255, 255, 0.32);
  transition: transform 0.14s ease;
}
.ph-app-btn:hover .ph-app-ic { transform: scale(1.06); }
.ph-app-btn:active .ph-app-ic { transform: scale(0.95); }
.ph-app-name {
  font: 600 10.5px/1.15 -apple-system, system-ui, sans-serif;
  color: rgba(242, 246, 252, 0.92);
  text-align: center;
  max-width: 68px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ph-app-badge {
  position: absolute;
  top: -5px;
  right: -5px;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: 999px;
  background: #ff3b30;
  color: #fff;
  font: 800 10px/18px -apple-system, system-ui, sans-serif;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.45);
}
.ph-app-badge[hidden] { display: none; }
.ph-slot-empty .ph-app-ic {
  background: rgba(255, 255, 255, 0.05);
  border: 1px dashed rgba(255, 255, 255, 0.18);
  box-shadow: none;
  color: rgba(255, 255, 255, 0.32);
}
.ph-slot-empty { cursor: default; opacity: 0.72; }
.ph-slot-empty:hover .ph-app-ic { transform: none; }

.ph-app-stage {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.ph-app-stage[hidden] { display: none; }

/* Bottom gesture bar + quick close/home controls */
.ph-foot {
  flex: none;
  height: 28px;
  padding: 0 14px 4px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: rgba(8, 10, 16, 0.88);
  border-top: 1px solid rgba(255, 255, 255, 0.06);
}
.ph-foot-btn {
  border: 0;
  background: transparent;
  color: rgba(215, 224, 240, 0.76);
  font: 600 10.5px/1 -apple-system, system-ui, sans-serif;
  padding: 4px 8px;
  border-radius: 6px;
  cursor: pointer;
}
.ph-foot-btn:hover { background: rgba(255, 255, 255, 0.1); color: #fff; }
.ph-homebar {
  width: 96px;
  height: 4px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.48);
  border: 0;
  padding: 0;
  cursor: pointer;
}
.ph-homebar:hover { background: rgba(255, 255, 255, 0.85); }
`

const PHONE_ICON_SVG = `<svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="2.2" width="10" height="15.6" rx="2.4"/><path d="M8.5 4.8h3"/><circle cx="10" cy="14.9" r="0.8" fill="currentColor" stroke="none"/></svg>`

function formatClock(hour: number): string {
  const norm = ((hour % 24) + 24) % 24
  const h24 = Math.floor(norm)
  const m = Math.floor((norm - h24) * 60)
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12
  return `${h12}:${String(m).padStart(2, '0')}`
}

export function createPhone(opts: PhoneOptions): PhoneOS {
  if (typeof document !== 'undefined' && !document.getElementById('vw-phone-style')) {
    const st = document.createElement('style')
    st.id = 'vw-phone-style'
    st.textContent = STYLE
    document.head.append(st)
  }

  const trigPanel = opts.hud.panel('phone-trigger')
  const trigBtn = document.createElement('button')
  trigBtn.type = 'button'
  trigBtn.className = 'ph-trig'
  trigBtn.setAttribute('aria-label', 'Open Phone (Up Arrow)')
  trigBtn.title = 'Open Phone (↑ / P)'
  trigBtn.innerHTML = `${PHONE_ICON_SVG}<span class="ph-trig-lbl">Phone</span><span class="ph-trig-kbd">↑</span><span class="ph-trig-badge" hidden></span>`
  const trigBadge = trigBtn.querySelector<HTMLElement>('.ph-trig-badge')!
  trigPanel.append(trigBtn)

  const toastPanel = opts.hud.panel('phone-toast')
  const islandBtn = document.createElement('button')
  islandBtn.type = 'button'
  islandBtn.className = 'ph-island'
  islandBtn.innerHTML = `<span class="ph-island-dot"></span><div class="ph-island-copy"><div class="ph-island-title"></div><div class="ph-island-body"></div></div><span class="ph-island-cta">Open</span>`
  const islandDot = islandBtn.querySelector<HTMLElement>('.ph-island-dot')!
  const islandTitle = islandBtn.querySelector<HTMLElement>('.ph-island-title')!
  const islandBody = islandBtn.querySelector<HTMLElement>('.ph-island-body')!
  toastPanel.append(islandBtn)

  const panel = opts.hud.panel('phone')
  panel.setAttribute('role', 'dialog')
  panel.setAttribute('aria-label', 'Smartphone')
  panel.innerHTML = `
    <div class="ph-chassis">
      <div class="ph-screen">
        <div class="ph-status">
          <span class="ph-time">12:00</span>
          <div class="ph-notch"><span class="ph-cam"></span></div>
          <div class="ph-status-r">
            <span class="ph-chip" hidden></span>
            <span>5G</span>
            <span>94%</span>
          </div>
        </div>
        <div class="ph-body">
          <div class="ph-home">
            <div class="ph-widget">
              <div class="ph-widget-kicker">San Francisco · BayOS 6</div>
              <div class="ph-widget-big">Ready to roll</div>
              <div class="ph-widget-sub">Tap DoorSmash to accept deliveries or install future apps.</div>
            </div>
            <div class="ph-grid"></div>
          </div>
          <div class="ph-app-stage" hidden></div>
        </div>
        <div class="ph-foot">
          <button type="button" class="ph-foot-btn ph-btn-home">Apps</button>
          <button type="button" class="ph-homebar" aria-label="Home"></button>
          <button type="button" class="ph-foot-btn ph-btn-close">Stow ↓</button>
        </div>
      </div>
    </div>
  `
  const chassis = panel.querySelector<HTMLElement>('.ph-chassis')!
  const timeEl = panel.querySelector<HTMLElement>('.ph-time')!
  const chipEl = panel.querySelector<HTMLElement>('.ph-chip')!
  const homeEl = panel.querySelector<HTMLElement>('.ph-home')!
  const widgetBig = panel.querySelector<HTMLElement>('.ph-widget-big')!
  const widgetSub = panel.querySelector<HTMLElement>('.ph-widget-sub')!
  const gridEl = panel.querySelector<HTMLElement>('.ph-grid')!
  const stageEl = panel.querySelector<HTMLElement>('.ph-app-stage')!
  const btnHome = panel.querySelector<HTMLButtonElement>('.ph-btn-home')!
  const homeBar = panel.querySelector<HTMLButtonElement>('.ph-homebar')!
  const btnClose = panel.querySelector<HTMLButtonElement>('.ph-btn-close')!

  const apps = new Map<string, PhoneApp>()
  const mounted = new Map<string, { root: HTMLElement; inst: PhoneAppInstance }>()
  const badges = new Map<string, number | string | null>()

  let isOpen = false
  let activeAppId: string | null = null
  let toastTimer: ReturnType<typeof setTimeout> | null = null
  let toastAction: (() => void) | null = null
  let lastDriving = false
  let vibePhase = 0
  let clockAcc = 0

  const play = (k: DeliverySfx) => playDeliverySfx(opts.sound?.(), k)

  const syncBadges = () => {
    let totalNum = 0
    let anyStr: string | null = null
    for (const [id, app] of apps) {
      const b = badges.has(id) ? badges.get(id)! : (app.badge?.() ?? null)
      const el = gridEl.querySelector<HTMLElement>(`[data-app-id="${id}"] .ph-app-badge`)
      if (el) {
        if (b !== null && b !== 0 && b !== '') {
          el.textContent = String(b)
          el.hidden = false
        } else {
          el.hidden = true
        }
      }
      if (typeof b === 'number' && b > 0) totalNum += b
      else if (typeof b === 'string' && b) anyStr = b
    }
    if (totalNum > 0) {
      trigBadge.textContent = totalNum > 9 ? '9+' : String(totalNum)
      trigBadge.hidden = false
    } else if (anyStr) {
      trigBadge.textContent = anyStr
      trigBadge.hidden = false
    } else {
      trigBadge.hidden = true
    }
  }

  const renderHomeGrid = () => {
    gridEl.replaceChildren()
    const sorted = [...apps.values()].sort((a, b) => (a.order ?? 10) - (b.order ?? 10))
    for (const app of sorted) {
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.className = 'ph-app-btn'
      btn.dataset.appId = app.id
      btn.innerHTML = `<span class="ph-app-ic" style="background:${app.accent}">${app.iconSvg}<span class="ph-app-badge" hidden></span></span><span class="ph-app-name"></span>`
      btn.querySelector('.ph-app-name')!.textContent = app.name
      btn.addEventListener('click', () => {
        play('tap')
        openApp(app.id)
      })
      gridEl.append(btn)
    }
    // Show extensible future slots so the OS communicates its multi-app architecture cleanly.
    const placeholders = Math.max(0, 4 - sorted.length)
    for (let i = 0; i < placeholders; i++) {
      const slot = document.createElement('div')
      slot.className = 'ph-app-btn ph-slot-empty'
      slot.setAttribute('aria-hidden', 'true')
      slot.innerHTML = `<span class="ph-app-ic"><svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M10 5v10M5 10h10"/></svg></span><span class="ph-app-name">${i === 0 ? 'More Apps' : 'Slot'}</span>`
      gridEl.append(slot)
    }
    syncBadges()
  }

  const ensureMounted = (app: PhoneApp) => {
    const existing = mounted.get(app.id)
    if (existing) return existing
    const root = document.createElement('div')
    root.style.cssText = 'flex:1;min-height:0;display:flex;flex-direction:column;overflow:hidden;'
    root.dataset.phoneApp = app.id
    const ctx: PhoneAppContext = {
      close: closePhone,
      goHome,
      openApp,
      notify,
      sfx: play,
      setBadge: (val) => { badges.set(app.id, val); syncBadges() },
      setStatusChip,
      get driving() { return opts.driving() },
    }
    const inst = app.mount(root, ctx)
    const entry = { root, inst }
    mounted.set(app.id, entry)
    return entry
  }

  const openApp = (appId: string) => {
    const app = apps.get(appId)
    if (!app) return
    if (activeAppId && activeAppId !== appId) {
      mounted.get(activeAppId)?.inst.onHide?.()
    }
    activeAppId = appId
    const entry = ensureMounted(app)
    stageEl.replaceChildren(entry.root)
    homeEl.hidden = true
    stageEl.hidden = false
    entry.inst.onShow?.()
    if (!isOpen) openPhone(appId)
  }

  const goHome = () => {
    if (activeAppId) {
      mounted.get(activeAppId)?.inst.onHide?.()
      activeAppId = null
    }
    stageEl.hidden = true
    homeEl.hidden = false
    syncBadges()
  }

  const setStatusChip = (text: string | null) => {
    if (text) {
      chipEl.textContent = text
      chipEl.hidden = false
    } else {
      chipEl.hidden = true
    }
  }

  const notify = (n: PhoneNotification) => {
    if (!opts.engaged()) return
    if (n.sound) play(n.sound)
    islandDot.style.color = n.accent ?? '#ff4d3d'
    islandDot.style.background = n.accent ?? '#ff4d3d'
    islandTitle.textContent = n.title
    islandBody.textContent = n.body
    toastAction = () => {
      hideToast()
      openPhone(n.appId)
      n.onClick?.()
    }
    toastPanel.classList.add('show')
    if (toastTimer) clearTimeout(toastTimer)
    toastTimer = setTimeout(hideToast, n.durationMs ?? 5200)
  }

  const hideToast = () => {
    if (toastTimer) { clearTimeout(toastTimer); toastTimer = null }
    toastPanel.classList.remove('show')
  }

  islandBtn.addEventListener('click', () => toastAction?.())

  let lastDockSig = ''
  const isTouchViewport = () => typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches

  const readSafeInsets = () => {
    const probe = document.createElement('div')
    probe.style.cssText = 'position:fixed;inset:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px);pointer-events:none;visibility:hidden;'
    document.body.append(probe)
    const r = probe.getBoundingClientRect()
    probe.remove()
    return {
      top: Math.max(0, Math.round(r.top)),
      left: Math.max(0, Math.round(r.left)),
      right: Math.max(0, Math.round(innerWidth - r.right)),
      bottom: Math.max(0, Math.round(innerHeight - r.bottom)),
    }
  }

  const clearMobileDock = () => {
    if (!panel.classList.contains('mobile-drive-dock') && !lastDockSig) return
    panel.classList.remove('mobile-drive-dock')
    document.documentElement.classList.remove('phone-drive-dock')
    panel.style.left = ''
    panel.style.top = ''
    chassis.style.width = ''
    chassis.style.height = ''
    lastDockSig = ''
  }

  const syncMobileDriveDock = () => {
    if (!isOpen || !opts.driving() || !isTouchViewport()) {
      clearMobileDock()
      return
    }
    const controls: RectBox[] = []
    for (const el of document.querySelectorAll<HTMLElement>('[data-panel="living"] .dt-cluster > *')) {
      if (!el.checkVisibility?.({ visibilityProperty: true, opacityProperty: true })) continue
      const r = el.getBoundingClientRect()
      if (r.width > 2 && r.height > 2) controls.push({ left: r.left, top: r.top, right: r.right, bottom: r.bottom })
    }
    let topHudBottom = 0
    for (const el of document.querySelectorAll<HTMLElement>('#minimap, [data-panel="drive-hud"], [data-panel="living"] .drive-util, #realm .fold')) {
      if (el.hidden || !el.checkVisibility?.({ visibilityProperty: true, opacityProperty: true })) continue
      const r = el.getBoundingClientRect()
      if (r.width > 2 && r.height > 2 && r.bottom < innerHeight * 0.48) topHudBottom = Math.max(topHudBottom, r.bottom)
    }
    const safe = readSafeInsets()
    const dock = computeMobileDriveDock({ vw: innerWidth, vh: innerHeight, safe, controls, topHudBottom })
    const sig = `${dock.left},${dock.top},${dock.width},${dock.height}`
    panel.classList.add('mobile-drive-dock')
    document.documentElement.classList.add('phone-drive-dock')
    if (sig !== lastDockSig) {
      lastDockSig = sig
      panel.style.left = `${dock.left}px`
      panel.style.top = `${dock.top}px`
      chassis.style.width = `${dock.width}px`
      chassis.style.height = `${dock.height}px`
    }
  }

  const onResize = () => { if (isOpen) syncMobileDriveDock() }
  addEventListener('resize', onResize)
  addEventListener('orientationchange', onResize)

  const openPhone = (appId?: string) => {
    if (!opts.engaged() || opts.blocked()) return
    const wasOpen = isOpen
    isOpen = true
    lastDriving = opts.driving()
    document.documentElement.classList.add('phone-open')
    panel.classList.add('open')
    panel.classList.toggle('driving-hand', lastDriving)
    syncMobileDriveDock()
    // Release pointer lock gently so user can click/tap the phone while WASD driving remains 100% live!
    if (typeof document !== 'undefined' && document.pointerLockElement) {
      try { document.exitPointerLock() } catch { /* ignore */ }
    }
    if (appId && apps.has(appId)) {
      openApp(appId)
    } else if (activeAppId && apps.has(activeAppId)) {
      mounted.get(activeAppId)?.inst.onShow?.()
    } else if (apps.size === 1) {
      // Single installed app (DoorSmash) opens cleanly into the home screen or straight in on explicit appId
      goHome()
    } else {
      goHome()
    }
    if (!wasOpen) {
      play('tap')
      opts.onOpenChange?.(true, lastDriving)
    }
  }

  const closePhone = () => {
    if (!isOpen) return
    isOpen = false
    document.documentElement.classList.remove('phone-open')
    panel.classList.remove('open', 'driving-hand')
    clearMobileDock()
    if (activeAppId) mounted.get(activeAppId)?.inst.onHide?.()
    play('tap')
    opts.onOpenChange?.(false, opts.driving())
  }

  const toggle = (appId?: string) => {
    if (isOpen) {
      if (appId && activeAppId !== appId) openApp(appId)
      else closePhone()
    } else {
      openPhone(appId)
    }
  }

  trigBtn.addEventListener('click', (e) => {
    e.stopPropagation()
    openPhone(activeAppId ?? undefined)
  })
  btnHome.addEventListener('click', () => { play('tap'); goHome() })
  homeBar.addEventListener('click', () => { play('tap'); if (activeAppId) goHome(); else closePhone() })
  btnClose.addEventListener('click', () => closePhone())

  // Keyboard shortcuts: GTA classic ArrowUp toggles phone; Escape/ArrowDown stows it.
  // Non-blocking while driving so WASD / Space / Shift still drive smoothly in first-person!
  const onKeyDown = (e: KeyboardEvent) => {
    if (!opts.engaged() || opts.blocked()) return
    const target = e.target as HTMLElement | null
    const inText = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
    if (inText) {
      if (isOpen && e.code === 'Escape') {
        ;(target as HTMLElement).blur()
        e.preventDefault()
      }
      return
    }
    if (e.code === 'ArrowUp' && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault()
      toggle()
      return
    }
    if (isOpen && (e.code === 'Escape' || (e.code === 'ArrowDown' && !e.repeat))) {
      e.preventDefault()
      e.stopImmediatePropagation()
      closePhone()
      return
    }
    if (isOpen && activeAppId) {
      const handled = mounted.get(activeAppId)?.inst.onKey?.(e.code)
      if (handled) e.preventDefault()
    }
  }
  addEventListener('keydown', onKeyDown, true)

  const frame = (dt: number) => {
    if (isOpen && (!opts.engaged() || opts.blocked())) {
      closePhone()
      return
    }
    clockAcc += dt
    if (clockAcc > 0.5) {
      clockAcc = 0
      const hr = opts.hour()
      timeEl.textContent = formatClock(hr)
      widgetBig.textContent = hr < 11 ? 'Morning rush' : hr < 15 ? 'Lunch rush' : hr < 21 ? 'Dinner peak' : 'Late-night cravings'
      widgetSub.textContent = opts.driving()
        ? 'First-person dash view active · keep eyes on the road'
        : `${apps.size} app${apps.size === 1 ? '' : 's'} installed · press ↑ anytime`
      syncBadges()
    }
    if (!isOpen) return
    const drv = opts.driving()
    if (drv !== lastDriving) {
      lastDriving = drv
      panel.classList.toggle('driving-hand', drv)
      opts.onOpenChange?.(true, drv)
    }
    if (drv && isTouchViewport()) {
      syncMobileDriveDock()
      chassis.style.transform = ''
    } else {
      clearMobileDock()
      if (drv && opts.telemetry) {
        const tel = opts.telemetry()
        if (tel && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
          vibePhase += dt * (8 + tel.kmh * 0.25)
          const j = Math.min(2.2, tel.kmh * 0.014)
          const sway = Math.max(-5, Math.min(5, tel.slip * 6))
          chassis.style.transform = `rotateY(${(-7 + sway * 0.5).toFixed(2)}deg) rotateX(4deg) rotateZ(${(-1.4 + sway * 0.25).toFixed(2)}deg) translate3d(${(Math.sin(vibePhase * 1.3) * j * 0.4).toFixed(2)}px, ${(Math.cos(vibePhase * 2.1) * j * 0.5).toFixed(2)}px, 0)`
        } else {
          chassis.style.transform = ''
        }
      } else {
        chassis.style.transform = ''
      }
    }
    if (activeAppId) mounted.get(activeAppId)?.inst.onTick?.(dt)
  }

  return {
    get open() { return isOpen },
    get activeAppId() { return activeAppId },
    get apps() { return [...apps.values()] },
    registerApp(app) {
      apps.set(app.id, app)
      renderHomeGrid()
    },
    unregisterApp(id) {
      if (activeAppId === id) goHome()
      mounted.get(id)?.inst.destroy?.()
      mounted.delete(id)
      apps.delete(id)
      badges.delete(id)
      renderHomeGrid()
    },
    openPhone,
    closePhone,
    toggle,
    openApp,
    goHome,
    notify,
    dismissNotification: hideToast,
    setStatusChip,
    frame,
    destroy() {
      removeEventListener('keydown', onKeyDown, true)
      removeEventListener('resize', onResize)
      removeEventListener('orientationchange', onResize)
      hideToast()
      clearMobileDock()
      for (const m of mounted.values()) m.inst.destroy?.()
      mounted.clear()
      trigPanel.replaceChildren()
      toastPanel.replaceChildren()
      panel.replaceChildren()
      document.documentElement.classList.remove('phone-open', 'phone-drive-dock')
    },
  }
}
