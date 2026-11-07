import type { Context } from 'cordis'
import { Babbler, type Said } from '../voice/engine'
import { voiceKey } from '../voice/profiles'
import { runDemo } from '../voice/demo'

// #42: villagers babble in time with their words when no voice model is connected.
// talk.ts announces each revealed word with `village/said`; this plugin turns it
// into a short run of synthesized syllables in that villager's voice. On with
// ?talk=npc; ?babble=off turns it off; ?babble=demo (dev only) plays a scripted
// exchange without talk.ts.
declare module 'cordis' {
  interface Events {
    /** A villager's word has just appeared on its card. `word` keeps its trailing punctuation. */
    'village/said'(e: { villager: string; word: string; index: number; last: boolean }): void
    /** A villager's reply was cut short: stop its voice now. */
    'village/said-stop'(e: { villager: string }): void
  }
}

const params = new URLSearchParams(location.search)
const MODE = params.get('babble')
const DEMO = import.meta.env.DEV && MODE === 'demo'
const ON = MODE !== 'off' && (params.get('talk') === 'npc' || DEMO)
const MUTED = 'village.babble.muted'

function storedMute(): boolean {
  try {
    return localStorage.getItem(MUTED) === '1'
  } catch {
    return false
  }
}

function storeMute(muted: boolean) {
  try {
    localStorage.setItem(MUTED, muted ? '1' : '0')
  } catch {
    // Private windows may refuse storage; the toggle still works for this visit.
  }
}

/** Typing in the slip or the notebook never toggles the voices. */
function typing(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  return Boolean(el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)))
}

const SPEAKER = `<svg viewBox="0 0 24 24" aria-hidden="true"><path class="cone" d="M4 9.5h3.2L12 5.6v12.8l-4.8-3.9H4z"/><path class="waves" d="M15 9.2c1 .8 1.5 1.7 1.5 2.8s-.5 2-1.5 2.8M17.4 7c1.7 1.4 2.6 3.1 2.6 5s-.9 3.6-2.6 5"/><path class="hush" d="M15.5 9.5l5 5m0-5l-5 5"/></svg>`

const CSS = `
.babble-toggle { position: fixed; left: 16px; bottom: 16px; z-index: 30; width: 40px; height: 40px; border-radius: 50%;
  border: 0; padding: 0; cursor: pointer; display: grid; place-items: center;
  background: radial-gradient(circle at 35% 30%, #f3e4c8, #e2c9a0 70%, #cfb085);
  box-shadow: 0 2px 6px rgba(60, 40, 20, .25), inset 0 0 0 3px rgba(255, 250, 240, .35);
  outline: 1.5px dashed rgba(110, 80, 50, .45); outline-offset: -6px; transition: transform .15s ease; }
.babble-toggle:hover { transform: scale(1.06); }
.babble-toggle:focus-visible { outline: 2px solid #6b4a2b; outline-offset: 2px; }
.babble-toggle svg { width: 22px; height: 22px; fill: none; stroke: #6b4a2b; stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; }
.babble-toggle .cone { fill: #6b4a2b; }
.babble-toggle .hush { display: none; }
.babble-toggle[aria-pressed="true"] .waves { display: none; }
.babble-toggle[aria-pressed="true"] .hush { display: inline; }
`

export interface BabbleApi {
  readonly babbler: Babbler | null
  readonly audio: AudioContext | null
  readonly muted: boolean
  setMuted(muted: boolean): void
}

export default {
  name: 'babble',
  apply(ctx: Context) {
    if (!ON) return
    let audio: AudioContext | null = null
    let babbler: Babbler | null = null
    let muted = storedMute()

    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'babble-toggle'
    button.innerHTML = SPEAKER
    const style = document.createElement('style')
    style.textContent = CSS
    const show = () => {
      button.setAttribute('aria-pressed', String(muted))
      button.setAttribute('aria-label', muted ? 'Villager voices off' : 'Villager voices on')
      button.title = `${muted ? 'Voices off' : 'Voices on'} (M)`
    }
    const setMuted = (value: boolean) => {
      muted = value
      storeMute(muted)
      babbler?.setMuted(muted)
      show()
    }
    show()
    button.addEventListener('click', () => setMuted(!muted))

    // Browsers only let a page make sound after the person has touched it, and not
    // every touch counts (a tap's pointerdown or Escape does not), so every gesture
    // resumes a context that is not running yet, or was suspended since.
    const start = () => {
      if (audio?.state === 'running') return
      if (!audio) {
        audio = new AudioContext({ latencyHint: 'interactive' })
        babbler = new Babbler(audio, audio.destination, { muted })
      }
      void audio.resume()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'm' && e.key !== 'M') return
      if (e.ctrlKey || e.metaKey || e.altKey || e.repeat || typing(e.target)) return
      setMuted(!muted)
    }
    const onVisibility = () => document.hidden && babbler?.stop()
    const close = () => {
      babbler?.dispose()
      babbler = null
      const a = audio
      audio = null
      if (a && a.state !== 'closed') void a.close()
    }

    ctx.effect(() => {
      document.head.append(style)
      document.body.append(button)
      addEventListener('keydown', onKey)
      addEventListener('pagehide', close)
      document.addEventListener('visibilitychange', onVisibility)
      addEventListener('pointerdown', start, true)
      addEventListener('keydown', start, true)
      if (navigator.userActivation?.hasBeenActive) start()
      return () => {
        removeEventListener('pointerdown', start, true)
        removeEventListener('keydown', start, true)
        removeEventListener('keydown', onKey)
        removeEventListener('pagehide', close)
        document.removeEventListener('visibilitychange', onVisibility)
        button.remove()
        style.remove()
        close()
      }
    }, 'babble audio and toggle')

    ctx.on('village/said', (e: Said) => {
      if (!babbler || audio?.state !== 'running' || document.hidden) return
      babbler.said(e)
    })
    // A stop for someone who is not speaking leaves the speaker alone.
    ctx.on('village/said-stop', (e) => {
      if (babbler?.speaking === (voiceKey(e.villager) ?? e.villager)) babbler.stop()
    })

    if (import.meta.env.DEV) {
      const api: BabbleApi = {
        get babbler() { return babbler },
        get audio() { return audio },
        get muted() { return muted },
        setMuted,
      }
      // window.village appears once main.ts has loaded the first plugins, so attach on the next tick.
      ctx.effect(() => {
        const host = () => (window as unknown as { village?: Record<string, unknown> }).village
        const attach = () => {
          const village = host()
          if (village) village.babble = api
        }
        attach()
        const id = setTimeout(attach)
        return () => {
          clearTimeout(id)
          const village = host()
          if (village?.babble === api) delete village.babble
        }
      }, 'babble dev handle')
    }
    if (DEMO) runDemo(ctx)
  },
}
