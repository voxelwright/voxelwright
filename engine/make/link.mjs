// A link given with a wish (#244): the helper fetches it itself, and what it finds is material for the model to
// look at, never instruction. Only public hosts are asked: this runs on the asker's own machine, inside their
// home network and tailnet, and an address is whatever someone typed or a page redirected to.
//
// So every hop is checked the same way: http or https on its usual port, a name that resolves only to public
// addresses, and the connection made to the very address that was checked (a name cannot answer one thing to the
// check and another to the fetch). Nothing is sent but the request: no cookie, no login, a plain agent's name.
import { lookup } from 'node:dns/promises'
import http from 'node:http'
import https from 'node:https'
import { BlockList, isIP } from 'node:net'

/** Addresses that are not the public internet: this machine, private and shared networks (a tailnet's among them), link-local, test and special ranges. */
const NOT_PUBLIC = new BlockList()
for (const [net, bits] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 3]]) NOT_PUBLIC.addSubnet(net, bits, 'ipv4')
// Of IPv6 only the global unicast block is public, less the parts of it that carry an IPv4 address or are for documents.
const V6_PUBLIC = new BlockList(), V6_NOT = new BlockList()
V6_PUBLIC.addSubnet('2000::', 3, 'ipv6')
for (const [net, bits] of [['2001::', 23], ['2001:db8::', 32], ['2002::', 16], ['3fff::', 20]]) V6_NOT.addSubnet(net, bits, 'ipv6')
export const isPublic = (address, family) => (family === 4 ? !NOT_PUBLIC.check(address, 'ipv4') : V6_PUBLIC.check(address, 'ipv6') && !V6_NOT.check(address, 'ipv6'))

export const BYTES_MOST = 3 << 20, HOPS_MOST = 4, WAIT_MS = 8000, TEXT_MOST = 3000
const PICTURES = ['image/png', 'image/jpeg', 'image/webp']
class NotFetched extends Error {}
const no = (why) => { throw new NotFetched(why) }

/** One request to one address that was checked. Resolves to { status, headers, body } with at most BYTES_MOST of body. */
async function once(url, resolve, deadline) {
  if (!['http:', 'https:'].includes(url.protocol)) no('a link is an http or https address')
  if (url.port || url.username || url.password) no('a link has no port and no login in it')
  const host = url.hostname.replace(/^\[|\]$/g, '')
  const found = isIP(host) ? [{ address: host, family: isIP(host) }] : await resolve(host).catch(() => no('that address was not found'))
  // Every address the name has must be public: one private one among them is how a name is pointed inwards.
  if (!found.length || !found.every((a) => isPublic(a.address, a.family))) no('that address is not on the public internet')
  const to = found[0]
  return new Promise((done, fail) => {
    const req = (url.protocol === 'https:' ? https : http).request(url, {
      method: 'GET', agent: false, timeout: Math.max(1, deadline - Date.now()),
      // The address that was checked, and no other: the name is not looked up again.
      lookup: (_name, options, cb) => (options.all ? cb(null, [to]) : cb(null, to.address, to.family)),
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; link-reader)', Accept: 'text/html,image/png,image/jpeg,image/webp;q=0.9', 'Accept-Encoding': 'identity' },
    }, (res) => {
      // The address the socket is really joined to is looked at once more.
      const peer = res.socket.remoteAddress ?? '', family = isIP(peer)
      if (!family || !isPublic(peer.replace(/^::ffff:/, ''), isIP(peer.replace(/^::ffff:/, '')))) { req.destroy(); return fail(new NotFetched('that address is not on the public internet')) }
      if (res.headers['content-encoding'] && res.headers['content-encoding'] !== 'identity') { req.destroy(); return fail(new NotFetched('that page came packed in a way that is not read')) }
      const parts = []
      let size = 0
      res.on('data', (c) => { size += c.length; if (size > BYTES_MOST) { req.destroy(); fail(new NotFetched('that is too big to read')) } else parts.push(c) })
      res.on('end', () => done({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(parts) }))
      res.on('error', () => fail(new NotFetched('that address stopped answering')))
    })
    req.on('timeout', () => { req.destroy(); fail(new NotFetched('that address took too long')) })
    req.on('error', (e) => fail(e instanceof NotFetched ? e : new NotFetched('that address could not be reached')))
    req.end()
  })
}

/** Follows a link, every hop checked. Resolves to { url, type, body }. */
async function get(link, resolve, deadline) {
  let url = URL.parse(link) ?? no('a link is an http or https address')
  for (let hop = 0; hop <= HOPS_MOST; hop++) {
    if (Date.now() > deadline) no('that address took too long')
    const res = await once(url, resolve, deadline)
    if (res.status >= 300 && res.status < 400 && res.headers.location) { url = URL.parse(res.headers.location, url) ?? no('that address sends on to somewhere that is not one'); continue }
    if (res.status !== 200) no(`that address answered ${res.status}`)
    return { url, type: String(res.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase(), body: res.body }
  }
  no('that address sends on too many times')
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }
const plain = (s) => s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e) => (e[0] === '#' ? String.fromCodePoint(Math.min(0x10ffff, parseInt(e.slice(e[1] === 'x' || e[1] === 'X' ? 2 : 1), e[1] === 'x' || e[1] === 'X' ? 16 : 10) || 32)) : ENTITIES[e.toLowerCase()] ?? m)).replace(/[^\P{C}\n]|\p{Zl}|\p{Zp}/gu, ' ').replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim()
/** What a page says, as words: its title, how it describes itself, and its text without its markup, scripts or styles. And the picture it names as its own, if it does. */
export function words(html, base) {
  const meta = (name) => { const m = new RegExp(`<meta[^>]+(?:property|name)=["']${name}["'][^>]*>`, 'i').exec(html)?.[0]; return m ? plain(/content=["']([^"']*)["']/i.exec(m)?.[1] ?? '') : '' }
  const title = meta('og:title') || plain(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? ''), about = meta('og:description') || meta('description')
  const body = plain(html.replace(/<(script|style|noscript|svg|template|head|nav|footer|form)\b[\s\S]*?<\/\1>/gi, ' ').replace(/<!--[\s\S]*?-->/g, ' ').replace(/<\/(p|div|h[1-6]|li|tr|br|section|article)>|<br\s*\/?>/gi, '\n').replace(/<[^>]*>/g, ' '))
  const text = [title && `Title: ${title}`, about && `About: ${about}`, body].filter(Boolean).join('\n').slice(0, TEXT_MOST)
  const image = meta('og:image')
  return { text, image: image ? URL.parse(image, base)?.href : undefined }
}

/**
 * What a link holds, for the model to look at: { from, text?, picture? }. `from` is the host it came from in the
 * end. A link to a picture gives the picture; a link to a page gives its words and, if it names one, its picture.
 * Throws an Error with a reason a person can be told if it is not public, not there, too big or neither of those.
 */
export async function fetched(link, { resolve = (host) => lookup(host, { all: true }), wait = WAIT_MS } = {}) {
  const deadline = Date.now() + wait
  const got = await get(link, resolve, deadline)
  if (PICTURES.includes(got.type)) return { from: got.url.hostname, picture: { type: got.type, data: got.body.toString('base64') } }
  if (got.type !== 'text/html' && got.type !== 'text/plain') no('that link is neither a page nor a picture (png, jpeg, webp)')
  const page = got.type === 'text/html' ? words(got.body.toString('utf8'), got.url) : { text: plain(got.body.toString('utf8')).slice(0, TEXT_MOST) }
  let picture
  // The page's own picture, if it can be had the same careful way in the time left. Without it the words do.
  if (page.image) try { const p = await get(page.image, resolve, deadline); if (PICTURES.includes(p.type)) picture = { type: p.type, data: p.body.toString('base64') } } catch { /* the words do */ }
  if (!page.text && !picture) no('nothing could be read at that link')
  return { from: got.url.hostname, text: page.text, picture }
}
export const notFetched = (e) => e instanceof NotFetched
