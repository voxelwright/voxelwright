// #47 setup, dev only: ?villager=gen&setup=1 turns the kitchen table into a felt
// workshop where a new villager is made from a description and tuned with sewing
// tools. main.ts imports this only in dev builds with the flag, so production
// contains none of it.
//
// Live: the description goes to the host (POST /people/:id/villagers), a model
// writes the villager as module text, and it runs only in the prop sandbox; only
// checked data comes back and ./assemble.ts makes the Figure. &from=<run-id>
// stitches a saved round-1 result instead (home/generated/villagers/<run-id>/),
// so the scene works without a model. Tuning never calls the model again: the
// result is the module text plus five slider values.
import * as THREE from 'three/webgpu'
import type { Context } from 'cordis'
import { own } from '../../kernel'
import { ROUTINES, SCALE } from '../../plugins/villagers'
import { validate } from '../../props/rebuild'
import { PropBox } from '../../props/sandbox'
import { familyTemplates, makeVillager, ME, personaTemplates, remakeVillager, saveTemplate, sendOffVillager, type HumourDial, type PatternData } from '../../villager'
import { Babbler } from '../../voice/engine'
import { clampVoice, voiceFromDescription } from '../../voice/gen'
import { registerVoice, unregisterVoice, VOICES, type VoiceProfile } from '../../voice/profiles'
import { TYPE_RATE } from '../../voice/text'
import { contactShadows, disposeShadows, stepCrowd } from '../cast'
import { Villager, type Figure } from '../rig'
import { SPOTS } from '../world'
import { assemble } from './assemble'
import { build, check } from './build'
import { accentMeshes, hueTurn, pieces, Puppet, type Piece } from './setup-stitch'
import { controls, HUE_SPAN, KEYS, TAG_CSS, type Key, type Layout } from './sliders'
import { feltInk } from './setup-controls'
import { checked, dialsOf, fallbackPersona, personaNotes, roleFor, tunedLine, type Persona } from './setup-persona'
import { footFor, rack, refOf, type RackCard } from './setup-rack'
import { HAND, MAT, TOP, workshop } from './workshop'
import type { Meta } from './load'
import { strategyFor, type Strategy } from './setup-strategy'
import { rotateHue } from './sliders'

type State = 'empty' | 'waiting' | 'stitching' | 'tuning' | 'leaving' | 'failed'
export type Tuning = Record<Key, number>
/** What a finished villager is, as data: never the model again, only this. */
export interface Made { source: { from?: string; item?: string }; description: string; accent: string; module: string; arm: 'code' | 'spec'; name: string; persona: Persona; template: string | null; tuning: Tuning }

const BOOK = '"Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif'
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)')
const params = new URLSearchParams(location.search)
const FROM = params.get('from')
/** The page's own person (villager.ts ME). The dev-only &person= picks another listed person; the host answers only if this tab's link is theirs (#40). */
const PERSON = /^[a-z][a-z0-9-]{0,31}$/.test(params.get('person') ?? '') ? params.get('person')! : ME
const ACCENT = /^#[0-9a-f]{6}$/i.test(params.get('accent') ?? '') ? params.get('accent')! : '#c8553d'
const OWNER = PERSON.charAt(0).toUpperCase() + PERSON.slice(1)
/** How a made villager is tuned: 1 (the default) the cheval mirror in the room; b and bench kept from the regroups (setup-strategy.ts). */
const STRATEGY = params.get('setup') ?? '1'
/** Where it lands when it hops off the table: a spot the walk routes know. */
const LANDING = 'seatNear'

/** Slider values to what they change. 0.5 is the villager as made. */
export const tune = {
  size: (v: number) => 2 ** ((v - 0.5) * 0.64),
  hue: (v: number) => (v - 0.5) * 2 * HUE_SPAN,
  pitch: (v: number) => (v - 0.5) * 14,
  pace: (v: number) => 2 ** ((v - 0.5) * 1.4),
  energy: (v: number) => 2 ** ((v - 0.5) * 1.4),
}

export default {
  name: 'villagersetup',
  inject: ['stage', 'view'],
  apply(ctx: Context) {
    const { stage, view } = ctx
    const phys = stage.features().has('phys')
    const group = new THREE.Group()
    group.name = 'villager setup'
    const shop = workshop()
    group.add(shop.group)
    let made: Made | null = null
    let fig: Figure | null = null
    let puppet: Puppet | null = null
    let hueShift: ReturnType<typeof hueTurn> | null = null
    let base: { voice: VoiceProfile; speed: number; bob: number } | null = null
    let voiceKey: string | null = null
    let state: State = 'empty'
    let seq = 0
    const walkers: Villager[] = []
    let blobs: THREE.Mesh[] = []
    const kept: Made[] = []
    const timings: Record<string, number> = {}
    let box: PropBox | null = null
    /** Set when the scene is unloaded: a make, remake or send-off still in flight then does nothing more. */
    let disposed = false
    /** The waiting tag's seconds counter while a make is in flight. */
    let clock = 0
    /** Every voice this scene registered, so unloading takes them all back. */
    const voiceKeys = new Set<string>()
    /** The host's profile of this person and its jokes dial (GET persona-templates). Until it answers, the dial is clean or cheeky. */
    let PROFILE: unknown = null
    let HUMOUR_DIAL: HumourDial = { locked: null }
    /** How the villager is tuned (setup-strategy.ts); null is the bench (round 6, &setup=bench). */
    let S: Strategy | null = null

    const tools = controls(stage, {
      input: (key, v) => applyTuning(key, v),
      release: (key) => {
        if (!made) return
        say(tunedLine({ warmth: made.tuning.warmth, playful: made.tuning.playful, chatty: made.tuning.chatty }, seq++), true)
        // A bigger or smaller villager: the camera eases to frame it again (never during the drag).
        if (key === 'size' && state === 'tuning' && !S) atTable()
      },
      locked: () => note(lockedNote()),
    })
    group.add(tools.group)
    // Crude is never chosen on the table: it is only ever the household admin's setting for a grown-up.
    tools.lock('humour', true)
    const lockedNote = () => HUMOUR_DIAL.locked === null
      ? "Crude isn't picked here. Only the household's admin can set it, for a grown-up."
      : HUMOUR_DIAL.by === 'admin'
        ? `${HUMOUR_DIAL.locked === 'crude' ? 'Crude jokes are on' : `Jokes stay ${HUMOUR_DIAL.locked}`} for ${OWNER}, set by the household's admin.`
        : `${OWNER} asked to keep it clean, so the jokes stay clean.`
    /** The dial's position for a host-locked level: clean 0, cheeky 0.5, crude 1. */
    const lockedAt = () => HUMOUR_DIAL.locked === null ? null : HUMOUR_DIAL.locked === 'crude' ? 1 : HUMOUR_DIAL.locked === 'cheeky' ? 0.5 : 0
    const patterns = rack(stage, (card) => onPattern(card))
    group.add(patterns.group)
    own(ctx, group)

    // The notebook and its pencil step aside while the table is a workshop.
    const table = stage.scene.getObjectByName('table')
    const aside = [table?.getObjectByName('notebook'), table?.children.find((c) => c.type === 'Group' && Math.abs(c.position.x - 0.3) < 0.01 && Math.abs(c.position.z - 0.18) < 0.01)].filter((o): o is THREE.Object3D => Boolean(o?.visible))
    ctx.effect(() => {
      for (const o of aside) o.visible = false
      return () => {
        for (const o of aside) o.visible = true
      }
    }, 'workshop clears the table')

    // ── The camera leans over the table ─────────────────────────────────────
    // On a tall, narrow screen the seat's 40 degree lens cannot take in the bench from inside the
    // kitchen, so the workshop widens it (and puts it back when the camera leaves the table).
    const seatFov = stage.camera.fov
    const lens = (fov: number) => {
      if (stage.camera.fov === fov) return
      stage.camera.fov = fov
      stage.camera.updateProjectionMatrix()
    }
    // Wide: the whole bench, about 1.7 m of tools, across the screen. Narrow (a phone held upright): the
    // mat and the grid of tools before it, about a metre across, from higher up so the rows stack down the screen.
    const layoutFor = (): Layout => (innerWidth / innerHeight < 0.9 ? 'narrow' : 'wide')
    let layout: Layout = layoutFor()
    /** Narrow, the camera looks down this slope (up per metre toward you): low enough to see a villager's face, not its back. */
    const NARROW_SLOPE = 0.8
    // The villager's bounds in its root's own space (set when it is stitched).
    let body: THREE.Box3 | null = null
    const corner = new THREE.Vector3()
    const centre = new THREE.Vector3()
    /**
     * A villager's box through a matrix and a camera, as a rectangle on the page. The top face is taken at half its
     * width and depth: a figure narrows to its crown, and a box's back top corners would read as head room it doesn't use.
     */
    const rectOf = (box: THREE.Box3, matrix: THREE.Matrix4, camera: THREE.Camera) => {
      let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity
      box.getCenter(centre)
      for (let i = 0; i < 8; i++) {
        const k = i & 2 ? 0.5 : 1
        corner.set(centre.x + ((i & 1 ? box.max.x : box.min.x) - centre.x) * k, i & 2 ? box.max.y : box.min.y, centre.z + ((i & 4 ? box.max.z : box.min.z) - centre.z) * k).applyMatrix4(matrix).project(camera)
        const x = ((corner.x + 1) / 2) * innerWidth, y = ((1 - corner.y) / 2) * innerHeight
        left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y)
      }
      return { left, top, right, bottom }
    }
    /** Where the villager is on screen now, or null. */
    const villagerRect = () => {
      if (!fig || !body) return null
      fig.root.updateMatrixWorld()
      return rectOf(body, fig.root.matrixWorld, stage.camera)
    }
    /**
     * On a phone or a tablet the tools need the near half of the table, so a big villager is shown smaller while it is on the bench
     * (down to about two fifths); its tuned size is unchanged, and it grows to it as it hops down (sendOff).
     */
    let bench = 1
    let fitBench = false
    // Fitting the camera to the villager: a stand-in camera tried at growing distances until the villager, at its tuned
    // size, fits between the speech note's room at the top and the tools below it.
    const fitCam = new THREE.PerspectiveCamera()
    const fitAt = new THREE.Matrix4()
    const fitTo = (look: THREE.Vector3, dir: THREE.Vector3, dist: number, fov: number) => {
      if (!body || !made) return dist
      const narrow = layout === 'narrow'
      fitCam.fov = fov
      fitCam.aspect = innerWidth / innerHeight
      fitCam.near = 0.05
      fitCam.far = 60
      fitCam.updateProjectionMatrix()
      // Room at the top for the speech note (and, narrow, the name tag above it, a line taller with a pattern's name).
      const top = narrow ? (made.template ? 215 : 180) : 132
      // The front of the first ribbon (sliders.ts PLACES.narrow.warmth), where its end tags begin.
      const ribbon = new THREE.Vector3(-0.21, TOP, 0.14)
      // Wide, the tool row's tags begin about here; a phone's ribbons are its own limit.
      const toolRow = new THREE.Vector3(-0.17, TOP, 0.53)
      const room = (p: THREE.Vector3) => ((1 - p.clone().project(fitCam).y) / 2) * innerHeight
      const fits = () => {
        // Turned as the puppet will stand: toward the camera, a little to one side.
        const k = SCALE * tune.size(made!.tuning.size) * bench
        fitAt.compose(standAt(), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -turn()), new THREE.Vector3(k, k, k))
        fitCam.position.copy(look).addScaledVector(dir, dist)
        fitCam.lookAt(look)
        fitCam.updateMatrixWorld(true)
        const r = rectOf(body!, fitAt, fitCam)
        // Narrow: above the ribbons' tags; wide: above the row of tools along the near edge.
        const bottom = narrow ? room(ribbon) - 16 : room(toolRow) - 6
        return r.top >= top && r.bottom <= bottom && r.left >= 12 && r.right <= innerWidth - 12
      }
      /** Wide: whether the tools' tags still have room below if the view tilts up a little. */
      const slack = () => room(new THREE.Vector3(-0.17, TOP, 0.66)) + 50 < innerHeight - 96
      if (fitBench) {
        // Once, as it is stitched: the bench size for a phone or a tablet; a roomy wide screen shows it at its own size.
        bench = 1
        if (narrow || innerWidth / innerHeight < 1.5) while (bench > 0.4 && !fits()) bench *= 0.95
        fitBench = false
      }
      // A tall villager: first tilt the view up (the table slides down the screen, where there is room), then step back.
      for (let i = 0; i < 24 && !fits(); i++) {
        if (!narrow && slack()) look.y += 0.02
        else dist *= 1.05
      }
      return dist
    }
    /** The last pose the camera was sent to, so the villager can turn to where the camera will be. */
    let lastPose: { position: THREE.Vector3; look: THREE.Vector3 } | null = null
    const pose = () => (lastPose = poseFor())
    const poseFor = () => {
      const aspect = innerWidth / innerHeight
      const narrow = layout === 'narrow'
      const own = S?.pose?.(state)
      if (own) return own
      if (!narrow && state === 'waiting') {
        // Wide, while the pattern is made: close over the mat, so the cutting and the words on the sheet read.
        lens(seatFov)
        const half = Math.atan(Math.tan(THREE.MathUtils.degToRad(seatFov / 2)) * aspect)
        const look = new THREE.Vector3(MAT.x + 0.02, TOP, MAT.z - 0.07)
        return { position: look.clone().addScaledVector(new THREE.Vector3(0, 0.8, 1).normalize(), (MAT.w / 2 + 0.25) / Math.tan(half)), look }
      }
      if (narrow && (state === 'empty' || state === 'failed' || state === 'waiting')) {
        // Narrow, before there is a villager: the rack and the mat (where the pattern is made), with the slip on the near half of the table.
        lens(56)
        const h = Math.atan(Math.tan(THREE.MathUtils.degToRad(28)) * aspect)
        // Looking at the mat's back half, so the table runs down to the slip instead of a band of rug.
        const look = new THREE.Vector3(MAT.x, TOP, MAT.z - 0.02)
        return { position: look.clone().addScaledVector(new THREE.Vector3(0, 1.0, 1).normalize(), Math.max(0.42, patterns.width() / 2 + 0.04) / Math.tan(h)), look }
      }
      const fov = narrow ? 56 : seatFov
      lens(fov)
      const half = Math.atan(Math.tan(THREE.MathUtils.degToRad(fov / 2)) * aspect)
      let dist = narrow ? 0.42 / Math.tan(half) : THREE.MathUtils.clamp(1.08 / Math.tan(half), 1.85, 4.4)
      // Narrow: the villager at the top, then the ribbons, then the two rows of tools down to the table's edge.
      const look = narrow ? new THREE.Vector3(-0.21, TOP, MAT.z + 0.07) : new THREE.Vector3(-0.17, TOP + 0.1, MAT.z - 0.02)
      const dir = new THREE.Vector3(0, narrow ? NARROW_SLOPE : 0.5, 1).normalize()
      if (state === 'stitching' || state === 'tuning') dist = fitTo(look, dir, dist, fov)
      return { position: look.clone().addScaledVector(dir, dist), look }
    }
    /** Where the villager stands on the mat: narrow, further back, so the ribbons before it stay clear. */
    const standAt = () => S?.standAt?.() ?? new THREE.Vector3(MAT.x - 0.1, TOP + 0.006, MAT.z - (layout === 'narrow' ? 0.24 : 0.07))
    /** How far it stands turned from the camera: three quarters on a wide screen, nearly square on to a phone. */
    const turn = () => S?.turn?.() ?? (layout === 'narrow' ? 0.18 : 0.35)
    /**
     * Regroup: a pose that frames the villager, at its biggest size so a change of size shows, centred between these page
     * rows and columns. The camera pans (look and position together) and steps back until it fits.
     */
    const front = (o: { top: number; bottom: number; left?: number; right?: number; slope: number; fov?: number }) => {
      const fov = o.fov ?? seatFov
      lens(fov)
      const left = o.left ?? 0, right = o.right ?? innerWidth
      const at = standAt()
      const dir = new THREE.Vector3(0, o.slope, 1).normalize()
      if (!body) return { position: at.clone().add(new THREE.Vector3(0, 0.25, 0)).addScaledVector(dir, 1.6), look: at.clone().add(new THREE.Vector3(0, 0.12, 0)) }
      fitCam.fov = fov
      fitCam.aspect = innerWidth / innerHeight
      fitCam.near = 0.05
      fitCam.far = 60
      fitCam.updateProjectionMatrix()
      const k = SCALE * tune.size(1)
      fitAt.compose(at, new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -turn()), new THREE.Vector3(k, k, k))
      const look = at.clone().add(new THREE.Vector3(0, body.max.y * k * 0.5, 0))
      const wantX = (left + right) / 2, wantY = (o.top + o.bottom) / 2
      const tan = Math.tan(THREE.MathUtils.degToRad(fov / 2))
      const near = new THREE.Vector3()
      // Nearest first: at each distance the view pans until the villager is centred, and the first distance where it fits wins.
      let dist = 0.3
      for (let n = 0; n < 90; n++, dist *= 1.03) {
        let r = { left: 0, top: 0, right: 0, bottom: 0 }
        let ahead = true
        for (let i = 0; i < 40; i++) {
          fitCam.position.copy(look).addScaledVector(dir, dist)
          fitCam.lookAt(look)
          fitCam.updateMatrixWorld(true)
          // Every corner must be in front of the lens, or its projection means nothing.
          for (let c = 0; c < 8 && ahead; c++) ahead = near.set(c & 1 ? body.max.x : body.min.x, c & 2 ? body.max.y : body.min.y, c & 4 ? body.max.z : body.min.z).applyMatrix4(fitAt).applyMatrix4(fitCam.matrixWorldInverse).z < -0.06
          if (!ahead) break
          r = rectOf(body, fitAt, fitCam)
          const wpp = (2 * dist * tan) / innerHeight
          const dx = (r.left + r.right) / 2 - wantX, dy = (r.top + r.bottom) / 2 - wantY
          if (Math.abs(dx) < 1 && Math.abs(dy) < 1) break
          look.x += THREE.MathUtils.clamp(dx * wpp * 0.8, -0.04, 0.04)
          look.y -= THREE.MathUtils.clamp(dy * wpp * 0.8, -0.04, 0.04)
        }
        if (ahead && r.bottom - r.top <= o.bottom - o.top && r.right - r.left <= right - left - 24 && r.top >= o.top - 2) break
      }
      return { position: look.clone().addScaledVector(dir, dist), look }
    }
    /** Regroup: close over the mat at every size, so the waiting is about the cutting. */
    const overMat = () => {
      lens(seatFov)
      const half = Math.atan(Math.tan(THREE.MathUtils.degToRad(seatFov / 2)) * (innerWidth / innerHeight))
      const look = new THREE.Vector3(MAT.x + 0.02, TOP, MAT.z - 0.07)
      return { position: look.clone().addScaledVector(new THREE.Vector3(0, 0.8, 1).normalize(), (MAT.w / 2 + (layout === 'narrow' ? 0.03 : 0.25)) / Math.tan(half)), look }
    }
    const arrange = () => {
      layout = layoutFor()
      shop.arrange(layout)
      tools.arrange(layout)
      patterns.arrange(layout)
      document.documentElement.dataset.vsLayout = layout
      if (puppet && state !== 'leaving') puppet.at.copy(standAt())
    }
    const atTable = () => {
      watching = null
      view.focus(pose(), 2.4)
      if (state === 'empty' || state === 'failed') {
        // Wide: the slip lies on the empty mat and the tools show quiet tags. Narrow: the slip sits on the
        // near half of the table, over where the tool tags hang, so only the ribbons' ends show (sliders.ts).
        slipAt = layout === 'wide' ? 'mat' : 'edge'
        tools.mode('preview')
        patterns.enable('on')
      }
    }
    /** Where the slip lies: on the empty mat, or at the near edge while the mat is busy or the camera is away. */
    let slipAt: 'mat' | 'edge' | 'front' = 'mat'
    // After the send-off the camera watches the new villager walk off for a while, then comes back.
    let watching: { walker: Villager; until: number } | null = null
    /** The heading the watching camera keeps ahead of, eased so a corner on the walker's route doesn't swing the view. */
    let watchHeading: number | null = null
    /** The walker's height on the floor, metres. */
    let watchSize = 0.4
    /** The furniture a watching camera must see past (the chairs and the table), as boxes; found once. */
    let blockers: THREE.Box3[] | null = null
    const blocking = () => blockers ??= ['chairs', 'table'].flatMap((name) => {
      const o = stage.scene.getObjectByName(name)
      if (!o) return []
      o.updateMatrixWorld(true)
      return (name === 'chairs' ? o.children : [o]).map((c) => new THREE.Box3().setFromObject(c).expandByScalar(0.02))
    })
    /** The watching camera's last clear spot (its angle off the heading and its height), kept while it stays clear. */
    let watchSpot: { a: number; h: number } | null = null
    const ray = new THREE.Ray(), hit = new THREE.Vector3()
    /** No chair or the table between the camera and the walker: its feet, middle and head, and both sides of its middle. */
    const clear = (cam: THREE.Vector3, p: THREE.Vector3, size: number) => {
      const side = new THREE.Vector3(cam.z - p.z, 0, p.x - cam.x).normalize().multiplyScalar(size * 0.45)
      const points = [0.08, 0.5, 0.95].map((f) => new THREE.Vector3(p.x, size * f, p.z))
      points.push(points[1].clone().add(side), points[1].clone().sub(side))
      return blocking().every((b) => !b.containsPoint(cam) && points.every((to) => {
        ray.origin.copy(cam)
        ray.direction.copy(to).sub(cam).normalize()
        return !ray.intersectBox(b, hit) || hit.distanceTo(cam) > to.distanceTo(cam)
      }))
    }
    const watchPose = (w: Villager) => {
      const narrow = layout === 'narrow'
      lens(narrow ? 50 : seatFov)
      // Ahead of it and to one side, at about its own height, so its face and front show as it walks, not its back.
      // The side is whichever keeps the camera inside the kitchen.
      const p = w.pos
      const yaw = w.fig.root.rotation.y
      watchHeading = watchHeading === null ? yaw : watchHeading + Math.atan2(Math.sin(yaw - watchHeading), Math.cos(yaw - watchHeading)) * 0.06
      // Far enough back to see all of it and the floor round it; of the angles that keep the camera inside the kitchen,
      // the most frontal.
      const size = watchSize
      const reach = Math.max(1.7, size * (narrow ? 5.2 : 4.4))
      const at = (a: number) => new THREE.Vector3(p.x + Math.sin(watchHeading! + a) * reach, 0, p.z + Math.cos(watchHeading! + a) * reach)
      const inside = (v: THREE.Vector3) => Math.abs(v.x) <= 2.2 && v.z >= -1.3 && v.z <= 2.6
      // Of those, one with nothing between it and the walker: the most frontal at its own height, else rising over the
      // chairs (looking down also keeps the dim ceiling out of the frame). The last clear spot is kept while it stays clear,
      // so the view doesn't hop between equals.
      const low = Math.max(1.3, size * 3)
      const spot = (s: { a: number; h: number }) => {
        const c = at(s.a)
        c.y = s.h
        return c
      }
      const fits = (s: { a: number; h: number }) => {
        const c = spot(s)
        return inside(c) && clear(c, p, size)
      }
      if (!watchSpot || !fits(watchSpot)) {
        const angles = [0.6, -0.6, 0.95, -0.95, 1.3, -1.3, 1.65, -1.65]
        const spots = [low, low + 0.35, low + 0.7].flatMap((h) => angles.map((a) => ({ a, h })))
        watchSpot = spots.find(fits) ?? spots.find((s) => inside(spot(s))) ?? { a: 1.65, h: low + 0.7 }
      }
      const cam = spot(watchSpot)
      cam.x = THREE.MathUtils.clamp(cam.x, -2.2, 2.2)
      cam.z = THREE.MathUtils.clamp(cam.z, -1.3, 2.6)
      const look = new THREE.Vector3(p.x, size * 0.35, p.z)
      return { position: cam, look }
    }
    const leaveTable = (rate?: number) => {
      lens(seatFov)
      view.focus(null, rate)
    }

    // ── Voice: our own context, started on the first touch or key ──────────
    let audio: AudioContext | null = null
    let babbler: Babbler | null = null
    const wake = () => {
      if (!audio) {
        audio = new AudioContext({ latencyHint: 'interactive' })
        babbler = new Babbler(audio, audio.destination)
      }
      if (audio.state !== 'running') void audio.resume()
    }
    addEventListener('pointerdown', wake, true)
    addEventListener('keydown', wake, true)

    // ── The page: the slip, a speech card, the name tag and the send-off ────
    const style = document.createElement('style')
    style.textContent = css()
    const slip = document.createElement('form')
    slip.className = 'vs-slip shown'
    slip.setAttribute('aria-label', 'Describe a new villager')
    const tab = document.createElement('div')
    tab.className = 'tab'
    tab.innerHTML = `<b>A new villager</b> <i>for ${OWNER}</i>`
    const ruled = document.createElement('label')
    ruled.className = 'ruled'
    const line = document.createElement('textarea')
    line.className = 'line'
    line.rows = 2
    line.maxLength = 300
    line.placeholder = 'e.g. a sleepy hedgehog who bakes bread before dawn'
    line.setAttribute('aria-label', 'Describe them in a line')
    ruled.append(line)
    const status = document.createElement('p')
    status.className = 'status'
    status.setAttribute('role', 'status')
    status.setAttribute('aria-live', 'polite')
    const sew = document.createElement('button')
    sew.type = 'submit'
    sew.className = 'sew'
    sew.textContent = 'Start sewing'
    const foot = document.createElement('div')
    foot.className = 'foot'
    foot.append(status, sew)
    slip.append(tab, ruled, foot)

    const card = document.createElement('div')
    card.className = 'vs-card'
    card.setAttribute('aria-hidden', 'true')
    const nametag = document.createElement('div')
    nametag.className = 'vs-name vs-tag'
    const done = document.createElement('button')
    done.type = 'button'
    done.className = 'vs-done vs-tag'
    done.textContent = 'Off you go'
    // A small paper note for plain explanations (a locked dial, a template made gentler).
    const noteEl = document.createElement('p')
    noteEl.className = 'vs-note'
    noteEl.setAttribute('role', 'status')
    noteEl.setAttribute('aria-live', 'polite')
    let noteTimer = 0
    /** A note; `heard` only for one the scene already shows (the saved card's tag): read out, not drawn over the speech. */
    const note = (text: string, heard = false) => {
      noteEl.textContent = text
      noteEl.classList.toggle('heard', heard)
      noteEl.classList.add('shown')
      clearTimeout(noteTimer)
      noteTimer = window.setTimeout(() => noteEl.classList.remove('shown'), 6000)
    }
    // Save as a pattern: the tuned persona as a template, kept on the host, optionally for the family.
    const saveTag = document.createElement('div')
    saveTag.className = 'vs-save vs-tag'
    const saveButton = document.createElement('button')
    saveButton.type = 'button'
    saveButton.textContent = 'Save as a pattern'
    const shareLabel = document.createElement('label')
    const share = document.createElement('input')
    share.type = 'checkbox'
    shareLabel.append(share, ' share with the family')
    saveTag.append(saveButton, shareLabel)
    // The picked pattern: its felt card, big, clipped to the slip. Clicking it puts it back on the rack.
    const chip = document.createElement('button')
    chip.type = 'button'
    chip.className = 'chip'
    chip.hidden = true
    chip.addEventListener('click', () => patterns.pick(null))
    slip.insertBefore(chip, ruled)

    ctx.effect(() => {
      document.head.append(style)
      document.body.append(slip, card, nametag, saveTag, done, noteEl)
      return () => {
        slip.remove()
        card.remove()
        nametag.remove()
        done.remove()
        saveTag.remove()
        noteEl.remove()
        clearTimeout(noteTimer)
        style.remove()
      }
    }, 'setup page')

    const setStatus = (text: string, tone: 'plain' | 'warm' | 'sorry' = 'plain') => {
      status.textContent = text
      status.dataset.tone = tone
    }
    // persona.json is household-visible (#42 visits): what the creator types becomes a personality everyone at home sees,
    // so the slip says so plainly. Nothing private (conversations, notes, profile) is ever put into it (host test 'privacy').
    const SHARED = 'Everyone at home sees their personality.'
    const READY = `Describe them or pick a pattern. ${SHARED}`
    setStatus(READY)

    // ── Saying things: a paper card over the villager, and its babble ──────
    let sayTimers: number[] = []
    let cardHide = 0
    const say = (text: string, short = false) => {
      if (!fig || !made) return
      for (const t of sayTimers) clearTimeout(t)
      sayTimers = []
      clearTimeout(cardHide)
      babbler?.stop()
      card.textContent = ''
      const words = text.split(/\s+/)
      const spans = words.map((w) => {
        const s = document.createElement('span')
        s.textContent = `${w} `
        card.append(s)
        return s
      })
      card.classList.add('shown')
      card.classList.toggle('short', short)
      if (puppet) puppet.speaking = true
      let chars = 0
      words.forEach((w, index) => {
        chars += w.length
        const at = reducedMotion.matches ? 0 : (chars / TYPE_RATE) * 1000
        sayTimers.push(window.setTimeout(() => {
          spans[index].classList.add('in')
          if (voiceKey) babbler?.said({ villager: voiceKey, word: w, index, last: index === words.length - 1 })
        }, at))
        chars += 1
      })
      const total = (chars / TYPE_RATE) * 1000
      sayTimers.push(window.setTimeout(() => puppet && (puppet.speaking = false), total + 400))
      cardHide = window.setTimeout(() => card.classList.remove('shown'), total + (short ? 1600 : 4200))
    }

    // ── Making: the host's model, or a saved round-1 result ────────────────
    const fetchSaved = async (id: string) => {
      if (!/^[\w-]+$/.test(id)) throw new Error('that saved pattern has an odd name')
      const metaRes = await fetch(`/generated/villagers/${id}/meta.json`)
      if (!metaRes.ok) throw new Error(`no saved pattern called ${id}`)
      const meta = await metaRes.json() as Meta
      const res = await fetch(`/generated/villagers/${id}/${meta.file}`)
      if (!res.ok) throw new Error(`the saved pattern ${id} has no ${meta.file}`)
      return { meta, text: await res.text() }
    }

    /** Module text (or spec JSON) to a Figure, entirely through the sandbox and the trusted assembler. */
    /** `role`: the one the host returned for this villager (asked for by the page); it decides the felt kit's mark. */
    const figureFrom = async (arm: 'code' | 'spec', text: string, accent: string, role?: string) => {
      const seed = 31 + kept.length * 17
      if (arm === 'spec') {
        const raw = JSON.parse(text)
        const { spec } = check(raw)
        return { fig: build(spec, phys, { accent }, seed), name: spec.name, role: spec.role as string, bark: spec.bark, voice: spec.voice as VoiceProfile | null, persona: field(raw, 'persona') }
      }
      alive()
      box ??= new PropBox()
      const t0 = performance.now()
      const result = await box.run(text)
      alive()
      timings.sandboxMs = performance.now() - t0
      if (!result.ok) throw new Error(`sandbox: ${result.reason}`)
      const checked = validate(result.data)
      if ('reason' in checked) throw new Error(`rejected: ${checked.reason}`)
      // Saved round-1 results predate assemble's look checks, so a replay skips them; live results must pass.
      // The bench shows a puppet with its own motion and grows each piece in by scale: its felt stays unskinned (../soft.ts).
      const a = assemble(checked.prop, result.data, phys, accent, seed, !FROM, undefined, undefined, undefined, role, undefined, undefined, false)
      // The kit notes the role whose mark it sewed ("kit: keeper's mark, …"), for the checks.
      lastMark = a.fixes.map((f) => /^kit: (\w+)'s mark/.exec(f)?.[1]).find(Boolean) ?? null
      return { fig: a.fig, name: a.about.name, role: a.about.role as string, bark: a.about.bark, voice: a.about.voice as VoiceProfile | null, persona: field(field(field(result.data, 'villager'), 'about'), 'persona') }
    }

    /** Thrown after an await when the scene was unloaded meanwhile: the rest of a make is then a no-op. */
    const alive = () => {
      if (disposed) throw new Error('unloaded')
    }
    const start = async (description: string) => {
      if (disposed) return
      if (state === 'waiting' || state === 'stitching' || state === 'leaving') return
      description = description.trim().replace(/\s+/g, ' ')
      const template = patterns.picked?.template ?? null
      // A pattern alone is enough: the model gets the pattern's name as the description.
      if (!description && template && !FROM) description = `a villager who is a ${template.name.toLowerCase()}`
      if (!description && !FROM) {
        setStatus('Write a line about them first, or pick a pattern card from the rack.', 'warm')
        line.focus()
        return
      }
      slip.classList.remove('invite')
      patterns.enable('quiet')
      state = 'waiting'
      atTable()
      tools.mode('off')
      // The progress is a paper tag on the bench, at the mat's front edge; the words are on the pattern sheet.
      slipAt = 'front'
      slip.classList.add('waiting')
      line.readOnly = true
      sew.disabled = true
      shop.pattern(description)
      shop.activity('working')
      const t0 = performance.now()
      const elapsed = () => Math.round((performance.now() - t0) / 1000)
      let repairing = false
      clock = window.setInterval(() => setStatus(repairing ? `One piece didn't sit right, so it's being re-cut… ${elapsed()} s` : `Drafting the pattern from your words… ${elapsed()} s`, 'warm'), 1000)
      setStatus(FROM ? 'Unfolding a saved pattern…' : 'Drafting the pattern from your words… usually about a minute.', 'warm')
      let fail: string | null = null
      try {
        let arm: 'code' | 'spec' = 'code', text = '', source: Made['source'] = {}, hostPersona: unknown = null, hostRefusal = ''
        let hostDials: Record<string, number> | null = null
        let role: string | undefined
        if (FROM) {
          const saved = await fetchSaved(FROM)
          alive()
          arm = saved.meta.arm
          text = saved.text
          source = { from: FROM }
        } else {
          // The role the person's words (or the picked pattern) ask for; none, and the model's about() decides.
          const answer = await makeVillager(PERSON, description, ACCENT, template ? refOf(patterns.picked!, PERSON) : undefined, roleFor(description, template?.id))
          alive()
          timings.modelMs = answer.ms
          if (!answer.ok) {
            fail = answer.why === 'away' || answer.why === 'busy' || answer.why === 'link' || answer.why === 'refused' ? answer.why : 'model'
            throw new Error(answer.why)
          }
          text = answer.module
          role = answer.role
          hostPersona = answer.persona
          hostRefusal = answer.personaRefused ?? ''
          hostDials = answer.dials
          source = { item: answer.item }
          timings.costUsd = answer.costUsd ?? NaN
        }
        lastRole = role ?? null
        let got: Awaited<ReturnType<typeof figureFrom>> | null = null
        let moduleRefusal = ''
        try {
          got = await figureFrom(arm, text, ACCENT, role)
        } catch (error) {
          if (disposed || FROM || !source.item) throw error
          moduleRefusal = String(error instanceof Error ? error.message : error)
        }
        if (!FROM && source.item && (!got || hostRefusal)) {
          // The home's checks refused the module, or the host's check its persona: one repair, with the reasons, and the clock still counting.
          const reason = [moduleRefusal, hostRefusal].filter(Boolean).join('; ')
          lastRefusal = reason
          repairing = true
          setStatus(`One piece didn't sit right, so it's being re-cut… ${elapsed()} s`, 'warm')
          const again = await remakeVillager(PERSON, source.item, reason)
          alive()
          timings.remakeMs = again.ms
          if (!again.ok) {
            fail = again.why === 'away' || again.why === 'link' || again.why === 'refused' ? again.why : 'model'
            throw new Error(`remake: ${again.why} (first: ${reason})`)
          }
          text = again.module
          role = again.role ?? role
          if (again.personaRefused) throw new Error(`remake: ${again.personaRefused} (first: ${reason})`)
          hostPersona = again.persona
          hostDials = again.dials
          timings.costUsd = (timings.costUsd || 0) + (again.costUsd ?? NaN)
          got = await figureFrom(arm, text, ACCENT, role)
          timings.repaired = 1
        }
        if (!got) throw new Error(moduleRefusal)
        await patternsReady
        alive()
        // The persona: the host's, checked by #42's checkPersona there (a live one always has it); a saved result's
        // own, else a plain one from the words. The dials are only where the sliders start.
        const persona = checked(hostPersona) ?? checked(got.persona) ?? fallbackPersona(description, got.role, got.name)
        const dials = hostDials ?? dialsOf(persona)
        const tuning = Object.fromEntries(KEYS.map((k) => [k, 0.5])) as Tuning
        tuning.warmth = dials.warmth
        tuning.playful = dials.playful
        tuning.chatty = dials.chatty
        tuning.humour = lockedAt() ?? dials.humour
        // A live villager is called by its checked persona's name (the one sent off); a saved result by its own.
        made = { source, description, accent: ACCENT, module: text, arm, name: checked(hostPersona)?.name ?? got.name, persona, template: template?.name ?? null, tuning }
        tools.init(tuning)
        clearInterval(clock)
        timings.readyMs = performance.now() - t0
        await stitch(got.fig, made.name, got.bark, got.voice ?? voiceFromDescription(description))
      } catch (error) {
        clearInterval(clock)
        // Unloaded meanwhile: nothing is left to tell, and nothing may be added to a scene that is gone.
        if (disposed) return
        failed(fail ?? 'sewing', String(error instanceof Error ? error.message : error))
      }
    }

    const failed = (why: string, detail: string) => {
      state = 'failed'
      timings.failedMs = performance.now()
      shop.activity('tidy')
      slipAt = 'mat'
      slip.classList.remove('waiting')
      line.readOnly = false
      sew.disabled = false
      sew.textContent = 'Try again'
      patterns.enable('on')
      lastFailure = detail
      const words: Record<string, string> = {
        away: "The workshop's helper isn't in just now, so nothing was sewn. Your words are still here.",
        busy: "Another villager is still on the table. Let's finish that one first.",
        link: 'This page needs your latest link from the host, so nothing was sewn. Open it and try again.',
        refused: "This page was opened with someone else's link, so nothing was sewn.",
        model: "The pattern didn't come together this time, so nothing was sewn. Try again, or change a word or two.",
        sewing: "The pieces didn't fit together this time, so nothing was sewn. Try again, or change a word or two.",
      }
      setStatus(words[why] ?? words.sewing, 'sorry')
      line.focus({ preventScroll: true })
    }
    let lastFailure = ''
    /** The last send-off: the host's name for the person's villager now, 'sending', or why it failed. */
    let sentOff: string | null = null
    /** The home's checks' reason for refusing the first live module, sent with the one repair request. */
    let lastRefusal = ''
    let lastRole: string | null = null
    let lastMark: string | null = null

    // ── Stitching, part by part, with a needle pass for each ───────────────
    const stitch = async (made_: Figure, name: string, bark: string, rawVoice: VoiceProfile) => {
      alive()
      state = 'stitching'
      fig = made_
      shop.activity('tidy')
      shop.pattern(made!.description, name, personaNotes(made!.persona, made!.template))
      const accent = accentMeshes(fig, ACCENT)
      const parts = pieces(fig, accent)
      hueShift = hueTurn(fig, accent)
      tools.felt(hueShift.main)
      // Everything hidden; each piece grows in from its own scale.
      const scales = new Map<THREE.Object3D, THREE.Vector3>()
      for (const p of parts) for (const o of p.objects) {
        scales.set(o, o.scale.clone())
        o.visible = false
      }
      // The slip lifts away as the stitching starts; the mat is the show now.
      slip.classList.remove('shown', 'waiting')
      slip.inert = true
      patterns.enable('off')
      // Its bounds, in its own space and made round about the up axis, so the camera can frame it however it turns.
      fig.root.position.set(0, 0, 0)
      fig.root.rotation.set(0, 0, 0)
      fig.root.scale.setScalar(1)
      fig.root.updateMatrixWorld(true)
      body = new THREE.Box3().setFromObject(fig.root)
      body.min.y = Math.min(0, body.min.y)
      fitBench = true
      atTable()
      const own = S?.fit?.(body)
      if (own != null) {
        bench = own
        fitBench = false
      }
      const at = standAt()
      // It turns to where the camera is going, not where it is on the way.
      const cam = lastPose?.position ?? stage.camera.position
      puppet = new Puppet(fig, at, Math.atan2(cam.x - at.x, cam.z - at.z) - turn())
      fig.root.scale.setScalar(SCALE * bench)
      group.add(fig.root)
      fig.root.updateMatrixWorld(true)
      // Its voice: the model's, pulled into range; registered under a key that cannot collide.
      base = { voice: clampVoice(rawVoice), speed: fig.speed, bob: fig.bob }
      voiceKey = registerVoice(`setup-${kept.length + 1}`, { ...base.voice })
      voiceKeys.add(voiceKey)
      setStatus(`Stitching ${name} together…`, 'warm')
      const t0 = performance.now()
      for (const p of parts) {
        await reveal(p, scales)
        alive()
      }
      timings.stitchMs = performance.now() - t0
      // Up it hops, looks at you and says hello.
      state = 'tuning'
      puppet.looking = true
      puppet.hop()
      nametag.textContent = ''
      const b = document.createElement('b')
      b.textContent = name
      nametag.append(b)
      if (made!.persona.role) {
        const small = document.createElement('small')
        const role = made!.persona.role
        small.textContent = role.length > 30 ? `${role.slice(0, 30).replace(/\s+\S*$/, '')}…` : role
        nametag.append(' ', small)
      }
      // Made from a pattern: the pattern's name rides on the tag, so you can see it took.
      if (made!.template) {
        const from = document.createElement('i')
        from.textContent = `${made!.template} pattern`
        // A strip of the pattern card's own felt, so it matches the card standing at the rack's end.
        const used = patterns.picked
        if (used) {
          const f = feltInk(patterns.feltOf(used))
          from.style.setProperty('--felt', f.felt)
          from.style.setProperty('--ink', f.ink)
        }
        nametag.append(from)
      }
      nametag.classList.add('shown')
      if (!S?.tuning) tools.mode('on')
      patterns.enable('off')
      done.classList.add('shown')
      saveTag.classList.add('shown')
      setStatus('')
      // Keyboard users land on the first tool; Tab walks the rest and then the send-off tag.
      if (S?.tuning) S.tuning()
      else if (slip.contains(document.activeElement) || document.activeElement === document.body) tools.focus('size')
      await wait(reducedMotion.matches ? 0 : 450)
      if (disposed) return
      say(bark)
    }

    const pieceTimes: Record<string, number> = {}
    const reveal = async (p: Piece, scales: Map<THREE.Object3D, THREE.Vector3>) => {
      const t0 = performance.now()
      for (const o of p.objects) o.visible = true
      const box3 = new THREE.Box3()
      for (const o of p.objects) {
        o.scale.copy(scales.get(o)!)
        box3.expandByObject(o)
      }
      const centre = box3.getCenter(new THREE.Vector3())
      const span = Math.min(0.2, Math.max(0.05, box3.getSize(new THREE.Vector3()).x))
      if (reducedMotion.matches) {
        pieceTimes[p.name] = 0
        return
      }
      const seconds = 0.38
      const grow = new Promise<void>((resolve) => {
        let u = 0
        const off = ctx.on('village/frame', (dt) => {
          u = Math.min(1, u + dt / seconds)
          // A soft pop with a little overshoot, as a stuffed piece settles.
          const k = u >= 1 ? 1 : 1 + 2.4 * (u - 1) ** 3 + 1.4 * (u - 1) ** 2
          for (const o of p.objects) o.scale.copy(scales.get(o)!).multiplyScalar(Math.max(0.001, k))
          if (u >= 1) {
            off()
            resolve()
          }
        })
      })
      await Promise.all([grow, shop.pass(centre, span, seconds + 0.04)])
      pieceTimes[p.name] = performance.now() - t0
    }
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

    // ── Tuning: every change is local and immediate; nothing calls a model ─
    const applyTuning = (key: Key, v: number) => {
      if (!fig || !made || !base) return
      made.tuning[key] = v
      const voice = voiceKey ? VOICES[voiceKey] : null
      if (key === 'size') fig.root.scale.setScalar(SCALE * tune.size(v) * bench)
      if (key === 'hue' && hueShift) hueShift.shift.value = tune.hue(v)
      if (key === 'pitch' && voice) voice.pitch = clampVoice({ ...voice, pitch: base.voice.pitch * 2 ** (tune.pitch(v) / 12) }).pitch
      if (key === 'pace' && voice) {
        voice.rate = clampVoice({ ...voice, rate: base.voice.rate * tune.pace(v) }).rate
        tools.tempo(tune.pace(v))
      }
      if (key === 'energy') {
        const e = tune.energy(v)
        fig.speed = THREE.MathUtils.clamp(base.speed * e, 0.12, 0.8)
        fig.bob = THREE.MathUtils.clamp(base.bob * e, 0, 0.1)
        if (puppet) puppet.energy = e
      }
    }

    // ── Done: down it hops and off to the kitchen's chores ─────────────────
    const sendOff = async () => {
      if (state !== 'tuning' || !fig || !puppet || !made) return
      state = 'leaving'
      tools.mode('off')
      done.classList.remove('shown')
      saveTag.classList.remove('shown')
      const record: Made = { ...made, tuning: { ...made.tuning } }
      // A live villager becomes the person's: the host writes its tuned persona (people/<id>/persona.json, the old one
      // kept) and its voice, all or nothing. It only hops down once the host has it; until then it stays on the stool.
      const voice = voiceKey ? VOICES[voiceKey] : null
      if (record.source.item && voice) {
        sentOff = 'sending'
        const r = await sendOffVillager(PERSON, record.source.item, { ...record.tuning }, { ...voice }).catch(() => ({ ok: false as const, why: 'failed' as const }))
        if (disposed) return
        if (!r.ok) {
          // Nothing changed on the host: the same tuned villager stays on the stool, ready to try again.
          sentOff = `failed: ${r.why}`
          state = 'tuning'
          if (!S?.tuning) tools.mode('on')
          done.classList.add('shown')
          saveTag.classList.add('shown')
          note(r.why === 'away'
            ? `${record.name} didn't go: the workshop's helper isn't in just now. They're still here, just as you tuned them. Try "Off you go" again in a moment.`
            : r.why === 'link'
              ? `${record.name} didn't go: this page needs your latest link from the host. They're still here, just as you tuned them.`
            : r.why === 'refused'
              ? `${record.name} didn't go: this page was opened with someone else's link.`
            : r.why === 'persona'
              // Another try would fail the same way: their character didn't pass the house's checks, so a new one is needed.
              ? `${record.name} can't move in as they are: their character didn't pass the house's checks. Describe them again to make a new one.`
              // On a partial save their new home may be half written; trying again rewrites all of it.
              : `${record.name} didn't go: their new home couldn't be saved this time. They're still here, just as you tuned them: try again and it will finish.`)
          return
        }
        sentOff = r.name
      }
      kept.push(record)
      S?.leaving?.()
      nametag.classList.remove('shown')
      card.classList.remove('shown')
      // A note belongs to the tuning it explained; the walk-off has the screen to itself.
      clearTimeout(noteTimer)
      noteEl.classList.remove('shown')
      const spot = SPOTS[LANDING]
      // Before it goes: square on to you, its face up, a wave goodbye.
      if (!reducedMotion.matches) {
        say('Bye for now!', true)
        await puppet.wave(1.4)
        if (disposed || !puppet || !fig) return
        for (const t of sayTimers) clearTimeout(t)
        card.classList.remove('shown')
      }
      puppet.looking = false
      // Down it hops, growing from its bench size to its own as it goes.
      await puppet.leap(new THREE.Vector3(spot.at[0], 0, spot.at[1]), reducedMotion.matches ? 0.01 : 1.1, 0.35, SCALE * tune.size(record.tuning.size))
      if (disposed || !fig) return
      bench = 1
      // The second routine's chores, counter first: that way leads across open floor, in view, not behind a chair.
      const tasks = [...ROUTINES[1].tasks]
      tasks.unshift(...tasks.splice(tasks.findIndex((t) => t.spot === 'counter'), 1))
      // Its contact shadow reaches out past a wide body (a shell, a skirt) so it reads as standing on the floor.
      if (body) fig.root.userData.footprint = Math.max(body.max.x - body.min.x, body.max.z - body.min.z) * fig.root.scale.x * 1.15
      const walker = new Villager(fig, tasks, { start: LANDING, wait: 0.8 })
      walkers.push(walker)
      // The old shadows' material, geometry and texture are freed: contactShadows makes a new set each time.
      disposeShadows(blobs)
      blobs = contactShadows(walkers)
      group.add(...blobs)
      // Watch it go: the camera follows it across the kitchen to its first chore, then comes back to the table.
      watchHeading = null
      watchSpot = null
      watchSize = body ? (body.max.y - body.min.y) * fig.root.scale.x : 0.4
      watching = { walker, until: performance.now() + 11000 }
      puppet = null
      fig = null
      body = null
      hueShift = null
      base = null
      made = null
      // Ready for another, with the slip back.
      state = 'empty'
      line.readOnly = false
      sew.disabled = false
      sew.textContent = 'Start sewing'
      line.value = ''
      shop.pattern('')
      setStatus(`${record.name} is off to help.`, 'warm')
      slipAt = 'edge'
      // The departure owns the moment: only a small "make another" tag, which opens the slip.
      slip.classList.add('shown', 'invite')
      sew.textContent = 'Make another'
      slip.inert = false
    }

    // ── Patterns: A's built-in templates for this profile, then the person's and the family's from the host ──
    let lastSaved: string | null = null
    /** The cards on the rack, as set (a strategy may show them its own way). */
    let shownCards: RackCard[] = []
    const loadPatterns = async () => {
      const [mine, family] = await Promise.all([personaTemplates(PERSON), familyTemplates(PERSON)])
      if (disposed) return []
      PROFILE = mine.ok ? mine.profile : null
      HUMOUR_DIAL = mine.ok ? mine.humour : { locked: null }
      // A level the host locks (the admin's setting, or the person's own "keep it clean") pins the dial there.
      tools.fix('humour', lockedAt())
      const list: RackCard[] = mine.ok ? mine.builtin.map((template) => ({ template, source: 'built-in' as const })) : []
      if (mine.ok) list.push(...mine.templates.map((template) => ({ template, source: 'mine' as const })))
      if (family.ok) list.push(...family.templates.filter((t) => t.maker !== PERSON).map((template) => ({ template, source: 'family' as const, maker: (template.maker ?? '').charAt(0).toUpperCase() + (template.maker ?? '').slice(1) })))
      // The built-in patterns first, then every saved and shared one, newest first (a fresh save is first among them). One
      // card per name and maker: saving "Like Brindle" twice keeps the newer one, not two cards that look the same. The
      // bench's rack stands as many as it holds (setup-rack.ts MAX); the mirror's glass shows them all.
      const builtIn = list.filter((c) => c.source === 'built-in')
      const seen = new Set<string>()
      const saved = list.filter((c) => c.source !== 'built-in').reverse().filter((c) => {
        const key = `${c.source}|${c.maker ?? ''}|${c.template.name.trim().toLowerCase()}`
        return !seen.has(key) && Boolean(seen.add(key))
      })
      shownCards = [...builtIn, ...saved]
      patterns.set(shownCards)
      return list
    }
    const patternsReady = loadPatterns()
    const onPattern = (card: RackCard | null) => {
      chip.hidden = !card
      slip.classList.toggle('patterned', Boolean(card))
      chip.textContent = ''
      if (card) {
        const p = card.template.persona as Partial<Persona>
        const name = document.createElement('b')
        name.textContent = card.template.name
        const about = document.createElement('span')
        // One short line, read whole: the manner and who it is for or from (the humour shows on the jokes switch).
        about.textContent = [p.temperament, footFor(card) || null].filter(Boolean).join(' · ')
        const back = document.createElement('i')
        back.textContent = '✕'
        back.setAttribute('aria-hidden', 'true')
        chip.append(name, about, back)
        const f = feltInk(patterns.feltOf(card))
        chip.style.setProperty('--felt', f.felt)
        chip.style.setProperty('--ink', f.ink)
      }
      // How the two combine: the words say who they are, the pattern how they talk.
      line.placeholder = card ? 'Who are they? e.g. a hedgehog who bakes bread' : 'e.g. a sleepy hedgehog who bakes bread before dawn'
      // The words say who they are (the line's example says so); the pattern, how they talk.
      if (state === 'empty' || state === 'failed') setStatus(card ? `${card.template.name} sets how they talk. ${SHARED}` : READY)
      chip.setAttribute('aria-label', card ? `Pattern ${card.template.name}. Click to put it back.` : '')
    }
    const saveAsPattern = async () => {
      if (!made) return
      const t = made.tuning
      // The persona as the host checked it, and the dials beside it: the host maps them in and checks the result.
      const dials = { warmth: t.warmth, playful: t.playful, chatty: t.chatty, humour: Math.min(t.humour, 0.5) }
      const name = `Like ${made.name}`.slice(0, 40)
      saveButton.disabled = true
      // The villager it came from goes with it: the host reads its pattern there to decide who may see the saved one.
      const saved = await saveTemplate(PERSON, name, made.persona, dials, share.checked, made.source.item)
      if (disposed) return
      saveButton.disabled = false
      if (!saved.ok) return note(saved.why === 'away' ? "Couldn't keep the pattern: the workshop's helper isn't in just now." : "Couldn't keep the pattern this time.")
      lastSaved = saved.template.id
      note(`Kept as a pattern: ${saved.template.name}${saved.template.shared ? ', shared with the family' : ''}.`, true)
      await loadPatterns()
      patterns.saved(saved.template.id)
    }
    saveButton.addEventListener('click', () => void saveAsPattern())

    // ── The regroup's strategy, if one is asked for ──────────────────────
    const target = new THREE.PerspectiveCamera()
    S = strategyFor(STRATEGY, {
      stage, group, tools, shop, patterns, slip, line, sew,
      state: () => state,
      layout: () => layout,
      made: () => made,
      villager: () => villagerRect(),
      target: () => {
        const p = lastPose ?? poseFor()
        target.fov = stage.camera.fov
        target.aspect = innerWidth / innerHeight
        target.near = 0.05
        target.far = 60
        target.updateProjectionMatrix()
        target.position.copy(p.position)
        target.lookAt(p.look)
        target.updateMatrixWorld(true)
        return target
      },
      front,
      overMat,
      lens: (fov) => {
        lens(fov ?? seatFov)
        return fov ?? seatFov
      },
      reflow: () => atTable(),
      say: (text, short) => say(text, short),
      tuned: () => {
        // Only while it is being tuned: a late answer must not talk over its goodbye.
        if (made && state === 'tuning') say(tunedLine({ warmth: made.tuning.warmth, playful: made.tuning.playful, chatty: made.tuning.chatty }, seq++), true)
      },
      note: (text) => note(text),
      hueAt: (v) => {
        const c = hueShift ? rotateHue(hueShift.main, tune.hue(v)) : null
        return c ? `#${c.getHexString()}` : null
      },
      cards: () => shownCards,
      humour: () => HUMOUR_DIAL,
      explainHumour: () => {
        if (HUMOUR_DIAL.locked !== null) note(lockedNote())
      },
      watching: () => watching !== null,
      mount: (e) => saveTag.before(e),
    })
    if (S) document.documentElement.dataset.vsStrategy = S.id

    // ── Wiring ─────────────────────────────────────────────────────────────
    /** The slip opens out of the "make another" tag. */
    const openSlip = () => {
      if (!slip.classList.contains('invite')) return false
      slip.classList.remove('invite')
      if (state === 'empty') atTable()
      sew.textContent = 'Start sewing'
      setStatus(READY)
      line.focus({ preventScroll: true })
      return true
    }
    const onSubmit = (e: SubmitEvent) => {
      e.preventDefault()
      if (openSlip()) return
      void start(line.value)
    }
    const onLineKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        void start(line.value)
      }
    }
    const onFocusLine = () => state !== 'tuning' && atTable()
    const onDone = () => void sendOff()
    slip.addEventListener('submit', onSubmit)
    line.addEventListener('keydown', onLineKey)
    line.addEventListener('focus', onFocusLine)
    done.addEventListener('click', onDone)
    const onResize = () => {
      const was = layout
      arrange()
      // Turned from a phone to a wide screen or back while tuning: the bench size is fitted again.
      if (layout !== was && state === 'tuning' && fig && made) {
        fitBench = true
        pose()
        fig.root.scale.setScalar(SCALE * tune.size(made.tuning.size) * bench)
      }
      if (view.focused && !watching && state !== 'leaving') atTable()
      if (state === 'tuning' && !S?.tuning) tools.mode('on')
    }
    addEventListener('resize', onResize)

    ctx.effect(() => {
      arrange()
      atTable()
      patterns.enable('on')
      line.focus({ preventScroll: true })
      return () => {
        disposed = true
        clearInterval(clock)
        leaveTable()
        S?.dispose()
        delete document.documentElement.dataset.vsStrategy
        removeEventListener('pointerdown', wake, true)
        removeEventListener('keydown', wake, true)
        removeEventListener('resize', onResize)
        for (const t of sayTimers) clearTimeout(t)
        clearTimeout(cardHide)
        tools.dispose()
        patterns.dispose()
        shop.dispose()
        box?.dispose()
        box = null
        for (const key of voiceKeys) unregisterVoice(key)
        voiceKeys.clear()
        babbler?.dispose()
        void audio?.close()
      }
    }, 'setup wiring')

    if (FROM) {
      // A saved round-1 result: its own words go on the slip.
      void fetch(`/generated/villagers/${FROM}/meta.json`).then((r) => (r.ok ? r.json() : null)).then((m: Meta | null) => {
        if (m?.description && state === 'empty' && !line.value) line.value = m.description
      }).catch(() => {})
    }

    // ── Each frame ─────────────────────────────────────────────────────────
    const eye = new THREE.Vector3()
    const matAt = new THREE.Vector3()
    ctx.on('village/frame', (dt, t) => {
      const step = Math.min(dt, 0.05)
      if (watching) {
        if (performance.now() > watching.until && state === 'empty') {
          atTable()
          openSlip()
        }
        else view.focus(watchPose(watching.walker), 1.6)
      }
      if (slip.classList.contains('shown')) {
        // The slip lies on the mat, or sits at the near edge; either way inside the screen.
        const w = slip.offsetWidth, h = slip.offsetHeight
        let x = innerWidth / 2, y = innerHeight - h / 2 - (innerWidth < 600 ? 16 : 24)
        const own = S?.slip?.(w, h) ?? null
        if (own) ({ x, y } = own)
        else if (slipAt === 'mat') {
          // As wide as the mat looks (within reason), so it lies on it and clear of the ribbons' tags.
          const l = matAt.set(MAT.x - MAT.w / 2, TOP, MAT.z + MAT.d / 2).project(stage.camera).x
          const r = matAt.set(MAT.x + MAT.w / 2, TOP, MAT.z + MAT.d / 2).project(stage.camera).x
          const width = `${Math.round(THREE.MathUtils.clamp(((r - l) / 2) * innerWidth + 16, 300, 440))}px`
          if (slip.style.width !== width) slip.style.width = width
          matAt.set(MAT.x, TOP, MAT.z + 0.02).project(stage.camera)
          x = ((matAt.x + 1) / 2) * innerWidth
          // Centred on the mat, but never over the rack's cards behind it (its tab stands 18 px above it), and above the
          // tools in front of it when they are on the table.
          const front = tools.group.visible ? tools.rects().filter((t) => ['size', 'pace', 'hue', 'pitch', 'energy'].includes(t.key)) : []
          const below = Math.min(innerHeight, ...front.filter((t) => t.right > x - w / 2 && t.left < x + w / 2).map((t) => t.top))
          y = Math.max(Math.min(((1 - matAt.y) / 2) * innerHeight, below - 6 - h / 2), patterns.bottom + 30 + h / 2)
        } else if (slipAt === 'front') {
          if (slip.style.width) slip.style.width = ''
          matAt.set(MAT.x, TOP, MAT.z + MAT.d / 2).project(stage.camera)
          x = ((matAt.x + 1) / 2) * innerWidth
          y = ((1 - matAt.y) / 2) * innerHeight + h / 2 + 10
        } else if (slip.style.width) slip.style.width = ''
        // On the mat it keeps clear of the ribbons' tags to its right.
        const right = slipAt === 'mat' && !own ? Math.min(innerWidth - 16, tools.ribbonsLeft() - 10) : innerWidth - 16
        x = Math.round(THREE.MathUtils.clamp(x, w / 2 + 16, right - w / 2))
        y = Math.round(THREE.MathUtils.clamp(y, h / 2 + 30, innerHeight - h / 2 - 16))
        const at = `calc(${x}px - 50%) calc(${y}px - 50%)`
        if (slip.style.translate !== at) slip.style.translate = at
        tools.under(new DOMRect(x - w / 2, y - h / 2, w, h))
      } else tools.under(null)
      // The tools come out once there is a villager to tune. Before that only a wide screen keeps them on the table, as
      // props beyond the slip; a tablet's or a phone's slip would lie over them, so the table shows only the start.
      tools.group.visible = S?.toolsVisible?.() ?? ((layout === 'wide' && innerWidth / innerHeight >= 1.5) || state === 'stitching' || state === 'tuning' || state === 'leaving')
      S?.frame?.(step, t)
      shop.frame(step, t)
      tools.frame(step, t)
      patterns.frame()
      stage.camera.getWorldPosition(eye)
      if (puppet && state !== 'stitching') puppet.update(step, t, eye)
      if (walkers.length) stepCrowd(walkers, blobs, step, t, eye, SCALE)
      // The card stands over the villager's head (the top of its bounds, ears and hats included); the name tag heads the screen at the top left.
      if (fig && (card.classList.contains('shown') || nametag.classList.contains('shown'))) {
        const v = villagerRect()!
        const edge = layout === 'narrow' ? 16 : 24
        const cw = card.offsetWidth / 2 + 12
        const x = Math.round(THREE.MathUtils.clamp((v.left + v.right) / 2, cw, innerWidth - cw))
        // Below the name tag when they would meet; the camera's fit leaves room for both above the villager.
        const under = x - card.offsetWidth / 2 < edge + nametag.offsetWidth + 12 ? edge + nametag.offsetHeight + 22 : 24
        const y = Math.round(THREE.MathUtils.clamp(v.top - 4, card.offsetHeight + under, innerHeight - 120))
        const ownCard = S?.place?.('card', card.offsetWidth, card.offsetHeight)
        const at = ownCard ? `${Math.round(ownCard.x)}px ${Math.round(ownCard.y)}px` : `calc(${x}px - 50%) calc(${y}px - 100%)`
        if (card.style.translate !== at) card.style.translate = at
        const ownName = S?.place?.('name', nametag.offsetWidth, nametag.offsetHeight)
        const nat = ownName ? `${Math.round(ownName.x)}px ${Math.round(ownName.y)}px` : `${edge}px ${edge}px`
        if (nametag.style.translate !== nat) nametag.style.translate = nat
      }
      // The save tag and the send-off tag sit in the bottom corners, clear of the tools' tags.
      const edge = layout === 'narrow' ? 16 : 24
      if (saveTag.classList.contains('shown')) {
        const ownSave = S?.place?.('save', saveTag.offsetWidth, saveTag.offsetHeight)
        const sat = ownSave ? `${Math.round(ownSave.x)}px ${Math.round(ownSave.y)}px` : `${edge}px ${innerHeight - edge - saveTag.offsetHeight}px`
        if (saveTag.style.translate !== sat) saveTag.style.translate = sat
      }
      if (done.classList.contains('shown')) {
        const ownDone = S?.place?.('done', done.offsetWidth, done.offsetHeight)
        const dat = ownDone ? `${Math.round(ownDone.x)}px ${Math.round(ownDone.y)}px` : `${innerWidth - edge - done.offsetWidth}px ${innerHeight - edge - done.offsetHeight}px`
        if (done.style.translate !== dat) done.style.translate = dat
      }
    })

    // ── For the checks ─────────────────────────────────────────────────────
    /** Whether a walker's middle is inside the camera's view. */
    const onScreen = (w: Villager) => {
      const p = w.fig.root.localToWorld(new THREE.Vector3(0, w.fig.height * 0.5, 0)).project(stage.camera)
      return Math.abs(p.x) < 0.95 && Math.abs(p.y) < 0.95 && p.z < 1
    }
    ctx.effect(() => {
      const api = {
        state: () => ({
          state,
          name: made?.name ?? null,
          persona: made?.persona ?? null,
          /** The host's record of a live-made villager, which saving a pattern names so the host can trace its source. */
          item: (made?.source as { item?: string } | undefined)?.item ?? null,
          profile: PROFILE,
          humourDial: HUMOUR_DIAL,
          sentOff,
          rack: patterns.state(),
          note: noteEl.classList.contains('shown') ? noteEl.textContent : null,
          saved: lastSaved,
          // Its tuned size (on a phone's bench it is shown smaller: bench).
          scale: fig && made ? SCALE * tune.size(made.tuning.size) : null,
          bench,
          hue: hueShift?.shift.value ?? null,
          hueMaterials: hueShift?.count ?? 0,
          voice: voiceKey && VOICES[voiceKey] ? { ...VOICES[voiceKey] } : null,
          gait: fig ? { speed: fig.speed, bob: fig.bob } : null,
          energy: puppet?.energy ?? null,
          values: { ...tools.values },
          placed: fig ? fig.root.parent === group : false,
          visibleMeshes: fig ? countVisible(fig.root) : 0,
          walkers: walkers.map((w) => ({ x: w.pos.x, z: w.pos.z, state: w.state, scale: w.fig.root.scale.x, seen: onScreen(w) })),
          pieces: { ...pieceTimes },
          cut: shop.cut,
          status: status.textContent,
          failure: lastFailure,
          refusal: lastRefusal,
          /** The role the host returned for the last make, and the role whose mark the felt kit sewed. */
          role: lastRole,
          mark: lastMark,
          timings: { ...timings },
          kept: kept.map((k) => ({ ...k, module: `${k.module.length} chars` })),
        }),
        start: (text: string) => start(text),
        set: (key: Key, v: number) => tools.set(key, v),
        screen: (key: Key) => tools.screen(key),
        camera: () => stage.camera.position.toArray(),
        /** The villager's projected bounds on the page, for the layout gate; null when there is none. */
        bounds: () => villagerRect(),
        /** Each visible part of the villager on the page (a held prop or a role mark reaching out is its own box), for the layout gate. */
        parts: () => {
          if (!fig) return []
          fig.root.updateMatrixWorld(true)
          const out: { left: number; top: number; right: number; bottom: number }[] = []
          fig.root.traverseVisible((o) => {
            const m = o as THREE.Mesh
            if (!m.isMesh) return
            m.geometry.computeBoundingBox()
            out.push(rectOf(m.geometry.boundingBox!, m.matrixWorld, stage.camera))
          })
          return out
        },
        /** The tools' projected bounds while they are on the table, for the layout gate. */
        toolBounds: () => (tools.group.visible ? tools.rects() : []),
        page: () => ({ slip: slip.classList.contains('shown'), slipText: line.value, slipReadOnly: line.readOnly, card: card.classList.contains('shown') ? card.textContent : null, nametag: nametag.classList.contains('shown') ? nametag.textContent : null, done: done.classList.contains('shown'), focus: (document.activeElement as HTMLElement | null)?.dataset?.key ?? document.activeElement?.className ?? null, aside: aside.map((o) => o.visible) }),
        sendOff,
        patterns: () => patternsReady.then(() => patterns.state()),
        reloadPatterns: () => loadPatterns().then(() => patterns.state()),
        save: (shared: boolean) => { share.checked = shared; return saveAsPattern() },
        keys: KEYS,
        strategy: STRATEGY,
        ...S?.api,
      }
      Object.assign(window, { villagerSetup: api })
      return () => delete (window as { villagerSetup?: unknown }).villagerSetup
    }, 'setup api')
  },
}

const field = (o: unknown, k: string): unknown => (o !== null && typeof o === 'object' && !Array.isArray(o) && Object.hasOwn(o, k) ? (o as Record<string, unknown>)[k] : undefined)

const countVisible = (root: THREE.Object3D) => {
  let n = 0
  root.traverseVisible((o) => (o as THREE.Mesh).isMesh && n++)
  return n
}

function css() {
  const paper = 'radial-gradient(120% 90% at 20% 0%, #fffaf0 0%, #fbf1dd 55%, #f3e3c4 100%)'
  // Two typefaces: handwriting for everything written on paper or felt (tags, the slip, names), the book
  // face for what is said or explained (the speech card, the status line, notes).
  return `
  ${TAG_CSS}
  .vs-slip, .vs-card { box-sizing: border-box; border-radius: 16px; color: #46301f; background: ${paper}; }
  .vs-slip::before, .vs-card::before { content: ''; position: absolute; inset: 7px; border: 1.5px dashed rgba(150, 100, 60, 0.32); border-radius: 11px; pointer-events: none; }
  .vs-slip { position: fixed; z-index: 6; left: 0; top: 0; width: min(440px, calc(100vw - 32px)); padding: 26px 22px 14px; transform: translateY(14px);
    box-shadow: 0 14px 26px rgba(60, 30, 10, 0.24), 0 3px 4px rgba(60, 30, 10, 0.16), 0 2px 0 rgba(255, 255, 255, 0.75) inset; rotate: -0.8deg;
    display: flex; flex-direction: column; gap: 6px; opacity: 0; visibility: hidden; pointer-events: none;
    transition: opacity 220ms ease, transform 260ms ease, visibility 0s linear 220ms; }
  .vs-slip.shown { opacity: 1; visibility: visible; transform: none; pointer-events: auto; transition: opacity 220ms ease, transform 260ms ease; }
  .vs-slip .tab { position: absolute; left: 18px; top: -18px; display: inline-flex; align-items: baseline; gap: 7px; padding: 4px 14px 5px; border-radius: 11px 11px 5px 5px;
    background: #fffaf0; color: #7a3b2a; box-shadow: 0 2px 6px rgba(60, 30, 10, 0.14), inset 0 0 0 1.5px rgba(196, 85, 63, 0.4); }
  .vs-slip .tab::after { content: ''; position: absolute; inset: 3px; border: 1.5px dashed rgba(196, 85, 63, 0.35); border-radius: 8px 8px 3px 3px; pointer-events: none; }
  .vs-slip .tab b { font: 700 21px/1.15 ${HAND}; }
  .vs-slip .tab i { font: 700 16px/1.15 ${HAND}; opacity: 0.75; font-style: normal; }
  .vs-slip .ruled { display: block; position: relative; }
  /* With a pattern's card stitched on, the slip packs a little closer so it stays on the mat. */
  .vs-slip.patterned { padding-top: 22px; padding-bottom: 10px; gap: 3px; }
  .vs-slip .line { box-sizing: border-box; width: 100%; resize: none; padding: 2px 2px 4px; border: 0; outline: none; background: none;
    color: #23395a; caret-color: #23395a; font: 21px/31px ${HAND};
    background-image: repeating-linear-gradient(transparent 0 29px, rgba(90, 60, 38, 0.32) 29px 31px); background-attachment: local; }
  /* The example is printed, not written: the book face, grey and italic, so it never reads as your words. */
  .vs-slip .line::placeholder { color: rgba(90, 70, 55, 0.55); font: italic 17px/31px ${BOOK}; }
  .vs-slip .ruled:focus-within .line { background-image: repeating-linear-gradient(transparent 0 29px, rgba(47, 74, 107, 0.5) 29px 31px); }
  .vs-slip .foot { display: flex; align-items: center; gap: 12px; min-height: 30px; }
  .vs-slip .status { flex: 1; margin: 0; font: italic 16px/1.35 ${BOOK}; color: #6b5340; }
  .vs-slip .status[data-tone='warm'] { color: #6a4a2c; }
  .vs-slip .status[data-tone='sorry'] { color: #8a3b2a; }
  .vs-slip .sew { position: relative; flex: none; padding: 5px 16px 7px; border: 0; border-radius: 4px 10px 10px 4px; cursor: pointer;
    background: #c4553f; color: #fffaf0; font: 700 18px/1.1 ${HAND}; box-shadow: 0 3px 8px rgba(120, 50, 30, 0.3); transition: translate 120ms ease, background 120ms ease; }
  .vs-slip .sew::after { content: ''; position: absolute; inset: 3px; border: 1.5px dashed rgba(255, 245, 230, 0.6); border-radius: 3px 7px 7px 3px; pointer-events: none; }
  .vs-slip .sew:hover, .vs-slip .sew:focus-visible { translate: 0 -1px; background: #b04a35; outline: none; }
  .vs-slip .sew:focus-visible { box-shadow: 0 0 0 3px #fffaf0, 0 0 0 5px rgba(47, 74, 107, 0.6); }
  /* Waiting: a small progress tag on the bench, the words already on the pattern sheet. */
  /* The seconds are honest but secondary: a small tag, so the cutting on the mat is the thing to watch. */
  .vs-slip.waiting { width: auto; max-width: calc(100vw - 32px); padding: 6px 12px 7px; border-radius: 5px; rotate: 0.6deg; box-shadow: 0 4px 10px rgba(60, 30, 10, 0.18); }
  .vs-slip.waiting .status { font-size: 14px; color: #7a6450; }
  .vs-slip.waiting::before { inset: 4px; border-radius: 4px; }
  .vs-slip.waiting .tab, .vs-slip.waiting .ruled, .vs-slip.waiting .chip, .vs-slip.waiting .sew { display: none; }
  .vs-slip.waiting .foot { min-height: 0; }
  /* After a send-off: only a small tag to make another, until it is opened (or the camera comes back). */
  .vs-slip.invite { width: auto; padding: 10px 12px 10px 16px; border-radius: 8px; }
  .vs-slip.invite::before { inset: 4px; border-radius: 6px; }
  .vs-slip.invite .tab, .vs-slip.invite .ruled, .vs-slip.invite .chip { display: none; }
  .vs-slip.waiting .status::after { content: ''; display: inline-block; width: 11px; height: 11px; margin-left: 7px; vertical-align: -2px;
    border: 2px dotted rgba(122, 59, 42, 0.6); border-radius: 50%; animation: vs-spin 2.4s linear infinite; }
  @keyframes vs-spin { to { rotate: 1turn; } }

  /* The picked pattern: its felt card, stitched across the top of the slip. */
  .vs-slip .chip { position: relative; display: grid; grid-template-columns: auto 1fr auto; align-items: baseline; column-gap: 10px; margin: 0 -4px 2px; box-sizing: border-box;
    padding: 6px 12px 6px 14px; border: 0; border-radius: 6px; cursor: pointer; rotate: 0.8deg; text-align: left;
    background: var(--felt, #55724a); color: var(--ink, #fffaf0); box-shadow: 0 5px 12px rgba(60, 30, 10, 0.25); }
  .vs-slip .chip::before { content: ''; position: absolute; inset: 4px; border: 1.6px dashed color-mix(in srgb, currentColor 65%, transparent); border-radius: 4px; pointer-events: none; }
  .vs-slip .chip b { font: 700 19px/1.15 ${HAND}; white-space: nowrap; }
  .vs-slip .chip span { font: italic 14px/1.3 ${BOOK}; min-width: 0; overflow-wrap: anywhere; }
  .vs-slip .chip i { align-self: center; font: 700 15px/1 ${HAND}; font-style: normal; opacity: 0.9; }
  .vs-slip .chip[hidden] { display: none; }
  .vs-slip .chip:hover i, .vs-slip .chip:focus-visible i { opacity: 1; text-decoration: underline; }
  .vs-slip .chip:focus-visible { outline: none; box-shadow: 0 0 0 3px #fffaf0, 0 0 0 5px rgba(47, 74, 107, 0.7); }

  /* What it says: a small torn-off paper note, as wide as its words, pencilled faintly first and inked word by word. */
  .vs-card { position: fixed; z-index: 6; left: 0; top: 0; width: max-content; max-width: min(280px, calc(100vw - 48px)); padding: 12px 16px 10px; margin-top: -14px;
    border-radius: 3px 10px 4px 9px; rotate: -1.2deg; background: linear-gradient(180deg, #fffaf0, #f6e9cf);
    box-shadow: 0 8px 18px rgba(60, 30, 10, 0.22), 0 1px 0 rgba(255, 255, 255, 0.7) inset; font: 17px/1.38 ${BOOK}; color: #3d2a1c;
    opacity: 0; scale: 0.94; transform-origin: 50% 100%; pointer-events: none; transition: opacity 180ms ease, scale 220ms cubic-bezier(.2, 1.4, .4, 1); }
  .vs-card::before { inset: 4px; border-radius: 2px 7px 2px 6px; }
  .vs-card.shown { opacity: 1; scale: 1; }
  .vs-card.short { font-size: 17px; padding: 10px 14px 8px; }
  .vs-card::after { content: ''; position: absolute; left: 50%; bottom: -7px; width: 14px; height: 14px; margin-left: -7px; background: #f6e9cf; rotate: 45deg;
    border-radius: 0 0 4px 0; box-shadow: 3px 3px 4px rgba(60, 30, 10, 0.12); }
  .vs-card span { opacity: 0.16; transition: opacity 90ms ease; }
  .vs-card span.in { opacity: 1; }

  /* The name tag, the save tag and the send-off tag are the same paper tag as the tools; colour says what each is for. */
  .vs-name { position: fixed; z-index: 5; left: 0; top: 0; pointer-events: none; opacity: 0; transition: opacity 240ms ease;
    background: color-mix(in oklab, #c4553f 88%, #2a1608); color: #fffaf0; font-size: 20px; text-shadow: 0 1px 0 rgba(40, 20, 8, 0.35); }
  .vs-name::after { content: ''; position: absolute; inset: 3px; border: 1.5px dashed rgba(255, 248, 236, 0.6); border-radius: 3px 7px 7px 3px; }
  .vs-name.shown { opacity: 1; }
  .vs-name small { font: 700 15px/1.15 ${HAND}; }
  .vs-name i { display: block; width: fit-content; margin: 5px -4px 0; padding: 3px 9px 4px; border-radius: 3px; font: 700 15px/1.2 ${HAND}; font-style: normal;
    background: var(--felt, rgba(40, 20, 8, 0.3)); color: var(--ink, #fffaf0); text-shadow: none; box-shadow: inset 0 0 0 1.5px color-mix(in srgb, currentColor 55%, transparent), 0 2px 4px rgba(40, 20, 8, 0.25); }

  .vs-done { position: fixed; z-index: 6; left: 0; top: 0; cursor: pointer; opacity: 0; pointer-events: none; border: 0;
    padding: 9px 20px 10px 30px; background: #4f6e44; color: #fffaf0; font-size: 22px; text-shadow: 0 1px 0 rgba(30, 50, 20, 0.4);
    transition: opacity 260ms ease, translate 160ms ease; }
  .vs-done.shown { opacity: 1; pointer-events: auto; }
  .vs-done::before { content: ''; position: absolute; left: 11px; top: 50%; width: 8px; height: 8px; margin-top: -4px; border-radius: 50%;
    background: #f3e7cf; box-shadow: inset 0 0 0 2px rgba(60, 80, 40, 0.5); }
  .vs-done::after { content: ''; position: absolute; inset: 3px; border: 1.5px dashed rgba(255, 250, 235, 0.6); border-radius: 3px 7px 7px 3px; pointer-events: none; }
  .vs-done:hover { background: #46653c; }
  .vs-done:focus-visible { box-shadow: 0 0 0 3px #fffaf0, 0 0 0 5px rgba(47, 74, 107, 0.6), 0 6px 14px rgba(40, 60, 30, 0.3); }

  .vs-save { position: fixed; z-index: 6; left: 0; top: 0; display: flex; flex-direction: column; gap: 3px; padding: 8px 14px 8px 18px;
    opacity: 0; pointer-events: none; transition: opacity 240ms ease; }
  .vs-save::before { content: ''; position: absolute; left: 6px; top: 50%; width: 6px; height: 6px; margin-top: -3px; border-radius: 50%;
    background: #e9dcc0; box-shadow: inset 0 0 0 1.5px rgba(120, 80, 50, 0.45); }
  .vs-save.shown { opacity: 1; pointer-events: auto; }
  .vs-save button { position: relative; padding: 0; border: 0; background: none; cursor: pointer; color: #7a3b2a; font: 700 19px/1.2 ${HAND}; text-align: left; }
  .vs-save button:hover, .vs-save button:focus-visible { outline: none; text-decoration: underline 1.5px; text-underline-offset: 4px; }
  .vs-save label { display: flex; align-items: center; gap: 6px; font: 700 14px/1.2 ${HAND}; color: #6a5039; cursor: pointer; }
  .vs-save input { margin: 0; accent-color: #6f8f62; }

  .vs-note { position: fixed; z-index: 7; left: 50%; top: 18px; max-width: min(460px, calc(100vw - 32px)); margin: 0; padding: 10px 16px 11px; translate: -50% -8px;
    border-radius: 4px; background: linear-gradient(180deg, #fffaf0, #f4e6c9); color: #4a3220; font: italic 16px/1.4 ${BOOK}; rotate: -0.8deg;
    box-shadow: 0 6px 14px rgba(60, 30, 10, 0.2); opacity: 0; pointer-events: none; transition: opacity 220ms ease, translate 220ms ease; }
  .vs-note::before { content: ''; position: absolute; left: 50%; top: -6px; width: 12px; height: 12px; margin-left: -6px; border-radius: 50%; background: #c4553f;
    box-shadow: 0 2px 3px rgba(60, 30, 10, 0.35); }
  .vs-note.shown { opacity: 1; translate: -50% 0; }
  .vs-note.heard { clip-path: inset(50%); width: 1px; height: 1px; overflow: hidden; white-space: nowrap; }

  @media (max-width: 600px) {
    .vs-slip { padding: 24px 16px 12px; }
    .vs-slip .line { font-size: 19px; line-height: 29px; background-image: repeating-linear-gradient(transparent 0 27px, rgba(90, 60, 38, 0.32) 27px 29px); }
    .vs-slip .line::placeholder { font-size: 15px; line-height: 29px; }
    .vs-slip .status { font-size: 15px; }
    .vs-slip .chip b { font-size: 18px; }
    .vs-done { font-size: 19px; padding: 8px 16px 9px 26px; }
    .vs-save button { font-size: 17px; }
    .vs-card { font-size: 15.5px; max-width: min(250px, calc(100vw - 48px)); }
  }
  @media (prefers-reduced-motion: reduce) { .vs-slip, .vs-card, .vs-name, .vs-done, .vs-card span, .vs-note, .vs-save { transition: none; } .vs-slip.waiting .status::after { animation: none; } }
  `
}
