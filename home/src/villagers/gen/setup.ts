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
import { familyTemplates, makeVillager, personaTemplates, saveTemplate, tuneVillager } from '../../villager'
import { Babbler } from '../../voice/engine'
import { clampVoice, voiceFromDescription } from '../../voice/gen'
import { registerVoice, unregisterVoice, VOICES, type VoiceProfile } from '../../voice/profiles'
import { TYPE_RATE } from '../../voice/text'
import { contactShadows, stepCrowd } from '../cast'
import { Villager, type Figure } from '../rig'
import { SPOTS } from '../world'
import { assemble } from './assemble'
import { build, check } from './build'
import { accentMeshes, hueTurn, pieces, Puppet, type Piece } from './setup-stitch'
import { controls, HUE_SPAN, HUMOUR, KEYS, type Key } from './sliders'
import { checked, crudeAllowed, fallbackPersona, personaFor, personaNotes, profileFrom, tunedLine, type Persona, type PersonaTemplate } from './setup-persona'
import { rack, type RackCard } from './setup-rack'
import { templatesFor } from './templates'
import { HAND, MAT, TOP, workshop } from './workshop'
import type { Meta } from './load'

type State = 'empty' | 'waiting' | 'stitching' | 'tuning' | 'leaving' | 'failed'
export type Tuning = Record<Key, number>
/** What a finished villager is, as data: never the model again, only this. */
export interface Made { source: { from?: string; item?: string }; description: string; accent: string; module: string; arm: 'code' | 'spec'; name: string; persona: Persona; template: string | null; tuning: Tuning }

const BOOK = '"Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif'
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)')
const params = new URLSearchParams(location.search)
const FROM = params.get('from')
const PERSON = /^[a-z][a-z0-9-]{0,31}$/.test(params.get('person') ?? '') ? params.get('person')! : 'alex'
const ACCENT = /^#[0-9a-f]{6}$/i.test(params.get('accent') ?? '') ? params.get('accent')! : '#c8553d'
const OWNER = PERSON.charAt(0).toUpperCase() + PERSON.slice(1)
/** Synthetic until people have real profiles on the host (see setup-persona.ts profileFrom). */
const PROFILE = profileFrom(params.get('profile'))
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

    const tools = controls(stage, {
      input: (key, v) => applyTuning(key, v),
      release: () => made && say(tunedLine({ warmth: made.tuning.warmth, playful: made.tuning.playful, chatty: made.tuning.chatty }, seq++), true),
      locked: () => note('Crude jokes stay locked here. They need a grown-up profile that has opted in.'),
    })
    group.add(tools.group)
    tools.lock('humour', !crudeAllowed(PROFILE))
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
    const pose = () => {
      const aspect = innerWidth / innerHeight
      const fov = aspect < 0.9 ? THREE.MathUtils.clamp(seatFov / Math.max(aspect, 0.42) * 0.7, seatFov, 72) : seatFov
      lens(fov)
      // Far enough back that the whole bench (about 1.6 m of tools) fits across.
      const half = Math.atan(Math.tan(THREE.MathUtils.degToRad(fov / 2)) * aspect)
      const dist = THREE.MathUtils.clamp(0.82 / Math.tan(half), 2.15, 4.4)
      const look = new THREE.Vector3(-0.24, TOP + (aspect < 0.9 ? 0.3 : 0.1), MAT.z - (aspect < 0.9 ? 0.12 : 0.02))
      return { position: look.clone().addScaledVector(new THREE.Vector3(0, aspect < 0.9 ? 0.75 : 0.5, 1).normalize(), dist), look }
    }
    const atTable = () => view.focus(pose(), 2.4)
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
    line.placeholder = 'Who are they? A sleepy hedgehog who bakes bread…'
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
    nametag.className = 'vs-name'
    const done = document.createElement('button')
    done.type = 'button'
    done.className = 'vs-done'
    done.innerHTML = '<span>Off you go</span>'
    // A small paper note for plain explanations (a locked dial, a template made gentler).
    const noteEl = document.createElement('p')
    noteEl.className = 'vs-note'
    noteEl.setAttribute('role', 'status')
    noteEl.setAttribute('aria-live', 'polite')
    let noteTimer = 0
    const note = (text: string) => {
      noteEl.textContent = text
      noteEl.classList.add('shown')
      clearTimeout(noteTimer)
      noteTimer = window.setTimeout(() => noteEl.classList.remove('shown'), 6000)
    }
    // Save as a pattern: the tuned persona as a template, kept on the host, optionally for the family.
    const saveTag = document.createElement('div')
    saveTag.className = 'vs-save'
    const saveButton = document.createElement('button')
    saveButton.type = 'button'
    saveButton.textContent = 'Save as a pattern'
    const shareLabel = document.createElement('label')
    const share = document.createElement('input')
    share.type = 'checkbox'
    shareLabel.append(share, ' share with the family')
    saveTag.append(saveButton, shareLabel)
    // The picked pattern, on the slip.
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
    setStatus('Write who they are, then Enter.')

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
    const figureFrom = async (arm: 'code' | 'spec', text: string, accent: string) => {
      const seed = 31 + kept.length * 17
      if (arm === 'spec') {
        const raw = JSON.parse(text)
        const { spec } = check(raw)
        return { fig: build(spec, phys, { accent }, seed), name: spec.name, role: spec.role as string, bark: spec.bark, voice: spec.voice as VoiceProfile | null, persona: field(raw, 'persona') }
      }
      box ??= new PropBox()
      const t0 = performance.now()
      const result = await box.run(text)
      timings.sandboxMs = performance.now() - t0
      if (!result.ok) throw new Error(`sandbox: ${result.reason}`)
      const checked = validate(result.data)
      if ('reason' in checked) throw new Error(`rejected: ${checked.reason}`)
      // Saved round-1 results predate assemble's look checks, so a replay skips them; live results must pass.
      const a = assemble(checked.prop, result.data, phys, accent, seed, !FROM)
      return { fig: a.fig, name: a.about.name, role: a.about.role as string, bark: a.about.bark, voice: a.about.voice as VoiceProfile | null, persona: field(field(field(result.data, 'villager'), 'about'), 'persona') }
    }

    const start = async (description: string) => {
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
      atTable()
      patterns.enable(false)
      state = 'waiting'
      slip.classList.add('waiting')
      line.readOnly = true
      sew.disabled = true
      shop.pattern(description)
      shop.activity('working')
      const t0 = performance.now()
      const elapsed = () => Math.round((performance.now() - t0) / 1000)
      const clock = window.setInterval(() => setStatus(`Drafting the pattern from your words… ${elapsed()} s`, 'warm'), 1000)
      setStatus(FROM ? 'Unfolding a saved pattern…' : 'Drafting the pattern from your words… usually about a minute.', 'warm')
      let fail: string | null = null
      try {
        let arm: 'code' | 'spec' = 'code', text = '', source: Made['source'] = {}, hostPersona: unknown = null
        if (FROM) {
          const saved = await fetchSaved(FROM)
          arm = saved.meta.arm
          text = saved.text
          source = { from: FROM }
        } else {
          const answer = await makeVillager(PERSON, description, ACCENT)
          timings.modelMs = answer.ms
          if (!answer.ok) {
            fail = answer.why === 'away' ? 'away' : answer.why === 'busy' ? 'busy' : 'model'
            throw new Error(answer.why)
          }
          text = answer.module
          hostPersona = answer.persona
          source = { item: answer.item }
          timings.costUsd = answer.costUsd ?? NaN
        }
        const got = await figureFrom(arm, text, ACCENT)
        // The persona: the host's (checked again here), else the module's own, else a plain one from
        // the words; then the picked pattern over it; then the gate for this profile.
        const base = checked(hostPersona) ?? checked(got.persona) ?? fallbackPersona(description, got.role)
        const { persona, gated } = personaFor(base, template, PROFILE)
        if (gated) note(`${template?.name ?? 'This pattern'} is set to cheeky here. Crude jokes need a grown-up profile that has opted in.`)
        const tuning = Object.fromEntries(KEYS.map((k) => [k, 0.5])) as Tuning
        tuning.warmth = persona.dials.warmth
        tuning.playful = persona.dials.playful
        tuning.chatty = persona.dials.chatty
        tuning.humour = HUMOUR.indexOf(persona.dials.humour) / 2
        made = { source, description, accent: ACCENT, module: text, arm, name: got.name, persona, template: template?.name ?? null, tuning }
        tools.init(tuning)
        clearInterval(clock)
        timings.readyMs = performance.now() - t0
        await stitch(got.fig, got.name, got.bark, got.voice ?? voiceFromDescription(description))
      } catch (error) {
        clearInterval(clock)
        failed(fail ?? 'sewing', String(error instanceof Error ? error.message : error))
      }
    }

    const failed = (why: string, detail: string) => {
      state = 'failed'
      timings.failedMs = performance.now()
      shop.activity('tidy')
      slip.classList.remove('waiting')
      line.readOnly = false
      sew.disabled = false
      sew.textContent = 'Try again'
      patterns.enable(true)
      lastFailure = detail
      const words: Record<string, string> = {
        away: "The workshop's helper isn't in just now, so nothing was sewn. Your words are still here.",
        busy: "Another villager is still on the table. Let's finish that one first.",
        model: "The pattern didn't come together this time, so nothing was sewn. Try again, or change a word or two.",
        sewing: "The pieces didn't fit together this time, so nothing was sewn. Try again, or change a word or two.",
      }
      setStatus(words[why] ?? words.sewing, 'sorry')
      line.focus({ preventScroll: true })
    }
    let lastFailure = ''

    // ── Stitching, part by part, with a needle pass for each ───────────────
    const stitch = async (made_: Figure, name: string, bark: string, rawVoice: VoiceProfile) => {
      state = 'stitching'
      fig = made_
      shop.activity('tidy')
      shop.pattern(made!.description, name, personaNotes(made!.persona, patterns.picked?.template ?? null))
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
      const at = new THREE.Vector3(MAT.x - 0.1, TOP + 0.006, MAT.z - 0.07)
      const cam = stage.camera.position
      puppet = new Puppet(fig, at, Math.atan2(cam.x - at.x, cam.z - at.z) - 0.35)
      fig.root.scale.setScalar(SCALE)
      group.add(fig.root)
      fig.root.updateMatrixWorld(true)
      // Its voice: the model's, pulled into range; registered under a key that cannot collide.
      base = { voice: clampVoice(rawVoice), speed: fig.speed, bob: fig.bob }
      voiceKey = registerVoice(`setup-${kept.length + 1}`, { ...base.voice })
      setStatus(`Stitching ${name} together…`, 'warm')
      const t0 = performance.now()
      for (const p of parts) await reveal(p, scales)
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
        small.textContent = made!.persona.role
        nametag.append(' ', small)
      }
      nametag.classList.add('shown')
      slip.classList.remove('shown', 'waiting')
      slip.inert = true
      tools.enable(true)
      patterns.enable(false)
      done.classList.add('shown')
      saveTag.classList.add('shown')
      setStatus('')
      // Keyboard users land on the first tool; Tab walks the rest and then the send-off tag.
      if (slip.contains(document.activeElement) || document.activeElement === document.body) tools.focus('size')
      await wait(reducedMotion.matches ? 0 : 450)
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
      if (key === 'size') fig.root.scale.setScalar(SCALE * tune.size(v))
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
      tools.enable(false)
      done.classList.remove('shown')
      saveTag.classList.remove('shown')
      nametag.classList.remove('shown')
      card.classList.remove('shown')
      const record: Made = { ...made, tuning: { ...made.tuning } }
      kept.push(record)
      if (record.source.item) void tuneVillager(PERSON, record.source.item, { ...record.tuning })
      const spot = SPOTS[LANDING]
      puppet.looking = false
      await puppet.leap(new THREE.Vector3(spot.at[0], 0, spot.at[1]), reducedMotion.matches ? 0.01 : 1.1, 0.35)
      const r = ROUTINES[1]
      const walker = new Villager(fig, r.tasks, { start: LANDING, wait: 0.8 })
      walkers.push(walker)
      for (const b of blobs) b.removeFromParent()
      blobs = contactShadows(walkers)
      group.add(...blobs)
      puppet = null
      fig = null
      hueShift = null
      base = null
      made = null
      leaveTable(2)
      // Ready for another, with the slip back on the table.
      state = 'empty'
      line.readOnly = false
      sew.disabled = false
      sew.textContent = 'Start sewing'
      line.value = ''
      shop.pattern('')
      setStatus(`${record.name} is off to help. Write another, or watch them go.`, 'warm')
      slip.classList.add('shown')
      slip.inert = false
      patterns.enable(true)
    }

    // ── Patterns: A's built-in templates for this profile, then the person's and the family's from the host ──
    let lastSaved: string | null = null
    const asTemplate = (t: { id: string; name: string; persona: Record<string, unknown>; audience: 'any' | 'adult' | 'child' }): PersonaTemplate => ({ id: t.id, name: t.name, persona: t.persona as PersonaTemplate['persona'], audience: t.audience })
    const loadPatterns = async () => {
      const list: RackCard[] = templatesFor(PROFILE).map((template) => ({ template, source: 'built-in' }))
      const [mine, family] = await Promise.all([personaTemplates(PERSON), familyTemplates(PERSON)])
      if (mine.ok) list.push(...mine.templates.map((t) => ({ template: asTemplate(t), source: 'mine' as const })))
      if (family.ok) list.push(...family.templates.filter((t) => t.maker !== PERSON).map((t) => ({ template: asTemplate(t), source: 'family' as const, maker: t.maker.charAt(0).toUpperCase() + t.maker.slice(1) })))
      // Newest saved patterns first after the built-in ones, so a fresh save is on the rack.
      const builtIn = list.filter((c) => c.source === 'built-in')
      const saved = list.filter((c) => c.source !== 'built-in').reverse()
      patterns.set([...saved.slice(0, 2), ...builtIn].slice(0, 7))
      return list
    }
    const patternsReady = loadPatterns()
    const onPattern = (card: RackCard | null) => {
      chip.hidden = !card
      chip.textContent = card ? `pattern: ${card.template.name} ✕` : ''
      chip.setAttribute('aria-label', card ? `Pattern ${card.template.name}. Click to put it back.` : '')
      if (card && card.template.persona.dials?.humour === 'crude' && !crudeAllowed(PROFILE)) note(`${card.template.name} will be cheeky here, not crude. Crude jokes need a grown-up profile that has opted in.`)
    }
    const saveAsPattern = async () => {
      if (!made) return
      const t = made.tuning
      const persona = { ...made.persona, dials: { warmth: t.warmth, playful: t.playful, chatty: t.chatty, humour: HUMOUR[Math.round(t.humour * 2)] } }
      const name = `Like ${made.name}`.slice(0, 40)
      saveButton.disabled = true
      const saved = await saveTemplate(PERSON, name, persona, share.checked)
      saveButton.disabled = false
      if (!saved.ok) return note(saved.why === 'away' ? "Couldn't keep the pattern: the workshop's helper isn't in just now." : "Couldn't keep the pattern this time.")
      lastSaved = saved.template.id
      note(`Kept as a pattern: ${saved.template.name}${saved.template.shared ? ', shared with the family' : ''}.`)
      await loadPatterns()
    }
    saveButton.addEventListener('click', () => void saveAsPattern())

    // ── Wiring ─────────────────────────────────────────────────────────────
    const onSubmit = (e: SubmitEvent) => {
      e.preventDefault()
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
    const onResize = () => view.focused && state !== 'leaving' && atTable()
    addEventListener('resize', onResize)

    ctx.effect(() => {
      atTable()
      patterns.enable(true)
      line.focus({ preventScroll: true })
      return () => {
        leaveTable()
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
        for (let i = 1; i <= kept.length + 1; i++) unregisterVoice(`setup-${i}`)
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
    const head = new THREE.Vector3()
    ctx.on('village/frame', (dt, t) => {
      const step = Math.min(dt, 0.05)
      shop.frame(step, t)
      tools.frame(step, t)
      patterns.frame()
      stage.camera.getWorldPosition(eye)
      if (puppet && state !== 'stitching') puppet.update(step, t, eye)
      if (walkers.length) stepCrowd(walkers, blobs, step, t, eye, SCALE)
      // The card and the name tag follow the villager's head on screen.
      if (fig && (card.classList.contains('shown') || nametag.classList.contains('shown'))) {
        fig.root.updateMatrixWorld()
        head.set(0, fig.height * 1.08, 0).applyMatrix4(fig.root.matrixWorld).project(stage.camera)
        const r = stage.renderer.domElement.getBoundingClientRect()
        const x = Math.round(THREE.MathUtils.clamp(r.left + ((head.x + 1) / 2) * r.width, 150, innerWidth - 150))
        const y = Math.round(THREE.MathUtils.clamp(r.top + ((1 - head.y) / 2) * r.height, 90, innerHeight - 120))
        const at = `calc(${x}px - 50%) calc(${y}px - 100%)`
        if (card.style.translate !== at) card.style.translate = at
        // The name tag lies on the mat just in front of its feet.
        foot2.set(fig.root.position.x, TOP, fig.root.position.z + fig.side * fig.root.scale.x + 0.11).project(stage.camera)
        const nx = Math.round(r.left + ((foot2.x + 1) / 2) * r.width)
        const ny = Math.round(r.top + ((1 - foot2.y) / 2) * r.height)
        const nat = `calc(${nx}px - 50%) ${Math.min(innerHeight - 60, ny)}px`
        if (nametag.style.translate !== nat) nametag.style.translate = nat
      }
      // The save tag hangs from the near left corner, the send-off tag from the near right.
      if (saveTag.classList.contains('shown')) {
        corner.set(-1.12, TOP - 0.03, 0.66).project(stage.camera)
        const r = stage.renderer.domElement.getBoundingClientRect()
        const cx = Math.round(Math.max(16, r.left + ((corner.x + 1) / 2) * r.width))
        const cy = Math.round(Math.min(innerHeight - 90, r.top + ((1 - corner.y) / 2) * r.height))
        const sat = `${cx}px ${cy}px`
        if (saveTag.style.translate !== sat) saveTag.style.translate = sat
      }
      if (done.classList.contains('shown')) {
        corner.set(0.5, TOP - 0.03, 0.66).project(stage.camera)
        const r = stage.renderer.domElement.getBoundingClientRect()
        const cx = Math.round(Math.min(innerWidth - 110, r.left + ((corner.x + 1) / 2) * r.width))
        const cy = Math.round(Math.min(innerHeight - 70, r.top + ((1 - corner.y) / 2) * r.height))
        const dat = `calc(${cx}px - 50%) ${cy}px`
        if (done.style.translate !== dat) done.style.translate = dat
      }
    })
    const foot2 = new THREE.Vector3()
    const corner = new THREE.Vector3()

    // ── For the checks ─────────────────────────────────────────────────────
    ctx.effect(() => {
      const api = {
        state: () => ({
          state,
          name: made?.name ?? null,
          persona: made?.persona ?? null,
          profile: PROFILE,
          rack: patterns.state(),
          note: noteEl.classList.contains('shown') ? noteEl.textContent : null,
          saved: lastSaved,
          scale: fig?.root.scale.x ?? null,
          hue: hueShift?.shift.value ?? null,
          hueMaterials: hueShift?.count ?? 0,
          voice: voiceKey && VOICES[voiceKey] ? { ...VOICES[voiceKey] } : null,
          gait: fig ? { speed: fig.speed, bob: fig.bob } : null,
          energy: puppet?.energy ?? null,
          values: { ...tools.values },
          placed: fig ? fig.root.parent === group : false,
          visibleMeshes: fig ? countVisible(fig.root) : 0,
          walkers: walkers.map((w) => ({ x: w.pos.x, z: w.pos.z, state: w.state, scale: w.fig.root.scale.x })),
          pieces: { ...pieceTimes },
          cut: shop.cut,
          status: status.textContent,
          failure: lastFailure,
          timings: { ...timings },
          kept: kept.map((k) => ({ ...k, module: `${k.module.length} chars` })),
        }),
        start: (text: string) => start(text),
        set: (key: Key, v: number) => tools.set(key, v),
        screen: (key: Key) => tools.screen(key),
        camera: () => stage.camera.position.toArray(),
        page: () => ({ slip: slip.classList.contains('shown'), slipText: line.value, slipReadOnly: line.readOnly, card: card.classList.contains('shown') ? card.textContent : null, nametag: nametag.classList.contains('shown') ? nametag.textContent : null, done: done.classList.contains('shown'), focus: (document.activeElement as HTMLElement | null)?.dataset?.key ?? document.activeElement?.className ?? null, aside: aside.map((o) => o.visible) }),
        sendOff,
        patterns: () => patternsReady.then(() => patterns.state()),
        reloadPatterns: () => loadPatterns().then(() => patterns.state()),
        save: (shared: boolean) => { share.checked = shared; return saveAsPattern() },
        keys: KEYS,
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
  return `
  .vs-slip, .vs-card { box-sizing: border-box; border-radius: 16px; color: #46301f; background: ${paper}; }
  .vs-slip::before, .vs-card::before { content: ''; position: absolute; inset: 7px; border: 1.5px dashed rgba(150, 100, 60, 0.32); border-radius: 11px; pointer-events: none; }
  .vs-slip { position: fixed; z-index: 6; left: 50%; bottom: 26px; width: min(460px, calc(100vw - 32px)); padding: 26px 22px 14px; translate: -50% 16px;
    box-shadow: 0 10px 24px rgba(60, 30, 10, 0.2), 0 2px 0 rgba(255, 255, 255, 0.75) inset; rotate: -0.6deg;
    display: flex; flex-direction: column; gap: 6px; opacity: 0; pointer-events: none; transition: opacity 240ms ease, translate 280ms ease; }
  .vs-slip.shown { opacity: 1; translate: -50% 0; pointer-events: auto; }
  .vs-slip .tab { position: absolute; left: 18px; top: -18px; display: inline-flex; align-items: baseline; gap: 7px; padding: 4px 14px 5px; border-radius: 11px 11px 5px 5px;
    background: #fffaf0; color: #7a3b2a; box-shadow: 0 2px 6px rgba(60, 30, 10, 0.14), inset 0 0 0 1.5px rgba(196, 85, 63, 0.4); }
  .vs-slip .tab::after { content: ''; position: absolute; inset: 3px; border: 1.5px dashed rgba(196, 85, 63, 0.35); border-radius: 8px 8px 3px 3px; pointer-events: none; }
  .vs-slip .tab b { font: 700 21px/1.15 ${HAND}; }
  .vs-slip .tab i { font: italic 16px/1.15 ${HAND}; opacity: 0.8; }
  .vs-slip .ruled { display: block; position: relative; }
  .vs-slip .line { box-sizing: border-box; width: 100%; resize: none; padding: 2px 2px 4px; border: 0; outline: none; background: none;
    color: #23395a; caret-color: #23395a; font: 21px/31px ${HAND};
    background-image: repeating-linear-gradient(transparent 0 29px, rgba(90, 60, 38, 0.32) 29px 31px); background-attachment: local; }
  .vs-slip .line::placeholder { color: rgba(74, 52, 36, 0.6); font-style: italic; }
  .vs-slip .ruled:focus-within .line { background-image: repeating-linear-gradient(transparent 0 29px, rgba(47, 74, 107, 0.5) 29px 31px); }
  .vs-slip .foot { display: flex; align-items: center; gap: 12px; min-height: 30px; }
  .vs-slip .status { flex: 1; margin: 0; font: italic 16px/1.35 ${BOOK}; color: #6b5340; }
  .vs-slip .status[data-tone='warm'] { color: #6a4a2c; }
  .vs-slip .status[data-tone='sorry'] { color: #8a3b2a; }
  .vs-slip .sew { position: relative; flex: none; padding: 4px 14px 6px; border: 0; border-radius: 10px; cursor: pointer;
    background: #c4553f; color: #fffaf0; font: 700 18px/1.1 ${HAND}; box-shadow: 0 3px 8px rgba(120, 50, 30, 0.3); transition: translate 120ms ease, background 120ms ease; }
  .vs-slip .sew::after { content: ''; position: absolute; inset: 3px; border: 1.5px dashed rgba(255, 245, 230, 0.6); border-radius: 7px; pointer-events: none; }
  .vs-slip .sew:hover, .vs-slip .sew:focus-visible { translate: 0 -1px; background: #b04a35; outline: none; }
  .vs-slip .sew:focus-visible { box-shadow: 0 0 0 3px #fffaf0, 0 0 0 5px rgba(47, 74, 107, 0.6); }
  .vs-slip.waiting .sew { display: none; }
  .vs-slip.waiting .line { opacity: 0.7; }
  .vs-slip.waiting .status::after { content: ''; display: inline-block; width: 14px; height: 14px; margin-left: 8px; vertical-align: -2px;
    border: 2px dotted rgba(122, 59, 42, 0.6); border-radius: 50%; animation: vs-spin 2.4s linear infinite; }
  @keyframes vs-spin { to { rotate: 1turn; } }

  .vs-card { position: fixed; z-index: 6; left: 0; top: 0; max-width: min(360px, calc(100vw - 32px)); padding: 18px 20px 13px; margin-top: -14px;
    box-shadow: 0 12px 28px rgba(60, 30, 10, 0.26), 0 2px 0 rgba(255, 255, 255, 0.7) inset; font: 19px/1.42 ${BOOK}; color: #3d2a1c;
    opacity: 0; scale: 0.94; transform-origin: 50% 100%; pointer-events: none; transition: opacity 180ms ease, scale 220ms cubic-bezier(.2, 1.4, .4, 1); }
  .vs-card.shown { opacity: 1; scale: 1; }
  .vs-card.short { font-size: 18px; padding: 15px 18px 11px; }
  .vs-card::after { content: ''; position: absolute; left: 50%; bottom: -10px; width: 20px; height: 20px; margin-left: -10px; background: #f5e7cb; rotate: 45deg;
    border-radius: 0 0 5px 0; box-shadow: 4px 4px 6px rgba(60, 30, 10, 0.14); }
  .vs-card span { opacity: 0; transition: opacity 90ms ease; }
  .vs-card span.in { opacity: 1; }

  .vs-name { position: fixed; z-index: 5; left: 0; top: 0; padding: 4px 14px 6px; border-radius: 11px 11px 5px 5px; pointer-events: none;
    background: color-mix(in oklab, #c4553f 86%, #2a1608); color: #fffaf0; font: 700 20px/1.15 ${HAND}; text-shadow: 0 1px 0 rgba(40, 20, 8, 0.35);
    box-shadow: 0 4px 10px rgba(60, 30, 10, 0.25); opacity: 0; transition: opacity 240ms ease; }
  .vs-name::after { content: ''; position: absolute; inset: 3px; border: 1.5px dashed rgba(255, 248, 236, 0.6); border-radius: 8px 8px 3px 3px; }
  .vs-name.shown { opacity: 1; }
  .vs-name small { font: 600 15px/1.15 ${HAND}; opacity: 0.85; }

  .vs-done { position: fixed; z-index: 6; left: 0; top: 0; padding: 0; border: 0; background: none; cursor: pointer; opacity: 0; pointer-events: none;
    transition: opacity 260ms ease; transform-origin: 50% 0; }
  .vs-done.shown { opacity: 1; pointer-events: auto; }
  .vs-done::before { content: ''; position: absolute; left: 50%; top: -16px; height: 20px; border-left: 2px dashed rgba(120, 80, 50, 0.55); }
  .vs-done span { position: relative; display: inline-block; padding: 10px 22px 12px 34px; border-radius: 8px 18px 18px 8px; rotate: -2deg;
    background: #7b9a6e; color: #fffaf0; font: 700 23px/1 ${HAND}; text-shadow: 0 1px 0 rgba(30, 50, 20, 0.4);
    box-shadow: 0 6px 14px rgba(40, 60, 30, 0.3), inset 0 0 0 2px rgba(255, 255, 255, 0.12); transition: rotate 160ms ease, translate 160ms ease; }
  .vs-done span::before { content: ''; position: absolute; left: 12px; top: 50%; width: 10px; height: 10px; margin-top: -5px; border-radius: 50%;
    background: #f3e7cf; box-shadow: inset 0 0 0 2px rgba(60, 80, 40, 0.5); }
  .vs-done span::after { content: ''; position: absolute; inset: 4px; border: 1.5px dashed rgba(255, 250, 235, 0.6); border-radius: 5px 14px 14px 5px; pointer-events: none; }
  .vs-done:hover span, .vs-done:focus-visible span { rotate: 0deg; translate: 0 -2px; }
  .vs-done:focus-visible { outline: none; }
  .vs-done:focus-visible span { box-shadow: 0 0 0 3px #fffaf0, 0 0 0 5px rgba(47, 74, 107, 0.6), 0 6px 14px rgba(40, 60, 30, 0.3); }
  @media (max-width: 600px) { .vs-slip { bottom: 16px; } .vs-done span { font-size: 18px; padding: 8px 16px 9px 28px; } .vs-save { padding: 8px 12px 7px; } .vs-save button { font-size: 16px; } .vs-save label { font-size: 13px; } .vs-card { font-size: 17px; } }
  @media (prefers-reduced-motion: reduce) { .vs-slip, .vs-card, .vs-name, .vs-done, .vs-done span, .vs-card span { transition: none; } .vs-slip.waiting .status::after { animation: none; } }
  .vs-slip .chip { align-self: flex-start; position: relative; margin: -2px 0 0; padding: 3px 12px 4px; border: 0; border-radius: 999px; cursor: pointer;
    background: rgba(123, 154, 110, 0.22); color: #3f5a32; font: 700 16px ${HAND}; }
  .vs-slip .chip::before { content: ''; position: absolute; inset: 2px; border: 1.2px dashed rgba(63, 90, 50, 0.45); border-radius: 999px; }
  .vs-slip .chip[hidden] { display: none; }
  .vs-slip .chip:focus-visible { outline: none; box-shadow: 0 0 0 2px #fffaf0, 0 0 0 4px rgba(47, 74, 107, 0.6); }
  .vs-note { position: fixed; z-index: 7; left: 50%; top: 18px; max-width: min(460px, calc(100vw - 32px)); margin: 0; padding: 10px 16px 11px; translate: -50% -8px;
    border-radius: 4px; background: #fdf6df; color: #4a3220; font: italic 16px/1.4 ${BOOK}; rotate: -0.8deg;
    box-shadow: 0 6px 14px rgba(60, 30, 10, 0.2); opacity: 0; pointer-events: none; transition: opacity 220ms ease, translate 220ms ease; }
  .vs-note::before { content: ''; position: absolute; left: 50%; top: -6px; width: 12px; height: 12px; margin-left: -6px; border-radius: 50%; background: #c4553f;
    box-shadow: 0 2px 3px rgba(60, 30, 10, 0.35); }
  .vs-note.shown { opacity: 1; translate: -50% 0; }
  .vs-save { position: fixed; z-index: 6; left: 0; top: 0; display: flex; flex-direction: column; gap: 4px; padding: 12px 16px 10px; border-radius: 6px 14px 14px 6px;
    background: linear-gradient(180deg, #fffaf0, #f4e6c9); color: #5a3d27; box-shadow: 0 6px 14px rgba(60, 30, 10, 0.2); rotate: 1.2deg;
    opacity: 0; pointer-events: none; transition: opacity 240ms ease; }
  .vs-save::after { content: ''; position: absolute; inset: 5px; border: 1.5px dashed rgba(150, 100, 60, 0.35); border-radius: 4px 10px 10px 4px; pointer-events: none; }
  .vs-save.shown { opacity: 1; pointer-events: auto; }
  .vs-save button { position: relative; z-index: 1; padding: 0; border: 0; background: none; cursor: pointer; color: #7a3b2a; font: 700 20px/1.2 ${HAND}; text-align: left; }
  .vs-save button:hover, .vs-save button:focus-visible { outline: none; text-decoration: underline wavy rgba(122, 59, 42, 0.5); text-underline-offset: 4px; }
  .vs-save label { position: relative; z-index: 1; display: flex; align-items: center; gap: 6px; font: 15px/1.2 ${HAND}; cursor: pointer; }
  .vs-save input { accent-color: #7b9a6e; }
    @media (prefers-reduced-motion: reduce) { .vs-note, .vs-save { transition: none; } }
  `
}
