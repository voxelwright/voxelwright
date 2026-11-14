// What the page does with a wish (#244): sends it (ask.ts) and shows how it goes at the place in the world
// where the thing will stand. The ask bar gives wishes to this; so can anything else.
import type { Ask, Asker, Done, Stage } from './ask.ts'
import type { Hud } from './hud.ts'

/** A few words for what was asked, for a label. */
const called = (ask: Ask) => (ask.wish ? (ask.wish.length > 40 ? `${ask.wish.slice(0, 38)}…` : ask.wish) : ask.picture ? 'what the picture shows' : 'what the link shows')

export interface Making {
  /**
   * Has what was asked for made. Words decide what it is: a realm ("create a realm called ..."), something that
   * happens (people, a game, a power: a rule), or a thing. `thing:` or `rule:` before the words says which.
   * Resolves to how it ended; never throws.
   */
  (ask: Ask): Promise<Done>
  /** Hears every stage of every ask, with the ask: for what covers the wait in the world. */
  on(each: (stage: Stage, ask: Ask) => void): () => void
}

export function making(hud: Hud, asker: Asker, eye: () => { eye: [number, number, number]; toward: [number, number, number] }): Making {
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
  /** Where what happens will be: on the ground a few metres ahead of the eye, as far as the page can tell. */
  const ahead = (): [number, number, number] => { const e = eye(), flat = Math.hypot(e.toward[0], e.toward[2]) || 1; return [Math.round(e.eye[0] + (e.toward[0] / flat) * 50), Math.round(e.eye[1] - 17), Math.round(e.eye[2] + (e.toward[2] / flat) * 50)] }
  /** What a rule could not do is the engine's to-do list: it is in the console, and the asker is told there was something. */
  const lacked = (done: Done) => { if (done.cannot?.length) { console.info(`could not, with what the engine offers:\n${done.cannot.map((c) => `  ${c}`).join('\n')}`); hud.notice(done.cannot.length === 1 ? 'One thing it could not do yet' : `${done.cannot.length} things it could not do yet`, 5000) } }
  /** Something that happens (#264): the asker's model writes a rule, it is tried, and put into this world. */
  const happen = async (wish: string): Promise<Done> => {
    const ask: Ask = { wish }, at = ahead()
    const cue = hud.cue('Bringing it to life', () => [at[0], at[1] + 22, at[2]])
    const each = (stage: Stage) => { for (const one of told) one(stage, ask); if (stage.stage === 'trying') cue.text = `${stage.name}: trying it out`; else if (stage.stage === 'writing' && stage.try > 1) cue.text = 'Bringing it to life: another go' }
    // The same gathering as for a thing covers the wait, at the place ahead.
    each({ stage: 'place', at, facing: 'south' })
    const done = await asker.rule(wish, {}, each)
    if (done.state === 'there') { cue.remove(); hud.notice(done.rough ? `${done.name}: here, a little rough` : `${done.name}`, 5000); lacked(done) } else { cue.text = `Not this time: ${(done.why ?? '').split(/: |\. /)[0].slice(0, 80)}`; setTimeout(() => cue.remove(), 7000) }
    return done
  }
  /** A realm (#264): fleshed out first, with a few questions if the asker wants them; then made, its rules written; then stepped into. */
  const realm = async (idea: string): Promise<Done> => {
    const none = (why: string): Done => ({ stage: 'done', state: 'refused', why })
    const how = await hud.choose('A new realm. Shall I ask you a few things first?', ['Make it now', 'Ask me first', 'Never mind'])
    if (how !== 0 && how !== 1) return none('let go')
    hud.notice('Imagining it', 6000)
    const plan = await asker.imagine(idea)
    if (!plan) { hud.notice('The helper could not imagine it: is it running?', 7000); return none('not imagined') }
    const answers: { ask: string; answer: string }[] = []
    if (how === 1) for (const q of plan.questions) { const pick = await hud.choose(q.ask, [...q.options, 'You decide']); if (pick >= 0 && pick < q.options.length) answers.push({ ask: q.ask, answer: q.options[pick] }) }
    const ask: Ask = { wish: idea }, at = ahead()
    const cue = hud.cue(`${plan.name}: making the realm`, () => [at[0], at[1] + 22, at[2]])
    const each = (stage: Stage) => { for (const one of told) one(stage, ask); if (stage.stage === 'realm') cue.text = `${plan.name}: writing its rules`; else if (stage.stage === 'trying') cue.text = `${plan.name}: trying them out` }
    each({ stage: 'place', at, facing: 'south' })
    const done = await asker.realm({ name: plan.name, about: plan.about, look: plan.look, answers }, each)
    cue.remove()
    if (done.state !== 'there' || !done.realm) { hud.notice(`Not made: ${(done.why ?? '').split(/: |\. /)[0].slice(0, 80)}`, 7000); return done }
    lacked(done)
    // Until there is a portal to step through (the REALMS lane), stepping in opens the realm in place of this world.
    const step = await hud.choose(`${plan.name} is ready${done.rough ? ', though its rules are not written yet' : ''}.`, ['Step in', 'Stay here'])
    if (step === 0) { const to = new URLSearchParams(location.search); to.set('realm', done.realm); to.delete('shared'); location.assign(`${location.pathname}?${to}`) }
    return done
  }
  /** What the words ask for. Uncertain, it is a thing: that is what the bar has always made. */
  const kind = (text: string): 'realm' | 'rule' | 'thing' | 'said' => {
    if (/^thing:/i.test(text)) return 'thing'
    if (/^(rule|play):/i.test(text)) return 'rule'
    if (/\brealm\b/i.test(text) && /^\s*(please\s+)?(create|make|new|start|open|build|imagine)\b/i.test(text)) return 'realm'
    // Something that happens: people who do things, a game, a power.
    if (/\b(a game of|whenever|when (someone|somebody|anyone|i|you|they|we)\b|who (plays|sells|follows|comes|says|answers|chases|runs|walks|dances|sings|waves|greets|tells|asks|fights|sits|stands|waits)|let me|make me|make (them|everyone)|give (them|everyone)|everyone (should|must|will|is)|slow time|i can (now )?)\b/i.test(text)) return 'rule'
    // What is said to whoever is there: a question, a greeting, or words that begin as talk does ("I am ...", "you
    // ...", "yes"). Nobody wants a thing called "what is this place?". ("I want a red car" is still a wish.)
    if (hud.line.onsubmit && !/^i (want|wish|would like|need)\b/i.test(text) && (/\?\s*$/.test(text) || /^(hello|hi|hey|good (morning|evening|afternoon|day)|i|i'm|im|you|we|they|he|she|it|it's|this|that|yes|no|ok|okay|thanks|thank you|please|sorry|where|who|what|why|how|do|does|did|is|are|can|could|will|would|stop|come|go|follow|wait|run)\b/i.test(text))) return 'said'
    return 'thing'
  }
  const thing = make
  const asked = (ask: Ask): Promise<Done> => {
    // A picture or a link is of a thing. Words alone say what they are.
    if (ask.picture || ask.link || !ask.wish) return thing(ask)
    const what = kind(ask.wish), words = ask.wish.replace(/^(thing|rule|play):\s*/i, '')
    if (what === 'said') { hud.line.onsubmit?.(words); return Promise.resolve({ stage: 'done', state: 'refused', why: 'said' }) }
    return what === 'realm' ? realm(words) : what === 'rule' ? happen(words) : thing({ ...ask, wish: words })
  }
  return Object.assign(asked, { on: (each: (stage: Stage, ask: Ask) => void) => { told.add(each); return () => told.delete(each) } })
}
