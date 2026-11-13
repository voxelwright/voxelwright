// Everyone else in a shared world (#218): each person at a page and each agent in a seat is the
// one figure (people.ts), where the world says they are, facing as they face, with their name over
// their head and what they say under it for a few seconds. This page says where its own eyes are
// ten times a second, under the name it was given (`?name=`, else the one it used last, else a
// guest's), and Enter opens a line to say something. Names and words are text that whoever is
// there typed: they are drawn as letters and listed, and nothing here acts on them.
import type { Link, Someone } from './link.ts'
import type { People, Person } from './people.ts'
import { STRIDE } from './people.ts'

interface Other { who: Someone; shown: [number, number, number]; yaw: number; stride: number; walking: number; down: number; flinch: number; heard: number; says: string; until: number }

/** A number of its own for a name, so that a name always looks the same person. */
const seedOf = (name: string) => { let h = 2166136261; for (const ch of name) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return h | 0 }

export function presence(far: Link, folk: People, eye: () => { at: [number, number, number]; yaw: number }): { readonly count: number; readonly name: string; say(text: string): void } {
  const asked = new URLSearchParams(location.search).get('name')
  let kept = ''
  try { kept = localStorage.getItem('village.name') ?? '' } catch { /* a page that may keep nothing */ }
  const name = (asked || kept || `guest ${far.me.slice(0, 3)}`).slice(0, 24)
  try { if (asked) localStorage.setItem('village.name', name) } catch { /* the same */ }
  const others = new Map<string, Other>()
  far.onhere = (who) => {
    if (who.gone) { others.delete(who.by); return }
    const o = others.get(who.by)
    if (o) { o.who = who; o.heard = performance.now() }
    else others.set(who.by, { who, shown: [...who.at], yaw: who.yaw, stride: 0, walking: 0, down: 0, flinch: 0, heard: performance.now(), says: '', until: 0 })
  }
  setInterval(() => { const e = eye(); far.here(e.at, e.yaw, name) }, 100)

  // What was said lately, listed in a corner; and the line to say something on.
  const said = document.createElement('div'), line = document.createElement('input')
  said.style.cssText = 'position:fixed;left:max(10px,env(safe-area-inset-left));bottom:64px;max-width:min(420px,70vw);padding:6px 10px;border-radius:8px;background:rgba(12,16,22,0.6);pointer-events:none;display:none;white-space:pre-wrap;overflow-wrap:anywhere'
  line.style.cssText = 'position:fixed;left:50%;bottom:64px;transform:translateX(-50%);width:min(520px,80vw);padding:9px 12px;border-radius:10px;border:0;outline:0;background:rgba(244,244,240,0.96);color:#14181d;font:500 15px -apple-system,system-ui,sans-serif;display:none;user-select:text;-webkit-user-select:text'
  line.maxLength = 200
  line.placeholder = `Say something as ${name}`
  line.setAttribute('aria-label', 'Say something to everyone near you')
  document.body.append(said, line)
  const lines: string[] = []
  far.onsaid = (v) => {
    // A voice carries thirty metres (world.mjs EARSHOT): further off it is not heard here, whoever said it.
    const e = eye().at
    if (Math.hypot(v.at[0] - e[0], v.at[1] - e[1], v.at[2] - e[2]) > 300 + 20) return
    const o = others.get(v.by)
    if (o) { o.says = v.text; o.until = performance.now() + Math.max(5000, v.text.length * 90) }
    lines.push(`${v.name}: ${v.text}`)
    if (lines.length > 5) lines.shift()
    said.textContent = lines.join('\n')
    said.style.display = 'block'
  }
  const say = (text: string) => { if (text.trim()) far.say(name, text.trim()) }
  // Enter opens the line and sends it; Escape puts it away. While it is open the keys are letters, not steps.
  addEventListener('keydown', (e) => {
    if (e.target === line) {
      e.stopPropagation()
      if (e.key === 'Enter') { say(line.value); line.value = ''; line.style.display = 'none'; line.blur() }
      else if (e.key === 'Escape') { line.value = ''; line.style.display = 'none'; line.blur() }
    } else if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey) {
      e.stopPropagation(); e.preventDefault()
      document.exitPointerLock?.()
      line.style.display = 'block'
      line.focus()
    }
  }, true)
  addEventListener('keyup', (e) => { if (e.target === line) e.stopPropagation() }, true)

  const shown: Person[] = []
  let last = performance.now()
  folk.from.push((_view, seconds) => {
    const now = performance.now(), dt = Math.min(0.1, (now - last) / 1000), ease = 1 - Math.exp(-dt * 12)
    last = now
    shown.length = 0
    for (const [by, o] of others) {
      // A page says where it is ten times a second and a seat at least once: unheard of for five, they have gone.
      if (now - o.heard > 5000) { others.delete(by); continue }
      // Between one telling and the next the figure goes smoothly to where it was last said to be.
      let moved = 0
      for (let a = 0; a < 3; a++) { const step = (o.who.at[a] - o.shown[a]) * ease; o.shown[a] += step; if (a !== 1) moved = Math.hypot(moved, step) }
      let turn = o.who.yaw - o.yaw
      turn -= Math.round(turn / (Math.PI * 2)) * Math.PI * 2
      o.yaw += turn * ease
      o.stride += moved / STRIDE
      // It walks when it is moving along the ground at about a walk, whoever moves it.
      const pace = dt > 0 ? moved / dt : 0
      o.walking += ((pace > 3 && pace < 60 ? 1 : 0) - o.walking) * Math.min(1, dt * 8)
      o.down += ((o.who.down ? 1 : 0) - o.down) * Math.min(1, dt * (o.who.down ? 7 : 2.2))
      o.flinch += ((o.who.flinch ? 1 : 0) - o.flinch) * Math.min(1, dt * (o.who.flinch ? 14 : 3))
      shown.push({ at: o.shown, yaw: o.yaw, seed: seedOf(o.who.name), stride: o.stride, walking: o.walking, down: o.down, flinch: o.flinch, time: seconds, name: o.who.name, says: now < o.until ? o.says : '' })
    }
    return shown
  })
  return { get count() { return others.size }, name, say }
}
