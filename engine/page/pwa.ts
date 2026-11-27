// Voxelwright PWA runtime:
// - Registers the realm Service Worker (/sw.js) on assembled PWA pages and requests persistent storage so iOS/Chromium
//   keep cached San Francisco tiles, graphics presets, stunt records and door keys intact.
// - Syncs <meta name="theme-color"> to the live San Francisco sky zenith colour (day blue, sunset, fog, night #10141a).
// - Manages Screen Wake Lock while actively playing (especially Bluetooth gamepad sessions) with visibility re-acquire.
// - Bridges the Car Radio to the OS Media Session (lock screen / Control Center / hardware media keys).
// - Captures `beforeinstallprompt` (and detects iOS Safari non-standalone) to power an unobtrusive Install App button.
import type { RadioState } from './sound/radio.ts'

export interface SkySample {
  readonly day: number
  readonly cloud: number
  readonly fog: number
  readonly rain: number
  /** The realm's own daytime zenith RGB (linear 0..1), when set (march.air.sky?.zenith). */
  readonly ownSky?: readonly [number, number, number] | null
  /** Low-sun warmth factor (0..1), inferred from day if omitted. */
  readonly low?: number
}

export interface RadioMediaSource {
  readonly state: RadioState
  subscribe(fn: (s: RadioState) => void): () => void
  togglePlay(): void
  cycle(dir?: 1 | -1): void
  tune(index: number): void
  nextTrack(): Promise<boolean>
  prevTrack(): Promise<boolean>
}

export interface BeforeInstallPromptEventLike extends Event {
  prompt(): Promise<void>
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform?: string }>
}

export interface InstallPromptController {
  available(): boolean
  mode(): 'native' | 'ios' | 'none'
  installed(): boolean
  prompt(): Promise<'accepted' | 'dismissed' | 'ios' | 'unavailable'>
  subscribe(fn: () => void): () => void
  dispose(): void
}

export interface WakeLockController {
  readonly locked: boolean
  engage(): void
  release(): void
  dispose(): void
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)
const mix3 = (a: readonly [number, number, number], b: readonly [number, number, number], t: number): [number, number, number] => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
]

/**
 * Computes the sRGB hex `<meta name="theme-color">` matching `march.ts` sky zenith colours.
 * Floor is #10141a so night status bars and desktop titlebars match the realm's dark chrome.
 */
export function skyThemeColor(sample: SkySample): string {
  const day = clamp01(sample.day)
  const cloud = clamp01(sample.cloud)
  const fog = clamp01(sample.fog)
  const rain = clamp01(sample.rain)
  const low = sample.low !== undefined
    ? clamp01(sample.low)
    : day > 0.04 && day < 0.96 ? clamp01(1 - Math.abs(day - 0.5) * 2.4) : 0
  const overcast = Math.max(rain, cloud * 0.7)

  const night: [number, number, number] = [0.0023, 0.0038, 0.0063]
  const noon: [number, number, number] = [0.07, 0.22, 0.62]
  const dusk: [number, number, number] = [0.07, 0.11, 0.36]
  let lin = mix3(night, mix3(noon, dusk, low), day)

  // Mirror march.ts: realm's own daytime photograph zenith fades in above day 0.5 when not raining.
  if (sample.ownSky && day > 0.5 && !rain) {
    const own = clamp01((day - 0.5) / 0.4)
    lin = mix3(lin, sample.ownSky, own)
  }

  // Overcast & rain grey the zenith; sea fog lifts and cools it slightly.
  const luma = 0.299 * lin[0] + 0.587 * lin[1] + 0.114 * lin[2]
  if (overcast > 0) {
    const wetGrey: [number, number, number] = [luma * 0.85, luma * 0.9, luma * 0.98]
    lin = mix3(lin, wetGrey, overcast * 0.82)
  }
  if (fog > 0) {
    const fogTint: [number, number, number] = [
      0.03 + 0.34 * day,
      0.035 + 0.36 * day,
      0.045 + 0.4 * day,
    ]
    lin = mix3(lin, fogTint, fog * 0.5)
  }

  // Linear -> sRGB (gamma 2.2, matching march.ts palette) with a #10141a dark-chrome floor.
  const toByte = (v: number, floor: number) => Math.max(floor, Math.min(255, Math.round(Math.pow(clamp01(v), 1 / 2.2) * 255)))
  const r = toByte(lin[0], 0x10)
  const g = toByte(lin[1], 0x14)
  const b = toByte(lin[2], 0x1a)
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`
}

/** Keeps `<meta name="theme-color">` aligned with the live sky without per-frame DOM churn. */
export function createThemeColorSync(doc: Document | null = typeof document !== 'undefined' ? document : null) {
  let meta: HTMLMetaElement | null = null
  let lastColor = ''
  let lastUpdateAt = -Infinity

  const ensureMeta = (): HTMLMetaElement | null => {
    if (!doc) return null
    if (meta && meta.isConnected) return meta
    meta = doc.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
    if (!meta && doc.head) {
      meta = doc.createElement('meta')
      meta.name = 'theme-color'
      meta.content = '#10141a'
      doc.head.append(meta)
    }
    return meta
  }

  return {
    get color() { return lastColor || '#10141a' },
    update(sample: SkySample, now = typeof performance !== 'undefined' ? performance.now() : Date.now()) {
      if (now - lastUpdateAt < 250) return
      lastUpdateAt = now
      const next = skyThemeColor(sample)
      if (next === lastColor) return
      lastColor = next
      const el = ensureMeta()
      if (el) el.content = next
    },
  }
}

/** Detects standalone or fullscreen installed PWA display modes across Chromium and iOS Safari. */
export function isStandaloneDisplay(
  win: Pick<Window, 'matchMedia'> | null = typeof window !== 'undefined' ? window : null,
  nav: { standalone?: boolean } | null = typeof navigator !== 'undefined' ? (navigator as Navigator & { standalone?: boolean }) : null,
): boolean {
  if (nav?.standalone === true) return true
  if (!win?.matchMedia) return false
  try {
    return win.matchMedia('(display-mode: fullscreen)').matches || win.matchMedia('(display-mode: standalone)').matches
  } catch {
    return false
  }
}

/**
 * The height an installed iOS web app should fill. With the black-translucent status bar, iOS lays the page out a
 * status bar short of the screen (100vh, 100dvh and `inset: 0` all stop there), leaving a bare band at the bottom.
 * `screen` on iOS keeps its portrait numbers whatever the turn, so the long side is the height when upright and the
 * short side when turned. Null when the layout already fills the screen (Android, desktop, a fixed iOS).
 */
export function fullScreenHeight(inner: { w: number; h: number }, screen: { w: number; h: number }): number | null {
  const long = Math.max(screen.w, screen.h), short = Math.min(screen.w, screen.h)
  const full = inner.h >= inner.w ? long : short
  return full - inner.h > 1 && full - inner.h < 120 ? full : null
}

/** Keeps `--app-h` on <html> at the full screen height in an installed iOS web app; the page's CSS falls back to 100dvh. */
export function fitStandaloneHeight(win: Window & { navigator: Navigator & { standalone?: boolean } } = window): void {
  if (win.navigator.standalone !== true) return
  const root = win.document.documentElement
  const fit = () => {
    const h = fullScreenHeight({ w: win.innerWidth, h: win.innerHeight }, { w: win.screen.width, h: win.screen.height })
    if (h) root.style.setProperty('--app-h', `${h}px`)
    else root.style.removeProperty('--app-h')
  }
  win.addEventListener('resize', fit)
  fit()
}

/** True on iOS/iPadOS Safari where installation uses Share -> Add to Home Screen rather than `beforeinstallprompt`. */
export function isIosSafari(
  ua = typeof navigator !== 'undefined' ? navigator.userAgent : '',
  maxTouchPoints = typeof navigator !== 'undefined' ? navigator.maxTouchPoints ?? 0 : 0,
): boolean {
  const isIos = /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/i.test(ua) && maxTouchPoints > 1)
  if (!isIos) return false
  // Exclude embedded / third-party iOS browsers that cannot add PWAs to Home Screen directly or have different flows.
  return /Safari/i.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS|DuckDuckGo/i.test(ua)
}

/** Requests durable storage (auto-granted for installed PWAs in Chromium; safe no-op elsewhere). */
export async function requestPersistentStorage(
  nav: { storage?: { persist?: () => Promise<boolean>; persisted?: () => Promise<boolean> } } | null = typeof navigator !== 'undefined' ? navigator : null,
): Promise<boolean> {
  try {
    if (!nav?.storage?.persist) return false
    if (nav.storage.persisted && await nav.storage.persisted()) return true
    return await nav.storage.persist()
  } catch {
    return false
  }
}

/**
 * Registers `/sw.js` only on assembled PWA pages (pages carrying `<link rel="manifest">`) on HTTPS or loopback.
 * Local dev servers and plain `engine/dist-sf` test pages have no manifest link and trigger zero SW requests.
 */
export async function registerServiceWorker(opts: {
  doc?: Document | null
  nav?: (Navigator & { standalone?: boolean }) | null
  loc?: Pick<Location, 'protocol' | 'hostname'> | null
  force?: boolean
} = {}): Promise<ServiceWorkerRegistration | null> {
  const doc = opts.doc === undefined ? (typeof document !== 'undefined' ? document : null) : opts.doc
  const nav = opts.nav === undefined ? (typeof navigator !== 'undefined' ? (navigator as Navigator & { standalone?: boolean }) : null) : opts.nav
  const loc = opts.loc === undefined ? (typeof location !== 'undefined' ? location : null) : opts.loc
  if (!nav || !('serviceWorker' in nav) || !nav.serviceWorker) return null
  if (!opts.force && nav.webdriver) return null
  if (!opts.force && !doc?.querySelector('link[rel="manifest"]')) return null
  const secure = loc?.protocol === 'https:' || loc?.hostname === 'localhost' || loc?.hostname === '127.0.0.1' || loc?.hostname === '[::1]'
  if (!secure) return null
  try {
    const reg = await nav.serviceWorker.register('/sw.js', { scope: '/' })
    return reg
  } catch {
    return null
  }
}

/**
 * Screen Wake Lock controller: keeps the display awake during active play (especially Bluetooth gamepad sessions),
 * releases automatically when hidden, and re-acquires cleanly when returning to the app.
 */
export function createWakeLock(opts: {
  doc?: Pick<Document, 'visibilityState' | 'addEventListener' | 'removeEventListener'> | null
  wakeLock?: { request(type: 'screen'): Promise<{ released?: boolean; release(): Promise<void>; addEventListener?(t: string, fn: () => void): void }> } | null
} = {}): WakeLockController {
  const doc = opts.doc === undefined ? (typeof document !== 'undefined' ? document : null) : opts.doc
  const api = opts.wakeLock === undefined
    ? (typeof navigator !== 'undefined' ? (navigator as Navigator & { wakeLock?: { request(type: 'screen'): Promise<{ released?: boolean; release(): Promise<void>; addEventListener?(t: string, fn: () => void): void }> } }).wakeLock ?? null : null)
    : opts.wakeLock

  let wanted = false
  let pending = false
  let sentinel: { released?: boolean; release(): Promise<void>; addEventListener?(t: string, fn: () => void): void } | null = null

  const acquire = async () => {
    if (!wanted || !api || pending || sentinel) return
    if (doc && doc.visibilityState !== 'visible') return
    pending = true
    try {
      const got = await api.request('screen')
      if (!wanted || (doc && doc.visibilityState !== 'visible')) {
        void got.release().catch(() => {})
        return
      }
      sentinel = got
      got.addEventListener?.('release', () => {
        if (sentinel === got) sentinel = null
      })
    } catch {
      // Low battery, unsupported context, or document not yet user-activated: retry on next visibility/gesture.
    } finally {
      pending = false
    }
  }

  const drop = () => {
    const held = sentinel
    sentinel = null
    if (held) void held.release().catch(() => {})
  }

  const onVisibility = () => {
    if (!doc) return
    if (doc.visibilityState === 'visible') {
      if (wanted) void acquire()
    } else {
      drop()
    }
  }

  const onGesture = () => {
    if (wanted && !sentinel) void acquire()
  }

  doc?.addEventListener('visibilitychange', onVisibility)
  doc?.addEventListener('pointerdown', onGesture, { passive: true })
  doc?.addEventListener('keydown', onGesture, { passive: true })

  return {
    get locked() { return sentinel !== null && sentinel.released !== true },
    engage() {
      wanted = true
      void acquire()
    },
    release() {
      wanted = false
      drop()
    },
    dispose() {
      wanted = false
      drop()
      doc?.removeEventListener('visibilitychange', onVisibility)
      doc?.removeEventListener('pointerdown', onGesture)
      doc?.removeEventListener('keydown', onGesture)
    },
  }
}

/**
 * Bridges Voxelwright's Car Radio to `navigator.mediaSession` so lock screens, Control Center and hardware media
 * keys show the active station/track and control playback and station/track switching.
 */
export function bindRadioMediaSession(
  radio: RadioMediaSource,
  opts: {
    mediaSession?: MediaSession | null
    MediaMetadataCtor?: typeof MediaMetadata | null
  } = {},
): () => void {
  const ms = opts.mediaSession === undefined
    ? (typeof navigator !== 'undefined' && 'mediaSession' in navigator ? navigator.mediaSession : null)
    : opts.mediaSession
  const MetaCtor = opts.MediaMetadataCtor === undefined
    ? (typeof MediaMetadata !== 'undefined' ? MediaMetadata : null)
    : opts.MediaMetadataCtor
  if (!ms) return () => {}

  let lastMetaKey = ''
  let lastPlayback: MediaSessionPlaybackState = 'none'

  const setHandler = (action: MediaSessionAction, fn: MediaSessionActionHandler | null) => {
    try { ms.setActionHandler(action, fn) } catch { /* action unsupported in this browser */ }
  }

  const sync = (st: RadioState) => {
    const on = st.driving && (st.active || (st.track !== null && !(st.provider === 'fm' && st.index <= 0)))
    if (!on) {
      if (lastPlayback !== 'none') {
        ms.playbackState = 'none'
        lastPlayback = 'none'
      }
      if (lastMetaKey !== '') {
        ms.metadata = null
        lastMetaKey = ''
      }
      return
    }
    const title = st.track?.title || st.station.name || 'Voxelwright Radio'
    const artist = st.track?.artist || (st.station.freq ? `${st.station.freq} FM · San Francisco` : st.station.name)
    const album = 'Voxelwright — San Francisco'
    const art = st.track?.artwork || st.playlist?.artwork || ''
    const metaKey = `${title}|${artist}|${art}`
    if (metaKey !== lastMetaKey) {
      lastMetaKey = metaKey
      const artwork: MediaImage[] = art
        ? [{ src: art }]
        : [
            { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
            { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          ]
      if (MetaCtor) {
        ms.metadata = new MetaCtor({ title, artist, album, artwork })
      }
    }
    const nextState: MediaSessionPlaybackState = st.playing ? 'playing' : 'paused'
    if (nextState !== lastPlayback) {
      ms.playbackState = nextState
      lastPlayback = nextState
    }
  }

  setHandler('play', () => {
    if (radio.state.driving && !radio.state.playing) radio.togglePlay()
  })
  setHandler('pause', () => {
    if (radio.state.driving && radio.state.playing) radio.togglePlay()
  })
  setHandler('nexttrack', () => {
    if (!radio.state.driving) return
    if (radio.state.provider === 'fm') radio.cycle(1)
    else void radio.nextTrack()
  })
  setHandler('previoustrack', () => {
    if (!radio.state.driving) return
    if (radio.state.provider === 'fm') radio.cycle(-1)
    else void radio.prevTrack()
  })
  setHandler('stop', () => {
    if (radio.state.driving) radio.tune(0)
  })

  const unsub = radio.subscribe(sync)
  sync(radio.state)

  return () => {
    unsub()
    for (const action of ['play', 'pause', 'nexttrack', 'previoustrack', 'stop'] as const) setHandler(action, null)
    ms.playbackState = 'none'
    ms.metadata = null
  }
}

/**
 * Tracks browser PWA installability (`beforeinstallprompt` on Chromium and Add-to-Home-Screen guidance on iOS Safari).
 * Hidden when already installed or in automated headless checks.
 */
export function createInstallPrompt(opts: {
  win?: Pick<Window, 'addEventListener' | 'removeEventListener' | 'matchMedia'> | null
  nav?: (Pick<Navigator, 'userAgent' | 'maxTouchPoints' | 'webdriver'> & { standalone?: boolean; storage?: { persist?: () => Promise<boolean>; persisted?: () => Promise<boolean> } }) | null
  onIosHint?: () => void
  onInstalled?: () => void
} = {}): InstallPromptController {
  const win = opts.win === undefined ? (typeof window !== 'undefined' ? window : null) : opts.win
  const nav = opts.nav === undefined ? (typeof navigator !== 'undefined' ? (navigator as Navigator & { standalone?: boolean }) : null) : opts.nav

  let deferred: BeforeInstallPromptEventLike | null = null
  let isInstalled = isStandaloneDisplay(win, nav)
  const iosEligible = !isInstalled && !nav?.webdriver && isIosSafari(nav?.userAgent ?? '', nav?.maxTouchPoints ?? 0)
  const listeners = new Set<() => void>()
  const emit = () => { for (const fn of listeners) fn() }

  const onBeforeInstall = (e: Event) => {
    e.preventDefault()
    deferred = e as BeforeInstallPromptEventLike
    emit()
  }

  const onInstalled = () => {
    isInstalled = true
    deferred = null
    void requestPersistentStorage(nav)
    opts.onInstalled?.()
    emit()
  }

  win?.addEventListener('beforeinstallprompt', onBeforeInstall)
  win?.addEventListener('appinstalled', onInstalled)

  const mode = (): 'native' | 'ios' | 'none' => {
    if (isInstalled || nav?.webdriver) return 'none'
    if (deferred) return 'native'
    if (iosEligible) return 'ios'
    return 'none'
  }

  return {
    available() { return mode() !== 'none' },
    mode,
    installed() { return isInstalled },
    async prompt() {
      const m = mode()
      if (m === 'native' && deferred) {
        const ev = deferred
        deferred = null
        emit()
        try {
          await ev.prompt()
          const choice = await ev.userChoice
          if (choice.outcome === 'accepted') {
            isInstalled = true
            void requestPersistentStorage(nav)
            emit()
          }
          return choice.outcome
        } catch {
          return 'dismissed'
        }
      }
      if (m === 'ios') {
        opts.onIosHint?.()
        return 'ios'
      }
      return 'unavailable'
    },
    subscribe(fn) {
      listeners.add(fn)
      return () => { listeners.delete(fn) }
    },
    dispose() {
      win?.removeEventListener('beforeinstallprompt', onBeforeInstall)
      win?.removeEventListener('appinstalled', onInstalled)
      listeners.clear()
    },
  }
}

/** Initializes all Voxelwright PWA features cleanly for the active realm page. */
export function initPwa(opts: {
  notice?: (text: string, ms?: number) => void
} = {}) {
  const standalone = isStandaloneDisplay()
  if (typeof document !== 'undefined') document.documentElement.classList.toggle('pwa', standalone)
  if (typeof window !== 'undefined') fitStandaloneHeight()

  // Register SW (only on pages with <link rel="manifest">) and request durable storage when installed.
  void registerServiceWorker()
  if (standalone) void requestPersistentStorage()

  const theme = createThemeColorSync()
  const wakeLock = createWakeLock()
  const install = createInstallPrompt({
    onIosHint: () => opts.notice?.('Tap Share, then “Add to Home Screen” for fullscreen & offline San Francisco', 7000),
    onInstalled: () => opts.notice?.('Voxelwright installed — fullscreen & offline cache ready', 4000),
  })

  // Quietly surface offline/online transitions only after the page is up.
  const onOffline = () => opts.notice?.('Offline — visited San Francisco and FM radio stay available', 5000)
  const onOnline = () => opts.notice?.('Back online', 2500)
  if (typeof window !== 'undefined' && !(typeof navigator !== 'undefined' && navigator.webdriver)) {
    window.addEventListener('offline', onOffline)
    window.addEventListener('online', onOnline)
  }

  return {
    standalone,
    theme,
    wakeLock,
    install,
    bindRadio: (radio: RadioMediaSource) => bindRadioMediaSession(radio),
    dispose() {
      wakeLock.dispose()
      install.dispose()
      if (typeof window !== 'undefined') {
        window.removeEventListener('offline', onOffline)
        window.removeEventListener('online', onOnline)
      }
    },
  }
}
