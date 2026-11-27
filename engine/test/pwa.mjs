// Unit checks for Voxelwright's PWA runtime (engine/page/pwa.ts):
// dynamic sky theme-color, Screen Wake Lock lifecycle, Car Radio Media Session bridge,
// install prompt / iOS detection, and manifest-gated Service Worker registration.
import assert from 'node:assert/strict'
import {
  bindRadioMediaSession,
  createInstallPrompt,
  createThemeColorSync,
  createWakeLock,
  isIosSafari,
  isStandaloneDisplay,
  fullScreenHeight,
  registerServiceWorker,
  skyThemeColor,
} from '../page/pwa.ts'

// 1. Dynamic sky theme-color tracks night, midday, sunset, fog and realm ownSky with #10141a dark floor.
{
  const night = skyThemeColor({ day: 0, cloud: 0, fog: 0, rain: 0 })
  assert.equal(night, '#10141a', `night sky floors at #10141a (got ${night})`)

  const noon = skyThemeColor({ day: 1, cloud: 0, fog: 0, rain: 0 })
  assert.match(noon, /^#[0-9a-f]{6}$/)
  const [nr, ng, nb] = [1, 3, 5].map((i) => parseInt(noon.slice(i, i + 2), 16))
  assert.ok(nb > ng && ng > nr && nb > 180, `midday sky is California blue (${noon})`)

  const rain = skyThemeColor({ day: 1, cloud: 1, fog: 0, rain: 1 })
  const [rr, rg, rb] = [1, 3, 5].map((i) => parseInt(rain.slice(i, i + 2), 16))
  assert.ok(rb - rr < nb - nr, `rain overcast desaturates sky (${rain} vs ${noon})`)

  const own = skyThemeColor({ day: 1, cloud: 0, fog: 0, rain: 0, ownSky: [0.22, 0.45, 0.82] })
  assert.notEqual(own, noon, 'realm ownSky overrides default zenith in clear daylight')

  let content = '#10141a'
  let writes = 0
  const meta = {
    name: 'theme-color',
    isConnected: true,
    get content() { return content },
    set content(v) { content = v; writes++ },
  }
  const fakeDoc = { querySelector: () => meta, head: { append() {} } }
  const sync = createThemeColorSync(fakeDoc)
  sync.update({ day: 1, cloud: 0, fog: 0, rain: 0 }, 1000)
  assert.equal(content, noon)
  assert.equal(writes, 1)
  // Within 250 ms throttle: no write.
  sync.update({ day: 0, cloud: 0, fog: 0, rain: 0 }, 1100)
  assert.equal(writes, 1)
  // Same color after throttle: still no write.
  sync.update({ day: 1, cloud: 0, fog: 0, rain: 0 }, 1500)
  assert.equal(writes, 1)
  // Night after throttle: updates to #10141a.
  sync.update({ day: 0, cloud: 0, fog: 0, rain: 0 }, 2000)
  assert.equal(content, '#10141a')
  assert.equal(writes, 2)
}

// 2. Screen Wake Lock acquires on engage, drops when hidden, and re-acquires when visible again.
{
  const listeners = new Map()
  let vis = 'visible'
  const doc = {
    get visibilityState() { return vis },
    addEventListener(t, fn) { listeners.set(t, [...(listeners.get(t) ?? []), fn]) },
    removeEventListener(t, fn) { listeners.set(t, (listeners.get(t) ?? []).filter((f) => f !== fn)) },
  }
  let requests = 0, releases = 0
  const wakeLock = {
    async request(type) {
      assert.equal(type, 'screen')
      requests++
      const s = {
        released: false,
        async release() { if (!s.released) { s.released = true; releases++ } },
      }
      return s
    },
  }
  const ctrl = createWakeLock({ doc, wakeLock })
  ctrl.engage()
  await Promise.resolve()
  assert.equal(requests, 1)
  assert.equal(ctrl.locked, true)

  vis = 'hidden'
  for (const fn of listeners.get('visibilitychange') ?? []) fn()
  assert.equal(releases, 1)
  assert.equal(ctrl.locked, false)

  vis = 'visible'
  for (const fn of listeners.get('visibilitychange') ?? []) fn()
  await Promise.resolve()
  assert.equal(requests, 2)
  assert.equal(ctrl.locked, true)

  ctrl.dispose()
  assert.equal(releases, 2)
  assert.equal(ctrl.locked, false)
}

// 3. Car Radio Media Session bridge syncs metadata/playbackState and routes hardware media keys.
{
  const handlers = new Map()
  const ms = {
    metadata: null,
    playbackState: 'none',
    setActionHandler(action, fn) { handlers.set(action, fn) },
  }
  class FakeMeta { constructor(init) { Object.assign(this, init) } }
  const subs = new Set()
  const calls = []
  let state = {
    station: { id: 'off', name: 'Radio Off', freq: '', mood: null, accent: '#999' },
    index: 0,
    driving: false,
    active: false,
    playing: false,
    provider: 'fm',
    playlist: null,
    track: null,
    volume: 1,
    ducking: 0,
    whooshes: 0,
    lastWhoosh: null,
    providers: {},
    enabled: { youtube: true, spotify: false, apple: false },
  }
  const radio = {
    get state() { return state },
    subscribe(fn) { subs.add(fn); return () => subs.delete(fn) },
    togglePlay() { calls.push('togglePlay') },
    cycle(dir) { calls.push(`cycle:${dir}`) },
    tune(i) { calls.push(`tune:${i}`) },
    async nextTrack() { calls.push('nextTrack'); return true },
    async prevTrack() { calls.push('prevTrack'); return true },
  }
  const emit = () => { for (const fn of subs) fn(state) }

  const unbind = bindRadioMediaSession(radio, { mediaSession: ms, MediaMetadataCtor: FakeMeta })
  assert.equal(ms.playbackState, 'none')
  assert.equal(ms.metadata, null)

  // Start driving on Bay Drive FM.
  state = {
    ...state,
    driving: true,
    active: true,
    playing: true,
    index: 1,
    station: { id: 'baydrive', name: 'Bay Drive FM', freq: '104.7', mood: 'baydrive', accent: '#ff4fa0' },
    track: { title: 'Bay Drive FM', artist: 'SF Night Synth · Procedural Outrun' },
  }
  emit()
  assert.equal(ms.playbackState, 'playing')
  assert.equal(ms.metadata.title, 'Bay Drive FM')
  assert.equal(ms.metadata.album, 'Voxelwright — San Francisco')
  assert.equal(ms.metadata.artwork[0].src, '/icons/icon-192.png')

  handlers.get('pause')()
  handlers.get('nexttrack')()
  handlers.get('previoustrack')()
  handlers.get('stop')()
  assert.deepEqual(calls, ['togglePlay', 'cycle:1', 'cycle:-1', 'tune:0'])

  // Switch to YouTube Music streaming -> nexttrack/previoustrack forward to provider track controls.
  calls.length = 0
  state = {
    ...state,
    provider: 'youtube',
    index: -1,
    playing: false,
    track: { title: 'Nightcall', artist: 'Kavinsky', artwork: 'https://i.ytimg.com/vi/abc/hqdefault.jpg' },
  }
  emit()
  assert.equal(ms.playbackState, 'paused')
  assert.equal(ms.metadata.title, 'Nightcall')
  assert.equal(ms.metadata.artwork[0].src, 'https://i.ytimg.com/vi/abc/hqdefault.jpg')
  handlers.get('play')()
  handlers.get('nexttrack')()
  handlers.get('previoustrack')()
  assert.deepEqual(calls, ['togglePlay', 'nextTrack', 'prevTrack'])

  // Exit car -> clears Media Session.
  state = { ...state, driving: false, active: false, playing: false }
  emit()
  assert.equal(ms.playbackState, 'none')
  assert.equal(ms.metadata, null)

  unbind()
  assert.equal(handlers.get('play'), null)
}

// 3b. An installed iOS app laid out a status bar short (owner's iPhone, Nov 27) fills the screen; a full layout is left alone.
{
  assert.equal(fullScreenHeight({ w: 393, h: 793 }, { w: 393, h: 852 }), 852)
  assert.equal(fullScreenHeight({ w: 852, h: 393 }, { w: 393, h: 852 }), null)
  assert.equal(fullScreenHeight({ w: 393, h: 852 }, { w: 393, h: 852 }), null)
  assert.equal(fullScreenHeight({ w: 393, h: 500 }, { w: 393, h: 852 }), null)
}

// 4. Install prompt handles beforeinstallprompt, iOS Safari fallback, and hides in standalone or webdriver.
{
  assert.equal(isIosSafari('Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Mobile/15E148 Safari/604.1', 5), true)
  assert.equal(isIosSafari('Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 CriOS/130.0 Mobile/15E148 Safari/604.1', 5), false)
  assert.equal(isIosSafari('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36', 0), false)
  assert.equal(isStandaloneDisplay({ matchMedia: (q) => ({ matches: q.includes('fullscreen') }) }, {}), true)
  assert.equal(isStandaloneDisplay({ matchMedia: () => ({ matches: false }) }, { standalone: true }), true)

  const winListeners = new Map()
  const win = {
    matchMedia: () => ({ matches: false }),
    addEventListener(t, fn) { winListeners.set(t, [...(winListeners.get(t) ?? []), fn]) },
    removeEventListener(t, fn) { winListeners.set(t, (winListeners.get(t) ?? []).filter((f) => f !== fn)) },
  }
  let persisted = 0
  const nav = {
    userAgent: 'Mozilla/5.0 Chrome/140.0.0.0 Safari/537.36',
    maxTouchPoints: 0,
    webdriver: false,
    storage: { persist: async () => { persisted++; return true } },
  }
  const install = createInstallPrompt({ win, nav })
  assert.equal(install.available(), false)

  let prevented = false, prompted = false
  const bipEvent = {
    preventDefault() { prevented = true },
    async prompt() { prompted = true },
    userChoice: Promise.resolve({ outcome: 'accepted' }),
  }
  for (const fn of winListeners.get('beforeinstallprompt') ?? []) fn(bipEvent)
  assert.equal(prevented, true)
  assert.equal(install.available(), true)
  assert.equal(install.mode(), 'native')

  const outcome = await install.prompt()
  assert.equal(prompted, true)
  assert.equal(outcome, 'accepted')
  assert.equal(install.available(), false)
  assert.equal(install.installed(), true)
  assert.equal(persisted, 1)
  install.dispose()

  // iOS Safari non-standalone exposes ios hint flow.
  let iosHints = 0
  const iosInstall = createInstallPrompt({
    win,
    nav: { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 Version/19.0 Mobile Safari/604.1', maxTouchPoints: 5, webdriver: false },
    onIosHint: () => { iosHints++ },
  })
  assert.equal(iosInstall.available(), true)
  assert.equal(iosInstall.mode(), 'ios')
  assert.equal(await iosInstall.prompt(), 'ios')
  assert.equal(iosHints, 1)
  iosInstall.dispose()

  // Webdriver never shows Install button (keeps automated HUD screenshots deterministic).
  const botInstall = createInstallPrompt({
    win,
    nav: { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 Version/19.0 Mobile Safari/604.1', maxTouchPoints: 5, webdriver: true },
  })
  assert.equal(botInstall.available(), false)
  botInstall.dispose()
}

// 5. Service Worker registration is strictly gated on <link rel="manifest"> and HTTPS/loopback.
{
  const registered = []
  const nav = { webdriver: false, serviceWorker: { register: async (url, opts) => { registered.push([url, opts]); return {} } } }
  assert.equal(await registerServiceWorker({ doc: { querySelector: () => null }, nav, loc: { protocol: 'https:', hostname: 'voxelwright.world' } }), null)
  assert.equal(registered.length, 0, 'no SW registration without manifest link')

  assert.equal(await registerServiceWorker({ doc: { querySelector: () => ({}) }, nav, loc: { protocol: 'http:', hostname: 'example.com' } }), null)
  assert.equal(registered.length, 0, 'no SW registration on insecure remote HTTP')

  await registerServiceWorker({ doc: { querySelector: () => ({}) }, nav, loc: { protocol: 'https:', hostname: 'voxelwright.world' } })
  assert.deepEqual(registered, [['/sw.js', { scope: '/' }]])
}

console.log('ok pwa')
