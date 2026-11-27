// Generates the Voxelwright PWA PNG icon set in deploy/icons/ with zero external dependencies.
// Motif: Voxelmorphism chalk-and-signal-yellow keycap plate with a Vox Block "V" over a dark SF skyline (#10141a).
//
//   node deploy/make-icons.mjs
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deflateSync } from 'node:zlib'

const here = dirname(fileURLToPath(import.meta.url))
const outDir = join(here, 'icons')
mkdirSync(outDir, { recursive: true })

// ── Minimal PNG encoder (RGBA, 8-bit, filter 0) ──
const CRC_TABLE = new Uint32Array(256)
for (let i = 0; i < 256; i++) {
  let c = i
  for (let k = 0; k < 8; k++) c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  CRC_TABLE[i] = c >>> 0
}
function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
function chunk(type, data) {
  const head = Buffer.alloc(8)
  head.writeUInt32BE(data.length, 0)
  head.write(type, 4, 4, 'ascii')
  const body = Buffer.concat([head.subarray(4), data])
  const tail = Buffer.alloc(4)
  tail.writeUInt32BE(crc32(body), 0)
  return Buffer.concat([head, data, tail])
}
function encodePng(width, height, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // RGBA
  const raw = Buffer.alloc((width * 4 + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4)
  }
  const idat = deflateSync(raw, { level: 9 })
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))])
}

const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]
const lerp = (a, b, t) => Math.round(a + (b - a) * t)

function drawIcon(size, { maskable = false } = {}) {
  const buf = Buffer.alloc(size * size * 4)
  const setPx = (x, y, r, g, b, a = 255) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return
    const i = (y * size + x) * 4
    if (a >= 255) {
      buf[i] = r; buf[i + 1] = g; buf[i + 2] = b; buf[i + 3] = 255
      return
    }
    const fa = a / 255
    buf[i] = Math.round(r * fa + buf[i] * (1 - fa))
    buf[i + 1] = Math.round(g * fa + buf[i + 1] * (1 - fa))
    buf[i + 2] = Math.round(b * fa + buf[i + 2] * (1 - fa))
    buf[i + 3] = 255
  }
  const fillRect = (x0, y0, w, h, rgb, a = 255) => {
    const ix0 = Math.max(0, Math.round(x0)), iy0 = Math.max(0, Math.round(y0))
    const ix1 = Math.min(size, Math.round(x0 + w)), iy1 = Math.min(size, Math.round(y0 + h))
    for (let y = iy0; y < iy1; y++) for (let x = ix0; x < ix1; x++) setPx(x, y, rgb[0], rgb[1], rgb[2], a)
  }

  // 1. Background: SF dusk/night sky gradient in the realm's #10141a palette.
  const topSky = hex('#17263f'), midSky = hex('#111826'), lowSky = hex('#0c1017')
  for (let y = 0; y < size; y++) {
    const t = y / (size - 1)
    const c = t < 0.55
      ? [lerp(topSky[0], midSky[0], t / 0.55), lerp(topSky[1], midSky[1], t / 0.55), lerp(topSky[2], midSky[2], t / 0.55)]
      : [lerp(midSky[0], lowSky[0], (t - 0.55) / 0.45), lerp(midSky[1], lowSky[1], (t - 0.55) / 0.45), lerp(midSky[2], lowSky[2], (t - 0.55) / 0.45)]
    for (let x = 0; x < size; x++) setPx(x, y, c[0], c[1], c[2], 255)
  }

  // Subtle voxel grid lines in the upper sky.
  const gridStep = Math.max(8, Math.round(size / 16))
  for (let y = 0; y < size; y += gridStep) fillRect(0, y, size, 1, hex('#243857'), 26)
  for (let x = 0; x < size; x += gridStep) fillRect(x, 0, 1, size, hex('#243857'), 26)

  // 2. Stepped voxel SF skyline silhouette along the bottom third (Transamerica Pyramid + Salesforce Tower + blocks).
  const u = size / 32
  const farSkyline = hex('#1b2940')
  const nearSkyline = hex('#152033')
  // Far skyline towers (in 32x32 voxel units)
  const farBlocks = [
    [0, 23, 5, 9], [5, 20, 4, 12],
    // Transamerica Pyramid stepped spire (left-center)
    [10, 22, 5, 10], [10.5, 19, 4, 3], [11, 16, 3, 3], [11.5, 13, 2, 3], [12, 10, 1, 3],
    // Mid blocks
    [15, 21, 3, 11],
    // Salesforce Tower rounded-voxel obelisk (right-center)
    [18, 14, 4, 18], [18.5, 12, 3, 2], [19, 11, 2, 1],
    [22, 19, 4, 13], [26, 22, 6, 10],
  ]
  for (const [bx, by, bw, bh] of farBlocks) fillRect(bx * u, by * u, bw * u, bh * u, farSkyline)
  const nearBlocks = [
    [0, 26, 7, 6], [7, 25, 6, 7], [13, 27, 6, 5], [19, 24, 5, 8], [24, 26, 8, 6],
  ]
  for (const [bx, by, bw, bh] of nearBlocks) fillRect(bx * u, by * u, bw * u, bh * u, nearSkyline)

  // Warm lit tower window pixels in the background skyline
  const warm = hex('#ffcf6e')
  const winPx = Math.max(2, Math.round(u * 0.45))
  for (const [wx, wy] of [[6.2, 22], [7.4, 24], [19.1, 15.2], [20.3, 15.2], [19.1, 17.4], [20.3, 18.8], [23.2, 21], [24.4, 22.5]]) {
    fillRect(wx * u, wy * u, winPx, winPx, warm, 165)
  }

  // 3. Centerpiece: Voxelmorphism chalk keycap plate with signal yellow left spine & Vox Block "V".
  // Maskable icons stay comfortably inside the W3C 80% safe circle.
  const plateUnits = maskable ? 17.5 : 21.5
  const plateW = plateUnits * u
  const plateH = plateUnits * u
  const px0 = (size - plateW) / 2
  const py0 = (size - plateH) / 2 - (maskable ? 0 : 0.4 * u)
  const v = plateW / 16 // 16x16 voxel grid on the keycap face

  // Hard isometric cast shadow
  fillRect(px0 + v * 1.15, py0 + v * 1.35, plateW, plateH, hex('#04070d'), 205)

  // Lower extruded keycap plinth (cool slate bevel)
  fillRect(px0, py0 + v * 0.9, plateW, plateH, hex('#1f2c42'))
  // Yellow plinth under the left spine
  const spineW = v * 2.2
  fillRect(px0, py0 + v * 0.9, spineW, plateH, hex('#b8b000'))

  // Top face: chalk plate + signal yellow left accent bar
  fillRect(px0, py0, plateW, plateH, hex('#fbfcff'))
  fillRect(px0, py0, spineW, plateH, hex('#fff600'))

  // Top-edge lit bevel & bottom-edge crisp shade (Voxelmorphism lit-top feel)
  fillRect(px0 + spineW, py0, plateW - spineW, Math.max(2, v * 0.45), hex('#ffffff'))
  fillRect(px0, py0, spineW, Math.max(2, v * 0.45), hex('#ffff8a'))
  fillRect(px0 + spineW, py0 + plateH - Math.max(2, v * 0.55), plateW - spineW, Math.max(2, v * 0.55), hex('#d5deec'))
  fillRect(px0, py0 + plateH - Math.max(2, v * 0.55), spineW, Math.max(2, v * 0.55), hex('#e0d800'))

  // 4. Bold Vox Block "V" glyph in deep Voxelwright navy (#0a0f3d), centered on the chalk face.
  // 9x9 crisp pixel-stepped V matching the Vox Block proportions in og-world.png.
  const V_BITMAP = [
    '110000011',
    '110000011',
    '110000011',
    '110000011',
    '110000011',
    '011000110',
    '001101100',
    '000111000',
    '000010000',
  ]
  const navy = hex('#0a0f3d')
  const cobalt = hex('#3b82f6')
  const chalkFaceW = plateW - spineW
  const cell = v * 1.08
  const glyphW = V_BITMAP[0].length * cell
  const glyphH = V_BITMAP.length * cell
  const gx0 = px0 + spineW + (chalkFaceW - glyphW) / 2
  const gy0 = py0 + (plateH - glyphH) / 2 - v * 0.15

  for (let row = 0; row < V_BITMAP.length; row++) {
    for (let col = 0; col < V_BITMAP[row].length; col++) {
      if (V_BITMAP[row][col] === '1') {
        fillRect(gx0 + col * cell, gy0 + row * cell, cell + 0.6, cell + 0.6, navy)
      }
    }
  }
  // Signature cobalt indicator LED voxel in the bottom-right corner of the chalk plate.
  fillRect(px0 + plateW - v * 2.1, py0 + plateH - v * 2.1, v * 1.1, v * 1.1, cobalt)

  return encodePng(size, size, buf)
}

const TARGETS = [
  ['icon-192.png', 192, { maskable: false }],
  ['icon-512.png', 512, { maskable: false }],
  ['icon-maskable-512.png', 512, { maskable: true }],
  ['apple-touch-icon.png', 180, { maskable: false }],
]

for (const [name, size, opts] of TARGETS) {
  const png = drawIcon(size, opts)
  writeFileSync(join(outDir, name), png)
  console.log(`deploy/icons/${name}: ${size}x${size}, ${(png.length / 1024).toFixed(1)} KiB`)
}
