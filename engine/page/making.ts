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
  /** Has a thing made, whatever the words: for what knows it is a thing that is wanted (a rule that asked for one, `plugins/make`). */
  thing(ask: Ask): Promise<Done>
  /** Hears every stage of every ask, with the ask: for what covers the wait in the world. */
  on(each: (stage: Stage, ask: Ask) => void): () => void
}

export function making(hud: Hud, asker: Asker, eye: () => { eye: [number, number, number]; toward: [number, number, number] }, /** How one steps into a realm that was made (#264, the REALMS lane: a portal opens to it). Without it, the page is opened in that realm. */ into?: (realm: string) => void, /** Asks again for a realm's idea when none was given (the line to type on, with the words begun). */ again?: () => void): Making {
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
    // Words that say only that a realm is wanted, and nothing of what it is: asked for, not made up.
    if (!idea.replace(/\b(please|create|make|new|start|open|build|imagine|a|an|the|realm|called|named|me|us)\b/gi, '').replace(/[^\p{L}\p{N}]+/gu, '')) { hud.notice('Say what the realm is: a name, a place, what happens there', 6000); again?.(); return none('nothing was said of it') }
    const how = await hud.choose('A new realm. Shall I ask you a few things first?', ['Make it now', 'Ask me first', 'Never mind'])
    if (how !== 0 && how !== 1) return none('let go')
    hud.notice('Imagining it', 6000)
    const plan = await asker.imagine(idea)
    if (!plan) { hud.notice('The helper could not imagine it: is it running?', 7000); return none('not imagined') }
    const answers: { ask: string; answer: string }[] = []
    if (how === 1) for (const q of plan.questions) { const pick = await hud.choose(q.ask, [...q.options, 'You decide']); if (pick >= 0 && pick < q.options.length) answers.push({ ask: q.ask, answer: q.options[pick] }) }
    // A director (#264): whether the realm is to have one is asked here, kept in its record, and changed at any time after (the button, or "director off").
    const directed = (await hud.choose('With a director? It watches how you play and stirs things up for you.', ['With a director', 'Without'])) === 0
    const ask: Ask = { wish: idea }, at = ahead()
    const cue = hud.cue(`${plan.name}: making the realm`, () => [at[0], at[1] + 22, at[2]])
    const each = (stage: Stage) => { for (const one of told) one(stage, ask); if (stage.stage === 'realm') cue.text = `${plan.name}: writing its rules`; else if (stage.stage === 'trying') cue.text = `${plan.name}: trying them out` }
    each({ stage: 'place', at, facing: 'south' })
    const done = await asker.realm({ name: plan.name, about: plan.about, look: plan.look, place: plan.place, answers, director: directed }, each)
    cue.remove()
    if (done.state !== 'there' || !done.realm) { hud.notice(`Not made: ${(done.why ?? '').split(/: |\. /)[0].slice(0, 80)}`, 7000); return done }
    lacked(done)
    const step = await hud.choose(`${plan.name} is ready${done.rough ? ', though its rules are not written yet' : done.more ? '. It will grow fuller as you play' : ''}${directed && !done.rough ? '. Its director is being written and will join you' : ''}.`, ['Step in', 'Stay here'])
    if (step === 0) { if (into) into(done.realm); else { const to = new URLSearchParams(location.search); to.set('realm', done.realm); to.delete('shared'); location.assign(`${location.pathname}?${to}`) } }
    return done
  }
  /** The world this page is in, as its server names it. */
  const base = () => { const r = new URLSearchParams(location.search).get('realm'); return r ? `/realm/${encodeURIComponent(r)}/world` : '/world' }
  /**
   * The realm's director (#264): turned on and off here at any time (the realm's record keeps it, and the world
   * puts its director to rest or wakes it: no model is asked), written by the asker's own model when there is
   * none yet, and changed by what is said after the word ("director: more trouble, fewer strangers").
   */
  const director = async (words: string): Promise<Done> => {
    const more = words.replace(/^\s*(the\s+)?director\b[:,]?\s*/i, '').trim()
    const set = async (on: boolean): Promise<Done> => {
      let ok = false
      try { ok = (await fetch(`${base()}/ask`, { method: 'POST', body: JSON.stringify({ by: 'someone', realm: { director: on } }) })).ok } catch { /* said below */ }
      hud.notice(!ok ? 'The director could not be told' : on ? 'The director is watching' : 'The director rests', 5000)
      void shown()
      return { stage: 'done', state: ok ? 'there' : 'refused' }
    }
    if (/^(off|rest|stop|quiet|no|none|away)\b/i.test(more)) return set(false)
    const plain = !more || /^(on|start|wake|yes|back)\b/i.test(more)
    let there = false
    try { there = (await fetch(`${base()}/rules?id=director`)).ok } catch { /* none, as far as can be told */ }
    if (there && plain) return set(true)
    const ask: Ask = { wish: words }, at = ahead()
    const cue = hud.cue(there ? 'The director is taking that in' : 'A director is being written for this place', () => [at[0], at[1] + 22, at[2]])
    const each = (stage: Stage) => { for (const one of told) one(stage, ask); if (stage.stage === 'trying') cue.text = 'The director: trying it out' }
    const done = await asker.rule(plain ? '' : more, { director: true }, each)
    if (done.state === 'there') { cue.remove(); hud.notice(done.rough ? 'The director is here, a little rough' : 'The director is watching', 5000); lacked(done) } else { cue.text = `Not this time: ${(done.why ?? '').split(/: |\. /)[0].slice(0, 80)}`; setTimeout(() => cue.remove(), 7000) }
    void shown()
    return done
  }
  /** A button that says whether this place has its director on, and turns it on and off. Asked of the world every few seconds: the page steps between realms, and anyone there may change it. */
  const button = document.createElement('button'), holder = hud.panel('director')
  holder.style.cssText = 'position:absolute;right:16px;top:160px;pointer-events:auto'
  button.type = 'button'; button.hidden = true; button.title = 'The director watches how you play and stirs things up: turn it on or off'
  button.style.cssText = 'font:600 14px system-ui;padding:10px 14px;border-radius:999px;border:0;background:rgba(20,22,28,.72);color:#fff'
  let directing = false
  const shown = async () => {
    try { const r = await fetch(`${base()}/realm`); if (!r.ok) return; directing = (await r.json()).director === true; button.hidden = false; button.textContent = directing ? 'Director on' : 'Director off'; button.style.opacity = directing ? '1' : '0.6' } catch { /* a page with no shared world has no button */ }
  }
  button.onclick = () => void director(directing ? 'director off' : 'director on')
  holder.append(button)
  if (new URLSearchParams(location.search).has('shared') || new URLSearchParams(location.search).has('realm')) { void shown(); setInterval(() => void shown(), 5000) }
  /** Whether the world this page is in has rules: people who may hear what is said and act on it. Asked of the world, and remembered a few seconds. */
  let ruledAt = 0, ruledSo = false
  const ruled = async (): Promise<boolean> => {
    if (performance.now() - ruledAt < 4000) return ruledSo
    const realm = new URLSearchParams(location.search).get('realm')
    try { const r = await fetch(realm ? `/realm/${encodeURIComponent(realm)}/world/rules` : '/world/rules'); const list = r.ok ? await r.json() : []; ruledSo = Array.isArray(list) && list.some((x) => x.running) } catch { ruledSo = false }
    ruledAt = performance.now()
    return ruledSo
  }
  /**
   * What the words ask for. In a world that has rules, what is typed is said: the world's own people hear it and
   * may act at once ("I want to fly", "slow time", "I know kung fu" are for the realm to answer, never things to
   * make). It goes to a maker only when the words plainly ask for one: a thing ("make a ...", "conjure ...",
   * "a red door"), or a change to how the world goes ("add ...", "change ...", "from now on ...", "let me ...").
   * In a world with no rules there is nobody to hear a power asked for, so those words ask for a rule.
   */
  const kind = (text: string, rules: boolean): 'realm' | 'rule' | 'thing' | 'said' | 'director' => {
    if (/^\s*(the\s+)?director\b\s*(:|,|$|(on|off|rest|stop|quiet|start|wake|back|away)\b)/i.test(text)) return 'director'
    if (/^thing:/i.test(text)) return 'thing'
    if (/^(rule|play):/i.test(text)) return 'rule'
    if (/^(say|said):/i.test(text)) return 'said'
    if (/\brealm\b/i.test(text) && /^\s*(please\s+)?(create|make|new|start|open|build|imagine)\b/i.test(text)) return 'realm'
    // A change to how the world goes, asked for as one.
    const change = /^\s*(please\s+)?(add|change|from now on|make (them|everyone|people|him|her|it so)|give (them|everyone|him|her)|let (there|them|everyone)|everyone (should|must|will)|whenever|when (someone|somebody|anyone)|a game of)\b/i.test(text) || /\bwho (plays|sells|follows|comes|says|answers|chases|runs|walks|dances|sings|waves|greets|tells|asks|fights|sits|stands|waits)\b/i.test(text)
    if (change) return 'rule'
    // A thing, asked for as one: a verb of making and what to make, or the thing named with its article.
    const made = /^\s*(please\s+)?((make|build|conjure|create|spawn|summon|put|place|give me|i want|i need|i wish for|i would like)\s+(me\s+)?(a|an|the|some|two|three|four|five|\d+)\s|(a|an|some|two|three)\s+\S)/i.test(text)
    // A power asked for in the asker's own words: for the realm's rule to hear. Where there are no rules, for a rule to be written.
    const power = /^\s*(i want to|i wanna|i wish to|i would like to|let me|make me|i can|i know|i am|i'm|slow|stop time|freeze|speed up)\b/i.test(text)
    if (power) return rules ? 'said' : /^\s*(i am|i'm|i know)\b/i.test(text) ? 'said' : 'rule'
    // Asked of someone, not of a maker ("give me a sword", "I need guns", "I want a horse"): in a world with rules it is for the rules to hear and answer, in the hand if they will; a sword stood in the street by the page's own maker is not what was meant (seen November 14). Only plain making words go to the maker there.
    if (rules && /^\s*(please\s+)?(give me|hand me|get me|bring me|i want|i need|i wish for|i would like|i'd like|can i have|could i have|may i have)\b/i.test(text)) return 'said'
    if (made) return 'thing'
    // Nothing plain: in a world with rules it is said; elsewhere talk is said and the rest is a thing, as the bar has always made.
    if (rules) return 'said'
    return /\?\s*$/.test(text) || /^(hello|hi|hey|good (morning|evening|afternoon|day)|you|we|they|he|she|it|it's|this|that|yes|no|ok|okay|thanks|thank you|please|sorry|where|who|what|why|how|do|does|did|is|are|can|could|will|would|stop|come|go|follow|wait|run)\b/i.test(text) ? 'said' : 'thing'
  }
  const thing = make
  const asked = async (ask: Ask): Promise<Done> => {
    // A picture or a link is of a thing. Words alone say what they are.
    if (ask.picture || ask.link || !ask.wish) return thing(ask)
    const what = kind(ask.wish, await ruled()), words = ask.wish.replace(/^(thing|rule|play|say|said):\s*/i, '')
    // Said, with nobody's line to say it on (a world that is not shared): there is nothing to hear it, so it is a thing after all.
    if (what === 'said') { if (hud.line.onsubmit) { hud.line.onsubmit(words); return { stage: 'done', state: 'refused', why: 'said' } } return thing({ ...ask, wish: words }) }
    return what === 'realm' ? realm(words) : what === 'director' ? director(words) : what === 'rule' ? happen(words) : thing({ ...ask, wish: words })
  }

  return Object.assign(asked, { thing, director, on: (each: (stage: Stage, ask: Ask) => void) => { told.add(each); return () => told.delete(each) } })
}
