// The approval page (#87, host/src/approval-server.ts; approval.ts says why it has its own origin). It shows the one
// run the address names (#run=<id>): Keep and Not this for a passed run, Undo for a kept one. Nothing else in the
// address is read. Buttons arm 0.8 s after the page is visible and focused, and only once the person has done
// something here since: moved the pointer more than 8 px from where it first was, or pressed Tab. So a double-click
// that opened this tab, or a tab opened under a still cursor, cannot press them. (On a device without hover the timer
// alone arms them.) They disable again when the page is hidden or loses focus, and they ignore script-made events.
// A choice is a press held 0.7 s (button), so a burst of clicks makes none.
'use strict'

const ARM_MS = 800
/** A choice is a press held this long: a burst of clicks, however many, never makes one. */
const HOLD_MS = 700
const RUN_ID = /^[\w.-]{1,120}$/
const WORDS = { pass: 'passed', fail: 'failed', warn: 'a warning only', skipped: 'not run', now: 'running', waiting: 'not yet' }
const MARKS = { pass: '✓', fail: '✕', warn: '!', skipped: '–', now: '…', waiting: '·' }

const $ = (id) => document.getElementById(id)
const runId = new URLSearchParams(location.hash.slice(1)).get('run')
let person = null
let run = null
let armed = false
let armTimer = null
let busy = false
/** Every button's hold, ended when the page disarms. */
const holds = []

const api = (path, body) =>
  fetch(`/villager/api${path}`, body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
const runPath = () => `/people/${encodeURIComponent(person)}/elder/runs/${encodeURIComponent(runId)}`

function setDisabled() {
  // aria-disabled, not disabled: a disabled button cannot take focus, and Tab must reach it to arm the page.
  for (const b of $('actions').querySelectorAll('button')) b.setAttribute('aria-disabled', String(!armed || busy))
}
/** A touch screen has no pointer resting over the page, so there is no move to wait for. */
const HOVERLESS = matchMedia('(hover: none)').matches
const MOVE_PX = 8
let waited = false
let gestured = HOVERLESS
let firstPoint = null
/** Disarms. `forget`: the page lost focus or was hidden, so a gesture made before no longer counts. */
function disarm(forget = false) {
  armed = false
  waited = false
  if (forget) {
    gestured = HOVERLESS
    firstPoint = null
  }
  clearTimeout(armTimer)
  for (const cancel of holds) cancel()
  setDisabled()
}
/** Armed once both the timer has run and the person has done something here. */
function settleArm() {
  armed = waited && gestured && document.visibilityState === 'visible' && document.hasFocus()
  setDisabled()
}
function arm() {
  disarm()
  // A popup's size and place are its opener's to choose (a kept plugin could put one under the pointer); a tab's are not.
  if (!window.locationbar.visible) return void say('Open this page in a tab of its own to choose.', true)
  // Buttons that stay disabled say why: the page has not had a click or the keyboard yet.
  $('hint').hidden = document.hasFocus() || !$('actions').querySelector('button')
  if (document.visibilityState !== 'visible' || !document.hasFocus()) return
  armTimer = setTimeout(() => {
    waited = true
    settleArm()
  }, ARM_MS)
}
window.addEventListener('pointermove', (e) => {
  if (!e.isTrusted || gestured) return
  if (!firstPoint) return void (firstPoint = { x: e.screenX, y: e.screenY })
  if (Math.hypot(e.screenX - firstPoint.x, e.screenY - firstPoint.y) > MOVE_PX) {
    gestured = true
    settleArm()
  }
})
window.addEventListener('keydown', (e) => {
  if (!e.isTrusted || e.key !== 'Tab' || gestured) return
  gestured = true
  settleArm()
})
document.addEventListener('visibilitychange', () => (document.visibilityState === 'visible' ? arm() : disarm(true)))
window.addEventListener('focus', arm)
window.addEventListener('blur', () => (disarm(true), arm()))
// The address may change while the page is open (another run's link): read it again from the start.
window.addEventListener('hashchange', () => location.reload())

function say(text, isNote = false) {
  if (isNote) {
    $('note').hidden = !text
    $('note').textContent = text ?? ''
  } else $('status').textContent = text
}

/**
 * Keep, Undo and Not this are pressed and held: a trusted pointerdown and a pointerup on the same button at least
 * HOLD_MS apart, or Enter or Space held as long (key repeat ignored). Leaving the button, a cancelled pointer, the page
 * losing focus or disarming ends the hold. A click alone does nothing.
 */
function button(label, cls, act) {
  const b = document.createElement('button')
  b.type = 'button'
  b.className = `${cls} hold`
  b.dataset.act = act
  b.setAttribute('aria-disabled', 'true')
  const text = document.createElement('span')
  text.className = 'label'
  text.textContent = label
  const bar = document.createElement('span')
  bar.className = 'bar'
  bar.setAttribute('aria-hidden', 'true')
  b.append(text, bar)
  b.setAttribute('aria-description', 'Press and hold to choose')
  let since = 0
  let key = null
  const begin = (e) => {
    if (!e.isTrusted || !armed || busy || since) return false
    since = performance.now()
    b.classList.add('holding')
    return true
  }
  const cancel = () => {
    since = 0
    key = null
    b.classList.remove('holding')
  }
  const end = (e) => {
    const held = since && e.isTrusted && armed && !busy && performance.now() - since >= HOLD_MS
    cancel()
    if (held) void press(act)
  }
  // No pointer capture: a hold dragged off the button ends at pointerleave, and a release elsewhere never reaches it.
  // A touch is captured implicitly, just after pointerdown; it is released as soon as it is, so a finger sliding off
  // ends the hold too.
  b.addEventListener('gotpointercapture', (e) => e.target.releasePointerCapture(e.pointerId))
  b.addEventListener('pointerdown', (e) => {
    if (e.button === 0) begin(e)
  })
  b.addEventListener('pointerup', (e) => (e.button === 0 && !key ? end(e) : undefined))
  b.addEventListener('pointerleave', cancel)
  b.addEventListener('pointercancel', cancel)
  b.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return
    e.preventDefault()
    if (e.repeat || key) return
    if (begin(e)) key = e.key
  })
  b.addEventListener('keyup', (e) => {
    if (e.key !== key) return
    e.preventDefault()
    end(e)
  })
  b.addEventListener('blur', cancel)
  b.addEventListener('click', (e) => e.preventDefault())
  holds.push(cancel)
  return b
}


function render() {
  $('request').textContent = run ? `“${run.request}”` : 'No change to look at.'
  const stages = $('stages')
  stages.replaceChildren()
  for (const s of run?.stages ?? []) {
    const li = document.createElement('li')
    li.className = `stage ${s.state}`
    const mark = document.createElement('span')
    mark.className = 'mark'
    mark.setAttribute('aria-hidden', 'true')
    mark.textContent = MARKS[s.state] ?? ''
    const name = document.createElement('span')
    name.textContent = `${s.label ?? s.name}: ${WORDS[s.state] ?? s.state}`
    li.append(mark, name)
    stages.append(li)
  }
  if (run?.pictures) {
    $('pictures').hidden = false
    for (const which of ['before', 'after']) if (!$(which).getAttribute('src')) $(which).src = `/villager/api${runPath()}/${which}`
  }
  const actions = $('actions')
  actions.replaceChildren()
  holds.length = 0
  if (!run) return say('')
  if (run.status === 'passed') {
    say('It passed its checks. Keeping it puts it in the live home.')
    actions.append(button('Keep', 'primary', 'keep'), button('Not this', 'quiet', 'decline'))
  } else if (run.status === 'kept') {
    say(['Kept. It is in the live home now.', run.here ? 'Go back to the home to see it.' : null, 'You can close this page, or undo it here.'].filter(Boolean).join(' '))
    actions.append(button('Undo', 'quiet', 'undo'))
  } else if (run.status === 'undone') say("Undone. It's out of the live home again, and everything it changed is back as it was. You can close this page.")
  else if (run.status === 'declined') say('Turned down. Nothing changed. You can close this page.')
  else if (run.status === 'running') say('The Elder is still making it. This page will show it when it is done.')
  else say(run.reason ?? "It didn't pass its checks, so there is nothing to keep.")
  $('how').hidden = !actions.querySelector('button')
  setDisabled()
}

async function press(act) {
  if (!run || busy) return
  busy = true
  setDisabled()
  say(null, true)
  const body = act === 'keep' ? { candidate: run.id } : act === 'undo' ? { promotion: run.promotion } : {}
  try {
    const res = await api(`${runPath()}/${act}`, body)
    const data = await res.json().catch(() => ({}))
    if (data.run) run = data.run
    if (!res.ok) say(data.message ?? 'That did not work. Nothing changed.', true)
  } catch {
    say("I can't reach the house just now. Nothing changed.", true)
  } finally {
    busy = false
    render()
    arm()
  }
}

async function load() {
  if (!runId || !RUN_ID.test(runId)) return render(), say('This page needs a change to look at. Open it from the Elder’s card in the home.')
  const who = await api('/session').catch(() => null)
  if (!who || who.status === 401) return say('This device is not paired. Open your pairing link in the home first, then the Elder’s card.')
  if (!who.ok) return say("I can't reach the house just now.")
  const session = await who.json()
  person = session.person
  const res = await api(runPath()).catch(() => null)
  if (!res?.ok) return render(), say(res?.status === 403 ? 'Only the people who look after the house can keep a change.' : "I can't find that change.")
  run = (await res.json()).run
  // The host knows whose home asked, not who typed it: a kept plugin can start a run in that person's name.
  $('who').textContent = `Asked from ${session.name ?? person}'s home. If you didn't ask for this, choose Not this.`
  render()
  arm()
  // A run still being made: look again until it is done.
  if (run.status === 'running') setTimeout(load, 1500)
}
void load()
