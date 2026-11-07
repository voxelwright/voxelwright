// Every texture in the home is painted here in code. No image files.
import * as THREE from 'three/webgpu'

export function rng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Tileable value noise on an integer lattice, summed over octaves. */
export function makeNoise(seed: number, period = 64) {
  const r = rng(seed)
  const table = new Float32Array(period * period).map(() => r())
  const at = (x: number, y: number) => table[(((y % period) + period) % period) * period + (((x % period) + period) % period)]
  const smooth = (t: number) => t * t * (3 - 2 * t)
  const value = (x: number, y: number) => {
    const xi = Math.floor(x), yi = Math.floor(y)
    const u = smooth(x - xi), v = smooth(y - yi)
    const a = at(xi, yi), b = at(xi + 1, yi), c = at(xi, yi + 1), d = at(xi + 1, yi + 1)
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v
  }
  return (x: number, y: number, octaves = 4) => {
    let sum = 0, amp = 0.5, f = 1, norm = 0
    for (let i = 0; i < octaves; i++) {
      sum += value(x * f, y * f) * amp
      norm += amp
      amp *= 0.5
      f *= 2
    }
    return sum / norm
  }
}

export function canvas(w: number, h: number) {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  return [c, c.getContext('2d')!] as const
}

export function toTexture(c: HTMLCanvasElement, opts: { repeat?: [number, number]; color?: boolean } = {}) {
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = opts.color === false ? THREE.NoColorSpace : THREE.SRGBColorSpace
  t.anisotropy = 8
  if (opts.repeat) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping
    t.repeat.set(...opts.repeat)
  }
  return t
}

type RGB = [number, number, number]
const mixRGB = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]

/** Per-pixel painter. fn returns rgb 0..255. */
function pixels(w: number, h: number, fn: (x: number, y: number) => RGB) {
  const [c, g] = canvas(w, h)
  const img = g.createImageData(w, h)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const [r, gg, b] = fn(x, y)
      const i = (y * w + x) * 4
      img.data[i] = r
      img.data[i + 1] = gg
      img.data[i + 2] = b
      img.data[i + 3] = 255
    }
  g.putImageData(img, 0, 0)
  return [c, g] as const
}

/** Planked wood. Grain runs along x. Returns color and a roughness map. */
export function paintWood(opts: { seed: number; w?: number; h?: number; planks: number; light: RGB; dark: RGB; knots?: number }) {
  const w = opts.w ?? 1024, h = opts.h ?? 1024
  const n = makeNoise(opts.seed, 128)
  const r = rng(opts.seed + 7)
  const plankH = h / opts.planks
  const plankTone = Array.from({ length: opts.planks }, () => 0.75 + r() * 0.5)
  const plankShift = Array.from({ length: opts.planks }, () => r() * 1000)
  const knots = Array.from({ length: opts.knots ?? 6 }, () => [r() * w, r() * h, 6 + r() * 14] as const)
  const [c] = pixels(w, h, (x, y) => {
    const p = Math.floor(y / plankH)
    const py = y - p * plankH
    let warp = n((x + plankShift[p]) / 90, y / 40, 3) * 26
    for (const [kx, ky, kr] of knots) {
      const dx = (x - kx) / 3.2, dy = y - ky
      const d = Math.sqrt(dx * dx + dy * dy)
      if (d < kr * 6) warp += (kr * 6 - d) * 0.35 * Math.sign(dy || 1)
    }
    const rings = Math.sin((y + warp) * 0.42 + n(x / 300, y / 6, 2) * 6)
    const grain = Math.pow(0.5 + 0.5 * rings, 3)
    const fine = n(x / 3, y / 0.9, 2)
    let t = 0.35 + grain * 0.45 + (fine - 0.5) * 0.25
    t *= plankTone[p]
    const seam = py < 1.6 || py > plankH - 1.6 ? 0.45 : 1
    const base = mixRGB(opts.dark, opts.light, Math.min(1, Math.max(0, t)))
    return [base[0] * seam, base[1] * seam, base[2] * seam]
  })
  return toTexture(c)
}

/** Plaster with a faint limewash. wash scales the brush strokes; 1 is the old, heavier look. */
export function paintPlaster(seed: number, base: RGB, w = 1024, h = 1024, wash = 1) {
  const n = makeNoise(seed, 64)
  const [c, g] = pixels(w, h, (x, y) => {
    const m = n(x / 160, y / 160, 5)
    const s = n(x / 14 + 50, y / 40, 2)
    const t = 0.9 + 0.05 * (1 - wash) + ((m - 0.5) * 0.22 + (s - 0.5) * 0.06) * (0.4 + 0.6 * wash)
    return [base[0] * t, base[1] * t, base[2] * t * 0.98]
  })
  // Broad limewash brush strokes
  const r = rng(seed + 3)
  g.globalAlpha = 0.05 * wash
  for (let i = 0; i < 260; i++) {
    g.strokeStyle = r() > 0.5 ? '#fff6e6' : '#c9b08c'
    g.lineWidth = 20 + r() * 60
    g.lineCap = 'round'
    g.beginPath()
    const x = r() * w, y = r() * h, a = r() * Math.PI
    g.moveTo(x, y)
    g.quadraticCurveTo(x + Math.cos(a) * 80, y + Math.sin(a) * 80 + 30, x + Math.cos(a) * 160, y + Math.sin(a) * 160)
    g.stroke()
  }
  return toTexture(c)
}

export function paintEnamel(seed: number, base: RGB) {
  const n = makeNoise(seed, 64)
  const [c] = pixels(512, 1024, (x, y) => {
    const t = 0.97 + (n(x / 90, y / 90, 4) - 0.5) * 0.06 - Math.max(0, (y - 960) / 64) * 0.15
    return [base[0] * t, base[1] * t, base[2] * t]
  })
  return toTexture(c)
}

/** A garden at golden hour seen through a window: sky, far hills, trees, hedge, flowers. */
export function paintGarden(seed: number) {
  const w = 2048, h = 1024
  const [c, g] = canvas(w, h)
  const r = rng(seed)
  const sky = g.createLinearGradient(0, 0, 0, h * 0.62)
  sky.addColorStop(0, '#8fb2c9')
  sky.addColorStop(0.45, '#f3d8a6')
  sky.addColorStop(1, '#ffc27a')
  g.fillStyle = sky
  g.fillRect(0, 0, w, h)
  // Low sun glow
  const sun = g.createRadialGradient(w * 0.3, h * 0.5, 10, w * 0.3, h * 0.5, h * 0.7)
  sun.addColorStop(0, 'rgba(255,248,220,1)')
  sun.addColorStop(0.08, 'rgba(255,230,170,0.9)')
  sun.addColorStop(1, 'rgba(255,190,120,0)')
  g.fillStyle = sun
  g.fillRect(0, 0, w, h)
  // Soft clouds
  for (let i = 0; i < 18; i++) {
    const x = r() * w, y = h * (0.08 + r() * 0.25)
    g.fillStyle = `rgba(255,240,220,${0.12 + r() * 0.15})`
    g.beginPath()
    g.ellipse(x, y, 120 + r() * 200, 14 + r() * 18, 0, 0, Math.PI * 2)
    g.fill()
  }
  const ridge = (base: number, amp: number, color: string, freq: number) => {
    const n = makeNoise(seed + base, 64)
    g.fillStyle = color
    g.beginPath()
    g.moveTo(0, h)
    for (let x = 0; x <= w; x += 8) g.lineTo(x, h * base - n(x / freq, base * 10, 4) * amp)
    g.lineTo(w, h)
    g.fill()
  }
  // Aerial perspective: far layers are hazier and warmer
  ridge(0.56, 110, '#d9b98f', 260)
  ridge(0.6, 90, '#b9a672', 200)
  ridge(0.66, 70, '#8f9a5a', 150)
  // Trees as clustered painterly dabs
  // Trees: a forked trunk, then several leaf clumps painted in layers of small
  // dabs (shadow, mid, sunlit), so the crown reads as masses with gaps.
  const tree = (x: number, y: number, s: number, dark: string, light: string) => {
    const mid = light
    g.strokeStyle = '#4a3828'
    g.lineCap = 'round'
    const limb = (x0: number, y0: number, x1: number, y1: number, wdt: number) => {
      g.lineWidth = wdt
      g.beginPath()
      g.moveTo(x0, y0)
      g.quadraticCurveTo((x0 + x1) / 2 + (r() - 0.5) * s * 0.1, (y0 + y1) / 2, x1, y1)
      g.stroke()
    }
    const fork = y - s * 0.45
    limb(x, y + s * 0.3, x + s * 0.02, fork, s * 0.09)
    const clumps: [number, number, number][] = [[x, fork - s * 0.38, s * 0.3]]
    for (let i = 0; i < 5; i++) {
      const a = -Math.PI / 2 + (i - 2) * 0.55 + (r() - 0.5) * 0.3
      const len = s * (0.3 + r() * 0.2)
      const ex = x + Math.cos(a) * len, ey = fork + Math.sin(a) * len
      limb(x + s * 0.02, fork, ex, ey, s * 0.04)
      clumps.push([ex, ey - s * 0.05, s * (0.16 + r() * 0.1)])
    }
    const dabs = (cx: number, cy: number, rad: number, color: string, count: number, bias: number, alpha: number) => {
      g.fillStyle = color
      g.globalAlpha = alpha
      for (let i = 0; i < count; i++) {
        const a = r() * Math.PI * 2, d = Math.sqrt(r()) * rad
        const px = cx + Math.cos(a) * d + bias * rad * 0.25, py = cy + Math.sin(a) * d * 0.8 + Math.abs(bias) * rad * 0.15
        g.beginPath()
        g.ellipse(px, py, s * (0.018 + r() * 0.022), s * (0.012 + r() * 0.014), r() * 3, 0, Math.PI * 2)
        g.fill()
      }
    }
    for (const [cx, cy, rad] of clumps) dabs(cx, cy, rad, dark, 140, 0.3, 0.9)
    for (const [cx, cy, rad] of clumps) dabs(cx - rad * 0.12, cy - rad * 0.1, rad * 0.85, mid, 110, -0.4, 0.8)
    for (const [cx, cy, rad] of clumps) dabs(cx - rad * 0.3, cy - rad * 0.3, rad * 0.5, '#e9d27e', 50, -0.8, 0.75)
    g.globalAlpha = 1
  }
  tree(w * 0.12, h * 0.7, 300, '#4f6b33', '#a8b257')
  tree(w * 0.55, h * 0.66, 220, '#5a7238', '#b5b862')
  tree(w * 0.82, h * 0.72, 360, '#46622f', '#9fae52')
  tree(w * 0.38, h * 0.68, 160, '#66793f', '#c1bf6b')
  // Lawn
  const lawn = g.createLinearGradient(0, h * 0.7, 0, h)
  lawn.addColorStop(0, '#9aa552')
  lawn.addColorStop(1, '#5f7a35')
  g.fillStyle = lawn
  g.fillRect(0, h * 0.72, w, h * 0.28)
  // Hedge and flowers along the bottom
  for (let i = 0; i < 900; i++) {
    const x = r() * w, y = h * (0.8 + r() * 0.2)
    g.fillStyle = r() < 0.5 ? '#3f5a2a' : '#6e8a3c'
    g.beginPath()
    g.ellipse(x, y, 10 + r() * 16, 8 + r() * 10, 0, 0, Math.PI * 2)
    g.fill()
  }
  const blooms = ['#f2c14e', '#f08a5d', '#f7e7c6', '#d9667b', '#b388c9']
  for (let i = 0; i < 600; i++) {
    const x = r() * w, y = h * (0.82 + r() * 0.18)
    g.fillStyle = blooms[Math.floor(r() * blooms.length)]
    g.beginPath()
    g.arc(x, y, 2 + r() * 4, 0, Math.PI * 2)
    g.fill()
  }
  // Warm haze over everything
  g.fillStyle = 'rgba(255,214,150,0.12)'
  g.fillRect(0, 0, w, h)
  return toTexture(c)
}

/** Lined notebook page with a little handwriting. */
export function paintPage(seed: number, lines: string[], doodle: boolean) {
  const w = 768, h = 1024
  const n = makeNoise(seed, 64)
  const [c, g] = pixels(w, h, (x, y) => {
    const t = 0.96 + (n(x / 30, y / 30, 4) - 0.5) * 0.05
    return [252 * t, 244 * t, 226 * t]
  })
  g.strokeStyle = 'rgba(120,150,190,0.35)'
  g.lineWidth = 2
  for (let y = 150; y < h - 40; y += 52) {
    g.beginPath()
    g.moveTo(40, y)
    g.lineTo(w - 40, y)
    g.stroke()
  }
  g.strokeStyle = 'rgba(210,110,110,0.35)'
  g.beginPath()
  g.moveTo(100, 0)
  g.lineTo(100, h)
  g.stroke()
  g.fillStyle = 'rgba(60,55,70,0.82)'
  g.font = 'italic 44px "Bradley Hand", "Segoe Print", "Comic Sans MS", cursive'
  lines.forEach((line, i) => g.fillText(line, 120, 140 + 52 * (i + 1) - 10))
  if (doodle) {
    // A pencil-drawn sun and a little house
    g.strokeStyle = 'rgba(70,65,80,0.6)'
    g.lineWidth = 3
    g.beginPath()
    g.arc(560, 760, 46, 0, Math.PI * 2)
    g.stroke()
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2
      g.beginPath()
      g.moveTo(560 + Math.cos(a) * 60, 760 + Math.sin(a) * 60)
      g.lineTo(560 + Math.cos(a) * 84, 760 + Math.sin(a) * 84)
      g.stroke()
    }
    g.strokeRect(200, 760, 150, 120)
    g.beginPath()
    g.moveTo(190, 760)
    g.lineTo(275, 690)
    g.lineTo(360, 760)
    g.stroke()
  }
  return toTexture(c)
}

/** Placeholder family photos, painted. */
export function paintPhoto(kind: 'beach' | 'cat' | 'drawing' | 'mountains', seed: number) {
  const w = 384, h = 448
  const [c, g] = canvas(w, h)
  const r = rng(seed)
  g.fillStyle = '#fbf7ee'
  g.fillRect(0, 0, w, h)
  const ix = 22, iy = 22, iw = w - 44, ih = h - 110
  g.save()
  g.beginPath()
  g.rect(ix, iy, iw, ih)
  g.clip()
  if (kind === 'beach') {
    const s = g.createLinearGradient(0, iy, 0, iy + ih)
    s.addColorStop(0, '#f6b47a'); s.addColorStop(0.5, '#f9dcaa'); s.addColorStop(0.55, '#5f9fb3'); s.addColorStop(0.75, '#e9d3a3'); s.addColorStop(1, '#d9bd88')
    g.fillStyle = s; g.fillRect(ix, iy, iw, ih)
    g.fillStyle = '#fff1c9'; g.beginPath(); g.arc(ix + iw * 0.7, iy + ih * 0.42, 30, 0, Math.PI * 2); g.fill()
    g.fillStyle = '#3c3a48'
    for (const [px, ph] of [[0.3, 70], [0.4, 46]]) { g.fillRect(ix + iw * px, iy + ih * 0.8 - ph, 14, ph); g.beginPath(); g.arc(ix + iw * px + 7, iy + ih * 0.8 - ph - 10, 11, 0, Math.PI * 2); g.fill() }
  } else if (kind === 'cat') {
    g.fillStyle = '#e7c9a2'; g.fillRect(ix, iy, iw, ih)
    g.fillStyle = '#c98f5a'; g.fillRect(ix, iy + ih * 0.7, iw, ih * 0.3)
    g.fillStyle = '#e0873e'
    g.beginPath(); g.ellipse(ix + iw / 2, iy + ih * 0.68, 95, 70, 0, 0, Math.PI * 2); g.fill()
    g.beginPath(); g.arc(ix + iw / 2, iy + ih * 0.4, 62, 0, Math.PI * 2); g.fill()
    g.beginPath(); g.moveTo(ix + iw / 2 - 58, iy + ih * 0.32); g.lineTo(ix + iw / 2 - 40, iy + ih * 0.12); g.lineTo(ix + iw / 2 - 12, iy + ih * 0.28); g.fill()
    g.beginPath(); g.moveTo(ix + iw / 2 + 58, iy + ih * 0.32); g.lineTo(ix + iw / 2 + 40, iy + ih * 0.12); g.lineTo(ix + iw / 2 + 12, iy + ih * 0.28); g.fill()
    g.fillStyle = '#2d2a26'
    g.beginPath(); g.ellipse(ix + iw / 2 - 22, iy + ih * 0.39, 7, 10, 0, 0, Math.PI * 2); g.ellipse(ix + iw / 2 + 22, iy + ih * 0.39, 7, 10, 0, 0, Math.PI * 2); g.fill()
    g.fillStyle = '#d4686b'; g.beginPath(); g.arc(ix + iw / 2, iy + ih * 0.45, 5, 0, Math.PI * 2); g.fill()
  } else if (kind === 'drawing') {
    g.fillStyle = '#fffdf6'; g.fillRect(ix, iy, iw, ih)
    g.lineWidth = 9; g.lineCap = 'round'
    g.strokeStyle = '#4caf50'; g.beginPath(); g.moveTo(ix, iy + ih * 0.85); g.lineTo(ix + iw, iy + ih * 0.82); g.stroke()
    g.strokeStyle = '#e53935'; g.strokeRect(ix + 70, iy + ih * 0.5, 130, 110)
    g.strokeStyle = '#8e5a2c'; g.beginPath(); g.moveTo(ix + 60, iy + ih * 0.5); g.lineTo(ix + 135, iy + ih * 0.3); g.lineTo(ix + 210, iy + ih * 0.5); g.stroke()
    g.strokeStyle = '#fbc02d'; g.beginPath(); g.arc(ix + iw - 60, iy + 60, 30, 0, Math.PI * 2); g.stroke()
    g.strokeStyle = '#1e88e5'
    for (const fx of [250, 290]) { g.beginPath(); g.arc(ix + fx, iy + ih * 0.58, 12, 0, Math.PI * 2); g.moveTo(ix + fx, iy + ih * 0.62); g.lineTo(ix + fx, iy + ih * 0.78); g.stroke() }
  } else {
    const s = g.createLinearGradient(0, iy, 0, iy + ih)
    s.addColorStop(0, '#9cc3d9'); s.addColorStop(1, '#e8eef0')
    g.fillStyle = s; g.fillRect(ix, iy, iw, ih)
    const peak = (x: number, y: number, wdt: number, col: string) => { g.fillStyle = col; g.beginPath(); g.moveTo(x - wdt, iy + ih); g.lineTo(x, y); g.lineTo(x + wdt, iy + ih); g.fill() }
    peak(ix + iw * 0.3, iy + ih * 0.3, 200, '#7d8fa3')
    peak(ix + iw * 0.72, iy + ih * 0.22, 220, '#6a7c90')
    g.fillStyle = '#f5f7fa'; g.beginPath(); g.moveTo(ix + iw * 0.72, iy + ih * 0.22); g.lineTo(ix + iw * 0.72 - 50, iy + ih * 0.36); g.lineTo(ix + iw * 0.72 + 50, iy + ih * 0.36); g.fill()
    g.fillStyle = '#4f7a4a'; g.fillRect(ix, iy + ih * 0.85, iw, ih * 0.15)
  }
  // Photographic warmth and fade
  g.fillStyle = `rgba(255,210,150,${0.08 + r() * 0.06})`
  g.fillRect(ix, iy, iw, ih)
  g.restore()
  g.fillStyle = 'rgba(70,60,60,0.75)'
  g.font = 'italic 30px "Bradley Hand", "Segoe Print", cursive'
  const captions = { beach: 'summer, 2026', cat: 'naptime', drawing: 'our house', mountains: 'our hike' }
  g.fillText(captions[kind], ix + 6, h - 40)
  return toTexture(c)
}

/** A child's crayon drawing of the family and the house, on rough paper. */
export function paintKidDrawing(seed: number) {
  const w = 512, h = 384
  const n = makeNoise(seed, 32)
  const [c, g] = pixels(w, h, (x, y) => {
    const t = 0.97 + (n(x / 8, y / 8, 2) - 0.5) * 0.06
    return [252 * t, 248 * t, 236 * t]
  })
  const r = rng(seed)
  const crayon = (color: string, width: number, pts: [number, number][]) => {
    for (let pass = 0; pass < 3; pass++) {
      g.strokeStyle = color
      g.globalAlpha = 0.55
      g.lineWidth = width * (0.7 + r() * 0.5)
      g.lineCap = g.lineJoin = 'round'
      g.beginPath()
      pts.forEach(([x, y], i) => (i ? g.lineTo(x + (r() - 0.5) * 3, y + (r() - 0.5) * 3) : g.moveTo(x, y)))
      g.stroke()
    }
    g.globalAlpha = 1
  }
  for (let x = 10; x < w; x += 7) crayon('#5aa0e0', 6, [[x, 10], [x + 4, 46]])
  crayon('#f6c02a', 10, Array.from({ length: 13 }, (_, i) => [440 + Math.cos(i / 2) * 34, 80 + Math.sin(i / 2) * 34] as [number, number]))
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2
    crayon('#f6c02a', 6, [[440 + Math.cos(a) * 44, 80 + Math.sin(a) * 44], [440 + Math.cos(a) * 64, 80 + Math.sin(a) * 64]])
  }
  for (let x = 6; x < w; x += 6) crayon('#4caf50', 5, [[x, h - 10], [x + 3, h - 40 - r() * 10]])
  crayon('#d84315', 7, [[60, 300], [60, 190], [190, 190], [190, 300], [60, 300]])
  crayon('#8d6e63', 8, [[48, 196], [125, 120], [202, 196]])
  crayon('#795548', 6, [[110, 300], [110, 250], [140, 250], [140, 300]])
  crayon('#42a5f5', 5, [[150, 215], [178, 215], [178, 240], [150, 240], [150, 215]])
  const person = (x: number, s: number, color: string) => {
    const head = 300 - 120 * s
    crayon('#5d4037', 5, Array.from({ length: 11 }, (_, i) => [x + Math.cos(i / 1.6) * 14 * s, head + Math.sin(i / 1.6) * 14 * s] as [number, number]))
    const neck = head + 14 * s
    crayon(color, 9, [[x, neck], [x - 18 * s, 300 - 30 * s], [x + 18 * s, 300 - 30 * s], [x, neck]])
    crayon('#5d4037', 4, [[x - 6, 300 - 30 * s], [x - 8, 314]])
    crayon('#5d4037', 4, [[x + 6, 300 - 30 * s], [x + 8, 314]])
    crayon('#5d4037', 4, [[x - 26 * s, neck + 30 * s], [x + 26 * s, neck + 30 * s]])
  }
  person(260, 1, '#ab47bc')
  person(320, 1.1, '#1e88e5')
  person(372, 0.7, '#ef5350')
  crayon('#ff9800', 7, [[410, 305], [440, 305], [445, 292], [432, 300], [418, 292], [410, 305]])
  g.fillStyle = 'rgba(229,57,53,0.85)'
  g.font = 'bold 34px "Comic Sans MS", "Chalkboard SE", cursive'
  g.fillText('HOME', 236, 120)
  return toTexture(c)
}

/** Soft diagonal reflections and faint smudges for window glass, drawn additively. */
export function paintGlass(seed: number) {
  const w = 512, h = 512
  const n = makeNoise(seed + 2, 16)
  const r = rng(seed)
  const streaks = Array.from({ length: 3 }, (_, i) => ({ x: 120 + i * 150 + r() * 40, width: 70 - i * 18, strength: 0.16 + r() * 0.1 }))
  const [c] = pixels(w, h, (x, y) => {
    let v = 0
    for (const s of streaks) {
      const d = Math.abs(x + y * 0.55 - s.x - h * 0.27) / s.width
      v += Math.max(0, 1 - d * d) * s.strength
    }
    v += Math.max(0, n(x / 60, y / 60, 3) - 0.55) * 0.25
    return [255 * v, 244 * v, 224 * v]
  })
  return toTexture(c)
}

/** Brushed stainless steel: fine vertical streaks over a soft tonal drift. */
export function paintBrushed(seed: number) {
  const n = makeNoise(seed, 64)
  const [c] = pixels(256, 1024, (x, y) => {
    const t = 0.9 + (n(x / 0.8, y / 90, 2) - 0.5) * 0.12 + (n(x / 60, y / 200, 3) - 0.5) * 0.1
    return [204 * t, 208 * t, 212 * t]
  })
  return toTexture(c)
}

/** A child's alphabet poster: Ukrainian letters, each with a little painted animal blob. */
export function paintAlphabet(seed: number) {
  const w = 384, h = 512
  const [c, g] = canvas(w, h)
  g.fillStyle = '#fbf8f1'
  g.fillRect(0, 0, w, h)
  const r = rng(seed)
  const letters = 'АБВГҐДЕЄЖЗИІЇЙКЛМНОПРСТУФХЦЧШЩЬЮЯ'
  const cols = 5, cw = (w - 30) / cols, ch = (h - 30) / 7
  const colors = ['#e07a5f', '#3d85c6', '#81b29a', '#f2cc8f', '#9c6ade', '#e8a0bf', '#6a994e']
  for (let i = 0; i < Math.min(letters.length, cols * 7); i++) {
    const x = 15 + (i % cols) * cw, y = 15 + Math.floor(i / cols) * ch
    g.fillStyle = colors[Math.floor(r() * colors.length)]
    g.beginPath()
    g.ellipse(x + cw * 0.68, y + ch * 0.55, cw * 0.17, ch * 0.2, r() * 2, 0, Math.PI * 2)
    g.fill()
    g.fillStyle = '#3b3340'
    g.font = 'bold 26px Georgia, serif'
    g.fillText(letters[i], x + 4, y + ch * 0.6)
  }
  return toTexture(c)
}

/** A watercolour botanical print: potted plants on a shelf, soft washes on cream paper. */
export function paintBotanical(seed: number) {
  const w = 384, h = 512
  const n = makeNoise(seed, 32)
  const [c, g] = pixels(w, h, (x, y) => {
    const t = 0.97 + (n(x / 20, y / 20, 3) - 0.5) * 0.05
    return [248 * t, 244 * t, 234 * t]
  })
  const r = rng(seed)
  const wash = (x: number, y: number, rx: number, ry: number, color: string, a: number) => {
    g.fillStyle = color
    g.globalAlpha = a
    g.beginPath()
    g.ellipse(x, y, rx, ry, r() * 3, 0, Math.PI * 2)
    g.fill()
    g.globalAlpha = 1
  }
  g.fillStyle = 'rgba(150,110,80,0.6)'
  g.fillRect(40, 300, w - 80, 6)
  const pots: [number, string][] = [[100, '#d9a07a'], [195, '#e8e2d6'], [290, '#b9805a']]
  for (const [x, pot] of pots) {
    for (let i = 0; i < 26; i++) {
      const a = -Math.PI / 2 + (r() - 0.5) * 2.4, d = 20 + r() * 60
      wash(x + Math.cos(a) * d, 250 + Math.sin(a) * d, 9 + r() * 6, 5 + r() * 3, r() < 0.5 ? '#6f9a5a' : '#9cbf7a', 0.55)
    }
    for (let i = 0; i < 12; i++) wash(x + (r() - 0.5) * 30, 320 + i * 12, 7, 4, '#7fa66a', 0.5)
    g.fillStyle = pot
    g.globalAlpha = 0.85
    g.beginPath()
    g.moveTo(x - 26, 260); g.lineTo(x + 26, 260); g.lineTo(x + 20, 300); g.lineTo(x - 20, 300)
    g.fill()
    g.globalAlpha = 1
  }
  for (let i = 0; i < 30; i++) wash(60 + r() * (w - 120), 400 + r() * 60, 6 + r() * 6, 3, '#a9c48d', 0.35)
  return toTexture(c)
}

/** Woven linen book cloth: warp and weft threads, slubs, a little wear. Repeats. */
export function paintLinen(seed: number, base: RGB, size = 512) {
  const n = makeNoise(seed, 64)
  const r = rng(seed + 1)
  const slubs = Array.from({ length: 40 }, () => [r() * size, r() * size, 6 + r() * 30] as const)
  return pixels(size, size, (x, y) => {
    const warp = Math.sin((x / size) * Math.PI * 2 * 128) * 0.5 + 0.5
    const weft = Math.sin((y / size) * Math.PI * 2 * 128) * 0.5 + 0.5
    const over = ((Math.floor((x / size) * 128) + Math.floor((y / size) * 128)) & 1) ? warp : weft
    let slub = 0
    for (const [sx, sy, len] of slubs) if (Math.abs(y - sy) < 1.5 && Math.abs(x - sx) < len) slub = 0.06
    const t = 0.76 + over * 0.24 + (n(x / 18, y / 18, 4) - 0.5) * 0.18 + slub
    return [base[0] * t, base[1] * t, base[2] * t]
  })[0]
}

/** Grosgrain ribbon: fine ribs across its width, a soft sheen down the middle. Width runs along x. */
export function paintRibbon(seed: number, base: RGB) {
  const n = makeNoise(seed, 32)
  return pixels(64, 512, (x, y) => {
    // Flat cloth: ribs across, a woven selvedge line near each edge, no rounded shading.
    const rib = Math.sin(y * 1.9) * 0.5 + 0.5
    const selvedge = (x > 4 && x < 7) || (x > 56 && x < 59) ? 0.82 : 1
    const edge = x < 2 || x > 61 ? 0.8 : 1
    const t = (0.84 + rib * 0.16 + (n(x / 8, y / 8, 3) - 0.5) * 0.1) * selvedge * edge
    return [base[0] * t, base[1] * t, base[2] * t]
  })[0]
}

/** The edge of a stack of paper: many fine cream lines. Lines run along x. */
export function paintPageEdges(seed: number) {
  const r = rng(seed)
  const shades = Array.from({ length: 256 }, () => 0.86 + r() * 0.14)
  return pixels(256, 256, (_x, y) => {
    const t = shades[y]
    return [246 * t, 236 * t, 214 * t]
  })[0]
}

/**
 * A blank notebook page with paper grain, faint rules from `top` every `row`
 * px, foxing at the outer edges and a shadow along the gutter. side -1 is a
 * left page (gutter on its right), 1 a right page.
 */
export function paintPaper(seed: number, side: 1 | -1, w: number, h: number, top: number, row: number) {
  const n = makeNoise(seed, 64)
  const fiber = makeNoise(seed + 5, 64)
  const [c, g] = pixels(w, h, (x, y) => {
    const t = 0.965 + (n(x / 34, y / 34, 4) - 0.5) * 0.05 + (fiber(x / 3, y / 9, 2) - 0.5) * 0.025
    return [252 * t, 245 * t, 228 * t]
  })
  g.strokeStyle = 'rgba(120,150,190,0.30)'
  g.lineWidth = 2
  for (let y = top; y < h - 70; y += row) {
    g.beginPath()
    g.moveTo(side === 1 ? 70 : 40, y)
    g.lineTo(side === 1 ? w - 40 : w - 70, y)
    g.stroke()
  }
  // Gutter: the paper bends down into the spine.
  const gx = side === 1 ? 0 : w
  const gutter = g.createLinearGradient(gx, 0, gx + side * 150, 0)
  gutter.addColorStop(0, 'rgba(90,60,30,0.42)')
  gutter.addColorStop(0.4, 'rgba(90,60,30,0.1)')
  gutter.addColorStop(1, 'rgba(90,60,30,0)')
  g.fillStyle = gutter
  g.fillRect(0, 0, w, h)
  // Foxing: the outer edges warm and darken a little with handling.
  const ox = side === 1 ? w : 0
  const outer = g.createLinearGradient(ox, 0, ox - side * 90, 0)
  outer.addColorStop(0, 'rgba(170,120,60,0.16)')
  outer.addColorStop(1, 'rgba(170,120,60,0)')
  g.fillStyle = outer
  g.fillRect(0, 0, w, h)
  for (const [y0, dir] of [[0, 1], [h, -1]] as const) {
    const edge = g.createLinearGradient(0, y0, 0, y0 + dir * 60)
    edge.addColorStop(0, 'rgba(170,120,60,0.12)')
    edge.addColorStop(1, 'rgba(170,120,60,0)')
    g.fillStyle = edge
    g.fillRect(0, 0, w, h)
  }
  return c
}

/** The garden seen from above through the kitchen window in ?cam=iso (#42): sunlit lawn, a stone path and flower beds. */
export function paintLawn(seed: number) {
  const w = 1024, h = 512
  const n = makeNoise(seed, 64)
  const r = rng(seed)
  const [c, g] = pixels(w, h, (x, y) => {
    const v = n(x / 70, y / 70, 4)
    const stripe = Math.sin((x / w) * Math.PI * 14) > 0 ? 1 : 0.94
    const glow = 1 - (y / h) * 0.25
    const k = (0.82 + v * 0.36) * stripe * glow
    return [104 * k + 24, 138 * k + 10, 58 * k]
  })
  // Stepping stones curving from the house into the garden.
  for (let i = 0; i < 9; i++) {
    const t = i / 8
    const x = w * (0.42 + Math.sin(t * 2.4) * 0.12), y = h * (0.04 + t * 0.92)
    g.fillStyle = `rgb(${200 + r() * 20}, ${184 + r() * 18}, ${156 + r() * 16})`
    g.beginPath()
    g.ellipse(x, y, 26 + r() * 8, 18 + r() * 6, r() * Math.PI, 0, Math.PI * 2)
    g.fill()
    g.fillStyle = 'rgba(70, 60, 30, 0.25)'
    g.beginPath()
    g.ellipse(x + 4, y + 5, 26, 16, 0, 0, Math.PI * 2)
    g.fill()
  }
  // Flower beds: leafy clumps dotted with blooms.
  const bed = (cx: number, cy: number, rx: number, ry: number, bloom: string[]) => {
    for (let i = 0; i < 260; i++) {
      const a = r() * Math.PI * 2, d = Math.sqrt(r())
      const x = cx + Math.cos(a) * rx * d, y = cy + Math.sin(a) * ry * d
      g.fillStyle = r() < 0.5 ? '#4f6e2c' : '#6b8a38'
      g.beginPath()
      g.arc(x, y, 6 + r() * 7, 0, Math.PI * 2)
      g.fill()
      if (r() < 0.35) {
        g.fillStyle = bloom[Math.floor(r() * bloom.length)]
        g.beginPath()
        g.arc(x + r() * 4, y - r() * 4, 3 + r() * 3, 0, Math.PI * 2)
        g.fill()
      }
    }
  }
  bed(w * 0.16, h * 0.3, 110, 70, ['#f4d36b', '#fff4dc', '#f29a7a'])
  bed(w * 0.78, h * 0.55, 130, 90, ['#e7849c', '#fff4dc', '#c9a2e0'])
  bed(w * 0.2, h * 0.85, 120, 60, ['#f6b55c', '#fff4dc'])
  bed(w * 0.33, h * 0.42, 90, 60, ['#f29a7a', '#fff4dc', '#f4d36b'])
  // Low sun from beyond the garden: a warm wash.
  const sun = g.createLinearGradient(0, 0, 0, h)
  sun.addColorStop(0, 'rgba(255, 200, 120, 0.28)')
  sun.addColorStop(1, 'rgba(255, 200, 120, 0)')
  g.fillStyle = sun
  g.fillRect(0, 0, w, h)
  return toTexture(c)
}

/** The warm card behind the iso diorama (#42): a soft pool of light on warm paper, darker toward the corners. */
export function paintBackdrop(seed: number) {
  const w = 512, h = 320
  const n = makeNoise(seed, 64)
  const [c] = pixels(w, h, (x, y) => {
    const dx = (x / w - 0.5) * 1.3, dy = y / h - 0.42
    const d = Math.min(1, Math.sqrt(dx * dx + dy * dy) * 1.5)
    const fibre = (n(x / 9, y / 9, 3) - 0.5) * 7
    return mixRGB([236, 208, 172], [186, 138, 102], d * d).map((v) => v + fibre) as RGB
  })
  return toTexture(c)
}

/** A warm round glow, bright in the middle and gone at the rim, for light pools seen from above (#42). */
export function paintGlow() {
  const [c, g] = canvas(128, 128)
  const glow = g.createRadialGradient(64, 64, 0, 64, 64, 64)
  glow.addColorStop(0, 'rgba(255, 196, 120, 0.7)')
  glow.addColorStop(0.45, 'rgba(255, 176, 96, 0.28)')
  glow.addColorStop(1, 'rgba(255, 160, 80, 0)')
  g.fillStyle = glow
  g.fillRect(0, 0, 128, 128)
  return toTexture(c)
}
