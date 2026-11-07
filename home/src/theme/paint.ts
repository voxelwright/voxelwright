// Painters a theme can name in a role's `paint` (see tokens.ts). Each one paints a
// texture in code, like ../paint.ts; the theme plugin swaps it in for the role's own
// map, restores the original on unload and disposes what it painted.
import type * as THREE from 'three/webgpu'
import { canvas, makeNoise, rng, toTexture } from '../paint'

/**
 * A rainy city at night, laid out like the garden it replaces (same size, the same
 * band seen through the window): a violet sky glowing magenta at the horizon, three
 * rows of towers with lit windows, a few plain neon bars and rain streaks.
 */
export function paintNightCity(seed: number) {
  const w = 2048, h = 1024
  const [c, g] = canvas(w, h)
  const r = rng(seed)
  const sky = g.createLinearGradient(0, 0, 0, h * 0.75)
  sky.addColorStop(0, '#07061a')
  sky.addColorStop(0.5, '#1d1446')
  sky.addColorStop(0.85, '#5a2266')
  sky.addColorStop(1, '#a8366e')
  g.fillStyle = sky
  g.fillRect(0, 0, w, h)
  // Low cloud lit from below by the city.
  for (let i = 0; i < 14; i++) {
    const x = r() * w, y = h * (0.12 + r() * 0.3)
    g.fillStyle = `rgba(${120 + r() * 60},${50 + r() * 30},${150 + r() * 60},${0.05 + r() * 0.07})`
    g.beginPath()
    g.ellipse(x, y, 160 + r() * 260, 16 + r() * 22, 0, 0, Math.PI * 2)
    g.fill()
  }

  const lit = ['#ffd27a', '#ffe9b8', '#7ff3ff', '#bfe9ff', '#ff8ad8']
  /** One row of towers: far rows are hazier, smaller and violet; near rows darker with more windows lit. */
  const row = (ground: number, minH: number, maxH: number, body: string, haze: number, win: number, size: number) => {
    let x = -20
    while (x < w) {
      const bw = 50 + r() * 130, bh = minH + r() * (maxH - minH)
      const top = h * ground - bh
      g.fillStyle = body
      g.fillRect(x, top, bw, h - top)
      if (r() < 0.25) g.fillRect(x + bw * 0.4, top - 30 - r() * 50, 3, 40 + r() * 50) // mast
      // Windows on a grid, some lit.
      const cols = Math.max(2, Math.floor(bw / (size * 2.2))), rows = Math.floor(bh / (size * 2.4))
      for (let cy = 0; cy < rows; cy++)
        for (let cx = 0; cx < cols; cx++) {
          if (r() > win) continue
          g.globalAlpha = 0.45 + r() * 0.55
          g.fillStyle = lit[Math.floor(r() * (r() < 0.7 ? 2 : lit.length))]
          g.fillRect(x + 6 + cx * size * 2.2, top + 8 + cy * size * 2.4, size, size * 1.3)
        }
      g.globalAlpha = 1
      // A plain vertical neon bar or a horizontal band on some towers: colour only, no lettering.
      if (r() < 0.45) {
        const neon = r() < 0.5 ? '#ff3ab8' : '#2ef2ff'
        g.fillStyle = neon
        g.shadowColor = neon
        g.shadowBlur = 24
        if (r() < 0.5) g.fillRect(x + bw - 16, top + 20 + r() * bh * 0.3, 9, 80 + r() * 140)
        else g.fillRect(x + 8, top + 16 + r() * bh * 0.4, bw - 16, 8)
        g.shadowBlur = 0
      }
      x += bw + r() * 14
    }
    // Haze between rows.
    g.fillStyle = `rgba(90,40,120,${haze})`
    g.fillRect(0, 0, w, h)
  }
  row(0.7, 160, 340, '#2a1e4e', 0.18, 0.4, 6)
  row(0.78, 200, 440, '#181233', 0.14, 0.45, 8)
  row(0.9, 260, 520, '#0d0a1e', 0.0, 0.5, 11)

  // Street glow at the bottom.
  const street = g.createLinearGradient(0, h * 0.84, 0, h)
  street.addColorStop(0, 'rgba(255,60,170,0)')
  street.addColorStop(1, 'rgba(255,60,170,0.35)')
  g.fillStyle = street
  g.fillRect(0, h * 0.84, w, h * 0.16)

  // Rain: thin slanted streaks, brighter where they cross the glow.
  g.lineCap = 'round'
  for (let i = 0; i < 2600; i++) {
    const x = r() * w, y = r() * h, len = 18 + r() * 40
    g.strokeStyle = `rgba(200,220,255,${0.05 + r() * 0.12})`
    g.lineWidth = 1 + r() * 1.2
    g.beginPath()
    g.moveTo(x, y)
    g.lineTo(x - len * 0.18, y + len)
    g.stroke()
  }
  return toTexture(c)
}

/**
 * A soft-edged ellipse from a radial gradient. Painters use this rather than a blur filter:
 * on a wide canvas each filtered draw blurs a whole layer (the sky card took 45 s that way).
 */
function soft(g: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, rgb: string, alpha: number, angle = 0) {
  g.save()
  g.translate(x, y)
  g.rotate(angle)
  g.scale(1, ry / rx)
  const f = g.createRadialGradient(0, 0, 0, 0, 0, rx)
  f.addColorStop(0, `rgba(${rgb},${alpha})`)
  f.addColorStop(0.6, `rgba(${rgb},${alpha * 0.7})`)
  f.addColorStop(1, `rgba(${rgb},0)`)
  g.fillStyle = f
  g.beginPath()
  g.arc(0, 0, rx, 0, Math.PI * 2)
  g.fill()
  g.restore()
}

/**
 * A summer countryside in watercolour and gouache, laid out like the garden it
 * replaces. The window shows roughly x 0.41 to 0.62 and y 0.31 to 0.65 of it, so a
 * towering cloud stands in that band over layered hills, a hedgerow and a meadow.
 * Every shape is a translucent wash with a darker rim where its pigment pooled,
 * and the whole sheet is pressed onto grained paper at the end.
 */
export function paintPastoralView(seed: number) {
  const w = 2048, h = 1024
  const [c, g] = canvas(w, h)
  const r = rng(seed)
  const n = makeNoise(seed, 64)

  // Sky: deep summer blue at the top, pale and a little green-gold at the horizon.
  const sky = g.createLinearGradient(0, 0, 0, h * 0.62)
  sky.addColorStop(0, '#2c72bc')
  sky.addColorStop(0.5, '#5b9fd9')
  sky.addColorStop(0.82, '#a6cfe9')
  sky.addColorStop(1, '#e2eee4')
  g.fillStyle = sky
  g.fillRect(0, 0, w, h)
  // An uneven wash: big soft blooms of darker and lighter blue where the water pooled.
  for (let i = 0; i < 40; i++) {
    const x = r() * w, y = r() * h * 0.5, dark = r() < 0.5
    soft(g, x, y, 110 + r() * 230, 50 + r() * 90, dark ? '40,110,190' : '235,245,250', dark ? 0.08 + r() * 0.1 : 0.08 + r() * 0.12, r() * 3)
  }

  /** One translucent wash shape with the darker pooled rim watercolour leaves where it dried. */
  const wash = (path: () => void, fill: string, rim: string, rimWidth: number, soften = 0) => {
    g.save()
    if (soften) g.filter = `blur(${soften}px)`
    g.fillStyle = fill
    path()
    g.fill()
    g.filter = 'none'
    g.strokeStyle = rim
    g.lineWidth = rimWidth
    g.lineJoin = 'round'
    path()
    g.stroke()
    g.restore()
  }

  /**
   * A towering cumulus: a stack of rounded lobes, shadowed lilac-grey underneath and
   * sunlit white on top, the base flattened along a line as real cumulus is.
   */
  const cumulus = (cx: number, base: number, width: number, height: number) => {
    const lobes: [number, number, number][] = []
    for (let i = 0; i < 64; i++) {
      const t = r() // 0 at the base, 1 at the crown
      // A cauliflower, not a column: wide shoulders, a crown that leans downwind, ragged sides.
      const spread = width * (0.55 - t * t * 0.32) * (0.45 + r() * 0.75)
      const x = cx + (r() - 0.5) * 2 * spread + Math.sin(t * 2.2) * width * 0.16
      const y = base - t * height * (0.75 + r() * 0.3)
      const rad = width * (0.07 + (1 - t) * 0.05 + r() * r() * 0.12)
      lobes.push([x, y, rad])
    }
    lobes.sort((a, b) => b[1] - a[1])
    // Shadow body first, a soft blue-lilac.
    for (const [x, y, rad] of lobes) soft(g, x, Math.min(y, base - rad * 0.6), rad * 1.12, rad * 1.12, '136,148,192', 0.8)
    // Sunlit tops: the light from the upper left.
    for (const [x, y, rad] of lobes) {
      const top = Math.min(y, base - rad * 0.6)
      const lit = g.createRadialGradient(x - rad * 0.35, top - rad * 0.45, rad * 0.1, x, top, rad * 1.05)
      lit.addColorStop(0, 'rgba(255,253,246,0.98)')
      lit.addColorStop(0.55, 'rgba(250,248,242,0.8)')
      lit.addColorStop(1, 'rgba(220,226,238,0)')
      g.fillStyle = lit
      g.beginPath()
      g.arc(x, top, rad, 0, Math.PI * 2)
      g.fill()
    }
    // Pooled pigment along the shadowed underside: a few soft grey-blue strokes.
    g.strokeStyle = 'rgba(110,122,168,0.35)'
    g.lineCap = 'round'
    for (let i = 0; i < 10; i++) {
      const x = cx + (r() - 0.5) * width * 0.9
      g.lineWidth = 4 + r() * 6
      g.beginPath()
      g.moveTo(x - width * 0.12, base - r() * height * 0.08)
      g.quadraticCurveTo(x, base + 6, x + width * 0.14, base - r() * height * 0.06)
      g.stroke()
    }
  }
  // The hero cloud stands in the window's band; smaller ones drift along the horizon.
  cumulus(w * 0.53, h * 0.59, 300, 280)
  cumulus(w * 0.27, h * 0.55, 320, 200)
  cumulus(w * 0.8, h * 0.55, 380, 240)
  cumulus(w * 0.06, h * 0.5, 240, 120)
  // Thin high streaks.
  for (let i = 0; i < 12; i++) soft(g, r() * w, h * (0.05 + r() * 0.18), 130 + r() * 200, 8 + r() * 8, '255,255,255', 0.25 + r() * 0.2, -0.05)

  /** A hill line: noise ridge from left to right, closed along the bottom. */
  const ridgePath = (base: number, amp: number, freq: number, key: number) => () => {
    g.beginPath()
    g.moveTo(0, h)
    for (let x = 0; x <= w; x += 6) g.lineTo(x, h * base - n(x / freq, key, 4) * amp - Math.sin(x / w * Math.PI * 1.3 + key) * amp * 0.35)
    g.lineTo(w, h)
    g.closePath()
  }
  // Aerial perspective: far hills cooler, bluer and paler; near ones lush and saturated.
  wash(ridgePath(0.6, 50, 300, 1), '#a9c3cf', 'rgba(120,150,170,0.5)', 2.5)
  wash(ridgePath(0.615, 45, 240, 2), '#8fb88a', 'rgba(80,120,90,0.55)', 3)
  wash(ridgePath(0.635, 40, 200, 3), '#73a956', 'rgba(52,96,48,0.6)', 3)

  /** A round-crowned tree in layered dabs: shadow, mid green, then sunlit yellow-green. */
  const tree = (x: number, y: number, s: number) => {
    g.strokeStyle = '#4f3b28'
    g.lineCap = 'round'
    g.lineWidth = s * 0.06
    g.beginPath()
    g.moveTo(x, y)
    g.lineTo(x + s * 0.02, y - s * 0.5)
    g.stroke()
    const layer = (dx: number, dy: number, rad: number, color: string, count: number, alpha: number) => {
      g.fillStyle = color
      g.globalAlpha = alpha
      for (let i = 0; i < count; i++) {
        const a = r() * Math.PI * 2, d = Math.sqrt(r()) * rad
        g.beginPath()
        g.ellipse(x + dx + Math.cos(a) * d, y - s * 0.62 + dy + Math.sin(a) * d * 0.8, s * (0.05 + r() * 0.05), s * (0.04 + r() * 0.03), r() * 3, 0, Math.PI * 2)
        g.fill()
      }
      g.globalAlpha = 1
    }
    layer(0, 0, s * 0.42, '#2e5a2c', 90, 0.9)
    layer(-s * 0.06, -s * 0.06, s * 0.34, '#4f8a3a', 80, 0.85)
    layer(-s * 0.14, -s * 0.14, s * 0.2, '#9cc85a', 45, 0.8)
    layer(-s * 0.18, -s * 0.2, s * 0.1, '#d6e68a', 18, 0.75)
  }
  // A small red-roofed farmhouse on the far hill, under the hero cloud.
  const fx = w * 0.555, fy = h * 0.612
  g.fillStyle = '#f2e8d4'
  g.fillRect(fx, fy - 14, 34, 16)
  g.fillStyle = '#b4523a'
  g.beginPath()
  g.moveTo(fx - 4, fy - 13)
  g.lineTo(fx + 17, fy - 26)
  g.lineTo(fx + 38, fy - 13)
  g.fill()
  // Trees standing along the ridges, smaller and paler further away.
  for (const [x, y, s] of [[0.47, 0.63, 80], [0.6, 0.625, 60], [0.33, 0.64, 100], [0.71, 0.64, 90], [0.18, 0.66, 130], [0.88, 0.66, 140]] as const)
    tree(w * x, h * y, s)

  // The nearest field: a lush meadow wash, a darker hedgerow and a meadow path.
  wash(ridgePath(0.655, 40, 160, 4), '#5d9a40', 'rgba(36,80,34,0.6)', 4)
  for (let i = 0; i < 700; i++) {
    const x = r() * w, y = h * (0.66 + r() * 0.04)
    g.fillStyle = r() < 0.5 ? 'rgba(42,88,40,0.8)' : 'rgba(84,140,58,0.8)'
    g.beginPath()
    g.ellipse(x, y, 12 + r() * 18, 8 + r() * 10, 0, 0, Math.PI * 2)
    g.fill()
  }
  const meadow = g.createLinearGradient(0, h * 0.7, 0, h)
  meadow.addColorStop(0, '#86ba52')
  meadow.addColorStop(1, '#4f8a36')
  g.fillStyle = meadow
  g.fillRect(0, h * 0.7, w, h * 0.3)
  // Grass strokes and wildflowers in the foreground.
  for (let i = 0; i < 2400; i++) {
    const x = r() * w, y = h * (0.7 + r() * 0.3), len = 8 + r() * 18
    g.strokeStyle = r() < 0.6 ? `rgba(46,96,40,${0.3 + r() * 0.4})` : `rgba(190,220,110,${0.3 + r() * 0.4})`
    g.lineWidth = 1.5 + r() * 2
    g.beginPath()
    g.moveTo(x, y)
    g.lineTo(x + (r() - 0.5) * 6, y - len)
    g.stroke()
  }
  const blooms = ['#fff8e6', '#f6d860', '#e8848c', '#b9a4e0']
  for (let i = 0; i < 500; i++) {
    g.fillStyle = blooms[Math.floor(r() * blooms.length)]
    g.beginPath()
    g.arc(r() * w, h * (0.72 + r() * 0.28), 2 + r() * 3.5, 0, Math.PI * 2)
    g.fill()
  }

  // Press it onto paper: a 256 px tile of fine tooth laid over the sheet in soft light.
  // Per pixel over the whole sheet this took about 1 s of main thread on first use.
  const tile = 256
  const [tc, tg] = canvas(tile, tile)
  const img = tg.createImageData(tile, tile)
  const fine = makeNoise(seed + 9, 128)
  for (let y = 0; y < tile; y++)
    for (let x = 0; x < tile; x++) {
      const i = (y * tile + x) * 4
      const v = 128 + (fine(x / 2, y / 2, 2) - 0.5) * 44
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v
      img.data[i + 3] = 255
    }
  tg.putImageData(img, 0, 0)
  g.globalCompositeOperation = 'soft-light'
  g.fillStyle = g.createPattern(tc, 'repeat')!
  g.fillRect(0, 0, w, h)
  g.globalCompositeOperation = 'source-over'
  return toTexture(c)
}

/**
 * A wall painted in gouache, the same size and layout as the plaster it replaces
 * (one sheet over the whole back wall, never repeated): a warm cream ground laid in
 * broad visible brush patches, a few cooler and warmer washes that dried with a
 * darker rim, and a slightly deeper tone near the floor where the pigment settled.
 */
export function paintGouacheWall(seed: number) {
  const w = 1536, h = 768
  const [c, g] = canvas(w, h)
  const r = rng(seed)
  g.fillStyle = '#f2e8d6'
  g.fillRect(0, 0, w, h)
  // Broad flat strokes, mostly horizontal, each one a slightly different cream.
  const creams = ['#f7eedd', '#eadcc4', '#f3e6cf', '#e6dccb', '#faf3e6', '#e9dcc2']
  g.lineCap = 'round'
  for (let i = 0; i < 420; i++) {
    const x = r() * w, y = r() * h, len = 80 + r() * 220, a = (r() - 0.5) * 0.5
    g.strokeStyle = creams[Math.floor(r() * creams.length)]
    g.globalAlpha = 0.35 + r() * 0.35
    g.lineWidth = 18 + r() * 30
    g.beginPath()
    g.moveTo(x, y)
    g.quadraticCurveTo(x + Math.cos(a) * len * 0.5, y + Math.sin(a) * len * 0.5 + (r() - 0.5) * 20, x + Math.cos(a) * len, y + Math.sin(a) * len)
    g.stroke()
  }
  g.globalAlpha = 1
  // Washes that dried with a pooled edge: a soft fill and a darker rim.
  for (let i = 0; i < 14; i++) {
    const x = r() * w, y = r() * h, rx = 60 + r() * 160, ry = 40 + r() * 100
    const warm = r() < 0.6
    g.filter = 'blur(10px)'
    g.fillStyle = warm ? 'rgba(232,196,150,0.18)' : 'rgba(196,204,200,0.16)'
    g.beginPath()
    g.ellipse(x, y, rx, ry, r() * 3, 0, Math.PI * 2)
    g.fill()
    // Only part of the rim shows, as where a wash dried unevenly.
    g.filter = 'blur(2px)'
    g.strokeStyle = warm ? 'rgba(196,150,100,0.12)' : 'rgba(150,160,160,0.1)'
    g.lineWidth = 3 + r() * 3
    const from = r() * Math.PI * 2
    g.beginPath()
    g.ellipse(x, y, rx, ry, r() * 3, from, from + 1 + r() * 1.5)
    g.stroke()
  }
  g.filter = 'none'
  // Pigment settled towards the floor.
  const settle = g.createLinearGradient(0, h * 0.7, 0, h)
  settle.addColorStop(0, 'rgba(200,160,110,0)')
  settle.addColorStop(1, 'rgba(200,160,110,0.18)')
  g.fillStyle = settle
  g.fillRect(0, 0, w, h)
  return toTexture(c)
}

/** Draws a shape at (x, y) and again across each edge it comes within `reach` of, so a tiled texture has no seam. */
function each(w: number, h: number, x: number, y: number, reach: number, draw: (px: number, py: number) => void, vertical = true) {
  const xs = new Set([0, x < reach ? w : 0, x > w - reach ? -w : 0])
  const ys = vertical ? new Set([0, y < reach ? h : 0, y > h - reach ? -h : 0]) : new Set([0])
  for (const dx of xs) for (const dy of ys) draw(x + dx, y + dy)
}

/**
 * Oak floorboards in gouache, tiled like the floor's own map (eight boards across the
 * tile, two staggered butt joints each): each board one flat honey wash, the grain laid
 * in long dry strokes of a lighter and a darker tone, and the seams a soft sienna line
 * where the pigment pooled. No fine wood fibre: a painted floor has none.
 */
export function paintGouachePlanks(seed: number) {
  const size = 1024, boards = 8, bh = size / boards
  const [c, g] = canvas(size, size)
  const r = rng(seed)
  const washes = ['#e6bc84', '#dfb37a', '#eac48e', '#d9ab72', '#e3b880', '#edc995']
  g.lineCap = 'round'
  for (let b = 0; b < boards; b++) {
    const y0 = b * bh
    g.fillStyle = washes[Math.floor(r() * washes.length)]
    g.fillRect(0, y0, size, bh)
    g.save()
    g.beginPath()
    g.rect(0, y0, size, bh)
    g.clip()
    // A broad uneven wash along the board: lighter where the brush was fuller.
    for (let i = 0; i < 4; i++) {
      const x = r() * size, y = y0 + bh * (0.3 + r() * 0.4), rx = 200 + r() * 200, light = r() < 0.55
      each(size, size, x, y, rx + 20, (px) => soft(g, px, y, rx, bh * 0.5, light ? '255,236,196' : '176,118,70', light ? 0.2 : 0.1), false)
    }
    // Grain: long, slightly wavy dry strokes along the board.
    for (let i = 0; i < 26; i++) {
      const x = r() * size, y = y0 + 8 + r() * (bh - 16), len = 140 + r() * 360, bend = (r() - 0.5) * 10
      g.strokeStyle = r() < 0.55 ? `rgba(160,104,58,${0.12 + r() * 0.16})` : `rgba(255,232,190,${0.18 + r() * 0.2})`
      g.lineWidth = 2 + r() * 6
      each(size, size, x, y, len + 10, (px) => {
        g.beginPath()
        g.moveTo(px, y)
        g.bezierCurveTo(px + len * 0.33, y + bend, px + len * 0.66, y - bend, px + len, y + bend * 0.4)
        g.stroke()
      }, false)
    }
    // A knot now and then: a small darker dab with a ring.
    if (r() < 0.4) {
      const x = 40 + r() * (size - 80), y = y0 + bh * (0.3 + r() * 0.4)
      g.fillStyle = 'rgba(140,86,48,0.35)'
      g.beginPath()
      g.ellipse(x, y, 10 + r() * 8, 5 + r() * 3, 0, 0, Math.PI * 2)
      g.fill()
      g.strokeStyle = 'rgba(140,86,48,0.2)'
      g.lineWidth = 3
      g.beginPath()
      g.ellipse(x, y, 26, 11, 0, 0, Math.PI * 2)
      g.stroke()
    }
    g.restore()
    // Seams: a soft pooled line along the board's edge and two staggered butt joints.
    g.fillStyle = 'rgba(128,78,44,0.55)'
    g.fillRect(0, y0, size, 2.5)
    g.fillStyle = 'rgba(128,78,44,0.16)'
    g.fillRect(0, y0 + 2.5, size, 5)
    g.fillRect(0, y0 + bh - 5, size, 5)
    const at = 20 + r() * (size / 2 - 40)
    g.fillStyle = 'rgba(128,78,44,0.5)'
    for (const x of [at, at + size / 2]) g.fillRect(x, y0, 2.5, bh)
  }
  return toTexture(c)
}

/**
 * A summer meadow in gouache, tiled (the yard's lawn repeats it every 3 m): a fresh green
 * ground, broad flat patches of yellow-green and blue-green and short grass strokes in two
 * tones. No flowers: the yard has its own, and on the 48 m worktable a dot is 20 cm wide.
 */
export function paintGouacheMeadow(seed: number) {
  const size = 512
  const [c, g] = canvas(size, size)
  const r = rng(seed)
  g.fillStyle = '#7aa64e'
  g.fillRect(0, 0, size, size)
  const patches: [string, number][] = [['150,184,92', 0.5], ['78,128,60', 0.5], ['100,146,92', 0.45], ['190,196,110', 0.4]]
  for (let i = 0; i < 26; i++) {
    const x = r() * size, y = r() * size, rx = 50 + r() * 90, ry = 30 + r() * 55, a = r() * 3
    const [rgb, alpha] = patches[Math.floor(r() * patches.length)]
    each(size, size, x, y, 160, (px, py) => soft(g, px, py, rx, ry, rgb, alpha, a))
  }
  g.lineCap = 'round'
  for (let i = 0; i < 900; i++) {
    const x = r() * size, y = r() * size, len = 5 + r() * 9, lean = (r() - 0.5) * 5
    g.strokeStyle = r() < 0.55 ? `rgba(62,118,46,${0.25 + r() * 0.3})` : `rgba(200,226,120,${0.25 + r() * 0.3})`
    g.lineWidth = 1.5 + r() * 2
    each(size, size, x, y, 18, (px, py) => {
      g.beginPath()
      g.moveTo(px, py)
      g.lineTo(px + lean, py - len)
      g.stroke()
    })
  }
  return toTexture(c, { repeat: [1, 1] })
}

/**
 * Leaves in gouache, for crowns and shrubs that had no map: dabs around white, so the
 * leaves keep their own green and gain painted light. Cream dabs where the sun catches,
 * cool blue-green dabs in the shade, tiled.
 */
export function paintGouacheLeaves(seed: number) {
  const size = 256
  const [c, g] = canvas(size, size)
  const r = rng(seed)
  g.fillStyle = '#e4ead8'
  g.fillRect(0, 0, size, size)
  const dabs = ['#fff6d4', '#f4f0cc', '#dfe8cc', '#c4d4c0', '#aec2b6', '#fffbe6']
  for (let i = 0; i < 160; i++) {
    const x = r() * size, y = r() * size, rx = 12 + r() * 20, ry = 8 + r() * 10, a = r() * Math.PI
    g.fillStyle = dabs[Math.floor(r() * dabs.length)]
    g.globalAlpha = 0.6 + r() * 0.35
    each(size, size, x, y, 34, (px, py) => {
      g.beginPath()
      g.ellipse(px, py, rx, ry, a, 0, Math.PI * 2)
      g.fill()
    })
  }
  g.globalAlpha = 1
  return toTexture(c, { repeat: [2, 1] })
}

/**
 * The painted card the pastoral sky stands on, wrapped round the yard. It is seen from
 * above, so only its lowest metre or two shows: a strip of meadow at the foot, low
 * rolling hills in aerial blues and greens with tree dabs, and straight above them a
 * summer sky with cumulus along the horizon. Tiles left to right.
 */
export function paintPastoralSky(seed: number) {
  const w = 4096, h = 640
  const [c, g] = canvas(w, h)
  const r = rng(seed)
  const sky = g.createLinearGradient(0, 0, 0, h)
  sky.addColorStop(0, '#3f86cc')
  sky.addColorStop(0.5, '#6aa8dc')
  sky.addColorStop(0.8, '#b4d4ec')
  sky.addColorStop(0.92, '#e2ecea')
  g.fillStyle = sky
  g.fillRect(0, 0, w, h)
  // Uneven wash in the blue.
  for (let i = 0; i < 50; i++) {
    const x = r() * w, y = r() * h * 0.6, rx = 140 + r() * 220, ry = 36 + r() * 56
    const dark = r() < 0.5, a = dark ? 0.08 + r() * 0.1 : 0.1 + r() * 0.12
    each(w, h, x, y, rx + 40, (px) => soft(g, px, y, rx, ry, dark ? '60,120,196' : '240,248,252', a), false)
  }

  /** A cumulus: rounded lobes on a flat base, lilac-grey shade under sunlit cream tops. */
  const cloud = (cx: number, base: number, width: number, height: number) => {
    const lobes: [number, number, number][] = []
    const n = Math.round(14 + width / 16)
    for (let i = 0; i < n; i++) {
      const t = Math.pow(r(), 0.8)
      const half = width * 0.5 * (1 - t * 0.55) * (0.7 + r() * 0.35)
      const x = cx + (r() - 0.5) * 2 * half + t * width * 0.08
      const rad = height * (0.22 + (1 - t) * 0.12 + r() * 0.14)
      lobes.push([x, Math.min(base - t * height, base - rad * 0.55), rad])
    }
    lobes.sort((a, b) => b[1] - a[1])
    for (const [x, y, rad] of lobes) each(w, h, x, y, width, (px) => soft(g, px, y + rad * 0.15, rad * 1.1, rad * 1.1, '150,158,196', 0.8), false)
    for (const [x, y, rad] of lobes) each(w, h, x, y, width, (px) => {
      const lit = g.createRadialGradient(px - rad * 0.3, y - rad * 0.4, rad * 0.1, px, y, rad)
      lit.addColorStop(0, 'rgba(255,253,244,0.98)')
      lit.addColorStop(0.6, 'rgba(250,247,240,0.85)')
      lit.addColorStop(1, 'rgba(226,230,240,0)')
      g.fillStyle = lit
      g.beginPath()
      g.arc(px, y, rad * 0.95, 0, Math.PI * 2)
      g.fill()
    }, false)
  }
  for (let i = 0; i < 16; i++) cloud((i + r() * 0.6) * (w / 16), h * (0.84 + r() * 0.04), 160 + r() * 220, 70 + r() * 90)

  /** A tiling ridge: a few sines with whole cycles across the card. */
  const ridge = (base: number, amp: number, k: number, fill: string, rim: string) => {
    const p = [r() * 6, r() * 6, r() * 6]
    const at = (x: number) => {
      const u = (x / w) * Math.PI * 2
      return base - amp * (0.5 * Math.sin(u * k + p[0]) + 0.3 * Math.sin(u * (k * 2 + 1) + p[1]) + 0.2 * Math.sin(u * (k * 5 + 2) + p[2]))
    }
    g.beginPath()
    g.moveTo(0, h)
    for (let x = 0; x <= w; x += 8) g.lineTo(x, at(x))
    g.lineTo(w, h)
    g.closePath()
    g.fillStyle = fill
    g.fill()
    g.strokeStyle = rim
    g.lineWidth = 3
    g.stroke()
    return at
  }
  ridge(h * 0.9, 14, 5, '#a8c4cc', 'rgba(120,150,170,0.45)')
  ridge(h * 0.925, 12, 7, '#90b98a', 'rgba(80,120,90,0.5)')
  const near = ridge(h * 0.95, 10, 9, '#76ab56', 'rgba(52,96,48,0.55)')
  // Round trees along the near ridge, each three dabs of green.
  for (let i = 0; i < 70; i++) {
    const x = r() * w, s = 5 + r() * 7, y = near(x) + 3
    each(w, h, x, y, 40, (px) => {
      for (const [dx, dy, k, col] of [[0, 0, 1, '#3e6e34'], [-0.2, -0.2, 0.75, '#5f9442'], [-0.35, -0.35, 0.4, '#a6cc66']] as const) {
        g.fillStyle = col
        g.beginPath()
        g.ellipse(px + dx * s, y - s + dy * s, s * k, s * k * 0.9, 0, 0, Math.PI * 2)
        g.fill()
      }
    }, false)
  }
  // The meadow at the foot, where the card meets the table.
  const foot = g.createLinearGradient(0, h * 0.965, 0, h)
  foot.addColorStop(0, '#6fa64c')
  foot.addColorStop(1, '#86b45c')
  g.fillStyle = foot
  g.fillRect(0, h * 0.965, w, h * 0.035)
  return toTexture(c)
}

/** Painters by name, as a theme's `paint` names them. */
export const PAINTERS: Record<string, () => THREE.Texture> = {
  'night-city': () => paintNightCity(7),
  'pastoral-view': () => paintPastoralView(11),
  'gouache-wall': () => paintGouacheWall(5),
  'gouache-planks': () => paintGouachePlanks(11),
  'gouache-meadow': () => paintGouacheMeadow(21),
  'gouache-leaves': () => paintGouacheLeaves(4),
  'pastoral-sky': () => paintPastoralSky(13),
}
