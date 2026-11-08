// Headless Chrome page that serves this directory at http://plan.local/ so draw.mjs can import geom.mjs.
import { readFile } from 'node:fs/promises'
import { dirname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const here = dirname(fileURLToPath(import.meta.url))

export async function openDrawPage() {
  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  const page = await browser.newPage()
  await page.route('http://plan.local/**', async (route) => {
    const rel = normalize(new URL(route.request().url()).pathname).replace(/^\/+/, '')
    if (rel === '') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><canvas id=c></canvas><script type=module src="/draw.mjs"></script>' })
    const body = await readFile(join(here, rel))
    route.fulfill({ body, contentType: rel.endsWith('.png') ? 'image/png' : 'text/javascript' })
  })
  await page.goto('http://plan.local/')
  await page.waitForFunction(() => window.draw)
  await page.evaluate(() => document.fonts.ready)
  const png = async () => Buffer.from((await page.evaluate(() => document.getElementById('c').toDataURL('image/png'))).split(',')[1], 'base64')
  return { browser, page, png }
}
