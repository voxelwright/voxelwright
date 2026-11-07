// Painters a theme can name in a role's `paint` (see tokens.ts). Each one paints a
// texture in code, like ../paint.ts; the theme plugin swaps it in for the role's own
// map, restores the original on unload and disposes what it painted.
import type * as THREE from 'three/webgpu'
import { canvas, rng, toTexture } from '../paint'

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
  for (let i = 0; i < 26; i++) {
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

/** Painters by name, as a theme's `paint` names them. */
export const PAINTERS: Record<string, () => THREE.Texture> = {
  'night-city': () => paintNightCity(7),
}
