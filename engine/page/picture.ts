// A picture someone gave the page (#244): pasted, dropped, picked from a phone's library or taken with its
// camera. It is made small here before it goes anywhere: at most 1568 pixels on its long side, as a JPEG, which
// is as much as a model looks at and a tenth of what a phone's camera makes. It lives in this page's memory
// until it is sent to the helper on the asker's own machine, and is kept nowhere: not by this page across a
// reload, not by the world's server, which never sees it.
import type { Ask } from './ask.ts'

const LONG_MOST = 1568

/** The picture made small: what an ask carries, and an address of the small picture for showing it in the bar (to be let go with `URL.revokeObjectURL`). */
export async function small(file: Blob): Promise<{ picture: NonNullable<Ask['picture']>; shown: string }> {
  // Through an <img>, which turns a phone's photo the way it was held; a canvas of the final size only, so a
  // 48 megapixel photo never needs a canvas of its own size.
  const from = URL.createObjectURL(file), img = new Image()
  try {
    img.src = from
    await img.decode()
    const scale = Math.min(1, LONG_MOST / Math.max(img.naturalWidth, img.naturalHeight))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale))
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale))
    const ctx = canvas.getContext('2d')!
    // What is clear in a PNG is white in a JPEG, not black.
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise<Blob | null>((done) => canvas.toBlob(done, 'image/jpeg', 0.85))
    if (!blob) throw new Error('the picture could not be read')
    const bytes = new Uint8Array(await blob.arrayBuffer())
    let binary = ''
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
    return { picture: { type: 'image/jpeg', data: btoa(binary) }, shown: URL.createObjectURL(blob) }
  } catch {
    throw new Error('that is not a picture this page can read')
  } finally {
    URL.revokeObjectURL(from)
  }
}
