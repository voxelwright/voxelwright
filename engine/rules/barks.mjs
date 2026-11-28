// 0 ms procedural contextual bark & RDR2/GTA 6 Greet/Antagonize social escalation engine (#164).
//
// Trivial street exchanges, micro-reactions (near-misses, horns, masks, stalled PayMo), and
// neighborhood-modulated Greet/Antagonize sequences resolve deterministically in 0 ms at $0 cost,
// while deeper conversations or escalated confrontations set `escalateToMind: true` to hand off
// seamlessly to `engine/mind`.
import { text } from '../text.mjs'

export const NEIGHBORHOOD_TONES = Object.freeze(['aloof', 'friendly', 'hurried', 'cynical', 'defensive'])

const DISTRICT_TONE_MAP = Object.freeze({
  'financial district': 'aloof',
  fidi: 'aloof',
  'pacific heights': 'aloof',
  marina: 'aloof',
  'nob hill': 'aloof',
  mission: 'friendly',
  'noe valley': 'friendly',
  'inner sunset': 'friendly',
  'north beach': 'friendly',
  castro: 'friendly',
  soma: 'hurried',
  'market street': 'hurried',
  'union square': 'hurried',
  embarcadero: 'hurried',
  downtown: 'hurried',
  tenderloin: 'cynical',
  'civic center': 'cynical',
  haight: 'cynical',
  'haight-ashbury': 'cynical',
  dogpatch: 'defensive',
  bayview: 'defensive',
  industrial: 'defensive',
  docks: 'defensive',
})

/** Map a district name (or direct tone name) to one of the 5 neighborhood tone profiles. */
export function districtTone(districtOrTone) {
  const key = text(String(districtOrTone ?? ''), 48).toLowerCase()
  if (NEIGHBORHOOD_TONES.includes(key)) return key
  return DISTRICT_TONE_MAP[key] ?? 'hurried'
}

/** Deterministic integer hash for reproducible line selection. */
function pickDet(list, seed) {
  if (!list.length) return ''
  let h = 2166136261
  const s = String(seed)
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619) >>> 0
  }
  return list[h % list.length]
}

const WEATHER_TAG = {
  rain: {
    aloof: 'Lovely drizzle for ruining a coat.',
    friendly: 'Stay dry out here, yeah?',
    hurried: 'Rain always doubles the commute.',
    cynical: 'Wet sidewalks, slick tempers.',
    defensive: 'Rain hides too much on this block.',
  },
  fog: {
    aloof: 'Karl is back right on schedule.',
    friendly: 'Thick marine layer today, huh?',
    hurried: 'Can barely see the crosswalk in this fog.',
    cynical: 'Fog rolls in and everyone forgets how to walk.',
    defensive: 'Stay where I can see you in this mist.',
  },
  night: {
    aloof: 'Late hour to be lingering.',
    friendly: 'Quiet night on the strip.',
    hurried: 'Trying to catch the last owl bus.',
    cynical: 'Nothing good opens after midnight around here.',
    defensive: 'Keep moving, it is late.',
  },
}

const BARKS = {
  greet_1: {
    aloof: ['Mmm. Good day.', 'Afternoon. Excuse me.', 'Yes? Hello.'],
    friendly: ['Hey there! Good seeing a friendly face.', 'Morning, neighbor! How is it going?', 'Hey! Beautiful day out here.'],
    hurried: ['Hey—sorry, running late.', 'Morning, gotta dash.', 'Hi there, catching the train.'],
    cynical: ['Yeah, yeah, hey.', 'What do you want? Oh, just saying hi.', 'Alright, alright. Hey.'],
    defensive: ['Keep your distance. Evening.', 'Hey. You from around here?', 'Yeah? Make it quick.'],
  },
  greet_2: {
    aloof: ['Well, you certainly have manners. Good day to you.', 'Refreshing to meet someone polite on this avenue.', 'Alright, I appreciate the courtesy.'],
    friendly: ['Haha, I like your energy! Have a great one out there.', 'Always room for a decent chat on this block.', 'You are alright, neighbor—stay well!'],
    hurried: ['Okay, okay, you got a smile out of me. Take care!', 'Appreciate the check-in, really.', 'Thanks—needed a breather anyway.'],
    cynical: ['Huh. Most folks here just stare at their phones. Fair enough.', 'Alright, maybe today is not a total wash.', 'You are persistent—I respect it.'],
    defensive: ['Fair enough, no trouble then. Good day.', 'Alright, you seem square. Watch your step out here.', 'Okay, we are cool. Take it easy.'],
  },
  greet_3: {
    aloof: ['Since you insist on a proper conversation, what is on your mind?', 'You have my attention—speak your piece.'],
    friendly: ['Tell you what, I have a minute—what is the word around town?', 'You seem like you have a story to tell. Go on!'],
    hurried: ['Alright, the bus can wait one minute—what did you want to talk about?', 'Go ahead, you caught me while I am stopped.'],
    cynical: ['Third time is a conversation. Alright, lay it on me.', 'Okay, spill it—what are we actually talking about?'],
    defensive: ['You have been talking a lot. Speak plain—what do you need?', 'Alright, I am listening. Say what you came to say.'],
  },
  antagonize_1: {
    aloof: ['Excuse me? Mind your tone.', 'Do not speak to me like that.', 'How terribly rude. Walk on.'],
    friendly: ['Whoa, hey—no need for that.', 'Easy there, what is eating you?', 'Come on now, keep it civil.'],
    hurried: ['I do not have time for this—move!', 'Watch your mouth and get out of my way.', 'Seriously? Not today.'],
    cynical: ['Yeah, real tough. Keep walking.', 'Save the attitude for somebody who cares.', 'Big talk on a public sidewalk.'],
    defensive: ['Try saying that again and see what happens.', 'Back off. Right now.', 'Watch yourself, friend.'],
  },
  antagonize_2: {
    aloof: ['That is quite enough. Leave me alone or I am calling this in.', 'Step back right now—you are making a scene.'],
    friendly: ['Hey, I warned you! Back off before someone calls the cops.', 'Stop pushing it! I am not looking for trouble.'],
    hurried: ['Get out of my face! Somebody get a cop over here!', 'Touch me and I am dialing dispatch right now.'],
    cynical: ['You really want to start something right here? Think twice.', 'Keep barking and I will make it everyone else\'s problem too.'],
    defensive: ['Last warning—take one more step and we have a problem.', 'You picked the wrong block to test me.'],
  },
  antagonize_3: {
    confront: ['Alright, you asked for it—square up!', 'That is it! I am not backing down from you!'],
    flee: ['Stay away from me! Help!', 'Forget this—I am getting out of here!'],
    report: ['That does it—I am calling the police right now!', 'Hello, dispatch? Somebody is threatening people on the street!'],
  },
  defuse: {
    aloof: ['Hmph. Apology noted. Good day.', 'Very well. Let us both move on.'],
    friendly: ['Hey, no hard feelings! We all have rough mornings.', 'All good, neighbor—breathe easy.'],
    hurried: ['Fine, fine, forget it. Just watch it next time.', 'Yeah, whatever—we are good.'],
    cynical: ['Smart move backing off. Later.', 'Alright, no harm done. Keep moving.'],
    defensive: ['Good choice. Keep walking and we stay square.', 'Alright, cool it then. Move along.'],
  },
  react: {
    holdingWeapon: ['Whoa—put that away! Get back!', 'Hey! They have a weapon! Stay clear!'],
    nearMiss: ['Hey! Watch where you are steering that thing!', 'Whoa! You almost clipped me!'],
    honking: ['Lay off the horn, traffic is not moving any faster!', 'Yeah, we all hear you—relax!'],
    masked: ['Why the mask? Nothing good comes from hiding your face.', 'Keeping a low profile, huh? Stay back.'],
    nearStalledPayMo: ['PayMo is frozen at the light again—classic.', 'Look at that PayMo blinking its hazards at a pigeon.', 'Another stalled PayMo blocking the crosswalk.'],
    running: ['Easy! Watch the shoulder!', 'Must be late for the N-Judah.'],
    holdingObject: ['Where on earth did you get that thing?', 'Huh—did you build that yourself?'],
  },
}

/**
 * Quick social intent classifier for street speech (used by hybrid rules to decide
 * between 0 ms procedural barks and open-ended `engine/mind` calls).
 */
export function classifySocialSpeech(raw) {
  const s = text(String(raw ?? ''), 200).toLowerCase().replace(/[.!?]+$/g, '').trim()
  if (!s) return null
  if (/^(hi|hey|hello|howdy|yo|morning|good morning|afternoon|evening|hey there|sup|greetings)$/.test(s)) return 'greet'
  if (/^(sorry|my bad|excuse me|pardon|pardon me|easy|chill|my mistake|never mind|no trouble)$/.test(s)) return 'defuse'
  if (/^(get lost|shut up|back off|watch it|beat it|move it|out of my way|buzz off|scram|screw you)$/.test(s)) return 'antagonize'
  return null
}

/**
 * Pure 0 ms contextual bark generator (stateless, deterministic).
 */
export function generateBark({
  actorId = 'npc',
  subjectId = 'player',
  district = 'downtown',
  tone = null,
  trust = 0,
  weather = 'clear',
  playerState = {},
  action = 'greet',
  step = 1,
  courage = 0.5,
  seed = 0,
} = {}) {
  const resolvedTone = tone && NEIGHBORHOOD_TONES.includes(tone) ? tone : districtTone(district)
  const key = `${actorId}:${subjectId}:${action}:${step}:${seed}`

  // Priority environmental/player-state micro-reactions when action === 'react' or urgent threat present.
  if (playerState?.holdingWeapon) {
    const outcome = courage >= 0.7 ? 'report' : 'flee'
    return {
      text: pickDet(BARKS.react.holdingWeapon, key),
      tone: resolvedTone,
      mood: 'alarmed',
      moodDelta: -4,
      trustDelta: -3,
      escalateToMind: true,
      outcome,
      step,
      ms: 0,
    }
  }

  if (action === 'react') {
    const triggers = [
      ['nearMiss', 'annoyed', -2, -1, false],
      ['honking', 'annoyed', -1, -1, false],
      ['masked', 'wary', -1, -1, false],
      ['nearStalledPayMo', 'calm', 0, 0, false],
      ['running', 'annoyed', -1, 0, false],
      ['holdingObject', 'calm', 1, 0, false],
    ]
    for (const [flag, mood, moodDelta, trustDelta, escalateToMind] of triggers) {
      if (playerState?.[flag]) {
        return {
          text: pickDet(BARKS.react[flag], key),
          tone: resolvedTone,
          mood,
          moodDelta,
          trustDelta,
          escalateToMind,
          outcome: 'react',
          step: 1,
          ms: 0,
        }
      }
    }
  }

  // Greet / Antagonize / Defuse 3-step social escalation.
  const weatherNote = WEATHER_TAG[weather]?.[resolvedTone] ?? ''
  const appendWeather = (line) => {
    if (!weatherNote || line.length + weatherNote.length + 1 > 195) return line
    return `${line} ${weatherNote}`
  }

  if (action === 'defuse') {
    return {
      text: pickDet(BARKS.defuse[resolvedTone], key),
      tone: resolvedTone,
      mood: 'calm',
      moodDelta: 2,
      trustDelta: 1,
      escalateToMind: false,
      outcome: 'defused',
      step: 1,
      ms: 0,
    }
  }

  if (action === 'antagonize') {
    const s = Math.max(1, Math.min(3, Math.floor(step)))
    if (s === 1) {
      return {
        text: pickDet(BARKS.antagonize_1[resolvedTone], key),
        tone: resolvedTone,
        mood: 'annoyed',
        moodDelta: -2,
        trustDelta: -2,
        escalateToMind: false,
        outcome: 'warn',
        step: 1,
        ms: 0,
      }
    }
    if (s === 2) {
      return {
        text: pickDet(BARKS.antagonize_2[resolvedTone], key),
        tone: resolvedTone,
        mood: 'angry',
        moodDelta: -3,
        trustDelta: -3,
        escalateToMind: true,
        outcome: 'defensive',
        step: 2,
        ms: 0,
      }
    }
    // Step 3: resolve into confront, flee, or report based on neighborhood tone & courage.
    const outcome = (resolvedTone === 'defensive' || courage >= 0.72)
      ? 'confront'
      : (resolvedTone === 'aloof' || resolvedTone === 'hurried' || courage >= 0.4)
        ? 'report'
        : 'flee'
    return {
      text: pickDet(BARKS.antagonize_3[outcome], key),
      tone: resolvedTone,
      mood: outcome === 'flee' ? 'alarmed' : 'angry',
      moodDelta: -4,
      trustDelta: -4,
      escalateToMind: true,
      outcome,
      step: 3,
      ms: 0,
    }
  }

  // Default: 'greet' (modulated by prior trust, mask suspicion, and weather).
  if (playerState?.masked && trust <= 0 && step === 1) {
    return {
      text: pickDet(BARKS.react.masked, key),
      tone: resolvedTone,
      mood: 'wary',
      moodDelta: -1,
      trustDelta: -1,
      escalateToMind: false,
      outcome: 'chat',
      step: 1,
      ms: 0,
    }
  }

  const s = Math.max(1, Math.min(3, Math.floor(step)))
  if (s === 1) {
    const base = pickDet(BARKS.greet_1[resolvedTone], key)
    const spoken = weather !== 'clear' ? appendWeather(base) : base
    const warmStart = trust >= 4
    return {
      text: warmStart ? `${spoken} Good to see you again.` : spoken,
      tone: resolvedTone,
      mood: warmStart ? 'warm' : 'calm',
      moodDelta: 1,
      trustDelta: 1,
      escalateToMind: false,
      outcome: 'chat',
      step: 1,
      ms: 0,
    }
  }
  if (s === 2) {
    return {
      text: pickDet(BARKS.greet_2[resolvedTone], key),
      tone: resolvedTone,
      mood: 'warm',
      moodDelta: 1,
      trustDelta: 2,
      escalateToMind: false,
      outcome: 'warm',
      step: 2,
      ms: 0,
    }
  }
  return {
    text: pickDet(BARKS.greet_3[resolvedTone], key),
    tone: resolvedTone,
    mood: 'warm',
    moodDelta: 1,
    trustDelta: 1,
    escalateToMind: true,
    outcome: 'converse',
    step: 3,
    ms: 0,
  }
}

/**
 * Stateful 0 ms Bark & Greet/Antagonize Escalation Engine.
 * Tracks per-(actor, subject) 3-step social exchange sequences within `escalationWindow` seconds,
 * optionally syncing trust deltas into a `createMemory()` store.
 */
export function createBarkEngine({ memory = null, escalationWindow = 30 } = {}) {
  /** "actorId|subjectId" -> { mode: 'greet' | 'antagonize' | 'neutral', step: number, lastAt: number } */
  const exchanges = new Map()

  return {
    interact({
      actorId = 'npc',
      subjectId = 'player',
      action = 'greet',
      district = 'downtown',
      tone = null,
      weather = 'clear',
      playerState = {},
      courage = 0.5,
      now = 0,
      seed = 0,
    } = {}) {
      const pairKey = `${actorId}|${subjectId}`
      let ex = exchanges.get(pairKey)
      if (!ex || now - ex.lastAt > escalationWindow) {
        ex = { mode: 'neutral', step: 0, lastAt: now }
      }

      let resolvedAction = action
      let step = 1

      if (action === 'defuse' || (action === 'greet' && ex.mode === 'antagonize')) {
        // Greet after antagonize or explicit defuse cleanly de-escalates!
        resolvedAction = 'defuse'
        ex.mode = 'neutral'
        ex.step = 0
        step = 1
      } else if (action === 'greet') {
        ex.mode = 'greet'
        ex.step = Math.min(3, ex.step + 1)
        step = ex.step
      } else if (action === 'antagonize') {
        ex.mode = 'antagonize'
        ex.step = Math.min(3, ex.step + 1)
        step = ex.step
      } else if (action === 'react') {
        step = 1
      }

      ex.lastAt = now
      exchanges.set(pairKey, ex)

      const priorTrust = memory ? memory.recall(actorId, subjectId).trust : 0
      const bark = generateBark({
        actorId,
        subjectId,
        district,
        tone,
        trust: priorTrust,
        weather,
        playerState,
        action: resolvedAction,
        step,
        courage,
        seed,
      })

      if (memory && (bark.trustDelta !== 0 || resolvedAction === 'greet' || resolvedAction === 'antagonize' || resolvedAction === 'defuse')) {
        const tag = resolvedAction === 'greet'
          ? 'greeted'
          : resolvedAction === 'antagonize'
            ? 'antagonized'
            : resolvedAction === 'defuse'
              ? 'apologized'
              : null
        memory.remember(actorId, subjectId, {
          trustDelta: bark.trustDelta,
          tag,
          now,
          bumpFamiliarity: resolvedAction !== 'react',
        })
      }

      return bark
    },

    stateOf(actorId, subjectId) {
      const ex = exchanges.get(`${actorId}|${subjectId}`)
      return ex ? { ...ex } : { mode: 'neutral', step: 0, lastAt: 0 }
    },
  }
}
