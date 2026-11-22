// The early-alpha notice goes on every page once, before </body> (#450).
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { NOTICE_TAG, withNotice } from './notice.mjs'

test('the notice goes once, just before the last </body>', () => {
  const page = '<html><body><p>a</p></body></html>'
  const once = withNotice(page)
  assert.equal(once, `<html><body><p>a</p>${NOTICE_TAG}\n</body></html>`)
  assert.equal(withNotice(once), once)
})

test('a page with no </body> is refused', () => {
  assert.throws(() => withNotice('<html><p>a</p></html>'), /no <\/body>/)
})
