// The SF realm's towers as a picture has them (#450): where Salesforce Tower, the Transamerica Pyramid and the
// towers under the logos are on the page, and what of each box is lit window by night or the Matrix's rain. For the
// checks that a landmark is lit, and takes part in what the city's windows show, as the towers round it do
// (test/sf-boards.mjs, test/sf-eggs.mjs): the owner saw Salesforce Tower dark and out of the Matrix twice.

/**
 * In a page: each tower's box on the picture (client px) and the boxes of what is not tower there (the signs, the
 * banner's cloth). The landmarks' from their own numbers (march.beacons, heroes.rs `night`): Salesforce Tower's
 * shaft from 190 m up to its crown's foot (lower, other towers stand before it) and its crown; the Pyramid's body
 * from 120 m up to its spire's foot and its spire, the middle 10 m and 5 m of them. A logo's tower is the 60 px
 * under its sign's foot.
 */
export const TOWERS = () => {
  const e = globalThis.engine, rect = document.querySelector('canvas').getBoundingClientRect(), v = e.view()
  const on = (c) => { const d = [c[0] - v.eye[0], c[1] - v.eye[1], c[2] - v.eye[2]], far = d[0] * v.forward[0] + d[1] * v.forward[1] + d[2] * v.forward[2]; return { x: (((d[0] * v.right[0] + d[1] * v.right[1] + d[2] * v.right[2]) / (v.tanHalf * (rect.width / rect.height) * far) + 1) / 2) * rect.width, y: ((1 - (d[0] * v.up[0] + d[1] * v.up[1] + d[2] * v.up[2]) / (v.tanHalf * far)) / 2) * rect.height, far } }
  const box = (at, y0, y1, half) => { const lo = on([at[0], at[1] + y0 * 10, at[2]]), hi = on([at[0], at[1] + y1 * 10, at[2]]), w = ((half * 10) / lo.far / v.tanHalf / 2) * rect.height; return { x0: Math.round(lo.x - w), x1: Math.round(lo.x + w), y0: Math.round(hi.y), y1: Math.round(lo.y) } }
  const landmarks = {}, ordinary = {}, signs = []
  for (const b of e.march.beacons) {
    if (!(b.night[7] > 0)) continue
    // (The one whose lit part has rings is the crown's screen: Salesforce Tower. The other's lit part runs to a point: the Pyramid.)
    if (b.night[8] > 0) { landmarks.salesforce = box(b.at, 190, b.night[0] - 4, b.night[2] * 0.8); landmarks["salesforce's crown"] = box(b.at, b.night[0] + 3, b.night[1] - 4, b.night[3] * 0.9) }
    else { landmarks.pyramid = box(b.at, 120, b.night[0] - 6, 5); landmarks["pyramid's spire"] = box(b.at, b.night[0] + 4, b.night[1] - 8, 2.5) }
  }
  for (const r of e.boards.records) {
    const w = e.boards.where(r.id)
    if (!w) continue
    signs.push({ x0: w.x - w.wide / 2 - 4, x1: w.x + w.wide / 2 + 4, y0: w.y - w.high / 2 - 4, y1: w.y + w.high / 2 + 10 })
    if (r.type === 'logo' && w.x > 0 && w.x < rect.width) ordinary[`${r.id}'s tower`] = { x0: Math.round(w.x - w.wide * 0.4), x1: Math.round(w.x + w.wide * 0.4), y0: Math.round(w.y + w.high / 2 + 10), y1: Math.round(w.y + w.high / 2 + 70) }
  }
  const cloth = e.boards.plane?.box
  if (cloth) signs.push({ x0: cloth.x0 - 6, x1: cloth.x1 + 6, y0: cloth.y0 - 6, y1: cloth.y1 + 6 })
  return { landmarks, ordinary, signs }
}

/** A PNG's pixels, read in a page: { w, data }. */
export const pixelsIn = (page, png) => page.evaluate(async (b64) => { const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob()), c = new OffscreenCanvas(bitmap.width, bitmap.height), g = c.getContext('2d'); g.drawImage(bitmap, 0, 0); return { w: bitmap.width, data: Array.from(g.getImageData(0, 0, bitmap.width, bitmap.height).data) } }, png.toString('base64'))

/**
 * The towers' part of the page as its own pixels have it: one picture of the box that holds every tower (the whole
 * page at three pixels to one is more than a page takes back in one answer), with the towers' and the signs' boxes
 * moved to that picture's corner. `towers` is what TOWERS answered.
 */
export const framed = async (page, towers) => {
  const all = Object.values({ ...towers.landmarks, ...towers.ordinary }), size = page.viewportSize()
  const clip = { x: Math.max(0, Math.min(...all.map((b) => b.x0)) - 2), y: Math.max(0, Math.min(...all.map((b) => b.y0)) - 2) }
  clip.width = Math.min(size.width, Math.max(...all.map((b) => b.x1)) + 2) - clip.x; clip.height = Math.min(size.height, Math.max(...all.map((b) => b.y1)) + 2) - clip.y
  const move = (b) => ({ x0: b.x0 - clip.x, x1: b.x1 - clip.x, y0: b.y0 - clip.y, y1: b.y1 - clip.y })
  return { picture: await pixelsIn(page, await page.screenshot({ clip })), boxes: Object.fromEntries(Object.entries({ ...towers.landmarks, ...towers.ordinary }).map(([k, b]) => [k, move(b)])), signs: towers.signs.map(move) }
}

/** Each pixel of a box of a picture that is under no sign: `scale` is the picture's pixels to one of the box's. */
const each = (picture, box, signs, scale, see) => {
  const rows = picture.data.length / 4 / picture.w
  let n = 0
  for (let y = Math.max(0, Math.round(box.y0 * scale)); y < Math.min(rows, box.y1 * scale); y++) for (let x = Math.max(0, Math.round(box.x0 * scale)); x < Math.min(picture.w, box.x1 * scale); x++) {
    if (signs.some((s) => x >= s.x0 * scale && x < s.x1 * scale && y >= s.y0 * scale && y < s.y1 * scale)) continue
    const i = (y * picture.w + x) * 4
    n++
    see(picture.data[i], picture.data[i + 1], picture.data[i + 2])
  }
  return n
}
const round = (v, to = 1) => Math.round(v * 10 ** to) / 10 ** to
/**
 * A tower by night: how much of its box is lit window, percent (a pixel brighter than 90 of 255, whatever its hue: a
 * floor of cold tubes is lit too), and how warm that light is, red over blue (a lamp's is 1.6 and more, a tube's
 * under 1, the night sky's 0.4).
 */
export const lit = (picture, box, signs = [], scale = 1) => {
  let count = 0, red = 0, blue = 0
  const n = each(picture, box, signs, scale, (r, g, b) => { if ((r + g + b) / 3 > 90) { count++; red += r; blue += b } })
  return { litPct: round((count / Math.max(1, n)) * 100), warmth: round(red / Math.max(1, blue), 2) }
}
/** A tower in the Matrix: how much of its box is the rain's green, percent (green 25 or more over red and blue, and 50 or more of 255). */
export const rain = (picture, box, signs = [], scale = 1) => {
  let count = 0
  const n = each(picture, box, signs, scale, (r, g, b) => { if (g - (r + b) / 2 >= 25 && g >= 50) count++ })
  return round((count / Math.max(1, n)) * 100, 2)
}
/**
 * A tower in the Matrix, over time: how far its green moves from one picture to the next, of 255 a pixel. The rain's
 * columns stand where they are on the page and only their heads fall, so how much of one picture is rain is the
 * luck of which columns cross a tower; what falls on it moves, and a tower that shows none of it is still.
 */
export const moved = (before, after, box, signs = [], scale = 1) => {
  const rows = Math.min(before.data.length, after.data.length) / 4 / before.w
  let n = 0, sum = 0
  for (let y = Math.max(0, Math.round(box.y0 * scale)); y < Math.min(rows, box.y1 * scale); y++) for (let x = Math.max(0, Math.round(box.x0 * scale)); x < Math.min(before.w, box.x1 * scale); x++) {
    if (signs.some((s) => x >= s.x0 * scale && x < s.x1 * scale && y >= s.y0 * scale && y < s.y1 * scale)) continue
    const i = (y * before.w + x) * 4 + 1
    n++; sum += Math.abs(before.data[i] - after.data[i])
  }
  return round(sum / Math.max(1, n), 2)
}
