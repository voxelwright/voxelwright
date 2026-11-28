// Client-side RDR2/GTA 6 social interaction & living-city HUD tests (#164):
//   1. Target acquisition: 6 m (60-cell) radius, 70° forward cone, vertical bounds, self-exclusion, witness priority.
//   2. Auto-hiding HUD rules: completely hidden at rest, while driving, typing, first view, or map/wheel open;
//      contextual `[G] Greet · [H] Antagonize` + `[F] Defuse` after antagonism + `[F] Intercept` on active witness;
//      body-box overlap avoidance keeps prompt clear of the character's box.
//   3. Offline 0 ms Greet/Antagonize/Defuse escalation, 3D overhead speech pill injection (`observeLocal`),
//      and `[Enter] Talk` Mind escalation callback.
//   4. Live `POST /world/social` & `GET /world/city` round-trip against `serve.mjs`: calm auto-hide, greet/antagonize
//      escalation, non-omniscient witness alert auto-show, and `[F]` witness interception auto-hide.
//   5. Zero key-binding collisions against `engine/page/keys.ts` (`OWN`/`YIELDED`, never `FREE`) and passthrough when idle.
//
//   node engine/test/social-ui.mjs
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FREE, OWN, YIELDED } from '../page/keys.ts'
import {
  SOCIAL_CONE_DEG,
  SOCIAL_KEYS,
  SOCIAL_RANGE_CELLS,
  createLocalBarks,
  createSocial,
  localDistrictTone,
  selectSocialTarget,
} from '../page/social.ts'
import { serve } from './kit.mjs'

const failures = []
const check = (ok, what) => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`)
  if (!ok) failures.push(what)
}

/** Minimal DOM mock sufficient to verify visibility, attributes, clicks, style vars, and body avoidance in Node. */
function createMockDom() {
  class MockEl {
    constructor(tag, doc) {
      this.tagName = tag.toUpperCase()
      this.ownerDocument = doc
      this.id = ''
      this.className = ''
      this.hidden = false
      this.type = ''
      this.dataset = {}
      this.children = []
      this.parentElement = null
      this.attrs = new Map()
      this.listeners = new Map()
      this.props = new Map()
      this._text = ''
      this._rect = { left: 500, top: 650, right: 780, bottom: 696, width: 280, height: 46 }
      this.style = {
        setProperty: (k, v) => this.props.set(k, v),
        getPropertyValue: (k) => this.props.get(k) ?? '',
      }
    }
    get textContent() {
      if (this.children.length === 0) return this._text
      return this._text + this.children.map((c) => c.textContent).join('')
    }
    set textContent(v) {
      this._text = String(v ?? '')
      this.children.length = 0
    }
    append(...nodes) {
      for (const n of nodes) {
        if (!n) continue
        n.parentElement = this
        this.children.push(n)
      }
    }
    remove() {
      if (!this.parentElement) return
      const i = this.parentElement.children.indexOf(this)
      if (i >= 0) this.parentElement.children.splice(i, 1)
      this.parentElement = null
    }
    setAttribute(k, v) { this.attrs.set(k, String(v)) }
    getAttribute(k) { return this.attrs.get(k) ?? null }
    addEventListener(type, fn) {
      const list = this.listeners.get(type) ?? []
      list.push(fn)
      this.listeners.set(type, list)
    }
    click() {
      for (const fn of this.listeners.get('click') ?? []) fn({ stopPropagation() {} })
    }
    blur() {}
    getBoundingClientRect() { return { ...this._rect } }
    query(pred) {
      for (const c of this.children) {
        if (pred(c)) return c
        const hit = c.query(pred)
        if (hit) return hit
      }
      return null
    }
    queryAll(pred, out = []) {
      for (const c of this.children) {
        if (pred(c)) out.push(c)
        c.queryAll(pred, out)
      }
      return out
    }
  }

  const doc = {
    visibilityState: 'visible',
    activeElement: null,
    head: null,
    body: null,
    createElement(tag) { return new MockEl(tag, doc) },
    getElementById(id) { return doc.head.query((e) => e.id === id) || doc.body.query((e) => e.id === id) },
    querySelector(sel) { return sel.startsWith('#') ? doc.getElementById(sel.slice(1)) : null },
  }
  doc.head = new MockEl('head', doc)
  doc.body = new MockEl('body', doc)
  const mount = doc.createElement('div')
  mount.dataset.panel = 'social'
  doc.body.append(mount)
  return { doc, mount }
}

/** Minimal Input mode stack matching `engine/page/input.ts` dispatch semantics. */
function createMockInput() {
  const stack = []
  return {
    push(mode) {
      stack.push(mode)
      return () => {
        const i = stack.indexOf(mode)
        if (i >= 0) stack.splice(i, 1)
      }
    },
    press(code, repeat = false) {
      for (let i = stack.length - 1; i >= 0; i--) {
        const handled = stack[i].key?.(code, { code, repeat })
        if (handled === true) return true
        if (stack[i].solid) return false
      }
      return false
    },
  }
}

// ── 1. Target Acquisition & Cone Filtering ───────────────────────────────────
console.log('1. Target acquisition (6 m radius, 70° view cone, witness priority)')
{
  // Observer at (0, 0, 0) facing north (-z, yaw = 0).
  const obs = { at: [0, 0, 0], forward: [0, 0, -1], yaw: 0 }

  const behind = { id: 'npc-behind', name: 'Behind', at: [0, 0, 20], remote: false }
  const tooFar = { id: 'npc-far', name: 'Far', at: [0, 0, -(SOCIAL_RANGE_CELLS + 5)], remote: false }
  const outOfCone = { id: 'npc-side', name: 'Side', at: [30, 0, -25], remote: false } // ~50.2° off axis (> 35°)
  const onRoof = { id: 'npc-roof', name: 'Roof', at: [0, 60, -20], remote: false }
  const selfAtOrigin = { id: 'npc-self', name: 'Self', at: [0, 0, 0], remote: false }

  check(
    selectSocialTarget(obs, [behind, tooFar, outOfCone, onRoof, selfAtOrigin]) === null,
    `rejects NPCs behind, beyond ${SOCIAL_RANGE_CELLS} cells (6 m), outside ${SOCIAL_CONE_DEG}° cone, >3.5 m vertical, or at self origin`,
  )

  const aheadNear = { id: 'npc-near', name: 'Near', at: [2, 0, -25], remote: false }
  const aheadMid = { id: 'npc-mid', name: 'Mid', at: [-4, 0, -45], remote: false }
  const picked = selectSocialTarget(obs, [behind, aheadMid, aheadNear, outOfCone])
  check(
    picked?.candidate.id === 'npc-near' && picked.distanceM > 2 && picked.angleDeg < 10,
    `locks nearest NPC in forward 70° cone (${picked?.candidate.id}, ${picked?.distanceM} m, ${picked?.angleDeg}°)`,
  )

  // Witness slightly further in cone still gets priority when within 6 m.
  const wit = { id: 'rule/witness', name: 'Witness', at: [0, 0, -30], remote: true }
  const pickedWit = selectSocialTarget(obs, [aheadNear, wit], { witnessIds: new Set(['rule/witness']) })
  check(
    pickedWit?.candidate.id === 'rule/witness' && pickedWit.isWitness === true,
    'prioritizes active reporting witness inside the forward cone',
  )
}

// ── 2. Auto-Hide HUD, Escalation, Speech Pills, Avoidance & Touch Buttons ───
console.log('2. Auto-hide HUD, offline 0 ms escalation, overhead speech pills & body avoidance')
{
  const { doc, mount } = createMockDom()
  const mockInput = createMockInput()
  let nowMs = 10_000
  let disabled = false
  let suppressedG = false
  let candidates = []
  let bodyBoxes = []
  let escalatedCount = 0
  let talkOpened = 0

  const social = createSocial({
    mount,
    input: mockInput,
    observer: () => ({ at: [0, 0, 0], forward: [0, 0, -1], yaw: 0 }),
    candidates: () => candidates,
    disabled: () => disabled,
    suppressKey: (code) => code === 'KeyG' && suppressedG,
    avoidBoxes: () => bodyBoxes,
    district: () => 'Mission',
    weather: () => 'fog',
    canTalk: () => true,
    onEscalateToMind: () => { escalatedCount++ },
    openTalk: () => { talkOpened++ },
    now: () => nowMs,
    pollMs: 0,
  })

  const promptEl = mount.query((e) => e.className === 'vw-social-prompt')
  const statusEl = mount.query((e) => e.className === 'vw-city-status')
  const barkEl = mount.query((e) => e.className === 'vw-social-bark')
  const greetBtn = mount.query((e) => e.dataset.act === 'greet')
  const antagonizeBtn = mount.query((e) => e.dataset.act === 'antagonize')
  const secondaryBtn = mount.query((e) => e.className === 'vw-social-btn' && (e.dataset.act === 'defuse' || e.dataset.act === 'intercept'))
  const talkBtn = mount.query((e) => e.dataset.act === 'talk')

  // Idle: everything hidden, keys pass through.
  social.frame(nowMs)
  check(
    promptEl.hidden === true && statusEl.hidden === true && barkEl.hidden === true && !social.promptVisible && !social.statusVisible,
    'all social & city overlays stay hidden when idle with no NPCs and calm city',
  )
  check(
    mockInput.press('KeyG') === false && mockInput.press('KeyH') === false && mockInput.press('KeyF') === false,
    'G/H/F pass through cleanly when no NPC is locked',
  )

  // Local pedestrian enters 6 m cone via observeLocal (SF offline path).
  const localPed = { at: [0, 0, -30], yaw: Math.PI, seed: 4242, name: 'Neighbor' }
  social.observeLocal([localPed])
  social.frame(nowMs)
  check(
    !promptEl.hidden && social.promptVisible && social.target?.candidate.id === 'local:4242' && secondaryBtn.hidden === true,
    'facing local pedestrian within 6 m reveals contextual prompt ([G] Greet · [H] Antagonize, [F] hidden)',
  )

  // Body-box overlap avoidance: if character box overlaps prompt rect (500..780, 650..696), prompt shifts clear!
  bodyBoxes = [{ left: 580, top: 440, right: 700, bottom: 720 }]
  social.frame(nowMs)
  const dxShift = parseFloat(promptEl.style.getPropertyValue('--soc-dx')) || 0
  const dyShift = parseFloat(promptEl.style.getPropertyValue('--soc-dy')) || 0
  check(
    dxShift !== 0 || dyShift !== 0,
    `prompt shifts clear of character body box (dx=${dxShift}px, dy=${dyShift}px)`,
  )
  bodyBoxes = []

  // The tool bar along the foot of the picture (thirteen tools since #226) is not covered: the prompt stands above it.
  const toolsBar = doc.createElement('div')
  toolsBar.id = 'tools'
  toolsBar._rect = { left: 120, top: 670, right: 1160, bottom: 706, width: 1040, height: 36 }
  doc.body.append(toolsBar)
  social.frame(nowMs)
  const lifted = parseFloat(promptEl.style.getPropertyValue('--soc-dy')) || 0
  check(696 + lifted <= 670, `prompt stands above the tool bar, not over it (dy=${lifted}px)`)
  toolsBar.remove()
  social.frame(nowMs)

  // Driving / typing / first view hides prompt immediately and releases keys.
  disabled = true
  social.frame(nowMs)
  check(
    promptEl.hidden === true && !social.promptVisible && mockInput.press('KeyG') === false,
    'hides prompt and ignores social keys while driving, typing, or in first view',
  )
  disabled = false
  social.frame(nowMs)

  // Suppress G (e.g. holding a made thing in hands.ts) passes G through while H still works.
  suppressedG = true
  check(mockInput.press('KeyG') === false, 'KeyG passes through when suppressed (e.g., holding/reaching a made thing)')
  suppressedG = false

  // 0 ms local Greet 1 -> 2 -> 3 escalation via key/button + 3D overhead speech pill injection.
  const g1 = await social.act('greet')
  const g2 = await social.act('greet')
  const g3 = await social.act('greet')
  check(
    g1?.bark.ms === 0 && g1.bark.tone === 'friendly' && g1.bark.step === 1 && g2?.bark.step === 2 && g3?.bark.step === 3 && g3.escalateToMind === true,
    `offline 0 ms Greet escalates 1->2->3 in Mission ('friendly') with escalateToMind=true`,
  )
  check(
    !barkEl.hidden && escalatedCount >= 1 && !talkBtn.hidden,
    '3rd Greet shows instant speech pill, fires onEscalateToMind, and reveals [Enter] Talk nudge',
  )
  talkBtn.click()
  check(talkOpened === 1, 'clicking Talk button invokes openTalk callback')

  // Verify observeLocal injects the 0 ms speech directly onto Person.says for 3D WebGPU overhead pill!
  const pedFrame = { at: [0, 0, -30], yaw: Math.PI, seed: 4242, name: 'Neighbor' }
  social.observeLocal([pedFrame])
  check(
    typeof pedFrame.says === 'string' && pedFrame.says === g3.bark.text,
    'observeLocal injects 0 ms local bark directly into Person.says for 3D overhead speech pill',
  )

  // Antagonize via button -> reveals [F] Defuse -> Defuse via KeyF resets mood & hides [F].
  antagonizeBtn.click()
  await Promise.resolve()
  social.frame(nowMs)
  check(
    secondaryBtn.hidden === false && secondaryBtn.dataset.act === 'defuse',
    'antagonizing reveals contextual [F] Defuse button',
  )
  check(mockInput.press('KeyF') === true, 'pressing KeyF while antagonized triggers Defuse')
  await Promise.resolve()
  social.frame(nowMs)
  check(
    social.lastResult?.bark.outcome === 'defused' && secondaryBtn.hidden === true,
    'Defuse resets exchange to calm and auto-hides [F] again',
  )

  // Speech pill expires cleanly after duration.
  nowMs += 15_000
  social.observeLocal([localPed])
  social.frame(nowMs)
  check(barkEl.hidden === true && social.speechFor(4242, nowMs) === '', 'speech pill and overhead bark auto-expire cleanly')

  // KeyG works when facing target and not suppressed; KeyF passes through when not antagonized/witness.
  check(mockInput.press('KeyG') === true && mockInput.press('KeyF') === false, 'KeyG triggers Greet while KeyF passes through when not antagonized/witness')

  // Check localDistrictTone & createLocalBarks determinism.
  const b1 = createLocalBarks()
  const rA = b1.interact({ actorId: 'a', action: 'greet', district: 'Financial District', now: 1, seed: 7 })
  check(localDistrictTone('Pacific Heights') === 'aloof' && rA.bark.tone === 'aloof' && rA.bark.ms === 0, 'neighborhood tone mapping matches district profiles deterministically')

  // Guard: verify activeElement INPUT auto-hides even if disabled() is false.
  doc.activeElement = { tagName: 'INPUT' }
  const prevDoc = globalThis.document
  globalThis.document = doc
  try {
    social.frame(nowMs)
    check(promptEl.hidden === true, 'auto-hides when typing inside an <input> element')
  } finally {
    globalThis.document = prevDoc
  }

  social.destroy()
  check(mount.children.length === 0, 'destroy() cleanly unmounts all social overlay elements')
}

// ── 3. Zero Key-Binding Collisions Against keys.ts ───────────────────────────
console.log('3. Key-binding registry check against engine/page/keys.ts')
{
  const ownSet = new Set(Object.keys(OWN))
  const yieldedSet = new Set(Object.keys(YIELDED))
  const freeSet = new Set(FREE)
  const used = Object.values(SOCIAL_KEYS)
  check(
    used.every((k) => (ownSet.has(k) || yieldedSet.has(k)) && !freeSet.has(k)),
    `all social keys (${used.join(', ')}) are declared in keys.ts OWN/YIELDED and never collide with FREE`,
  )
}

// ── 4. Live POST /world/social & GET /world/city Integration via serve.mjs ─────
console.log('4. Live POST /world/social & GET /world/city integration against serve.mjs')
const dir = mkdtempSync(join(tmpdir(), 'engine-social-ui-'))
const file = join(dir, 'world.log')
const server = await serve('/dev/null', ['--world', file])
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const req = async (path, init) => {
  for (;;) {
    const r = await fetch(`${server.url}/world/${path}`, init)
    if (r.status === 429) { await wait(350); continue }
    const text = await r.text()
    let json = null
    try { json = JSON.parse(text) } catch { /* plain text */ }
    return { status: r.status, ok: r.ok, json, text }
  }
}
const get = (path) => req(path)
const post = (path, body) => req(path, { method: 'POST', body: JSON.stringify(body) })
const until = async (what, fn, ms = 12_000) => {
  for (const t0 = Date.now(); Date.now() - t0 < ms; await wait(120)) {
    const v = await fn()
    if (v) return v
  }
  throw new Error(`timeout waiting for: ${what}`)
}

try {
  const gStreet = (await get('at?x=700&y=154&z=4065')).json.ground
  const yStreet = gStreet + 1
  await post('join', { by: 'player1', at: [700, 4050] })

  // Spawn an interactive shared-world actor directly ahead of the player (within 3 m).
  await post('ask', {
    by: 'tester',
    rule: {
      id: 'plaza-npc',
      name: 'Plaza actor',
      source: `on('start', (world) => { world.actor('maya', { name: 'Maya', at: [700, 4025], face: [700, 4050] }) })`,
    },
  })
  await until('Maya spawns', async () => (await get('around?by=player1&within=1200')).json?.people?.some((p) => p.name === 'Maya'))

  const { mount } = createMockDom()
  const mockInput = createMockInput()
  let remoteActors = [{ id: 'plaza-npc/maya', name: 'Maya', at: [700, yStreet, 4025], remote: true }]
  let mindEscalations = 0

  const social = createSocial({
    mount,
    input: mockInput,
    world: {
      base: `${server.url}/world`,
      me: 'player1',
      name: () => 'player1',
      fetch: (url, init) => fetch(url, init),
    },
    observer: () => ({ at: [700, yStreet, 4050], forward: [0, 0, -1], yaw: 0 }),
    candidates: () => remoteActors,
    canTalk: () => true,
    onEscalateToMind: () => { mindEscalations++ },
    pollMs: 0,
  })

  const statusEl = mount.query((e) => e.className === 'vw-city-status')
  const witnessBadge = mount.query((e) => e.className === 'vw-city-witness')
  const secondaryBtn = mount.query((e) => e.className === 'vw-social-btn' && (e.dataset.act === 'defuse' || e.dataset.act === 'intercept'))

  // Poll calm city: heat === 0, witnesses === 0 -> status pill completely hidden!
  const calmCity = await social.pollCity()
  social.frame()
  check(
    calmCity?.heat === 0 && calmCity.witnesses.length === 0 && statusEl.hidden === true && !social.statusVisible,
    'live GET /world/city starts calm (heat=0, witnesses=0) with status pill hidden',
  )
  check(social.target?.candidate.id === 'plaza-npc/maya', 'target-locked live shared-world actor plaza-npc/maya')

  // Live POST /world/social Greet round-trip.
  const liveGreet = await social.act('greet')
  check(
    liveGreet?.remote === true && liveGreet.bark.ms === 0 && liveGreet.trust > 0 && liveGreet.bark.text.length > 0,
    `live POST /world/social greet succeeded ("${liveGreet?.bark.text?.slice(0, 44)}", trust=${liveGreet?.trust})`,
  )

  // Live POST /world/social Antagonize x3 -> escalateToMind === true.
  await social.act('antagonize')
  await social.act('antagonize')
  const liveAnt3 = await social.act('antagonize')
  check(
    liveAnt3?.remote === true && liveAnt3.escalateToMind === true && liveAnt3.trust < 0 && mindEscalations >= 1,
    `live POST /world/social antagonize escalated (trust=${liveAnt3?.trust}, escalateToMind=${liveAnt3?.escalateToMind})`,
  )

  // Trigger a blast in clear LOS of Maya so she becomes an active reporting witness!
  await post('ask', { by: 'player1', blast: [700, yStreet + 6, 4050], radius: 3, wait: true })
  const witCity = await until(
    'Maya enters active witnesses in GET /world/city',
    async () => {
      const s = await social.pollCity()
      return s?.witnesses?.some((w) => w.witnessId === 'plaza-npc/maya') ? s : null
    },
    5000,
  )
  social.frame()
  check(
    Boolean(witCity) && !statusEl.hidden && !witnessBadge.hidden && social.target?.isWitness === true && secondaryBtn.dataset.act === 'intercept' && !secondaryBtn.hidden,
    'active witness auto-shows Witness Alert pill and switches prompt [F] to Intercept',
  )

  // Press KeyF (or act('intimidate')) -> intercepts witness cleanly via live POST /world/social!
  const intercepted = await social.act('intimidate')
  const afterCity = await social.pollCity()
  social.frame()
  check(
    intercepted?.remote === true && intercepted.intercepted === true && !afterCity.witnesses.some((w) => w.witnessId === 'plaza-npc/maya'),
    `live POST /world/social witness interception cleared active witness (intercepted=${intercepted?.intercepted})`,
  )
  check(
    afterCity.heat === 0 && afterCity.witnesses.length === 0 && statusEl.hidden === true && !social.statusVisible,
    'Witness Alert auto-hides again once witness is intercepted and heat remains 0',
  )

  social.destroy()
} catch (e) {
  failures.push(String(e?.stack ?? e))
} finally {
  server.stop()
  rmSync(dir, { recursive: true, force: true })
}

if (failures.length) {
  console.error(`FAILED\n  ${failures.join('\n  ')}`)
  process.exit(1)
}
console.log('social-ui: ok')
process.exit(0)
