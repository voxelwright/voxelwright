// ?babble=demo (dev only): a scripted exchange between the three felt villagers,
// announced with `village/said` at talk.ts's reveal pace, so the voices can be
// heard and recorded without a model or talk.ts. The lines are our own.
import type { Context } from 'cordis'
import { TYPE_RATE } from './text'
import type { Said } from './engine'

export const SCRIPT: { villager: string; text: string }[] = [
  { villager: 'Dumpling', text: 'Oh! Hello there. The soup can mind itself for a minute.' },
  { villager: 'Tuft', text: 'Hi hi! I found THREE socks under the sofa. Want to see them?' },
  { villager: 'Moss', text: 'The basil by the window has a new leaf… I thought you would like to know.' },
  { villager: 'Dumpling', text: 'A new leaf! Shall I add bread to the list, then?' },
  { villager: 'Tuft', text: 'Bread, butter, and crayons. Done!' },
  { villager: 'Moss', text: 'Mind the watering can, everyone. It is a little full.' },
  { villager: 'Dumpling', text: 'Who wants soup?' },
]

/** Pause between speakers, as the table passes the turn. */
const TURN = 1.4

/** Each word with the second it appears: a word shows once the reveal passes the space after it. */
export function timeline(script = SCRIPT, rate = TYPE_RATE): { t: number; e: Said }[] {
  const out: { t: number; e: Said }[] = []
  let t = 0.4
  for (const line of script) {
    const words = line.text.split(/\s+/)
    let chars = 0
    words.forEach((word, index) => {
      chars += word.length
      out.push({ t: t + chars / rate, e: { villager: line.villager, word, index, last: index === words.length - 1 } })
      chars += 1
    })
    t += line.text.length / rate + TURN
  }
  return out
}

const COLOURS: Record<string, string> = { Dumpling: '#c4503a', Tuft: '#d29a26', Moss: '#7a5aa8' }

export function runDemo(ctx: Context) {
  const cover = document.createElement('div')
  cover.className = 'babble-demo-cover'
  cover.textContent = 'Click to hear the villagers'
  const card = document.createElement('div')
  card.className = 'babble-demo-card'
  const name = document.createElement('b')
  const words = document.createElement('p')
  card.append(name, words)
  card.hidden = true
  const style = document.createElement('style')
  style.textContent = `
.babble-demo-cover { position: fixed; inset: 0; z-index: 50; background: #000; color: #222; display: grid; place-items: center; font: 14px system-ui; cursor: pointer; }
.babble-demo-card { position: fixed; left: 50%; bottom: 72px; transform: translateX(-50%); z-index: 40; width: min(520px, calc(100vw - 32px));
  background: #fbf5e8; border-radius: 14px; padding: 14px 20px 16px; box-shadow: 0 6px 18px rgba(50, 30, 10, .25);
  outline: 1.5px dashed rgba(120, 90, 60, .4); outline-offset: -7px; font: 19px/1.45 "Iowan Old Style", Palatino, Georgia, serif; color: #3a2a1c; }
.babble-demo-card b { display: inline-block; margin-bottom: 4px; padding: 2px 10px; border-radius: 8px; color: #fff; background: var(--c); font: 600 14px system-ui; }
.babble-demo-card p { margin: 0; min-height: 2.9em; }`
  const log: { t: number; e: Said }[] = []
  const timers: number[] = []
  const state = { t0: 0, log, done: false }

  const play = () => {
    cover.remove()
    state.t0 = performance.now()
    const events = timeline()
    events.forEach(({ t, e }, i) => {
      timers.push(window.setTimeout(() => {
        if (e.index === 0) {
          name.textContent = e.villager
          card.style.setProperty('--c', COLOURS[e.villager])
          words.textContent = ''
          card.hidden = false
        }
        words.textContent += (e.index ? ' ' : '') + e.word
        log.push({ t: (performance.now() - state.t0) / 1000, e })
        ctx.emit('village/said', e)
        if (i === events.length - 1) state.done = true
      }, t * 1000))
    })
  }
  ctx.effect(() => {
    document.head.append(style)
    document.body.append(cover, card)
    cover.addEventListener('click', play, { once: true })
    Object.assign(window, { babbleDemo: state })
    return () => {
      for (const id of timers) clearTimeout(id)
      cover.remove()
      card.remove()
      style.remove()
      delete (window as { babbleDemo?: unknown }).babbleDemo
    }
  }, 'babble demo')
}
