import * as THREE from 'three/webgpu'
import type { Context } from 'cordis'
import { own, replace } from '../kernel'
import { canvas, rng, toTexture } from '../paint'
import { KINDS } from '../villagers/kinds'
import { Villager, type Task } from '../villagers/rig'
import { contactShadows, stepCrowd } from '../villagers/cast'
import { NEAR_CHAIR, SEAT_Y, SPOTS } from '../villagers/world'
import { TABLE_TOP } from '../layout'
import { ME, projects as listProjects, route, say as sayTo, type Routed, type Routing } from '../villager'
import { TALK } from '../features'
import { alwaysOn, inputVariant, type Variant } from '../talk/input'
import { furnisher } from '../talk/furnish'
import { ask as askTheme } from '../theme/ask'
import type { PlacementService } from './place'
import { asksBuild, asksElder, asksPhysics, asksTheme, mayRoute } from '../talk/route-check'
import { elderCard } from '../talk/elder'
import type { PhysicsAsk } from './physics'
import { placeFor } from '../talk/place'
import { sketcher, type Sketcher, type SketchRef } from '../talk/sketch'
import { makeChair, pineMaterial } from './chairs'
import { navigation, type Pose } from './camera'
import { tagVillager } from '../theme'
import { paperCss, paperSlips } from '../talk/paper'

// #42: talking to villagers like characters in a game (on by default; ?talk=off turns it off, features.ts).
// Three felt villagers, each the villager of one synthetic person, do chores in
// the room. Click one (or Tab to it and press Enter) to talk; invite them to the
// table and the table becomes a group conversation.
const params = new URLSearchParams(location.search)
const ON = TALK
/** ?slip=always keeps your paper slip on screen with no talk open, addressed to your own villager. */
const SLIP_ALWAYS = params.get('slip') === 'always'
/**
 * The always-on input (#42): the held notepad by default, ?input=speech for the speech card,
 * ?input=slip for the paper slip that shows only during a talk. Lines to your own villager are routed by it.
 */
const INPUT: Variant | null = inputVariant(params)
/**
 * Which path a line to your own villager takes (#42). By default a trusted check on the page
 * (route-check.ts) sends lines that may change the room to the router and plain chat straight to
 * the villager (one call). ?route=separate routes every line first; ?route=reply asks the villager
 * to route in its own reply (one call, unreliable on Haiku: it answered "I can't add furniture").
 */
const ROUTE_MODE = params.get('route') === 'separate' ? 'separate' : params.get('route') === 'reply' ? 'reply' : 'check'
/** After your line at the table, the villagers carry it for at most this many turns, then wait for you. */
const MAX_ROUND = 4
/** A reply that is only a short action in parentheses: a pass, shown as a nod, not words. */
const PASS = /^\s*\(([^()]{1,60})\)\s*$/
/** Asking the villager you are talking with to the table, typed instead of the chip. */
const SIT = /^\s*(?:(?:come|let'?s|will you|would you|do you want to)\s+)?(?:come\s+)?(?:and\s+)?sit (?:down )?(?:with (?:me|us)|at the table)\b[\s\S]{0,20}$/i
const KIND = KINDS[params.get('villager') ?? ''] ? params.get('villager')! : 'b'
const SCALE = 1.3
const HAND = '"Bradley Hand", "Segoe Print", "Comic Sans MS", cursive'
/** Villagers' words: a warm book face, easier to read at length than handwriting. */
const BOOK = '"Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif'
/** Letters a second, revealed a whole word at a time: a reading pace that keeps up with a streaming reply. */
const TYPE_RATE = 58
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)')

/** One word as it appears on a villager's card: its id, the word with any trailing punctuation, its place in the reply, and whether it ends the reply. */
export interface Said { villager: string; word: string; index: number; last: boolean }
declare module 'cordis' {
  interface Events {
    /** A word appeared on a villager's card, on the card's own reveal clock (for voices). */
    'village/said'(said: Said): void
    /** A villager's reply was cut short before its last word: Escape, the host failing, a goodbye. */
    'village/said-stop'(stop: { villager: string }): void
    /** Open the journal, at a villager's pages or a section (the always-on input, #42). */
    'village/journal'(at: { person?: string; section?: 'talk' | 'tasks' | 'sketches' }): void
  }
}

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
  { person: 'mia', owner: 'Mia', colour: '#7a5aa8', start: 'plantSide', wait: 3, tasks: [{ spot: 'plant', stay: 6 }, { spot: 'plantSide', stay: 5 }, { spot: 'loungePlants', stay: 6 }],
    hello: 'Hello! Mind the watering can.', chips: ['How are the plants?', 'How was your day?'], bye: 'Bye! The basil is waiting for me.' },
]
/** A person's colour: their villager's ink on paper (#86 reminders sign in it). */
export const inkOf = (person: string) => PEOPLE.find((p) => p.person === person)?.colour ?? '#8a6a48'
/** The synthetic "something for you" a villager carries after a chore. */
const NEWS: Record<string, string> = { mia: 'The basil by the window has a new leaf. I thought you would like to know.' }
/** Seats in the order they fill: the far side first, so faces turn to you. */
const SEATS = ['seatMid', 'seatLeft', 'seatRight', 'seatNear']
const INVITE = 'Come sit with me'
const THANKS = 'Thanks, everyone'
const UP_TO = "What's everyone up to?"
/** What each suggestion is about: once it is said, or the person writes on its topic, it is not offered again. */
const TOPICS: Record<string, RegExp> = {
  "What's for dinner?": /\b(dinner|supper|cook|eat|meal|soup|recipe)/i,
  'How was your day?': /\b(your day|today)\b/i,
  'Anything need doing?': /\b(need doing|chores?|tidy|help)\b/i,
  'How are the plants?': /\b(plants?|basil|garden|herbs?|water)/i,
  [UP_TO]: /\b(up to|weekend|plans?)\b/i,
}
/** A typed line that only says goodbye, so it is treated like the chip and not sent as a message. */
const FAREWELL = /^\s*(?:(?:ok(?:ay)?|right|well)[\s,]+)?(?:thanks?(?: you)?(?: so much)?|thank you|cheers|ta|bye(?:-?bye)?|good ?bye|see (?:you|ya)(?: later| soon)?|good ?night|that'?s all)(?:[\s,!.]+(?:everyone|everybody|all|guys|folks|friends|bye|for now|then|again))*[\s!.]*$/i
/** Booster cushions on the chairs, so a seated villager clears the table top. */
const BOOSTER = 0.12/** The table from above and to the right, close enough for faces, wide enough to see who else is about. */
const TABLE_SHOT: Pose = { position: new THREE.Vector3(1.75, 2.35, 2.6), look: new THREE.Vector3(0.0, 0.45, -0.25) }
/**
 * Where a note to the whole table can lie during the round, nearest the front first: the first with no face over
 * it in the table shot is used (#42 paper climb: a fixed spot put it over a chair back, floating).
 */
const TABLE_SPOTS = [[-0.3, 0.44], [-0.75, 0.44], [0.2, 0.44], [-0.3, 0.12], [-0.8, 0.12], [0.25, 0.12], [-0.6, -0.15],
  [-0.95, 0.3], [-0.95, 0.0], [-0.9, -0.25], [-0.35, -0.25]]
  .map(([x, z]) => new THREE.Vector3(x, TABLE_TOP + 0.004, z))
/** Your ink, the same blue-black as the pad's (input.ts). */
const MY_INK = '#23395a'
const KEPT = 'village.talk.kept'
/** A reply cut short: the line reached the host, and the journal reads the answer back from its history. */
const CUT_SHORT = 'My answer got cut short. Your line reached me; press J to read the rest in the journal.'

interface Speech {
  text: string
  done: boolean
  away?: string
  /** When it was asked and when its first words came, for the round's timings. */
  asked?: number
  first?: number
}

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
  /** 1 in full view, 0 faded out of a close shot it would crowd. */
  fade: number
  /** The soft outline in its owner's colour, eased. */
  glow: number
  /** Every material of its figure, with the opacity it was built with. */
  mats: { mat: THREE.Material; base: number }[]
}

/**
 * A name tag: a felt ribbon in the villager's colour. `owner` adds whose
 * villager it is in front of the name ("Alex's Dumpling"), only where the
 * person is choosing someone to talk to.
 */
function nameTag(name: string, owner: string | null, colour: string) {
  const tag = document.createElement('div')
  tag.className = 'nametag'
  tag.style.setProperty('--c', colour)
  if (owner) {
    const small = document.createElement('small')
    small.textContent = `${owner}'s`
    tag.append(small)
  }
  const b = document.createElement('b')
  b.textContent = name
  tag.append(b)
  return tag
}

/** Words on a card: the width a full line of text takes, its type, and how many lines a page may hold. */
const TEXT_WIDTH = 330
const TEXT_PX = 19
const LEADING = 1.42
const PAGE_LINES = 7
/** One hidden paragraph that every card measures with, to turn a page only when it would overflow. */
const ruler = document.createElement('p')
ruler.className = 'talk-ruler'
ruler.setAttribute('aria-hidden', 'true')
const fits = (text: string) => {
  ruler.textContent = text
  // On a phone a page is four lines at the slip's own width, so a long reply never comes down over the
  // speaker's face (#42 paper climb: six lines and the page before reached Moss's eyes).
  const narrow = innerWidth < 600
  ruler.style.width = `${narrow ? Math.min(TEXT_WIDTH, innerWidth - 76) : TEXT_WIDTH}px`
  return ruler.offsetHeight <= (narrow ? 4 : PAGE_LINES) * TEXT_PX * LEADING + 2
}

/** A speech card anchored to a villager: a stitched paper card wearing its name tag. */
class Card {
  el = document.createElement('div')
  /** The page before this one, kept as one dimmed line. */
  private before = document.createElement('p')
  private words = document.createElement('p')
  private said = document.createElement('span')
  private more = document.createElement('button')
  /** Stitched dots while the speaker is still talking, right after the last word. */
  private cue = document.createElement('span')
  private full = ''
  private done = true
  private from = 0
  private shown = 0
  private end = 0
  private visible = 0
  private paged = ''
  /** Seconds since the words stopped changing; lets the table pass to the next speaker. */
  still = 0
  private reading = 0
  /** Where the card is drawn, eased toward where it should be. */
  x = 0
  y = 0
  placed = false
  /** How far into the reply words have been announced, and how many. */
  private told = 0
  private count = 0
  /** Cut short: no more words are announced until fresh words start. */
  private muted = false
  private page = 0

  constructor(m: { name: string; colour: string; person: string }, private onWord: (word: string, index: number, last: boolean) => void, private onStop: () => void, private onPage: (page: number) => void = () => {}) {
    this.el.className = 'talk-card'
    this.el.dataset.talkCard = m.person
    this.el.style.setProperty('--c', m.colour)
    const tab = nameTag(m.name, null, m.colour)
    tab.classList.add('tab')
    const page = document.createElement('div')
    page.className = 'page'
    this.before.className = 'before'
    this.before.hidden = true
    this.before.addEventListener('click', () => this.before.classList.toggle('open'))
    this.words.className = 'words'
    this.said.className = 'said'
    this.cue.className = 'cue'
    this.cue.setAttribute('aria-label', 'still talking')
    this.cue.innerHTML = '<i></i><i></i><i></i>'
    this.words.append(this.said, this.cue)
    page.append(this.before, this.words)
    this.more.type = 'button'
    this.more.className = 'more'
    this.more.textContent = 'go on'
    this.more.hidden = true
    this.more.addEventListener('click', () => this.next())
    this.el.append(tab, page, this.more)
  }

  /**
   * Stepped back after its turn: the reply from its start, so the slip's first lines are its first words
   * (#42 paper climb: a long reply stepped back on its last page, a fragment like "will still be there.").
   */
  recall() {
    if (this.finished) this.said.textContent = this.full.trim()
  }

  /** The words stop where they are: a reply cut short says so once. */
  stop() {
    if (this.count && !this.finished && !this.muted) this.onStop()
    this.muted = true
  }

  /** An action, not words (a pass at the table): shown, but never announced as words to the voices. */
  beat(text: string) {
    this.reset()
    this.muted = true
    this.el.classList.add('beat')
    this.set(text, true)
  }

  /** Start fresh words. */
  reset() {
    this.stop()
    this.muted = false
    this.el.classList.remove('beat')
    this.count = this.told = this.page = 0
    this.full = this.paged = ''
    this.from = this.shown = this.end = this.visible = 0
    this.said.textContent = ''
    this.before.textContent = ''
    this.before.hidden = true
    this.before.classList.remove('open')
  }

  /** The words so far, streaming or whole; `done` once the speaker has finished. */
  set(text: string, done: boolean) {
    if (text === this.full && done === this.done) return
    this.full = text
    this.done = done
    this.still = 0
    this.paginate()
  }

  get text() {
    return this.full
  }

  /** The page before this one, if a page has turned. */
  get kept() {
    return this.before.hidden ? '' : this.before.textContent ?? ''
  }

  /** Every word of the current page is on the card and the speaker has finished. */
  get finished() {
    return this.done && this.visible >= this.end && !this.full.slice(this.end).trim()
  }

  /**
   * A page holds everything known so far while it fits in PAGE_LINES lines.
   * Only when it would overflow does the page end, at the last sentence that fits.
   */
  private paginate() {
    const rest = this.full.slice(this.from)
    if (rest === this.paged) return
    this.paged = rest
    if (fits(rest)) {
      this.end = this.full.length
      return
    }
    let cut = 0
    for (const s of rest.matchAll(/[.!?…]+["')]?(?=\s)/g)) {
      const at = s.index + s[0].length
      if (fits(rest.slice(0, at))) cut = at
      else break
    }
    if (!cut) for (const s of rest.matchAll(/\s+/g)) {
      if (fits(rest.slice(0, s.index))) cut = s.index
      else break
    }
    // Words already on the card stay on this page.
    this.end = this.from + Math.max(cut || rest.length, this.visible - this.from)
  }

  next() {
    this.reading = 0
    if (this.end >= this.full.length) return
    this.onPage(++this.page)
    this.before.textContent = this.full.slice(this.from, this.end).trim()
    this.before.title = this.before.textContent
    this.before.hidden = false
    this.from = this.end
    while (/\s/.test(this.full[this.from] ?? '')) this.from++
    this.shown = this.visible = this.from
    this.paged = ''
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
    if (v !== this.visible || (v > this.from && !this.said.textContent)) {
      this.visible = v
      this.said.textContent = this.full.slice(this.from, v).trimEnd()
      // Each newly shown word, in order, on the same clock that shows it.
      const end = this.full.trimEnd().length
      if (!this.muted) for (const w of this.full.slice(this.told, v).matchAll(/\S+/g)) {
        const at = this.told + w.index + w[0].length
        this.onWord(w[0], this.count++, this.done && at >= end)
      }
      this.told = Math.max(this.told, v)
    }
    this.more.hidden = !this.hasMore
    this.cue.hidden = this.finished || this.hasMore
    // A full page turns by itself once there has been time to read it.
    if (this.hasMore) {
      this.reading += dt
      if (this.reading > 1.6 + (this.end - this.from) / 16) this.next()
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
    const cast: Member[] = PEOPLE.map((p, i) => {
      const spec = KINDS[KIND].specs[i]
      const fig = KINDS[KIND].build(i, phys, { accent: p.colour })
      fig.root.scale.setScalar(SCALE)
      tagVillager(fig.root, `villager-${p.person}`)
      const v = new Villager(fig, p.tasks, { start: p.start, wait: p.wait, paths: 'open', seatY: SEAT_Y + BOOSTER })
      const [name, role] = spec.name.split(', ')
      // Kept under the bloom threshold, like the pad's paper, so the lamp never bleaches it.
      const glyph = new THREE.Sprite(new THREE.SpriteMaterial({ map: paperBang(p.colour), color: new THREE.Color(0.86, 0.82, 0.74), transparent: true, depthWrite: false, opacity: 0 }))
      glyph.name = `${name} news glyph`
      glyph.scale.setScalar(0.15)
      glyph.visible = false
      glyph.renderOrder = 5
      group.add(fig.root, glyph)
      // Hashed alpha from the start, so a passer-by can fade out of a close shot without a shader rebuild or sorting.
      const mats: Member['mats'] = []
      fig.root.traverse((o) => {
        for (const mat of ([] as THREE.Material[]).concat((o as THREE.Mesh).material ?? [])) {
          if (mats.some((x) => x.mat === mat)) continue
          mat.alphaHash = true
          mats.push({ mat, base: mat.opacity })
        }
      })
      const m: Member = { ...p, name, role, entry: `villager-${p.person}`, v, seat: null, news: null, looked: 0, glyph, card: null!, tag: document.createElement('div'), fade: 1, glow: 0, mats }
      m.card = new Card(m,
        (word, index, last) => ctx.emit('village/said', { villager: p.person, word, index, last }),
        () => ctx.emit('village/said-stop', { villager: p.person }),
        (page) => ctx.emit('village/card', { villager: p.person, page, at: v.fig.head.getWorldPosition(new THREE.Vector3()) }))
      m.tag = nameTag(name, p.owner, p.colour)
      m.tag.classList.add('talk-tag')
      v.onDone = (spot) => {
        // Synthetic trigger: finishing the first watering, the gardener has news.
        if (NEWS[p.person] && spot === 'plant' && !told.has(p.person)) notify(m)
      }
      return m
    })
    const told = new Set<string>()
    /** While set (build mode's move-in, #48), every "!" but this person's steps aside; the news itself waits. */
    let hush: { except: string | null; pad?: boolean } | null = null
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
    line.setAttribute('aria-label', 'Write a line')
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
    // Your line at the table: the note lies open on the table for the round, so the replies have something to
    // answer (#42 paper climb: your line vanished once sent). Laid out here, painted as paper by paper.ts.
    const myNote = document.createElement('div')
    myNote.className = 'talk-card mine'
    myNote.dataset.talkCard = 'you'
    myNote.setAttribute('aria-hidden', 'true')
    const myTo = document.createElement('p')
    myTo.className = 'to-line'
    const myWords = document.createElement('p')
    myWords.className = 'words'
    const mySaid = document.createElement('span')
    mySaid.className = 'said'
    myWords.append(mySaid)
    myNote.append(myTo, myWords)
    /** Your line on screen: lying on the table (`card` null), or clipped to the reply it brought (#42 paper climb). */
    const pinned: { on: boolean; card: Member | null; at: number; x: number; y: number; placed: boolean; lost: number } = { on: false, card: null, at: 0, x: 0, y: 0, placed: false, lost: 0 }
    const style = document.createElement('style')
    style.textContent = css() + paperCss()
    ctx.effect(() => {
      document.head.append(style)
      document.body.append(slip, voice, ruler, myNote, ...cast.flatMap((m) => [m.card.el, m.tag]))
      return () => {
        for (const m of cast) {
          m.card.el.remove()
          m.tag.remove()
        }
        slip.remove()
        voice.remove()
        ruler.remove()
        myNote.remove()
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
      if (as === 'said') m.card.recall()
      showing.set(m, as)
      m.card.el.classList.add('shown')
      m.card.el.classList.toggle('said', as === 'said')
    }
    const hide = (m: Member) => {
      if (pinned.card === m) unpin()
      m.card.stop()
      showing.delete(m)
      m.card.placed = false
      m.card.el.classList.remove('shown', 'said')
    }
    const hideAll = () => {
      for (const m of cast) hide(m)
      unpin()
    }
    /** Your line lies on the table, opened out of the note that landed there. */
    /**
     * Your line, as the slip torn off your pad, addressed at its head: one form wherever it is. At the table it
     * lies on the table for the round; in a talk it is clipped to the corner of the reply it brought.
     */
    const pin = (text: string, to: Member | null = null) => {
      myTo.textContent = `to ${to?.name ?? 'the table'}`
      myNote.dataset.to = to?.name ?? 'the table'
      myNote.style.setProperty('--c', to?.colour ?? '#8a6a48')
      mySaid.textContent = text
      pinned.on = true
      pinned.card = to
      myNote.classList.toggle('clipped', Boolean(to))
      pinned.placed = false
      if (input?.holding && input.heldBy() === null) {
        const at = input.heldAt()
        if (at) slips.from('you', at)
        input.release()
      }
    }
    const unpin = () => {
      pinned.on = false
      pinned.card = null
      myNote.classList.remove('shown')
    }
    const speak = (m: Member, text: string, done = true) => {
      m.card.reset()
      m.card.set(text, done)
      show(m, 'speaking')
      ctx.emit('village/card', { villager: m.person, page: 0, at: m.v.fig.head.getWorldPosition(new THREE.Vector3()) })
    }
    /** Suggestions already said, or whose topic the person already wrote about, per villager or for the table. */
    const used = new Set<string>()
    const scope = () => (mode === 'talk' && partner ? partner.person : 'table')
    const fresh = (label: string, who: string) => !used.has(`${who}:${label}`)
    const cover = (text: string) => {
      for (const label of Object.keys(TOPICS)) if (label === text || TOPICS[label].test(text)) used.add(`${scope()}:${label}`)
    }
    const chipsFor = (m: Member) => [...m.chips.filter((c) => fresh(c, m.person)), ...(m.seat ? [] : [INVITE])]
    const tableChips = () => [UP_TO, THANKS].filter((c) => fresh(c, 'table'))
    /** After the first exchange the suggestions fold away behind one quiet "…". */
    let folded = false
    const setChips = (labels: string[]) => {
      const buttons = labels.map((label) => {
        const b = document.createElement('button')
        b.type = 'button'
        b.className = 'chip'
        b.textContent = label
        b.addEventListener('click', () => chip(label))
        return b
      })
      if (!folded || !buttons.length) return chips.replaceChildren(...buttons)
      const ideas = document.createElement('button')
      ideas.type = 'button'
      ideas.className = 'chip ideas'
      ideas.textContent = '…'
      ideas.title = 'Ideas'
      ideas.setAttribute('aria-label', 'Show ideas')
      ideas.addEventListener('click', () => {
        chips.replaceChildren(...buttons)
        buttons[0].focus({ preventScroll: true })
      })
      chips.replaceChildren(ideas)
    }
    /** Address the slip to one villager or the whole table. */
    const address = (who: Member | 'table') => {
      // Written to, not spoken by: a paper tag in the addressee's ink, never its felt ribbon.
      const tag = who === 'table' ? nameTag('the table', null, '#8a6a48') : nameTag(who.name, null, who.colour)
      const toWord = document.createElement('i')
      toWord.textContent = 'to'
      tag.prepend(toWord)
      tag.classList.add('tab', 'to')
      slip.dataset.to = who === 'table' ? 'table' : who.person
      to.replaceWith(tag)
      to = tag
    }
    const openSlip = (placeholder: string, labels: string[], who: Member | 'table') => {
      address(who)
      // The always-on input replaces the slip: it re-addresses itself from the same state.
      if (INPUT) return
      folded = false
      line.placeholder = placeholder
      setChips(labels)
      slip.classList.add('shown')
      slip.classList.remove('idle')
      if (!matchMedia('(pointer: coarse)').matches) setTimeout(() => line.focus({ preventScroll: true }), 30)
    }
    /** Your own villager: the one a line goes to when nobody else is being talked to. */
    /** Your own villager: the one of the person this device is paired as (villager.ts ME). */
    const primary = () => cast.find((m) => m.person === ME) ?? cast[0]
    const closeSlip = () => {
      mine.classList.remove('shown')
      line.blur()
      if (INPUT) return
      if (!SLIP_ALWAYS) {
        slip.classList.remove('shown')
        return
      }
      // Always on: addressed to nobody in particular, so to your own villager, quietly.
      address(primary())
      line.placeholder = `Write to ${primary().name}…`
      setChips([])
      slip.classList.add('shown', 'idle')
    }
    if (SLIP_ALWAYS) closeSlip()

    // ── Camera ─────────────────────────────────────────────────────────────
    const eye = new THREE.Vector3()
    // Line of sight for the two-shot: anything solid but the villager in the shot blocks it, other villagers too.
    const raycaster = new THREE.Raycaster()
    // Every layer: a wall cut away from the current view sits on the shadow-only layer, yet may stand in the next shot.
    raycaster.layers.enableAll()
    /** While a shot is searched: where its camera would stand and what it looks at, to tell which cut-away walls it would see. */
    let posed: { from: THREE.Vector3; at: THREE.Vector3 } | null = null
    const wallAt = new THREE.Vector3()
    /**
     * Whether a cut-away wall (or its stub) would be drawn from the posed camera, by camera.ts's rule:
     * a wall between rooms stands when the camera and what it looks at are on the same side of it, an
     * outer wall when the camera is inside it; a stub stands in for a wall that is cut.
     */
    const standsInShot = (n: THREE.Object3D, from: THREE.Vector3, at: THREE.Vector3) => {
      const wall = n.userData.interior as { x: number } | undefined
      const inward = n.userData.inward as THREE.Vector3 | undefined
      const facing = wall ? Math.sign(from.x - wall.x) === Math.sign(at.x - wall.x) : wallAt.copy(from).sub(n.getWorldPosition(wallAt)).dot(inward!) > 0
      return n.userData.cutaway ? !facing : facing
    }
    let subject: THREE.Object3D | null = null
    /** The pose the camera was last sent to for a conversation. */
    let shot: Pose | null = null
    const solid = (o: THREE.Object3D) => {
      if (!(o as THREE.Mesh).isMesh) return false
      // The held pad rides with the camera; it never blocks a shot. A cut-away wall blocks one only if it would stand in it.
      let wall: THREE.Object3D | null = null
      for (let n: THREE.Object3D | null = o; n; n = n.parent) {
        if (n === subject || n.userData.hud) return false
        if (n.userData.interior || n.userData.inward) wall ??= n
        else if (!n.visible) return false
      }
      if (wall ? !(posed ? standsInShot(wall, posed.from, posed.at) : wall.visible && o.layers.isEnabled(0)) : !o.layers.isEnabled(0)) return false
      return ([] as THREE.Material[]).concat((o as THREE.Mesh).material).some((mat) => mat.visible && mat.depthWrite)
    }
    /** While a shot is searched, only the meshes near its subject are tested: far fewer rays to cast. */
    let nearby: THREE.Object3D[] | null = null
    const around = (at: THREE.Vector3, reach: number) => {
      const found: THREE.Object3D[] = []
      const sphere = new THREE.Sphere()
      stage.scene.traverse((o) => {
        const mesh = o as THREE.Mesh
        if (!mesh.isMesh) return
        // Cut-away walls too: hidden from this view, they may stand in the shot being searched.
        let wall = false
        for (let n: THREE.Object3D | null = mesh; n && !wall; n = n.parent) wall = Boolean(n.userData.interior || n.userData.inward)
        if (!wall && !solid(mesh)) return
        if (!mesh.geometry.boundingSphere) mesh.geometry.computeBoundingSphere()
        sphere.copy(mesh.geometry.boundingSphere!).applyMatrix4(mesh.matrixWorld)
        if (sphere.center.distanceTo(at) - sphere.radius < reach) found.push(mesh)
      })
      return found
    }
    const clear = (from: THREE.Vector3, to: THREE.Vector3) => {
      const d = to.clone().sub(from)
      raycaster.set(from, d.clone().normalize())
      raycaster.far = d.length()
      raycaster.camera = stage.camera
      const hits = nearby ? raycaster.intersectObjects(nearby, false) : raycaster.intersectObject(stage.scene, true)
      return !hits.some((h) => solid(h.object))
    }
    /**
     * How many of eight points spread across a pose's frame, at its subject's depth, have something
     * in front of them: a door post or a chair at the edge of the shot counts against it. Stops
     * counting at `enough`.
     */
    const probeCam = new THREE.PerspectiveCamera()
    const clutter = (pose: Pose, at: THREE.Vector3, enough: number) => {
      probeCam.fov = 40
      probeCam.aspect = stage.camera.aspect
      probeCam.position.copy(pose.position)
      probeCam.lookAt(pose.look)
      probeCam.updateProjectionMatrix()
      probeCam.updateMatrixWorld()
      const fwd = probeCam.getWorldDirection(new THREE.Vector3())
      const depth = at.clone().sub(pose.position).dot(fwd) - 0.25
      let n = 0
      for (const u of [-0.85, -0.45, 0.45, 0.85])
        for (const v of [-0.5, 0.4]) {
          const dir = new THREE.Vector3(u, v, 0.5).unproject(probeCam).sub(pose.position).normalize()
          if (!clear(pose.position, pose.position.clone().addScaledVector(dir, depth / Math.max(0.2, dir.dot(fwd)))) && ++n >= enough) return n
        }
      return n
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
      // On a wide screen the villager stands on the left third with room for its card on the right;
      // on a tall one it stands in the middle, further back so it fits the width, with its card above.
      const aspect = stage.camera.aspect
      const side = THREE.MathUtils.clamp((aspect - 0.7) / 0.6, 0, 1)
      const back = Math.max(1, 0.85 / aspect)
      const shot = (a: number, dist: number) => {
        const dir = new THREE.Vector3(Math.sin(a), 0, Math.cos(a))
        const right = new THREE.Vector3(dir.z, 0, -dir.x)
        return {
          position: head.clone().addScaledVector(dir, dist * back).addScaledVector(right, -0.15 * side).setY(head.y + 0.42),
          look: head.clone().setY(head.y - 0.06 - 0.12 * (1 - side)).addScaledVector(right, 0.3 * side),
        }
      }
      // Clear both ways: from the camera to the head and body, and from the head back to the camera,
      // which catches a camera standing inside furniture (a ray from inside a cushion hits nothing).
      // Of the first six clear poses, the first with nothing in front of the villager anywhere in the
      // frame wins, or else the one with least (#42 regroup: a door post once filled a third of the shot).
      let best: Pose | null = null
      let least = Infinity
      let scored = 0
      nearby = around(head, 3.5)
      try {
        // Each turn at both distances before the next turn: closer leaves less room for anything in front.
        for (const turn of [0, 0.45, -0.45, 0.9, -0.9, 1.35, -1.35, 1.8, -1.8, 2.4, -2.4])
          for (const dist of [1.5, 1.15]) {
            const pose = shot(base + turn, dist)
            posed = { from: pose.position, at: pose.look }
            if (!(clear(pose.position, head) && clear(pose.position, body) && clear(head, pose.position))) continue
            const n = clutter(pose, head, least)
            if (n === 0) return pose
            if (n < least) {
              least = n
              best = pose
            }
            if (++scored === 6) return best!
          }
      } finally {
        nearby = null
        posed = null
      }
      return best ?? shot(base, 1.5)
    }

    // ── Talking with one villager ───────────────────────────────────────────
    const talk = (m: Member, greet = true) => {
      if (partner && partner !== m) endTalk(false)
      partner = m
      lastTalked = m
      mode = 'talk'
      m.v.chosen = true
      for (const o of showing.keys()) if (o !== m) hide(o)
      mine.classList.remove('shown')
      // A note on its way lands before the camera turns to its reader, so the note is seen flying;
      // the reader hops as it arrives.
      if (input?.flying) void input.landed().then(() => {
        if (partner !== m || mode !== 'talk') return
        m.v.beat()
        ctx.emit('village/turned', { villager: m.person, at: m.v.fig.head.getWorldPosition(new THREE.Vector3()) })
        view.focus(shot = twoShot(m), 7)
      })
      else {
        m.v.beat()
        ctx.emit('village/turned', { villager: m.person, at: m.v.fig.head.getWorldPosition(new THREE.Vector3()) })
        view.focus(shot = twoShot(m), 7)
      }
      const news = m.news
      if (news) clearNews(m)
      if (greet || news) speak(m, news ?? m.hello)
      const invited = Boolean(m.seat)
      openSlip(`Write to ${m.name}…`, chipsFor(m), m)
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

    /** The table shot, pulled back on a tall screen so everyone at the table stays in frame. */
    const tableShot = (): Pose => {
      const back = THREE.MathUtils.clamp(0.8 / stage.camera.aspect, 1, 1.7)
      return { position: TABLE_SHOT.look.clone().lerp(TABLE_SHOT.position, back), look: TABLE_SHOT.look }
    }

    const toTable = () => {
      mode = 'table'
      view.focus(shot = tableShot(), 5)
      const names = seated.map((m) => m.name)
      openSlip(seated.length > 1 ? `Write to the table…` : `Write to ${names[0]}…`, tableChips(), seated.length > 1 ? 'table' : seated[0]!)
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
      // The chair sound lands with the hop, after the walk to the table (#52).
      m.v.onHop = (onto) => {
        if (!onto) return
        m.v.onHop = undefined
        ctx.emit('village/sat', { villager: m.person, seconds: 0.7, at: { x: SPOTS[seat].seat!.x, y: SEAT_Y, z: SPOTS[seat].seat!.z } })
      }
      m.v.sendTo(seat)
      speak(m, 'Coming!')
      setTimeout(() => showing.get(m) && m.card.text === 'Coming!' && hide(m), 1600)
      toTable()
    }

    const leaveTable = () => {
      if (seated.length) ctx.emit('village/farewell', { villagers: seated.map((m) => m.person) })
      for (const m of seated) {
        m.seat = null
        m.v.onHop = undefined
        m.v.release(0.3 + Math.random() * 0.6)
        m.v.speaking = m.v.thinking = false
        m.v.listenTo = null
      }
      seated.length = 0
      lastRound = []
      for (const k of [...used]) if (k.startsWith('table:')) used.delete(k)
      speaker = null
      toRoom()
    }

    /** Everyone says a short goodbye in turn, then goes back to chores. */
    const farewell = async () => {
      setChips([])
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
          // 403 (#40): this device is paired to someone else, not this page's person; nothing was sent.
          : why === 'refused' ? "This page was opened with someone else's link, so that didn't reach me."
          // 401: this device is not paired. Resending won't help until a pairing link is opened.
          : why === 'link' ? "I can't hear you until this device is paired. Open your pairing link and say it again."
          : "Sorry, I'm out for a moment. I've kept what you said."

    /** Ask one villager and stream its words into a speech record. */
    const ask = (m: Member, text: string, context?: string, routing?: Routing, sketch?: SketchRef): Speech => {
      const speech: Speech = { text: '', done: false, asked: performance.now() }
      void sayTo(m.person, text, (t) => {
        speech.first ??= performance.now()
        speech.text += t
      }, { context, routing, sketch }).then((said) => {
        if (said.ok) speech.text = said.routed ? '' : said.reply
        else speech.away = said.why
        speech.done = true
      })
      return speech
    }

    /** Send a line to whoever it is addressed to. `prepared` is a reply already asked for (the one-call route answered). */
    const send = async (text: string, prepared?: Speech, to?: Member) => {
      text = text.trim()
      if (!text || pending) return
      // A routed line goes to whom it was written for when it was sent, wherever the person has clicked since.
      if (to && !(mode === 'talk' && partner === to)) choose(to, false)
      // A line written with no talk open goes to your own villager, who turns to you.
      else if (mode === 'room' && INPUT) choose(primary(), false)
      else if (mode === 'room' && SLIP_ALWAYS) talk(primary(), false)
      const bye = FAREWELL.test(text) && text.length <= 40 && (mode === 'table' || mode === 'talk')
      cover(text)
      pending = true
      line.value = ''
      mine.textContent = text
      mine.classList.add('shown')
      slip.classList.add('waiting')
      try {
        if (bye) await farewell()
        else if (mode === 'talk' && partner) {
          const m = partner
          const ok = await perform(m, prepared ?? ask(m, text), text)
          if (!ok) restoreLine(text)
        } else if (mode === 'table' && seated.length) {
          await table(text)
        }
      } finally {
        pending = false
        slip.classList.remove('waiting')
        if (!bye) folded = true
        if (mode === 'talk' && partner) {
          line.placeholder = `Write to ${partner.name}…`
          setChips(bye ? [] : chipsFor(partner))
        } else if (mode === 'table') {
          line.placeholder = seated.length > 1 ? 'Write to the table…' : `Write to ${seated[0]?.name ?? ''}…`
          setChips(bye ? [] : tableChips())
        }
      }
    }

    /**
     * One villager's turn on stage: a thinking beat (eyes up, a tap of the chin)
     * until the first words, then the card types them out while it leans in.
     * Resolves when the words are on the card. False if the host could not answer.
     */
    const perform = async (m: Member, speech: Speech, said: string): Promise<boolean> => {
      replies++
      speaker = m
      // With a note on its way it waits to read it before it thinks.
      m.v.thinking = !input?.flying
      hide(m)
      // Your note lands in the reader's paws first, and is read for a moment, before the answer opens out of it.
      const reading = Boolean(input?.flying)
      if (reading) {
        // Its paws come up to catch the note as it comes near.
        while (input!.flying && input!.state().sentAgo < 1.1) await frame()
        if (input!.flying && input!.flyingTo() === m.v.fig.root) m.v.reading = true
        await input!.landed()
        m.v.reading = false
        // It holds the note up in both paws and looks down at it, then thinks.
        if (input!.heldBy() === m.v.fig.root) {
          m.v.thinking = false
          m.v.reading = true
          const until = clock + 1.1
          while (clock < until) await frame()
          m.v.reading = false
          m.v.thinking = true
        }
      }
      // Even a quick answer gets its beat: eyes up, a tap of the chin, then words (shorter when they are already in).
      const beat = clock + (speech.text || speech.done || reading ? 0.3 : 0.5)
      while ((!speech.text && !speech.done) || clock < beat) await frame()
      // A reply that opens with "(" may be a pass: wait for the whole of it before showing anything.
      while (!speech.done && /^\s*\([^)]*$/.test(speech.text)) await frame()
      m.v.thinking = m.v.reading = false
      openNote(m)
      if (speech.done && !speech.away && PASS.test(speech.text)) {
        m.v.nod()
        m.card.beat(speech.text.trim())
        show(m, 'speaking')
        voice.textContent = `${m.name} ${speech.text.trim().replace(/[()]/g, '')}`
        await pause(1.3)
        return true
      }
      if (speech.away === 'cut') return cutShort(m)
      if (speech.away) {
        keep(m.person, said)
        speak(m, inCharacter(speech.away))
        voice.textContent = `${m.name}: ${m.card.text}`
        while (!m.card.finished) await frame()
        return false
      }
      m.v.speaking = true
      speak(m, speech.text, speech.done && !speech.away)
      // In a talk your note comes back clipped to the reply: the note opened into it.
      if (mode === 'talk') pin(said, m)
      timing?.set(m, performance.now())
      while (!speech.done || !m.card.finished) {
        // The host failing mid-reply cuts the words short where they are.
        if (speech.away === 'cut') {
          m.v.speaking = false
          return cutShort(m)
        }
        if (speech.away) {
          m.v.speaking = false
          keep(m.person, said)
          speak(m, inCharacter(speech.away))
          voice.textContent = `${m.name}: ${m.card.text}`
          while (!m.card.finished) await frame()
          return false
        }
        m.card.set(speech.text, speech.done)
        await frame()
      }
      m.v.speaking = false
      voice.textContent = `${m.name}: ${speech.text}`
      return true
    }

    /**
     * The reply stopped partway: the host already has the line, so it is not kept to send again
     * (that would say it twice). The rest of the answer is in the journal's history. True: the line was said.
     */
    const cutShort = async (m: Member) => {
      speak(m, CUT_SHORT)
      voice.textContent = `${m.name}: ${m.card.text}`
      while (!m.card.finished) await frame()
      return true
    }

    /** The note held in this villager's paws opens into its slip (the slip grows out of where the note is). */
    const openNote = (m: Member) => {
      if (!input?.holding || input.heldBy() !== m.v.fig.root) return
      const at = input.heldAt()
      if (at) {
        slips.from(m.person, at)
        slips.from('you', at)
      }
      input.release()
    }

    /** Seated villagers in the order a text names them. */
    const namedOrder = (text: string, among: Member[]) => among
      .map((m) => ({ m, at: text.search(new RegExp(`\\b${m.name}\\b`, 'i')) }))
      .filter((x) => x.at >= 0)
      .sort((a, b) => a.at - b.at)
      .map((x) => x.m)
    /** Who opens the next round when nobody is named: it rotates round the table. */
    let opener = 0
    /** The last round as the checks see it: who spoke, what they heard as context, whether they passed, and when. */
    let roundLog: { speaker: string; context: string; text?: string; pass?: boolean; asked: number; first?: number; done?: number; card?: number; finished?: number }[] = []
    /** When each speaker's card started, for the round's timings. */
    let timing: Map<Member, number> | null = null
    /** What a villager hears at the table: who is there, the round so far (your line and the replies), and that it is their turn. */
    const roundContext = (m: Member, text: string, round: { name: string; text: string; pass: boolean }[]) => {
      const others = seated.filter((o) => o !== m).map((o) => o.name)
      const owner = primary().owner
      const before = lastRound.length ? ` Before that: ${lastRound.map((r) => `${r.name} said "${r.text.slice(0, 120)}"`).join('; ')}.` : ''
      const so = round.map((r) => (r.pass ? ` ${r.name} ${r.text.replace(/[()]/g, '').trim()}.` : ` ${r.name} said "${r.text.slice(0, 300)}".`)).join('')
      return `you are ${m.name}, at the kitchen table with ${owner}${others.length ? ` and ${others.join(' and ')}` : ''}.${before} The round so far: ${owner} said "${text.slice(0, 300)}".${so} It is your turn, ${m.name}.`.slice(0, 2000)
    }

    /**
     * The table (#42): your line starts a round. Whoever it names first speaks
     * first, otherwise the opener rotates; each speaker hears your line and the
     * replies so far as context, may turn to another by name (who then speaks
     * next) or pass with a nod. As soon as one reply's text is complete the next
     * speaker is asked, while the card is still being revealed. At most
     * MAX_ROUND turns, then they wait for you.
     */
    const table = async (text: string) => {
      const first = namedOrder(text, seated)[0]
      const k = first ? seated.indexOf(first) : opener++ % seated.length
      const queue = [...seated.slice(k), ...seated.slice(0, k)]
      for (const m of seated) hide(m)
      const round: { m: Member; name: string; text: string; pass: boolean }[] = []
      roundLog = []
      timing = new Map()
      let failed = false
      const start = (m: Member) => {
        const context = roundContext(m, text, round)
        const speech = ask(m, text, context)
        const entry: (typeof roundLog)[number] = { speaker: m.person, context, asked: speech.asked! }
        roundLog.push(entry)
        return { m, speech, entry }
      }
      let current: ReturnType<typeof start> | null = start(queue.shift()!)
      unpin()
      // To the whole table: the note lands on the table and lies there, open, for the round.
      if (seated.length > 1) {
        if (input?.flying) await input.landed()
        if (mode === 'table') pin(text)
      }
      while (current) {
        const { m, speech, entry } = current
        // The next speaker is asked the moment this reply is complete.
        const upcoming = (async () => {
          while (!speech.done) await frame()
          entry.first = speech.first
          entry.done = performance.now()
          if (speech.away) return null
          const pass = PASS.test(speech.text)
          entry.pass = pass
          entry.text = speech.text.trim()
          round.push({ m, name: m.name, text: speech.text.trim(), pass })
          if (round.length >= MAX_ROUND) return null
          // Turned to by name: that villager is next, even if it already spoke.
          const named = pass ? undefined : namedOrder(speech.text, seated.filter((o) => o !== m))[0]
          if (named) {
            const i = queue.indexOf(named)
            if (i >= 0) queue.splice(i, 1)
            queue.unshift(named)
          }
          const next = queue.shift()
          return next && mode === 'table' ? start(next) : null
        })()
        for (const o of seated) {
          o.tag.classList.toggle('lit', o === m)
          // The others turn their heads to whoever is speaking.
          o.v.listenTo = o === m ? null : m.v.pos
        }
        const ok = await perform(m, speech, text)
        entry.card = timing.get(m)
        entry.finished = performance.now()
        if (!ok) failed = true
        current = await upcoming
        if (current && mode === 'table') {
          await pause(0.45)
          // What was said steps back; on a phone to a single line, so the round so far stays in view (#42
          // paper climb: hiding it left one card with nothing it answered).
          if (showing.get(m)) show(m, 'said')
        }
      }
      speaker = null
      timing = null
      for (const o of seated) {
        o.tag.classList.remove('lit')
        o.v.listenTo = null
      }
      const spoken = round.filter((r) => !r.pass).map((r) => ({ name: r.name, text: r.text }))
      if (spoken.length) lastRound = spoken
      if (failed && !line.value) restoreLine(text)
    }

    // ── The "!" glyph: one quiet signal, never repeated or escalated ────────
    const notify = (m: Member) => {
      if (told.has(m.person) || m.news) return
      m.news = NEWS[m.person] ?? 'I finished up. Nothing urgent.'
      m.looked = 0
      m.glyph.visible = true
      ctx.emit('village/news', { villager: m.person, at: m.glyph.getWorldPosition(new THREE.Vector3()) })
    }
    const clearNews = (m: Member) => {
      told.add(m.person)
      m.news = null
    }

    /** Whether the next talk opened through the entries layer starts with a greeting. */
    let greetNext = true
    /** Open a talk as a click would, so Escape and clicks elsewhere end it as usual. */
    const choose = (m: Member, greet: boolean) => {
      greetNext = greet
      entries.choose(m.entry)
      greetNext = true
    }
    // ── Entries: hover glow and name, click or Tab and Enter to talk ────────
    for (const m of cast) {
      ctx.effect(() => entries.add({
        id: m.entry,
        label: m.name,
        object: m.v.fig.root,
        select() {
          // Your own villager is still deciding what your last line meant: its answer stays with it.
          if (routing) {
            quietLeave = true
            queueMicrotask(() => {
              entries.back()
              quietLeave = false
            })
            return
          }
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
          talk(m, greetNext)
          greetNext = true
        },
        leave() {
          if (quietLeave) return
          if (partner === m) endTalk()
        },
      }), `talk entry ${m.entry}`)
    }

    // ── Keys: the one keyboard path of the talk page ────────────────────────
    // Every key on the talk page comes through onKey, in this order:
    //   1. The always-on input (input.key): while a line has the keyboard every key is
    //      the line's; with nothing written, `j` opens the journal and a printable key
    //      starts a line. Escape with words clears them (the field's own handler).
    //   2. Room navigation (arrows, held WASD and QE) is camera.ts's: its window capture
    //      listener runs before this one and prevents what it takes, so onKey returns at
    //      `defaultPrevented`. It moves the view only while nothing is being written
    //      (`navigation.writing`, set here from `input.writing`). A letter tapped for less
    //      than 170 ms is replayed and reaches step 1; the input asks `navigation.claims()`
    //      (in `blocked`) so a held letter never writes.
    //   3. Escape at the table leaves it (when no entry is open, so entries' own Escape wins).
    // The slip variant (?input=slip) keeps its own form field, and only step 3 applies.
    const onSubmit = (e: Event) => {
      e.preventDefault()
      void send(line.value)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return
      // Writing while build mode's reward has put the pad away brings it back, and the key goes on the line (#48).
      if (hush?.pad && e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) hush = { except: hush.except }
      if (input?.key(e)) return
      if (e.key === 'Escape' && mode === 'table' && !entries.active) {
        e.preventDefault()
        leaveTable()
      }
    }
    ctx.effect(() => {
      slip.addEventListener('submit', onSubmit)
      addEventListener('keydown', onKey, true)
      return () => {
        slip.removeEventListener('submit', onSubmit)
        removeEventListener('keydown', onKey, true)
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
    // ── Placing cards and tags on screen ────────────────────────────────────
    const EDGE = 12
    /** How far a card's name tab sticks up above it. */
    const TAB = 22
    /** How far your note overlaps the top of the reply it is taped to: just touching, the tape bridges them. */
    const CLIP = 3
    const camUp = new THREE.Vector3()
    const camRight = new THREE.Vector3()
    const edge = new THREE.Vector3()
    const toPx = (v: THREE.Vector3) => {
      v.project(stage.camera)
      const r = rect()
      return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height }
    }
    const centre = new THREE.Vector3()
    /** A villager's head on screen, in CSS pixels: a ball round the head's centre, as big as the head (ears left out). */
    const headBox = (m: Member) => {
      const { head } = m.v.fig
      const r = (m.v.fig.height - head.position.y) * SCALE * 1.05
      head.getWorldPosition(centre)
      camUp.setFromMatrixColumn(stage.camera.matrixWorld, 1)
      camRight.setFromMatrixColumn(stage.camera.matrixWorld, 0)
      const c = toPx(edge.copy(centre))
      const top = toPx(edge.copy(centre).addScaledVector(camUp, r))
      const side = toPx(edge.copy(centre).addScaledVector(camRight, r))
      const ry = Math.abs(c.y - top.y), rx = Math.abs(side.x - c.x)
      return { x0: c.x - rx, y0: c.y - ry, x1: c.x + rx, y1: c.y + ry, cx: c.x }
    }
    type Spot = { l: number; t: number; w: number; h: number; tail: 'down' | 'left' | 'right' }
    const overlaps = (a: Spot, b: Omit<Spot, 'tail'>) => a.l < b.l + b.w + 8 && b.l < a.l + a.w + 8 && a.t - TAB < b.t + b.h + 8 && b.t < a.t + a.h + 8
    /**
     * Each card beside or above its speaker's head with its tail on the head:
     * beside in a talk (the head fills the shot), above at the table. The
     * speaker is placed first; cards already said fit around it and the slip.
     */
    const inside = (o: Omit<Spot, 'tail'>) => o.l >= EDGE && o.l + o.w <= innerWidth - EDGE && o.t >= EDGE + TAB && o.t + o.h <= innerHeight - EDGE
    const placeCards = (dt: number) => {
      const taken: Omit<Spot, 'tail'>[] = []
      if (slip.classList.contains('shown')) {
        const r = slip.getBoundingClientRect()
        taken.push({ l: r.left, t: r.top - TAB, w: r.width, h: r.height + TAB })
      }
      // The always-on input holds the bottom centre of the view.
      if (input) {
        const r = input.padRect()
        if (r.width) taken.push({ l: r.left, t: r.top - TAB, w: r.width, h: r.height + TAB })
      }
      // Cards never cover anyone else's face in view, in the conversation or not (#42 regroup: a reply
      // sat on Moss's face while the camera waited wide for the sent note to land).
      const faces = new Map<Member, Omit<Spot, 'tail'>>()
      for (const o of cast) {
        if (o.fade < 0.5 || !o.v.fig.root.visible) continue
        const f = headBox(o)
        if (f.x1 < 0 || f.x0 > innerWidth || f.y1 < 0 || f.y0 > innerHeight) continue
        // The whole head, ears and all: slips used to be allowed over its top (#42 paper climb).
        faces.set(o, { l: f.x0, t: f.y0, w: f.x1 - f.x0, h: f.y1 - f.y0 })
      }
      const order = [...showing.keys()].sort((a, b) => Number(showing.get(a) === 'said') - Number(showing.get(b) === 'said'))
      for (const m of order) {
        const { card } = m
        const el = card.el
        // Your note clipped above its top edge is placed with it, as one block.
        const lead = pinned.on && pinned.card === m ? myNote.offsetHeight - CLIP : 0
        const w = el.offsetWidth, ch = el.offsetHeight, h = ch + lead
        const head = headBox(m)
        const mouth = head.y0 + (head.y1 - head.y0) * 0.5
        const right: Spot = { l: head.x1 + 24, t: mouth - 40 - lead, w, h, tail: 'left' }
        const left: Spot = { l: head.x0 - 24 - w, t: mouth - 40 - lead, w, h, tail: 'right' }
        const above: Spot = { l: head.cx - w / 2, t: head.y0 - h - 22, w, h, tail: 'down' }
        // Beside the head in a talk on a wide screen; above it at the table and on a narrow screen, where beside cannot fit.
        const ways = mode === 'talk' && partner === m && innerWidth >= 600 ? [right, left, above] : [above, right, left]
        // A card may slide along its side as long as its tail still reaches the head.
        // Above a head, also pushed back inside the window's edge: on a phone a slip is nearly as wide as the screen.
        const slides = (o: Spot) => [...[0, -1, 1, -2, 2, -3, 3].map((k) => o.tail === 'down' ? { ...o, l: o.l + (k * w) / 5 } : { ...o, t: o.t + (k * h) / 5 }),
          ...(o.tail === 'down' ? [{ ...o, l: THREE.MathUtils.clamp(o.l, EDGE, innerWidth - EDGE - w) }] : [])]
        const reaches = (o: Spot) => o.tail === 'down' ? head.cx > o.l + 20 && head.cx < o.l + o.w - 20 : mouth > o.t + lead + 16 && mouth < o.t + o.h - 16
        const blocked = [...taken, ...[...faces].filter(([o]) => o !== m).map(([, f]) => f)]
        // Higher above the head, its tail stretched down to it, before covering anyone's face (#42 paper
        // climb: on a phone at the table the slip sat on a listener's head).
        const lifted = [36, 72, 110, 150, 200].flatMap((d) => slides({ ...above, t: above.t - d }))
        let spot = [...ways.flatMap(slides), ...lifted].find((o) => inside(o) && reaches(o) && !blocked.some((t) => overlaps(o, t)))
          ?? ways.flatMap(slides).find((o) => inside(o) && reaches(o) && !taken.some((t) => overlaps(o, t)))
        if (!spot) {
          const o = ways[0]
          spot = { ...o, l: THREE.MathUtils.clamp(o.l, EDGE, innerWidth - EDGE - w), t: THREE.MathUtils.clamp(o.t, EDGE + TAB, innerHeight - EDGE - h) }
        }
        // A tail stretched down to a head below other slips would cross them: then the name tape alone says who.
        const reach = spot.tail === 'down' ? Math.max(0, Math.round(head.y0 - 22 - (spot.t + h))) : 0
        const tailX = THREE.MathUtils.clamp(head.cx, spot.l + 22, spot.l + w - 22)
        const stem = { l: tailX - 10, t: spot.t + h + TAB, w: 20, h: reach }
        const crossed = reach > 0 && taken.some((t) => stem.l < t.l + t.w && t.l < stem.l + stem.w && stem.t < t.t + t.h && t.t < stem.t + stem.h)
        taken.push(spot)
        // A stretched tail keeps its own way clear: no later slip lies across it.
        if (reach > 0 && !crossed) taken.push(stem)
        // Glide to the place rather than jump, except when the card first appears.
        const k = card.placed && !reducedMotion.matches ? 1 - Math.exp(-dt * 14) : 1
        card.x += (spot.l - card.x) * k
        card.y += (spot.t + lead - card.y) * k
        card.placed = true
        el.style.translate = `${card.x}px ${card.y}px`
        // Crossed, it keeps a short tab toward its speaker instead of the stretched one.
        el.dataset.tail = spot.tail
        el.style.setProperty('--reach', `${spot.tail === 'down' && !crossed ? Math.max(0, Math.round(head.y0 - 22 - (card.y + h))) : 0}px`)
        el.style.setProperty('--tail', spot.tail === 'down'
          ? `${THREE.MathUtils.clamp(head.cx - card.x, 22, w - 22)}px`
          : `${THREE.MathUtils.clamp(mouth - card.y, 18, ch - 18)}px`)
      }
      // Your line, lying on the table near where the note landed, wherever it covers no face and no slip;
      // where there is no such place (a phone), it stays out of the way.
      // In a talk, your note sits on the reply's top right corner, taped to it.
      if (pinned.on && pinned.card) {
        const { card } = pinned.card
        const shown = showing.has(pinned.card) && card.placed
        myNote.classList.toggle('shown', shown)
        if (shown) {
          const w = myNote.offsetWidth
          pinned.x = THREE.MathUtils.clamp(card.x + card.el.offsetWidth - w + 12, EDGE, innerWidth - EDGE - w)
          pinned.y = card.y - myNote.offsetHeight + CLIP
          pinned.placed = true
          myNote.style.translate = `${pinned.x}px ${pinned.y}px`
        }
      } else if (pinned.on) {
        const w = myNote.offsetWidth, h = myNote.offsetHeight
        const blocked = [...taken, ...faces.values()]
        // Clear of every slip with the tape on its top and of every face; lying on the table it may cross the tip
        // of a head behind it (an antenna or an ear), never the face.
        const slips = taken
        const heads = [...faces.values()].map((f) => ({ ...f, t: f.t + 14, h: f.h - 14 }))
        const clear = (o: Omit<Spot, 'tail'>) => inside(o)
          && !slips.some((t) => o.l < t.l + t.w + 6 && t.l < o.l + o.w + 6 && o.t < t.t + t.h + 6 && t.t - TAB < o.t + o.h + 6)
          && !heads.some((t) => o.l < t.l + t.w && t.l < o.l + o.w && o.t < t.t + t.h && t.t < o.t + o.h)
        // Lying on the table top: the spot it lay on last if it is still clear, else the first clear one from the front.
        let spot: Omit<Spot, 'tail'> | undefined
        for (const i of [pinned.at, ...TABLE_SPOTS.keys()]) {
          const a = toPx(edge.copy(TABLE_SPOTS[i]))
          // Kept inside the window's edge: on a phone the table's clear end is at the edge.
          const o = { l: THREE.MathUtils.clamp(a.x - w / 2, EDGE, innerWidth - EDGE - w), t: a.y - h / 2, w, h }
          if (clear(o)) {
            spot = o
            pinned.at = i
            break
          }
        }
        // On a phone the table is full of heads: your line goes up on the wall, above the round.
        for (let i = 0; !spot && innerWidth < 600 && i < 3; i++) {
          const o = { l: (innerWidth - w) / 2, t: EDGE + i * (h + 12), w, h }
          // Clear of the slips below it and of the name tape on top of each.
          if (!blocked.some((t) => o.l < t.l + t.w && t.l < o.l + o.w && o.t < t.t + t.h && t.t - TAB - 6 < o.t + o.h)) spot = o
        }
        // Heads bob, so a place can come and go by a pixel: it keeps its last place for a moment before it gives way.
        pinned.lost = spot ? 0 : pinned.lost + dt
        if (!spot && pinned.placed && pinned.lost < 0.6) spot = { l: pinned.x, t: pinned.y, w, h }
        myNote.classList.toggle('shown', Boolean(spot))
        if (spot) {
          const k = pinned.placed && !reducedMotion.matches ? 1 - Math.exp(-dt * 10) : 1
          pinned.x += (spot.l - pinned.x) * k
          pinned.y += (spot.t - pinned.y) * k
          pinned.placed = true
          myNote.style.translate = `${pinned.x}px ${pinned.y}px`
        }
      }
    }
    const mid = new THREE.Vector3()
    /** Not part of the conversation, in the frame, and well in front of everyone who is. */
    const top = new THREE.Vector3()
    const crowding = (m: Member) => {
      // Only once the camera is on the conversation: while it waits wide for a sent note, nobody is in its way.
      if (mode === 'room' || !view.focused || m === partner || m.seat) return false
      // Judged from the shot the camera is going to, not where it is on the way (#42 paper climb: judged on the
      // way, a passer-by began to fade as the camera arrived and glittered half-faded in the frame).
      if (!shot) return false
      const subjects = mode === 'talk' && partner ? [partner] : seated
      if (!subjects.length) return false
      probeCam.fov = stage.camera.fov
      probeCam.aspect = stage.camera.aspect
      probeCam.position.copy(shot.position)
      probeCam.lookAt(shot.look)
      probeCam.updateProjectionMatrix()
      probeCam.updateMatrixWorld()
      mid.set(m.v.pos.x, m.v.fig.height * SCALE * 0.5, m.v.pos.z)
      const d = mid.distanceTo(shot.position)
      const nearest = Math.min(...subjects.map((o) => o.v.pos.distanceTo(shot!.position)))
      // Its middle or its head in the frame: close to the camera, a head can fill a corner while the body is below it.
      m.v.fig.head.getWorldPosition(top).project(probeCam)
      mid.project(probeCam)
      // A round body shows well past its centre: a head just beyond the edge still puts a cheek in frame. On a
      // tall screen half a body's width is more than half the frame, so the margin grows with it (#42 paper climb).
      const half = (m.v.fig.height * SCALE * 0.5) / (d * Math.tan(THREE.MathUtils.degToRad(probeCam.fov) / 2) * probeCam.aspect)
      const inFrame = (p: THREE.Vector3) => p.z < 1 && Math.abs(p.x) < Math.max(1.5, 1 + half) && Math.abs(p.y) < 1.25
      const framed = inFrame(mid) || inFrame(top)
      // Half out of the frame at its edge, it is only a cut-off shape: let it go too.
      const cut = Math.abs(mid.x) > 0.86 || mid.y < -0.8
      return framed && (cut || d < nearest - (mode === 'talk' ? 0.3 : 0.5))
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
        const greeter = mode === 'room' ? cast.find((m) => m.entry === hovered) : undefined
        if (greeter) greeter.v.greet(), ctx.emit('village/greeted', { villager: greeter.person, at: greeter.v.fig.head.getWorldPosition(new THREE.Vector3()) })
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
          m.glyph.scale.set(size * 0.8, size, 1)
          m.glyph.position.copy(at).setY(at.y + size * 0.25 + Math.sin(t * 2.4) * 0.015)
          const mat = m.glyph.material
          if (entries.hovered === m.entry && m.news) m.looked += dt
          if (m.looked >= 1 && m.news) clearNews(m)
          // It steps aside while you write or a note is on its way, so it never competes with whom the note is to.
          const goal = m.news && !input?.writing && !input?.flying && (!hush || hush.except === m.person) ? 1 : 0
          mat.opacity += (goal - mat.opacity) * (1 - Math.exp(-dt * (goal ? 5 : 3)))
          if (!m.news && mat.opacity < 0.02) m.glyph.visible = false
        }
        m.card.tick(dt)
        // Name tags over everyone at the table; the speaker's is lit and carries the card. In the room, over the one hovered.
        const hover = mode === 'room' && entries.hovered === m.entry
        // While someone speaks only the speaker's tag shows, so the others' tags never sit on its face.
        const tagged = (mode === 'table' && m.seat !== null && m.v.seated > 0.5 && !showing.has(m) && (!speaker || speaker === m)) || hover
        m.tag.classList.toggle('shown', tagged)
        m.tag.classList.toggle('hover', hover)
        if (tagged) {
          // Just over its own head, pointing down at it, and never off the top or sides of the window.
          const head = headBox(m)
          const tw = m.tag.offsetWidth, th = m.tag.offsetHeight
          const x = THREE.MathUtils.clamp(head.cx, EDGE + tw / 2, innerWidth - EDGE - tw / 2)
          const y = Math.max(head.y0 - 10, EDGE + th)
          m.tag.style.translate = `calc(${x}px - 50%) calc(${y}px - 100%)`
          m.tag.style.setProperty('--tail', `${THREE.MathUtils.clamp(head.cx - (x - tw / 2), 12, tw - 12)}px`)
        }
        // A soft outline in the owner's colour on the one pointed at, and on the one the slip is written to.
        const addressed = INPUT ? mode === 'room' && m === primary() : SLIP_ALWAYS && mode === 'room' && slip.dataset.to === m.person
        const glowGoal = hover ? 1 : addressed ? 0.6 : 0
        m.glow += (glowGoal - m.glow) * (1 - Math.exp(-dt * 8))
        if (m.v.fig.outline) m.v.fig.outline.value = m.glow * 0.8
        m.v.attending = addressed && (INPUT ? Boolean(input?.text) || routing : document.activeElement === line || line.value.length > 0)
        // A passer-by much nearer the camera than the conversation fades out instead of filling the frame.
        const fadeGoal = crowding(m) ? 0 : 1
        if (m.fade !== fadeGoal) {
          // Half-faded, the hashed alpha glitters: at once while the camera is still on its way (the move hides
          // it), quickly once it is there (#42 paper climb).
          const moving = shot !== null && eye.distanceTo(shot.position) > 0.4
          m.fade = moving || Math.abs(fadeGoal - m.fade) < 0.01 ? fadeGoal : m.fade + (fadeGoal - m.fade) * (1 - Math.exp(-dt * 16))
          for (const { mat, base } of m.mats) mat.opacity = base * m.fade
          m.v.fig.root.visible = m.fade > 0.01
        }
        const blob = blobs[cast.indexOf(m)].material as THREE.MeshBasicMaterial
        blob.opacity *= m.fade
      }
      placeCards(dt)
      slips.frame(dt)
      input?.frame(dt, t)
      sketch?.frame(dt, t)
      for (const done of [...waiters]) {
        waiters.delete(done)
        done()
      }
    })

    // ── The always-on input (#42): routed by your own villager ───────────────
    let routing = false
    /** Each line your own villager routed: the route, ms from Enter to the decision, and how many model calls it took. */
    const routes: { text: string; route: string; /** chat (the page's check said plain chat), router, or reply (?route=reply). */ path: string; ms: number; calls: number; models?: string[]; costUsd?: number | null }[] = []
    /**
     * A short line from a villager in the room, which folds away once it has been read. Lines
     * queue: each stays up long enough to read before the next one replaces it, so a route's
     * line, a note and a failure never flash past one another.
     */
    let quips = Promise.resolve()
    /** When each quip went up, for the checks. */
    const quipLog: { text: string; at: number }[] = []
    const wait = (seconds: number) => new Promise<void>((r) => setTimeout(r, seconds * 1000))
    let quipCount = 0
    /** Replies performed so far: a quip queued before the latest one is stale. */
    let replies = 0
    const quip = (m: Member, text: string) => {
      let mine = 0
      // Queued behind earlier lines, a quip can come due after the villager has begun answering a newer
      // line; it is dropped then, rather than written over the answer (#42 regroup: "Ooh, let me see."
      // from an earlier request replaced an answer on the card).
      const asked = replies
      const shown = quips.then(async () => {
        if (replies !== asked) return
        mine = ++quipCount
        quipLog.push({ text, at: Math.round(performance.now()) })
        speak(m, text)
        voice.textContent = `${m.name}: ${text}`
        while (showing.get(m) && m.card.text === text && !m.card.finished) await frame()
        // About a third of a second a word, and never under three seconds.
        // Wall-clock time, since reading takes real seconds whatever the frame rate.
        await wait(Math.max(3, 1 + text.split(/\s+/).length * 0.3))
      })
      quips = shown.then(() => {}, () => {})
      void shown.then(async () => {
        await wait(1.5)
        // Only if nothing has been said since: the same words said again keep their own time.
        if (showing.get(m) && m.card.text === text && quipCount === mine && mode === 'room') hide(m)
      }, () => {})
    }
    const restoreLine = (text: string) => {
      if (INPUT) {
        if (!input?.text) input?.restore(text)
      } else line.value = text
    }
    const headAt = new THREE.Vector3()
    /** Who reads a line sent now: the villager it names, or the one talked to; none when it goes to the whole table. */
    const reader = (): Member | null => {
      const named = namedIn(input?.text ?? '')
      if (named) return named
      if (mode === 'table') return seated.length > 1 ? null : seated[0] ?? null
      return mode === 'talk' && partner ? partner : primary()
    }
    /**
     * Between a villager's paws, just in front of its tummy: the paws sit at its sides, so the tummy's
     * front is about as far forward as they are apart (a point at a fixed depth was inside a round one).
     */
    const paws = (m: Member) => {
      const { root, hands, height } = m.v.fig
      const hand = hands[0]
      if (!hand) return root.localToWorld(headAt.set(0, height * 0.42, 0.3))
      root.worldToLocal(hand.getWorldPosition(headAt))
      return root.localToWorld(headAt.set(0, headAt.y + 0.07, Math.abs(headAt.x) + 0.05))
    }
    /** In the room, a line that names another villager is on its way to them, even before your villager has routed it. */
    const namedIn = (text: string) => mode === 'room' ? cast.find((m) => m !== primary() && new RegExp(`\\b${m.name}\\b`, 'i').test(text || (routing ? routingText : ''))) ?? null : null
    /** The line being routed: it keeps its addressee on the input until the route is back. */
    let routingText = ''
    /** Whom you last talked with: J opens the journal at their pages. */
    let lastTalked: Member | null = null
    // Furnishing hands each piece to the house's placement (#56) while plugins/place.ts provides it.
    let placement: PlacementService | null = null
    if (INPUT) ctx.inject(['placement'], (inner) => {
      placement = inner.placement
      inner.effect(() => () => void (placement = null), 'talk placement')
    })
    const furnish = INPUT ? furnisher(stage, entries, { person: primary().person, maker: primary().name, say: (text) => quip(primary(), text), placement: () => placement, emit: ctx.emit.bind(ctx) }) : null
    const input = INPUT ? alwaysOn(stage, entries, {
      variant: INPUT,
      journal: 'notebook',
      addressee: () => {
        const named = namedIn(input?.text ?? '')
        if (named) return { label: named.name, colour: named.colour }
        if (mode === 'table') return { label: seated.length > 1 ? 'the table' : seated[0]?.name ?? 'the table', colour: seated.length > 1 ? '#8a6a48' : seated[0]?.colour ?? '#8a6a48' }
        const m = mode === 'talk' && partner ? partner : primary()
        return { label: m.name, colour: m.colour }
      },
      target: () => {
        const m = reader()
        // To the whole table it lands on the table; its slip then finds a clear place there.
        return m ? paws(m) : headAt.copy(TABLE_SPOTS[0])
      },
      holder: () => reader()?.v.fig.root ?? null,
      blocked: () => entries.active === 'notebook' || navigation.claims() || Boolean(hush?.pad),
      openJournal: () => ctx.emit('village/journal', { person: (partner ?? lastTalked)?.person, section: 'talk' }),
      submit: (text, t0) => void submitLine(text, t0),
      emit: ctx.emit.bind(ctx),
      enter: (): boolean => sketch?.enter() ?? false,
    }) : null
    if (input) {
      navigation.writing = () => input.writing
      ctx.effect(() => () => void (navigation.writing = () => false), 'talk navigation')
    }
    // ── Sketching on the held notepad (#42, src/talk/sketch.ts) ──────────────
    /** Whom the pad is addressed to, as a villager (the table counts as the first seated). */
    const padTo = () => (mode === 'talk' && partner ? partner : mode === 'table' ? seated[0] ?? primary() : primary())
    const sketch: Sketcher | null = INPUT === 'held' && input && furnish ? sketcher(stage, input, furnish, {
      person: primary().person,
      maker: primary().name,
      to: () => {
        const m = padTo()
        return { person: m.person, name: m.name, colour: m.colour }
      },
      // A drawing goes with no route: nothing drawn on it can choose who hears what.
      busy: () => pending || routing,
      give: async (person, text, ref) => {
        const m = cast.find((c) => c.person === person)
        if (!m) return false
        if (pending || routing) return 'busy'
        if (!(mode === 'talk' && partner === m)) choose(m, false)
        pending = true
        try {
          return await perform(m, ask(m, text, undefined, undefined, ref), text)
        } finally {
          pending = false
        }
      },
      figure: (person) => cast.find((c) => c.person === person)?.v.fig.root ?? null,
      say: (text) => quip(primary(), text),
      blocked: () => entries.active === 'notebook',
      emit: ctx.emit.bind(ctx),
    }) : null
    // #87: the Elder's card, by the notepad; only an elder route asks it for a run.
    const elder = INPUT ? elderCard() : null
    ctx.effect(() => () => {
      sketch?.dispose()
      input?.dispose()
      furnish?.dispose()
      elder?.dispose()
    }, 'talk always-on input')
    // ── The words as paper slips (#42 regroup, src/talk/paper.ts) ────────────
    const slips = paperSlips((person) => person === 'you' ? { name: 'you', colour: MY_INK } : cast.find((c) => c.person === person) ?? null)
    ctx.effect(() => () => slips.dispose(), 'talk paper slips')
    // Projects already being made stand where they will go, as wrapped parcels.
    if (INPUT) void listProjects(primary().person).then((r) => {
      if (r.ok) for (const p of r.projects) furnish?.parcel(p.what, p.where)
    })

    /** A villager other than your own that the person's own words name (trusted: a name match on the page, never the model's say-so). */
    const nameIn = (text: string) => cast.find((m) => m !== primary() && new RegExp(`\\b${m.name}\\b`, 'i').test(text)) ?? null

    /**
     * Your own villager decides what a line meant, and the room shows it. By
     * default one call does both (#42): the villager answers, or its reply is a
     * route the host has checked, and the page acts on it as soon as it comes.
     * ?route=separate asks the router first and then the villager (two calls).
     */
    const submitLine = async (text: string, t0: number) => {
      if (!text || pending || routing) return restoreLine(text)
      const me = primary()
      const elsewhere = (mode === 'talk' && partner && partner !== me) || mode === 'table'
      if (mode === 'talk' && partner && SIT.test(text)) return invite(partner)
      if (elsewhere || (FAREWELL.test(text) && text.length <= 40 && mode !== 'room')) return send(text)
      const villagers = cast.map((m) => ({ id: m.person, name: m.name, role: m.role }))
      // Plain chat: one call, straight to your villager. Only the router acts on the room.
      if (ROUTE_MODE === 'check' && !mayRoute({ text, others: cast.filter((m) => m !== me).map((m) => m.name) })) {
        routes.push({ text, route: 'answer', path: 'chat', ms: 0, calls: 1 })
        return send(text)
      }
      const guess = furnish!.hint(text, t0)
      routing = true
      routingText = text
      me.v.thinking = true
      if (ROUTE_MODE === 'reply') {
        let routed: Routed | null = null
        const speech = ask(me, text, undefined, { route: { primary: me.name, villagers }, onRoute: (r) => (routed = r) })
        // The first words, a route or the end decide.
        while (!speech.text && !routed && !speech.done) await frame()
        routing = false
        routingText = ''
        const ms = Math.round(performance.now() - t0)
        if (routed) {
          me.v.thinking = false
          routes.push({ text, route: (routed as Routed).route, path: 'reply', ms, calls: 1 })
          return act(routed, text, t0, guess)
        }
        if (speech.away) {
          me.v.thinking = false
          routes.push({ text, route: `failed (${speech.away})`, path: 'reply', ms, calls: 1 })
          return didNotRoute(text, guess, speech.away)
        }
        routes.push({ text, route: 'answer', path: 'reply', ms, calls: 1 })
        furnish!.dismiss(guess)
        return send(text, speech, me)
      }
      const r = await route(me.person, text, me.name, villagers)
      me.v.thinking = false
      routing = false
      routingText = ''
      routes.push({ text, route: r.ok ? r.routed.route : `failed (${r.why})`, path: 'router', ms: Math.round(r.ms), calls: r.ok && r.routed.route === 'answer' ? 2 : 1, ...(r.ok ? { models: r.models, costUsd: r.costUsd } : {}) })
      if (!r.ok) return didNotRoute(text, guess, r.why)
      return act(r.routed, text, t0, guess)
    }

    const didNotRoute = (text: string, guess: ReturnType<NonNullable<typeof furnish>['hint']>, why: string) => {
      const me = primary()
      ctx.emit('village/routed', { route: 'none', ok: false })
      furnish!.dismiss(guess)
      // Cut short: the host has the line already; it is not put back to be sent twice.
      if (why === 'cut') return quip(me, CUT_SHORT)
      keep(me.person, text)
      restoreLine(text)
      quip(me, why === 'link' ? "I can't hear you until this device is paired. Open your pairing link and say it again." : why === 'away' ? "Sorry, I'm out for a moment. I've kept what you wrote." : why === 'busy' ? "Hold on, I'm still sorting the last one. I've kept what you wrote." : "I didn't quite follow that one. Could you say it another way?")
    }

    /** What a route does in the room. The model's route is data: it never chooses who hears the person's words. */
    const act = async (routed: Routed, text: string, t0: number, guess: ReturnType<NonNullable<typeof furnish>['hint']>) => {
      const me = primary()
      const to = cast.find((m) => m.person === routed.to)
      ctx.emit('village/routed', { route: routed.route, ok: true, villager: routed.to, at: to?.v.fig.head.getWorldPosition(new THREE.Vector3()) })
      switch (routed.route) {
        case 'talk':
          furnish!.dismiss(guess)
          // Only to a villager the person's own words name, and with their own words, never the model's paraphrase (Sentinel, #42).
          if (!to || to === me || to !== nameIn(text)) return send(text, undefined, me)
          choose(to, !routed.message)
          if (routed.message) await send(text, undefined, to)
          return
        case 'answer':
          furnish!.dismiss(guess)
          return send(text, undefined, me)
        case 'furnish':
          if (mode === 'talk') endTalk()
          if (routed.say) quip(me, routed.say)
          return furnish!.furnish(routed, text, t0, guess)
        case 'project':
          furnish!.dismiss(guess)
          if (mode === 'talk') endTalk()
          if (routed.say) quip(me, routed.say)
          await furnish!.project(routed, text)
          return
        case 'journal':
          furnish!.dismiss(guess)
          ctx.emit('village/journal', { person: to?.person, section: routed.section })
          return
        case 'theme': {
          // #50: the whole home's look, written from the person's own words; the note is shown as text.
          furnish!.dismiss(guess)
          // The router's say-so is not enough to restyle the home: the person's own words must ask for a look.
          if (!asksTheme(text)) return send(text, undefined, me)
          if (routed.say) quip(me, routed.say)
          const r = await askTheme(text, me.person)
          quip(me, r.ok ? r.note || `Now ${r.label}.` : r.why === 'superseded' ? 'Another look got there first.' : r.why === 'link' ? "I can't hear you until this device is paired. Open your pairing link and say it again." : "I couldn't change the look just now.")
          return
        }
        case 'physics': {
          // #74: how things move, tuned from the person's own words by the physics world; its note is shown as text.
          furnish!.dismiss(guess)
          // A toy or an invented mechanic (#106) goes on trial and can be undone, so the router's flag is enough; rules and acts still need the person's own words.
          const make = routed.make === 'toy' || routed.make === 'mechanic' ? routed.make : undefined
          if (!make && !asksPhysics(text)) return send(text, undefined, me)
          if (routed.say) quip(me, routed.say)
          const request: PhysicsAsk = { text, person: me.person, make }
          ctx.emit('village/physics-ask', request)
          // No answer (physics off or not started yet), a world that stopped while the model answered, or a thrown error all say the same.
          const r = request.answer ? await request.answer.catch((error) => (console.error('Village physics ask failed:', error), null)) : null
          // An act the world refused says why ("the fridge: steel does not burn"), as text.
          const refusedAct = r && !r.ok && r.why === 'refused' && r.acts?.find((a) => a.refused)
          quip(me, !r || (!r.ok && r.why === 'gone') ? "Things can't move any differently just now." : r.ok ? r.note || 'There. Things move differently now.' : r.toy ? `I couldn't build that: ${r.reason}. Nothing's changed.` : refusedAct ? `${refusedAct.target ?? 'That'}: ${refusedAct.refused}.` : r.why === 'link' ? "I can't hear you until this device is paired. Open your pairing link and say it again." : "I couldn't change how things move just now.")
          return
        }
        case 'elder': {
          // #87: the person's own words must name the Elder and ask for a change. The route starts a run at most: keeping
          // it happens only on the host's approval page (host/src/approval.ts). The router's line is not used (it may claim more).
          furnish!.dismiss(guess)
          if (!elder || !asksElder(text)) return send(text, undefined, me)
          if (mode === 'talk') endTalk()
          quip(me, await elder.ask(text))
          return
        }
        case 'build': {
          // Build mode draws the room and speaks for your villager: the route's line, or one asking what was meant (#48).
          furnish!.dismiss(guess)
          if (!asksBuild(text)) return send(text, undefined, me)
          if (mode === 'talk') endTalk()
          const request = { intent: routed.intent, say: routed.say, person: me.person, reply: (line: string) => quip(me, line), handled: false }
          ctx.emit('village/build-intent', request)
          if (!request.handled) quip(me, "Let's do that in build mode. I can't move walls from here.")
          return
        }
      }
    }

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
          cards: Object.fromEntries([...showing].map(([m, as]) => [m.person, { as, text: m.card.text, finished: m.card.finished, cue: m.card.talking, kept: m.card.kept }])),
          cast: Object.fromEntries(cast.map((m) => [m.person, {
            name: m.name, state: m.v.state, seated: m.v.seated > 0.5, seat: m.seat, spot: m.v.spot, thinking: m.v.thinking, speaking: m.v.speaking,
            news: Boolean(m.news), glyph: m.glyph.visible ? m.glyph.material.opacity : 0, x: m.v.pos.x, z: m.v.pos.z,
            fade: m.fade, crowding: crowding(m), glow: m.glow, attending: m.v.attending,
          }])),
          lit: seated.filter((m) => m.tag.classList.contains('lit')).map((m) => m.person),
          focused: view.focused,
          input: input ? { ...input.state(), routing, routes: routes.slice(), quips: quipLog.slice(), furnish: furnish!.state(), journalRect: input.journalRect(), padRect: input.padRect() } : null,
          sketch: sketch?.state() ?? null,
          elder: elder?.state() ?? null,
          round: roundLog.map((r) => ({ ...r })),
        }),
        /** For the checks: what "here" and "that" point at, as a click on the room would set it. */
        pickAt: (x: number, y: number, z: number, name?: string) => furnish?.pickAt(x, y, z, name),
        /** The trusted first placement (place.ts), for the checks and for build mode. */
        placeFor,
        mayRoute,
        keep: () => furnish?.keep(),
        /** Sketching (#42): the page's tools, and where a page point is on screen, for the checks. */
        sketch: sketch ? { open: sketch.open, undo: sketch.undo, clear: sketch.clear, tool: sketch.setTool, make: sketch.make, give: sketch.give, at: sketch.screenAt } : null,
        undo: () => furnish?.undo(),
        again: () => furnish?.again(),
        notify: (person: string) => {
          const m = cast.find((c) => c.person === person)
          if (m) notify(m)
        },
        /** Quiet every villager's "!" but `except`'s while `on` (build mode's move-in, #48), and with `pad` put the held pad away; they come back after. */
        hush: (on: boolean, except: string | null = null, pad = false) => (hush = on ? { except, pad } : null),
        /** Put words on a villager's card, as a greeting does; for the paging check. */
        say: (person: string, text: string) => {
          const m = cast.find((c) => c.person === person)
          if (m) speak(m, text)
        },
        /** Send a villager to a spot and keep it there, or let it go back to its chores; for the fade check. */
        walk: (person: string, spot: string | null) => {
          const m = cast.find((c) => c.person === person)
          if (m && spot) m.v.sendTo(spot)
          else m?.v.release(0.2)
        },
        /** Where one villager stands and what it is doing, without building the whole state (build mode's move-in, #48). */
        where: (person: string) => {
          const m = cast.find((c) => c.person === person)
          return m ? { x: m.v.pos.x, y: m.v.pos.y, z: m.v.pos.z, state: m.v.state, seated: m.v.seated > 0.5, spot: m.v.spot } : null
        },
        /** Where a villager is on screen: its middle, or `up` of the way from its feet to the top of its head. */
        screen: (person: string, up = 0.5) => {
          // Your line on the table is a card too, with no villager under it.
          const m = cast.find((c) => c.person === person)
          if (!m) return null
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

/**
 * The news marker: a little torn slip with an inked "!" under a strip of tape in the villager's colour, the
 * same paper as the replies (#42 paper climb: a stitched felt patch was a second visual language).
 */
function paperBang(colour: string) {
  const [c, g] = canvas(128, 160)
  const r = rng([...colour].reduce((a, ch) => a * 31 + ch.charCodeAt(0), 11) % 997)
  const jag = () => (r() - 0.5) * 5
  g.save()
  g.translate(64, 84)
  g.rotate(-0.06)
  g.beginPath()
  g.moveTo(-40, -52)
  for (let x = -40; x <= 40; x += 10) g.lineTo(x, -52 + jag())
  for (let y = -52; y <= 56; y += 12) g.lineTo(40 + jag(), y)
  for (let x = 40; x >= -40; x -= 10) g.lineTo(x, 56 + jag())
  for (let y = 56; y >= -52; y -= 12) g.lineTo(-40 + jag(), y)
  g.closePath()
  g.shadowColor = 'rgba(60, 30, 10, 0.35)'
  g.shadowBlur = 8
  g.shadowOffsetY = 3
  g.fillStyle = '#fbf3e1'
  g.fill()
  g.shadowColor = 'transparent'
  g.strokeStyle = 'rgba(120, 85, 50, 0.4)'
  g.lineWidth = 1.5
  g.stroke()
  // Tape across the top in the villager's colour.
  g.fillStyle = colour
  g.globalAlpha = 0.9
  g.fillRect(-28, -62, 56, 20)
  g.fillStyle = 'rgba(30, 14, 4, 0.2)'
  g.fillRect(-28, -62, 56, 20)
  g.globalAlpha = 1
  g.fillStyle = '#24170f'
  g.font = `700 92px ${HAND}`
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.fillText('!', 2, 14)
  g.restore()
  return toTexture(c)
}

function css() {
  const paper = `radial-gradient(120% 90% at 20% 0%, #fffaf0 0%, #fbf1dd 55%, #f3e3c4 100%)`
  const words = `${TEXT_PX}px/${LEADING} ${BOOK}`
  return `
  .talk-card, .talk-slip { box-sizing: border-box; border-radius: 16px; color: #46301f; background: ${paper}; }
  .talk-card { box-shadow: 0 12px 28px rgba(60, 30, 10, 0.26), 0 2px 0 rgba(255, 255, 255, 0.7) inset, 0 -3px 0 rgba(150, 105, 60, 0.16) inset; }
  .talk-card::before, .talk-slip::before { content: ''; position: absolute; inset: 7px; border: 2px dashed rgba(150, 100, 60, 0.36); border-radius: 11px; pointer-events: none; }
  .talk-card { position: fixed; left: 0; top: 0; width: fit-content; min-width: 150px; max-width: min(${TEXT_WIDTH + 44}px, calc(100vw - 32px)); padding: 22px 22px 14px;
    opacity: 0; pointer-events: none; transition: opacity 180ms ease, scale 220ms cubic-bezier(.2, 1.4, .4, 1), filter 300ms ease; scale: 0.94; transform-origin: var(--tail, 50%) 100%; }
  .talk-card[data-tail='left'] { transform-origin: 0 var(--tail, 40px); }
  .talk-card[data-tail='right'] { transform-origin: 100% var(--tail, 40px); }
  .talk-card.shown { opacity: 1; scale: 1; pointer-events: auto; }
  .talk-card::after { content: ''; position: absolute; left: var(--tail, 50%); bottom: -10px; width: 20px; height: 20px; margin-left: -10px;
    background: #f5e7cb; rotate: 45deg; border-radius: 0 0 5px 0; box-shadow: 4px 4px 6px rgba(60, 30, 10, 0.14); }
  .talk-card[data-tail='left']::after { left: -10px; top: var(--tail, 40px); bottom: auto; margin: -10px 0 0; background: #fcf4e3; border-radius: 0 0 0 5px; box-shadow: -3px 3px 5px rgba(60, 30, 10, 0.12); }
  .talk-card[data-tail='right']::after { left: auto; right: -10px; top: var(--tail, 40px); bottom: auto; margin: -10px 0 0; background: #f8ecd4; border-radius: 0 5px 0 0; box-shadow: 3px -3px 5px rgba(60, 30, 10, 0.1); }
  .talk-card .words { margin: 0; white-space: pre-wrap; font: ${words}; color: #3d2a1c; }
  .talk-card .before { margin: 0 0 6px; padding-bottom: 5px; border-bottom: 1.5px dashed rgba(150, 100, 60, 0.28); cursor: pointer;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font: italic 16px/1.35 ${BOOK}; color: #6b5340; opacity: 0.72; }
  .talk-card .before.open { white-space: pre-wrap; }
  /* The page before is kept, not written over the next page: cut off in grey it read as noise (#42 paper climb). */
  .talk-card .before { display: none; }
  .talk-card.mine { max-width: min(240px, calc(100vw - 32px)); padding: 14px 18px 12px; }
  .talk-card.mine, .talk-card.mine.shown { pointer-events: none; }
  .talk-card.mine::after { display: none; }
  .talk-card.mine .to-line { margin: 0 0 2px; font: italic 15px/1.2 ${HAND}; }
  .talk-card.mine .words { font: 20px/1.3 ${HAND}; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
  .talk-card.mine:not(.clipped) .words { font-size: 23px; }
  .talk-card .before[hidden], .talk-card .more[hidden], .talk-card .cue[hidden] { display: none; }
  .talk-card .more { display: block; margin: 2px 0 0 auto; padding: 2px 4px; border: 0; background: none; cursor: pointer;
    font: italic 700 17px ${HAND}; color: color-mix(in oklab, var(--c) 80%, #2a1608); }
  .talk-card .more::after { content: ' \\25B8'; }
  .talk-card .cue { display: inline-flex; gap: 4px; margin-left: 7px; vertical-align: 0.1em; }
  .talk-card .cue i { width: 6px; height: 6px; border-radius: 50%; background: color-mix(in oklab, var(--c) 75%, #2a1608);
    box-shadow: 0 0 0 1.5px rgba(255, 248, 236, 0.7) inset; animation: talk-cue 1.1s ease-in-out infinite; }
  .talk-card .cue i:nth-child(2) { animation-delay: 0.18s; }
  .talk-card .cue i:nth-child(3) { animation-delay: 0.36s; }
  @keyframes talk-cue { 0%, 70%, 100% { translate: 0 0; opacity: 0.45; } 30% { translate: 0 -3px; opacity: 1; } }
  /* Said, while someone else speaks: one dimmed line, so it never covers the speaker. */
  /* A pass: an action, not words. */
  .talk-card.beat .words { font-style: italic; font-size: 17px; color: #6a5442; }
  .talk-card.said { max-width: 300px; padding: 18px 18px 10px; opacity: 0.9; box-shadow: 0 6px 14px rgba(60, 30, 10, 0.16); }
  .talk-card.said .words { display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; font-size: 16px; color: #6a5442; }
  .talk-card.said .before, .talk-card.said .more, .talk-card.said .cue { display: none; }
  .talk-card.said .nametag { box-shadow: none; scale: 0.9; transform-origin: 0 100%; opacity: 0.85; }
  .talk-ruler { position: fixed; left: -9999px; top: 0; width: ${TEXT_WIDTH}px; margin: 0; visibility: hidden; pointer-events: none; white-space: pre-wrap; font: ${words}; }

  .nametag { display: inline-flex; align-items: baseline; gap: 6px; padding: 4px 13px 5px; border-radius: 11px 11px 5px 5px; white-space: nowrap;
    background: color-mix(in oklab, var(--c) 86%, #2a1608); color: #fffaf0; text-shadow: 0 1px 0 rgba(40, 20, 8, 0.35);
    box-shadow: 0 4px 10px rgba(60, 30, 10, 0.25), inset 0 0 0 2px rgba(255, 255, 255, 0.12); position: relative; }
  .nametag::after { content: ''; position: absolute; inset: 3px; border: 1.5px dashed rgba(255, 248, 236, 0.6); border-radius: 8px 8px 3px 3px; pointer-events: none; }
  .nametag b { font: 700 19px/1.15 ${HAND}; letter-spacing: 0.01em; }
  .nametag small { font: 700 14px/1.15 ${HAND}; color: #fff3df; opacity: 0.9; }
  .talk-card .tab, .talk-slip .tab { position: absolute; left: 18px; top: -19px; }
  .nametag.to { background: #fffaf0; color: color-mix(in oklab, var(--c) 85%, #2a1608); text-shadow: none; padding: 3px 14px 4px;
    box-shadow: 0 2px 6px rgba(60, 30, 10, 0.14), inset 0 0 0 1.5px color-mix(in oklab, var(--c) 50%, transparent); }
  .nametag.to::after { border-color: color-mix(in oklab, var(--c) 45%, transparent); }
  .nametag.to b { font-size: 22px; }
  .nametag.to i { font: italic 16px/1.15 ${HAND}; opacity: 0.8; }

  .talk-tag { position: fixed; left: 0; top: 0; pointer-events: none; opacity: 0; scale: 0.86; transform-origin: 50% 100%;
    transition: opacity 200ms ease, scale 260ms cubic-bezier(.2, 1.5, .4, 1), filter 200ms ease; filter: saturate(0.7); }
  .talk-tag::before { content: ''; position: absolute; left: var(--tail, 50%); bottom: -5px; width: 10px; height: 10px; margin-left: -5px; rotate: 45deg;
    border-radius: 0 0 3px 0; background: color-mix(in oklab, var(--c) 86%, #2a1608); }
  .talk-tag.shown { opacity: 0.86; }
  .talk-tag.hover { opacity: 1; scale: 1; filter: none; }
  body.talk-hovering .village-label { visibility: hidden; }
  .talk-tag.shown.lit { opacity: 1; scale: 1.08; filter: none; box-shadow: 0 0 0 3px rgba(255, 244, 214, 0.85), 0 6px 16px rgba(60, 30, 10, 0.35); }

  .talk-slip { position: fixed; right: 28px; bottom: 24px; width: min(400px, calc(100vw - 32px)); padding: 24px 22px 14px;
    box-shadow: 0 8px 20px rgba(60, 30, 10, 0.17), 0 2px 0 rgba(255, 255, 255, 0.75) inset;
    display: flex; flex-direction: column; gap: 8px; opacity: 0; translate: 0 14px; pointer-events: none; transition: opacity 220ms ease, translate 240ms ease; }
  .talk-slip::before { border-width: 1.5px; border-color: rgba(150, 100, 60, 0.3); }
  .talk-slip.shown { opacity: 1; translate: 0 0; pointer-events: auto; }
  .talk-slip.idle { padding-bottom: 12px; }
  .talk-slip.idle .chips { display: none; }
  .talk-slip .mine { margin: 0; display: none; color: #2f4a6b; font: italic 17px/1.35 ${BOOK}; opacity: 0.85; }
  .talk-slip .mine.shown { display: block; }
  .talk-slip .ruled { display: block; position: relative; }
  .talk-slip .ruled::after { content: ''; position: absolute; left: 0; right: 0; bottom: 2px; border-bottom: 2px solid rgba(90, 60, 38, 0.5); border-radius: 2px; }
  .talk-slip .line { box-sizing: border-box; width: 100%; padding: 4px 2px 7px; border: 0; outline: none; background: none;
    color: #23395a; font: ${words}; caret-color: #23395a; }
  .talk-slip .line::placeholder { color: rgba(74, 52, 36, 0.72); font-style: italic; }
  .talk-slip .line:focus-visible { outline: none; }
  .talk-slip .ruled:focus-within::after { border-bottom-color: rgba(47, 74, 107, 0.85); }
  .talk-slip.waiting .line { opacity: 0.6; }
  .talk-slip .chips { display: flex; gap: 6px 8px; flex-wrap: wrap; }
  .talk-slip .chips:empty, .talk-slip.waiting .chips { display: none; }
  .talk-slip .chip { position: relative; padding: 3px 11px 4px; border: 0; border-radius: 999px; cursor: pointer;
    background: rgba(214, 186, 146, 0.3); color: #553a26; font: 16px ${HAND}; transition: background 120ms ease, translate 120ms ease; }
  .talk-slip .chip::before { content: ''; position: absolute; inset: 2px; border: 1.2px dashed rgba(150, 100, 60, 0.4); border-radius: 999px; }
  .talk-slip .chip.ideas { padding: 0 12px 6px; font: 700 18px/1 ${BOOK}; color: rgba(85, 58, 38, 0.7); background: rgba(214, 186, 146, 0.18); }
  .talk-slip .chip:hover, .talk-slip .chip:focus-visible { background: rgba(214, 186, 146, 0.6); translate: 0 -1px; outline: none; }
  .talk-voice { position: fixed; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
  @media (max-width: 600px) { .talk-slip { right: 16px; bottom: 16px; }
    .talk-card.mine:not(.clipped) { max-width: 158px; padding: 10px 12px 8px; }
    .talk-card.mine:not(.clipped) .words { font-size: 16px; -webkit-line-clamp: 3; }

    .talk-card.said .words { -webkit-line-clamp: 2; font-size: 15px; } .talk-card.said { max-width: min(250px, 66vw); }
    .talk-card.mine.clipped .words { -webkit-line-clamp: 2; } }
  @media (prefers-reduced-motion: reduce) { .talk-card, .talk-slip, .talk-tag { transition: none; } .talk-card .cue i { animation: none; opacity: 0.8; } }
  `
}

if (import.meta.hot) import.meta.hot.accept((m) => m && replace(m.default))
