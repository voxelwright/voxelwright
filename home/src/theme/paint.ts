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
  g.filter = 'blur(18px)'
  for (let i = 0; i < 40; i++) {
    const x = r() * w, y = r() * h * 0.5
    g.fillStyle = r() < 0.5 ? `rgba(40,110,190,${0.06 + r() * 0.08})` : `rgba(235,245,250,${0.06 + r() * 0.1})`
    g.beginPath()
    g.ellipse(x, y, 90 + r() * 220, 40 + r() * 90, r() * 3, 0, Math.PI * 2)
    g.fill()
  }
  g.filter = 'none'

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
    for (let i = 0; i < 46; i++) {
      const t = r() // 0 at the base, 1 at the crown
      const spread = width * (0.5 - t * 0.28) * (0.6 + r() * 0.5)
      const x = cx + (r() - 0.5) * 2 * spread + Math.sin(t * 3) * width * 0.08
      const y = base - t * height
      const rad = width * (0.09 + (1 - t) * 0.06 + r() * 0.06)
      lobes.push([x, y, rad])
    }
    lobes.sort((a, b) => b[1] - a[1])
    // Shadow body first, a soft blue-lilac.
    g.filter = 'blur(6px)'
    for (const [x, y, rad] of lobes) {
      g.fillStyle = 'rgba(136,148,192,0.7)'
      g.beginPath()
      g.arc(x, Math.min(y, base - rad * 0.6), rad, 0, Math.PI * 2)
      g.fill()
    }
    g.filter = 'none'
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
  cumulus(w * 0.535, h * 0.59, 240, 340)
  cumulus(w * 0.27, h * 0.55, 320, 200)
  cumulus(w * 0.8, h * 0.55, 380, 240)
  cumulus(w * 0.06, h * 0.5, 240, 120)
  // Thin high streaks.
  g.filter = 'blur(3px)'
  for (let i = 0; i < 12; i++) {
    g.fillStyle = `rgba(255,255,255,${0.2 + r() * 0.2})`
    g.beginPath()
    g.ellipse(r() * w, h * (0.05 + r() * 0.18), 120 + r() * 200, 6 + r() * 8, -0.05, 0, Math.PI * 2)
    g.fill()
  }
  g.filter = 'none'

  /** A hill line: noise ridge from left to right, closed along the bottom. */
  const ridgePath = (base: number, amp: number, freq: number, key: number) => () => {
    g.beginPath()
    g.moveTo(0, h)
    for (let x = 0; x <= w; x += 6) g.lineTo(x, h * base - n(x / freq, key, 4) * amp - Math.sin(x / w * Math.PI * 1.3 + key) * amp * 0.35)
    g.lineTo(w, h)
    g.closePath()
  }
  // Aerial perspective: far hills cooler, bluer and paler; near ones lush and saturated.
  wash(ridgePath(0.6, 50, 300, 1), '#a9c3cf', 'rgba(120,150,170,0.5)', 2.5, 2)
  wash(ridgePath(0.615, 45, 240, 2), '#8fb88a', 'rgba(80,120,90,0.55)', 3, 1)
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

  // Press it onto paper: fine tooth that lightens the pigment, and faint fibres.
  const img = g.getImageData(0, 0, w, h)
  const fine = makeNoise(seed + 9, 128)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      const tooth = (fine(x / 2.2, y / 2.2, 2) - 0.5) * 22 + (n(x / 40, y / 40, 3) - 0.5) * 10
      img.data[i] = Math.min(255, img.data[i] + tooth)
      img.data[i + 1] = Math.min(255, img.data[i + 1] + tooth)
      img.data[i + 2] = Math.min(255, img.data[i + 2] + tooth * 0.9)
    }
  g.putImageData(img, 0, 0)
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

/**
 * Plaster for pixel art: one flat colour. The home's limewash mottle and brush strokes
 * fall either side of a palette boundary and snap into blotches at 225 rows, so a pixel
 * look paints the wall flat and lets the light alone make its ramp.
 */
export function paintPixelPlaster() {
  const [c, g] = canvas(16, 16)
  g.fillStyle = '#f2ede4'
  g.fillRect(0, 0, 16, 16)
  return toTexture(c)
}

/** Painters by name, as a theme's `paint` names them. */
export const PAINTERS: Record<string, () => THREE.Texture> = {
  'night-city': () => paintNightCity(7),
  'pastoral-view': () => paintPastoralView(11),
  'gouache-wall': () => paintGouacheWall(5),
  'pixel-plaster': paintPixelPlaster,
}
