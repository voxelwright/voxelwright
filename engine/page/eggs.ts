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
import type { Skies, Weather } from './weather.ts'
import type { Signs } from './signs.ts'
import type { Picture } from './eggs-pictures.ts'
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
interface Video { file: string; title: string; outside: Pane; contrast: number; start: string; end: string }
type Egg = string
const KONAMI = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'KeyB', 'KeyA']
/** The moon's sizes against its own (the site's three radii, 0.017, 0.028 and 0.044 of the view). */
const MOONS = [0, 0.65, 1.6]
/** The hour whose sun is nearest the realm's own (main.ts, sf/realm.json `air.sun`): the light glides there and is then the realm's own again. */
const OWN_HOUR = 13.45

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
  // ── The memes (sf/memes.json, small, fetched as the eggs start): their phrases, videos and looks joined to the eggs' own ──
  let MEMES: readonly Meme[] = [], known: ReadonlyMap<string, string> = PHRASES
  const memesCame = fetch(new URL('eggs/memes.json', page.base)).then((r) => { if (!r.ok) throw Error(`memes.json: ${r.status}`); return r.json() as Promise<Meme[]> }).then((list) => {
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
  const say = (text: string, ms = 5000) => { page.notice(text, ms); if (status.parentElement !== laidOn()) laidOn().append(status); status.textContent = text }

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
    const m = element()
    m.muted = false
    m.loop = true
    void m.play().catch(() => {})
    const started = ++clock
    const current: NonNullable<typeof running> = { egg: 'matrix', picture: null, started: performance.now(), media: m }
    running = current
    page.hush(true)
    showPlayer()
    // The rain does not wait for the music: it comes as soon as its code has, and the music when its file has.
    const music = fetchVideo(MUSIC.file)
    music.catch(() => {})
    const { codeRain } = await import('./eggs-pictures.ts')
    if (running !== current || started !== clock) return
    current.picture = codeRain()
    current.started = performance.now()
    dress('matrix')
    // Two lines, one after the other (the banner has room for one): the second once the first has been in sight a while.
    banner('The Matrix has you')
    nextLine = { after: 'The Matrix has you', next: 'Red pill or blue pill?', seen: 0 }
    say('Wake up, Neo… The windows are code now. Esc, or say “blue pill”, to leave.')
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
  const run = (current: NonNullable<typeof running>) => {
    const m = current.media!
    void m.play().catch((e: Error) => {
      if (running !== current || e.name !== 'NotAllowedError') return
      // The browser wants a fresh tap for sound: the video plays muted, and Unmute is that tap.
      current.blocked = true
      m.muted = true
      void m.play().catch(() => {})
      showPlayer()
      say('Playing muted: Unmute on the player brings the sound.')
    })
  }
  /** A tap again while its sound was held back: the sound, now. */
  const unblock = (current: NonNullable<typeof running>) => {
    current.blocked = false
    current.media!.muted = false
    run(current)
    showPlayer()
    say('Sound on.')
  }
  /** The meme played last, which “meme” does not play again straight away. */
  let lastMeme: string | null = null, memesPlayed = 0
  const play = async (egg: Egg) => {
    const v = VIDEOS[egg]
    if (egg !== 'rickroll' && egg !== 'apple') { lastMeme = egg; memesPlayed++ }
    if (running?.egg === egg) return running.blocked ? unblock(running) : stop()
    stop(true, false, true)
    const m = element()
    m.muted = false
    m.loop = false
    // Started inside the gesture before it has a file: some browsers let an element play sound later only if it was
    // first started from a tap.
    void m.play().catch(() => {})
    const started = ++clock
    const current: NonNullable<typeof running> = { egg, picture: null, started: performance.now(), media: m }
    running = current
    dress(egg)
    page.hush(true)
    showPlayer()
    banner(`Now playing: ${v.title}`)
    say(`Tuning in: ${v.title}…`)
    try {
      const [{ videoPicture }, url] = await Promise.all([import('./eggs-pictures.ts'), fetchVideo(v.file)])
      if (running !== current || started !== clock) return
      current.picture = videoPicture(m, page.aspect, { outside: v.outside, contrast: v.contrast })
      m.src = url
      // It plays once the windows are its screen (every frame below): a 5 s clip started as the screen comes up was
      // half over before it could be seen. Until then its first frame stands on the windows. (The play started in the
      // gesture, with no file yet, would play it as soon as it came: held here. The gesture has let the element play.)
      m.pause()
      current.waiting = true
      say(`${v.start} Esc, or Stop on the player, ends it.`)
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
      else say(ended ? VIDEOS[was.egg].end : `${VIDEOS[was.egg].title} stopped.`)
    }
  }

  // ── The player: what is playing, a link to where it came from, and a control for each thing the hand does to a
  // video (DESIGN.md): a key to pause it and to play it on, a fader for where in it the picture is (set by where it
  // stands, as a scrubber is), a key for its sound, one for another meme, and one to stop it ──
  const realm = page.ui
  /** Where what the eggs lay over the picture goes: the realm's controls, or in the first view, where they are hidden, beside the first view's own keys. */
  const laidOn = () => (document.documentElement.classList.contains('first') ? document.getElementById('first') ?? realm : realm)
  const player = document.createElement('div')
  player.className = 'vx-card egg-player'
  player.hidden = true
  player.setAttribute('role', 'group')
  player.setAttribute('aria-label', 'Now playing')
  // (The city's cues stand clear of it, hud.ts: on a phone it is over the middle of the picture.)
  player.dataset.hudClear = ''
  // Where it stands: under the keys in the top corners. On a desk, 56 px down. By touch, held upright: in the first view
  // under the credits and settings keys (first.ts), in the realm under the Back key, the tool key and the street's name
  // (play-hud.ts); held wide, gone in, between the corners' keys at the top. Never wider than the screen: the title
  // is cut short, the keys are not. (By the page's state, not by what holds it: started in the first view it stays in #first.)
  const placed = document.createElement('style')
  placed.textContent = /* css */ `
    .egg-player { position: absolute; display: grid; gap: 6px; padding: 8px 10px 10px; pointer-events: auto; box-sizing: border-box;
      top: 56px; left: max(16px, env(safe-area-inset-left)); inline-size: min(340px, calc(100vw - 2 * max(16px, env(safe-area-inset-left)))); font: 600 13px/1.2 var(--vx-font, system-ui); }
    .egg-player .top { display: flex; align-items: center; gap: 6px; min-inline-size: 0; }
    .egg-player .top .stop { flex: none; }
    .egg-player .now { flex: none; font-weight: 400; opacity: 0.72; }
    .egg-player .title { flex: 0 1 auto; min-inline-size: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--vx-link, inherit); text-decoration: underline; text-underline-offset: 2px; text-decoration-thickness: 1px; }
    .egg-player .title::after { content: " \\2197\\FE0E"; }
    .egg-player .title:focus-visible { outline: 2px solid var(--vx-focus, currentColor); outline-offset: 2px; border-radius: 2px; }
    .egg-player .seek { display: flex; align-items: center; gap: 8px; font: 400 12px/1 var(--vx-mono, ui-monospace, monospace); font-variant-numeric: tabular-nums; }
    .egg-player .seek .vx-slider { flex: 1 1 auto; min-inline-size: 0; display: flex; }
    .egg-player .seek input { inline-size: 100%; margin: 0; accent-color: var(--vx-link, auto); }
    .egg-player .keys { display: flex; gap: 8px; }
    .egg-player .keys button { flex: 1 1 0; min-inline-size: 0; justify-content: center; }
    .egg-player .seek output { min-inline-size: 4ch; }
    .egg-player .seek .of { text-align: end; }
    @media (pointer: coarse) and (max-aspect-ratio: 1/1) {
      html.first .egg-player { top: calc(max(20px, calc(env(safe-area-inset-top) + 8px)) + 56px); }
      html:not(.first) .egg-player { top: calc(env(safe-area-inset-top, 0px) + 164px); }
      .egg-player .seek input { block-size: 44px; }
    }
    @media (pointer: coarse) and (min-aspect-ratio: 1/1) {
      html:not(.first) .egg-player { top: max(12px, env(safe-area-inset-top)); left: 0; right: 0; margin-inline: auto; inline-size: min(420px, 100vw - 240px); }
    }
    .egg-player { transition: transform 320ms cubic-bezier(0.32, 0.72, 0, 1); }
    .egg-player.tucked { transform: translateX(calc(env(safe-area-inset-left, 0px) - var(--tuck, 100vw))); }
    .egg-player .tuck { flex: none; margin-inline-start: auto; padding-inline: 12px; font-size: 20px; }
    .egg-player .tab { position: absolute; left: calc(100% + 16px); font-size: 22px; top: 50%; translate: 0 -50%; min-inline-size: 36px; min-block-size: 56px; padding: 0;
      opacity: 0; visibility: hidden; transition: opacity 160ms ease-out, visibility 0s 160ms; }
    .egg-player.tucked .tab { opacity: 1; visibility: visible; transition: opacity 160ms ease-out 120ms; }
    @media (prefers-reduced-motion: reduce) { .egg-player, .egg-player .tab { transition: none; } }`
  document.head.append(placed)
  // (Stop beside the title, as a window's close is: the kit's keys are wide, and four in a row are wider than a phone.)
  player.innerHTML = `<div class="top"><span class="now">Now playing</span><a class="title" target="_blank" rel="noopener noreferrer"></a><button class="vx-button tuck" type="button" aria-label="Tuck the player away" title="Tuck the player away">‹</button><button class="vx-button stop" type="button" data-vx-kind="danger">Stop</button></div>
    <div class="seek"><output class="at">0:00</output><span class="vx-slider"><input type="range" min="0" max="1" step="0.05" value="0" aria-label="Where in it"></span><output class="of">0:00</output></div>
    <div class="keys"><button class="vx-button pause" type="button">Pause</button><button class="vx-button mute" type="button" aria-pressed="false">Mute</button><button class="vx-button next" type="button">Next</button></div>
    <button class="vx-button tab" type="button" aria-label="Bring the player back" title="Bring the player back" inert>›</button>`
  realm.append(player)
  const $p = <T extends Element>(q: string) => player.querySelector<T>(q)!
  const muteKey = $p<HTMLButtonElement>('.mute'), stopKey = $p<HTMLButtonElement>('.stop'), pauseKey = $p<HTMLButtonElement>('.pause'), nextKey = $p<HTMLButtonElement>('.next')
  const link = $p<HTMLAnchorElement>('.title'), fader = $p<HTMLInputElement>('.seek input'), at = $p<HTMLOutputElement>('.at'), of = $p<HTMLOutputElement>('.of')
  const mmss = (t: number) => (Number.isFinite(t) ? `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}` : '0:00')
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
    if (tucked) measure()
    const title = TITLES(running.egg), source = SOURCES[running.egg]
    link.textContent = title
    if (source) { link.href = `https://www.youtube.com/watch?v=${source}`; link.title = `${title}: the original on YouTube (opens a new tab)` }
    else { link.removeAttribute('href'); link.removeAttribute('title') }
    const muted = running.media.muted
    muteKey.textContent = muted ? 'Unmute' : 'Mute'
    muteKey.setAttribute('aria-pressed', String(muted))
    pauseKey.textContent = running.paused ? 'Play' : 'Pause'
    where()
  }
  const hidePlayer = () => { if (player.contains(document.activeElement)) (document.activeElement as HTMLElement).blur(); player.hidden = true }
  muteKey.addEventListener('click', () => {
    if (!running?.media) return
    const m = running.media
    m.muted = !m.muted
    running.blocked = false
    // An unmute is a fresh tap: a video that started muted gets its sound here.
    if (!m.muted && m.paused && m.src && !running.paused && !running.waiting) run(running)
    showPlayer()
    say(m.muted ? 'Muted.' : 'Sound on.')
  })
  pauseKey.addEventListener('click', () => {
    const r = running
    if (!r?.media) return
    r.paused = !r.paused
    if (r.paused) r.media.pause()
    // (Played on before the screen was up: it plays once it is, as it would have.)
    else if (!r.waiting) run(r)
    showPlayer()
    say(r.paused ? 'Paused.' : 'Playing.')
  })
  // Tucked: slid off the left edge to watch with nothing over the picture, a tab left at the edge to bring it back. It
  // stays tucked for the next egg too, until the tab is tapped. Out of sight, its keys are out of reach (inert).
  const tuckKey = $p<HTMLButtonElement>('.tuck'), tab = $p<HTMLButtonElement>('.tab'), parts = [...player.children].filter((e) => e !== tab) as HTMLElement[]
  let tucked = false
  /** How far it slides: its right edge 16 px past the screen's left, its block's side and shadow too, the tab 16 px out to meet the edge (by layout, so the slide itself does not count). */
  const measure = () => { const left = (player.offsetParent as HTMLElement | null)?.getBoundingClientRect().left ?? 0; player.style.setProperty('--tuck', `${left + player.offsetLeft + player.offsetWidth + 16}px`) }
  const tuck = (on: boolean) => {
    const focused = player.contains(document.activeElement)
    tucked = on
    if (on) measure()
    player.classList.toggle('tucked', on)
    for (const e of parts) e.inert = on
    tab.inert = !on
    if (focused) (on ? tab : tuckKey).focus({ preventScroll: true })
  }
  tuckKey.addEventListener('click', () => tuck(true))
  tab.addEventListener('click', () => tuck(false))
  addEventListener('resize', () => { if (tucked) measure() })
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
    const text = 'Try: wake up · bad apple · meme · iddqd · moon. Enter or / shows more.'
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
      return ['meme', ...pool.slice(0, n - 1)]
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
  // In this realm nothing is made from words (local.ts): the ask bar's Enter is the line's.
  page.controls.always('Enter', (e) => { if (e.metaKey || e.ctrlKey) return; e.preventDefault(); open(); return true })
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

  // ── What starts them from the first view, before anyone has gone in (eggs-first.ts): the banner's lines and the towers' lamps ──
  /** Whether anything of the eggs' is on: what a tap on the banner ends. */
  const on = () => !!(running || shield || moon || moonlit || saying)
  /** The meme the banner said last in the first view. */
  let lastLine: string | null = null
  const TAPS: Record<Spot, (line: string | null) => void> = {
    // While an egg is on, the banner ends it (Unmute is the player's: a tap here stops). Its line starts its egg; the site's name, a barrel roll.
    banner: (line) => (on() ? undo() : act(line ?? 'roll')),
    // The Pyramid's lamp: Bad Apple!! in shadow, the lamp the one red light left; again, the lights back.
    pyramid: () => (running?.egg === 'apple' ? stop() : act('apple')),
    // The crown of lamps: the Matrix on the city's windows, the crown's own screen among them; again, out of it.
    crown: () => (running?.egg === 'matrix' ? stop() : void enter()),
  }
  const taps = firstTaps({
    canvas: page.canvas, view: page.view, still: page.still, calm: page.calm, plane: page.plane, signs: page.signs,
    beacons: () => march.beacons, fog: () => march.fog,
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
    // A picture going down keeps its last frame.
    if (running?.picture) running.picture.draw(device, march.screen.texture, (performance.now() - running.started) / 1000)
    if (march.screen.up === 0 && fading) { fading.dispose(); fading = null }
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
    get state() { return { memesPlayed, paused: !!running?.paused, running: running?.egg ?? null, up: march.screen.up, shield, moon, typing: !!typing, muted: running?.media?.muted ?? null, blocked: running?.blocked ?? false, playing: !!running?.media && !running.media.paused, time: running?.media?.currentTime ?? 0, sound: (running?.media as { webkitAudioDecodedByteCount?: number } | undefined)?.webkitAudioDecodedByteCount ?? 0 } },
    say: heard,
    /** Opens the line, as Enter or the slash does in the realm (main.ts asks for it in the first view, where they are not heard). */
    open,
    undo,
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
    /** The things that start the eggs: where each is, and which is offered now. */
    things: found,
    /** What starts them from the first view (eggs-first.ts): where each spot is, and the banner's line. */
    first: taps,
    /** The windows that hold an egg (eggs-lockers.ts). */
    lockers: locks,
    atMoon,
  }
}
