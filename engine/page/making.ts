// What the page does with a wish (#244): sends it (ask.ts) and shows how it goes at the place in the world
// where the thing will stand. The ask bar gives wishes to this; so can anything else.
import type { Ask, Asker, Done, Stage } from './ask.ts'
import type { Hud } from './hud.ts'

/** A few words for what was asked, for a label. */
const called = (ask: Ask) => (ask.wish ? (ask.wish.length > 40 ? `${ask.wish.slice(0, 38)}…` : ask.wish) : ask.picture ? 'what the picture shows' : 'what the link shows')

export interface Making {
  /** Has a thing made. Resolves to how it ended; never throws. */
  (ask: Ask): Promise<Done>
  /** Hears every stage of every ask, with the ask: for what covers the wait in the world. */
  on(each: (stage: Stage, ask: Ask) => void): () => void
}

export function making(hud: Hud, asker: Asker): Making {
  const told = new Set<(stage: Stage, ask: Ask) => void>()
  const make = async (ask: Ask) => {
    const what = called(ask)
    let at: [number, number, number] | null = null, name = what
    // Beside the place once it is known; until then (a second or so) a notice says it was heard.
    const cue = hud.cue(`Making ${what}`, () => at)
    let heard = false
    const each = (stage: Stage) => {
      for (const one of told) one(stage, ask)
      if (stage.stage === 'waiting') hud.notice(`${what}: after ${stage.ahead === 1 ? 'the one being made' : `the ${stage.ahead} before it`}`)
      else if (stage.stage === 'reading') { cue.text = 'Reading the link'; if (!heard) hud.notice('Reading the link', 2500); heard = true }
      else if (stage.stage === 'note') hud.notice(stage.why[0].toUpperCase() + stage.why.slice(1), 5000)
      else if (stage.stage === 'place') { at = [stage.at[0], stage.at[1] + 12, stage.at[2]]; cue.text = `Making ${name}` }
      else if (stage.stage === 'asking' && stage.try > 1) cue.text = `Making ${what}: another go`
      else if (stage.stage === 'shaped' || stage.stage === 'known') cue.text = name = stage.name
      else if (stage.stage === 'sending') { at = [stage.at[0], stage.at[1] + stage.size[1] + 4, stage.at[2]]; cue.text = stage.name }
    }
    let done = await asker.ask(ask, each)
    // It is made and no place near there would take it. It is the asker's to say where: there, with what is in the
    // way cleared; where they look next; or not at all. Asked until it stands or is let go.
    while (done.state === 'held') {
      cue.text = `${name}: something is in the way`
      const pick = await hud.choose(`Your ${name} is ready, and something is in the way there.`, ['Clear the space for it', 'Put it where I am looking', 'Let it go'])
      if (pick !== 0 && pick !== 1) { done = { stage: 'done', state: 'refused', why: 'let go' }; for (const one of told) one(done, ask); break }
      done = await asker.put(done, { clear: pick === 0 }, each)
    }
    // Made, the thing says it for itself. Not made, the place says why for a while, in a few words.
    if (done.state === 'there') {
      cue.remove()
      if (done.moved && done.moved > 8) hud.notice(`That spot was taken: your ${name} is ${(done.moved / 10).toFixed(0)} m from it`, 5000)
    } else if (done.why === 'let go') cue.remove()
    else {
      // The reason as far as its first stop: the rest is for the model that was asked again, and is in the console.
      const why = (done.why ?? done.state).split(/: |\. /)[0].slice(0, 90)
      console.info(`not made: ${done.why ?? done.state}`)
      cue.text = `Not made: ${why}`
      setTimeout(() => cue.remove(), 7000)
      // Said as a notice only when there is no place to say it at.
      if (!at) hud.notice(`Not made: ${why}`, 7000)
    }
    return done
  }
  return Object.assign(make, { on: (each: (stage: Stage, ask: Ask) => void) => { told.add(each); return () => told.delete(each) } })
}
