import * as THREE from 'three/webgpu'
import type { Context } from 'cordis'
import { own, replace } from '../kernel'
import { canvas, toTexture } from '../paint'
import { KINDS } from '../villagers/kinds'
import { Villager, type Task } from '../villagers/rig'
import { contactShadows, stepCrowd } from '../villagers/cast'
import { NEAR_CHAIR, SEAT_Y, SPOTS } from '../villagers/world'
import { say as sayTo } from '../villager'
import { makeChair, pineMaterial } from './chairs'
import type { Pose } from './camera'

// #42 prototype: talking to villagers like characters in a game, only with ?talk=npc.
// Three felt villagers, each the villager of one synthetic person, do chores in
// the room. Click one (or Tab to it and press Enter) to talk; invite them to the
// table and the table becomes a group conversation.
const params = new URLSearchParams(location.search)
const ON = params.get('talk') === 'npc'
const KIND = KINDS[params.get('villager') ?? ''] ? params.get('villager')! : 'b'
const SCALE = 1.3
const HAND = '"Bradley Hand", "Segoe Print", "Comic Sans MS", cursive'
/** Letters a second: a readable pace that still keeps up with a streaming reply. */
const TYPE_RATE = 42
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)')

interface Person {
  person: string
  owner: string
  colour: string
  start: string
  wait: number
  tasks: Task[]
  hello: string
  chips: string[]
}
/** Synthetic household. Colour is the owner's; the villager's silhouette is its role. */
const PEOPLE: Person[] = [
  { person: 'alex', owner: 'Alex', colour: '#c4503a', start: 'sink', wait: 1, tasks: [{ spot: 'fridge', stay: 5 }, { spot: 'sink', stay: 7 }],
    hello: "Oh! Hello. The soup can mind itself for a minute.", chips: ["What's for dinner?", 'How was your day?'] },
  { person: 'sam', owner: 'Sam', colour: '#d29a26', start: 'shelf', wait: 2, tasks: [{ spot: 'counter', stay: 6 }, { spot: 'shelf', stay: 6 }],
    hello: "Hi! Just putting the toys back. What's up?", chips: ['Anything need doing?', 'How was your day?'] },
  { person: 'mia', owner: 'Mia', colour: '#7a5aa8', start: 'plantSide', wait: 3, tasks: [{ spot: 'plant', stay: 6 }, { spot: 'plantSide', stay: 5 }],
    hello: 'Hello! Mind the watering can.', chips: ['How are the plants?', 'How was your day?'] },
]
/** The synthetic "something for you" a villager carries after a chore. */
const NEWS: Record<string, string> = { mia: 'The basil by the window has a new leaf. I thought you would like to know.' }
/** Seats in the order they fill: the far side first, so faces turn to you. */
const SEATS = ['seatMid', 'seatLeft', 'seatRight', 'seatNear']
const INVITE = 'Come sit with me'
const THANKS = 'Thanks, everyone'
/** The table from above and to the right, close enough for faces, wide enough to see who else is about. */
const TABLE_SHOT: Pose = { position: new THREE.Vector3(1.75, 2.35, 2.6), look: new THREE.Vector3(0.0, 0.45, -0.25) }
const KEPT = 'village.talk.kept'

interface Speech { text: string; done: boolean; away?: string }

interface Member extends Person {
  name: string
  role: string
  entry: string
  v: Villager
  seat: string | null
  news: string | null
  /** Seconds the person has looked at the "!" glyph. */
  looked: number
  glyph: THREE.Sprite
  card: Card
  tag: HTMLDivElement
}

/** A speech card anchored to a villager: a stitched paper card with a felt name tab in the owner's colour. */
class Card {
  el = document.createElement('div')
  private words = document.createElement('p')
  private more = document.createElement('button')
  private full = ''
  private done = true
  private from = 0
  private shown = 0
  private end = 0
  /** Seconds since the words stopped changing; lets the table pass to the next speaker. */
  still = 0
  private reading = 0

  constructor(m: { name: string; owner: string; colour: string; person: string }) {
    this.el.className = 'talk-card'
    this.el.dataset.talkCard = m.person
    this.el.style.setProperty('--c', m.colour)
    const tab = document.createElement('div')
    tab.className = 'tab'
    tab.innerHTML = `<b></b><small></small>`
    tab.querySelector('b')!.textContent = m.name
    tab.querySelector('small')!.textContent = `${m.owner}'s`
    this.words.className = 'words'
    this.more.type = 'button'
    this.more.className = 'more'
    this.more.textContent = 'go on'
    this.more.hidden = true
    this.more.addEventListener('click', () => this.next())
    this.el.append(tab, this.words, this.more)
  }

  /** Start fresh words. */
  reset() {
    this.full = ''
    this.from = this.shown = this.end = 0
    this.words.textContent = ''
  }

  /** The words so far, streaming or whole; `done` once the speaker has finished. */
  set(text: string, done: boolean) {
    this.full = text
    this.done = done
    this.still = 0
    this.paginate()
  }

  get text() {
    return this.full
  }

  /** Every word of the current page is on the card and the speaker has finished. */
  get finished() {
    return this.done && this.shown >= this.end && !this.full.slice(this.end).trim()
  }

  /** At most two sentences at a time; "go on" turns the page. */
  private paginate() {
    const rest = this.full.slice(this.from)
    const stops = [...rest.matchAll(/[.!?…]+["')]?(\s+|$)/g)]
    const second = stops[1]
    const cut = second && (second.index! + second[0].length < rest.length || this.done) ? second.index! + second[0].trimEnd().length : rest.length
    this.end = this.from + cut
  }

  next() {
    this.reading = 0
    if (this.end >= this.full.length) return
    this.from = this.end
    while (/\s/.test(this.full[this.from] ?? '')) this.from++
    this.shown = this.from
    this.paginate()
  }

  get hasMore() {
    return this.shown >= this.end && this.full.slice(this.end).trim().length > 0
  }

  tick(dt: number) {
    const before = this.shown
    this.shown = reducedMotion.matches ? this.end : Math.min(this.end, this.shown + dt * TYPE_RATE)
    if (Math.floor(this.shown) !== Math.floor(before) || this.words.textContent === '') this.words.textContent = this.full.slice(this.from, Math.floor(this.shown))
    this.more.hidden = !this.hasMore
    // A finished page turns by itself once there has been time to read it.
    if (this.hasMore) {
      this.reading += dt
      if (this.reading > 1.4 + (this.end - this.from) / 16) this.next()
    } else this.reading = 0
    if (this.finished) this.still += dt
  }
}

export default {
  name: 'talk',
  inject: ['stage', 'entries', 'view'],
  apply(ctx: Context) {
    if (!ON) return
    const { stage, entries, view } = ctx
    const phys = stage.features().has('phys')
    const group = new THREE.Group()
    group.name = 'talk'

    // ── The cast ──────────────────────────────────────────────────────────
    const glyphMap = stitchedBang()
    const cast: Member[] = PEOPLE.map((p, i) => {
      const spec = KINDS[KIND].specs[i]
      const fig = KINDS[KIND].build(i, phys, { accent: p.colour })
      fig.root.scale.setScalar(SCALE)
      const v = new Villager(fig, p.tasks, { start: p.start, wait: p.wait, paths: 'open' })
      const [name, role] = spec.name.split(', ')
      const glyph = new THREE.Sprite(new THREE.SpriteMaterial({ map: glyphMap, transparent: true, depthWrite: false, opacity: 0 }))
      glyph.name = `${name} news glyph`
      glyph.scale.setScalar(0.15)
      glyph.visible = false
      glyph.renderOrder = 5
      group.add(fig.root, glyph)
      const m: Member = { ...p, name, role, entry: `villager-${p.person}`, v, seat: null, news: null, looked: 0, glyph, card: null!, tag: document.createElement('div') }
      m.card = new Card(m)
      m.tag.className = 'talk-tag'
      m.tag.style.setProperty('--c', p.colour)
      m.tag.textContent = name
      v.onDone = (spot) => {
        // Synthetic trigger: finishing the first watering, the gardener has news.
        if (NEWS[p.person] && spot === 'plant' && !told.has(p.person)) notify(m)
      }
      return m
    })
    const told = new Set<string>()
    const crowd = cast.map((m) => m.v)
    const blobs = contactShadows(crowd)
    group.add(...blobs)
    // A fourth chair on the near side, so four can sit at the table.
    const chair = makeChair(pineMaterial(), new THREE.MeshStandardMaterial({ color: '#e3dccf', roughness: 0.95 }))
    chair.name = 'talk near chair'
    chair.position.set(NEAR_CHAIR.x, 0, NEAR_CHAIR.z)
    chair.rotation.y = NEAR_CHAIR.yaw
    group.add(chair)
    own(ctx, group)

    // ── The page: speech cards, the person's slip, name tags ───────────────
    const slip = document.createElement('form')
    slip.className = 'talk-slip'
    slip.setAttribute('aria-label', 'Your line')
    const chips = document.createElement('div')
    chips.className = 'chips'
    const line = document.createElement('input')
    line.className = 'line'
    line.type = 'text'
    line.maxLength = 600
    line.autocomplete = 'off'
    line.setAttribute('aria-label', 'Say something')
    const mine = document.createElement('p')
    mine.className = 'mine'
    slip.append(mine, chips, line)
    const voice = document.createElement('div')
    voice.className = 'talk-voice'
    voice.setAttribute('role', 'status')
    voice.setAttribute('aria-live', 'polite')
    const style = document.createElement('style')
    style.textContent = css()
    ctx.effect(() => {
      document.head.append(style)
      document.body.append(slip, voice, ...cast.flatMap((m) => [m.card.el, m.tag]))
      return () => {
        for (const m of cast) {
          m.card.el.remove()
          m.tag.remove()
        }
        slip.remove()
        voice.remove()
        style.remove()
      }
    }, 'talk page')

    // ── State ──────────────────────────────────────────────────────────────
    type Mode = 'room' | 'talk' | 'table'
    let mode: Mode = 'room'
    let partner: Member | null = null
    /** Seated at the table, in seat order. */
    const seated: Member[] = []
    /** Cards on screen and whether each is the current speaker. */
    const showing = new Map<Member, 'speaking' | 'said'>()
    let speaker: Member | null = null
    let pending = false
    let quietLeave = false
    let lastRound: { name: string; text: string }[] = []
    /** The villager just let go of: hover does not pause it again until the pointer leaves. */
    let released: Member | null = null

    const show = (m: Member, as: 'speaking' | 'said') => {
      showing.set(m, as)
      m.card.el.classList.add('shown')
      m.card.el.classList.toggle('said', as === 'said')
    }
    const hide = (m: Member) => {
      showing.delete(m)
      m.card.el.classList.remove('shown', 'said')
    }
    const hideAll = () => {
      for (const m of cast) hide(m)
    }
    const speak = (m: Member, text: string, done = true) => {
      m.card.reset()
      m.card.set(text, done)
      show(m, 'speaking')
    }
    const setChips = (labels: string[]) => {
      chips.replaceChildren(...labels.map((label) => {
        const b = document.createElement('button')
        b.type = 'button'
        b.className = 'chip'
        b.textContent = label
        b.addEventListener('click', () => chip(label))
        return b
      }))
    }
    const openSlip = (placeholder: string, labels: string[]) => {
      line.placeholder = placeholder
      setChips(labels)
      slip.classList.add('shown')
      if (!matchMedia('(pointer: coarse)').matches) setTimeout(() => line.focus({ preventScroll: true }), 30)
    }
    const closeSlip = () => {
      slip.classList.remove('shown')
      mine.classList.remove('shown')
      line.blur()
    }

    // ── Camera ─────────────────────────────────────────────────────────────
    const eye = new THREE.Vector3()
    // Line of sight for the two-shot: anything solid but the villagers blocks it.
    const raycaster = new THREE.Raycaster()
    const figures = new Set<THREE.Object3D>(cast.map((m) => m.v.fig.root))
    const solid = (o: THREE.Object3D) => {
      if (!(o as THREE.Mesh).isMesh) return false
      for (let n: THREE.Object3D | null = o; n; n = n.parent) if (!n.visible || figures.has(n)) return false
      return ([] as THREE.Material[]).concat((o as THREE.Mesh).material).some((mat) => mat.visible && mat.depthWrite)
    }
    const clear = (from: THREE.Vector3, to: THREE.Vector3) => {
      const d = to.clone().sub(from)
      raycaster.set(from, d.clone().normalize())
      raycaster.far = d.length()
      raycaster.camera = stage.camera
      return !raycaster.intersectObject(stage.scene, true).some((h) => solid(h.object))
    }
    /**
     * A close two-shot: the villager on the left third, room for its card on the
     * right. Starts from the side the room is seen from and turns until nothing
     * stands between the camera and the villager.
     */
    const twoShot = (m: Member): Pose => {
      const p = m.v.pos
      stage.camera.getWorldPosition(eye)
      const base = Math.atan2(eye.x - p.x, eye.z - p.z)
      const floor = m.v.seated > 0.5 ? SEAT_Y : 0
      const head = new THREE.Vector3(p.x, floor + m.v.fig.height * SCALE * 0.72, p.z)
      const body = head.clone().setY(floor + m.v.fig.height * SCALE * 0.35)
      const shot = (a: number, dist: number) => {
        const dir = new THREE.Vector3(Math.sin(a), 0, Math.cos(a))
        const right = new THREE.Vector3(dir.z, 0, -dir.x)
        return {
          position: head.clone().addScaledVector(dir, dist).addScaledVector(right, -0.15).setY(head.y + 0.42),
          look: head.clone().setY(head.y - 0.06).addScaledVector(right, 0.3),
        }
      }
      for (const dist of [1.5, 1.15])
        for (const turn of [0, 0.45, -0.45, 0.9, -0.9, 1.35, -1.35, 1.8, -1.8, 2.4, -2.4]) {
          const pose = shot(base + turn, dist)
          if (clear(pose.position, head) && clear(pose.position, body)) return pose
        }
      return shot(base, 1.5)
    }

    // ── Talking with one villager ───────────────────────────────────────────
    const talk = (m: Member) => {
      if (partner && partner !== m) endTalk(false)
      partner = m
      mode = 'talk'
      m.v.chosen = true
      m.v.beat()
      for (const o of showing.keys()) if (o !== m) hide(o)
      mine.classList.remove('shown')
      view.focus(twoShot(m), 7)
      const news = m.news
      if (news) clearNews(m)
      speak(m, news ?? m.hello)
      const invited = Boolean(m.seat)
      openSlip(`Say something to ${m.name}…`, [...m.chips, ...(invited ? [] : [INVITE])])
    }

    /** Back to chores, or to the table if anyone is sitting there. */
    const endTalk = (moveCamera = true) => {
      const m = partner
      if (!m) return
      partner = null
      released = m
      m.v.chosen = false
      m.v.thinking = m.v.speaking = false
      hide(m)
      if (!moveCamera) return
      if (seated.length) toTable()
      else toRoom()
    }

    const toRoom = () => {
      mode = 'room'
      view.focus(null, 4)
      closeSlip()
      hideAll()
      for (const m of cast) m.tag.classList.remove('shown', 'lit')
    }

    const toTable = () => {
      mode = 'table'
      view.focus(TABLE_SHOT, 5)
      const names = seated.map((m) => m.name)
      openSlip(seated.length > 1 ? `Say something to the table, or start with a name…` : `Say something to ${names[0]}…`, ["What's everyone up to?", THANKS])
    }

    const invite = (m: Member) => {
      // The nearest free chair, so nobody walks around the whole table.
      const free = SEATS.filter((s) => !cast.some((o) => o.seat === s))
      // Far-side chairs face the room, so they win unless they are much further away.
      const cost = (seat: string) => m.v.distanceTo(seat) + (seat === 'seatNear' ? 3 : seat === 'seatRight' ? 1 : 0)
      const seat = free.sort((a, b) => cost(a) - cost(b))[0]
      if (!seat) {
        speak(m, 'The table is full! Maybe next time.')
        return
      }
      m.seat = seat
      seated.push(m)
      seated.sort((a, b) => SEATS.indexOf(a.seat!) - SEATS.indexOf(b.seat!))
      // Leave the talk without sending anyone back to chores.
      if (partner === m) {
        partner = null
        quietLeave = true
        entries.back()
        quietLeave = false
      }
      m.v.thinking = m.v.speaking = false
      m.v.sendTo(seat)
      speak(m, 'Coming!')
      setTimeout(() => showing.get(m) && m.card.text === 'Coming!' && hide(m), 1600)
      toTable()
    }

    const leaveTable = () => {
      for (const m of seated) {
        m.seat = null
        m.v.release(0.3 + Math.random() * 0.6)
        m.v.speaking = m.v.thinking = false
      }
      seated.length = 0
      lastRound = []
      speaker = null
      toRoom()
    }

    const chip = (label: string) => {
      if (label === INVITE && partner) invite(partner)
      else if (label === THANKS) leaveTable()
      else send(label)
    }

    // ── Sending lines ───────────────────────────────────────────────────────
    const keep = (person: string, text: string) => {
      try {
        const kept = JSON.parse(localStorage.getItem(KEPT) ?? '[]')
        kept.push({ person, text, at: new Date().toISOString() })
        localStorage.setItem(KEPT, JSON.stringify(kept.slice(-50)))
      } catch {
        // Storage can be unavailable (private windows); the line also stays in the slip.
      }
    }
    const inCharacter = (why: string) =>
      why === 'busy' ? "Hold on, I'm still thinking about the last thing."
        : why === 'failed' ? 'I lost my thread there. Could you say that again?'
          : "Sorry, I'm out for a moment. I've kept what you said."

    /** Ask one villager and stream its words into a speech record. */
    const ask = (m: Member, text: string): Speech => {
      const speech: Speech = { text: '', done: false }
      void sayTo(m.person, text, (t) => (speech.text += t)).then((said) => {
        if (said.ok) speech.text = said.reply
        else speech.away = said.why
        speech.done = true
      })
      return speech
    }

    const send = async (text: string) => {
      text = text.trim()
      if (!text || pending) return
      pending = true
      line.value = ''
      mine.textContent = text
      mine.classList.add('shown')
      slip.classList.add('waiting')
      try {
        if (mode === 'talk' && partner) {
          const m = partner
          const ok = await perform(m, ask(m, text), text)
          if (!ok) line.value = text
        } else if (mode === 'table' && seated.length) {
          await table(text)
        }
      } finally {
        pending = false
        slip.classList.remove('waiting')
        if (mode === 'talk' && partner) line.placeholder = `Say something to ${partner.name}…`
        else if (mode === 'table') line.placeholder = seated.length > 1 ? 'Say something to the table, or start with a name…' : `Say something to ${seated[0]?.name ?? ''}…`
      }
    }

    /**
     * One villager's turn on stage: a thinking beat (eyes up, a tap of the chin)
     * until the first words, then the card types them out while it leans in.
     * Resolves when the words are on the card. False if the host could not answer.
     */
    const perform = async (m: Member, speech: Speech, said: string): Promise<boolean> => {
      speaker = m
      m.v.thinking = true
      hide(m)
      // Even a quick answer gets its beat: eyes up, a tap of the chin, then words.
      const beat = clock + 0.5
      while ((!speech.text && !speech.done) || clock < beat) await frame()
      m.v.thinking = false
      if (speech.away) {
        keep(m.person, said)
        speak(m, inCharacter(speech.away))
        voice.textContent = `${m.name}: ${m.card.text}`
        while (!m.card.finished) await frame()
        return false
      }
      m.v.speaking = true
      speak(m, speech.text, speech.done)
      while (!speech.done || !m.card.finished) {
        m.card.set(speech.text, speech.done)
        await frame()
      }
      m.v.speaking = false
      voice.textContent = `${m.name}: ${speech.text}`
      return true
    }

    /** The table: everyone answers in turn, or only the one named first. */
    const table = async (text: string) => {
      const named = seated.find((m) => new RegExp(`^\\s*${m.name}\\b`, 'i').test(text))
      const turn = named ? [named] : [...seated]
      for (const m of seated) hide(m)
      // Every request starts at once; they speak one at a time. Each hears only
      // the person's line and, marked as context, what the others said last round.
      const asks = turn.map((m) => {
        const others = lastRound.filter((r) => r.name !== m.name)
        const note = others.length ? `\n\n(Context only, not part of the message: at the kitchen table just now, ${others.map((r) => `${r.name} said "${r.text.slice(0, 160)}"`).join(' and ')}.)` : ''
        return { m, speech: ask(m, text + note) }
      })
      const round: { name: string; text: string }[] = []
      let failed = false
      for (const [k, { m, speech }] of asks.entries()) {
        for (const o of seated) o.tag.classList.toggle('lit', o === m)
        const ok = await perform(m, speech, text)
        if (ok) round.push({ name: m.name, text: speech.text })
        else failed = true
        if (k < asks.length - 1) {
          await pause(0.9)
          show(m, 'said')
        }
      }
      speaker = null
      for (const o of seated) o.tag.classList.remove('lit')
      if (round.length) lastRound = round
      if (failed && !line.value) line.value = text
    }

    // ── The "!" glyph: one quiet signal, never repeated or escalated ────────
    const notify = (m: Member) => {
      if (told.has(m.person) || m.news) return
      m.news = NEWS[m.person] ?? 'I finished up. Nothing urgent.'
      m.looked = 0
      m.glyph.visible = true
    }
    const clearNews = (m: Member) => {
      told.add(m.person)
      m.news = null
    }

    // ── Entries: hover glow and name, click or Tab and Enter to talk ────────
    for (const m of cast) {
      ctx.effect(() => entries.add({
        id: m.entry,
        label: m.name,
        object: m.v.fig.root,
        select() {
          if (mode === 'table' && m.seat && m.v.seated > 0.5) {
            // At the table, choosing someone seated addresses them by name.
            line.value = `${m.name}, `
            line.focus({ preventScroll: true })
            quietLeave = true
            queueMicrotask(() => {
              entries.back()
              quietLeave = false
            })
            return
          }
          talk(m)
        },
        leave() {
          if (quietLeave) return
          if (partner === m) endTalk()
        },
      }), `talk entry ${m.entry}`)
    }

    // ── Input ───────────────────────────────────────────────────────────────
    const onSubmit = (e: Event) => {
      e.preventDefault()
      void send(line.value)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      if (mode === 'table' && !entries.active) {
        e.preventDefault()
        leaveTable()
      }
    }
    ctx.effect(() => {
      slip.addEventListener('submit', onSubmit)
      addEventListener('keydown', onKey)
      return () => {
        slip.removeEventListener('submit', onSubmit)
        removeEventListener('keydown', onKey)
      }
    }, 'talk input')
    ctx.effect(() => () => {
      if (mode !== 'room') view.focus(null)
    }, 'talk camera')

    // ── Each frame ──────────────────────────────────────────────────────────
    const waiters = new Set<() => void>()
    const frame = () => new Promise<void>((done) => waiters.add(done))
    const pause = async (seconds: number) => {
      const until = clock + seconds
      while (clock < until) await frame()
    }
    let clock = 0
    const at = new THREE.Vector3()
    const rect = () => stage.renderer.domElement.getBoundingClientRect()
    const screen = (m: Member, above: number) => {
      const { root } = m.v.fig
      at.set(0, m.v.fig.height + above - m.v.fig.hip * m.v.seated, 0)
      root.localToWorld(at)
      at.project(stage.camera)
      const r = rect()
      return { x: r.left + ((at.x + 1) / 2) * r.width, y: r.top + ((1 - at.y) / 2) * r.height, behind: at.z > 1 }
    }
    ctx.on('village/frame', (dt, t) => {
      clock += dt
      stage.camera.getWorldPosition(eye)
      // Hovering pauses a walker so it is easy to click; one just let go walks on until the pointer leaves it.
      if (released && entries.hovered !== released.entry) released = null
      for (const m of cast) m.v.paused = entries.hovered === m.entry && m !== released && mode === 'room'
      stepCrowd(crowd, blobs, Math.min(dt, 0.05), t, eye, SCALE)
      for (const m of cast) {
        // The glyph bobs over the head and fades once looked at for a second.
        if (m.glyph.visible) {
          at.set(0, m.v.fig.height + 0.16, 0)
          m.v.fig.root.localToWorld(at)
          // About the same size on screen from the room view as up close, floating just clear of the head.
          const size = THREE.MathUtils.clamp(eye.distanceTo(at) * 0.045, 0.13, 0.7)
          m.glyph.scale.setScalar(size)
          m.glyph.position.copy(at).setY(at.y + size * 0.4 + Math.sin(t * 2.4) * 0.015)
          const mat = m.glyph.material
          if (entries.hovered === m.entry && m.news) m.looked += dt
          if (m.looked >= 1 && m.news) clearNews(m)
          const goal = m.news ? 1 : 0
          mat.opacity += (goal - mat.opacity) * (1 - Math.exp(-dt * (goal ? 5 : 3)))
          if (!m.news && mat.opacity < 0.02) m.glyph.visible = false
        }
        m.card.tick(dt)
        // Cards sit beside the speaker in a talk, above their head at the table.
        if (showing.has(m)) {
          const s = screen(m, 0.02)
          const card = m.card.el
          if (mode === 'talk' && partner === m) {
            const w = card.offsetWidth, h = card.offsetHeight
            const left = Math.min(innerWidth - w - 16, Math.max(16, s.x + 70))
            const top = Math.min(innerHeight - h - 150, Math.max(24, s.y - 10))
            card.style.transform = `translate(${left}px, ${top}px)`
            card.classList.add('beside')
            card.style.setProperty('--tail', `${Math.max(18, Math.min(h - 18, s.y + 30 - top))}px`)
          } else {
            const w = card.offsetWidth, h = card.offsetHeight
            const left = Math.min(innerWidth - w - 12, Math.max(12, s.x - w / 2))
            const top = Math.max(12, s.y - h - 22)
            card.style.transform = `translate(${left}px, ${top}px)`
            card.style.setProperty('--tail', `${Math.max(22, Math.min(w - 22, s.x - left))}px`)
            card.classList.remove('beside')
          }
        }
        // Name tags over everyone at the table; the speaker's is lit and carries the card.
        const tagged = mode === 'table' && m.seat !== null && m.v.seated > 0.5 && !showing.has(m)
        m.tag.classList.toggle('shown', tagged)
        if (tagged) {
          const s = screen(m, 0.06)
          m.tag.style.transform = `translate(${s.x}px, ${s.y}px) translate(-50%, -100%)`
        }
      }
      for (const done of [...waiters]) {
        waiters.delete(done)
        done()
      }
    })

    // ── Inspection, for the checks ──────────────────────────────────────────
    ctx.effect(() => {
      const village = (window as unknown as { village: Record<string, unknown> }).village
      village.talk = {
        state: () => ({
          mode,
          partner: partner?.person ?? null,
          speaker: speaker?.person ?? null,
          seated: seated.map((m) => m.person),
          pending,
          line: line.value,
          cards: Object.fromEntries([...showing].map(([m, as]) => [m.person, { as, text: m.card.text, finished: m.card.finished }])),
          cast: Object.fromEntries(cast.map((m) => [m.person, {
            name: m.name, state: m.v.state, seated: m.v.seated > 0.5, seat: m.seat, spot: m.v.spot, thinking: m.v.thinking, speaking: m.v.speaking,
            news: Boolean(m.news), glyph: m.glyph.visible ? m.glyph.material.opacity : 0, x: m.v.pos.x, z: m.v.pos.z,
          }])),
          lit: seated.filter((m) => m.tag.classList.contains('lit')).map((m) => m.person),
          focused: view.focused,
        }),
        notify: (person: string) => {
          const m = cast.find((c) => c.person === person)
          if (m) notify(m)
        },
        screen: (person: string) => {
          const m = cast.find((c) => c.person === person)!
          const box = new THREE.Box3().setFromObject(m.v.fig.root)
          const c = box.getCenter(new THREE.Vector3())
          c.project(stage.camera)
          const r = rect()
          return { x: r.left + ((c.x + 1) / 2) * r.width, y: r.top + ((1 - c.y) / 2) * r.height }
        },
      }
      return () => {
        delete village.talk
      }
    }, 'talk inspection')
  },
}

/** A round felt patch with a stitched "!", painted in code. */
function stitchedBang() {
  const [c, g] = canvas(128, 128)
  g.fillStyle = '#f2cf6b'
  g.beginPath()
  g.arc(64, 64, 56, 0, Math.PI * 2)
  g.fill()
  for (let i = 0; i < 900; i++) {
    const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * 54
    g.fillStyle = Math.random() > 0.5 ? 'rgba(255,255,255,0.12)' : 'rgba(120,70,20,0.12)'
    g.fillRect(64 + Math.cos(a) * r, 64 + Math.sin(a) * r, 1.5, 1.5)
  }
  g.strokeStyle = 'rgba(110, 66, 30, 0.85)'
  g.lineWidth = 3
  g.setLineDash([7, 6])
  g.beginPath()
  g.arc(64, 64, 47, 0, Math.PI * 2)
  g.stroke()
  g.setLineDash([])
  g.fillStyle = '#5a3420'
  g.beginPath()
  g.roundRect(56, 26, 16, 50, 7)
  g.fill()
  g.beginPath()
  g.arc(64, 92, 9, 0, Math.PI * 2)
  g.fill()
  g.strokeStyle = 'rgba(255, 236, 200, 0.55)'
  g.lineWidth = 1.6
  for (let y = 31; y < 72; y += 7) {
    g.beginPath()
    g.moveTo(60, y)
    g.lineTo(68, y + 3)
    g.stroke()
  }
  return toTexture(c)
}

function css() {
  return `
  .talk-card { position: fixed; left: 0; top: 0; width: 330px; max-width: calc(100vw - 32px); box-sizing: border-box;
    padding: 22px 22px 14px; border-radius: 16px; color: #46301f; font: 21px/1.32 ${HAND};
    background: radial-gradient(120% 90% at 20% 0%, #fffaf0 0%, #fbf1dd 55%, #f3e3c4 100%);
    box-shadow: 0 14px 34px rgba(60, 30, 10, 0.3), 0 2px 0 rgba(255, 255, 255, 0.7) inset, 0 -3px 0 rgba(150, 105, 60, 0.18) inset;
    opacity: 0; pointer-events: none; transition: opacity 180ms ease, scale 220ms cubic-bezier(.2, 1.4, .4, 1); scale: 0.94; transform-origin: 0 50%; }
  .talk-card::before { content: ''; position: absolute; inset: 7px; border: 2px dashed rgba(150, 100, 60, 0.38); border-radius: 11px; pointer-events: none; }
  .talk-card.shown { opacity: 1; scale: 1; pointer-events: auto; }
  .talk-card.said { scale: 0.82; filter: saturate(0.75) brightness(0.97); }
  .talk-card::after { content: ''; position: absolute; left: var(--tail, 50%); bottom: -10px; width: 20px; height: 20px; margin-left: -10px;
    background: #f5e7cb; rotate: 45deg; border-radius: 0 0 5px 0; box-shadow: 4px 4px 6px rgba(60, 30, 10, 0.14); }
  .talk-card.beside::after { left: -10px; top: var(--tail, 40px); bottom: auto; margin: -10px 0 0; background: #fcf4e3; border-radius: 0 0 0 5px; box-shadow: -3px 3px 5px rgba(60, 30, 10, 0.12); }
  .talk-card .tab { position: absolute; left: 18px; top: -19px; padding: 4px 14px 5px; border-radius: 11px 11px 5px 5px;
    background: var(--c); color: #fff8ec; font: 700 19px/1.15 ${HAND}; letter-spacing: 0.01em;
    box-shadow: 0 4px 10px rgba(60, 30, 10, 0.25), inset 0 0 0 2px rgba(255, 255, 255, 0.12); }
  .talk-card .tab::after { content: ''; position: absolute; inset: 3px; border: 1.5px dashed rgba(255, 248, 236, 0.55); border-radius: 8px 8px 3px 3px; }
  .talk-card .tab small { font-weight: 400; font-size: 14px; opacity: 0.85; margin-left: 7px; }
  .talk-card .words { margin: 0; min-height: 1.3em; white-space: pre-wrap; }
  .talk-card .more { display: block; margin: 4px 0 0 auto; padding: 2px 4px; border: 0; background: none; cursor: pointer;
    font: italic 700 17px ${HAND}; color: var(--c); }
  .talk-card .more::after { content: ' \\25B8'; }
  .talk-card .more[hidden] { display: none; }
  .talk-slip { position: fixed; left: 50%; bottom: 22px; width: min(600px, calc(100vw - 32px)); display: flex; flex-direction: column;
    align-items: center; gap: 12px; opacity: 0; translate: -50% 14px; pointer-events: none; transition: opacity 220ms ease, translate 240ms ease; }
  .talk-slip.shown { opacity: 1; translate: -50% 0; pointer-events: auto; }
  .talk-slip .chips { display: flex; gap: 10px; flex-wrap: wrap; justify-content: center; }
  .talk-slip .chip { position: relative; padding: 7px 16px 8px; border: 0; border-radius: 999px; cursor: pointer;
    background: #f6ead2; color: #553a26; font: 18px ${HAND}; box-shadow: 0 4px 12px rgba(60, 30, 10, 0.22), inset 0 -2px 0 rgba(150, 105, 60, 0.15);
    transition: translate 120ms ease, background 120ms ease; }
  .talk-slip .chip::before { content: ''; position: absolute; inset: 3px; border: 1.5px dashed rgba(150, 100, 60, 0.35); border-radius: 999px; }
  .talk-slip .chip:hover, .talk-slip .chip:focus-visible { background: #fff6e4; translate: 0 -2px; outline: none; }
  .talk-slip .line { box-sizing: border-box; width: 100%; padding: 12px 20px; border: 0; border-radius: 14px; outline: none;
    background: linear-gradient(transparent 0 calc(100% - 14px), rgba(150, 100, 60, 0.28) calc(100% - 14px) calc(100% - 12.5px), transparent calc(100% - 12.5px)), #fbf3e2;
    color: #46301f; font: 22px ${HAND}; box-shadow: 0 10px 28px rgba(60, 30, 10, 0.26); }
  .talk-slip .line::placeholder { color: rgba(90, 64, 48, 0.5); font-style: italic; }
  .talk-slip.waiting .line { opacity: 0.75; }
  .talk-slip .mine { margin: 0; max-width: 100%; padding: 6px 16px 7px; border-radius: 10px; rotate: -0.6deg; display: none;
    background: #fdf8ec; color: #2f4a6b; font: italic 20px/1.3 ${HAND}; box-shadow: 0 4px 12px rgba(60, 30, 10, 0.18); }
  .talk-slip .mine::before { content: 'You: '; font-style: normal; font-weight: 700; color: #6b4b35; }
  .talk-slip .mine.shown { display: block; }
  .talk-tag { position: fixed; left: 0; top: 0; padding: 3px 13px 4px; border-radius: 999px; pointer-events: none; opacity: 0;
    background: rgba(251, 243, 226, 0.88); color: #6b4b35; font: 700 17px ${HAND}; box-shadow: 0 3px 10px rgba(60, 30, 10, 0.2);
    transition: opacity 200ms ease, background 200ms ease, color 200ms ease; white-space: nowrap; }
  .talk-tag.shown { opacity: 1; }
  .talk-tag.lit { background: var(--c); color: #fff8ec; }
  .talk-voice { position: fixed; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
  @media (prefers-reduced-motion: reduce) { .talk-card, .talk-slip, .talk-tag { transition: none; } }
  `
}

if (import.meta.hot) import.meta.hot.accept((m) => m && replace(m.default))
