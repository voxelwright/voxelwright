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
  const captions = { beach: 'summer, 2026', cat: 'Biscuit', drawing: 'by Mila', mountains: 'our hike' }
  g.fillText(captions[kind], ix + 6, h - 40)
  return toTexture(c)
}

/** Faded cottage wallpaper over limewash: soft stripes and little painted sprigs. */
export function paintWallpaper(seed: number, base: RGB, w = 1024, h = 1024) {
  const plaster = paintPlaster(seed, base, w, h).image as HTMLCanvasElement
  const [c, g] = canvas(w, h)
  g.drawImage(plaster, 0, 0)
  const r = rng(seed + 11)
  for (let x = 0; x < w; x += 128) {
    g.fillStyle = 'rgba(214,170,120,0.10)'
    g.fillRect(x + 40, 0, 48, h)
    g.fillStyle = 'rgba(255,246,228,0.10)'
    g.fillRect(x + 4, 0, 6, h)
  }
  // Sprigs: a stem, two leaves and a berry on a loose half-drop grid
  const sprig = (x: number, y: number, s: number, a: number) => {
    g.save()
    g.translate(x, y)
    g.rotate(a)
    g.scale(s, s)
    g.strokeStyle = 'rgba(112,124,82,0.26)'
    g.lineWidth = 2.2
    g.beginPath()
    g.moveTo(0, 14)
    g.quadraticCurveTo(3, 0, -2, -14)
    g.stroke()
    g.fillStyle = 'rgba(122,140,88,0.24)'
    for (const [lx, ly, la] of [[-5, 2, -0.8], [5, -4, 0.8]] as const) {
      g.beginPath()
      g.ellipse(lx, ly, 6, 2.6, la, 0, Math.PI * 2)
      g.fill()
    }
    g.fillStyle = 'rgba(196,96,74,0.28)'
    g.beginPath()
    g.arc(-2, -15, 3, 0, Math.PI * 2)
    g.fill()
    g.restore()
  }
  for (let y = 0; y < h; y += 96)
    for (let x = 0; x < w; x += 128) {
      const ox = (y / 96) % 2 ? 64 : 0
      sprig(x + ox + 20 + (r() - 0.5) * 10, y + 48 + (r() - 0.5) * 10, 0.8 + r() * 0.15, (r() - 0.5) * 0.5)
    }
  // Age: uneven fading
  const n = makeNoise(seed + 5, 32)
  const img = g.getImageData(0, 0, w, h)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      const f = 0.94 + (n(x / 220, y / 220, 3) - 0.5) * 0.14
      img.data[i] *= f
      img.data[i + 1] *= f
      img.data[i + 2] *= f * 0.98
    }
  g.putImageData(img, 0, 0)
  return toTexture(c)
}

/** Painted tongue-and-groove panelling: vertical boards with worn edges. */
export function paintPanelling(seed: number, base: RGB, boards = 8, w = 1024, h = 512) {
  const n = makeNoise(seed, 64)
  const bw = w / boards
  const r = rng(seed + 1)
  const tone = Array.from({ length: boards }, () => 0.93 + r() * 0.1)
  const [c] = pixels(w, h, (x, y) => {
    const b = Math.floor(x / bw)
    const bx = x - b * bw
    const brush = n(x / 3, y / 60, 2)
    const wear = n(x / 40, y / 40, 4)
    let t = tone[b] * (0.95 + (brush - 0.5) * 0.08)
    if (bx < 3) t *= 0.55
    else if (bx < 6) t *= 0.85
    else if (bx > bw - 3) t *= 1.06
    const worn = wear > 0.72 && (bx < 10 || bx > bw - 10) ? 1 : 0
    const col = mixRGB(base, [150, 104, 70], worn * 0.6)
    return [col[0] * t, col[1] * t, col[2] * t]
  })
  return toTexture(c)
}

/** A soft flame: hot core, orange body, black edges. Drawn additively. */
export function paintFlame(seed: number) {
  const w = 128, h = 256
  const n = makeNoise(seed, 16)
  const [c] = pixels(w, h, (x, y) => {
    const u = (x / w - 0.5) * 2
    const v = 1 - y / h
    const width = (1 - v) * 0.85 * (0.75 + n(x / 18, y / 26, 3) * 0.5)
    const d = Math.abs(u) / Math.max(width, 0.02)
    const body = Math.max(0, 1 - d) * Math.min(1, v * 6) * (1 - v * 0.6)
    const core = Math.max(0, 1 - d * 1.8) * Math.max(0, 1 - v * 1.6)
    return [Math.min(255, 255 * (body * 1.2 + core)), Math.min(255, 255 * (body * 0.55 + core * 0.9)), Math.min(255, 255 * (body * 0.12 + core * 0.55))]
  })
  return toTexture(c)
}

/** A paper wall calendar for November with a few family marks. */
export function paintCalendar(seed: number) {
  const w = 512, h = 768
  const n = makeNoise(seed, 32)
  const [c, g] = pixels(w, h, (x, y) => {
    const t = 0.97 + (n(x / 24, y / 24, 3) - 0.5) * 0.05
    return [250 * t, 244 * t, 230 * t]
  })
  const sky = g.createLinearGradient(0, 40, 0, 330)
  sky.addColorStop(0, '#f2c891')
  sky.addColorStop(1, '#d98b4d')
  g.fillStyle = sky
  g.fillRect(30, 40, w - 60, 290)
  const r = rng(seed)
  g.fillStyle = '#8f9a5a'
  g.fillRect(30, 260, w - 60, 70)
  for (let i = 0; i < 5; i++) {
    const x = 70 + i * 92, y = 230
    g.fillStyle = '#6a4a30'
    g.fillRect(x - 4, y, 8, 40)
    for (let k = 0; k < 26; k++) {
      g.fillStyle = r() < 0.4 ? '#c8562e' : r() < 0.6 ? '#e09a3e' : '#9a7a3a'
      g.beginPath()
      g.arc(x + (r() - 0.5) * 60, y - 10 + (r() - 0.5) * 44, 7 + r() * 8, 0, Math.PI * 2)
      g.fill()
    }
  }
  g.fillStyle = 'rgba(70,50,40,0.9)'
  g.font = 'bold 44px Georgia, serif'
  g.fillText('November', 36, 392)
  g.strokeStyle = 'rgba(120,90,70,0.35)'
  g.lineWidth = 2
  const gx = 30, gy = 420, cw = (w - 60) / 7, ch = 60
  for (let i = 0; i <= 7; i++) {
    g.beginPath(); g.moveTo(gx + i * cw, gy); g.lineTo(gx + i * cw, gy + ch * 5); g.stroke()
  }
  for (let j = 0; j <= 5; j++) {
    g.beginPath(); g.moveTo(gx, gy + j * ch); g.lineTo(gx + cw * 7, gy + j * ch); g.stroke()
  }
  g.font = '18px Georgia, serif'
  g.fillStyle = 'rgba(80,60,50,0.8)'
  const cell = (d: number) => [gx + ((d + 6) % 7) * cw, gy + Math.floor((d + 6) / 7) * ch] as const
  for (let d = 1; d <= 30; d++) {
    const [x, y] = cell(d)
    g.fillText(String(d), x + 6, y + 22)
  }
  // Family marks: a circled day, a heart and a scribble
  g.strokeStyle = 'rgba(200,60,50,0.8)'
  g.lineWidth = 4
  const [ax, ay] = cell(6)
  g.beginPath()
  g.ellipse(ax + cw / 2, ay + ch / 2, cw * 0.45, ch * 0.42, 0.1, 0, Math.PI * 2)
  g.stroke()
  g.fillStyle = 'rgba(214,90,110,0.9)'
  const [bx, by] = cell(14)
  const hx = bx + cw / 2, hy = by + ch / 2 + 6
  g.beginPath()
  g.moveTo(hx, hy + 12)
  g.bezierCurveTo(hx - 22, hy - 4, hx - 10, hy - 20, hx, hy - 8)
  g.bezierCurveTo(hx + 10, hy - 20, hx + 22, hy - 4, hx, hy + 12)
  g.fill()
  g.strokeStyle = 'rgba(40,90,160,0.75)'
  g.lineWidth = 3
  const [sx0, sy0] = cell(21)
  g.beginPath()
  g.moveTo(sx0 + 8, sy0 + 42)
  for (let i = 1; i < 8; i++) g.lineTo(sx0 + 8 + i * 6, sy0 + 42 + (i % 2 ? -8 : 0))
  g.stroke()
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
  g.fillText('MILA', 236, 120)
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
