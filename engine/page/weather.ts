// The sky a local realm is under (#450): its weather and its hour, changed smoothly. Asked for a weather or an hour,
// the march is moved towards it a frame at a time (`step`), never at once: rain comes over five seconds, a sky
// clouds over in six, and the sea's fog rolls in from the west over twelve, its front passing over the city.
//
// What sets the march itself at once (the R key, `engine.rain`, `engine.hour`, a realm's look) still does: what is
// asked here follows from where the march is, and a change made there is taken as the weather or hour now.
import type { Marcher } from './march.ts'

export type Weather = 'clear' | 'overcast' | 'fog' | 'rain'
export const WEATHERS: readonly Weather[] = ['clear', 'overcast', 'fog', 'rain']
/** What each weather is: how hard it rains, how overcast the sky is, how far the sea's fog is in. */
const SKY: Record<Weather, { rain: number; cloud: number; fog: number }> = {
  clear: { rain: 0, cloud: 0, fog: 0 },
  overcast: { rain: 0, cloud: 1, fog: 0 },
  fog: { rain: 0, cloud: 0, fog: 1 },
  rain: { rain: 1, cloud: 1, fog: 0 },
}
/** Seconds each part takes to come or go, end to end. */
const TAKES = { rain: 5, cloud: 6, fog: 12 }
/** The hour nearest the light a realm with no hour of its own is lit by (main.ts `sunOf(null)`: the sun east and two fifths up). */
export const UNSET = 9
/** How far west of the eye the fog's front starts, and how far east of it it ends up (finest cells): 6 km each way. */
const REACH = 60_000

export interface Skies {
  /** The weather asked for (or, after a change from outside, the one the march is nearest). */
  readonly weather: Weather
  /** Asks for a weather: the march goes over to it in the next seconds. */
  set(w: Weather): void
  /** The hour asked for (0 to 24), or null while the hour is the realm's unset one. */
  readonly hour: number | null
  /** Asks for an hour: the light goes round to it the short way, in a second or two. */
  glide(h: number): void
  /** Whether anything is still on its way. */
  readonly moving: boolean
  /** A frame: `dt` seconds since the last. */
  step(dt: number): void
}

/**
 * `hour` and `setHour` are the page's (main.ts): the hour the march is lit for, and what lights it for another.
 * `east` is where the eye is, east (finest cells), to start the fog's front west of it.
 */
export function skies(march: Marcher, hour: () => number | null, setHour: (h: number) => void, east: () => number): Skies {
  let weather: Weather = march.rain > 0 ? 'rain' : 'clear'
  // What this last set on the march: anything else there was set from outside.
  const told = { rain: march.rain, cloud: march.cloud, fog: march.fog, hour: hour() }
  let target = { ...SKY[weather] }, wanted: number | null = null
  // How far the fog's front has come, 0 (6 km west of where the eye was) to 1 (6 km east), and where it began.
  let rolled = 1, from = 0
  const toward = (now: number, to: number, perSecond: number, dt: number) => (now < to ? Math.min(to, now + perSecond * dt) : Math.max(to, now - perSecond * dt))
  const smooth = (t: number) => t * t * (3 - 2 * t)
  const self: Skies = {
    get weather() { return weather },
    set(w) {
      weather = w
      target = { ...SKY[w] }
      // Fog that comes in comes from the sea: its front starts west of the eye and rolls east over the city.
      if (w === 'fog' && march.fog < 0.01) { rolled = 0; from = east() - REACH; march.front = from }
    },
    get hour() { return wanted ?? hour() },
    glide(h) { wanted = ((h % 24) + 24) % 24 },
    get moving() { return wanted !== null || march.rain !== target.rain || march.cloud !== target.cloud || march.fog !== target.fog || rolled < 1 },
    step(dt) {
      dt = Math.min(dt, 0.1)
      // Set from outside (the R key, a realm's look, a check): that is the weather now, and the hour.
      if (march.rain !== told.rain || march.cloud !== told.cloud || march.fog !== told.fog) {
        target = { rain: march.rain, cloud: march.cloud, fog: march.fog }
        weather = march.fog > 0.5 ? 'fog' : march.rain > 0.5 ? 'rain' : march.cloud > 0.5 ? 'overcast' : 'clear'
        rolled = 1
      }
      if (hour() !== told.hour) wanted = null
      // The weather, each part at its own pace.
      if (march.rain !== target.rain) march.rain = toward(march.rain, target.rain, 1 / TAKES.rain, dt)
      if (march.cloud !== target.cloud) march.cloud = toward(march.cloud, target.cloud, 1 / TAKES.cloud, dt)
      if (rolled < 1) {
        rolled = Math.min(1, rolled + dt / TAKES.fog)
        march.front = rolled < 1 ? from + 2 * REACH * smooth(rolled) : 1e9
      }
      // Fog comes in thick behind its front (in two seconds the bank west of it is whole), and thins as it lifts.
      if (march.fog !== target.fog) march.fog = toward(march.fog, target.fog, march.fog < target.fog ? 0.5 : 2 / TAKES.fog, dt)
      if (march.fog === 0 && target.fog === 0) march.front = 1e9
      // The hour, the short way round the clock: quickly at first and gently at the end, over about a second and a half.
      if (wanted !== null) {
        const now = hour() ?? UNSET
        let d = wanted - now
        if (d > 12) d -= 24
        if (d < -12) d += 24
        const next = Math.abs(d) < 0.01 ? wanted : now + d * Math.min(1, dt * 3.5) + Math.sign(d) * Math.min(Math.abs(d), dt * 0.4)
        setHour(next)
        if (next === wanted) wanted = null
      }
      Object.assign(told, { rain: march.rain, cloud: march.cloud, fog: march.fog, hour: hour() })
    },
  }
  return self
}
