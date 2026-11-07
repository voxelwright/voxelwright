import * as THREE from 'three/webgpu'
import type { Context } from 'cordis'
import { acquireAudio, type SharedAudio } from '../voice/context'
import { mixFor, type Mix } from '../voice/buses'
import { ALL_MUTED, isMuteKey, storedFlag, storeFlag } from '../voice/mute'
import { Player, renderOffline, type Logged, type OfflinePlay, type PlayOptions } from '../sound/player'
import { MAP, SOUND_EVENTS, whereOf } from '../sound/map'
import { PALETTE } from '../sound/palette'
import type { BusName, CueName, Where } from '../sound/contract'

// #52: the home's sounds, on for every visit. Plugins announce what happened
// (sound/contract.ts); sound/map.ts turns each event into a cue; the player plays it on
// the shared context (voice/context.ts) into its bus (voice/buses.ts). This plugin also
// owns all-sound mute: `M` and the felt speaker button ramp the master, and the voices
// and the music follow `village/muted`. Samples are fetched after the first gesture.
// ?sfx=chose:b,sent:c picks variants for the visit; the listening page stores picks
// under `village.sfx.picks`.
declare module 'cordis' {
  interface Events {
    /** All sound was muted or unmuted, by `M` or the speaker button. */
    'village/muted'(e: { muted: boolean }): void
  }
}

const PICKS = 'village.sfx.picks'
const SFX = `${import.meta.env.BASE_URL}audio/sfx/`
/** Widest stereo position, so a sound at the screen's edge is still in the room. */
const WIDTH = 0.6

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
@media (prefers-reduced-motion: reduce) { .babble-toggle { transition: none; } }
`

/** Variant picks: the listening page's stored ones, then ?sfx= on top. */
function readPicks(): Partial<Record<CueName, string>> {
  let picks: Partial<Record<CueName, string>> = {}
  try {
    picks = JSON.parse(localStorage.getItem(PICKS) ?? '{}') ?? {}
  } catch {
    // No storage, or not JSON: no stored picks.
  }
  for (const pair of (new URLSearchParams(location.search).get('sfx') ?? '').split(',')) {
    const [cue, variant] = pair.split(':')
    if (cue && variant) picks[cue as CueName] = variant
  }
  return picks
}

export interface SoundApi {
  readonly audio: AudioContext | null
  readonly mix: Mix | null
  readonly muted: boolean
  setMuted(muted: boolean): void
  /** Every play so far (the last 500): cue, variant, bus, start time, the context time when it was asked for, pan. */
  readonly log: Logged[]
  /** Play a cue through the live path (the same gates as an event). */
  play(name: CueName, variant?: string, opts?: PlayOptions): Logged | null
  /** Render plays offline through the same chain; channels as base64 Float32 at 48 kHz. */
  render(plays: OfflinePlay[], seconds: number, seed?: number, solo?: BusName): Promise<{ channels: string[]; ms: number }>
  /** Main-thread milliseconds each event handler took, newest last. */
  readonly handled: number[]
}

export default {
  name: 'sound',
  apply(ctx: Context) {
    let shared: SharedAudio | null = null
    let player: Player | null = null
    let muted = storedFlag(ALL_MUTED)
    const picks = readPicks()
    const handled: number[] = []

    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'babble-toggle'
    button.innerHTML = SPEAKER
    const style = document.createElement('style')
    style.textContent = CSS
    const show = () => {
      button.setAttribute('aria-pressed', String(muted))
      button.setAttribute('aria-label', muted ? 'Sound off' : 'Sound on')
      button.title = `${muted ? 'Sound off' : 'Sound on'} (M)`
    }
    const setMuted = (value: boolean) => {
      muted = value
      storeFlag(ALL_MUTED, muted)
      if (shared?.context) mixFor(shared.context).setMuted(muted)
      show()
      ctx.emit('village/muted', { muted })
    }
    show()
    button.addEventListener('click', () => setMuted(!muted))
    const onKey = (e: KeyboardEvent) => {
      if (isMuteKey(e, false)) setMuted(!muted)
    }
    const onStorage = (e: StorageEvent) => {
      if (e.key === PICKS && player) player.picks = readPicks()
    }

    // Pan from the camera: the point's place across the screen, 0 off screen or without a position.
    const point = new THREE.Vector3()
    const panOf = (at?: Where) => {
      const camera = ctx.get('stage')?.camera
      if (!at || !camera) return 0
      const ndc = point.set(at.x, at.y, at.z).project(camera)
      if (ndc.z >= 1 || Math.abs(ndc.x) > 1 || Math.abs(ndc.y) > 1) return 0
      return ndc.x * WIDTH
    }
    const live = () => {
      const a = shared?.context
      return player && a?.state === 'running' && !document.hidden ? player : null
    }
    const play = (name: CueName, o: PlayOptions) => live()?.play(name, o) ?? null

    ctx.effect(() => {
      document.head.append(style)
      document.body.append(button)
      addEventListener('keydown', onKey)
      addEventListener('storage', onStorage)
      shared = acquireAudio({
        ready: (a) => {
          mixFor(a).setMuted(muted, 0)
          player = new Player(a, PALETTE, (Math.random() * 2 ** 32) >>> 0, picks)
        },
        gesture: () => void player?.load(SFX),
        closed: () => {
          player = null
        },
      })
      return () => {
        removeEventListener('keydown', onKey)
        removeEventListener('storage', onStorage)
        button.remove()
        style.remove()
        player = null
        shared?.release()
        shared = null
      }
    }, 'sound audio and toggle')

    for (const name of SOUND_EVENTS) {
      const line = MAP[name] as (e: unknown) => CueName | null
      ctx.on(name, (e: Record<string, unknown>) => {
        const t0 = performance.now()
        const cue = line(e)
        if (cue) play(cue, { pan: panOf(whereOf(e)), seconds: typeof e.seconds === 'number' ? e.seconds : undefined, event: e })
        handled.push(performance.now() - t0)
        if (handled.length > 500) handled.shift()
      })
    }

    if (import.meta.env.DEV) {
      const b64 = (f32: Float32Array) => {
        const bytes = new Uint8Array(f32.buffer, f32.byteOffset, f32.byteLength)
        let s = ''
        for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
        return btoa(s)
      }
      const api: SoundApi = {
        get audio() { return shared?.context ?? null },
        get mix() { return shared?.context ? mixFor(shared.context) : null },
        get muted() { return muted },
        setMuted,
        get log() { return player?.log ?? [] },
        get handled() { return handled },
        play: (name, variant, opts = {}) => play(name, { ...opts, variant }),
        async render(plays, seconds, seed = 1, solo) {
          const r = await renderOffline(PALETTE, plays, seconds, seed, { solo, base: SFX })
          return { channels: r.channels.map(b64), ms: r.ms }
        },
      }
      // window.village appears once main.ts has loaded the first plugins, so attach on the next tick.
      ctx.effect(() => {
        const host = () => (window as unknown as { village?: Record<string, unknown> }).village
        const attach = () => {
          const village = host()
          if (village) village.sound = api
        }
        attach()
        const id = setTimeout(attach)
        return () => {
          clearTimeout(id)
          const village = host()
          if (village?.sound === api) delete village.sound
        }
      }, 'sound dev handle')
    }
  },
}
