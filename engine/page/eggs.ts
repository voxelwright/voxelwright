// The landing's easter eggs in the San Francisco realm (#450), from the site's (static/landing/eggs.js, November 19).
// The realm is the landing now, so they are its own: the city's lit windows are the screen (march.ts and far.ts
// SCREEN, the realm's own window lighting), the hour and the weather are the realm's controls (realm-ui.ts, weather.ts),
// and what the city says it says on the banner its plane tows (signs.ts, boards.ts), which comes into the picture to say it.
//
//   Enter or /           a line to say something to the city on; what is typed shows on the banner as it is typed
//                        (in the first view too, where main.ts opens it: no other key is heard there)
//   wake up, neo, red pill, follow the white rabbit       the Matrix: code rain on the windows, its music, overcast, night, green
//   blue pill, Esc       out of the Matrix (Esc ends any egg; reset ends them all and puts the sky back)
//   rickroll, never gonna give you up                     Rick Astley on every window, with his sound
//   bad apple, or the hour swung across dusk four times in four seconds                        Bad Apple!! in shadow
//   ↑↑↓↓←→←→ b a         +30 lives on the banner
//   iddqd                the city cannot be broken (again: it can)
//   moon                 night and the moon; shoot the moon (a tool used at it) and it grows, three sizes
//   do a barrel roll     the eye turns round once
//
// Each also has a thing in the city that starts it (eggs-things.ts), for whoever has no keyboard to hand: a payphone
// that rings (the Matrix; hang up to leave), a jukebox (the Rickroll), a fruit cart's black apple (Bad Apple!!), an
// arcade cabinet (the Konami code's lives), a viewer at a lookout (the moon; again, and it grows), a toy plane (a barrel
// roll) and a golden shield (IDDQD). A cue says what each does once one is near; a tap or a click on it, E, or the Use
// key with the aim on the thing, uses it.
//
// In the first view some of the city's windows hold an egg each, as lockers (eggs-lockers.ts): a flicker where something
// new is, a green lamp where it was seen, a red light where it is locked until found in the city. The pointer over one
// says what is in it, and a click opens it. A key by the credits counts them and shows them all.
//
// While one of the three that take the windows plays (the Matrix, the Rickroll, Bad Apple!!), the boards' own light is
// off (boards.ts `dark`): BLOG, EXPLORE and the logos are not lit over the picture.
//
// Nothing here is fetched until an egg starts: the pictures (eggs-pictures.ts), the videos and the Matrix's music
// (sf/eggs/, put there by sf/build.mjs, never in git). Their sound plays because the visitor started it; a browser that
// holds the sound back gets it muted and an Unmute key, which is that tap. The Matrix without its music is the Matrix.
import type { Input } from './input.ts'
import type { Marcher, View } from './march.ts'
import { OWN_HOUR } from './weather.ts'
import type { Skies, Weather } from './weather.ts'
import type { Signs } from './signs.ts'
import type { Clear, Picture, WindowEffect } from './eggs-pictures.ts'
import type { Hud } from './hud.ts'
import type { Pieces } from './pieces.ts'
import { things, type ThingId } from './eggs-things.ts'
import { phrases, PHRASES, words, type Look, type Meme } from './eggs-said.ts'
import { firstTaps, type Spot } from './eggs-first.ts'
import { lockers } from './eggs-lockers.ts'
import type { Boards } from './boards.ts'
import type { Far } from './far.ts'

export interface EggsPage {
  device: GPUDevice
  march: Marcher
  controls: Input
  /** The page makes things from words (#526, local.ts `MAKING`): Enter is the ask bar's there, and the line to the city opens with / alone. */
  makes?: boolean
  /** The realm's sky (realm-ui.ts): the weather and the hour, changed smoothly, read back by its controls. */
  sky: Skies
  /** The hour the page is lit for, or null for the realm's own light. */
  hour(): number | null
  setHour(h: number): void
  /** The realm's own light again (the arrival's sun and grade, the hour unset). */
  ownLight(): void
  /** A grade and tint over the finished picture (glow.ts), or null for the hour's own. */
  mood(m: { grade?: readonly [number, number]; tint?: readonly [number, number, number] } | null): void
  notice(text: string, ms?: number): void
  view(): View
  /** The eye, to turn it (a barrel roll). */
  pose: { yaw: number }
  /** The width of the view over its height. */
  aspect(): number
  /** Called every frame with the gap since the last, ms. */
  watch(each: (gap: number) => void): void
  /** The city's own sound steps aside while an egg's plays (true), and comes back (false). */
  hush(on: boolean): void
  /** Called when the world is put back (Backspace, Reset world). */
  onReset(each: () => void): void
  signs: Signs
  /** Keeps the banner's plane in the picture while an egg has something on it (true), or lets it go round (false). */
  callPlane(on: boolean): void
  /** Whether the banner's words can be read now: its plane in the picture, and come in to its near round if it has one (its own round is far off, where a line someone must answer is too small). */
  planeSeen(): boolean
  /** The realm's controls (realm-ui.ts), which the line and the player join. */
  ui: HTMLElement
  /** Where the page's folder is: the videos are under eggs/ there. */
  base: string
  /** What draws the things that start the eggs, and the cue beside one that is near (eggs-things.ts). */
  pieces: Pieces
  hud: Hud
  /** The picture, whose taps in the first view start the eggs (eggs-first.ts). */
  canvas: HTMLCanvasElement
  /** Whether the first view is up as it opened: nobody on the way in, the eye where it arrived. */
  still(): boolean
  /** An EXPLORE asked once is put back as it was (explore.ts `disarm`). */
  calm(): void
  /** The boards' own light off while an egg has the windows (true), and on again (false): boards.ts `dark`. */
  darkBoards(on: boolean): void
  /** The banner's plane (boards.ts), or null. */
  plane(): Boards['plane']
  /** Where the feet are (world cells), or null flying as an eye; and where feet would stand at a column. */
  feet(): readonly number[] | null
  ground(x: number, z: number): number
  /** The far model, which lights the windows that hold an egg (far.ts `lockers`). */
  far: Pick<Far, 'lockers' | 'lockerHeader' | 'listing'>
  /** What the unused lower/outer windows show during video eggs: 'ambilight' (default), 'equalizer', or 'off'. */
  windowEffect?(): WindowEffect
}

// Original line drawing from the park's east-southeast view (the site's, the same view).
const GREETING = String.raw`Hello there.
                 |        __
         /\     /|\      |  |
   _[]__/  \_[]/ | \__[]_|  |___
 ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
General Kenobi.
If you managed to find this, you can send your resume… oh wait I'm not hiring, nvm.`

export { words } from './eggs-said.ts'

type Pane = readonly [number, number, number, number]
interface Video { file: string; title: string; outside: Pane; contrast: number; start: string; end: string; /** Whether sky-gap drones + fog display this egg over open sky (default true for videos). */ sky?: boolean }
type Egg = string
const KONAMI = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'KeyB', 'KeyA']
/** The moon's sizes against its own (the site's three radii, 0.017, 0.028 and 0.044 of the view). */
const MOONS = [0, 0.65, 1.6]

/** A meme's evening, where it has no look of its own: after sunset, clear, the picture's own colours. */
const EVENING: Look = { hour: 21.0, weather: 'clear', tint: [1, 0.97, 0.95] }
/** How each egg dresses the sky (the memes' added once sf/memes.json has come). */
const LOOKS: Record<Egg, Look> = {
  // A green night under cloud (fog lay over the windows' code, #450).
  matrix: { hour: 23.25, weather: 'overcast', grade: [0.75, 0.4], tint: [0.62, 1.0, 0.68] },
  // A 1987 dusk: blue hour, a warm tint.
  rickroll: { hour: 20.0, weather: 'clear', tint: [1.0, 0.88, 0.97] },
  // Shadow art: an overcast night in black and white, only the windows lit.
  apple: { hour: 23.0, weather: 'overcast', grade: [0, 0.45], tint: [0.94, 0.94, 0.94] },
}
/** The videos (made for the site by scripts/landing/encode-eggs.mjs: 160 x 120, -16 LUFS, HE-AAC; the memes by sf/add-egg.mjs, added once sf/memes.json has come). `outside` is what the panes beyond the picture show. */
const VIDEOS: Record<Egg, Video> = {
  rickroll: { file: 'eggs/rick.mp4', title: 'Never Gonna Give You Up', outside: [14, 8, 22, 190], contrast: 1.25,
    start: 'Never gonna give you up. Rick Astley is on every window in the city.', end: 'Never gonna let you down: that was the whole song.' },
  apple: { file: 'eggs/bad-apple.mp4', title: 'Bad Apple!!', outside: [0, 0, 0, 240], contrast: 1.1,
    start: 'Bad Apple!! The city plays it in shadow.', end: 'Bad Apple!! is over. The lights come back on.' },
}
/** Where each came from, on YouTube (the player's link to it; the memes' added from sf/memes.json). */
const SOURCES: Record<Egg, string> = { matrix: '8mAZNNrPH0w', rickroll: 'dQw4w9WgXcQ', apple: 'FtutLA63Cp8' }
/** The Matrix's music (from the film's soundtrack, made by sf/build.mjs's note: HE-AAC, -16 LUFS as the videos), played round while it is up. */
const MUSIC = { file: 'eggs/matrix.m4a', title: 'The Matrix' }
/** What the player says is playing. */
const TITLES = (egg: Egg) => (egg === 'matrix' ? MUSIC.title : VIDEOS[egg]?.title ?? egg)

export function eggs(page: EggsPage) {
  const { march, device } = page
  const hasMedia = document.body.hasAttribute('data-egg-media')
  // ── The memes (sf/memes.json, small, fetched as the eggs start): their phrases, videos and looks joined to the eggs' own ──
  let MEMES: readonly Meme[] = [], known: ReadonlyMap<string, string> = hasMedia ? PHRASES : new Map([...PHRASES].filter(([, action]) => !['rickroll', 'apple', 'meme'].includes(action)))
  const memesCame = !hasMedia ? Promise.resolve() : fetch(new URL('eggs/memes.json', page.base)).then((r) => { if (!r.ok) throw Error(`memes.json: ${r.status}`); return r.json() as Promise<Meme[]> }).then((list) => {
    const { all, wrong } = phrases(list)
    for (const w of wrong) console.warn(`eggs: ${w}`)
    MEMES = list
    known = all
    for (const m of list) {
      LOOKS[m.id] = m.look ?? EVENING
      SOURCES[m.id] = m.youtube
      VIDEOS[m.id] = { file: `eggs/${m.id}.mp4`, title: m.title, outside: [10, 10, 14, 200], contrast: 1.1,
        start: `${m.title}, on every window in the city.`, end: `That was ${m.title}. Say “meme” for another.` }
    }
  }, (e) => console.warn('the memes did not load:', e))
  // What the eggs say on the banner, and what they said last that was not the line's echo (the line gives it back as it
  // closes). Esc gives the banner its own words back. While an egg has something on it, its plane is kept in sight.
  let onBanner: string | null = null, saying = false
  /** A line the banner says once what it says now has been seen. */
  let nextLine: { after: string; next: string; seen: number } | null = null
  const show = (text: string | null) => {
    saying = text !== null
    page.callPlane(saying)
    // (A banner that is not there, `?boards=0`, keeps what it is set to for when it comes: signs.ts.)
    page.signs.set('banner', text === null ? null : { text })
  }
  const banner = (text: string | null) => { onBanner = text; brief = 0; show(text) }
  /** Words on the banner for a while, then what the eggs had on it before. */
  let brief = 0
  const briefly = (text: string, ms = 6000) => { const mine = ++brief; show(text); setTimeout(() => { if (brief === mine && !typing) show(onBanner) }, ms) }
  console.info(GREETING)
  const say = (text: string, ms = 5000) => { page.notice(text, ms); tell(text) }
  /** Said only to whoever cannot see the picture: what the player shows already (what plays, that it is paused or muted) is not laid over it again (#134). */
  const tell = (text: string) => { if (status.parentElement !== laidOn()) laidOn().append(status); status.textContent = text }

  // ── What is running, and the sky as it was before the first egg ──
  let running: { egg: Egg; picture: Picture | null; started: number; media?: HTMLVideoElement; blocked?: boolean; held?: boolean; waiting?: boolean; paused?: boolean } | null = null
  let fading: Picture | null = null
  let before: { hour: number | null; weather: Weather } | null = null
  /** Waiting for the light to come round to the realm's own hour, to give the realm its own light back. */
  let goingHome = false
  let shield = false, moon = 0, clock = 0
  /** An hour to glide to once the sky has taken the hour set from here (weather.ts: an hour set from outside ends a glide). */
  let pending: number | null = null
  const glideTo = (h: number) => {
    goingHome = false
    // From the realm's own light, the glide starts at the hour nearest it, not at the controls' unset one: set now,
    // glided from on the next frame.
    if (page.hour() === null) { page.setHour(OWN_HOUR); pending = h } else page.sky.glide(h)
  }
  /** An egg just left in fog: the hour to go back to once the fog has thinned (the day back under a night's fog was a picture washed pale, #450), and since when. */
  let leaving: { hour: number | null; since: number } | null = null
  const home = (hour: number | null) => { if (hour === null) { page.sky.glide(OWN_HOUR); goingHome = true } else page.sky.glide(hour) }
  const keep = () => {
    // (Another egg before the last had gone home: what was before is still what the last one kept.)
    if (leaving) { before = { hour: leaving.hour, weather: page.sky.weather }; leaving = null }
    // (On its way home to the realm's own light, that is what was before: not the hour the glide had come to.)
    if (!before) before = { hour: goingHome ? null : page.hour(), weather: page.sky.weather }
  }
  const dress = (egg: Egg) => {
    keep()
    moonlit = false
    const look = LOOKS[egg]
    glideTo(look.hour)
    page.sky.set(look.weather)
    page.mood({ grade: look.grade, tint: look.tint })
  }
  const undress = () => {
    page.mood(null)
    if (!before) return
    pending = null
    page.sky.set(before.weather)
    leaving = { hour: before.hour, since: performance.now() }
    before = null
  }

  // ── The Matrix ──
  const enter = async () => {
    if (running?.egg === 'matrix') return running.blocked ? unblock(running) : say('You are already in. Esc, or say “blue pill”, to leave.')
    stop(true, false, true)
    // Its music is started inside the gesture, as a video is (`play`), and comes round again at its end. Its player is
    // the videos' own: Esc, “blue pill”, the phone again or Stop end it, and the music with it.
    const m = hasMedia ? element() : undefined
    if (m) { m.muted = false; m.loop = true; void m.play().catch(() => {}) }
    const started = ++clock
    const current: NonNullable<typeof running> = { egg: 'matrix', picture: null, started: performance.now(), media: m }
    running = current
    if (m) { page.hush(true); showPlayer() }
    // The rain does not wait for the music: it comes as soon as its code has, and the music when its file has.
    const music = m && fetchVideo(MUSIC.file)
    music?.catch(() => {})
    const { codeRain } = await import('./eggs-pictures.ts')
    if (running !== current || started !== clock) return
    current.picture = codeRain()
    current.started = performance.now()
    dress('matrix')
    // Two lines, one after the other (the banner has room for one): the second once the first has been in sight a while.
    banner('The Matrix has you')
    nextLine = { after: 'The Matrix has you', next: 'Red pill or blue pill?', seen: 0 }
    say('Wake up, Neo… The windows are code now. Esc, or say “blue pill”, to leave.')
    if (!music || !m) return
    try {
      const url = await music
      if (running !== current || started !== clock) return
      m.src = url
      run(current)
    } catch (e) {
      // No music (not built, or it did not come): the Matrix goes on in silence, and no player is offered.
      console.warn(`${MUSIC.file} did not load:`, e)
      if (running !== current) return
      current.media = undefined
      m.pause()
      m.loop = false
      hidePlayer()
      page.hush(false)
    }
  }

  // ── Videos on the windows ──
  // One element plays every egg and is the clock. It is started inside the visitor's key press or tap, which is what
  // lets its sound play; its file comes after, whole, as a blob (a static host may not serve byte ranges).
  let media: HTMLVideoElement | null = null
  const files = new Map<string, Promise<string>>()
  const element = () => {
    if (media) return media
    media = document.createElement('video')
    media.playsInline = true
    media.preload = 'none'
    media.disableRemotePlayback = true
    media.setAttribute('aria-hidden', 'true')
    media.style.display = 'none'
    document.body.append(media)
    media.addEventListener('ended', () => stop(false, true))
    return media
  }
  const fetchVideo = (file: string) => {
    const url = new URL(file, page.base).href
    if (!files.has(url)) {
      const got = fetch(url).then((r) => { if (!r.ok) throw Error(`${file}: ${r.status}`); return r.blob() }).then((b) => URL.createObjectURL(b))
      got.catch(() => files.delete(url))
      files.set(url, got)
    }
    return files.get(url)!
  }
  let wakeAudioFn: ((media: HTMLVideoElement | null, effect: WindowEffect) => void) | null = null
  const getWindowEffect = (): WindowEffect => page.windowEffect?.() ?? 'ambilight'
  const wakeAudio = () => {
    const effect = getWindowEffect()
    if (effect !== 'equalizer' || !media) return
    if (wakeAudioFn) wakeAudioFn(media, effect)
    else void import('./eggs-pictures.ts').then((m) => { wakeAudioFn = m.wakeVideoAudio; m.wakeVideoAudio(media, getWindowEffect()) })
  }
  const run = (current: NonNullable<typeof running>) => {
    const m = current.media!
    wakeAudio()
    void m.play().catch((e: Error) => {
      if (running !== current || e.name !== 'NotAllowedError') return
      // The browser wants a fresh tap for sound: the video plays muted, and Unmute is that tap.
      current.blocked = true
      m.muted = true
      void m.play().catch(() => {})
      tuck(false)
      showPlayer()
      tell('Playing muted: Unmute on the player brings the sound.')
    })
  }
  /** A tap again while its sound was held back: the sound, now. */
  const unblock = (current: NonNullable<typeof running>) => {
    current.blocked = false
    current.media!.muted = false
    run(current)
    showPlayer()
    tell('Sound on.')
  }
  /** The meme played last, which “meme” does not play again straight away. */
  let lastMeme: string | null = null, memesPlayed = 0
  const play = async (egg: Egg) => {
    if (!hasMedia) return
    const v = VIDEOS[egg]
    if (egg !== 'rickroll' && egg !== 'apple') { lastMeme = egg; memesPlayed++ }
    if (running?.egg === egg) return running.blocked ? unblock(running) : stop()
    stop(true, false, true)
    const m = element()
    m.muted = false
    m.loop = false
    // Started inside the gesture before it has a file: some browsers let an element play sound later only if it was
    // first started from a tap.
    wakeAudio()
    void m.play().catch(() => {})
    const started = ++clock
    const current: NonNullable<typeof running> = { egg, picture: null, started: performance.now(), media: m }
    running = current
    dress(egg)
    page.hush(true)
    showPlayer()
    banner(`Now playing: ${v.title}`)
    tell(`Tuning in: ${v.title}…`)
    try {
      const [{ videoPicture, wakeVideoAudio }, url] = await Promise.all([import('./eggs-pictures.ts'), fetchVideo(v.file)])
      wakeAudioFn = wakeVideoAudio
      if (running !== current || started !== clock) return
      current.picture = videoPicture(m, page.aspect, { outside: v.outside, contrast: v.contrast, sky: v.sky ?? true, windowEffect: getWindowEffect, clear: strip })
      m.src = url
      // It plays once the windows are its screen (every frame below): a 5 s clip started as the screen comes up was
      // half over before it could be seen. Until then its first frame stands on the windows. (The play started in the
      // gesture, with no file yet, would play it as soon as it came: held here. The gesture has let the element play.)
      m.pause()
      current.waiting = true
      tell(`${v.start} Esc, or Stop on the player, ends it.`)
    } catch (e) {
      console.warn(`${v.file} did not load:`, e)
      if (running !== current) return
      stop(true)
      say(`${v.title} didn't load. Try again.`)
    }
  }
  /** Ends what is running: quietly, or saying so (`ended`: it played to its end); `staying`: another egg takes the sky as it is. */
  const stop = (quiet = false, ended = false, staying = false) => {
    const was = running
    if (!was) return
    running = null
    clock++
    fading?.dispose()
    fading = was.picture
    if (was.media) {
      was.media.pause()
      was.media.removeAttribute('src')
      was.media.load()
      page.hush(false)
    }
    hidePlayer()
    banner(shield ? 'God mode' : null)
    if (!staying) undress()
    if (!quiet) {
      if (was.egg === 'matrix') say('Blue pill. Back in the park.')
      else tell(ended ? VIDEOS[was.egg].end : `${VIDEOS[was.egg].title} stopped.`)
    }
  }

  // ── The player: what is playing, a link to where it came from, and a control for each thing the hand does to a
  // video (DESIGN.md), in one row of the HUD's slim keys: a key to pause it and to play it on, a fader for where in it
  // the picture is (set by where it stands, as a scrubber is), a key for its sound, one for another meme, one to stop
  // it, and one to hide the row ──
  const realm = page.ui
  /** Where what the eggs lay over the picture goes: the realm's controls, or in the first view, where they are hidden, beside the first view's own keys. */
  const laidOn = () => (document.documentElement.classList.contains('first') ? document.getElementById('first') ?? realm : realm)
  const player = document.createElement('div')
  player.className = 'vx-card egg-player'
  player.hidden = true
  player.setAttribute('role', 'group')
  player.setAttribute('aria-label', 'Now playing')
  // (The city's cues stand clear of it, hud.ts.)
  player.dataset.hudClear = ''
  // Where it stands: in a strip along the top or the bottom of the picture, one end fixed, and the video is fitted
  // into the rest (strip(), eggs-pictures.ts videoRect), so the two never meet. On a desk, in the first view at the
  // bottom right, gone in at the top left under the servers' key (the settings panel is open at the
  // top right). By touch, held upright: under the top corners' keys, as wide as the screen (in the first
  // view under the credits and settings keys, first.ts; in the realm under the minimap, the tool key and the street's
  // name, play-hud.ts); held wide and gone in, in the top row left of the settings key; held wide in the first view,
  // at the bottom right in two rows, right of the BLOG board (the banner and the boards are at the top). Hidden, it is its one key
  // where that key was. (By the page's state, not by what holds it: started in the first view it stays in #first.)
  const placed = document.createElement('style')
  placed.textContent = /* css */ `
    .vx-card.egg-player { --vx: 2px; --key: 36px; --line: 15px; position: absolute; display: grid; gap: 0 4px; padding: 7px 5px 5px 8px; margin: 0; border: 0; pointer-events: auto; box-sizing: border-box;
      grid-template-columns: var(--key) minmax(0, 1fr) repeat(4, var(--key)); grid-template-rows: var(--line) calc(var(--key) - var(--line)); align-items: center;
      top: max(18px, env(safe-area-inset-top)); right: calc(max(18px, env(safe-area-inset-right)) + 50px); inline-size: min(520px, 100vw - 260px);
      font: 600 13px/1 var(--hud-font, var(--vx-font, system-ui)); color: var(--lit-legend, inherit); }
    .vx-card.egg-player > * { margin: 0; }
    .egg-player .vx-button { grid-row: 1 / span 2; inline-size: var(--key); min-inline-size: var(--key); block-size: var(--key); min-block-size: var(--key); padding: 0; justify-content: center; }
    .egg-player .pause { grid-column: 1; } .egg-player .mute { grid-column: 3; } .egg-player .next { grid-column: 4; } .egg-player .stop { grid-column: 5; } .egg-player .tuck { grid-column: 6; }
    /* Standing by the left (a desk, gone in): the hide key at the left end. */
    .vx-card.egg-player[data-side="left"] { grid-template-columns: repeat(2, var(--key)) minmax(0, 1fr) repeat(3, var(--key)); }
    .egg-player[data-side="left"] .tuck { grid-column: 1; } .egg-player[data-side="left"] .pause { grid-column: 2; } .egg-player[data-side="left"] :is(.line, .seek) { grid-column: 3; }
    .egg-player[data-side="left"] .mute { grid-column: 4; } .egg-player[data-side="left"] .next { grid-column: 5; } .egg-player[data-side="left"] .stop { grid-column: 6; }
    @media (pointer: fine) { html:not(.first) .vx-card.egg-player { left: max(18px, env(safe-area-inset-left)); right: auto; top: calc(max(18px, env(safe-area-inset-top)) + 46px); } }
    .egg-player .line { grid-column: 2; grid-row: 1; display: flex; align-items: baseline; gap: 8px; min-inline-size: 0; padding-inline: 4px; }
    .egg-player .seek { grid-column: 2; grid-row: 2; display: flex; align-items: center; gap: 8px; align-self: stretch; min-inline-size: 0; padding-inline: 4px; container-type: inline-size; }
    /* (A short row keeps its fader long: the time it has played alone, the fader shows how much is left.) */
    @container (max-width: 200px) { .egg-player .time .whole { display: none; } }
    .egg-player .vx-slider { flex: 1 1 auto; display: flex; align-items: center; align-self: stretch; min-inline-size: 0; }
    .egg-player .vx-slider input { inline-size: 100%; block-size: 100%; margin: 0; accent-color: var(--vx-link, auto); }
    .egg-player .title { flex: 0 1 auto; display: inline-flex; min-inline-size: 0; max-inline-size: 100%; color: var(--vx-link, inherit); text-decoration: none; }
    .egg-player .title > span { min-inline-size: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-decoration: underline; text-underline-offset: 2px; text-decoration-thickness: 1px; }
    /* (The arrow stays when the title is cut short: it says the title is a link out.) */
    .egg-player .title::after { flex: none; content: "\\00A0\\2197\\FE0E"; }
    .egg-player .title:focus-visible { outline: 2px solid var(--vx-focus, currentColor); outline-offset: 2px; border-radius: 2px; }
    .egg-player .time { flex: none; font: 400 11px/1 var(--vx-mono, ui-monospace, monospace); font-variant-numeric: tabular-nums; color: var(--vx-ink-quiet, inherit); }
    .vx-card.egg-player.tucked { inline-size: auto !important; grid-template-columns: var(--key); }
    .egg-player.tucked > :not(.tuck, .vx-canvas) { display: none; }
    /* (Hidden, the key alone: no plate round it, and nothing but the key takes a tap.) */
    .egg-player.tucked { pointer-events: none; } .egg-player.tucked > .vx-canvas { visibility: hidden; } .egg-player.tucked .tuck { pointer-events: auto; }
    .egg-player.tucked .tuck { grid-column: 1; }
    @media (pointer: fine) { .egg-player .title { font-size: 14px; } }
    @media (pointer: coarse) {
      .vx-card.egg-player { --key: 44px; --line: 16px; inline-size: min(440px, 100vw - 260px); }
    }
    /* Upright, as wide as the screen, in three rows on the same two edges: what plays, with Hide at the right; the
       fader and the time the whole width under the thumb; and the keys in the order they have on a wide screen, the first
       under the title's start and the last under Hide. */
    @media (pointer: coarse) and (max-aspect-ratio: 1/1) {
      .vx-card.egg-player { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 6px 8px; padding: 9px 8px 8px 10px;
        right: max(16px, env(safe-area-inset-right)); inline-size: calc(100vw - 2 * max(16px, env(safe-area-inset-right))); }
      .egg-player .line { order: 1; flex: 1 1 0; align-items: center; padding-inline: 2px; }
      .egg-player .title { font-size: 14px; }
      .egg-player .tuck { order: 2; }
      .egg-player .seek { order: 3; flex: 1 0 100%; block-size: 24px; padding-inline: 2px; box-sizing: border-box; }
      .egg-player .pause { order: 4; } .egg-player .mute { order: 5; } .egg-player .next { order: 6; } .egg-player .stop { order: 7; }
      html.first .vx-card.egg-player { top: calc(max(20px, calc(env(safe-area-inset-top) + 8px)) + 64px); }
      html:not(.first) .vx-card.egg-player { top: calc(max(14px, env(safe-area-inset-top)) + 110px); }
    }
    /* The first view, wide: at the bottom right, the video fitted above it (its top is the banner's round and the boards). */
    @media (min-aspect-ratio: 1/1) { html.first .vx-card.egg-player { top: auto; left: auto; bottom: max(16px, env(safe-area-inset-bottom)); right: max(16px, env(safe-area-inset-right)); } }
    /* By touch, held wide, in the first view: right of the BLOG board (which ends a little past the middle of the
       picture), in two rows: the title, Sound and Stop over Pause, the fader, Next and Hide (Hide in the corner the row
       stands by, so that hidden its key is where it was). */
    @media (pointer: coarse) and (min-aspect-ratio: 1/1) {
      html.first .vx-card.egg-player { inline-size: calc(43vw - max(16px, env(safe-area-inset-right))); display: flex; flex-wrap: wrap; align-items: center; gap: 6px; padding: 8px 6px 6px 9px; }
      html.first .egg-player .line { order: 1; flex: 1 1 calc(100% - 2 * var(--key) - 12px); box-sizing: border-box; }
      html.first .egg-player .mute { order: 2; } html.first .egg-player .stop { order: 3; }
      html.first .egg-player .pause { order: 4; } html.first .egg-player .seek { order: 5; flex: 1 1 0; block-size: var(--key); }
      html.first .egg-player .next { order: 6; } html.first .egg-player .tuck { order: 7; }
    }
    /* Held wide and gone in: in the top row, between the minimap and the column of the settings and tool keys. */
    @media (pointer: coarse) and (min-aspect-ratio: 1/1) {
      html:not(.first) .vx-card.egg-player { top: max(7px, env(safe-area-inset-top)); right: calc(max(14px, env(safe-area-inset-right)) + 134px); inline-size: min(420px, 100vw - 2 * max(14px, env(safe-area-inset-left)) - 330px); }
    }`
  document.head.append(placed)
  // (Each key is its picture alone, its name said to whoever cannot see it, with no tip over the picture.)
  const key = (cls: string, icon: string, name: string, extra = '') => `<button class="vx-button ${cls}" type="button" data-vx-icon="${icon}" data-vx-icon-only aria-label="${name}"${extra}></button>`
  player.innerHTML = `${key('pause', 'pause', 'Pause', ' data-vx-kind="main"')}
    <div class="line"><a class="title" target="_blank" rel="noopener noreferrer"><span></span></a></div>
    <div class="seek"><span class="vx-slider"><input type="range" min="0" max="1" step="0.05" value="0" aria-label="Where in it"></span><span class="time"><output class="at">0:00</output><span class="whole"> / <output class="of">0:00</output></span></span></div>
    ${key('mute', 'sound', 'Mute')}${key('next', 'next', 'Next')}${key('stop', 'stop', 'Stop', ' data-vx-kind="danger"')}${key('tuck', 'minimize', 'Hide the player')}`
  realm.append(player)
  // (The kit's voxels for the row, as the lockers' key has them, unless the page asks for plain keys, first.ts: the kit
  // took the realm's controls before this row was made, so the row is given to it here.)
  if (new URLSearchParams(location.search).get('kit') !== 'plain') void import(new URL('../kit/src/index.js', import.meta.url).href).then((k: { adopt(root?: Element): void }) => k.adopt(player)).catch(() => {})
  const $p = <T extends Element>(q: string) => player.querySelector<T>(q)!
  const muteKey = $p<HTMLButtonElement>('.mute'), stopKey = $p<HTMLButtonElement>('.stop'), pauseKey = $p<HTMLButtonElement>('.pause'), nextKey = $p<HTMLButtonElement>('.next'), tuckKey = $p<HTMLButtonElement>('.tuck')
  const link = $p<HTMLAnchorElement>('.title'), fader = $p<HTMLInputElement>('.vx-slider input'), at = $p<HTMLOutputElement>('.at'), of = $p<HTMLOutputElement>('.of')
  const mmss = (t: number) => (Number.isFinite(t) ? `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}` : '0:00')
  /** A key's name, picture and kind, set only where they change: the kit builds a key again when its picture does. */
  const keyed = (b: HTMLButtonElement, name: string, icon: string, kind = '') => {
    if (b.getAttribute('aria-label') !== name) b.setAttribute('aria-label', name)
    if (b.dataset.vxIcon !== icon) b.dataset.vxIcon = icon
    if ((b.dataset.vxKind ?? '') !== kind) { if (kind) b.dataset.vxKind = kind; else delete b.dataset.vxKind }
  }
  /** Whether the hand is on the fader: what it says is the hand's then, not the video's. */
  let scrubbing = false
  /** The fader and the times as the video has them. */
  const where = () => {
    const m = running?.media
    if (!m) return
    const d = Number.isFinite(m.duration) ? m.duration : 0
    fader.max = String(d || 1)
    if (!scrubbing) fader.value = String(m.currentTime)
    at.value = mmss(scrubbing ? Number(fader.value) : m.currentTime)
    of.value = mmss(d)
    fader.setAttribute('aria-valuetext', `${at.value} of ${of.value}`)
  }
  const showPlayer = () => {
    if (!running?.media) return
    laidOn().append(player)
    player.hidden = false
    anchor()
    const title = TITLES(running.egg), source = SOURCES[running.egg]
    link.firstElementChild!.textContent = title
    if (source) { link.href = `https://www.youtube.com/watch?v=${source}`; link.setAttribute('aria-label', `${title}: the original on YouTube (opens a new tab)`) }
    else { link.removeAttribute('href'); link.removeAttribute('aria-label') }
    const muted = running.media.muted
    // (The sound held back by the browser: the key is cobalt, the tap it wants.)
    keyed(muteKey, muted ? 'Unmute' : 'Mute', muted ? 'muted' : 'sound', running.blocked ? 'main' : '')
    keyed(pauseKey, running.paused ? 'Play' : 'Pause', running.paused ? 'play' : 'pause', 'main')
    folded()
    where()
  }
  const hidePlayer = () => { if (player.contains(document.activeElement)) (document.activeElement as HTMLElement).blur(); player.hidden = true }
  /**
   * What of the view the video stays off (videoRect): the player's strip, top or bottom as it stands, with a gap. Its
   * box as laid, so hidden to its key it keeps the strip: the picture does not jump under the hand.
   */
  const strip = (): Clear | undefined => {
    if (player.hidden || !player.isConnected) return undefined
    const v = page.canvas.getBoundingClientRect(), p = player.getBoundingClientRect()
    if (!v.height || !p.height) return undefined
    // (Hidden, the row as it was open: its key stays at the end the row stands by, the top or the bottom.)
    if (!tucked) openTall = p.height
    const tall = tucked && openTall ? openTall : p.height, GAP = 8
    if (p.top < v.top + v.height / 2) {
      // In the first view the banner's plane flies just over the top of a video with a sky (boards.ts `above`): a lane
      // for it under the row, its 3% margin, its cloth and the room round its target.
      const lane = document.documentElement.classList.contains('first') && running?.picture?.sky ? 0.03 * v.height + 56 : 0
      return { top: (p.top + tall + GAP + lane - v.top) / v.height, bottom: 1 }
    }
    return { top: 0, bottom: (p.bottom - tall - GAP - v.top) / v.height }
  }
  /** How tall the row is open (it is measured so while it is, and kept while it is hidden). */
  let openTall = 0
  muteKey.addEventListener('click', () => {
    if (!running?.media) return
    const m = running.media
    m.muted = !m.muted
    running.blocked = false
    // An unmute is a fresh tap: a video that started muted gets its sound here.
    if (!m.muted && m.paused && m.src && !running.paused && !running.waiting) run(running)
    showPlayer()
    tell(m.muted ? 'Muted.' : 'Sound on.')
  })
  pauseKey.addEventListener('click', () => {
    const r = running
    if (!r?.media) return
    r.paused = !r.paused
    if (r.paused) r.media.pause()
    // (Played on before the screen was up: it plays once it is, as it would have.)
    else if (!r.waiting) run(r)
    showPlayer()
    tell(r.paused ? 'Paused.' : 'Playing.')
  })
  // Hidden: the row folds into its last key, where that key was, to watch with only that key over the picture; the
  // key brings the row back. It stays hidden for the next egg too, until the key is tapped (or the sound is held back,
  // when the row comes back for its Unmute).
  let tucked = false
  const tuck = (on: boolean) => {
    if (tucked === on) return
    tucked = on
    player.classList.toggle('tucked', on)
    folded()
  }
  /** The hide key, and hidden the key that is all of it: cobalt while the video plays (something is on), plain while it is paused. */
  const folded = () => keyed(tuckKey, tucked ? 'Show the player' : 'Hide the player', tucked ? 'playing' : 'minimize', tucked && !running?.paused ? 'main' : '')
  /** Which end of the row the hide key is at: the end the row stands by (CSS), so that hidden, the key stays where it was. */
  const anchor = () => {
    if (tucked || player.hidden) return
    const r = player.getBoundingClientRect(), left = r.left + r.width / 2 < innerWidth / 2 - 1
    if (player.dataset.side !== (left ? 'left' : 'right')) player.dataset.side = left ? 'left' : 'right'
  }
  // (Again for the screen turned, and for the page gone in from the first view: its place is by the page's classes.)
  addEventListener('resize', anchor)
  new MutationObserver(anchor).observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
  tuckKey.addEventListener('click', () => tuck(!tucked))
  nextKey.addEventListener('click', () => act('meme'))
  stopKey.addEventListener('click', () => stop())
  fader.addEventListener('pointerdown', () => { scrubbing = true })
  addEventListener('pointerup', () => { if (!scrubbing) return; scrubbing = false; where() })
  fader.addEventListener('input', () => {
    const m = running?.media
    if (!m || !m.src) return
    m.currentTime = Number(fader.value)
    where()
  })
  for (const type of ['timeupdate', 'durationchange', 'loadedmetadata', 'seeked']) element().addEventListener(type, () => { if (!player.hidden) where() })
  // Out of sight, the sound goes with the tab, as the city's own does.
  document.addEventListener('visibilitychange', () => {
    const m = running?.media
    if (!m || !m.src || running!.held || running!.waiting || running!.paused) return
    if (document.hidden) m.pause(); else run(running!)
  })

  // ── The moon, the shield and the barrel roll ──
  /** Whether the moon has been asked up (and not undone since): `night` once the hour has come to night for it. */
  let moonlit: boolean | 'night' = false
  const moonUp = (by = 'Look up at it, and shoot it.') => {
    keep()
    glideTo(23.5)
    page.sky.set('clear')
    moonlit = true
    say(`The moon is up. ${by}`)
  }
  /** Whether a look along `forward` meets the moon's disc, as the sky draws it (march.ts sky()). */
  const atMoon = (forward: readonly number[]) => {
    if (march.day >= 1) return false
    const [x, y, z] = march.sun.s, r = (1 + moon) * (1 + moon)
    const cos = (forward[0] * x + forward[1] * y + forward[2] * z) / Math.hypot(...forward) / Math.hypot(x, y, z)
    // Its edge is at 1 - 0.0002 r; a shot within twice its radius counts.
    return cos > 1 - 0.0002 * r * 4
  }
  const shootMoon = () => {
    moon = (moon + 1) % MOONS.length
    march.screen.moon = MOONS[moon]
    say(`Moon size ${moon + 1} of 3.`)
  }
  /**
   * A barrel roll: how far through it is (0 to 1), how far the eye has been turned by it (radians) and where it left
   * the eye last. Turned by steps, so that whoever sets the eye meanwhile is not undone. In the first view it starts
   * again from nothing while someone else sets the eye: an EXPLORE asked once, leaning back, sets it outright every
   * frame, which undoes whatever of the turn was done.
   */
  let rolling: { t: number; turned: number; left: number } | null = null
  /** In the first view, the roll done at once: a press or a key while it turns (an EXPLORE asked then leans from a whole eye), or the picture framed again (a key held down in the realm is not one). */
  const rolled = (e: Event) => { if (!rolling || !page.still() || (e as KeyboardEvent).repeat) return; page.pose.yaw += Math.PI * 2 - rolling.turned; rolling = null; found.spin = 0 }
  for (const type of ['pointerdown', 'keydown', 'resize']) addEventListener(type, rolled, { capture: true })
  // Over every other mode a lane puts down (a tool's use goes to the top first): the moon takes a shot at it, and
  // under IDDQD no tool breaks anything.
  // E beside a thing of the city's that starts an egg uses it (a key held down is one use, not one each repeat). Pushed
  // once, not as one comes near: a mode put on or taken off lets go of every key held, and a walk past was a stop.
  page.controls.push({
    name: 'eggs',
    key: (code, e) => code === 'KeyE' && !e.repeat && found.key(),
    use: () => {
      if (atMoon(page.view().forward)) { shootMoon(); return true }
      if (found.aimed()) return true
      if (shield) { say('IDDQD: the city cannot be broken. Say iddqd again to let it.', 3000); return true }
    },
  })

  // ── What a phrase does ──
  let misses = 0
  const act = (action: string) => {
    switch (action) {
      case 'matrix': return void enter()
      case 'red': return running?.egg === 'matrix' ? say('You stay in Wonderland. Esc, or “blue pill”, to leave.') : void enter()
      case 'unplug': return running?.egg === 'matrix' ? stop() : say('Blue pill: you are already in the park.')
      case 'rickroll': return void play('rickroll')
      case 'apple': return void play('apple')
      case 'stop': return running ? stop() : say('Nothing is playing.')
      case 'god':
        shield = !shield
        if (!running) banner(shield ? 'God mode' : null)
        return say(shield ? 'IDDQD on. The city cannot be broken.' : 'IDDQD off. The city can break again.')
      case 'moon': return moonUp()
      case 'roll':
        // (With motion reduced the eye stays, and the banner answers: in the first view it is all there is to see.)
        if (matchMedia('(prefers-reduced-motion: reduce)').matches) { briefly('Rolled, in spirit', 4000); return say('Barrel roll (with motion reduced, in spirit).') }
        if (rolling) page.pose.yaw += Math.PI * 2 - rolling.turned
        rolling = { t: 0, turned: 0, left: page.pose.yaw }
        return say('Barrel roll.')
      case 'lives':
        briefly('+30 lives', 8000)
        return say('Tow banner: +30 lives')
      case 'help': return hint()
      case 'meme': {
        // Any clip but the one on now, or the last one played.
        const others = MEMES.filter((m) => m.id !== running?.egg && m.id !== lastMeme)
        // (The memes not come, or not there: the oldest meme of all.)
        return void play(others.length ? others[Math.floor(Math.random() * others.length)].id : 'rickroll')
      }
      default: if (action in VIDEOS) return void play(action)
    }
  }
  const hint = () => {
    const text = `Try: wake up · ${hasMedia ? 'bad apple · meme · ' : ''}iddqd · moon. ${page.makes ? '/' : 'Enter or /'} shows more.`
    briefly('Try: wake up · moon', 7000)
    say(text, 7000)
  }
  /** Something said to the city on the line. */
  const heard = (text: string, again = false): void => {
    const said = words(text)
    if (!said) return
    const action = known.get(said)
    if (action) { misses = 0; return act(action) }
    // (Said before the memes had come: heard again once they have.)
    if (!MEMES.length && !again) return void memesCame.then(() => heard(text, true))
    // The start of a phrase, or a word of one: what the line offered first for it.
    const guess = said.length >= 3 ? ideas(said, 1)[0] : undefined
    if (guess) { misses = 0; return act(guess) }
    misses++
    if (misses >= 2) return hint()
    briefly(`${text.trim().slice(0, 24)}? Not here.`, 5000)
    say('The city didn’t catch that.', 3000)
  }

  // ── The line: Enter or / opens it; what is typed shows on the banner as it is typed ──
  // Under it, what there is to say (nobody has to know): four ideas when it opens, a different four each time, and as
  // letters are typed, what they could be the start of, each by the name it goes by. A tap or a click says it, and
  // Enter says the first where what was typed is no phrase of its own.
  const line = document.createElement('div')
  line.className = 'vx-card egg-line'
  line.hidden = true
  line.setAttribute('role', 'group')
  line.setAttribute('aria-label', 'Say something to the city')
  line.style.cssText = 'position:absolute;left:50%;bottom:calc(max(30px,env(safe-area-inset-bottom)) + 64px);transform:translateX(-50%);display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding:6px 10px;pointer-events:auto;font:600 13px/1 var(--vx-font,system-ui);max-inline-size:calc(100vw - 32px);box-sizing:border-box'
  line.innerHTML = '<span aria-hidden="true">Say</span><input type="text" autocomplete="off" autocapitalize="off" spellcheck="false" maxlength="60" aria-label="Say something to the city" aria-describedby="egg-ideas-label" style="flex:1 1 18ch;min-inline-size:0;font:400 15px/1.2 var(--vx-mono,ui-monospace,monospace);inline-size:24ch;background:transparent;border:0;outline:0;color:inherit"><div class="egg-ideas" role="group" aria-labelledby="egg-ideas-label" style="flex:1 0 100%;display:flex;flex-wrap:wrap;gap:6px;align-items:center"><span id="egg-ideas-label" style="font-weight:400;opacity:0.72">Try</span></div>'
  realm.append(line)
  const field = line.querySelector('input')!, ideasRow = line.querySelector<HTMLElement>('.egg-ideas')!
  /** What each egg goes by on the line's ideas (the memes by their titles); what has no name here is not offered. */
  const NAMES: Record<string, string> = { matrix: 'Wake up, Neo', rickroll: 'Rickroll', apple: 'Bad Apple!!', moon: 'Moon', roll: 'Barrel roll', god: 'IDDQD', meme: 'Surprise me' }
  /** (A key on a phone holds about 18 letters: a longer title goes by the longest of its phrases that fits, “Nature documentary”.) */
  const named = (action: string) => {
    if (NAMES[action]) return NAMES[action]
    const m = MEMES.find((m) => m.id === action)
    if (!m) return null
    if (m.title.length <= 18) return m.title
    const fits = m.says.filter((p) => p.length <= 18).sort((a, b) => b.length - a.length)[0] ?? m.says[0]
    return fits[0].toUpperCase() + fits.slice(1)
  }
  /** What to offer for what has been typed: on nothing, “Surprise me” and three at random; else what its words could start, the phrases they begin first. */
  let offered: string[] = []
  const ideas = (typed: string, n = 4): string[] => {
    if (!typed) {
      // (Short ones, two to a row on a phone.)
      const pool = [...new Set([...known.values()])].filter((a) => a !== 'meme' && (named(a)?.length ?? 99) <= 13)
      for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]] }
      return hasMedia ? ['meme', ...pool.slice(0, n - 1)] : pool.slice(0, n)
    }
    const found: { action: string; rank: number }[] = []
    for (const [phrase, action] of known) {
      if (!named(action)) continue
      const rank = phrase.startsWith(typed) ? 0 : phrase.includes(` ${typed}`) ? 1 : -1
      if (rank >= 0) found.push({ action, rank: rank * 100 + phrase.length })
    }
    found.sort((a, b) => a.rank - b.rank)
    return [...new Set(found.map((f) => f.action))].slice(0, n)
  }
  const offer = () => {
    const typed = words(field.value)
    // (On nothing, the same four while the line is open: they do not shuffle under the hand.)
    if (typed || !offered.length) offered = ideas(typed)
    ideasRow.querySelectorAll('button').forEach((b) => b.remove())
    for (const action of offered) {
      const b = document.createElement('button')
      b.type = 'button'
      b.className = 'vx-button egg-idea'
      b.textContent = named(action)!
      b.dataset.action = action
      ideasRow.append(b)
    }
    ideasRow.hidden = !offered.length
  }
  ideasRow.addEventListener('pointerdown', (e) => { if ((e.target as Element).closest('button')) e.preventDefault() })
  ideasRow.addEventListener('click', (e) => {
    const b = (e.target as Element).closest<HTMLButtonElement>('button')
    if (!b?.dataset.action) return
    close()
    misses = 0
    act(b.dataset.action)
  })
  let typing: (() => void) | null = null
  const echo = () => { brief++; show(`> ${field.value.slice(-24)}_`) }
  const open = () => {
    if (typing) return
    typing = page.controls.push({ name: 'saying', solid: true, text: true })
    // (In the first view the realm's controls are hidden, and the line with them: it stands with the first view's keys then.)
    laidOn().append(line)
    line.hidden = false
    field.value = ''
    offered = []
    offer()
    field.focus()
    echo()
  }
  const close = () => {
    typing?.()
    typing = null
    line.hidden = true
    field.blur()
    show(onBanner)
  }
  field.addEventListener('input', () => { echo(); offer() })
  field.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); const text = field.value; close(); heard(text) }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close() }
  })
  // Gone from the line and its ideas (a tap elsewhere, Tab past them), it closes.
  line.addEventListener('focusout', (e) => { if (typing && !line.contains(e.relatedTarget as Node | null)) close() })
  // Where nothing is made from words (local.ts) the ask bar's Enter is the line's. Where things are (`makes`), Enter is
  // the ask bar's still: whoever registers a key last has it (input.ts `always`), and this comes after the bar.
  if (!page.makes) page.controls.always('Enter', (e) => { if (e.metaKey || e.ctrlKey) return; e.preventDefault(); open(); return true })
  page.controls.always('Slash', (e) => { e.preventDefault(); open(); return true })

  // ── Keys that are not on the line: Esc ends the eggs, and the Konami code (its B and A are not the world's) ──
  let konami = 0
  addEventListener('keydown', (e) => {
    if (typing || e.repeat || (e.target instanceof HTMLElement && e.target.closest('input,textarea,select,[contenteditable]'))) return
    if (e.key === 'Escape') {
      if (running || shield || moon || saying) { e.preventDefault(); undo() }
      return
    }
    if (e.code === KONAMI[konami]) {
      konami++
      // The B and the A of the code are the code's, not the world's (B is on foot or flying).
      if (konami > 8) { e.preventDefault(); e.stopImmediatePropagation() }
      if (konami === KONAMI.length) { konami = 0; act('lives') }
    } else konami = e.code === 'ArrowUp' ? (konami === 2 ? 2 : 1) : 0
  }, { capture: true })

  /** Every egg undone: what runs stops, the shield drops, the moon is its own size, the sky as it was. */
  const undo = (quiet = false) => {
    const any = running || shield || moon || moonlit || saying
    stop(true)
    shield = false
    moon = 0
    moonlit = false
    march.screen.moon = 0
    banner(null)
    undress()
    if (any && !quiet) say('Back in the park.')
  }
  page.onReset(() => { undo(true); found.forget() })

  // ── The things in the city that start them, and what each says it does ──
  const touch = matchMedia('(pointer: coarse)')
  /** Whether a meme is on the windows (the TV is on). */
  const memeOn = () => !!running && MEMES.some((m) => m.id === running!.egg)
  const WORDS: Record<ThingId, () => string> = {
    payphone: () => (running?.egg === 'matrix' ? 'Hang up the phone' : 'Answer the ringing phone'),
    jukebox: () => (running?.egg === 'rickroll' ? 'Stop the jukebox' : 'Play the jukebox'),
    cart: () => (running?.egg === 'apple' ? 'Put the black apple back' : 'Take the black apple'),
    arcade: () => 'Play the arcade game',
    viewer: () => (moonlit ? 'Look closer at the moon' : 'Look through the viewer'),
    plane: () => 'Spin the toy plane',
    shield: () => (shield ? 'Let go of the golden shield' : 'Touch the golden shield'),
    tv: () => (memeOn() ? 'Change the channel' : 'Turn on the TV'),
  }
  const USE: Record<ThingId, () => void> = {
    payphone: () => act(running?.egg === 'matrix' ? 'unplug' : 'matrix'),
    jukebox: () => act('rickroll'),
    cart: () => (running?.egg === 'apple' ? stop() : act('apple')),
    arcade: () => act('lives'),
    viewer: () => (moonlit ? shootMoon() : moonUp('Use the viewer again to bring it closer.')),
    plane: () => act('roll'),
    shield: () => act('god'),
    tv: () => act('meme'),
  }
  const found = things({
    hasMedia,
    pieces: page.pieces, hud: page.hud, input: page.controls, view: page.view, feet: page.feet, ground: page.ground,
    // (What a thing finds, it finds as it is used: a window in the first view that waited on it is unlocked.)
    touch: () => touch.matches, words: (id) => WORDS[id](), use: (id) => { USE[id](); if (locks?.found(id)) say('Something new is on in a window of the view. Go back to the view to watch it.', 7000) },
    // The payphone rings (its sign on and off) until its call is taken; the cart's black apple is gone while Bad Apple!! plays.
    look: (id, t) => (id === 'payphone' ? (running?.egg !== 'matrix' && Math.floor(t * 2.5) % 2 ? 1 : 0) : id === 'cart' ? (running?.egg === 'apple' ? 1 : 0) : id === 'tv' ? (memeOn() ? 1 : 0) : 0),
  })

  // ── The city's windows that hold an egg (eggs-lockers.ts), in the first view ──
  /** What a locker's egg is called once it has been seen (a meme by its title). */
  const LOCKER_TITLES: Record<string, string> = { matrix: 'The Matrix', rickroll: 'Never Gonna Give You Up', apple: 'Bad Apple!!', roll: 'Do a barrel roll', lives: '+30 lives' }
  // (Not without a far model, `?farreach=0`: nothing would light their windows, and the words would be over dark glass.)
  const firstLayer = document.getElementById('first')
  const locks = firstLayer && page.far.listing ? lockers({
    canvas: page.canvas, view: page.view, still: page.still, far: page.far, layer: firstLayer, corner: firstLayer.querySelector('.corner'), base: page.base,
    title: (egg) => LOCKER_TITLES[egg] ?? MEMES.find((m) => m.id === egg)?.title ?? 'Something',
    // (A meme is known once sf/memes.json has come: one opened before it had plays when it comes.)
    open: (egg) => (LOCKER_TITLES[egg] || egg in VIDEOS ? act(egg) : void memesCame.then(() => act(egg))),
  }) : null
  void memesCame.then(() => locks?.relabel())

  // ── What starts them from the first view, before anyone has gone in (eggs-first.ts): the banner's lines ──
  /** Whether anything of the eggs' is on: what a tap on the banner ends. */
  const on = () => !!(running || shield || moon || moonlit || saying)
  /** The meme the banner said last in the first view. */
  let lastLine: string | null = null
  const TAPS: Record<Spot, (line: string | null) => void> = {
    // While an egg is on, the banner ends it (Unmute is the player's: a tap here stops). Its line starts its egg; the site's name, a barrel roll.
    banner: (line) => (on() ? undo() : act(line ?? 'roll')),
  }
  const taps = firstTaps({
    hasMedia,
    canvas: page.canvas, still: page.still, calm: page.calm, plane: page.plane, signs: page.signs,
    quiet: () => !on() && !typing,
    // A meme whose title is no longer than the site's name (a line is not: first.ts), not the last one said.
    more: () => {
      const short = MEMES.filter((m) => m.title.length <= 13 && m.id !== lastLine)
      const m = short[Math.floor(Math.random() * short.length)]
      if (!m) return null
      lastLine = m.id
      return { text: m.title, egg: m.id }
    },
    tap: (spot, line) => TAPS[spot](line),
    lockers: locks ?? undefined,
  })

  // ── Every frame: the screen comes up and goes down, its picture is drawn, the light comes home, the hour is watched ──
  let flips: number[] = [], wasDark: boolean | null = null, darkened = false
  page.watch((gap) => {
    const dt = Math.min(gap, 100) / 1000
    found.frame(performance.now() / 1000)
    taps.frame(dt)
    locks?.frame(dt)
    // The banner's next line, after its plane has been in the picture for 8 s (it flies in from the edge, cloth last).
    if (nextLine && onBanner !== nextLine.after) nextLine = null
    else if (nextLine && !typing && page.planeSeen() && (nextLine.seen += dt) > 8) { const next = nextLine.next; nextLine = null; banner(next) }
    // The boards' own light is off while an egg has the windows, from its start to its end.
    if (!!running !== darkened) { darkened = !!running; page.darkBoards(darkened) }
    const up = running?.picture ? 1 : 0
    // Up over a second, down over two thirds of one.
    if (up > march.screen.up) march.screen.up = Math.min(1, march.screen.up + dt)
    else if (up < march.screen.up) march.screen.up = Math.max(0, march.screen.up - dt * 1.5)
    if (running?.waiting && march.screen.up >= 0.9) { running.waiting = false; if (!running.paused) run(running) }
    // A picture going down keeps its last frame and sky setting until screen.up reaches 0.
    if (running?.picture) {
      running.picture.draw(device, march.screen.texture, (performance.now() - running.started) / 1000)
      march.screen.sky = running.picture.sky
      march.screen.rect[0] = running.picture.rect[0]
      march.screen.rect[1] = running.picture.rect[1]
      march.screen.rect[2] = running.picture.rect[2]
      march.screen.rect[3] = running.picture.rect[3]
    }
    if (march.screen.up === 0 && fading) { fading.dispose(); fading = null; march.screen.sky = false }
    // Fly the tow plane and banner above the sky-gap drone swarm while it is active.
    const plane = page.plane()
    if (plane) plane.above = march.screen.sky && march.screen.up > 0 ? march.screen.rect[1] : null
    if (pending !== null) { page.sky.glide(pending); pending = null }
    // The hour goes home once the fog an egg left has thinned, or after four seconds of waiting for it.
    if (leaving && (march.fog < 0.12 || performance.now() - leaving.since > 4000)) { const hour = leaving.hour; leaving = null; home(hour) }
    if (goingHome && Math.abs((page.hour() ?? OWN_HOUR) - OWN_HOUR) < 0.02) { goingHome = false; page.ownLight() }
    // (The sky keeps an hour as `h % 24`: 13.45 comes back 13.450000000000003.)
    else if (goingHome && Math.abs((page.sky.hour ?? OWN_HOUR) - OWN_HOUR) > 0.02) goingHome = false
    if (rolling && page.still() && Math.abs(page.pose.yaw - rolling.left) > 1e-9) Object.assign(rolling, { t: 0, turned: 0, left: page.pose.yaw })
    else if (rolling) {
      rolling.t += dt / 0.85
      const s = Math.min(1, rolling.t), ease = s * s * (3 - 2 * s)
      page.pose.yaw += ease * Math.PI * 2 - rolling.turned
      rolling.turned = ease * Math.PI * 2
      rolling.left = page.pose.yaw
      found.spin = ease * Math.PI * 2
      if (s >= 1) { rolling = null; found.spin = 0 }
    }
    // Four swings of the hour across dusk in four seconds: Bad Apple!!, black and white and black and white.
    const h = page.hour(), dark = h !== null && (h < 6.5 || h >= 18.5), now = performance.now()
    // (The moon asked up is down again once the hour, having come to night, is day again: the viewer then shows it anew.)
    if (moonlit === 'night' && !dark) moonlit = false
    else if (moonlit && dark) moonlit = 'night'
    if (wasDark !== null && dark !== wasDark && !running) {
      flips = [...flips.filter((t) => now - t < 4000), now]
      if (flips.length >= 4) { flips = []; void play('apple') }
    }
    wasDark = dark
  })

  const status = document.createElement('p')
  status.className = 'egg-status'
  status.setAttribute('role', 'status')
  status.style.cssText = 'position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap'
  realm.append(status)

  return {
    /** For the checks: what is going on. */
    get state() { return { memesPlayed, paused: !!running?.paused, running: running?.egg ?? null, up: march.screen.up, windowEffect: getWindowEffect(), shield, moon, typing: !!typing, muted: running?.media?.muted ?? null, blocked: running?.blocked ?? false, playing: !!running?.media && !running.media.paused, time: running?.media?.currentTime ?? 0, sound: (running?.media as { webkitAudioDecodedByteCount?: number } | undefined)?.webkitAudioDecodedByteCount ?? 0 } },
    /** Resumes the equalizer's audio tap inside a user gesture (e.g. toggling Window glow -> EQ in Settings). */
    wakeAudio,
    say: heard,
    /** Opens the line, as Enter or the slash does in the realm (main.ts asks for it in the first view, where they are not heard). */
    open,
    undo,
    /** The sky is someone else's now (a Sky key, modes.ts): what was kept to give back when an egg ends is forgotten; the egg's own look (its mood) still ends with it. */
    letSkyGo() { before = null; leaving = null; pending = null; goingHome = false },
    /** For the checks: each meme, a phrase that starts it and its file. */
    get memes() { return MEMES.map((m) => ({ id: m.id, title: m.title, says: m.says[0], file: VIDEOS[m.id].file, youtube: m.youtube })) },
    /** Holds a playing video at a time, s (null: plays on), as a pause would: for the checks, which compare the windows with a known frame. */
    hold(at: number | null) {
      const r = running
      if (!r?.media) return
      if (at === null) { r.held = false; run(r); return }
      r.held = true
      r.media.pause()
      r.media.currentTime = at
    },
    /** For the checks: how many bytes of the video's sound were decoded (Chrome), and the picture's light where it is drawn. */
    get media() { return running?.media ?? null },
    /** For the checks: where the video stands on the page now (client px), as its picture last drew it on the windows and the sky, or null with none. */
    get screen() {
      const m = running?.media, r = running?.picture?.rect
      if (!m?.videoWidth || !r) return null
      const v = page.canvas.getBoundingClientRect()
      return { left: v.left + r[0] * v.width, top: v.top + r[1] * v.height, right: v.left + r[2] * v.width, bottom: v.top + r[3] * v.height }
    },
    /** The things that start the eggs: where each is, and which is offered now. */
    things: found,
    /** What starts them from the first view (eggs-first.ts): where each spot is, and the banner's line. */
    first: taps,
    /** The windows that hold an egg (eggs-lockers.ts). */
    lockers: locks,
    atMoon,
  }
}
