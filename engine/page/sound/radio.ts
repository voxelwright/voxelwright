// Procedural & Connected Car Radio + High-Speed Doppler Pass-By Audio (#31):
// Unifies Voxelwright's 3 zero-asset offline procedural FM stations (`Bay Drive FM`, `Twin Peaks Chill`,
// `Fillmore Funk`) with pluggable Spotify (OAuth PKCE + Web Playback SDK) and Apple Music (MusicKit JS v3)
// streaming providers. Handles car exit/re-enter persistence, smooth horn/collision volume ducking across
// both procedural and external audio, procedural music suppression whenever an external stream plays,
// upgraded auto-fading `[data-panel="radio-toast"]` notifications, and stereo-panned Doppler pass-by whooshes.
import { BUS, SET, type Sound } from './sound.ts'
import type { Patch } from './patch.ts'
import { conductor } from './music/conductor.ts'
import type { Hud } from '../hud.ts'
import {
  CURATED_PLAYLISTS,
  ENABLED_STREAMING_PROVIDERS,
  createAppleMusicProvider,
  createSpotifyProvider,
  createYouTubeProvider,
  enabledProviders,
  type ExternalProviderId,
  type MusicProvider,
  type PlaylistItem,
  type ProviderId,
  type ProviderSnapshot,
  type TrackInfo,
  type YouTubeProvider,
} from './radio-providers.ts'

export {
  CURATED_PLAYLISTS,
  ENABLED_STREAMING_PROVIDERS,
  createAppleMusicProvider,
  createSpotifyProvider,
  createYouTubeProvider,
  enabledProviders,
  type ExternalProviderId,
  type MusicProvider,
  type PlaylistItem,
  type ProviderId,
  type ProviderSnapshot,
  type TrackInfo,
  type YouTubeProvider,
} from './radio-providers.ts'

export interface Station {
  readonly id: 'off' | 'baydrive' | 'twinpeaks' | 'fillmore' | 'youtube' | 'spotify' | 'apple'
  readonly name: string
  readonly freq: string
  readonly mood: string | null
  readonly accent: string
}

/** Built-in offline procedural FM stations in cycle order: Radio Off, Bay Drive FM, Twin Peaks Chill, Fillmore Funk. */
export const STATIONS: readonly Station[] = [
  { id: 'off', name: 'Radio Off', freq: '', mood: null, accent: '#9aa5b1' },
  { id: 'baydrive', name: 'Bay Drive FM', freq: '104.7', mood: 'baydrive', accent: '#ff4fa0' },
  { id: 'twinpeaks', name: 'Twin Peaks Chill', freq: '91.3', mood: 'twinpeaks', accent: '#ffae34' },
  { id: 'fillmore', name: 'Fillmore Funk', freq: '98.5', mood: 'fillmore', accent: '#35d0ba' },
] as const

/** Strictly-validated procedural patches for car radio tactile tuning and high-speed Doppler pass-by whooshes. */
export const RADIO_PATCHES: Record<'click' | 'static' | 'whoosh' | 'whooshTail', Patch> = {
  // Crisp mechanical dash dial detent click.
  click: { how: 'struck', hard: 1, rough: 0.25, shape: 'lump', pitch: 2650, ring: 0.014, damp: 0.85, gain: 0.55 },
  // Short FM receiver static sweep when locking onto a new frequency.
  static: { how: 'struck', hard: 0.22, rough: 1, modes: [[1, 0.03]], pitch: 1850, ring: 0.016, damp: 1, air: { from: 4600, to: 1500, for: 0.14, gain: 0.65, q: 0.65 }, gain: 0.42 },
  // Primary stereo-panned Doppler air whoosh: resonant bandpass sweeping sharply down in pitch as an object passes.
  whoosh: { how: 'struck', hard: 0.08, rough: 1, modes: [[1, 0.025]], pitch: 130, ring: 0.03, damp: 1, air: { from: 2800, to: 260, for: 0.36, gain: 1, q: 1.4 }, gain: 0.98 },
  // Receding low-mid pressure wake that sweeps slightly inward after the peak pass.
  whooshTail: { how: 'struck', hard: 0.12, rough: 0.9, shape: 'hollow', pitch: 76, ring: 0.06, damp: 0.95, bend: -0.65, air: { from: 920, to: 130, for: 0.38, gain: 1, q: 0.95 }, gain: 0.85 },
}

export interface NearMissDetail {
  side?: number
  pan?: number
  kmh?: number
  speedKmh?: number
  speed?: number
  closeness?: number
  clearance?: number
  distance?: number
  at?: readonly [number, number, number]
}

export interface RadioState {
  readonly station: Station
  readonly index: number
  readonly driving: boolean
  readonly active: boolean
  readonly playing: boolean
  readonly provider: ProviderId
  readonly playlist: PlaylistItem | null
  readonly track: TrackInfo | null
  readonly volume: number
  readonly ducking: number
  readonly whooshes: number
  readonly lastWhoosh: { side: number; kmh: number; at: number } | null
  readonly providers: Readonly<Record<ExternalProviderId, ProviderSnapshot>>
  readonly enabled: Readonly<Record<ExternalProviderId, boolean>>
}

export interface Radio {
  readonly state: RadioState
  /** Cycle to the next station or active provider's playlist (FM: Off -> Bay Drive -> Twin Peaks -> Fillmore -> Off). */
  cycle(step?: 1 | -1): Station
  /** Tune directly to a built-in FM station by id or index. */
  tune(target: Station['id'] | number, silent?: boolean): Station
  /** Select and play a curated or user playlist from FM, Spotify, or Apple Music. */
  selectPlaylist(playlist: PlaylistItem, opts?: { playSfx?: boolean; showUi?: boolean }): Promise<boolean>
  /** Toggle play/pause on the current radio source. */
  togglePlay(): Promise<void>
  /** Skip to next track (streaming) or next FM station. */
  nextTrack(): Promise<boolean>
  /** Skip to previous track (streaming) or previous FM station. */
  prevTrack(): Promise<boolean>
  /** Set base radio volume (0..1), applied smoothly alongside horn/collision ducking. */
  setVolume(v: number): void
  /** Called when entering or exiting a driven car (remembers last station/playlist across trips). */
  setDriving(on: boolean): void
  /** Smoothly ducks radio volume briefly (e.g. loud collisions). */
  duck(strength: number, holdSec?: number): void
  /** Smoothly ducks radio while the car horn is held. */
  setHorn(on: boolean): void
  /** Triggers a stereo-panned Doppler pass-by whoosh at 70+ km/h. */
  whoosh(side: number, kmh: number, closeness?: number): boolean
  /** Per-frame update: ticks radio conductor, smooth duck recovery, and high-speed pass-by detection. */
  frame(at: readonly [number, number, number], yaw: number, dt: number, speedKmh: number, kind?: (x: number, y: number, z: number) => number, nearby?: readonly (readonly [number, number, number])[]): void
  /** Attaches the HUD layer so the auto-fading station & now-playing toast pill can render. */
  attachHud(hud: Hud): void
  /** Registers a callback to open the in-car Waymo-style media picker UI. */
  onOpenPicker(fn: ((tab?: ProviderId) => void) | null): void
  /** Opens the in-car media picker UI if attached. */
  openPicker(tab?: ProviderId): void
  /** Registers or replaces a streaming music provider (YouTube, Spotify, Apple Music, or mocked test providers). */
  registerProvider(provider: MusicProvider): void
  /** Returns a registered streaming provider by id. */
  getProvider(id: ExternalProviderId): MusicProvider
  /** Subscribes to live radio state updates (station, track, provider, ducking changes). */
  subscribe(fn: (state: RadioState) => void): () => void
  /** Cleans up global event listeners, providers, and timers. */
  dispose(): void
}

const M = 10
const MIN_WHOOSH_KMH = 70
const TOAST_MS = 2500
const PREF_STORAGE_KEY = 'voxelwright.radio.pref'

interface SavedSource {
  provider: ProviderId
  stationIndex: number
  playlist?: PlaylistItem | null
}

/** Plays a stereo-panned high-speed Doppler pass-by whoosh through the AudioWorklet synth. */
export function playDopplerWhoosh(voice: Sound, side: number, kmh: number, closeness = 0.8): boolean {
  if (!voice.running || !Number.isFinite(kmh) || kmh < MIN_WHOOSH_KMH) return false
  const s = Math.max(-1, Math.min(1, Number.isFinite(side) ? side : 0))
  const pan = Math.abs(s) < 0.08 ? (Math.random() < 0.5 ? -0.88 : 0.88) : s * 0.95
  const speedFrac = Math.min(1, Math.max(0, (kmh - MIN_WHOOSH_KMH) / 140))
  const close = Math.min(1, Math.max(0.25, closeness))
  // Faster pass = smaller `size` -> higher starting bandpass pitch and tighter, punchier Doppler sweep.
  const size = Math.max(0.62, 1.08 - speedFrac * 0.42)
  const force = Math.min(1, (0.72 + speedFrac * 0.28) * (0.75 + close * 0.25))
  const gain = Math.min(1, (0.78 + speedFrac * 0.22) * (0.78 + close * 0.22))
  voice.play(RADIO_PATCHES.whoosh, { bus: BUS.world, pan, size, force, gain, room: 0.05 })
  // Receding wake ~55 ms later, drifting slightly toward center for stereo movement across the ears.
  voice.play(RADIO_PATCHES.whooshTail, { bus: BUS.world, pan: pan * 0.62, size: size * 1.08, force: force * 0.88, gain: gain * 0.82, after: 0.055, room: 0.07 })
  if (typeof voice.flush === 'function') voice.flush()
  return true
}

export function createRadio(
  voice: Sound,
  opts: {
    /** Ambient place/realm music conductor if `?music=1` is enabled (paused while car radio plays). */
    ambient?: ReturnType<typeof conductor> | null
    /** Initial station preference from query params (`?radio=0|1|baydrive|twinpeaks|fillmore`). */
    query?: URLSearchParams
    /** Optional pre-configured streaming providers (for dependency injection / tests). */
    providers?: Partial<Record<ExternalProviderId, MusicProvider>>
  } = {},
): Radio {
  // Default station on first car entry:
  // - `?radio=0`: Radio Off
  // - `?radio=<id>` or `?radio=1`: that station (or Bay Drive FM)
  // - Headless / automated webdriver checks: Radio Off (unless `?radio=...` asks for it)
  // - Real human player: restores saved station/playlist preference, or starts on Bay Drive FM.
  const qRadio = opts.query?.get('radio')
  const qSoundOff = opts.query?.get('sound') === '0'
  const isWebdriver = typeof navigator !== 'undefined' && navigator.webdriver === true
  const parseStation = (raw: string | null | undefined): number => {
    if (!raw || raw === '0' || raw === 'off') return 0
    if (raw === '1' || raw === 'on') return 1
    const found = STATIONS.findIndex((s) => s.id === raw.toLowerCase())
    return found >= 0 ? found : 1
  }

  let remembered: SavedSource = {
    provider: 'fm',
    stationIndex: qRadio !== undefined && qRadio !== null ? parseStation(qRadio) : isWebdriver || qSoundOff ? 0 : 1,
    playlist: null,
  }

  const enabled = enabledProviders(opts.query)
  const isExternalProvider = (id: string): id is ExternalProviderId => id === 'youtube' || id === 'spotify' || id === 'apple'

  // Restore last saved human preference (never overrides explicit `?radio=` or headless webdriver defaults).
  if (qRadio === null || qRadio === undefined) {
    if (!isWebdriver && !qSoundOff && typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
      try {
        const raw = localStorage.getItem(PREF_STORAGE_KEY)
        if (raw) {
          const parsed = JSON.parse(raw) as Partial<SavedSource>
          if (parsed.provider === 'fm' && typeof parsed.stationIndex === 'number') {
            remembered = { provider: 'fm', stationIndex: ((parsed.stationIndex % STATIONS.length) + STATIONS.length) % STATIONS.length, playlist: null }
          } else if (parsed.provider && isExternalProvider(parsed.provider) && enabled[parsed.provider] && parsed.playlist?.uri) {
            remembered = { provider: parsed.provider, stationIndex: 1, playlist: parsed.playlist }
          }
        }
      } catch { /* ignore storage errors */ }
    }
  }

  const persistPref = () => {
    if (isWebdriver || typeof window === 'undefined' || typeof localStorage === 'undefined') return
    try { localStorage.setItem(PREF_STORAGE_KEY, JSON.stringify(remembered)) } catch { /* ignore */ }
  }

  let driving = false
  let current = 0
  let activeProvider: ProviderId = 'fm'
  let activePlaylist: PlaylistItem | null = null
  let pausedByUser = false
  let pendingAutoStart = false
  let autoStartDelay = 0
  let radioConductor: ReturnType<typeof conductor> | null = null
  let ambientWasOn = false
  let baseVolume = 1

  // Ducking state: horn + loud collision transient ducking, smoothed cleanly on BOTH procedural `SET.music` and external provider volume.
  let hornHeld = false
  let impactDuck = 0
  let impactHold = 0
  let musicGain = 1
  let musicGainTouched = false

  // Doppler pass-by state (rising-edge per side + cooldown so geometry/cars trigger clean individual whooshes).
  let whooshCount = 0
  let lastWhoosh: { side: number; kmh: number; at: number } | null = null
  let whooshCoolL = 0
  let whooshCoolR = 0
  let scanAcc = 0
  let wasSolidL = false
  let wasSolidR = false
  let lastSpeedKmh = 0
  const nearCarCool = new Map<number, number>()

  // Streaming music providers (YouTube Music active by default; Spotify & Apple Music feature-gated for later).
  const youtubeDefault = createYouTubeProvider()
  const spotifyDefault = createSpotifyProvider({
    clientId: opts.query?.get('spotify_client_id') ?? undefined,
  })
  const appleDefault = createAppleMusicProvider({
    developerToken: opts.query?.get('apple_music_token') ?? undefined,
  })
  const providerMap: Record<ExternalProviderId, MusicProvider> = {
    youtube: opts.providers?.youtube ?? youtubeDefault,
    spotify: opts.providers?.spotify ?? spotifyDefault,
    apple: opts.providers?.apple ?? appleDefault,
  }
  const providerUnsubs = new Map<ExternalProviderId, () => void>()
  let lastToastTrackKey = ''

  // Complete Spotify PKCE redirect callback cleanly if Spotify is enabled and returning from OAuth.
  if (enabled.spotify && !isWebdriver && typeof location !== 'undefined' && location.search.includes('code=') && location.search.includes('state=')) {
    void spotifyDefault.completeRedirectIfPresent().catch(() => false)
  }

  // Reactive state subscribers (for the Waymo-style Media Picker UI).
  const stateListeners = new Set<(s: RadioState) => void>()
  let openPickerFn: ((tab?: ProviderId) => void) | null = null

  // Upgraded auto-fading toast pill via hud.panel('radio-toast') + visible YouTube mini-player (`radio-yt`).
  let toastEl: HTMLElement | null = null
  let toastArtEl: HTMLImageElement | null = null
  let toastBadgeEl: HTMLElement | null = null
  let toastNameEl: HTMLElement | null = null
  let toastFreqEl: HTMLElement | null = null
  let toastTrackEl: HTMLElement | null = null
  let toastBarsEl: HTMLElement | null = null
  let toastTimer: ReturnType<typeof setTimeout> | null = null
  let toastHideTimer: ReturnType<typeof setTimeout> | null = null
  let ytPanelEl: HTMLElement | null = null
  let ytFrameEl: HTMLElement | null = null
  let ytLabelEl: HTMLElement | null = null

  const syncYouTubePanel = () => {
    const showYt = driving && activeProvider === 'youtube' && activePlaylist !== null && !pausedByUser
    if (ytPanelEl) {
      ytPanelEl.hidden = !showYt
      if (ytLabelEl && showYt) ytLabelEl.textContent = activePlaylist?.name ?? 'YouTube Music'
    }
    if (typeof document !== 'undefined') document.documentElement.classList.toggle('yt-mini', showYt)
  }

  const currentStationView = (): Station => {
    if (activeProvider === 'fm') return STATIONS[current]
    const pl = activePlaylist
    const p = providerMap[activeProvider]
    return {
      id: activeProvider,
      name: pl?.name ?? p.name,
      freq: '',
      mood: null,
      accent: pl?.accent ?? p.accent,
    }
  }

  const currentTrackView = (): TrackInfo | null => {
    if (activeProvider === 'fm') {
      if (current <= 0) return null
      const st = STATIONS[current]
      const curated = CURATED_PLAYLISTS.fm.find((c) => c.id === st.id)
      return { title: st.name, artist: curated?.subtitle ?? `${st.freq} FM · Live Procedural` }
    }
    const snap = providerMap[activeProvider].snapshot()
    if (snap.track) return snap.track
    if (activePlaylist) return { title: activePlaylist.name, artist: activePlaylist.subtitle ?? providerMap[activeProvider].name }
    return null
  }

  const isSourceActive = (): boolean => {
    if (!driving) return false
    if (activeProvider === 'fm') return current > 0 && !pausedByUser
    return activePlaylist !== null && !pausedByUser
  }

  const getState = (): RadioState => ({
    station: currentStationView(),
    index: activeProvider === 'fm' ? current : -1,
    driving,
    active: isSourceActive(),
    playing: isSourceActive() && (activeProvider === 'fm' || providerMap[activeProvider].snapshot().playing),
    provider: activeProvider,
    playlist: activeProvider === 'fm' ? (CURATED_PLAYLISTS.fm.find((c) => c.id === STATIONS[current].id) ?? null) : activePlaylist,
    track: currentTrackView(),
    volume: baseVolume,
    ducking: 1 - musicGain,
    whooshes: whooshCount,
    lastWhoosh,
    providers: {
      youtube: providerMap.youtube.snapshot(),
      spotify: providerMap.spotify.snapshot(),
      apple: providerMap.apple.snapshot(),
    },
    enabled,
  })

  const notify = () => {
    syncYouTubePanel()
    const st = getState()
    for (const fn of stateListeners) fn(st)
  }

  const hideToast = () => {
    if (toastTimer) { clearTimeout(toastTimer); toastTimer = null }
    if (toastHideTimer) { clearTimeout(toastHideTimer); toastHideTimer = null }
    if (!toastEl) return
    toastEl.classList.remove('show')
    toastEl.hidden = true
  }

  const showToast = (optsShow?: { station?: Station; provider?: ProviderId; track?: TrackInfo | null }) => {
    if (!toastEl || !toastNameEl || !toastFreqEl || !toastBarsEl || !driving) return
    if (toastTimer) clearTimeout(toastTimer)
    if (toastHideTimer) clearTimeout(toastHideTimer)
    const provider = optsShow?.provider ?? activeProvider
    const station = optsShow?.station ?? currentStationView()
    const track = optsShow?.track !== undefined ? optsShow.track : (provider === 'fm' ? null : currentTrackView())
    const isOff = provider === 'fm' && station.mood === null
    toastNameEl.textContent = station.name.toUpperCase()
    toastFreqEl.textContent = station.freq ? `${station.freq} FM` : ''
    toastFreqEl.hidden = !station.freq
    if (toastBadgeEl) {
      toastBadgeEl.textContent = provider === 'youtube' ? 'YOUTUBE' : provider === 'spotify' ? 'SPOTIFY' : provider === 'apple' ? 'APPLE' : 'FM'
      toastBadgeEl.dataset.provider = provider
      toastBadgeEl.hidden = isOff
    }
    if (toastTrackEl) {
      const line = track && !isOff && (track.title !== station.name || provider !== 'fm')
        ? `${track.title}${track.artist ? ` — ${track.artist}` : ''}`
        : ''
      toastTrackEl.textContent = line
      toastTrackEl.hidden = !line
    }
    if (toastArtEl) {
      const art = !isOff ? (track?.artwork ?? activePlaylist?.artwork) : undefined
      if (art) { toastArtEl.src = art; toastArtEl.hidden = false }
      else { toastArtEl.removeAttribute('src'); toastArtEl.hidden = true }
    }
    toastBarsEl.hidden = isOff || pausedByUser
    toastEl.style.setProperty('--radio-accent', station.accent)
    toastEl.classList.toggle('is-off', isOff)
    toastEl.classList.toggle('has-track', !!toastTrackEl && !toastTrackEl.hidden)
    toastEl.hidden = false
    // Trigger CSS opacity transition cleanly on next frame.
    void toastEl.offsetWidth
    toastEl.classList.add('show')
    toastTimer = setTimeout(() => {
      toastTimer = null
      if (!toastEl) return
      toastEl.classList.remove('show')
      toastHideTimer = setTimeout(() => {
        toastHideTimer = null
        if (toastEl && !toastEl.classList.contains('show')) toastEl.hidden = true
      }, 260)
    }, TOAST_MS)
  }

  const bindProvider = (id: ExternalProviderId, provider: MusicProvider) => {
    providerUnsubs.get(id)?.()
    providerMap[id] = provider
    if (id === 'youtube' && ytFrameEl && 'mountHost' in provider && typeof (provider as YouTubeProvider).mountHost === 'function') {
      (provider as YouTubeProvider).mountHost(ytFrameEl)
    }
    const unsub = provider.subscribe((snap) => {
      // Whenever an external streaming provider reports active playback, ensure procedural music is hushed.
      if (snap.playing && activeProvider === id) {
        suppressProcedural()
        syncAmbient(true)
        const tk = snap.track ? `${snap.track.id ?? ''}|${snap.track.title}|${snap.track.artist}` : ''
        if (driving && tk && tk !== lastToastTrackKey) {
          lastToastTrackKey = tk
          showToast({ provider: id, track: snap.track })
        }
      }
      notify()
    })
    providerUnsubs.set(id, unsub)
  }

  bindProvider('youtube', providerMap.youtube)
  bindProvider('spotify', providerMap.spotify)
  bindProvider('apple', providerMap.apple)

  const ensureConductor = () => {
    if (typeof Worker === 'undefined') return null
    if (!radioConductor) {
      radioConductor = conductor(voice)
      radioConductor.steady = true
      // Start with an immediately full groove (bass + drums + keys/arp) so tuning feels alive right away.
      radioConductor.drive = 0.72
    }
    return radioConductor
  }

  const syncAmbient = (radioPlaying: boolean) => {
    const amb = opts.ambient
    if (!amb) return
    if (radioPlaying) {
      if (amb.on) { ambientWasOn = true; amb.on = false }
    } else if (ambientWasOn) {
      ambientWasOn = false
      amb.on = true
    }
  }

  const suppressProcedural = () => {
    if (radioConductor) {
      radioConductor.cut(null)
      radioConductor.on = false
    } else if (driving) {
      voice.hush(BUS.music)
    }
  }

  const pauseAllExternal = (except?: ExternalProviderId) => {
    for (const id of ['youtube', 'spotify', 'apple'] as const) {
      if (id === except) continue
      const p = providerMap[id]
      if (activeProvider === id || p.snapshot().playing) void p.pause()
    }
  }

  const applyVolumeNow = () => {
    const effective = Math.max(0, Math.min(1, baseVolume * musicGain))
    if (activeProvider === 'fm') {
      voice.set(SET.music, effective)
      musicGainTouched = effective !== 1
    } else {
      providerMap[activeProvider].setVolume(effective)
    }
  }

  const playTuneClick = (withStatic: boolean) => {
    if (!voice.running) return
    voice.play(RADIO_PATCHES.click, { bus: BUS.world, force: 0.78, gain: 0.65, pan: 0.08, room: 0.05 })
    if (withStatic) {
      voice.play(RADIO_PATCHES.static, { bus: BUS.world, force: 0.72, gain: 0.58, after: 0.012, room: 0.06 })
    }
  }

  const applyStation = (idx: number, optsTune: { playSfx: boolean; showUi: boolean }) => {
    const clamped = ((idx % STATIONS.length) + STATIONS.length) % STATIONS.length
    pauseAllExternal()
    activeProvider = 'fm'
    activePlaylist = null
    pausedByUser = false
    current = clamped
    lastToastTrackKey = ''
    if (driving) {
      remembered = { provider: 'fm', stationIndex: clamped, playlist: null }
      persistPref()
    }
    const st = STATIONS[clamped]
    if (optsTune.playSfx) playTuneClick(!!st.mood)
    if (st.mood && driving) {
      syncAmbient(true)
      const c = ensureConductor()
      if (c) {
        c.on = true
        c.steady = true
        c.drive = 0.72
        c.cut(st.mood, optsTune.playSfx ? 0.11 : 0.05)
      }
      applyVolumeNow()
    } else {
      suppressProcedural()
      syncAmbient(false)
    }
    if (optsTune.showUi && driving) showToast({ station: st, provider: 'fm', track: null })
    notify()
    return st
  }

  const selectPlaylist = async (playlist: PlaylistItem, optsSel: { playSfx?: boolean; showUi?: boolean } = {}): Promise<boolean> => {
    pendingAutoStart = false
    const playSfx = optsSel.playSfx ?? true
    const showUi = optsSel.showUi ?? true

    if (playlist.provider === 'fm') {
      const idx = STATIONS.findIndex((s) => s.id === playlist.id || s.mood === playlist.mood)
      const target = idx >= 0 ? idx : 1
      if (!driving) {
        remembered = { provider: 'fm', stationIndex: target, playlist: null }
        persistPref()
        notify()
        return true
      }
      applyStation(target, { playSfx, showUi })
      return true
    }

    const provider = providerMap[playlist.provider]
    if (qSoundOff || !enabled[playlist.provider]) return false
    if (!driving) {
      remembered = { provider: playlist.provider, stationIndex: 0, playlist }
      persistPref()
      notify()
      return true
    }

    if (playSfx) playTuneClick(false)
    // Suppress Voxelwright's procedural music bus & ambient music BEFORE starting external audio so they never clash.
    suppressProcedural()
    syncAmbient(true)
    pauseAllExternal(playlist.provider)

    activeProvider = playlist.provider
    activePlaylist = playlist
    current = 0
    pausedByUser = false
    remembered = { provider: playlist.provider, stationIndex: 0, playlist }
    persistPref()

    provider.setVolume(Math.max(0, Math.min(1, baseVolume * musicGain)))
    notify()
    const ok = await provider.playPlaylist(playlist)
    if (activeProvider !== playlist.provider || activePlaylist !== playlist || !driving) return false
    if (!ok) {
      // Failed to stream (e.g. disconnected or Dev Mode restriction): release ambient music if nothing plays.
      if (!provider.snapshot().playing) syncAmbient(false)
      notify()
      return false
    }
    const snap = provider.snapshot()
    lastToastTrackKey = snap.track ? `${snap.track.id ?? ''}|${snap.track.title}|${snap.track.artist}` : ''
    if (showUi && driving) showToast({ provider: playlist.provider, track: snap.track })
    notify()
    return true
  }

  const setDriving = (on: boolean) => {
    if (on === driving) return
    driving = on
    wasSolidL = false
    wasSolidR = false
    whooshCoolL = 0
    whooshCoolR = 0
    nearCarCool.clear()
    if (!on) {
      pendingAutoStart = false
      autoStartDelay = 0
      hornHeld = false
      impactDuck = 0
      impactHold = 0
      if (musicGainTouched) {
        musicGain = 1
        musicGainTouched = false
        voice.set(SET.music, 1)
      }
      suppressProcedural()
      pauseAllExternal()
      syncAmbient(false)
      current = 0
      activeProvider = 'fm'
      activePlaylist = null
      pausedByUser = false
      lastToastTrackKey = ''
      hideToast()
      notify()
      return
    }
    // Entering car: remember last station or streaming playlist! Slight delay lets door thump & ignition breathe first.
    if (remembered.provider === 'fm' && remembered.stationIndex > 0) {
      pendingAutoStart = true
      autoStartDelay = 0.42
    } else if (isExternalProvider(remembered.provider) && remembered.playlist) {
      const snap = providerMap[remembered.provider].snapshot()
      if ((snap.status === 'ready' || snap.status === 'connected') && !qSoundOff) {
        pendingAutoStart = true
        autoStartDelay = 0.42
      } else if (!isWebdriver && !qSoundOff) {
        // Seamless offline fallback to Bay Drive FM if streaming account is disconnected on re-entry.
        remembered = { provider: 'fm', stationIndex: 1, playlist: null }
        pendingAutoStart = true
        autoStartDelay = 0.42
      } else {
        current = 0
      }
    } else {
      current = 0
    }
    notify()
  }

  const cycle = (step: 1 | -1 = 1): Station => {
    pendingAutoStart = false
    if (!driving) {
      const nextIdx = ((remembered.stationIndex + step) % STATIONS.length + STATIONS.length) % STATIONS.length
      remembered = { provider: 'fm', stationIndex: nextIdx, playlist: null }
      persistPref()
      notify()
      return STATIONS[nextIdx]
    }
    // If streaming on Spotify/Apple, N cycles through that provider's playlists before turning Radio Off.
    if (activeProvider !== 'fm' && activePlaylist) {
      const snap = providerMap[activeProvider].snapshot()
      const list = [...CURATED_PLAYLISTS[activeProvider], ...snap.playlists]
      const pos = list.findIndex((p) => p.id === activePlaylist?.id)
      const nextPos = pos + step
      if (nextPos >= 0 && nextPos < list.length) {
        void selectPlaylist(list[nextPos], { playSfx: true, showUi: true })
        return currentStationView()
      }
      // Wrapped past end of provider playlists -> turn Radio Off cleanly.
      return applyStation(0, { playSfx: true, showUi: true })
    }
    // FM cycle order: Off -> Bay Drive FM -> Twin Peaks Chill -> Fillmore Funk -> Off
    return applyStation(current + step, { playSfx: true, showUi: true })
  }

  const tune = (target: Station['id'] | number, silent = false): Station => {
    pendingAutoStart = false
    const idx = typeof target === 'number' ? target : STATIONS.findIndex((s) => s.id === target)
    if (idx < 0) return currentStationView()
    if (!driving) {
      const clamped = ((idx % STATIONS.length) + STATIONS.length) % STATIONS.length
      remembered = { provider: 'fm', stationIndex: clamped, playlist: null }
      persistPref()
      notify()
      return STATIONS[clamped]
    }
    return applyStation(idx, { playSfx: !silent, showUi: !silent })
  }

  const togglePlay = async (): Promise<void> => {
    if (activeProvider === 'fm') {
      if (current === 0) {
        const target = remembered.stationIndex > 0 ? remembered.stationIndex : 1
        if (driving) applyStation(target, { playSfx: true, showUi: true })
        else { remembered = { provider: 'fm', stationIndex: target, playlist: null }; persistPref(); notify() }
        return
      }
      pausedByUser = !pausedByUser
      if (pausedByUser) {
        suppressProcedural()
        syncAmbient(false)
      } else if (driving) {
        const st = STATIONS[current]
        if (st.mood) {
          syncAmbient(true)
          const c = ensureConductor()
          if (c) { c.on = true; c.steady = true; c.drive = 0.72; c.cut(st.mood, 0.05) }
          applyVolumeNow()
        }
      }
      notify()
      return
    }
    const provider = providerMap[activeProvider]
    if (pausedByUser || !provider.snapshot().playing) {
      pausedByUser = false
      suppressProcedural()
      syncAmbient(true)
      provider.setVolume(Math.max(0, Math.min(1, baseVolume * musicGain)))
      if (activePlaylist && !provider.snapshot().activePlaylistId) await provider.playPlaylist(activePlaylist)
      else await provider.resume()
    } else {
      pausedByUser = true
      await provider.pause()
    }
    notify()
  }

  const nextTrack = async (): Promise<boolean> => {
    if (activeProvider === 'fm') {
      cycle(1)
      return true
    }
    const ok = await providerMap[activeProvider].nextTrack()
    if (ok && driving) showToast({ provider: activeProvider, track: providerMap[activeProvider].snapshot().track })
    notify()
    return ok
  }

  const prevTrack = async (): Promise<boolean> => {
    if (activeProvider === 'fm') {
      cycle(-1)
      return true
    }
    const ok = await providerMap[activeProvider].prevTrack()
    if (ok && driving) showToast({ provider: activeProvider, track: providerMap[activeProvider].snapshot().track })
    notify()
    return ok
  }

  const setVolume = (v: number) => {
    baseVolume = Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 1
    applyVolumeNow()
    notify()
  }

  const duck = (strength: number, holdSec = 0.25) => {
    if (!isSourceActive()) return
    const amt = Math.min(0.7, Math.max(0.15, strength * 0.65))
    impactDuck = Math.max(impactDuck, amt)
    impactHold = Math.max(impactHold, holdSec)
  }

  const setHorn = (on: boolean) => {
    hornHeld = on
  }

  const whoosh = (side: number, kmh: number, closeness = 0.85): boolean => {
    const s = Math.max(-1, Math.min(1, Number.isFinite(side) ? side : 0))
    if (s < 0 && whooshCoolL > 0) return false
    if (s > 0 && whooshCoolR > 0) return false
    if (!playDopplerWhoosh(voice, s, kmh, closeness)) return false
    if (s < 0) whooshCoolL = 0.36
    else if (s > 0) whooshCoolR = 0.36
    else { whooshCoolL = 0.28; whooshCoolR = 0.28 }
    whooshCount++
    lastWhoosh = { side: s, kmh, at: performance.now() }
    return true
  }

  // Listen for `voxelwright:nearmiss` events from traffic/stunt lanes or scripts.
  const onNearMiss = (e: Event) => {
    if (!driving) return
    const d = (e as CustomEvent<NearMissDetail | null>).detail ?? {}
    const kmh = typeof d.kmh === 'number' && Number.isFinite(d.kmh)
      ? d.kmh
      : typeof d.speedKmh === 'number' && Number.isFinite(d.speedKmh)
        ? d.speedKmh
        : typeof d.speed === 'number' && Number.isFinite(d.speed)
          ? d.speed
          : lastSpeedKmh
    let side = typeof d.side === 'number' && Number.isFinite(d.side)
      ? d.side
      : typeof d.pan === 'number' && Number.isFinite(d.pan)
        ? d.pan
        : 0
    if (!side && Array.isArray(d.at) && d.at.length === 3) {
      side = voice.hear(d.at).pan
    }
    const closeness = typeof d.closeness === 'number'
      ? d.closeness
      : typeof d.clearance === 'number'
        ? Math.max(0.3, Math.min(1, 1 - d.clearance / 4.5))
        : typeof d.distance === 'number'
          ? Math.max(0.25, Math.min(1, 1 - d.distance / 12))
          : 0.9
    whoosh(side, kmh, closeness)
  }
  if (typeof window !== 'undefined') window.addEventListener('voxelwright:nearmiss', onNearMiss)

  const frame = (
    at: readonly [number, number, number],
    yaw: number,
    dt: number,
    speedKmh: number,
    kind?: (x: number, y: number, z: number) => number,
    nearby?: readonly (readonly [number, number, number])[],
  ) => {
    lastSpeedKmh = speedKmh
    if (!driving) return
    if (whooshCoolL > 0) whooshCoolL = Math.max(0, whooshCoolL - dt)
    if (whooshCoolR > 0) whooshCoolR = Math.max(0, whooshCoolR - dt)

    // Subtle auto-resume of remembered station or streaming playlist shortly after hopping into the car.
    if (pendingAutoStart && (voice.running || remembered.provider !== 'fm')) {
      autoStartDelay -= dt
      if (autoStartDelay <= 0) {
        pendingAutoStart = false
        if (remembered.provider === 'fm' && remembered.stationIndex > 0) {
          applyStation(remembered.stationIndex, { playSfx: true, showUi: true })
        } else if (isExternalProvider(remembered.provider) && remembered.playlist) {
          void selectPlaylist(remembered.playlist, { playSfx: true, showUi: true })
        }
      }
    }

    // Tick radio conductor if tuned to an active procedural FM station.
    if (activeProvider === 'fm' && current > 0 && !pausedByUser && radioConductor) {
      radioConductor.tick()
    }

    // Smooth radio ducking on horn & loud impacts — applied identically to procedural FM and external streaming!
    if (impactHold > 0) impactHold = Math.max(0, impactHold - dt)
    else if (impactDuck > 0) impactDuck = Math.max(0, impactDuck - dt * 1.45)
    const active = isSourceActive()
    const targetGain = active ? Math.max(0.32, 1 - Math.max(hornHeld ? 0.6 : 0, impactDuck)) : 1
    if (Math.abs(targetGain - musicGain) > 0.004) {
      const rate = targetGain < musicGain ? 14 : 3.5
      musicGain += (targetGain - musicGain) * Math.min(1, dt * rate)
      if (Math.abs(1 - musicGain) < 0.005 && targetGain === 1) musicGain = 1
      applyVolumeNow()
    } else if (musicGainTouched && targetGain === 1 && musicGain !== 1) {
      musicGain = 1
      applyVolumeNow()
    }

    // High-speed Doppler pass-by detector for close buildings, poles, trees, and other cars at 70+ km/h.
    if (speedKmh < MIN_WHOOSH_KMH || !voice.running) {
      wasSolidL = false
      wasSolidR = false
      return
    }
    scanAcc += dt
    if (scanAcc < 0.055) return
    scanAcc = 0

    const rx = Math.cos(yaw), rz = Math.sin(yaw)
    const fx = Math.sin(yaw), fz = -Math.cos(yaw)
    const baseY = Math.round(at[1] + 6)

    // 1) Nearby world geometry (buildings, bridge pillars, lamp posts, parked cars) on left & right.
    if (kind) {
      let solidL = false, closeL = 0
      let solidR = false, closeR = 0
      for (const lateral of [26, 46]) {
        const lx = Math.round(at[0] - rx * lateral + fx * 10)
        const lz = Math.round(at[2] - rz * lateral + fz * 10)
        if ((kind(lx, baseY, lz) & 15) > 0 || (kind(lx, baseY + 12, lz) & 15) > 0) {
          solidL = true
          closeL = Math.max(closeL, lateral < 34 ? 1 : 0.65)
        }
        const rxp = Math.round(at[0] + rx * lateral + fx * 10)
        const rzp = Math.round(at[2] + rz * lateral + fz * 10)
        if ((kind(rxp, baseY, rzp) & 15) > 0 || (kind(rxp, baseY + 12, rzp) & 15) > 0) {
          solidR = true
          closeR = Math.max(closeR, lateral < 34 ? 1 : 0.65)
        }
      }
      if (solidL && !wasSolidL && whooshCoolL <= 0) whoosh(-0.88, speedKmh, closeL)
      if (solidR && !wasSolidR && whooshCoolR <= 0) whoosh(0.88, speedKmh, closeR)
      wasSolidL = solidL
      wasSolidR = solidR
    }

    // 2) Fast-passing other living vehicles within 7 m laterally.
    if (nearby && nearby.length) {
      const now = performance.now()
      for (let i = 0; i < nearby.length; i++) {
        const p = nearby[i]
        const dx = (p[0] - at[0]) / M, dy = (p[1] - at[1]) / M, dz = (p[2] - at[2]) / M
        if (Math.abs(dy) > 4.5) continue
        const ahead = dx * fx + dz * fz
        const side = dx * rx + dz * rz
        const absSide = Math.abs(side)
        if (absSide > 1.4 && absSide < 7.5 && Math.abs(ahead) < 5.5) {
          const until = nearCarCool.get(i) ?? 0
          if (now >= until) {
            nearCarCool.set(i, now + 900)
            whoosh(side < 0 ? -0.92 : 0.92, speedKmh, Math.max(0.4, 1 - absSide / 8.5))
          }
        }
      }
    }
  }

  const attachHud = (hud: Hud) => {
    if (toastEl) return
    const el = hud.panel('radio-toast')
    el.setAttribute('role', 'status')
    el.setAttribute('aria-live', 'polite')
    el.hidden = true
    el.innerHTML =
      '<img class="rt-art" alt="" hidden>' +
      '<span class="rt-note" aria-hidden="true">&#9835;</span>' +
      '<span class="rt-copy">' +
        '<span class="rt-top">' +
          '<span class="rt-badge" hidden></span>' +
          '<span class="rt-name"></span>' +
          '<span class="rt-freq"></span>' +
        '</span>' +
        '<span class="rt-track" hidden></span>' +
      '</span>' +
      '<span class="rt-bars" aria-hidden="true"><i></i><i></i><i></i></span>'
    el.addEventListener('pointerdown', (e) => {
      if (!driving) return
      e.stopPropagation()
    })
    el.addEventListener('click', (e) => {
      if (!driving) return
      e.preventDefault()
      e.stopPropagation()
      if (openPickerFn) openPickerFn()
      else cycle(1)
    })
    toastEl = el
    toastArtEl = el.querySelector<HTMLImageElement>('.rt-art')
    toastBadgeEl = el.querySelector<HTMLElement>('.rt-badge')
    toastNameEl = el.querySelector<HTMLElement>('.rt-name')
    toastFreqEl = el.querySelector<HTMLElement>('.rt-freq')
    toastTrackEl = el.querySelector<HTMLElement>('.rt-track')
    toastBarsEl = el.querySelector<HTMLElement>('.rt-bars')

    // Visible YouTube Music mini-player (>=200x200 px per YouTube ToS), strictly hidden when idle or on FM.
    const yt = hud.panel('radio-yt')
    yt.hidden = true
    yt.setAttribute('aria-label', 'YouTube Music player')
    yt.innerHTML =
      '<div class="ryt-bar">' +
        '<span class="ryt-lbl" title="Open Car Radio">YouTube Music</span>' +
        '<button class="ryt-stop" type="button" aria-label="Stop YouTube Music">&times;</button>' +
      '</div>' +
      '<div class="ryt-frame"></div>'
    ytPanelEl = yt
    ytLabelEl = yt.querySelector<HTMLElement>('.ryt-lbl')
    ytFrameEl = yt.querySelector<HTMLElement>('.ryt-frame')
    ytLabelEl?.addEventListener('click', () => openPickerFn?.())
    yt.querySelector<HTMLButtonElement>('.ryt-stop')?.addEventListener('click', () => {
      applyStation(0, { playSfx: true, showUi: true })
    })
    if (ytFrameEl && 'mountHost' in providerMap.youtube && typeof (providerMap.youtube as YouTubeProvider).mountHost === 'function') {
      (providerMap.youtube as YouTubeProvider).mountHost(ytFrameEl)
    }
  }

  const dispose = () => {
    hideToast()
    if (ytPanelEl) ytPanelEl.hidden = true
    if (typeof document !== 'undefined') document.documentElement.classList.remove('yt-mini')
    if (typeof window !== 'undefined') window.removeEventListener('voxelwright:nearmiss', onNearMiss)
    suppressProcedural()
    for (const unsub of providerUnsubs.values()) unsub()
    providerUnsubs.clear()
    providerMap.youtube.dispose()
    providerMap.spotify.dispose()
    providerMap.apple.dispose()
    stateListeners.clear()
  }

  return {
    get state(): RadioState { return getState() },
    cycle,
    tune,
    selectPlaylist,
    togglePlay,
    nextTrack,
    prevTrack,
    setVolume,
    setDriving,
    duck,
    setHorn,
    whoosh,
    frame,
    attachHud,
    onOpenPicker(fn) { openPickerFn = fn },
    openPicker(tab) { openPickerFn?.(tab) },
    registerProvider(provider) {
      if (isExternalProvider(provider.id)) {
        bindProvider(provider.id, provider)
        notify()
      }
    },
    getProvider(id) { return providerMap[id] },
    subscribe(fn) { stateListeners.add(fn); return () => { stateListeners.delete(fn) } },
    dispose,
  }
}
