// The landing's easter eggs in the San Francisco realm (#450), from the site's (static/landing/eggs.js, November 19).
// The realm is the landing now, so they are its own: the city's lit windows are the screen (march.ts and far.ts
// SCREEN, the realm's own window lighting), the hour and the weather are the realm's controls (realm-ui.ts, weather.ts),
// and what the city says it says on the banner its plane tows (signs.ts, boards.ts), which comes into the picture to say it.
//
//   Enter or /           a line to say something to the city on; what is typed shows on the banner as it is typed
//   wake up, neo, red pill, follow the white rabbit       the Matrix: code rain on the windows, fog, night, green
//   blue pill, Esc       out of the Matrix (Esc ends any egg; reset ends them all and puts the sky back)
//   rickroll, never gonna give you up                     Rick Astley on every window, with his sound
//   bad apple, or the hour swung across dusk four times in four seconds                        Bad Apple!! in shadow
//   ↑↑↓↓←→←→ b a         +30 lives on the banner
//   iddqd                the city cannot be broken (again: it can)
//   moon                 night and the moon; shoot the moon (a tool used at it) and it grows, three sizes
//   do a barrel roll     the eye turns round once
//   knock knock          the banner answers, and a joke the banner starts ends one way only
//
// Nothing here is fetched until an egg starts: the pictures (eggs-pictures.ts) and the videos (sf/eggs/, put there by
// sf/build.mjs, never in git). A video's sound plays because the visitor started it; a browser that holds the sound
// back gets the video muted and an Unmute key, which is that tap.
import type { Input } from './input.ts'
import type { Marcher, View } from './march.ts'
import type { Skies, Weather } from './weather.ts'
import type { Signs } from './signs.ts'
import type { Picture } from './eggs-pictures.ts'

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
}

// Original line drawing from the park's east-southeast view (the site's, the same view).
const GREETING = String.raw`Hello there.
                 |        __
         /\     /|\      |  |
   _[]__/  \_[]/ | \__[]_|  |___
 ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
General Kenobi.
If you managed to find this, you can send your resume… oh wait I'm not hiring, nvm.`

type Egg = 'matrix' | 'rickroll' | 'apple'
/** What a phrase does, by its words with nothing but letters and single spaces. */
const PHRASES = new Map<string, string>([
  ['wake up', 'matrix'], ['wake up neo', 'matrix'], ['neo', 'matrix'], ['red pill', 'red'], ['follow the white rabbit', 'matrix'], ['the matrix', 'matrix'],
  ['blue pill', 'unplug'], ['rickroll', 'rickroll'], ['never gonna give you up', 'rickroll'], ['bad apple', 'apple'],
  ['iddqd', 'god'], ['moon', 'moon'], ['shoot the moon', 'moon'], ['do a barrel roll', 'roll'], ['knock knock', 'knock'],
  ['stop', 'stop'], ['help', 'help'], ['hint', 'help'],
])
const KONAMI = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'KeyB', 'KeyA']
/** The moon's sizes against its own (the site's three radii, 0.017, 0.028 and 0.044 of the view). */
const MOONS = [0, 0.65, 1.6]
/** The hour whose sun is nearest the realm's own (main.ts, sf/realm.json `air.sun`): the light glides there and is then the realm's own again. */
const OWN_HOUR = 13.45

/** How each egg dresses the sky: the hour it goes to, the weather, and the last pass's grade (colour, contrast) and tint. */
const LOOKS: Record<Egg, { hour: number; weather: Weather; grade?: readonly [number, number]; tint: readonly [number, number, number] }> = {
  // A green night, the marine layer in from the sea.
  matrix: { hour: 23.25, weather: 'fog', grade: [0.75, 0.4], tint: [0.62, 1.0, 0.68] },
  // A 1987 dusk: blue hour, a warm tint.
  rickroll: { hour: 20.0, weather: 'clear', tint: [1.0, 0.88, 0.97] },
  // Shadow art: an overcast night in black and white, only the windows lit.
  apple: { hour: 23.0, weather: 'overcast', grade: [0, 0.45], tint: [0.94, 0.94, 0.94] },
}
/** The videos (made for the site by scripts/landing/encode-eggs.mjs: 160 x 120, -16 LUFS, HE-AAC). `outside` is what the panes beyond the picture show. */
const VIDEOS = {
  rickroll: { file: 'eggs/rick.mp4', title: 'Never Gonna Give You Up', outside: [14, 8, 22, 190] as const, contrast: 1.25,
    start: 'Never gonna give you up. Rick Astley is on every window in the city.', end: 'Never gonna let you down: that was the whole song.' },
  apple: { file: 'eggs/bad-apple.mp4', title: 'Bad Apple!!', outside: [0, 0, 0, 240] as const, contrast: 1.1,
    start: 'Bad Apple!! The city plays it in shadow.', end: 'Bad Apple!! is over. The lights come back on.' },
}

/** The words of a phrase as they are compared: lower case, curly quotes straight, nothing but letters, digits, apostrophes and single spaces. */
export const words = (text: string) => text.toLowerCase().replace(/[‘’]/g, "'").replace(/[^a-z0-9' ]+/g, ' ').replace(/'/g, '').replace(/\s+/g, ' ').trim()

export function eggs(page: EggsPage) {
  const { march, device } = page
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
  const say = (text: string, ms = 5000) => { page.notice(text, ms); status.textContent = text }

  // ── What is running, and the sky as it was before the first egg ──
  let running: { egg: Egg; picture: Picture | null; started: number; media?: HTMLVideoElement; blocked?: boolean; held?: boolean } | null = null
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
    if (!before) before = { hour: page.hour(), weather: page.sky.weather }
  }
  const dress = (egg: Egg) => {
    keep()
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
    if (running?.egg === 'matrix') return say('You are already in. Esc, or say “blue pill”, to leave.')
    stop(true, false, true)
    const started = ++clock
    const { codeRain } = await import('./eggs-pictures.ts')
    if (started !== clock) return
    running = { egg: 'matrix', picture: codeRain(), started: performance.now() }
    dress('matrix')
    // Two lines, one after the other (the banner has room for one): the second once the first has been in sight a while.
    banner('The Matrix has you')
    nextLine = { after: 'The Matrix has you', next: 'Red pill or blue pill?', seen: 0 }
    say('Wake up, Neo… The windows are code now. Esc, or say “blue pill”, to leave.')
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
  const play = async (egg: 'rickroll' | 'apple') => {
    const v = VIDEOS[egg]
    if (running?.egg === egg) {
      if (!running.blocked) return stop()
      running.blocked = false
      running.media!.muted = false
      run(running)
      showPlayer()
      return say('Sound on.')
    }
    stop(true, false, true)
    const m = element()
    m.muted = false
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
      run(current)
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

  // ── The player: what a video shows on the page, with a native button for each thing it does ──
  const realm = page.ui
  const player = document.createElement('div')
  player.className = 'vx-card egg-player'
  player.hidden = true
  player.setAttribute('role', 'group')
  player.setAttribute('aria-label', 'Now playing')
  player.style.cssText = 'position:absolute;left:max(16px,env(safe-area-inset-left));top:56px;display:flex;align-items:center;gap:10px;padding:8px 10px;pointer-events:auto'
  player.innerHTML = '<span class="title" style="font:600 13px/1.2 var(--vx-font,system-ui)"></span><button class="vx-button mute" type="button" aria-pressed="false">Mute</button><button class="vx-button stop" type="button" data-vx-kind="danger">Stop</button>'
  realm.append(player)
  const muteKey = player.querySelector<HTMLButtonElement>('.mute')!, stopKey = player.querySelector<HTMLButtonElement>('.stop')!
  const showPlayer = () => {
    if (!running?.media) return
    player.hidden = false
    player.querySelector('.title')!.textContent = `Now playing: ${VIDEOS[running.egg as 'rickroll' | 'apple'].title}`
    const muted = running.media.muted
    muteKey.textContent = muted ? 'Unmute' : 'Mute'
    muteKey.setAttribute('aria-pressed', String(muted))
  }
  const hidePlayer = () => { if (player.contains(document.activeElement)) (document.activeElement as HTMLElement).blur(); player.hidden = true }
  muteKey.addEventListener('click', () => {
    if (!running?.media) return
    const m = running.media
    m.muted = !m.muted
    running.blocked = false
    // An unmute is a fresh tap: a video that started muted gets its sound here.
    if (!m.muted && m.paused && m.src) run(running)
    showPlayer()
    say(m.muted ? 'Muted.' : 'Sound on.')
  })
  stopKey.addEventListener('click', () => stop())
  // Out of sight, the sound goes with the tab, as the city's own does.
  document.addEventListener('visibilitychange', () => {
    const m = running?.media
    if (!m || !m.src || running!.held) return
    if (document.hidden) m.pause(); else run(running!)
  })

  // ── The moon, the shield and the barrel roll ──
  const moonUp = () => {
    keep()
    glideTo(23.5)
    page.sky.set('clear')
    say('The moon is up. Look up at it, and shoot it.')
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
  let rolling: { from: number; t: number } | null = null
  // Over every other mode a lane puts down (a tool's use goes to the top first): the moon takes a shot at it, and
  // under IDDQD no tool breaks anything.
  page.controls.push({
    name: 'eggs',
    use: () => {
      if (atMoon(page.view().forward)) { shootMoon(); return true }
      if (shield) { say('IDDQD: the city cannot be broken. Say iddqd again to let it.', 3000); return true }
    },
  })

  // ── The knock-knock on the banner: a joke the city starts, or the visitor does, ends one way only ──
  let knock: { stage: 'asked' | 'never' | 'who' | 'whowho'; said?: string; until: number } | null = null
  const knocking = (start: 'city' | 'visitor') => {
    knock = { stage: start === 'city' ? 'asked' : 'who', until: performance.now() + 60_000 }
    banner(start === 'city' ? 'Knock knock' : "Who's there?")
    say(start === 'city' ? 'The banner says: knock knock. Press Enter to answer.' : "The banner says: who's there?")
  }
  /** A line said while the joke is on: true if it was the joke's. */
  const joke = (said: string) => {
    if (!knock || performance.now() > knock.until) { knock = null; return false }
    // An egg's own words are that egg, joke or no joke.
    if (knock.stage !== 'asked' && PHRASES.has(said)) { knock = null; banner(null); return false }
    knock.until = performance.now() + 60_000
    if (knock.stage === 'asked') {
      if (!/^who ?s there$|^who is there$/.test(said)) return false
      knock.stage = 'never'
      banner('Never gonna')
      return true
    }
    if (knock.stage === 'never') {
      if (!/who$/.test(said)) { banner('You say: never gonna who?'); return true }
      knock = null
      void play('rickroll')
      return true
    }
    if (knock.stage === 'who') { knock = { stage: 'whowho', said, until: knock.until }; banner(`${said} who?`); return true }
    // Whoever is at the door, it is Rick.
    knock = null
    void play('rickroll')
    return true
  }

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
        if (matchMedia('(prefers-reduced-motion: reduce)').matches) return say('Barrel roll (with motion reduced, in spirit).')
        rolling = { from: page.pose.yaw, t: 0 }
        return say('Barrel roll.')
      case 'knock': return knocking('visitor')
      case 'lives':
        briefly('+30 lives', 8000)
        return say('Tow banner: +30 lives')
      case 'help': return hint()
    }
  }
  const hint = () => {
    const text = 'Try: wake up · bad apple · iddqd · moon · knock knock'
    briefly('Try: wake up · knock knock', 7000)
    say(text, 7000)
  }
  /** Something said to the city on the line. */
  const heard = (text: string) => {
    const said = words(text)
    if (!said) return
    if (joke(said)) return
    const action = PHRASES.get(said)
    if (action) { misses = 0; return act(action) }
    misses++
    if (misses >= 2) return hint()
    briefly(`${text.trim().slice(0, 24)}? Not here.`, 5000)
    say('The city didn’t catch that.', 3000)
  }

  // ── The line: Enter or / opens it; what is typed shows on the banner as it is typed ──
  const line = document.createElement('label')
  line.className = 'vx-card egg-line'
  line.hidden = true
  line.style.cssText = 'position:absolute;left:50%;bottom:calc(max(30px,env(safe-area-inset-bottom)) + 64px);transform:translateX(-50%);display:flex;gap:8px;align-items:center;padding:6px 10px;pointer-events:auto;font:600 13px/1 var(--vx-font,system-ui)'
  line.innerHTML = '<span>Say</span><input type="text" autocomplete="off" autocapitalize="off" spellcheck="false" maxlength="60" aria-label="Say something to the city" style="font:400 15px/1.2 var(--vx-mono,ui-monospace,monospace);inline-size:24ch;background:transparent;border:0;outline:0;color:inherit">'
  realm.append(line)
  const field = line.querySelector('input')!
  let typing: (() => void) | null = null
  const echo = () => { brief++; show(`> ${field.value.slice(-24)}_`) }
  const open = () => {
    if (typing) return
    typing = page.controls.push({ name: 'saying', solid: true, text: true })
    line.hidden = false
    field.value = ''
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
  field.addEventListener('input', echo)
  field.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); const text = field.value; close(); heard(text) }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close() }
  })
  field.addEventListener('blur', () => { if (typing) close() })
  // In this realm nothing is made from words (local.ts): the ask bar's Enter is the line's.
  page.controls.always('Enter', (e) => { if (e.metaKey || e.ctrlKey) return; e.preventDefault(); open(); return true })
  page.controls.always('Slash', (e) => { e.preventDefault(); open(); return true })

  // ── Keys that are not on the line: Esc ends the eggs, and the Konami code (its B and A are not the world's) ──
  let konami = 0
  addEventListener('keydown', (e) => {
    if (typing || e.repeat || (e.target instanceof HTMLElement && e.target.closest('input,textarea,select,[contenteditable]'))) return
    if (e.key === 'Escape') {
      if (running || shield || moon || knock || saying) { e.preventDefault(); undo() }
      return
    }
    if (e.code === KONAMI[konami]) {
      konami++
      // The B and the A of the code are the code's, not the world's (B is on foot or flying).
      if (konami > 8) { e.preventDefault(); e.stopImmediatePropagation() }
      if (konami === KONAMI.length) { konami = 0; act('lives') }
    } else konami = e.code === 'ArrowUp' ? (konami === 2 ? 2 : 1) : 0
  }, { capture: true })

  /** Every egg undone: what runs stops, the shield drops, the moon is its own size, the joke is over, the sky as it was. */
  const undo = (quiet = false) => {
    const any = running || shield || moon || knock || saying
    stop(true)
    shield = false
    moon = 0
    march.screen.moon = 0
    knock = null
    banner(null)
    undress()
    if (any && !quiet) say('Back in the park.')
  }
  page.onReset(() => undo(true))

  // ── Every frame: the screen comes up and goes down, its picture is drawn, the light comes home, the hour is watched ──
  let flips: number[] = [], wasDark: boolean | null = null
  page.watch((gap) => {
    const dt = Math.min(gap, 100) / 1000
    // The banner's next line, after its plane has been in the picture for 8 s (it flies in from the edge, cloth last).
    if (nextLine && onBanner !== nextLine.after) nextLine = null
    else if (nextLine && !typing && page.planeSeen() && (nextLine.seen += dt) > 8) { const next = nextLine.next; nextLine = null; banner(next) }
    const up = running?.picture ? 1 : 0
    // Up over a second, down over two thirds of one.
    if (up > march.screen.up) march.screen.up = Math.min(1, march.screen.up + dt)
    else if (up < march.screen.up) march.screen.up = Math.max(0, march.screen.up - dt * 1.5)
    // A picture going down keeps its last frame.
    if (running?.picture) running.picture.draw(device, march.screen.texture, (performance.now() - running.started) / 1000)
    if (march.screen.up === 0 && fading) { fading.dispose(); fading = null }
    if (pending !== null) { page.sky.glide(pending); pending = null }
    // The hour goes home once the fog an egg left has thinned, or after four seconds of waiting for it.
    if (leaving && (march.fog < 0.12 || performance.now() - leaving.since > 4000)) { const hour = leaving.hour; leaving = null; home(hour) }
    if (goingHome && Math.abs((page.hour() ?? OWN_HOUR) - OWN_HOUR) < 0.02) { goingHome = false; page.ownLight() }
    // (The sky keeps an hour as `h % 24`: 13.45 comes back 13.450000000000003.)
    else if (goingHome && Math.abs((page.sky.hour ?? OWN_HOUR) - OWN_HOUR) > 0.02) goingHome = false
    if (rolling) {
      rolling.t += dt / 0.85
      const s = Math.min(1, rolling.t), ease = s * s * (3 - 2 * s)
      page.pose.yaw = rolling.from + ease * Math.PI * 2
      if (s >= 1) rolling = null
    }
    // Four swings of the hour across dusk in four seconds: Bad Apple!!, black and white and black and white.
    const h = page.hour(), dark = h !== null && (h < 6.5 || h >= 18.5), now = performance.now()
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

  // The city starts the joke once, 45 s after the visitor first presses or taps anything, if nothing else is going on.
  const first = () => {
    removeEventListener('keydown', first, true); removeEventListener('pointerdown', first, true)
    setTimeout(() => { if (!running && !knock && !typing && !saying) knocking('city') }, 45_000)
  }
  // (`?knock=0` leaves it to the visitor: the checks start it themselves.)
  if (new URLSearchParams(location.search).get('knock') !== '0') { addEventListener('keydown', first, true); addEventListener('pointerdown', first, true) }

  return {
    /** For the checks: what is going on. */
    get state() { return { running: running?.egg ?? null, up: march.screen.up, shield, moon, knock: knock?.stage ?? null, typing: !!typing, muted: running?.media?.muted ?? null, blocked: running?.blocked ?? false, playing: !!running?.media && !running.media.paused, time: running?.media?.currentTime ?? 0, sound: (running?.media as { webkitAudioDecodedByteCount?: number } | undefined)?.webkitAudioDecodedByteCount ?? 0 } },
    say: heard,
    undo,
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
    knock: () => knocking('city'),
    atMoon,
  }
}
