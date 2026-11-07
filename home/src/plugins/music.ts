import type { Context } from 'cordis'
import { Bed } from '../voice/bed'
import { acquireAudio, type SharedAudio } from '../voice/context'
import { ALL_MUTED, MUSIC_MUTED, isMuteKey, storedFlag, storeFlag } from '../voice/mute'

// #42: a quiet looped bed under the villagers' voices. On with ?talk=npc; ?music=off
// turns it off. It starts on the first touch or key press, like the voices (on the one
// AudioContext they share, voice/context.ts), fades in over
// two seconds, drops 6 dB while a villager speaks and comes back 0.6 s after the last word.
// `M` and the felt speaker button (babble.ts) mute everything; Shift+M or the note beside
// the speaker mutes the music alone. The recording is CC BY 4.0: public/audio/CREDITS.md.
const params = new URLSearchParams(location.search)
const ON = params.get('music') !== 'off' && params.get('talk') === 'npc'
/** With ?babble=off there are no voices to duck for, and no speaker button, so this plugin takes `M` itself. */
const VOICES = params.get('babble') !== 'off'
const SRC = `${import.meta.env.BASE_URL}audio/groove-music.ogg`
/** Seconds after the last word before the bed comes back. */
const HOLD = 0.6

export const CREDIT = {
  title: 'Groove Music',
  author: 'benpm',
  source: 'https://freesound.org/s/203099/',
  licence: 'CC BY 4.0',
  licenceUrl: 'https://creativecommons.org/licenses/by/4.0/',
}

const NOTE = `<svg viewBox="0 0 24 24" aria-hidden="true"><path class="head" d="M10 17.2a3 2.4 -20 1 1-.1-.2z"/><path class="stem" d="M12.6 16.4V5.2l6 1.6v3.6"/><path class="hush" d="M4.5 4.5l15 15"/></svg>`

const CSS = `
.music-note { position: fixed; left: 64px; bottom: 16px; z-index: 30; }
.music-toggle { width: 40px; height: 40px; border-radius: 50%;
  border: 0; padding: 0; cursor: pointer; display: grid; place-items: center;
  background: radial-gradient(circle at 35% 30%, #f3e4c8, #e2c9a0 70%, #cfb085);
  box-shadow: 0 2px 6px rgba(60, 40, 20, .25), inset 0 0 0 3px rgba(255, 250, 240, .35);
  outline: 1.5px dashed rgba(110, 80, 50, .45); outline-offset: -6px; transition: transform .15s ease; }
.music-toggle:hover { transform: scale(1.06); }
.music-toggle:focus-visible { outline: 2px solid #6b4a2b; outline-offset: 2px; }
.music-toggle svg { width: 22px; height: 22px; fill: none; stroke: #6b4a2b; stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; }
.music-toggle .head { fill: #6b4a2b; }
.music-toggle .hush { display: none; }
.music-toggle[aria-pressed="true"] .hush { display: inline; }
.music-credit { position: absolute; left: 0; bottom: 100%; padding-bottom: 8px; opacity: 0; pointer-events: none; transition: opacity .2s ease;
  font: 12px/1.4 Georgia, 'Iowan Old Style', serif; color: #4a3520; white-space: nowrap; }
.music-credit span { display: block; padding: 6px 10px; border-radius: 6px; background: #f3e4c8; box-shadow: 0 2px 6px rgba(60, 40, 20, .25); }
.music-credit a { color: #6b4a2b; text-underline-offset: 2px; }
.music-note:hover .music-credit, .music-note:focus-within .music-credit { opacity: 1; pointer-events: auto; }
@media (prefers-reduced-motion: reduce) { .music-credit, .music-toggle { transition: none; } }
`

export interface MusicApi {
  readonly bed: Bed | null
  readonly audio: AudioContext | null
  /** Silenced by either switch. */
  readonly muted: boolean
  readonly musicMuted: boolean
  setMusicMuted(muted: boolean): void
}

export default {
  name: 'music',
  apply(ctx: Context) {
    if (!ON) return
    let shared: SharedAudio | null = null
    let audio: AudioContext | null = null
    let bed: Bed | null = null
    let allMuted = storedFlag(ALL_MUTED)
    let musicMuted = storedFlag(MUSIC_MUTED)
    let release: ReturnType<typeof setTimeout> | undefined

    const wrap = document.createElement('div')
    wrap.className = 'music-note'
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'music-toggle'
    button.innerHTML = NOTE
    const credit = document.createElement('div')
    credit.className = 'music-credit'
    const line = document.createElement('span')
    // Built from parts, not markup, so the credit's words are never read as HTML.
    const link = (text: string, href: string) => {
      const a = document.createElement('a')
      a.href = href
      a.target = '_blank'
      a.rel = 'noopener'
      a.textContent = text
      return a
    }
    line.append('♪ ', link(CREDIT.title, CREDIT.source), ` by ${CREDIT.author} (`, link(CREDIT.licence, CREDIT.licenceUrl), '), re-encoded')
    credit.append(line)
    wrap.append(button, credit)
    const style = document.createElement('style')
    style.textContent = CSS

    const silenced = () => allMuted || musicMuted
    const show = () => {
      button.setAttribute('aria-pressed', String(musicMuted))
      button.setAttribute('aria-label', musicMuted ? 'Music off' : 'Music on')
      button.title = allMuted ? 'All sound is off (M)' : `${musicMuted ? 'Music off' : 'Music on'} (Shift+M)`
    }
    const apply = () => {
      bed?.setMuted(silenced())
      show()
    }
    const setMusicMuted = (value: boolean) => {
      musicMuted = value
      storeFlag(MUSIC_MUTED, value)
      apply()
    }
    show()
    button.addEventListener('click', () => setMusicMuted(!musicMuted))

    const load = async (a: AudioContext) => {
      try {
        const response = await fetch(SRC)
        if (!response.ok) throw new Error(`${response.status}`)
        const buffer = await a.decodeAudioData(await response.arrayBuffer())
        if (audio !== a || a.state === 'closed') return
        bed = new Bed(a, buffer, a.destination, { muted: silenced() })
        bed.start(a.currentTime + 0.05)
      } catch (error) {
        console.warn('music: could not load the loop', error)
      }
    }
    // The context exists from page load but silent; the loop is fetched on the first gesture.
    const onKey = (e: KeyboardEvent) => {
      if (isMuteKey(e, true)) setMusicMuted(!musicMuted)
      else if (!VOICES && isMuteKey(e, false)) {
        allMuted = !allMuted
        storeFlag(ALL_MUTED, allMuted)
        apply()
      }
    }
    const close = () => {
      clearTimeout(release)
      bed?.dispose()
      bed = null
    }

    ctx.effect(() => {
      document.head.append(style)
      document.body.append(wrap)
      addEventListener('keydown', onKey)
      shared = acquireAudio({
        ready: (a) => {
          audio = a
        },
        gesture: (a) => void load(a),
        closed: () => {
          close()
          audio = null
        },
      })
      return () => {
        removeEventListener('keydown', onKey)
        wrap.remove()
        style.remove()
        close()
        audio = null
        shared?.release()
        shared = null
      }
    }, 'music audio and toggle')

    // The speaker button and `M` live in babble.ts; this follows them.
    ctx.on('village/muted', (e) => {
      allMuted = e.muted
      apply()
    })

    // Duck for a speaker, and come back HOLD seconds after the last word (a comma's pause keeps it down).
    const hold = () => {
      clearTimeout(release)
      release = setTimeout(() => bed?.duck(false), HOLD * 1000)
    }
    ctx.on('village/said', () => {
      if (!VOICES || !bed || audio?.state !== 'running' || document.hidden) return
      bed.duck(true)
      hold()
    })
    ctx.on('village/said-stop', () => {
      if (bed) hold()
    })

    if (import.meta.env.DEV) {
      const api: MusicApi = {
        get bed() { return bed },
        get audio() { return audio },
        get muted() { return silenced() },
        get musicMuted() { return musicMuted },
        setMusicMuted,
      }
      // window.village appears once main.ts has loaded the first plugins, so attach on the next tick.
      ctx.effect(() => {
        const host = () => (window as unknown as { village?: Record<string, unknown> }).village
        const attach = () => {
          const village = host()
          if (village) village.music = api
        }
        attach()
        const id = setTimeout(attach)
        return () => {
          clearTimeout(id)
          const village = host()
          if (village?.music === api) delete village.music
        }
      }, 'music dev handle')
    }
  },
}
