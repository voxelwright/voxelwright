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
/** ?slip=always keeps your paper slip on screen with no talk open, addressed to your own villager. */
const SLIP_ALWAYS = params.get('slip') === 'always'
const KIND = KINDS[params.get('villager') ?? ''] ? params.get('villager')! : 'b'
const SCALE = 1.3
const HAND = '"Bradley Hand", "Segoe Print", "Comic Sans MS", cursive'
/** Villagers' words: a warm book face, easier to read at length than handwriting. */
const BOOK = '"Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif'
/** Letters a second, revealed a whole word at a time: a reading pace that keeps up with a streaming reply. */
const TYPE_RATE = 58
/** A page holds two sentences, or one if two would run longer than this. */
const PAGE_CHARS = 150
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
  bye: string
}
/** Synthetic household. Colour is the owner's; the villager's silhouette is its role. */
const PEOPLE: Person[] = [
  { person: 'alex', owner: 'Alex', colour: '#c4503a', start: 'sink', wait: 1, tasks: [{ spot: 'fridge', stay: 5 }, { spot: 'sink', stay: 7 }],
    hello: "Oh! Hello. The soup can mind itself for a minute.", chips: ["What's for dinner?", 'How was your day?'], bye: 'Back to my soup, then. Bye for now!' },
  { person: 'sam', owner: 'Sam', colour: '#d29a26', start: 'shelf', wait: 2, tasks: [{ spot: 'counter', stay: 6 }, { spot: 'shelf', stay: 6 }],
    hello: "Hi! Just putting the toys back. What's up?", chips: ['Anything need doing?', 'How was your day?'], bye: 'Off to tidy! See you soon.' },
  { person: 'mia', owner: 'Mia', colour: '#7a5aa8', start: 'plantSide', wait: 3, tasks: [{ spot: 'plant', stay: 6 }, { spot: 'plantSide', stay: 5 }],
    hello: 'Hello! Mind the watering can.', chips: ['How are the plants?', 'How was your day?'], bye: 'Bye! The basil is waiting for me.' },
]
/** The synthetic "something for you" a villager carries after a chore. */
const NEWS: Record<string, string> = { mia: 'The basil by the window has a new leaf. I thought you would like to know.' }
/** Seats in the order they fill: the far side first, so faces turn to you. */
const SEATS = ['seatMid', 'seatLeft', 'seatRight', 'seatNear']
const INVITE = 'Come sit with me'
const THANKS = 'Thanks, everyone'
/** A typed line that only says goodbye, so it is treated like the chip and not sent as a message. */
const FAREWELL = /^\s*(?:(?:ok(?:ay)?|right|well)[\s,]+)?(?:thanks?(?: you)?(?: so much)?|thank you|cheers|ta|bye(?:-?bye)?|good ?bye|see (?:you|ya)(?: later| soon)?|good ?night|that'?s all)(?:[\s,!.]+(?:everyone|everybody|all|guys|folks|friends|bye|for now|then|again))*[\s!.]*$/i
/** Booster cushions on the chairs, so a seated villager clears the table top. */
const BOOSTER = 0.12/** The table from above and to the right, close enough for faces, wide enough to see who else is about. */
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

/** The one name tag every speaker wears: a felt ribbon in its colour, the name, and whose villager it is. */
function nameTag(name: string, owner: string | null, colour: string) {
  const tag = document.createElement('div')
  tag.className = 'nametag'
  tag.style.setProperty('--c', colour)
  const b = document.createElement('b')
  b.textContent = name
  tag.append(b)
  if (owner) {
    const small = document.createElement('small')
    small.textContent = `${owner}'s`
    tag.append(small)
  }
  return tag
}

/** A speech card anchored to a villager: a stitched paper card wearing its name tag. */
class Card {
  el = document.createElement('div')
  private words = document.createElement('p')
  /** The current page's known words, invisible, so the card is sized for them before they are revealed. */
  private sizer = document.createElement('p')
  private more = document.createElement('button')
  /** Stitched dots while the speaker is still talking. */
  private cue = document.createElement('span')
  private full = ''
  private done = true
  private from = 0
  private shown = 0
  private end = 0
  private visible = 0
  /** Seconds since the words stopped changing; lets the table pass to the next speaker. */
  still = 0
  private reading = 0

  constructor(m: { name: string; owner: string; colour: string; person: string }) {
    this.el.className = 'talk-card'
    this.el.dataset.talkCard = m.person
    this.el.style.setProperty('--c', m.colour)
    const tab = nameTag(m.name, m.owner, m.colour)
    tab.classList.add('tab')
    const page = document.createElement('div')
    page.className = 'page'
    this.words.className = 'words'
    this.sizer.className = 'sizer'
    this.sizer.setAttribute('aria-hidden', 'true')
    page.append(this.sizer, this.words)
    this.more.type = 'button'
    this.more.className = 'more'
    this.more.textContent = 'go on'
    this.more.hidden = true
    this.more.addEventListener('click', () => this.next())
    this.cue.className = 'cue'
    this.cue.setAttribute('aria-label', 'still talking')
    this.cue.innerHTML = '<i></i><i></i><i></i>'
    this.el.append(tab, page, this.more, this.cue)
  }

  /** Start fresh words. */
  reset() {
    this.full = ''
    this.from = this.shown = this.end = this.visible = 0
    this.words.textContent = this.sizer.textContent = ''
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
    return this.done && this.visible >= this.end && !this.full.slice(this.end).trim()
  }

  /** About two short sentences at a time; "go on" turns the page. */
  private paginate() {
    const rest = this.full.slice(this.from)
    const stops = [...rest.matchAll(/[.!?…]+["')]?(\s+|$)/g)]
    const closed = (s: RegExpExecArray | RegExpMatchArray | undefined) => s && (s.index! + s[0].length < rest.length || this.done)
    const at = (s: RegExpExecArray | RegExpMatchArray) => s.index! + s[0].trimEnd().length
    const [first, second] = stops
    const cut = closed(first) && (at(first) > PAGE_CHARS * 0.55 || (closed(second) && at(second!) > PAGE_CHARS) || (!second && rest.length > PAGE_CHARS)) ? at(first!)
      : closed(second) ? at(second!) : rest.length
    this.end = this.from + cut
  }

  next() {
    this.reading = 0
    if (this.end >= this.full.length) return
    this.from = this.end
    while (/\s/.test(this.full[this.from] ?? '')) this.from++
    this.shown = this.visible = this.from
    this.paginate()
  }

  /** The "still talking" dots are showing. */
  get talking() {
    return !this.cue.hidden
  }

  get hasMore() {
    return this.visible >= this.end && this.full.slice(this.end).trim().length > 0
  }

  tick(dt: number) {
    this.shown = reducedMotion.matches ? this.end : Math.min(this.end, this.shown + dt * TYPE_RATE)
    // Whole words only: the page's last word is whole once the page is cut at a sentence or the speaker is done.
    const whole = this.done || this.end < this.full.length
    let v = Math.max(this.from, Math.floor(this.shown))
    if (!(v >= this.end && whole)) while (v > this.from && !/\s/.test(this.full[v] ?? '')) v--
    let known = this.end
    if (!whole) while (known > v && !/\s/.test(this.full[known] ?? '')) known--
    if (v !== this.visible || this.sizer.textContent === '') {
      this.visible = v
      this.words.textContent = this.full.slice(this.from, v)
    }
    const sized = this.full.slice(this.from, known)
    if (this.sizer.textContent !== sized) this.sizer.textContent = sized
    this.more.hidden = !this.hasMore
    this.cue.hidden = this.finished || this.hasMore
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
      const v = new Villager(fig, p.tasks, { start: p.start, wait: p.wait, paths: 'open', seatY: SEAT_Y + BOOSTER })
      const [name, role] = spec.name.split(', ')
      const glyph = new THREE.Sprite(new THREE.SpriteMaterial({ map: glyphMap, transparent: true, depthWrite: false, opacity: 0 }))
      glyph.name = `${name} news glyph`
      glyph.scale.setScalar(0.15)
      glyph.visible = false
      glyph.renderOrder = 5
      group.add(fig.root, glyph)
      const m: Member = { ...p, name, role, entry: `villager-${p.person}`, v, seat: null, news: null, looked: 0, glyph, card: null!, tag: document.createElement('div') }
      m.card = new Card(m)
      m.tag = nameTag(name, p.owner, p.colour)
      m.tag.classList.add('talk-tag')
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
    // A plump felt booster on each chair the villagers use, buttoned in the middle.
    const felt = new THREE.MeshStandardMaterial({ color: '#d8b98f', roughness: 1 })
    const button = new THREE.MeshStandardMaterial({ color: '#8a5a3a', roughness: 0.8 })
    const puff = new THREE.SphereGeometry(1, 24, 12)
    for (const seat of SEATS) {
      const at = SPOTS[seat].seat!
      const cushion = new THREE.Mesh(puff, felt)
      cushion.name = `talk booster ${seat}`
      cushion.scale.set(0.17, BOOSTER * 0.55, 0.16)
      cushion.position.set(at.x, SEAT_Y + BOOSTER * 0.42, at.z)
      cushion.castShadow = cushion.receiveShadow = true
      const knot = new THREE.Mesh(puff, button)
      knot.scale.set(0.022, 0.012, 0.022)
      knot.position.set(at.x, SEAT_Y + BOOSTER * 0.95, at.z)
      group.add(cushion, knot)
    }
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
    // The slip's tab says who the line goes to; it changes as you turn to a villager or the table.
    let to = document.createElement('div')
    const ruled = document.createElement('label')
    ruled.className = 'ruled'
    ruled.append(line)
    slip.append(to, mine, ruled, chips)
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
        document.body.classList.remove('talk-hovering')
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
    /** Address the slip to one villager or the whole table. */
    const address = (who: Member | 'table') => {
      const tag = who === 'table' ? nameTag('The table', null, '#8a6a48') : nameTag(who.name, who.owner, who.colour)
      tag.classList.add('tab')
      slip.dataset.to = who === 'table' ? 'table' : who.person
      to.replaceWith(tag)
      to = tag
    }
    const openSlip = (placeholder: string, labels: string[], who: Member | 'table') => {
      address(who)
      line.placeholder = placeholder
      setChips(labels)
      slip.classList.add('shown')
      slip.classList.remove('idle')
      if (!matchMedia('(pointer: coarse)').matches) setTimeout(() => line.focus({ preventScroll: true }), 30)
    }
    /** Your own villager: the one a line goes to when nobody else is being talked to. */
    const primary = () => cast[0]
    const closeSlip = () => {
      mine.classList.remove('shown')
      line.blur()
      if (!SLIP_ALWAYS) {
        slip.classList.remove('shown')
        return
      }
      // Always on: addressed to nobody in particular, so to your own villager, quietly.
      address(primary())
      line.placeholder = `Write to ${primary().owner}'s villager…`
      setChips([])
      slip.classList.add('shown', 'idle')
    }
    if (SLIP_ALWAYS) closeSlip()

    // ── Camera ─────────────────────────────────────────────────────────────
    const eye = new THREE.Vector3()
    // Line of sight for the two-shot: anything solid but the villager in the shot blocks it, other villagers too.
    const raycaster = new THREE.Raycaster()
    let subject: THREE.Object3D | null = null
    const solid = (o: THREE.Object3D) => {
      if (!(o as THREE.Mesh).isMesh) return false
      for (let n: THREE.Object3D | null = o; n; n = n.parent) if (!n.visible || n === subject) return false
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
      subject = m.v.fig.root
      stage.camera.getWorldPosition(eye)
      const base = Math.atan2(eye.x - p.x, eye.z - p.z)
      const floor = m.v.seated > 0.5 ? m.v.seatY : 0
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
    const talk = (m: Member, greet = true) => {
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
      if (greet || news) speak(m, news ?? m.hello)
      const invited = Boolean(m.seat)
      openSlip(`Say something to ${m.name}…`, [...m.chips, ...(invited ? [] : [INVITE])], m)
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
      openSlip(seated.length > 1 ? `Say something, or start with a name…` : `Say something to ${names[0]}…`, ["What's everyone up to?", THANKS], seated.length > 1 ? 'table' : seated[0]!)
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

    /** Everyone says a short goodbye in turn, then goes back to chores. */
    const farewell = async () => {
      if (mode === 'talk' && partner) {
        const m = partner
        m.v.speaking = true
        speak(m, m.bye)
        await pause(0.4)
        while (showing.get(m) && !m.card.finished) await frame()
        m.v.speaking = false
        await pause(1.1)
        if (partner === m) entries.back()
        return
      }
      for (const m of seated) hide(m)
      for (const [k, m] of [...seated].entries()) {
        if (mode !== 'table') return
        for (const o of seated) o.tag.classList.toggle('lit', o === m)
        speaker = m
        m.v.speaking = true
        speak(m, m.bye)
        await pause(0.3)
        while (showing.get(m) && !m.card.finished) await frame()
        await pause(0.7)
        m.v.speaking = false
        if (k < seated.length - 1) show(m, 'said')
      }
      speaker = null
      await pause(0.6)
      if (mode === 'table') leaveTable()
    }

    const chip = (label: string) => {
      if (label === INVITE && partner) invite(partner)
      else void send(label)
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
    const ask = (m: Member, text: string, context?: string): Speech => {
      const speech: Speech = { text: '', done: false }
      void sayTo(m.person, text, (t) => (speech.text += t), context).then((said) => {
        if (said.ok) speech.text = said.reply
        else speech.away = said.why
        speech.done = true
      })
      return speech
    }

    const send = async (text: string) => {
      text = text.trim()
      if (!text || pending) return
      // A line written with no talk open goes to your own villager, who turns to you.
      if (mode === 'room' && SLIP_ALWAYS) talk(primary(), false)
      pending = true
      line.value = ''
      mine.textContent = text
      mine.classList.add('shown')
      slip.classList.add('waiting')
      try {
        if (FAREWELL.test(text) && text.length <= 40 && (mode === 'table' || mode === 'talk')) await farewell()
        else if (mode === 'talk' && partner) {
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
        else if (mode === 'table') line.placeholder = seated.length > 1 ? 'Say something, or start with a name…' : `Say something to ${seated[0]?.name ?? ''}…`
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
        const context = others.length ? `at the kitchen table just now, ${others.map((r) => `${r.name} said "${r.text.slice(0, 160)}"`).join(' and ')}.` : undefined
        return { m, speech: ask(m, text, context) }
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
    // While a talk is open the shot is locked: a walker about to step into it waits at the edge of frame.
    const probe = new THREE.Vector3()
    const inShot = (x: number, z: number, reach: number) => {
      probe.set(x, 0.3, z)
      const far = probe.distanceTo(eye)
      probe.project(stage.camera)
      return probe.z < 1 && far < reach && Math.abs(probe.x) < 1.15 && probe.y > -1.3 && probe.y < 1.15
    }
    const offstage = (m: Member) => {
      if (mode !== 'talk' || !partner || m === partner || m.v.state !== 'walk') return false
      const reach = partner.v.pos.distanceTo(eye) + 1.6
      const ahead = 0.55
      return inShot(m.v.pos.x + Math.sin(m.v.yaw) * ahead, m.v.pos.z + Math.cos(m.v.yaw) * ahead, reach) && !inShot(m.v.pos.x, m.v.pos.z, reach)
    }
    // Now and then one villager at its chore looks up and waves: an invitation to talk, in the room itself.
    let nextGreet = 6
    let hovered: string | null = null
    ctx.on('village/frame', (dt, t) => {
      clock += dt
      if (mode === 'room' && (nextGreet -= dt) <= 0) {
        const free = cast.filter((m) => m.v.state === 'work' && !m.glyph.visible && entries.hovered !== m.entry)
        free[Math.floor(Math.random() * free.length)]?.v.greet()
        nextGreet = 9 + Math.random() * 6
      }
      // Hovering one makes it look up and wave back, and shows its name tag in place of the plain label.
      if (entries.hovered !== hovered) {
        hovered = entries.hovered
        document.body.classList.toggle('talk-hovering', mode === 'room' && cast.some((m) => m.entry === hovered))
        if (mode === 'room') cast.find((m) => m.entry === hovered)?.v.greet()
      }
      stage.camera.getWorldPosition(eye)
      // Hovering pauses a walker so it is easy to click; one just let go walks on until the pointer leaves it.
      if (released && entries.hovered !== released.entry) released = null
      for (const m of cast) {
        m.v.paused = (entries.hovered === m.entry && m !== released && mode === 'room') || offstage(m)
        // Someone already at a chore in the shot stays at it until the talk ends, instead of crossing behind.
        m.v.linger = mode === 'talk' && partner !== null && m !== partner && m.v.state === 'work' && inShot(m.v.pos.x, m.v.pos.z, partner.v.pos.distanceTo(eye) + 1.6)
      }
      stepCrowd(crowd, blobs, Math.min(dt, 0.05), t, eye, SCALE)
      for (const m of cast) {
        // The glyph bobs over the head and fades once looked at for a second.
        if (m.glyph.visible) {
          at.set(0, m.v.fig.height + 0.16, 0)
          m.v.fig.root.localToWorld(at)
          // About the same size on screen from the room view as up close, floating just clear of the head.
          const size = THREE.MathUtils.clamp(eye.distanceTo(at) * 0.03, 0.13, 0.46)
          m.glyph.scale.setScalar(size)
          m.glyph.position.copy(at).setY(at.y + size * 0.25 + Math.sin(t * 2.4) * 0.015)
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
            const top = Math.min(innerHeight - h - slip.offsetHeight - 40, Math.max(24, s.y - 10))
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
        // Name tags over everyone at the table; the speaker's is lit and carries the card. In the room, over the one hovered.
        const hover = mode === 'room' && entries.hovered === m.entry
        const tagged = (mode === 'table' && m.seat !== null && m.v.seated > 0.5 && !showing.has(m)) || hover
        m.tag.classList.toggle('shown', tagged)
        m.tag.classList.toggle('hover', hover)
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
          cards: Object.fromEntries([...showing].map(([m, as]) => [m.person, { as, text: m.card.text, finished: m.card.finished, cue: m.card.talking }])),
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
        /** Where a villager is on screen: its middle, or `up` of the way from its feet to the top of its head. */
        screen: (person: string, up = 0.5) => {
          const m = cast.find((c) => c.person === person)!
          const box = new THREE.Box3().setFromObject(m.v.fig.root)
          const c = box.getCenter(new THREE.Vector3()).setY(THREE.MathUtils.lerp(box.min.y, box.max.y, up))
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
  const paper = `radial-gradient(120% 90% at 20% 0%, #fffaf0 0%, #fbf1dd 55%, #f3e3c4 100%)`
  return `
  .talk-card, .talk-slip { box-sizing: border-box; border-radius: 16px; color: #46301f; background: ${paper};
    box-shadow: 0 14px 34px rgba(60, 30, 10, 0.3), 0 2px 0 rgba(255, 255, 255, 0.7) inset, 0 -3px 0 rgba(150, 105, 60, 0.18) inset; }
  .talk-card::before, .talk-slip::before { content: ''; position: absolute; inset: 7px; border: 2px dashed rgba(150, 100, 60, 0.38); border-radius: 11px; pointer-events: none; }
  .talk-card { position: fixed; left: 0; top: 0; width: 330px; max-width: calc(100vw - 32px); padding: 24px 22px 14px;
    opacity: 0; pointer-events: none; transition: opacity 180ms ease, scale 220ms cubic-bezier(.2, 1.4, .4, 1), filter 300ms ease; scale: 0.94; transform-origin: 0 50%; }
  .talk-card.shown { opacity: 1; scale: 1; pointer-events: auto; }
  .talk-card.said { opacity: 0.95; scale: 0.8; filter: saturate(0.5) brightness(0.93); }
  .talk-card.said .nametag { box-shadow: none; }
  .talk-card::after { content: ''; position: absolute; left: var(--tail, 50%); bottom: -10px; width: 20px; height: 20px; margin-left: -10px;
    background: #f5e7cb; rotate: 45deg; border-radius: 0 0 5px 0; box-shadow: 4px 4px 6px rgba(60, 30, 10, 0.14); }
  .talk-card.beside::after { left: -10px; top: var(--tail, 40px); bottom: auto; margin: -10px 0 0; background: #fcf4e3; border-radius: 0 0 0 5px; box-shadow: -3px 3px 5px rgba(60, 30, 10, 0.12); }
  .talk-card .page { display: grid; }
  .talk-card .words, .talk-card .sizer { grid-area: 1 / 1; margin: 0; min-height: 1.4em; white-space: pre-wrap; font: 19px/1.42 ${BOOK}; color: #3d2a1c; }
  .talk-card .sizer { visibility: hidden; }
  .talk-card .more { display: block; margin: 4px 0 0 auto; padding: 2px 4px; border: 0; background: none; cursor: pointer;
    font: italic 700 17px ${HAND}; color: color-mix(in oklab, var(--c) 80%, #2a1608); }
  .talk-card .more::after { content: ' \\25B8'; }
  .talk-card .more[hidden], .talk-card .cue[hidden] { display: none; }
  .talk-card .cue { display: flex; gap: 5px; justify-content: flex-end; height: 10px; margin: 6px 2px 0 auto; }
  .talk-card .cue i { width: 7px; height: 7px; border-radius: 50%; background: color-mix(in oklab, var(--c) 75%, #2a1608);
    box-shadow: 0 0 0 1.5px rgba(255, 248, 236, 0.7) inset; animation: talk-cue 1.1s ease-in-out infinite; }
  .talk-card .cue i:nth-child(2) { animation-delay: 0.18s; }
  .talk-card .cue i:nth-child(3) { animation-delay: 0.36s; }
  @keyframes talk-cue { 0%, 70%, 100% { translate: 0 0; opacity: 0.45; } 30% { translate: 0 -4px; opacity: 1; } }

  .nametag { display: inline-flex; align-items: baseline; gap: 7px; padding: 4px 13px 5px; border-radius: 11px 11px 5px 5px; white-space: nowrap;
    background: color-mix(in oklab, var(--c) 86%, #2a1608); color: #fffaf0; text-shadow: 0 1px 0 rgba(40, 20, 8, 0.35);
    box-shadow: 0 4px 10px rgba(60, 30, 10, 0.25), inset 0 0 0 2px rgba(255, 255, 255, 0.12); position: relative; }
  .nametag::after { content: ''; position: absolute; inset: 3px; border: 1.5px dashed rgba(255, 248, 236, 0.6); border-radius: 8px 8px 3px 3px; pointer-events: none; }
  .nametag b { font: 700 19px/1.15 ${HAND}; letter-spacing: 0.01em; }
  .nametag small { font: 700 15px/1.15 ${HAND}; color: #fff3df; }
  .nametag small::before { content: '· '; opacity: 0.7; }
  .talk-card .tab, .talk-slip .tab { position: absolute; left: 18px; top: -19px; }

  .talk-tag { position: fixed; left: 0; top: 0; pointer-events: none; opacity: 0; scale: 0.86; transform-origin: 50% 100%;
    transition: opacity 200ms ease, scale 260ms cubic-bezier(.2, 1.5, .4, 1), filter 200ms ease; filter: saturate(0.7); }
  .talk-tag.shown { opacity: 0.86; }
  .talk-tag.hover { opacity: 1; scale: 1; }
  body.talk-hovering .village-label { visibility: hidden; }
  .talk-tag.shown.lit { opacity: 1; scale: 1.08; filter: none; box-shadow: 0 0 0 3px rgba(255, 244, 214, 0.85), 0 6px 16px rgba(60, 30, 10, 0.35); }

  .talk-slip { position: fixed; right: 28px; bottom: 24px; width: min(410px, calc(100vw - 32px)); padding: 26px 22px 16px;
    display: flex; flex-direction: column; gap: 8px; opacity: 0; translate: 0 14px; pointer-events: none; transition: opacity 220ms ease, translate 240ms ease; }
  .talk-slip.shown { opacity: 1; translate: 0 0; pointer-events: auto; }
  .talk-slip.idle { padding-bottom: 12px; }
  .talk-slip.idle .chips { display: none; }
  .talk-slip .mine { margin: 0 0 2px; display: none; color: #2f4a6b; font: italic 20px/1.3 ${HAND}; }
  .talk-slip .mine.shown { display: block; }
  .talk-slip .ruled { display: block; position: relative; }
  .talk-slip .ruled::after { content: ''; position: absolute; left: 0; right: 0; bottom: 3px; border-bottom: 1.5px solid rgba(120, 80, 50, 0.35); }
  .talk-slip .line { box-sizing: border-box; width: 100%; padding: 4px 2px 6px; border: 0; outline: none; background: none;
    color: #2f4a6b; font: 21px ${HAND}; caret-color: #2f4a6b; }
  .talk-slip .line::placeholder { color: rgba(90, 64, 48, 0.55); font-style: italic; }
  .talk-slip .line:focus-visible { outline: none; }
  .talk-slip .ruled:focus-within::after { border-bottom-color: rgba(63, 90, 122, 0.7); }
  .talk-slip.waiting .line { opacity: 0.6; }
  .talk-slip .chips { display: flex; gap: 6px 8px; flex-wrap: wrap; }
  .talk-slip .chip { position: relative; padding: 3px 11px 4px; border: 0; border-radius: 999px; cursor: pointer;
    background: rgba(214, 186, 146, 0.32); color: #5a3d28; font: 16px ${HAND}; transition: background 120ms ease, translate 120ms ease; }
  .talk-slip .chip::before { content: ''; position: absolute; inset: 2px; border: 1.2px dashed rgba(150, 100, 60, 0.4); border-radius: 999px; }
  .talk-slip .chip:hover, .talk-slip .chip:focus-visible { background: rgba(214, 186, 146, 0.6); translate: 0 -1px; outline: none; }
  .talk-voice { position: fixed; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
  @media (max-width: 600px) { .talk-slip { right: 16px; bottom: 16px; } }
  @media (prefers-reduced-motion: reduce) { .talk-card, .talk-slip, .talk-tag { transition: none; } .talk-card .cue i { animation: none; opacity: 0.8; } }
  `
}

if (import.meta.hot) import.meta.hot.accept((m) => m && replace(m.default))
