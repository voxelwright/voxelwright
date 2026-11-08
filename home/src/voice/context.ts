// The one AudioContext for the villagers' voices and the music (#42).
//
// Why shared and why made at load: the page's first `new AudioContext()` opens the audio
// device and blocked the main thread for 0.4 to 1.7 s (measured in headless Chrome 158 on an
// M1 Pro, in the real scene and on a blank page), whenever it ran, so a context made in the
// first key press froze the page just as the person started writing. A second context costs
// 3 to 47 ms, so two plugins with a context each paid it twice in the worst case.
//
// Chrome can make a context with `sinkId: { type: 'none' }` (1 ms) and attach the real
// device afterwards with `setSinkId('')`, which is asynchronous: the 0.9 s of device
// start-up then happens off the main thread (no frame gap over 5 ms). Elsewhere the
// context is made once the page has loaded and the browser is idle, or on the first
// gesture if idle never comes. Either way it stays suspended and makes no sound until a
// gesture has resumed it.
//
// The rule is "no sound before a gesture", not "no context": the autoplay policies
// (Chrome: https://developer.chrome.com/blog/autoplay, WebKit:
// https://webkit.org/blog/6784/new-video-policies-for-ios/, MDN:
// https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Autoplay) let a page create a
// context any time; it is `resume()` that needs user activation.

/** Chrome's AudioContext has `sinkId` and `setSinkId`; the DOM typings in TypeScript 5.9 do not. */
type SinkContext = AudioContext & { setSinkId?(sinkId: string): Promise<void> }

export interface AudioUser {
  /** The shared context exists, suspended and silent: build your graph on it. Called again when a closed context is replaced. */
  ready(audio: AudioContext): void
  /** The first gesture has arrived (or the page was already active when you joined). The context is being resumed. */
  gesture?(audio: AudioContext): void
  /** The context was closed under you (`pagehide`): drop your graph. */
  closed(): void
}

export interface SharedAudio {
  /** The context, or null until it has been made. */
  readonly context: AudioContext | null
  /** Leave. The context closes when the last user leaves. */
  release(): void
}

const users = new Set<AudioUser>()
const told = new Set<AudioUser>()
let context: AudioContext | null = null
/** A person has touched the page, so the context should be running whenever the tab is visible. */
let unlocked = false
let idle: { cancel(): void } | null = null

/**
 * A resume() or suspend() still pending when the last user leaves rejects with "AudioContext is
 * closed" once close() runs. That is the expected end of a context, not an error: swallow it
 * instead of leaving an unhandled rejection (seen intermittently in check-babble's unload test).
 */
const settle = (p: Promise<void>) => void p.catch(() => {})

const quietSink = () => typeof AudioContext !== 'undefined' && 'setSinkId' in AudioContext.prototype

function create() {
  if (context) return
  idle?.cancel()
  idle = null
  const quiet = quietSink()
  // 'interactive': the voices are measured to speak within 20 ms of their word; the music does not mind.
  const options: AudioContextOptions & { sinkId?: { type: 'none' } } = { latencyHint: 'interactive' }
  if (quiet) options.sinkId = { type: 'none' }
  const a = new AudioContext(options)
  context = a
  // Headless Chrome starts a context running without a gesture; browsers that enforce the policy start it suspended.
  if (!unlocked) settle(a.suspend())
  // The device opens here, off the main thread. A resume() made meanwhile settles when it is open.
  if (quiet) (a as SinkContext).setSinkId!('').catch((error) => console.warn('audio: could not open the output device', error))
  for (const user of users) user.ready(a)
  if (unlocked) activate()
}

/** First gesture or an already active page: tell each user once per context, and resume. */
function activate() {
  const a = context
  if (!a) return
  for (const user of users) {
    if (told.has(user)) continue
    told.add(user)
    user.gesture?.(a)
  }
  resume()
}

function resume() {
  if (context && context.state !== 'running' && !document.hidden) settle(context.resume())
}

// Not every gesture grants activation (a touch's pointerdown, Escape), so every later one
// resumes a context that is not running yet, or was suspended since.
const onGesture = () => {
  unlocked = true
  if (!context) create()
  else activate()
}

// A background tab plays nothing: the context sleeps and wakes with the page.
const onVisibility = () => {
  if (!context) return
  if (document.hidden) settle(context.suspend())
  else if (unlocked) resume()
}

const onPageHide = () => {
  const a = context
  context = null
  told.clear()
  for (const user of users) user.closed()
  if (a && a.state !== 'closed') settle(a.close())
}

function listen() {
  addEventListener('pointerdown', onGesture, true)
  addEventListener('pointerup', onGesture, true)
  addEventListener('keydown', onGesture, true)
  addEventListener('pagehide', onPageHide)
  document.addEventListener('visibilitychange', onVisibility)
}

function unlisten() {
  removeEventListener('pointerdown', onGesture, true)
  removeEventListener('pointerup', onGesture, true)
  removeEventListener('keydown', onGesture, true)
  removeEventListener('pagehide', onPageHide)
  document.removeEventListener('visibilitychange', onVisibility)
}

/** Make the context once the page has loaded and the browser is idle (browsers without a silent sink). */
function whenIdle() {
  let timer: ReturnType<typeof setTimeout> | undefined
  let handle: number | undefined
  const run = () => {
    if (typeof requestIdleCallback === 'function') handle = requestIdleCallback(create)
    else timer = setTimeout(create, 1000)
  }
  const loaded = document.readyState === 'complete'
  if (loaded) run()
  else addEventListener('load', run, { once: true })
  return {
    cancel() {
      removeEventListener('load', run)
      clearTimeout(timer)
      if (handle !== undefined) cancelIdleCallback(handle)
    },
  }
}

/** Join the shared context. The first user makes it (at once on Chrome, when idle elsewhere). */
export function acquireAudio(user: AudioUser): SharedAudio {
  users.add(user)
  if (users.size === 1) {
    listen()
    unlocked = unlocked || Boolean(navigator.userActivation?.hasBeenActive)
    if (quietSink() || unlocked) create()
    else idle = whenIdle()
  } else if (context) {
    user.ready(context)
    if (unlocked) activate()
  }
  return {
    get context() {
      return context
    },
    release() {
      if (!users.delete(user)) return
      told.delete(user)
      if (users.size) return
      unlisten()
      idle?.cancel()
      idle = null
      const a = context
      context = null
      told.clear()
      if (a && a.state !== 'closed') settle(a.close())
    },
  }
}
