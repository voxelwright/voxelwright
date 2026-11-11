// The script that runs inside the interpreter before a mechanic's own code (#106): it makes the
// objects ./contract.ts describes and `__tick`, the one function the worker calls. It shares the
// interpreter with the mechanic, which can replace any of it, so nothing here is a guard: what
// `__tick` returns is the mechanic's answer, checked on the page like any other data.
//
// __tick(json) takes one view and returns one answer, both JSON text:
//   view   { h, clock, gravity, things, places?, gadgets: [{ id, knobs, state, surface?, part?, events }] }
//   answer { commands: [...], states: { [gadget id]: { name: number } } }
// An event is ['touch', touch] or ['receive', port, signal]. `places` comes only when it changed.
export const PRELUDE = `
(() => {
  'use strict'
  let commands = []
  let places = {}
  const w = {
    h: 0, clock: 0, gravity: [0, 0, 0], things: [], places,
    push(key, impulse) { commands.push(['push', key, impulse]) },
    setVelocity(key, velocity) { commands.push(['velocity', key, velocity]) },
    moveTo(key, position, velocity) { commands.push(['move', key, position, velocity]) },
  }
  globalThis.__tick = (json) => {
    const view = JSON.parse(json)
    commands = []
    if (view.places) places = view.places
    w.h = view.h
    w.clock = view.clock
    w.gravity = view.gravity
    w.things = view.things
    w.places = places
    const byKey = new Map()
    for (const t of view.things) byKey.set(t.key, t)
    const states = {}
    for (const v of view.gadgets) {
      const g = {
        knobs: v.knobs, state: v.state, surface: v.surface, part: v.part && (byKey.get(v.part.key) || v.part),
        fire(port, value, thing) { commands.push(['fire', v.id, port, value, thing]) },
        show(text) { commands.push(['show', v.id, text]) },
      }
      for (const e of v.events) {
        if (e[0] === 'touch' && typeof touch === 'function') touch(g, e[1], w)
        else if (e[0] === 'receive' && typeof receive === 'function') receive(g, e[1], e[2], w)
      }
      if (typeof step === 'function') step(g, w)
      states[v.id] = g.state
    }
    return JSON.stringify({ commands, states })
  }
  globalThis.__hooks = () => JSON.stringify([typeof step === 'function' && 'step', typeof touch === 'function' && 'touch', typeof receive === 'function' && 'receive'].filter(Boolean))
})()
`
