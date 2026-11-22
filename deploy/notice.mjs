// Puts the early-alpha notice (alpha.js, published at /alpha.js) on a page as assemble.mjs writes it (#450).
export const NOTICE_TAG = '<script src="/alpha.js" defer></script>'

/** The page with the notice's script just before its last </body>; a page with no </body> is an error. */
export function withNotice(html) {
  if (html.includes(NOTICE_TAG)) return html
  const at = html.lastIndexOf('</body>')
  if (at < 0) throw new Error('no </body> to put the alpha notice before')
  return `${html.slice(0, at)}${NOTICE_TAG}\n${html.slice(at)}`
}
