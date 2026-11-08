import * as THREE from 'three/webgpu'
import type { Context } from 'cordis'
import { replace } from '../kernel'
import { conversation, say } from '../villager'
import { inputVariant } from '../talk/input'

const STORAGE_KEY = 'village.notebook.lines'
/** Lines kept but not yet delivered to the villager, oldest first. */
const OUTBOX_KEY = 'village.notebook.outbox'
const RETRY_S = 5 // seconds between attempts while the villager is away
const HAND = 'italic 44px "Bradley Hand", "Segoe Print", "Comic Sans MS", cursive'
// Matches paintPage in paint.ts: lines are 52px apart and the page's own note uses the first two.
const lineY = (i: number) => 140 + 52 * (i + 1) - 10
const FIRST_FREE = 2
const SLOTS = 8 // rows before the doodle at the bottom of the page
// The villager answers on the facing (left) page, below its four painted lines, in its own hand.
const VILLAGER_HAND = 'italic 38px "Snell Roundhand", "Apple Chancery", "Segoe Script", cursive'
const REPLY_FIRST = 4
const REPLY_ROWS = 12
const WRITE_RATE = 32 // characters a second, so chunky arrivals still read as writing
// Synthetic person until family isolation is proven (AGENTS.md).
const PERSON = 'alex'
const AWAY = 'Your villager is out for a moment. Your line is kept here, and they will read it when they are back.'

function readLines(key = STORAGE_KEY): string[] {
  try {
    const lines = JSON.parse(localStorage.getItem(key) ?? '[]')
    return Array.isArray(lines) ? lines.filter((l) => typeof l === 'string') : []
  } catch {
    return []
  }
}

function saveLines(lines: string[], key = STORAGE_KEY): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(lines))
    return true
  } catch {
    return false
  }
}

/**
 * Write in the notebook on the table. Click, tap, or Tab then Enter brings the
 * page close; typing appears on the paper in handwriting; Enter keeps the line
 * (stored in this browser for now); Escape or a click elsewhere goes back.
 */
export default {
  name: 'notebook',
  inject: ['stage', 'view', 'entries'],
  apply(ctx: Context) {
    // ?talk=notebook: the richer notebook (talkbook.ts) takes the book instead (#42 prototype).
    // With the always-on input (?talk=npc&input=held|speech) the same book is the journal.
    const q = new URLSearchParams(location.search)
    if (q.get('talk') === 'notebook' || inputVariant(q)) return
    const { scene } = ctx.stage
    const { view, entries } = ctx
    const lines = readLines()
    let draft = ''
    let open = false
    let caretOn = true

    // The entries layer gives the notebook its button, label and picking; the
    // notebook keeps a text field so the keyboard can write on the page.
    const input = document.createElement('input')
    input.type = 'text'
    input.maxLength = 48
    input.autocomplete = 'off'
    // Focused only by choosing the notebook, so Tab never lands in an invisible field.
    input.tabIndex = -1
    input.setAttribute('aria-label', 'A line for the notebook')
    input.className = 'village-offscreen'
    const style = document.createElement('style')
    style.textContent = '.village-offscreen { position: fixed; left: 50%; bottom: 0; width: 1px; height: 1px; opacity: 0; pointer-events: none; font-size: 16px; }'
    const showHint = entries.say
    // Screen readers hear the villager's finished answer; the page shows it being written.
    const voice = document.createElement('p')
    voice.className = 'village-offscreen'
    voice.setAttribute('aria-live', 'polite')
    voice.dataset.villager = 'quiet'

    const page = () => scene.getObjectByName('notebook right page') as THREE.Mesh | undefined
    const book = () => scene.getObjectByName('notebook')
    // Keep an untouched copy of each page canvas so writing can be redrawn and undone.
    const pristine = new WeakMap<HTMLCanvasElement, HTMLCanvasElement>()

    const paint = () => {
      const mesh = page()
      const texture = (mesh?.material as THREE.MeshStandardMaterial | undefined)?.map
      const paper = texture?.image as HTMLCanvasElement | undefined
      if (!texture || !paper?.getContext) return
      let clean = pristine.get(paper)
      if (!clean) {
        clean = document.createElement('canvas')
        clean.width = paper.width
        clean.height = paper.height
        clean.getContext('2d')!.drawImage(paper, 0, 0)
        pristine.set(paper, clean)
      }
      const g = paper.getContext('2d')!
      g.drawImage(clean, 0, 0)
      g.font = HAND
      g.fillStyle = 'rgba(38, 58, 112, 0.86)'
      const rows = open ? [...lines.slice(-(SLOTS - 1)), draft + (caretOn ? '|' : '')] : lines.slice(-SLOTS)
      rows.forEach((text, i) => g.fillText(text, 120, lineY(FIRST_FREE + i), paper.width - 160))
      texture.needsUpdate = true
    }

    // The villager's page: `reply` is what it has said so far, `shown` how much the pen has written.
    let reply = ''
    let replyIsNote = false
    let shown = 0
    let pen = 0
    const leftPage = () => scene.getObjectByName('notebook left page') as THREE.Mesh | undefined
    const paintReply = () => {
      const texture = (leftPage()?.material as THREE.MeshStandardMaterial | undefined)?.map
      const paper = texture?.image as HTMLCanvasElement | undefined
      if (!texture || !paper?.getContext) return
      let clean = pristine.get(paper)
      if (!clean) {
        clean = document.createElement('canvas')
        clean.width = paper.width
        clean.height = paper.height
        clean.getContext('2d')!.drawImage(paper, 0, 0)
        pristine.set(paper, clean)
      }
      const g = paper.getContext('2d')!
      g.drawImage(clean, 0, 0)
      g.font = VILLAGER_HAND
      g.fillStyle = replyIsNote ? 'rgba(90, 84, 78, 0.8)' : 'rgba(46, 92, 64, 0.9)'
      const width = paper.width - 170
      const rows: string[] = []
      for (const paragraph of reply.slice(0, shown).split('\n')) {
        let row = ''
        for (const word of paragraph.split(' ')) {
          const next = row ? `${row} ${word}` : word
          if (row && g.measureText(next).width > width) {
            rows.push(row)
            row = word
          } else row = next
        }
        if (row) rows.push(row)
      }
      rows.slice(-REPLY_ROWS).forEach((text, i) => g.fillText(text, 120, lineY(REPLY_FIRST + i), width))
      texture.needsUpdate = true
    }
    const showReply = (text: string, { instant = false, note = false } = {}) => {
      reply = text
      replyIsNote = note
      shown = instant || matchMedia('(prefers-reduced-motion: reduce)').matches ? text.length : Math.min(shown, text.length)
      paintReply()
    }

    const restore = () => {
      for (const mesh of [page(), leftPage()]) {
        const texture = (mesh?.material as THREE.MeshStandardMaterial | undefined)?.map
        const paper = texture?.image as HTMLCanvasElement | undefined
        const clean = paper && pristine.get(paper)
        if (!texture || !paper || !clean) continue
        paper.getContext('2d')!.drawImage(clean, 0, 0)
        texture.needsUpdate = true
      }
    }

    // Frame both pages: the line on the right and the villager's answer on the left.
    const focusPose = () => {
      const centers = [page(), leftPage()].map((mesh) => {
        if (!mesh) return null
        mesh.geometry.computeBoundingBox()
        return mesh.localToWorld(mesh.geometry.boundingBox!.getCenter(new THREE.Vector3()))
      })
      if (!centers[0] || !centers[1]) return null
      const center = centers[0].clone().lerp(centers[1], 0.5)
      return { position: center.clone().add(new THREE.Vector3(-0.02, 0.86, 0.5)), look: center }
    }

    const enter = () => {
      const pose = focusPose()
      if (!pose) return
      open = true
      view.focus(pose)
      input.value = draft
      input.focus({ preventScroll: true })
      showHint('Write a line · Enter keeps it · Esc goes back')
      paint()
    }

    const leave = () => {
      if (!open) return
      open = false
      draft = ''
      input.value = ''
      input.blur()
      view.focus(null)
      paint()
    }

    // Each kept line goes to an outbox in local storage first and leaves it once the
    // villager has it. Lines typed while it answers wait their turn; while it is away
    // they are tried again every RETRY_S seconds and on the next visit. A reply cut
    // off mid-stream is not resent: the host already has that line.
    const outbox = readLines(OUTBOX_KEY)
    let talking = false
    let retryIn = 0
    let aborter: AbortController | null = null
    const talk = async () => {
      const text = outbox[0]
      if (talking || text === undefined) return
      talking = true
      aborter = new AbortController()
      voice.dataset.villager = 'writing'
      let heard = ''
      shown = 0
      showReply('')
      const said = await say(PERSON, text, (t) => {
        heard += t
        showReply(heard)
      }, { signal: aborter.signal })
      aborter = null
      talking = false
      if (disposed) return
      voice.dataset.villager = said.ok ? 'answered' : said.why
      if (said.ok || said.why !== 'away') {
        outbox.shift()
        saveLines(outbox, OUTBOX_KEY)
      }
      if (said.ok) showReply(said.reply)
      else if (said.why === 'busy') showHint('Your villager is still writing')
      else if (said.why === 'away') showReply(AWAY, { note: true, instant: true })
      else if (said.why === 'cut') showReply('Your villager was interrupted partway through. Your line is kept; try me again in a moment.', { note: true, instant: true })
      else showReply('I could not quite answer that one. Your line is kept; try me again in a moment.', { note: true, instant: true })
      voice.textContent = reply
      if (said.ok || said.why !== 'away') void talk()
      else retryIn = RETRY_S
    }

    const commit = () => {
      const text = draft.trim()
      if (!text) return
      lines.push(text)
      outbox.push(text)
      draft = ''
      input.value = ''
      showHint(saveLines(lines) && saveLines(outbox, OUTBOX_KEY) ? 'Kept on the page' : 'Written, but this browser could not save it')
      paint()
      retryIn = 0
      void talk()
    }

    const onInput = () => {
      draft = input.value
      caretOn = true
      paint()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        commit()
      }
      // Escape bubbles to the entries layer, which leaves and refocuses the notebook's entry.
    }

    ctx.effect(() => {
      document.head.append(style)
      document.body.append(input, voice)
      input.addEventListener('input', onInput)
      input.addEventListener('keydown', onKey)
      return () => {
        disposed = true
        aborter?.abort()
        if (open) view.focus(null)
        restore()
        input.remove()
        voice.remove()
        style.remove()
      }
    }, 'notebook writing')

    // Register once the table has made the book.
    // The table owns the book, so when the table reloads the entry follows the new one.
    let removeEntry: (() => void) | null = null
    let registered: THREE.Object3D | null = null
    let disposed = false
    ctx.effect(() => () => removeEntry?.(), 'notebook entry')
    const inScene = (o: THREE.Object3D) => {
      while (o.parent) o = o.parent
      return o === scene
    }

    // Show kept lines once the table's page exists, and blink the caret while writing.
    let painted = false
    let asked = false
    let blink = 0
    ctx.on('village/frame', (dt) => {
      if (registered && !inScene(registered)) {
        if (open) leave()
        removeEntry?.()
        removeEntry = null
        registered = null
        painted = false
      }
      if (!painted && page()) {
        painted = true
        paint()
        paintReply()
        registered = book()!
        removeEntry = entries.add({ id: 'notebook', label: 'Notebook', object: registered, select: enter, leave })
        if (!asked) {
          asked = true
          // The last answer is on the page when you come back, written already.
          void conversation(PERSON).then((history) => {
            const last = history?.filter((l) => l.from === 'villager' && l.text).pop()
            if (disposed || !last?.text || talking || reply) return
            showReply(last.text, { instant: true })
            voice.dataset.villager = 'remembered'
            voice.textContent = last.text
          })
          // Lines kept while the villager was away go now.
          void talk()
        }
      }
      if (retryIn > 0 && !talking && (retryIn -= dt) <= 0) void talk()
      if (shown < reply.length) {
        pen += WRITE_RATE * dt
        const step = Math.floor(pen)
        if (step > 0) {
          pen -= step
          shown = Math.min(reply.length, shown + step)
          paintReply()
        }
      }
      if (!open) return
      blink += dt
      if (blink > 0.53) {
        blink = 0
        caretOn = !caretOn
        paint()
      }
    })
  },
}

if (import.meta.hot) import.meta.hot.accept((m) => m && replace(m.default))
