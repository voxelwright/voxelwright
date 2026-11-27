// Pluggable Car Radio Streaming Providers (YouTube / YouTube Music IFrame API, plus Spotify PKCE & Apple MusicKit JS v3):
// YouTube Music works out of the box with zero API key or developer account (official YouTube IFrame Player API
// with >=200x200 visible viewport per YouTube ToS). Spotify and Apple Music remain ready in code behind
// `ENABLED_STREAMING_PROVIDERS` (disabled in the UI until developer accounts are configured, or `?radio_providers=all`).
//
// See `.agents/skills/streaming-music/SKILL.md` for grounded vendor requirements, ToS rules, and limits.

export type ProviderId = 'fm' | 'youtube' | 'spotify' | 'apple'
export type ExternalProviderId = 'youtube' | 'spotify' | 'apple'

/** Feature switches for external streaming providers shown in the UI (override with `?radio_providers=all`). */
export const ENABLED_STREAMING_PROVIDERS: Readonly<Record<ExternalProviderId, boolean>> = {
  youtube: true,
  spotify: false,
  apple: false,
} as const

export function enabledProviders(query?: URLSearchParams): Readonly<Record<ExternalProviderId, boolean>> {
  const raw = query?.get('radio_providers')?.toLowerCase().trim()
  if (!raw) return ENABLED_STREAMING_PROVIDERS
  if (raw === 'all') return { youtube: true, spotify: true, apple: true }
  const set = new Set(raw.split(',').map((s) => s.trim()))
  return {
    youtube: set.has('youtube'),
    spotify: set.has('spotify'),
    apple: set.has('apple'),
  }
}

export type ProviderStatus = 'disconnected' | 'connecting' | 'connected' | 'ready' | 'error'

export interface TrackInfo {
  readonly id?: string
  readonly title: string
  readonly artist: string
  readonly album?: string
  readonly artwork?: string
  readonly durationMs?: number
}

export interface PlaylistItem {
  readonly id: string
  readonly provider: ProviderId
  readonly name: string
  readonly subtitle?: string
  readonly uri: string
  readonly accent: string
  readonly artwork?: string
  readonly trackCount?: number
  readonly curated?: boolean
  readonly embedUrl?: string
  readonly freq?: string
  readonly mood?: string | null
}

export interface ProviderSnapshot {
  readonly id: ProviderId
  readonly name: string
  readonly accent: string
  readonly status: ProviderStatus
  readonly configured: boolean
  readonly accountName?: string
  readonly premium?: boolean
  readonly error?: string
  readonly playlists: readonly PlaylistItem[]
  readonly activePlaylistId: string | null
  readonly track: TrackInfo | null
  readonly playing: boolean
}

export interface MusicProvider {
  readonly id: ProviderId
  readonly name: string
  readonly accent: string
  snapshot(): ProviderSnapshot
  subscribe(fn: (s: ProviderSnapshot) => void): () => void
  connect(config?: Record<string, string>): Promise<boolean>
  disconnect(): Promise<void>
  loadUserPlaylists(): Promise<readonly PlaylistItem[]>
  playPlaylist(playlist: PlaylistItem): Promise<boolean>
  pause(): Promise<void>
  resume(): Promise<void>
  nextTrack(): Promise<boolean>
  prevTrack(): Promise<boolean>
  setVolume(gain: number): void
  dispose(): void
}

/** Curated San Francisco driving playlists matching Voxelwright's 3 car radio themes. */
export const CURATED_PLAYLISTS: Readonly<Record<ProviderId, readonly PlaylistItem[]>> = {
  fm: [
    {
      id: 'baydrive',
      provider: 'fm',
      name: 'Bay Drive FM',
      subtitle: 'SF Night Synth · Procedural Outrun',
      uri: 'fm:baydrive',
      accent: '#ff4fa0',
      freq: '104.7',
      mood: 'baydrive',
      curated: true,
    },
    {
      id: 'twinpeaks',
      provider: 'fm',
      name: 'Twin Peaks Chill',
      subtitle: 'Sunset Coast Lo-Fi · Warm Rhodes',
      uri: 'fm:twinpeaks',
      accent: '#ffae34',
      freq: '91.3',
      mood: 'twinpeaks',
      curated: true,
    },
    {
      id: 'fillmore',
      provider: 'fm',
      name: 'Fillmore Funk',
      subtitle: 'Classic SF Funk & Soul · Live Synth Groove',
      uri: 'fm:fillmore',
      accent: '#35d0ba',
      freq: '98.5',
      mood: 'fillmore',
      curated: true,
    },
  ],
  youtube: [
    {
      id: 'yt-sf-night-synth',
      provider: 'youtube',
      name: 'SF Night Synth Radio',
      subtitle: 'Lofi Girl 24/7 Synthwave · Bay Drive Cruise',
      uri: 'yt:video:4xDzrJKXOOY',
      accent: '#ff4fa0',
      curated: true,
    },
    {
      id: 'yt-sunset-coast',
      provider: 'youtube',
      name: 'Sunset Coast Chill Radio',
      subtitle: 'Lofi Girl 24/7 Chill Beats · Twin Peaks',
      uri: 'yt:video:rUxyKA_-grg',
      accent: '#ffae34',
      curated: true,
    },
    {
      id: 'yt-fillmore-funk',
      provider: 'youtube',
      name: 'Fillmore Groove Radio',
      subtitle: 'Chillhop 24/7 Jazzy Beats · SF Cruising',
      uri: 'yt:video:5yx6BWlEVcY',
      accent: '#35d0ba',
      curated: true,
    },
  ],
  spotify: [
    {
      id: 'sp-sf-night-synth',
      provider: 'spotify',
      name: 'SF Night Synth',
      subtitle: 'Bay Drive · Midnight Neon Cruise',
      uri: 'spotify:playlist:37i9dQZF1DXdLEN7aqioXM',
      embedUrl: 'https://open.spotify.com/embed/playlist/37i9dQZF1DXdLEN7aqioXM?utm_source=generator&theme=0',
      accent: '#ff4fa0',
      curated: true,
    },
    {
      id: 'sp-sunset-coast',
      provider: 'spotify',
      name: 'Sunset Coast Chill',
      subtitle: 'Twin Peaks · Golden Hour Highway',
      uri: 'spotify:playlist:37i9dQZF1DX4WYpdgoIcn6',
      embedUrl: 'https://open.spotify.com/embed/playlist/37i9dQZF1DX4WYpdgoIcn6?utm_source=generator&theme=0',
      accent: '#ffae34',
      curated: true,
    },
    {
      id: 'sp-fillmore-funk',
      provider: 'spotify',
      name: 'Classic SF Funk & Soul',
      subtitle: 'Fillmore District · Cruising Grooves',
      uri: 'spotify:playlist:37i9dQZF1DX4o1oenSJRJd',
      embedUrl: 'https://open.spotify.com/embed/playlist/37i9dQZF1DX4o1oenSJRJd?utm_source=generator&theme=0',
      accent: '#35d0ba',
      curated: true,
    },
  ],
  apple: [
    {
      id: 'am-sf-night-synth',
      provider: 'apple',
      name: 'SF Night Synth',
      subtitle: 'Bay Drive · Midnight Neon Cruise',
      uri: 'pl.043a2c9876114d95a4659988497567be',
      embedUrl: 'https://embed.music.apple.com/us/playlist/midnight-city/pl.043a2c9876114d95a4659988497567be?theme=dark',
      accent: '#ff4fa0',
      curated: true,
    },
    {
      id: 'am-sunset-coast',
      provider: 'apple',
      name: 'Sunset Coast Chill',
      subtitle: 'Twin Peaks · Pacific Breeze',
      uri: 'pl.2b0e6e332fdf4b7a91164da3162127b5',
      embedUrl: 'https://embed.music.apple.com/us/playlist/chill-mix/pl.2b0e6e332fdf4b7a91164da3162127b5?theme=dark',
      accent: '#ffae34',
      curated: true,
    },
    {
      id: 'am-fillmore-funk',
      provider: 'apple',
      name: 'Classic SF Funk & Soul',
      subtitle: 'Fillmore District · Golden-Era Grooves',
      uri: 'pl.606afcbb70264d2eb2b51d8dbcfa6a12',
      embedUrl: 'https://embed.music.apple.com/us/playlist/classic-funk/pl.606afcbb70264d2eb2b51d8dbcfa6a12?theme=dark',
      accent: '#35d0ba',
      curated: true,
    },
  ],
} as const

export const SPOTIFY_SCOPES = [
  'streaming',
  'user-read-private',
  'user-read-email',
  'user-modify-playback-state',
  'user-read-playback-state',
  'playlist-read-private',
  'playlist-read-collaborative',
  'user-library-read',
].join(' ')

const SPOTIFY_STORAGE_KEY = 'voxelwright.radio.spotify'
const SPOTIFY_PKCE_KEY = 'voxelwright.radio.spotify.pkce'
const APPLE_STORAGE_KEY = 'voxelwright.radio.apple'
const OAUTH_CHANNEL = 'voxelwright-radio-oauth'

export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

const safeLocalStorage = (): StorageLike | null => {
  try {
    if (typeof window === 'undefined' || typeof localStorage === 'undefined') return null
    localStorage.setItem('voxelwright.radio.can', '1')
    localStorage.removeItem('voxelwright.radio.can')
    return localStorage
  } catch {
    return null
  }
}

const safeSessionStorage = (): StorageLike | null => {
  try {
    if (typeof window === 'undefined' || typeof sessionStorage === 'undefined') return null
    sessionStorage.setItem('voxelwright.radio.can', '1')
    sessionStorage.removeItem('voxelwright.radio.can')
    return sessionStorage
  } catch {
    return null
  }
}

const clamp01 = (v: number) => (Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0)

/** Strips bearer tokens, JWTs, or OAuth codes from user-facing status/error text. */
export function scrubSecret(text: string, secrets: readonly (string | undefined | null)[] = []): string {
  let out = text
  for (const s of secrets) {
    if (s && s.length >= 8) out = out.split(s).join('…')
  }
  return out
    .replace(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, '…')
    .replace(/\b(BQ[A-Za-z0-9_-]{16,}|AQ[A-Za-z0-9_-]{16,})\b/g, '…')
}

const base64Url = (bytes: Uint8Array): string => {
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  const encoded = typeof btoa === 'function' ? btoa(bin) : Buffer.from(bytes).toString('base64')
  return encoded.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

/** Generates a cryptographic PKCE verifier (86 base64url chars) and its S256 challenge. */
export async function generatePkcePair(): Promise<{ verifier: string; challenge: string; state: string }> {
  const cryptoObj = globalThis.crypto
  if (!cryptoObj?.getRandomValues || !cryptoObj?.subtle) {
    throw new Error('Web Crypto is unavailable here (use HTTPS or http://127.0.0.1 for Spotify PKCE).')
  }
  const verifierBytes = new Uint8Array(64)
  const stateBytes = new Uint8Array(16)
  cryptoObj.getRandomValues(verifierBytes)
  cryptoObj.getRandomValues(stateBytes)
  const verifier = base64Url(verifierBytes)
  const state = base64Url(stateBytes)
  const digest = await cryptoObj.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  const challenge = base64Url(new Uint8Array(digest))
  return { verifier, challenge, state }
}

/**
 * Computes the canonical Spotify OAuth redirect URI from the current location.
 * Spotify banned `http://localhost` in 2025 — loopback IP `127.0.0.1` (or HTTPS) is required.
 */
export function canonicalSpotifyRedirectUri(href = typeof location !== 'undefined' ? location.href : 'http://127.0.0.1/'): { uri: string; isLocalhost: boolean } {
  const u = new URL(href)
  const isLocalhost = u.hostname === 'localhost'
  const origin = isLocalhost ? `${u.protocol}//127.0.0.1${u.port ? `:${u.port}` : ''}` : u.origin
  return { uri: `${origin}${u.pathname}`, isLocalhost }
}

/** Builds a Spotify Authorization Code + PKCE URL (no client_secret). */
export function buildSpotifyAuthorizeUrl(opts: {
  clientId: string
  redirectUri: string
  codeChallenge: string
  state: string
  scopes?: string
}): string {
  const u = new URL('https://accounts.spotify.com/authorize')
  u.searchParams.set('client_id', opts.clientId)
  u.searchParams.set('response_type', 'code')
  u.searchParams.set('redirect_uri', opts.redirectUri)
  u.searchParams.set('code_challenge_method', 'S256')
  u.searchParams.set('code_challenge', opts.codeChallenge)
  u.searchParams.set('state', opts.state)
  u.searchParams.set('scope', opts.scopes ?? SPOTIFY_SCOPES)
  return u.toString()
}

/** Parses a Spotify playlist URL or URI into a canonical `spotify:playlist:<id>` URI. */
export function parseSpotifyPlaylistUri(input: string): string | null {
  const s = input.trim()
  const uriMatch = /^spotify:playlist:([A-Za-z0-9]{10,})$/.exec(s)
  if (uriMatch) return `spotify:playlist:${uriMatch[1]}`
  const urlMatch = /open\.spotify\.com\/(?:embed\/)?playlist\/([A-Za-z0-9]{10,})/.exec(s)
  if (urlMatch) return `spotify:playlist:${urlMatch[1]}`
  return null
}

/** Parses an Apple Music playlist URL or catalog/library ID into a MusicKit playlist ID. */
export function parseApplePlaylistId(input: string): string | null {
  const s = input.trim()
  if (/^p\.[A-Za-z0-9._-]{6,}$/.test(s) || /^pl\.[A-Za-z0-9._-]{6,}$/.test(s)) return s
  const urlMatch = /music\.apple\.com\/[a-z]{2}\/playlist\/[^/]+\/(pl\.[A-Za-z0-9._-]+|p\.[A-Za-z0-9._-]+)/i.exec(s)
  if (urlMatch) return urlMatch[1]
  return null
}

/**
 * Parses a YouTube or YouTube Music playlist/video URL or ID into a canonical URI:
 * - `yt:playlist:<listId>` for playlists (including `music.youtube.com/playlist?list=...`)
 * - `yt:video:<videoId>` for individual tracks or 24/7 live radio streams
 */
export function parseYouTubeSource(input: string): { kind: 'playlist' | 'video'; id: string; uri: string; artwork?: string } | null {
  const s = input.trim()
  if (!s) return null
  const canon = /^yt:(playlist|video):([A-Za-z0-9_-]{10,})$/.exec(s)
  if (canon) {
    const kind = canon[1] as 'playlist' | 'video'
    const id = canon[2]
    return { kind, id, uri: `yt:${kind}:${id}`, ...(kind === 'video' ? { artwork: `https://i.ytimg.com/vi/${id}/hqdefault.jpg` } : {}) }
  }
  // Full URL (youtube.com, music.youtube.com, youtu.be)
  if (/^https?:\/\//i.test(s)) {
    try {
      const u = new URL(s)
      const host = u.hostname.toLowerCase().replace(/^www\./, '')
      const isYt = host === 'youtube.com' || host === 'music.youtube.com' || host === 'm.youtube.com' || host === 'youtu.be'
      if (!isYt) return null
      const list = u.searchParams.get('list')
      if (list && /^[A-Za-z0-9_-]{12,}$/.test(list)) {
        return { kind: 'playlist', id: list, uri: `yt:playlist:${list}` }
      }
      const v = host === 'youtu.be' ? u.pathname.replace(/^\/+/, '').split('/')[0] : (u.searchParams.get('v') ?? /\/(?:embed|live|shorts)\/([A-Za-z0-9_-]{11})/.exec(u.pathname)?.[1])
      if (v && /^[A-Za-z0-9_-]{11}$/.test(v)) {
        return { kind: 'video', id: v, uri: `yt:video:${v}`, artwork: `https://i.ytimg.com/vi/${v}/hqdefault.jpg` }
      }
      return null
    } catch {
      return null
    }
  }
  // Bare playlist ID (`PL...`, `RDCLAK5uy_...`, `OLAK5uy_...`, `UU...`)
  if (/^(PL|RD|OLAK5uy_|UU|LL|FL)[A-Za-z0-9_-]{10,}$/.test(s)) {
    return { kind: 'playlist', id: s, uri: `yt:playlist:${s}` }
  }
  // Bare 11-char video ID
  if (/^[A-Za-z0-9_-]{11}$/.test(s)) {
    return { kind: 'video', id: s, uri: `yt:video:${s}`, artwork: `https://i.ytimg.com/vi/${s}/hqdefault.jpg` }
  }
  return null
}

// ── External SDK Script Loader (strictly on-demand, never on webdriver) ──

const loadedScripts = new Map<string, Promise<void>>()

function loadExternalScript(src: string): Promise<void> {
  if (typeof navigator !== 'undefined' && navigator.webdriver) return Promise.reject(new Error('Live music SDKs are disabled in automated browsers.'))
  if (typeof document === 'undefined') return Promise.reject(new Error('No document available'))
  const existing = loadedScripts.get(src)
  if (existing) return existing
  const p = new Promise<void>((resolve, reject) => {
    const el = document.createElement('script')
    el.src = src
    el.async = true
    // YouTube serves its classic SDK without an Access-Control-Allow-Origin header.
    el.onload = () => resolve()
    el.onerror = () => {
      loadedScripts.delete(src)
      reject(new Error(`Could not load ${new URL(src).hostname} SDK (check connection or host CSP).`))
    }
    document.head.append(el)
  })
  loadedScripts.set(src, p)
  return p
}

// ── Spotify Web Playback SDK Types (minimal structural surface) ──────────

export interface SpotifyWebPlayer {
  connect(): Promise<boolean>
  disconnect(): void
  addListener(event: string, cb: (payload: unknown) => void): void
  activateElement?(): Promise<void>
  pause(): Promise<void>
  resume(): Promise<void>
  nextTrack(): Promise<void>
  previousTrack(): Promise<void>
  setVolume(volume: number): Promise<void>
  getCurrentState(): Promise<SpotifyPlaybackState | null>
}

export interface SpotifyPlaybackState {
  paused: boolean
  position?: number
  duration?: number
  track_window?: {
    current_track?: {
      id?: string
      name?: string
      duration_ms?: number
      artists?: readonly { name: string }[]
      album?: { name?: string; images?: readonly { url: string }[] }
    }
  }
}

interface SpotifyStoredSession {
  clientId: string
  accessToken?: string
  refreshToken?: string
  expiresAt?: number
  accountName?: string
  premium?: boolean
}

export interface SpotifyProviderOptions {
  fetch?: typeof globalThis.fetch
  storage?: StorageLike | null
  sessionStorage?: StorageLike | null
  now?: () => number
  /** Optional injected Web Playback SDK factory for deterministic unit/browser tests. */
  createPlayer?: (opts: { name: string; getOAuthToken: (cb: (token: string) => void) => void; volume: number }) => Promise<SpotifyWebPlayer>
  /** Optional injected OAuth authorization handler (defaults to popup/redirect PKCE). */
  authorize?: (url: string, state: string) => Promise<{ code: string; state: string } | null>
  /** Initial Client ID if provided via page config (never hardcoded in repo). */
  clientId?: string
}

export function createSpotifyProvider(opts: SpotifyProviderOptions = {}): MusicProvider & {
  /** Completes a PKCE callback if the current page URL carries `?code=...&state=...`. */
  completeRedirectIfPresent(): Promise<boolean>
  /** Returns the stored Client ID (safe public identifier, not a secret). */
  readonly clientId: string
} {
  const fetcher = opts.fetch ?? globalThis.fetch?.bind(globalThis)
  const store = opts.storage === undefined ? safeLocalStorage() : opts.storage
  const sess = opts.sessionStorage === undefined ? safeSessionStorage() : opts.sessionStorage
  const now = opts.now ?? (() => Date.now())

  let session: SpotifyStoredSession | null = null
  const loadSession = (): SpotifyStoredSession | null => {
    try {
      const raw = store?.getItem(SPOTIFY_STORAGE_KEY)
      if (!raw) return opts.clientId ? { clientId: opts.clientId } : null
      const parsed = JSON.parse(raw) as Partial<SpotifyStoredSession>
      if (!parsed || typeof parsed.clientId !== 'string') return null
      return {
        clientId: parsed.clientId,
        accessToken: typeof parsed.accessToken === 'string' ? parsed.accessToken : undefined,
        refreshToken: typeof parsed.refreshToken === 'string' ? parsed.refreshToken : undefined,
        expiresAt: typeof parsed.expiresAt === 'number' ? parsed.expiresAt : undefined,
        accountName: typeof parsed.accountName === 'string' ? parsed.accountName : undefined,
        premium: typeof parsed.premium === 'boolean' ? parsed.premium : undefined,
      }
    } catch {
      return null
    }
  }
  const saveSession = (next: SpotifyStoredSession | null) => {
    session = next
    try {
      if (!next) store?.removeItem(SPOTIFY_STORAGE_KEY)
      else store?.setItem(SPOTIFY_STORAGE_KEY, JSON.stringify(next))
    } catch { /* memory-only fallback */ }
  }
  session = loadSession()

  let status: ProviderStatus = session?.accessToken ? 'connected' : 'disconnected'
  let errorMsg: string | undefined
  let userPlaylists: PlaylistItem[] = []
  let activePlaylistId: string | null = null
  let track: TrackInfo | null = null
  let playing = false
  let player: SpotifyWebPlayer | null = null
  let deviceId: string | null = null
  let desiredVolume = 0.85
  let lastSentVolume = -1
  let lastVolumeAt = 0

  const listeners = new Set<(s: ProviderSnapshot) => void>()
  const snapshot = (): ProviderSnapshot => ({
    id: 'spotify',
    name: 'Spotify',
    accent: '#1DB954',
    status,
    configured: !!session?.clientId,
    accountName: session?.accountName,
    premium: session?.premium,
    error: errorMsg,
    playlists: userPlaylists,
    activePlaylistId,
    track,
    playing,
  })
  const emit = () => {
    const snap = snapshot()
    for (const fn of listeners) fn(snap)
  }

  const refreshAccessToken = async (): Promise<string | null> => {
    if (!session?.refreshToken || !session.clientId || !fetcher) return null
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: session.refreshToken,
      client_id: session.clientId,
    })
    const res = await fetcher('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    })
    if (!res.ok) return null
    const data = (await res.json()) as { access_token?: string; refresh_token?: string; expires_in?: number }
    if (!data.access_token) return null
    saveSession({
      ...session,
      accessToken: data.access_token,
      refreshToken: data.refresh_token ?? session.refreshToken,
      expiresAt: now() + (data.expires_in ?? 3600) * 1000,
    })
    return data.access_token
  }

  const validToken = async (): Promise<string | null> => {
    if (!session?.accessToken) return null
    if (session.expiresAt && now() > session.expiresAt - 60_000) {
      const refreshed = await refreshAccessToken()
      if (refreshed) return refreshed
    }
    return session.accessToken
  }

  const apiFetch = async (path: string, init: RequestInit = {}): Promise<Response> => {
    const token = await validToken()
    if (!token || !fetcher) throw new Error('Spotify is not connected.')
    const url = path.startsWith('https://') ? path : `https://api.spotify.com${path}`
    const headers = new Headers(init.headers)
    headers.set('Authorization', `Bearer ${token}`)
    let res = await fetcher(url, { ...init, headers })
    if (res.status === 401 && session?.refreshToken) {
      const refreshed = await refreshAccessToken()
      if (refreshed) {
        headers.set('Authorization', `Bearer ${refreshed}`)
        res = await fetcher(url, { ...init, headers })
      }
    }
    return res
  }

  const fetchProfile = async () => {
    try {
      const res = await apiFetch('/v1/me')
      if (!res.ok) return
      const me = (await res.json()) as { display_name?: string; product?: string }
      if (session) {
        saveSession({
          ...session,
          accountName: me.display_name || 'Spotify User',
          premium: me.product === 'premium',
        })
      }
    } catch { /* non-fatal */ }
  }

  const defaultCreatePlayer = async (cfg: { name: string; getOAuthToken: (cb: (token: string) => void) => void; volume: number }): Promise<SpotifyWebPlayer> => {
    const win = globalThis as unknown as {
      Spotify?: { Player: new (o: typeof cfg) => SpotifyWebPlayer }
      onSpotifyWebPlaybackSDKReady?: () => void
    }
    if (!win.Spotify?.Player) {
      const ready = new Promise<void>((resolve) => {
        const prev = win.onSpotifyWebPlaybackSDKReady
        win.onSpotifyWebPlaybackSDKReady = () => {
          prev?.()
          resolve()
        }
      })
      await loadExternalScript('https://sdk.scdn.co/spotify-player.js')
      await Promise.race([ready, new Promise<void>((r) => setTimeout(r, 10_000))])
    }
    if (!win.Spotify?.Player) throw new Error('Spotify Web Playback SDK did not initialize.')
    return new win.Spotify.Player(cfg)
  }

  const ensurePlayer = async (): Promise<SpotifyWebPlayer | null> => {
    if (player && deviceId) return player
    const token = await validToken()
    if (!token) return null
    const factory = opts.createPlayer ?? defaultCreatePlayer
    const p = await factory({
      name: 'Voxelwright Car Radio',
      getOAuthToken: (cb) => { void validToken().then((t) => { if (t) cb(t) }) },
      volume: desiredVolume,
    })
    player = p
    const readyPromise = new Promise<string | null>((resolve) => {
      const timer = setTimeout(() => resolve(deviceId), 8000)
      p.addListener('ready', (payload) => {
        const id = (payload as { device_id?: string } | null)?.device_id ?? null
        deviceId = id
        status = 'ready'
        errorMsg = undefined
        clearTimeout(timer)
        emit()
        resolve(id)
      })
      p.addListener('not_ready', () => {
        deviceId = null
        if (status === 'ready') status = 'connected'
        emit()
      })
      p.addListener('account_error', (payload) => {
        const msg = (payload as { message?: string } | null)?.message || 'Spotify Premium is required for in-browser playback.'
        errorMsg = scrubSecret(msg, [session?.accessToken, session?.refreshToken])
        status = 'error'
        if (session) saveSession({ ...session, premium: false })
        clearTimeout(timer)
        emit()
        resolve(null)
      })
      p.addListener('authentication_error', (payload) => {
        const msg = (payload as { message?: string } | null)?.message || 'Spotify session expired — reconnect to resume.'
        errorMsg = scrubSecret(msg, [session?.accessToken, session?.refreshToken])
        status = 'error'
        clearTimeout(timer)
        emit()
        resolve(null)
      })
      p.addListener('playback_error', (payload) => {
        const msg = (payload as { message?: string } | null)?.message || 'Spotify playback error.'
        errorMsg = scrubSecret(msg, [session?.accessToken, session?.refreshToken])
        emit()
      })
      p.addListener('player_state_changed', (payload) => {
        const st = payload as SpotifyPlaybackState | null
        if (!st) {
          playing = false
          emit()
          return
        }
        playing = !st.paused
        const ct = st.track_window?.current_track
        if (ct?.name) {
          track = {
            id: ct.id,
            title: ct.name,
            artist: ct.artists?.map((a) => a.name).filter(Boolean).join(', ') || 'Spotify',
            album: ct.album?.name,
            artwork: ct.album?.images?.[0]?.url,
            durationMs: ct.duration_ms,
          }
        }
        emit()
      })
    })
    const ok = await p.connect()
    if (!ok) {
      errorMsg = 'Could not connect to Spotify Web Playback SDK.'
      status = 'error'
      emit()
      return null
    }
    await readyPromise
    return player
  }

  const exchangeCode = async (clientId: string, code: string, verifier: string, redirectUri: string): Promise<boolean> => {
    if (!fetcher) return false
    const res = await fetcher('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        code_verifier: verifier,
      }),
    })
    if (!res.ok) {
      errorMsg = 'Spotify sign-in failed during token exchange. Check your Client ID and Redirect URI.'
      status = 'error'
      emit()
      return false
    }
    const data = (await res.json()) as { access_token?: string; refresh_token?: string; expires_in?: number }
    if (!data.access_token) {
      errorMsg = 'Spotify returned no access token.'
      status = 'error'
      emit()
      return false
    }
    saveSession({
      clientId,
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: now() + (data.expires_in ?? 3600) * 1000,
    })
    status = 'connected'
    errorMsg = undefined
    await fetchProfile()
    await loadUserPlaylists()
    emit()
    return true
  }

  const defaultAuthorize = async (authUrl: string, expectedState: string): Promise<{ code: string; state: string } | null> => {
    if (typeof window === 'undefined') return null
    const popup = window.open(authUrl, 'voxelwright-spotify-oauth', 'width=520,height=720,noopener=no')
    if (!popup) {
      // Popup blocked: fall back to full-page redirect; PKCE state is already persisted in sessionStorage.
      window.location.assign(authUrl)
      return null
    }
    return new Promise<{ code: string; state: string } | null>((resolve) => {
      let settled = false
      let channel: BroadcastChannel | null = null
      const finish = (val: { code: string; state: string } | null) => {
        if (settled) return
        settled = true
        clearInterval(poll)
        clearTimeout(timeout)
        window.removeEventListener('message', onMsg)
        try { channel?.close() } catch { /* ignore */ }
        resolve(val)
      }
      const accept = (data: unknown) => {
        if (!data || typeof data !== 'object') return
        const d = data as { type?: string; code?: string; state?: string; error?: string }
        if (d.type !== 'voxelwright-spotify-code') return
        if (d.error) { errorMsg = `Spotify authorization cancelled (${d.error}).`; finish(null); return }
        if (d.code && d.state === expectedState) finish({ code: d.code, state: d.state })
      }
      const onMsg = (e: MessageEvent) => { if (e.origin === window.location.origin) accept(e.data) }
      window.addEventListener('message', onMsg)
      if (typeof BroadcastChannel !== 'undefined') {
        try {
          channel = new BroadcastChannel(OAUTH_CHANNEL)
          channel.onmessage = (e) => accept(e.data)
        } catch { /* ignore */ }
      }
      const poll = setInterval(() => {
        if (popup.closed) finish(null)
      }, 400)
      const timeout = setTimeout(() => finish(null), 180_000)
    })
  }

  const loadUserPlaylists = async (): Promise<readonly PlaylistItem[]> => {
    const token = await validToken()
    if (!token) return []
    try {
      const res = await apiFetch('/v1/me/playlists?limit=50')
      if (!res.ok) return userPlaylists
      const body = (await res.json()) as {
        items?: readonly {
          id?: string
          name?: string
          uri?: string
          owner?: { display_name?: string }
          images?: readonly { url: string }[]
          items?: { total?: number }
          tracks?: { total?: number }
        }[]
      }
      const mapped: PlaylistItem[] = [
        {
          id: 'sp-liked-songs',
          provider: 'spotify',
          name: 'Liked Songs',
          subtitle: 'Your Spotify Library',
          uri: 'spotify:collection:tracks',
          accent: '#1DB954',
          curated: false,
        },
      ]
      for (const it of body.items ?? []) {
        if (!it?.id || !it.name) continue
        const total = it.items?.total ?? it.tracks?.total
        mapped.push({
          id: `sp-pl-${it.id}`,
          provider: 'spotify',
          name: it.name,
          subtitle: it.owner?.display_name ? `by ${it.owner.display_name}` : 'Your playlist',
          uri: it.uri || `spotify:playlist:${it.id}`,
          artwork: it.images?.[0]?.url,
          trackCount: typeof total === 'number' ? total : undefined,
          accent: '#1DB954',
          curated: false,
        })
      }
      userPlaylists = mapped
      emit()
      return userPlaylists
    } catch {
      return userPlaylists
    }
  }

  const completeRedirectIfPresent = async (): Promise<boolean> => {
    if (typeof location === 'undefined') return false
    const params = new URLSearchParams(location.search)
    const code = params.get('code')
    const state = params.get('state')
    const oauthErr = params.get('error')
    if (!state || (!code && !oauthErr)) return false

    // If this window was opened as an OAuth popup, hand the code back to the opener tab and close cleanly.
    if (typeof window !== 'undefined' && (window.opener || typeof BroadcastChannel !== 'undefined')) {
      const rawPkce = sess?.getItem(SPOTIFY_PKCE_KEY)
      if (!rawPkce) {
        const msg = { type: 'voxelwright-spotify-code', code, state, error: oauthErr }
        try { window.opener?.postMessage(msg, window.location.origin) } catch { /* ignore */ }
        try { const ch = new BroadcastChannel(OAUTH_CHANNEL); ch.postMessage(msg); ch.close() } catch { /* ignore */ }
        try { window.close() } catch { /* ignore */ }
        return false
      }
    }

    const rawPkce = sess?.getItem(SPOTIFY_PKCE_KEY)
    if (!rawPkce) return false
    sess?.removeItem(SPOTIFY_PKCE_KEY)
    // Scrub OAuth parameters from the browser address bar immediately.
    try {
      const clean = new URL(location.href)
      clean.searchParams.delete('code')
      clean.searchParams.delete('state')
      clean.searchParams.delete('error')
      history.replaceState(null, '', clean.toString())
    } catch { /* ignore */ }

    if (oauthErr || !code) {
      errorMsg = `Spotify authorization cancelled (${oauthErr || 'no code'}).`
      status = 'error'
      emit()
      return false
    }
    const pkce = JSON.parse(rawPkce) as { clientId: string; verifier: string; state: string; redirectUri: string }
    if (pkce.state !== state) {
      errorMsg = 'Spotify sign-in state mismatch — please try connecting again.'
      status = 'error'
      emit()
      return false
    }
    status = 'connecting'
    emit()
    return exchangeCode(pkce.clientId, code, pkce.verifier, pkce.redirectUri)
  }

  const connect = async (config?: Record<string, string>): Promise<boolean> => {
    const clientId = (config?.clientId ?? session?.clientId ?? opts.clientId ?? '').trim()
    if (!clientId) {
      errorMsg = 'Enter your Spotify App Client ID to connect via PKCE.'
      status = 'error'
      emit()
      return false
    }
    saveSession({ ...(session ?? { clientId }), clientId })

    // Already have a valid token? Just refresh profile, playlists, and SDK player.
    if (await validToken()) {
      status = 'connected'
      errorMsg = undefined
      await fetchProfile()
      await loadUserPlaylists()
      await ensurePlayer().catch(() => null)
      emit()
      return true
    }

    status = 'connecting'
    errorMsg = undefined
    emit()
    try {
      const { verifier, challenge, state } = await generatePkcePair()
      const { uri: redirectUri } = canonicalSpotifyRedirectUri()
      sess?.setItem(SPOTIFY_PKCE_KEY, JSON.stringify({ clientId, verifier, state, redirectUri }))
      const authUrl = buildSpotifyAuthorizeUrl({ clientId, redirectUri, codeChallenge: challenge, state })
      const authFn = opts.authorize ?? defaultAuthorize
      const result = await authFn(authUrl, state)
      if (!result) {
        if (status === 'connecting') status = 'disconnected'
        emit()
        return false
      }
      sess?.removeItem(SPOTIFY_PKCE_KEY)
      if (result.state !== state) {
        errorMsg = 'Spotify sign-in state mismatch.'
        status = 'error'
        emit()
        return false
      }
      const ok = await exchangeCode(clientId, result.code, verifier, redirectUri)
      if (ok) await ensurePlayer().catch(() => null)
      return ok
    } catch (e) {
      errorMsg = scrubSecret(e instanceof Error ? e.message : 'Spotify connection failed.', [session?.accessToken, session?.refreshToken])
      status = 'error'
      emit()
      return false
    }
  }

  const disconnect = async (): Promise<void> => {
    try { await player?.pause() } catch { /* ignore */ }
    try { player?.disconnect() } catch { /* ignore */ }
    player = null
    deviceId = null
    saveSession(null)
    sess?.removeItem(SPOTIFY_PKCE_KEY)
    userPlaylists = []
    activePlaylistId = null
    track = null
    playing = false
    status = 'disconnected'
    errorMsg = undefined
    emit()
  }

  const playPlaylist = async (playlist: PlaylistItem): Promise<boolean> => {
    const token = await validToken()
    if (!token) {
      errorMsg = 'Connect your Spotify Premium account to stream this playlist.'
      emit()
      return false
    }
    try {
      const p = await ensurePlayer()
      if (p?.activateElement) await p.activateElement().catch(() => {})
      if (!deviceId) {
        errorMsg = errorMsg || 'Spotify player is not ready yet (Spotify Premium is required).'
        emit()
        return false
      }
      let payload: Record<string, unknown>
      if (playlist.uri === 'spotify:collection:tracks') {
        const liked = await apiFetch('/v1/me/tracks?limit=50')
        if (!liked.ok) {
          errorMsg = 'Could not load your Liked Songs from Spotify.'
          emit()
          return false
        }
        const body = (await liked.json()) as { items?: readonly { track?: { uri?: string } }[] }
        const uris = (body.items ?? []).map((i) => i.track?.uri).filter((u): u is string => !!u)
        if (!uris.length) {
          errorMsg = 'Your Spotify Liked Songs library is empty.'
          emit()
          return false
        }
        payload = { uris }
      } else {
        payload = { context_uri: playlist.uri }
      }
      const res = await apiFetch(`/v1/me/player/play?device_id=${encodeURIComponent(deviceId)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        errorMsg = res.status === 403 || res.status === 404
          ? 'Spotify blocked this editorial playlist in Development Mode — pick one of your own playlists or switch to FM.'
          : `Spotify could not start playback (HTTP ${res.status}).`
        emit()
        return false
      }
      activePlaylistId = playlist.id
      playing = true
      errorMsg = undefined
      if (!track) track = { title: playlist.name, artist: playlist.subtitle || 'Spotify' }
      emit()
      return true
    } catch (e) {
      errorMsg = scrubSecret(e instanceof Error ? e.message : 'Spotify playback failed.', [session?.accessToken, session?.refreshToken])
      emit()
      return false
    }
  }

  const pause = async (): Promise<void> => {
    playing = false
    try { await player?.pause() } catch { /* ignore */ }
    emit()
  }

  const resume = async (): Promise<void> => {
    if (!player) return
    try {
      await player.activateElement?.().catch(() => {})
      await player.resume()
      playing = true
      emit()
    } catch { /* ignore */ }
  }

  const nextTrack = async (): Promise<boolean> => {
    if (!player) return false
    try { await player.nextTrack(); return true } catch { return false }
  }

  const prevTrack = async (): Promise<boolean> => {
    if (!player) return false
    try { await player.previousTrack(); return true } catch { return false }
  }

  const setVolume = (gain: number) => {
    desiredVolume = clamp01(gain)
    if (!player) return
    const t = now()
    // Throttle SDK volume calls during smooth ducking ramps while still snapping immediately to target endpoints.
    if (Math.abs(desiredVolume - lastSentVolume) < 0.015 && desiredVolume !== 0 && desiredVolume !== 1) return
    if (t - lastVolumeAt < 55 && Math.abs(desiredVolume - lastSentVolume) < 0.12) return
    lastSentVolume = desiredVolume
    lastVolumeAt = t
    void player.setVolume(desiredVolume).catch(() => {})
  }

  const onStorage = (e: StorageEvent) => {
    if (e.key !== SPOTIFY_STORAGE_KEY && e.key !== null) return
    session = loadSession()
    status = session?.accessToken ? (deviceId ? 'ready' : 'connected') : 'disconnected'
    emit()
  }
  if (typeof addEventListener !== 'undefined' && opts.storage === undefined) {
    addEventListener('storage', onStorage)
  }

  return {
    id: 'spotify',
    name: 'Spotify',
    accent: '#1DB954',
    get clientId() { return session?.clientId ?? '' },
    snapshot,
    subscribe(fn) { listeners.add(fn); return () => { listeners.delete(fn) } },
    completeRedirectIfPresent,
    connect,
    disconnect,
    loadUserPlaylists,
    playPlaylist,
    pause,
    resume,
    nextTrack,
    prevTrack,
    setVolume,
    dispose() {
      if (typeof removeEventListener !== 'undefined' && opts.storage === undefined) removeEventListener('storage', onStorage)
      try { player?.disconnect() } catch { /* ignore */ }
      listeners.clear()
    },
  }
}

// ── Apple MusicKit JS v3 Provider ────────────────────────────────────────

export interface MusicKitInstanceLike {
  isAuthorized?: boolean
  volume: number
  nowPlayingItem?: {
    id?: string
    title?: string
    artistName?: string
    albumName?: string
    playbackDuration?: number
    artworkURL?: string
    attributes?: {
      name?: string
      artistName?: string
      albumName?: string
      durationInMillis?: number
      artwork?: { url?: string }
    }
  } | null
  authorize(): Promise<string | void>
  unauthorize(): Promise<void>
  setQueue(options: { playlist?: string; songs?: readonly string[]; startPlaying?: boolean }): Promise<unknown>
  play(): Promise<void>
  pause(): Promise<void>
  stop?(): Promise<void>
  skipToNextItem(): Promise<void>
  skipToPreviousItem(): Promise<void>
  addEventListener(event: string, cb: (e: unknown) => void): void
  removeEventListener?(event: string, cb: (e: unknown) => void): void
  api: {
    music(path: string, query?: Record<string, unknown>): Promise<{ data?: { data?: readonly unknown[] } }>
  }
}

export interface MusicKitGlobalLike {
  configure(cfg: { developerToken: string; app: { name: string; build: string } }): Promise<MusicKitInstanceLike>
  getInstance(): MusicKitInstanceLike
  PlaybackStates?: { playing?: number; paused?: number; stopped?: number }
}

export interface AppleMusicProviderOptions {
  storage?: StorageLike | null
  /** Optional injected MusicKit v3 module for deterministic unit/browser tests. */
  loadMusicKit?: () => Promise<MusicKitGlobalLike>
  /** Initial developer JWT if provided via runtime config (never hardcoded in repo). */
  developerToken?: string
}

const formatAppleArtwork = (url: string | undefined, size = 160): string | undefined =>
  url ? url.replace('{w}', String(size)).replace('{h}', String(size)) : undefined

export function createAppleMusicProvider(opts: AppleMusicProviderOptions = {}): MusicProvider {
  const store = opts.storage === undefined ? safeLocalStorage() : opts.storage

  let developerToken = ''
  try {
    const raw = store?.getItem(APPLE_STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as { developerToken?: string }
      if (typeof parsed.developerToken === 'string') developerToken = parsed.developerToken
    }
  } catch { /* ignore */ }
  if (!developerToken && opts.developerToken) developerToken = opts.developerToken

  const saveToken = (token: string | null) => {
    developerToken = token ?? ''
    try {
      if (!token) store?.removeItem(APPLE_STORAGE_KEY)
      else store?.setItem(APPLE_STORAGE_KEY, JSON.stringify({ developerToken: token }))
    } catch { /* memory-only */ }
  }

  let music: MusicKitInstanceLike | null = null
  let status: ProviderStatus = 'disconnected'
  let errorMsg: string | undefined
  let userPlaylists: PlaylistItem[] = []
  let activePlaylistId: string | null = null
  let track: TrackInfo | null = null
  let playing = false
  let desiredVolume = 0.85

  const listeners = new Set<(s: ProviderSnapshot) => void>()
  const snapshot = (): ProviderSnapshot => ({
    id: 'apple',
    name: 'Apple Music',
    accent: '#FA243C',
    status,
    configured: !!developerToken,
    accountName: status === 'ready' || status === 'connected' ? 'Apple Music' : undefined,
    premium: status === 'ready' || status === 'connected' ? true : undefined,
    error: errorMsg,
    playlists: userPlaylists,
    activePlaylistId,
    track,
    playing,
  })
  const emit = () => {
    const snap = snapshot()
    for (const fn of listeners) fn(snap)
  }

  const syncNowPlaying = () => {
    const item = music?.nowPlayingItem
    if (!item) return
    const title = item.title ?? item.attributes?.name
    if (!title) return
    track = {
      id: item.id,
      title,
      artist: item.artistName ?? item.attributes?.artistName ?? 'Apple Music',
      album: item.albumName ?? item.attributes?.albumName,
      artwork: formatAppleArtwork(item.artworkURL ?? item.attributes?.artwork?.url),
      durationMs: item.playbackDuration ?? item.attributes?.durationInMillis,
    }
  }

  const defaultLoadMusicKit = async (): Promise<MusicKitGlobalLike> => {
    const win = globalThis as unknown as { MusicKit?: MusicKitGlobalLike }
    if (win.MusicKit) return win.MusicKit
    const loaded = new Promise<void>((resolve) => {
      document.addEventListener('musickitloaded', () => resolve(), { once: true })
    })
    await loadExternalScript('https://js-cdn.music.apple.com/musickit/v3/musickit.js')
    if (!win.MusicKit) await Promise.race([loaded, new Promise<void>((r) => setTimeout(r, 10_000))])
    if (!win.MusicKit) throw new Error('Apple MusicKit JS v3 did not initialize.')
    return win.MusicKit
  }

  const loadUserPlaylists = async (): Promise<readonly PlaylistItem[]> => {
    if (!music) return []
    try {
      const res = await music.api.music('/v1/me/library/playlists', { limit: 50 })
      const rows = (res?.data?.data ?? []) as readonly {
        id?: string
        attributes?: {
          name?: string
          description?: { standard?: string }
          artwork?: { url?: string }
        }
      }[]
      const mapped: PlaylistItem[] = []
      for (const row of rows) {
        if (!row?.id || !row.attributes?.name) continue
        mapped.push({
          id: `am-pl-${row.id}`,
          provider: 'apple',
          name: row.attributes.name,
          subtitle: row.attributes.description?.standard || 'Apple Music Library',
          uri: row.id,
          artwork: formatAppleArtwork(row.attributes.artwork?.url),
          accent: '#FA243C',
          curated: false,
        })
      }
      userPlaylists = mapped
      emit()
      return userPlaylists
    } catch {
      return userPlaylists
    }
  }

  const connect = async (config?: Record<string, string>): Promise<boolean> => {
    const tok = (config?.developerToken ?? developerToken).trim()
    if (!tok) {
      errorMsg = 'Enter an Apple Music Developer Token (JWT) to authorize MusicKit JS v3.'
      status = 'error'
      emit()
      return false
    }
    saveToken(tok)
    status = 'connecting'
    errorMsg = undefined
    emit()
    try {
      const mk = await (opts.loadMusicKit ?? defaultLoadMusicKit)()
      const instance = await mk.configure({
        developerToken: tok,
        app: { name: 'Voxelwright', build: '1.0.0' },
      })
      music = instance
      music.volume = desiredVolume
      music.addEventListener('playbackStateDidChange', (e) => {
        const st = (e as { state?: number | string } | null)?.state
        const playingCode = mk.PlaybackStates?.playing ?? 2
        playing = st === playingCode || st === 'playing'
        emit()
      })
      music.addEventListener('nowPlayingItemDidChange', () => {
        syncNowPlaying()
        emit()
      })
      music.addEventListener('authorizationStatusDidChange', () => {
        if (music?.isAuthorized === false) {
          status = 'disconnected'
          playing = false
          emit()
        }
      })
      await music.authorize()
      status = 'ready'
      errorMsg = undefined
      await loadUserPlaylists()
      emit()
      return true
    } catch (e) {
      errorMsg = scrubSecret(e instanceof Error ? e.message : 'Apple Music authorization failed.', [tok])
      status = 'error'
      emit()
      return false
    }
  }

  const disconnect = async (): Promise<void> => {
    try { await music?.pause() } catch { /* ignore */ }
    try { await music?.unauthorize() } catch { /* ignore */ }
    music = null
    saveToken(null)
    userPlaylists = []
    activePlaylistId = null
    track = null
    playing = false
    status = 'disconnected'
    errorMsg = undefined
    emit()
  }

  const playPlaylist = async (playlist: PlaylistItem): Promise<boolean> => {
    if (!music || (status !== 'ready' && status !== 'connected')) {
      errorMsg = 'Connect Apple Music to play full playlists in the car.'
      emit()
      return false
    }
    try {
      await music.setQueue({ playlist: playlist.uri })
      music.volume = desiredVolume
      await music.play()
      activePlaylistId = playlist.id
      playing = true
      errorMsg = undefined
      syncNowPlaying()
      if (!track) track = { title: playlist.name, artist: playlist.subtitle || 'Apple Music' }
      emit()
      return true
    } catch (e) {
      errorMsg = scrubSecret(e instanceof Error ? e.message : 'Apple Music could not play that playlist.', [developerToken])
      emit()
      return false
    }
  }

  const pause = async (): Promise<void> => {
    playing = false
    try { await music?.pause() } catch { /* ignore */ }
    emit()
  }

  const resume = async (): Promise<void> => {
    if (!music) return
    try {
      music.volume = desiredVolume
      await music.play()
      playing = true
      emit()
    } catch { /* ignore */ }
  }

  const nextTrack = async (): Promise<boolean> => {
    if (!music) return false
    try { await music.skipToNextItem(); syncNowPlaying(); emit(); return true } catch { return false }
  }

  const prevTrack = async (): Promise<boolean> => {
    if (!music) return false
    try { await music.skipToPreviousItem(); syncNowPlaying(); emit(); return true } catch { return false }
  }

  const setVolume = (gain: number) => {
    desiredVolume = clamp01(gain)
    if (!music) return
    try { music.volume = desiredVolume } catch { /* iOS hardware volume read-only */ }
  }

  return {
    id: 'apple',
    name: 'Apple Music',
    accent: '#FA243C',
    snapshot,
    subscribe(fn) { listeners.add(fn); return () => { listeners.delete(fn) } },
    connect,
    disconnect,
    loadUserPlaylists,
    playPlaylist,
    pause,
    resume,
    nextTrack,
    prevTrack,
    setVolume,
    dispose() {
      try { void music?.pause() } catch { /* ignore */ }
      listeners.clear()
    },
  }
}

// ── YouTube / YouTube Music IFrame Player API Provider ───────────────────

const YOUTUBE_SAVED_KEY = 'voxelwright.radio.youtube.saved'

export interface YouTubePlayerLike {
  loadVideoById(videoId: string): void
  loadPlaylist(opts: { list: string; listType: 'playlist'; index?: number }): void
  playVideo(): void
  pauseVideo(): void
  stopVideo?(): void
  nextVideo(): void
  previousVideo(): void
  setVolume(volume: number): void
  getVideoData?(): { video_id?: string; title?: string; author?: string } | null
  destroy?(): void
}

export interface YouTubeProvider extends MusicProvider {
  /** Sets the visible (>=200x200 px per YouTube ToS) host container where the IFrame player renders. */
  mountHost(el: HTMLElement | null): void
  /** Parses and saves a user's YouTube / YouTube Music playlist or video URL locally. */
  addSavedPlaylist(input: string, label?: string): PlaylistItem | null
  /** Removes a previously saved YouTube playlist by id. */
  removeSavedPlaylist(id: string): void
}

export interface YouTubeProviderOptions {
  storage?: StorageLike | null
  now?: () => number
  /** Optional injected YT.Player factory for deterministic unit/browser tests. */
  createPlayer?: (opts: {
    host: HTMLElement | null
    onReady: () => void
    onStateChange: (state: number) => void
    onError: (code: number) => void
  }) => Promise<YouTubePlayerLike>
}

export function createYouTubeProvider(opts: YouTubeProviderOptions = {}): YouTubeProvider {
  const store = opts.storage === undefined ? safeLocalStorage() : opts.storage
  const now = opts.now ?? (() => Date.now())

  const loadSaved = (): PlaylistItem[] => {
    try {
      const raw = store?.getItem(YOUTUBE_SAVED_KEY)
      if (!raw) return []
      const arr = JSON.parse(raw) as unknown
      if (!Array.isArray(arr)) return []
      const out: PlaylistItem[] = []
      for (const item of arr) {
        if (!item || typeof item !== 'object') continue
        const r = item as Partial<PlaylistItem>
        if (typeof r.id !== 'string' || typeof r.name !== 'string' || typeof r.uri !== 'string') continue
        if (!parseYouTubeSource(r.uri)) continue
        out.push({
          id: r.id,
          provider: 'youtube',
          name: r.name.slice(0, 80),
          subtitle: typeof r.subtitle === 'string' ? r.subtitle.slice(0, 100) : 'YouTube Music',
          uri: r.uri,
          artwork: typeof r.artwork === 'string' ? r.artwork : undefined,
          accent: typeof r.accent === 'string' ? r.accent : '#FF0033',
          curated: false,
        })
      }
      return out
    } catch {
      return []
    }
  }
  const saveSaved = (list: PlaylistItem[]) => {
    try { store?.setItem(YOUTUBE_SAVED_KEY, JSON.stringify(list)) } catch { /* memory-only */ }
  }

  let savedPlaylists: PlaylistItem[] = loadSaved()
  let hostEl: HTMLElement | null = null
  let player: YouTubePlayerLike | null = null
  let playerReady = false
  let activePlaylistId: string | null = null
  let pendingPlayer: Promise<YouTubePlayerLike> | undefined
  let playbackRequest = 0
  let activeKind: 'playlist' | 'video' = 'video'
  let track: TrackInfo | null = null
  let playing = false
  let errorMsg: string | undefined
  let desiredVolume = 0.85
  let lastSentVol = -1
  let lastVolAt = 0
  let consecutiveErrors = 0

  const listeners = new Set<(s: ProviderSnapshot) => void>()
  const snapshot = (): ProviderSnapshot => ({
    id: 'youtube',
    name: 'YouTube Music',
    accent: '#FF0033',
    status: 'ready',
    configured: true,
    accountName: 'No login needed',
    premium: true,
    error: errorMsg,
    playlists: savedPlaylists,
    activePlaylistId,
    track,
    playing,
  })
  const emit = () => {
    const snap = snapshot()
    for (const fn of listeners) fn(snap)
  }

  const syncTrackFromPlayer = () => {
    const data = player?.getVideoData?.()
    if (!data?.title) return
    const vid = data.video_id
    const allowThumb = !(typeof crossOriginIsolated === 'boolean' && crossOriginIsolated)
    track = {
      id: vid,
      title: data.title,
      artist: data.author || 'YouTube Music',
      artwork: allowThumb && vid ? `https://i.ytimg.com/vi/${vid}/hqdefault.jpg` : track?.artwork,
    }
  }

  const defaultCreatePlayer = async (cfg: {
    host: HTMLElement | null
    onReady: () => void
    onStateChange: (state: number) => void
    onError: (code: number) => void
  }): Promise<YouTubePlayerLike> => {
    if (!cfg.host) throw new Error('YouTube player container is not mounted yet.')
    const win = globalThis as unknown as {
      YT?: {
        Player: new (
          el: HTMLElement,
          opts: {
            width: number
            height: number
            playerVars?: Record<string, string | number>
            events?: {
              onReady?: () => void
              onStateChange?: (e: { data: number }) => void
              onError?: (e: { data: number }) => void
            }
          },
        ) => YouTubePlayerLike
      }
      onYouTubeIframeAPIReady?: () => void
    }
    if (!win.YT?.Player) {
      const ready = new Promise<void>((resolve) => {
        const prev = win.onYouTubeIframeAPIReady
        win.onYouTubeIframeAPIReady = () => { prev?.(); resolve() }
      })
      await loadExternalScript('https://www.youtube.com/iframe_api')
      if (!win.YT?.Player) await Promise.race([ready, new Promise<void>((r) => setTimeout(r, 10_000))])
    }
    if (!win.YT?.Player) throw new Error('YouTube IFrame Player API did not initialize (check connection or host CSP).')
    cfg.host.replaceChildren()
    const target = document.createElement('div')
    cfg.host.append(target)
    return new win.YT.Player(target, {
      width: 216,
      height: 200,
      playerVars: {
        autoplay: 1,
        controls: 1,
        playsinline: 1,
        rel: 0,
        modestbranding: 1,
        origin: typeof location !== 'undefined' ? location.origin : '',
      },
      events: {
        onReady: () => cfg.onReady(),
        onStateChange: (e) => cfg.onStateChange(e.data),
        onError: (e) => cfg.onError(e.data),
      },
    })
  }

  const ensurePlayer = async (): Promise<YouTubePlayerLike> => {
    if (player && playerReady) return player
    const factory = opts.createPlayer ?? defaultCreatePlayer
    let resolveReady: (() => void) | null = null
    const readyPromise = new Promise<void>((resolve) => { resolveReady = resolve })
    const p = await factory({
      host: hostEl,
      onReady: () => {
        playerReady = true
        player?.setVolume(Math.round(desiredVolume * 100))
        resolveReady?.()
      },
      onStateChange: (state) => {
        if (state === 1) {
          playing = true
          consecutiveErrors = 0
          errorMsg = undefined
          syncTrackFromPlayer()
          emit()
        } else if (state === 2 || state === 0) {
          playing = false
          emit()
        }
      },
      onError: (code) => {
        if (code === 100 || code === 101 || code === 150) {
          errorMsg = 'This YouTube track disables embedding — pick another playlist or try FM.'
          if (activeKind === 'playlist' && consecutiveErrors < 2) {
            consecutiveErrors++
            try { player?.nextVideo() } catch { /* ignore */ }
          } else {
            playing = false
          }
        } else {
          errorMsg = `YouTube playback error (code ${code}).`
          playing = false
        }
        emit()
      },
    })
    player = p
    if (playerReady) p.setVolume(Math.round(desiredVolume * 100))
    await Promise.race([readyPromise, new Promise<void>((r) => setTimeout(r, 8000))])
    return p
  }

  const playPlaylist = async (playlist: PlaylistItem): Promise<boolean> => {
    const parsed = parseYouTubeSource(playlist.uri)
    if (!parsed) {
      errorMsg = 'Invalid YouTube / YouTube Music playlist or video link.'
      emit()
      return false
    }
    try {
      const request = ++playbackRequest
      pendingPlayer ??= ensurePlayer().finally(() => { pendingPlayer = undefined })
      const p = await pendingPlayer
      if (request !== playbackRequest) return false
      activePlaylistId = playlist.id
      activeKind = parsed.kind
      consecutiveErrors = 0
      errorMsg = undefined
      const allowThumb = !(typeof crossOriginIsolated === 'boolean' && crossOriginIsolated)
      track = {
        id: parsed.kind === 'video' ? parsed.id : undefined,
        title: playlist.name,
        artist: playlist.subtitle || 'YouTube Music',
        artwork: allowThumb ? (playlist.artwork ?? parsed.artwork) : undefined,
      }
      p.setVolume(Math.round(desiredVolume * 100))
      if (parsed.kind === 'playlist') {
        p.loadPlaylist({ list: parsed.id, listType: 'playlist', index: 0 })
      } else {
        p.loadVideoById(parsed.id)
      }
      playing = true
      emit()
      return true
    } catch (e) {
      errorMsg = e instanceof Error ? e.message : 'Could not start YouTube Music playback.'
      playing = false
      emit()
      return false
    }
  }

  const pause = async (): Promise<void> => {
    ++playbackRequest
    playing = false
    try { player?.pauseVideo() } catch { /* ignore */ }
    emit()
  }

  const resume = async (): Promise<void> => {
    if (!player) return
    try {
      player.setVolume(Math.round(desiredVolume * 100))
      player.playVideo()
      playing = true
      emit()
    } catch { /* ignore */ }
  }

  const nextTrack = async (): Promise<boolean> => {
    if (!player) return false
    try {
      player.nextVideo()
      syncTrackFromPlayer()
      emit()
      return true
    } catch {
      return false
    }
  }

  const prevTrack = async (): Promise<boolean> => {
    if (!player) return false
    try {
      player.previousVideo()
      syncTrackFromPlayer()
      emit()
      return true
    } catch {
      return false
    }
  }

  const setVolume = (gain: number) => {
    desiredVolume = clamp01(gain)
    if (!player || !playerReady) return
    const pct = Math.round(desiredVolume * 100)
    const t = now()
    if (pct === lastSentVol) return
    if (t - lastVolAt < 45 && Math.abs(pct - lastSentVol) < 10 && pct !== 0 && pct !== 100) return
    lastSentVol = pct
    lastVolAt = t
    try { player.setVolume(pct) } catch { /* ignore */ }
  }

  const addSavedPlaylist = (input: string, label?: string): PlaylistItem | null => {
    const parsed = parseYouTubeSource(input)
    if (!parsed) return null
    const id = `yt-saved-${parsed.kind}-${parsed.id}`
    const existing = savedPlaylists.find((p) => p.id === id)
    if (existing) return existing
    const cleanName = (label ?? '').trim() || (parsed.kind === 'playlist' ? `YouTube Playlist (${parsed.id.slice(0, 8)}…)` : `YouTube Track (${parsed.id})`)
    const item: PlaylistItem = {
      id,
      provider: 'youtube',
      name: cleanName.slice(0, 80),
      subtitle: parsed.kind === 'playlist' ? 'Saved YouTube Music Playlist' : 'Saved YouTube Stream',
      uri: parsed.uri,
      artwork: parsed.artwork,
      accent: '#FF0033',
      curated: false,
    }
    savedPlaylists = [item, ...savedPlaylists].slice(0, 32)
    saveSaved(savedPlaylists)
    emit()
    return item
  }

  const removeSavedPlaylist = (id: string) => {
    const next = savedPlaylists.filter((p) => p.id !== id)
    if (next.length === savedPlaylists.length) return
    savedPlaylists = next
    saveSaved(savedPlaylists)
    emit()
  }

  return {
    id: 'youtube',
    name: 'YouTube Music',
    accent: '#FF0033',
    mountHost(el) { hostEl = el },
    addSavedPlaylist,
    removeSavedPlaylist,
    snapshot,
    subscribe(fn) { listeners.add(fn); return () => { listeners.delete(fn) } },
    async connect() { return true },
    async disconnect() { await pause() },
    async loadUserPlaylists() { return savedPlaylists },
    playPlaylist,
    pause,
    resume,
    nextTrack,
    prevTrack,
    setVolume,
    dispose() {
      ++playbackRequest
      try { player?.destroy?.() } catch { /* ignore */ }
      player = null
      playerReady = false
      listeners.clear()
    },
  }
}
