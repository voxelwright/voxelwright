import type { Context } from 'cordis'
import { Babbler, type Said } from '../voice/engine'
import { acquireAudio, type SharedAudio } from '../voice/context'
import { busFor, mixFor, voicesSpoke, voicesStopped } from '../voice/buses'
import { voiceKey } from '../voice/profiles'
import { runDemo } from '../voice/demo'
import { ALL_MUTED, storedFlag } from '../voice/mute'

// #42: villagers babble in time with their words when no voice model is connected.
// talk.ts announces each revealed word with `village/said`; this plugin turns it
// into a short run of synthesized syllables in that villager's voice. On with
// ?talk=npc; ?babble=off turns it off; ?babble=demo (dev only) plays a scripted
// exchange without talk.ts. The voices play into the voices bus (voice/buses.ts), which
// ducks the music while they speak; mute and the speaker button are plugins/sound.ts's.
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

export interface BabbleApi {
  readonly babbler: Babbler | null
  readonly audio: AudioContext | null
  /** All sound is muted (plugins/sound.ts owns the switch). */
  readonly muted: boolean
}

export default {
  name: 'babble',
  apply(ctx: Context) {
    if (!ON) return
    let shared: SharedAudio | null = null
    let babbler: Babbler | null = null

    const onVisibility = () => document.hidden && babbler?.stop()
    const drop = () => {
      babbler?.dispose()
      babbler = null
    }

    ctx.effect(() => {
      document.addEventListener('visibilitychange', onVisibility)
      shared = acquireAudio({
        ready: (a) => {
          babbler = new Babbler(a, busFor(a, 'voices'))
        },
        closed: drop,
      })
      return () => {
        document.removeEventListener('visibilitychange', onVisibility)
        drop()
        shared?.release()
        shared = null
      }
    }, 'babble audio')

    ctx.on('village/said', (e: Said) => {
      const a = shared?.context
      if (!babbler || a?.state !== 'running' || document.hidden) return
      babbler.said(e)
      voicesSpoke(a)
    })
    // A stop for someone who is not speaking leaves the speaker alone.
    ctx.on('village/said-stop', (e) => {
      if (babbler?.speaking === (voiceKey(e.villager) ?? e.villager)) babbler.stop()
      if (shared?.context) voicesStopped(shared.context)
    })

    if (import.meta.env.DEV) {
      const api: BabbleApi = {
        get babbler() { return babbler },
        get audio() { return shared?.context ?? null },
        get muted() { return shared?.context ? mixFor(shared.context).muted : storedFlag(ALL_MUTED) },
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
