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

export function paintPlaster(seed: number, base: RGB, w = 1024, h = 1024) {
  const n = makeNoise(seed, 64)
  const [c, g] = pixels(w, h, (x, y) => {
    const m = n(x / 160, y / 160, 5)
    const s = n(x / 14 + 50, y / 40, 2)
    const t = 0.9 + (m - 0.5) * 0.22 + (s - 0.5) * 0.06
    return [base[0] * t, base[1] * t, base[2] * t * 0.98]
  })
  // Broad limewash brush strokes
  const r = rng(seed + 3)
  g.globalAlpha = 0.05
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
  const tree = (x: number, y: number, s: number, dark: string, light: string) => {
    g.fillStyle = '#5b4632'
    g.fillRect(x - s * 0.05, y - s * 0.2, s * 0.1, s * 0.6)
    for (let i = 0; i < 70; i++) {
      const a = r() * Math.PI * 2, d = Math.sqrt(r()) * s * 0.5
      const px = x + Math.cos(a) * d, py = y - s * 0.55 + Math.sin(a) * d * 0.85
      const lit = (px - x) < 0 ? 0.65 : 0.25 // sun from the left
      g.fillStyle = r() < lit ? light : dark
      g.globalAlpha = 0.85
      g.beginPath()
      g.ellipse(px, py, s * (0.06 + r() * 0.08), s * (0.05 + r() * 0.06), r() * 3, 0, Math.PI * 2)
      g.fill()
    }
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
  const captions = { beach: 'summer, 2026', cat: 'Biscuit', drawing: 'by Mila', mountains: 'our hike' }
  g.fillText(captions[kind], ix + 6, h - 40)
  return toTexture(c)
}
