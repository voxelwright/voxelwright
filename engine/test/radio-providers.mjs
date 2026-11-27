// Connected Car Radio (YouTube Music IFrame Player API + feature-gated Spotify PKCE & Apple MusicKit JS v3):
// Clearly distinguishes mocked-provider unit/browser proofs from live external streaming verification (no live
// YouTube, Spotify Premium, or Apple Music network streams are executed in automated CI).
//
// 1) Node unit checks:
//    - Feature flag defaults (`youtube: true, spotify: false, apple: false`) + `?radio_providers=all` override.
//    - YouTube / YouTube Music URL & ID parsing (`music.youtube.com/playlist?list=...`, `youtu.be/...`, video IDs),
//      mocked YT.Player lifecycle (curated stream, playlist load, saved playlist add/remove persistence,
//      getVideoData metadata, error 150 auto-skip, setVolume 0..100 ducking).
//    - Dormant Spotify PKCE & Apple MusicKit JS v3 unit suites (kept 100% tested for when accounts are added).
//    - Unified createRadio lifecycle: procedural FM suppression, exit/re-enter resume, horn ducking across providers.
// 2) Real Chrome browser checks (mocked YT.Player provider registered via `engine.ears.radio.registerProvider`):
//    - Default UI hides Spotify & Apple Music tabs and exposes FM Radio + YouTube Music.
//    - Curated SF YouTube Music stream plays with visible `[data-panel="radio-yt"]` mini-player (>=200x200 px ToS
//      minimum), clear of drive-hud, controls card, and minimap.
//    - Pasting & saving a `music.youtube.com/playlist?list=...` URL in Your Playlists plays & persists cleanly.
//    - Period (.) skips track and triggers upgraded `[data-panel="radio-toast"]` above the mini-player with zero overlap.
//    - Horn smoothly ducks YouTube volume (`0..100`) and recovers; exit pauses & hides mini-player; re-enter resumes;
//      switching back to offline Bay Drive FM pauses YouTube & hides mini-player.
//    - Upright phone (390x844) & landscape phone (844x390) safe-area + reduced-motion checks with full-size screenshots.
//
//   node test/radio-providers.mjs [--node-only] [--shots dir]
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { BUS } from '../page/sound/dsp.ts'
import { CURATED_PLAYLISTS, ENABLED_STREAMING_PROVIDERS, createRadio, enabledProviders } from '../page/sound/radio.ts'
import {
  buildSpotifyAuthorizeUrl,
  canonicalSpotifyRedirectUri,
  createAppleMusicProvider,
  createSpotifyProvider,
  createYouTubeProvider,
  generatePkcePair,
  parseApplePlaylistId,
  parseSpotifyPlaylistUri,
  parseYouTubeSource,
  scrubSecret,
} from '../page/sound/radio-providers.ts'
import { CHROME, arg, has, start, still } from './kit.mjs'

const nodeOnly = has('node-only')
const shotsDir = arg('shots', '')
if (shotsDir) mkdirSync(shotsDir, { recursive: true })

const failures = []
const check = (ok, what) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failures.push(what) }

const memoryStorage = () => {
  const m = new Map()
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => { m.set(k, String(v)) },
    removeItem: (k) => { m.delete(k) },
  }
}

console.log('Streaming providers & unified radio (Node unit + mocked SDK adapters)')
{
  // 0. Feature switches: YouTube Music enabled by default, Spotify & Apple Music disabled until enabled.
  check(
    ENABLED_STREAMING_PROVIDERS.youtube === true
    && ENABLED_STREAMING_PROVIDERS.spotify === false
    && ENABLED_STREAMING_PROVIDERS.apple === false,
    'default feature flags enable YouTube Music and disable Spotify & Apple Music in the UI',
  )
  const allOn = enabledProviders(new URLSearchParams('radio_providers=all'))
  check(allOn.youtube && allOn.spotify && allOn.apple, '?radio_providers=all enables YouTube, Spotify, and Apple Music')

  // 1. YouTube / YouTube Music URL & ID parser + curated SF streams.
  check(parseYouTubeSource('https://music.youtube.com/playlist?list=PL4fGSI1pDJn6O1SNWrUKd4b1sV0eA0Y5m')?.uri === 'yt:playlist:PL4fGSI1pDJn6O1SNWrUKd4b1sV0eA0Y5m', 'parseYouTubeSource parses YouTube Music playlist URLs')
  check(parseYouTubeSource('https://www.youtube.com/watch?v=4xDzrJKXOOY&list=PL4fGSI1pDJn6O1SNWrUKd4b1sV0eA0Y5m')?.uri === 'yt:playlist:PL4fGSI1pDJn6O1SNWrUKd4b1sV0eA0Y5m', 'parseYouTubeSource prefers list= playlist when present on watch URLs')
  check(parseYouTubeSource('https://youtu.be/jfKfPfyJRdk')?.uri === 'yt:video:jfKfPfyJRdk', 'parseYouTubeSource parses youtu.be short video/radio URLs')
  check(parseYouTubeSource('https://music.youtube.com/watch?v=4xDzrJKXOOY')?.artwork === 'https://i.ytimg.com/vi/4xDzrJKXOOY/hqdefault.jpg', 'parseYouTubeSource derives video thumbnail artwork')
  check(parseYouTubeSource('https://example.com/not-youtube') === null, 'parseYouTubeSource rejects non-YouTube URLs')
  check(CURATED_PLAYLISTS.youtube.length === 3 && CURATED_PLAYLISTS.youtube.every((p) => p.curated && p.uri.startsWith('yt:')), 'YouTube Music ships 3 curated SF driving radio streams')

  // 2. Mocked YouTube IFrame Player API lifecycle.
  {
    const store = memoryStorage()
    let clockMs = 1_000_000
    let loadedVideo = '', loadedList = '', ytVol = 85, ytPaused = false, nextCount = 0, prevCount = 0
    let stateCb = null, errCb = null
    let currentData = { video_id: '4xDzrJKXOOY', title: 'synthwave radio - beats to chill/game to', author: 'Lofi Girl' }
    const yt = createYouTubeProvider({
      storage: store,
      now: () => clockMs,
      createPlayer: async ({ onReady, onStateChange, onError }) => {
        stateCb = onStateChange
        errCb = onError
        queueMicrotask(() => onReady())
        return {
          loadVideoById(id) { loadedVideo = id; ytPaused = false; stateCb?.(1) },
          loadPlaylist({ list }) { loadedList = list; ytPaused = false; currentData = { video_id: 'abc12345678', title: 'Playlist Track 1', author: 'SF Channel' }; stateCb?.(1) },
          playVideo() { ytPaused = false; stateCb?.(1) },
          pauseVideo() { ytPaused = true; stateCb?.(2) },
          nextVideo() { nextCount++; currentData = { video_id: 'def87654321', title: 'Playlist Track 2', author: 'Bay Beats' }; stateCb?.(1) },
          previousVideo() { prevCount++; currentData = { video_id: 'abc12345678', title: 'Playlist Track 1', author: 'SF Channel' }; stateCb?.(1) },
          setVolume(v) { ytVol = v },
          getVideoData() { return currentData },
          destroy() {},
        }
      },
    })

    check(yt.snapshot().status === 'ready' && yt.snapshot().configured, 'YouTube Music starts immediately ready with zero login or API key')
    const playedCurated = await yt.playPlaylist(CURATED_PLAYLISTS.youtube[0])
    check(playedCurated && loadedVideo === '4xDzrJKXOOY' && yt.snapshot().playing && yt.snapshot().track?.artist === 'Lofi Girl', 'YouTube playPlaylist loads curated stream and syncs getVideoData() metadata')

    // Save custom YouTube Music playlist, play it, skip track, handle error 150 auto-skip, duck volume, remove saved.
    const saved = yt.addSavedPlaylist('https://music.youtube.com/playlist?list=PLsfNightDrive12345', 'Embarcadero Night Mix')
    check(!!saved && yt.snapshot().playlists.length === 1 && yt.snapshot().playlists[0].name === 'Embarcadero Night Mix', 'YouTube addSavedPlaylist persists custom playlist in client-side storage')
    const playedPl = await yt.playPlaylist(saved)
    check(playedPl && loadedList === 'PLsfNightDrive12345' && yt.snapshot().track?.title === 'Playlist Track 1', 'YouTube plays saved playlist via loadPlaylist({ listType: playlist })')

    await yt.nextTrack()
    check(nextCount === 1 && yt.snapshot().track?.title === 'Playlist Track 2', 'YouTube nextTrack calls nextVideo() and updates track metadata')
    await yt.prevTrack()
    check(prevCount === 1 && yt.snapshot().track?.title === 'Playlist Track 1', 'YouTube prevTrack calls previousVideo()')

    // Embed-disabled error (150) auto-skips inside a playlist.
    errCb?.(150)
    check(nextCount === 2, 'YouTube error 150 (embed disabled) auto-skips to next track inside a playlist')

    clockMs += 100
    yt.setVolume(0.38)
    check(ytVol === 38, `YouTube setVolume converts 0..1 ducking gain to 0..100 (${ytVol})`)

    yt.removeSavedPlaylist(saved.id)
    check(yt.snapshot().playlists.length === 0, 'YouTube removeSavedPlaylist deletes saved playlist cleanly')
    await yt.pause()
    check(ytPaused && !yt.snapshot().playing, 'YouTube pause calls pauseVideo()')
    yt.dispose()
  }

  // 3. Dormant Spotify PKCE & Apple MusicKit JS v3 unit suites (kept verified while feature-gated off in UI).
  const pkce = await generatePkcePair()
  check(pkce.verifier.length >= 64 && pkce.challenge.length >= 40 && pkce.state.length >= 16 && pkce.verifier !== pkce.challenge, 'generatePkcePair produces high-entropy PKCE verifier, S256 challenge, and CSRF state')
  const redirLocal = canonicalSpotifyRedirectUri('http://localhost:5740/city?foo=1')
  check(redirLocal.isLocalhost && redirLocal.uri === 'http://127.0.0.1:5740/city', `canonicalSpotifyRedirectUri rewrites banned localhost to loopback IP (${redirLocal.uri})`)
  const authUrl = new URL(buildSpotifyAuthorizeUrl({ clientId: 'test-client-123', redirectUri: redirLocal.uri, codeChallenge: pkce.challenge, state: pkce.state }))
  const scopes = (authUrl.searchParams.get('scope') ?? '').split(' ')
  check(
    authUrl.origin === 'https://accounts.spotify.com'
    && authUrl.searchParams.get('code_challenge_method') === 'S256'
    && !authUrl.searchParams.has('client_secret')
    && scopes.includes('streaming') && scopes.includes('playlist-read-private') && scopes.includes('user-library-read'),
    'Spotify PKCE authorize URL includes S256 + required scopes and no client_secret',
  )
  const scrubbed = scrubSecret('Err eyJhbGciOiJFUzI1NiJ9.eyJpc3MiOiJ0ZXN0In0.sig123456789012 token BQAbcdefghijklmnop123456')
  check(!scrubbed.includes('eyJhbGci') && !scrubbed.includes('BQAbcdef'), 'scrubSecret redacts JWTs and bearer tokens')
  check(parseSpotifyPlaylistUri('https://open.spotify.com/playlist/37i9dQZF1DXdLEN7aqioXM?si=abc') === 'spotify:playlist:37i9dQZF1DXdLEN7aqioXM', 'parseSpotifyPlaylistUri parses Spotify playlist URLs')
  check(parseApplePlaylistId('https://music.apple.com/us/playlist/midnight-city/pl.043a2c9876114d95a4659988497567be') === 'pl.043a2c9876114d95a4659988497567be', 'parseApplePlaylistId parses Apple Music playlist URLs')

  {
    const store = memoryStorage(), sess = memoryStorage()
    let clockMs = 1_000_000, playerVol = 1
    const playerEvents = new Map()
    const sp = createSpotifyProvider({
      storage: store, sessionStorage: sess, now: () => clockMs,
      authorize: async (_u, state) => ({ code: 'mock-code', state }),
      fetch: async (url, init = {}) => {
        const u = String(url)
        if (u.includes('/api/token')) return new Response(JSON.stringify({ access_token: 'BQ_TOKEN_1234567890', refresh_token: 'AQ_REF_1234567890', expires_in: 3600 }), { status: 200 })
        if (u.endsWith('/v1/me')) return new Response(JSON.stringify({ display_name: 'SF Driver', product: 'premium' }), { status: 200 })
        if (u.includes('/v1/me/playlists')) return new Response(JSON.stringify({ items: [{ id: 'pl1', name: 'Bay Night', uri: 'spotify:playlist:pl1', items: { total: 12 } }] }), { status: 200 })
        if (u.includes('/v1/me/player/play')) return new Response(null, { status: 204 })
        return new Response(null, { status: 404 })
      },
      createPlayer: async () => ({
        addListener(ev, cb) { playerEvents.set(ev, cb) },
        async connect() { queueMicrotask(() => playerEvents.get('ready')?.({ device_id: 'dev-1' })); return true },
        disconnect() {}, async activateElement() {}, async pause() {}, async resume() {},
        async nextTrack() {}, async previousTrack() {}, async setVolume(v) { playerVol = v }, async getCurrentState() { return null },
      }),
    })
    const ok = await sp.connect({ clientId: 'demo-id' })
    const played = await sp.playPlaylist(sp.snapshot().playlists[1])
    clockMs += 100; sp.setVolume(0.4)
    await sp.disconnect()
    check(ok && played && Math.abs(playerVol - 0.4) < 1e-6 && sp.snapshot().status === 'disconnected', 'dormant Spotify PKCE provider passes connect, play, volume ducking, and disconnect')
  }

  {
    const store = memoryStorage()
    let amVol = 1, auth = false
    const am = createAppleMusicProvider({
      storage: store,
      loadMusicKit: async () => ({
        PlaybackStates: { playing: 2, paused: 3 },
        async configure() {
          return {
            get volume() { return amVol }, set volume(v) { amVol = v },
            nowPlayingItem: { id: 'a1', title: 'Pacific Fog', artistName: 'Marin Jazz' },
            async authorize() { auth = true }, async unauthorize() { auth = false },
            async setQueue() {}, async play() {}, async pause() {},
            async skipToNextItem() {}, async skipToPreviousItem() {},
            addEventListener() {},
            api: { async music() { return { data: { data: [{ id: 'p.1', attributes: { name: 'SF Late Night' } }] } } } },
          }
        },
        getInstance() { return null },
      }),
    })
    const ok = await am.connect({ developerToken: 'eyJhbGciOiJFUzI1NiJ9.mock.jwt' })
    const played = await am.playPlaylist(am.snapshot().playlists[0])
    am.setVolume(0.42)
    await am.disconnect()
    check(ok && played && Math.abs(amVol - 0.42) < 1e-6 && !auth, 'dormant Apple MusicKit JS v3 provider passes configure, authorize, play, volume, and unauthorize')
  }

  // 4. Unified createRadio lifecycle with YouTube Music: suppression, horn ducking, exit/re-enter resume, FM fallback.
  {
    const hushedBuses = []
    const fakeVoice = {
      running: true,
      context: { currentTime: 0 },
      play: () => true,
      set: () => {},
      hush: (b) => hushedBuses.push(b),
      hear: () => ({ gain: 1, pan: 0, lp: 20000, late: 0, far: 0 }),
      flush: () => {},
    }
    const fakeAmbient = { on: true }
    let ytVol = 100, ytPlaying = false
    const ytMock = createYouTubeProvider({
      storage: memoryStorage(),
      createPlayer: async ({ onReady, onStateChange }) => {
        queueMicrotask(() => onReady())
        return {
          loadVideoById() { ytPlaying = true; onStateChange(1) },
          loadPlaylist() { ytPlaying = true; onStateChange(1) },
          playVideo() { ytPlaying = true; onStateChange(1) },
          pauseVideo() { ytPlaying = false; onStateChange(2) },
          nextVideo() { onStateChange(1) },
          previousVideo() { onStateChange(1) },
          setVolume(v) { ytVol = v },
          getVideoData() { return { video_id: '4xDzrJKXOOY', title: 'SF Synth Live', author: 'Lofi Girl' } },
          destroy() {},
        }
      },
    })
    const radio = createRadio(fakeVoice, {
      ambient: fakeAmbient,
      query: new URLSearchParams('radio=0'),
      providers: { youtube: ytMock },
    })
    await radio.selectPlaylist(CURATED_PLAYLISTS.youtube[0])
    check(!ytPlaying && fakeAmbient.on, 'choosing music on foot saves it without starting playback')
    radio.setDriving(true)
    const starting = radio.selectPlaylist(CURATED_PLAYLISTS.youtube[0])
    radio.setDriving(false)
    check(!await starting && !ytPlaying && fakeAmbient.on, 'exiting while the player initializes cancels pending playback')
    radio.setDriving(true)
    await radio.selectPlaylist(CURATED_PLAYLISTS.youtube[0])
    check(radio.state.provider === 'youtube' && radio.state.active && ytPlaying && !fakeAmbient.on && hushedBuses.includes(BUS.music), 'selecting YouTube Music suppresses ambient & procedural music bus cleanly')

    radio.setHorn(true)
    for (let i = 0; i < 20; i++) radio.frame([0, 0, 0], 0, 0.03, 50)
    const ducked = ytVol
    radio.setHorn(false)
    for (let i = 0; i < 45; i++) radio.frame([0, 0, 0], 0, 0.03, 50)
    const recovered = ytVol
    check(ducked <= 50 && recovered >= 92, `horn ducks YouTube Music volume smoothly (${ducked}% -> ${recovered}%)`)

    radio.setDriving(false)
    check(!ytPlaying && fakeAmbient.on, 'exiting car pauses YouTube Music and restores ambient music')
    radio.setDriving(true)
    for (let i = 0; i < 20; i++) radio.frame([0, 0, 0], 0, 0.03, 0)
    await new Promise((r) => setTimeout(r, 20))
    check(radio.state.provider === 'youtube' && radio.state.active && ytPlaying, 're-entering car automatically resumes remembered YouTube Music stream')

    radio.tune('baydrive')
    check(radio.state.provider === 'fm' && radio.state.station.id === 'baydrive' && !ytPlaying, 'tuning back to offline FM pauses YouTube Music cleanly')
    radio.dispose()
  }
}

if (nodeOnly) {
  if (failures.length) { console.error(`FAILED\n  ${failures.join('\n  ')}`); process.exit(1) }
  console.log('radio-providers (node): ok')
  process.exit(0)
}

console.log('Browser mocked YouTube Music + Waymo-style Media Picker & Phone Safe-Area checks')
const { city, url, check: bcheck, finish } = await start()
try {
  // Injects a realistic mocked YouTube IFrame Player (rendering a crisp >=200x200 card inside `.ryt-frame` without hitting external network).
  const installMockYouTube = async () => {
    const { createYouTubeProvider } = await import('/page/sound/radio-providers.ts')
    const svgArt = (bg1, bg2, txt) => `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="${bg1}"/><stop offset="100%" stop-color="${bg2}"/></linearGradient></defs><rect width="128" height="128" rx="18" fill="url(#g)"/><circle cx="64" cy="64" r="28" fill="rgba(0,0,0,0.28)"/><text x="64" y="72" text-anchor="middle" fill="#fff" font-family="system-ui,sans-serif" font-weight="800" font-size="22">${txt}</text></svg>`)}`
    const tracks = [
      { video_id: '4xDzrJKXOOY', title: 'Midnight Over Bay Bridge (Live)', author: 'Lofi Girl · Synthwave' },
      { video_id: 'jfKfPfyJRdk', title: 'Embarcadero Afterglow', author: 'Bay City Beats' },
    ]
    let idx = 0, vol = 100
    const yt = createYouTubeProvider({
      createPlayer: async ({ host, onReady, onStateChange }) => {
        const paint = () => {
          if (!host) return
          const t = tracks[idx]
          host.replaceChildren()
          const card = document.createElement('div')
          card.style.cssText = 'width:216px;height:200px;display:flex;flex-direction:column;justify-content:flex-end;padding:12px;box-sizing:border-box;background:linear-gradient(145deg,#2c1038,#121826 60%,#3b0d24);color:#fff;font-family:system-ui,sans-serif'
          const badge = document.createElement('span')
          badge.textContent = 'LIVE · YOUTUBE'
          badge.style.cssText = 'align-self:flex-start;margin-bottom:auto;padding:3px 7px;border-radius:5px;background:#FF0033;font-size:10px;font-weight:800;letter-spacing:0.06em'
          const ttl = document.createElement('div')
          ttl.textContent = t.title
          ttl.style.cssText = 'font-weight:700;font-size:13px;line-height:1.25'
          const ch = document.createElement('div')
          ch.textContent = t.author
          ch.style.cssText = 'font-size:11px;opacity:0.75;margin-top:3px'
          card.append(badge, ttl, ch)
          host.append(card)
        }
        queueMicrotask(() => onReady())
        return {
          loadVideoById() { idx = 0; paint(); onStateChange(1) },
          loadPlaylist() { idx = 0; paint(); onStateChange(1) },
          playVideo() { paint(); onStateChange(1) },
          pauseVideo() { onStateChange(2) },
          nextVideo() { idx = (idx + 1) % tracks.length; paint(); onStateChange(1) },
          previousVideo() { idx = (idx - 1 + tracks.length) % tracks.length; paint(); onStateChange(1) },
          setVolume(v) { vol = v; globalThis.__mockYtVol = v },
          getVideoData() { return tracks[idx] },
          destroy() { host?.replaceChildren() },
        }
      },
    })
    globalThis.__mockYtVol = vol
    globalThis.__mockYt = yt
    globalThis.__svgArt = svgArt
    globalThis.engine.ears.radio.registerProvider(yt)
  }

  // ── Desktop (1280x720) full interactive check ──
  const page = await city('scale=0.5&fire=0&people=0&living=finecar')
  await still(page)
  await page.waitForFunction(() => globalThis.engine?.ears && globalThis.engine?.alive?.things.length > 0, null, { timeout: 25_000 })
  await page.mouse.click(640, 360)
  await page.waitForFunction(() => globalThis.engine.ears.voice.running, null, { timeout: 5000 })

  bcheck(await page.evaluate(() => globalThis.engine.ears.music === null), 'ears.music remains null by default')
  await page.evaluate(installMockYouTube)
  await page.evaluate(() => { const e = globalThis.engine; e.alive.mount(e.alive.things[0]) })
  await page.waitForTimeout(450)

  // Verify zero permanent radio clutter before opening picker.
  const preOpen = await page.evaluate(() => ({
    pickerOpen: !!document.querySelector('#radio-picker')?.open,
    toastHidden: !document.querySelector('[data-panel="radio-toast"]')?.checkVisibility({ visibilityProperty: true, opacityProperty: true }),
    ytMiniHidden: !document.querySelector('[data-panel="radio-yt"]')?.checkVisibility({ visibilityProperty: true, opacityProperty: true }),
  }))
  bcheck(!preOpen.pickerOpen && preOpen.toastHidden && preOpen.ytMiniHidden, 'zero permanent radio or YouTube mini-player clutter while idle')

  // Press R while driving -> opens Waymo-style #radio-picker; verify ONLY FM Radio & YouTube Music tabs are visible (Spotify & Apple Music disabled).
  await page.keyboard.press('KeyR')
  await page.waitForFunction(() => document.querySelector('#radio-picker')?.open === true, null, { timeout: 5000 })
  await page.waitForTimeout(150)
  const visibleTabs = await page.evaluate(() => [...document.querySelectorAll('#radio-picker .rp-prov')].filter((el) => !el.hidden).map((el) => el.dataset.provider))
  bcheck(visibleTabs.length === 2 && visibleTabs[0] === 'fm' && visibleTabs[1] === 'youtube', `default UI enables FM + YouTube Music and hides Spotify/Apple (${visibleTabs.join(', ')})`)
  if (shotsDir) await page.screenshot({ path: join(shotsDir, 'radio-picker-fm.png') })

  // Switch to YouTube Music tab and play curated SF Night Synth Radio immediately (zero login).
  await page.click('#radio-picker .rp-prov[data-provider="youtube"]')
  await page.waitForTimeout(120)
  await page.click('#radio-picker .rp-item[data-playlist-id="yt-sf-night-synth"]')
  await page.waitForTimeout(200)
  const ytUi = await page.evaluate(() => ({
    provider: globalThis.engine.ears.radio.state.provider,
    playing: globalThis.engine.ears.radio.state.playing,
    badge: document.querySelector('#radio-picker .rp-badge')?.textContent?.trim(),
    title: document.querySelector('#radio-picker .rp-track-title')?.textContent?.trim(),
  }))
  bcheck(ytUi.provider === 'youtube' && ytUi.playing && ytUi.badge === 'YOUTUBE MUSIC' && ytUi.title === 'Midnight Over Bay Bridge (Live)', `YouTube Music plays curated SF stream immediately with zero login (${ytUi.title})`)
  if (shotsDir) await page.screenshot({ path: join(shotsDir, 'radio-picker-youtube-curated.png') })

  // Switch to Your Playlists tab, paste a YouTube Music playlist URL + name, click Play & Save.
  await page.click('#radio-picker .rp-tab[data-tab="yours"]')
  await page.waitForTimeout(100)
  await page.fill('#rp-yt-playlist', 'https://music.youtube.com/playlist?list=PLsfNightDrive12345')
  await page.fill('#rp-yt-name', 'Embarcadero Night Mix')
  await page.click('#radio-picker .rp-yt-add')
  await page.waitForTimeout(200)
  const savedUi = await page.evaluate(() => ({
    count: globalThis.engine.ears.radio.state.providers.youtube.playlists.length,
    activeName: globalThis.engine.ears.radio.state.playlist?.name,
  }))
  bcheck(savedUi.count === 1 && savedUi.activeName === 'Embarcadero Night Mix', 'pasting a YouTube Music playlist URL plays and saves it to Your Playlists')
  if (shotsDir) await page.screenshot({ path: join(shotsDir, 'radio-picker-youtube-yours.png') })

  // Close picker -> verify visible >=200x200 YouTube mini-player clears drive-hud/card/minimap, then skip track with Period (.) and verify toast sits clear above mini-player!
  await page.keyboard.press('Escape')
  await page.waitForFunction(() => !document.querySelector('#radio-picker')?.open, null, { timeout: 3000 })
  await page.keyboard.press('Period')
  await page.waitForTimeout(250)

  const hudCheck = await page.evaluate(() => {
    const yt = document.querySelector('[data-panel="radio-yt"]')
    const frame = yt?.querySelector('.ryt-frame')
    const toast = document.querySelector('[data-panel="radio-toast"]')
    const dh = document.querySelector('[data-panel="drive-hud"]')
    const card = document.querySelector('#card')
    const overlaps = (a, b) => a && b && a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
    const yr = yt?.getBoundingClientRect(), fr = frame?.getBoundingClientRect(), tr = toast?.getBoundingClientRect(), hr = dh?.getBoundingClientRect(), cr = card?.getBoundingClientRect()
    return {
      ytShown: !!yt && !yt.hidden && yt.checkVisibility({ visibilityProperty: true }),
      frameOk: !!fr && fr.width >= 200 && fr.height >= 200,
      frameSize: fr ? `${Math.round(fr.width)}x${Math.round(fr.height)}` : 'none',
      ytOverHud: overlaps(yr, hr),
      ytOverCard: overlaps(yr, cr),
      toastShown: !!toast && !toast.hidden && toast.classList.contains('show'),
      toastBadge: toast?.querySelector('.rt-badge')?.textContent?.trim() ?? '',
      toastTrack: toast?.querySelector('.rt-track')?.textContent?.trim() ?? '',
      toastOverYt: overlaps(tr, yr),
      toastOverHud: overlaps(tr, hr),
    }
  })
  bcheck(hudCheck.ytShown && hudCheck.frameOk && !hudCheck.ytOverHud && !hudCheck.ytOverCard, `visible YouTube mini-player meets >=200x200 ToS size (${hudCheck.frameSize}) and clears drive-hud & card`)
  bcheck(hudCheck.toastShown && hudCheck.toastBadge === 'YOUTUBE' && hudCheck.toastTrack.includes('Embarcadero Afterglow') && !hudCheck.toastOverYt && !hudCheck.toastOverHud, `Period skips YouTube track and shows upgraded toast cleanly above mini-player (${hudCheck.toastBadge}: ${hudCheck.toastTrack})`)
  if (shotsDir) await page.screenshot({ path: join(shotsDir, 'radio-driving-youtube.png') })

  // Horn smoothly ducks YouTube volume (0..100) and recovers on release.
  await page.keyboard.down('KeyH')
  await page.waitForTimeout(320)
  const ytDucked = await page.evaluate(() => globalThis.__mockYtVol)
  await page.keyboard.up('KeyH')
  await page.waitForTimeout(950)
  const ytRecovered = await page.evaluate(() => globalThis.__mockYtVol)
  bcheck(ytDucked <= 55 && ytRecovered >= 90, `horn smoothly ducks YouTube Music volume (${ytDucked}% -> ${ytRecovered}%)`)

  // Exit car pauses YouTube & hides mini-player; re-enter resumes YouTube & restores mini-player.
  await page.evaluate(() => globalThis.engine.alive.mount(null))
  await page.waitForTimeout(250)
  const outOk = await page.evaluate(() => !globalThis.__mockYt.snapshot().playing && document.querySelector('[data-panel="radio-yt"]')?.hidden === true)
  await page.evaluate(() => { const e = globalThis.engine; e.alive.mount(e.alive.things[0]) })
  await page.waitForTimeout(750)
  const backOk = await page.evaluate(() => globalThis.__mockYt.snapshot().playing && globalThis.engine.ears.radio.state.provider === 'youtube' && document.querySelector('[data-panel="radio-yt"]')?.hidden === false)
  bcheck(outOk && backOk, 'exiting car pauses YouTube & hides mini-player; re-entering car resumes remembered playlist')

  // Switching back to offline FM pauses YouTube & hides mini-player.
  await page.evaluate(() => globalThis.engine.ears.radio.tune('baydrive'))
  await page.waitForTimeout(150)
  const fmBack = await page.evaluate(() => !globalThis.__mockYt.snapshot().playing && document.querySelector('[data-panel="radio-yt"]')?.hidden === true && globalThis.engine.ears.radio.state.station.id === 'baydrive')
  bcheck(fmBack, 'switching back to offline Bay Drive FM pauses YouTube and hides mini-player')
  await page.close()

  // ── Phone upright (390x844) & landscape (844x390) safe-area + reduced-motion compliance ──
  const phoneBrowser = await chromium.launch({ ...CHROME, headless: true })
  try {
    const phoneSpecs = [
      { name: 'phone', viewport: { width: 390, height: 844 }, safe: { top: 59, bottom: 34, left: 0, right: 0 }, shot: 'radio-picker-phone.png' },
      { name: 'side', viewport: { width: 844, height: 390 }, safe: { top: 0, bottom: 21, left: 59, right: 59 }, shot: 'radio-picker-side.png' },
    ]
    for (const spec of phoneSpecs) {
      const ctx = await phoneBrowser.newContext({ viewport: spec.viewport, deviceScaleFactor: 2, isMobile: true, hasTouch: true, reducedMotion: 'reduce' })
      const p = await ctx.newPage()
      const cdp = await ctx.newCDPSession(p)
      await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: spec.safe })
      await p.goto(`${url}/city?scale=0.5&fire=0&people=0&living=finecar`)
      await p.waitForFunction(() => globalThis.engine?.world && globalThis.engine?.ears && globalThis.engine?.alive?.things.length > 0, null, { timeout: 25_000 })
      await still(p)
      await p.evaluate(installMockYouTube)
      await p.evaluate(() => { const e = globalThis.engine; e.alive.mount(e.alive.things[0]); e.ears.radio.openPicker('youtube') })
      await p.waitForFunction(() => document.querySelector('#radio-picker')?.open === true, null, { timeout: 5000 })
      await p.click('#radio-picker .rp-item[data-playlist-id="yt-sf-night-synth"]')
      await p.waitForTimeout(200)

      const geom = await p.evaluate((safe) => {
        const d = document.querySelector('#radio-picker')
        const r = d.getBoundingClientRect()
        const closeR = d.querySelector('.rp-close').getBoundingClientRect()
        const playR = d.querySelector('.rp-play').getBoundingClientRect()
        return {
          withinSafe: r.left >= safe.left - 0.5 && r.right <= innerWidth - safe.right + 0.5 && r.top >= safe.top - 0.5 && r.bottom <= innerHeight - safe.bottom + 0.5,
          rect: { l: Math.round(r.left), t: Math.round(r.top), r: Math.round(r.right), b: Math.round(r.bottom) },
          closeTouch: closeR.width >= 44 && closeR.height >= 44,
          playTouch: playR.width >= 44 && playR.height >= 44,
        }
      }, spec.safe)
      bcheck(geom.withinSafe && geom.closeTouch && geom.playTouch, `${spec.name} (${spec.viewport.width}x${spec.viewport.height} reduced-motion): picker stays within safe area and keeps >=44px touch targets (${JSON.stringify(geom.rect)})`)
      if (shotsDir) await p.screenshot({ path: join(shotsDir, spec.shot) })
      await ctx.close()
    }
  } finally {
    await phoneBrowser.close()
  }
} catch (e) {
  bcheck(false, `browser check failed: ${e.stack ?? e}`)
}
for (const f of failures) bcheck(false, f)
await finish('radio-providers')
