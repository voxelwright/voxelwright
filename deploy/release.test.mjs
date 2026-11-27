import assert from 'node:assert/strict'
import test from 'node:test'
import {
  classifyArea,
  cleanTitle,
  compareDeployTags,
  extractIssueRefs,
  extractReleaseSummary,
  findReleaseState,
  formatReleaseTitle,
  nextDeployTag,
  parseDeployTag,
  parseReleaseArgs,
  renderReleaseNotes,
  summarizeTouchedAreas,
} from './release.mjs'

test('parseReleaseArgs parses flags and validates option values', () => {
  assert.deepEqual(parseReleaseArgs([]), {
    help: false, dryRun: false, offline: false, sha: null, since: null, tag: null, date: null,
  })
  const parsed = parseReleaseArgs(['--dry-run', '--offline', '--sha', 'HEAD', '--since', 'HEAD~2', '--tag', 'v2026.11.26.3', '--date', '2026-11-26'])
  assert.equal(parsed.dryRun, true)
  assert.equal(parsed.offline, true)
  assert.equal(parsed.sha, 'HEAD')
  assert.equal(parsed.since, 'HEAD~2')
  assert.equal(parsed.tag, 'v2026.11.26.3')
  assert.equal(parsed.date, '2026-11-26')

  assert.throws(() => parseReleaseArgs(['--bogus']), /Unknown option|unknown argument/)
  assert.throws(() => parseReleaseArgs(['--sha']), /argument missing|requires a value/)
  assert.throws(() => parseReleaseArgs(['--date', '2026/11/26']), /YYYY-MM-DD/)
  assert.throws(() => parseReleaseArgs(['--tag', 'sf-data-1234']), /vYYYY\.MM\.DD\.N/)
  assert.throws(() => parseReleaseArgs(['--offline']), /requires --dry-run/)
})

test('nextDeployTag and compareDeployTags increment numerically and ignore non-deploy tags', () => {
  const existing = [
    'sf-data-5367939661d7a890',
    'eggs-overlay-abcdef0123456789',
    'v2026.11.25.4',
    'v2026.11.26.1',
    'v2026.11.26.9',
    'v2026.11.26.10',
  ]
  assert.equal(nextDeployTag(existing, '2026-11-26'), 'v2026.11.26.11')
  assert.equal(nextDeployTag(existing, '2026-11-27'), 'v2026.11.27.1')
  assert.equal(nextDeployTag([], new Date('2026-11-26T23:59:00Z')), 'v2026.11.26.1')
  assert.ok(compareDeployTags('v2026.11.26.10', 'v2026.11.26.9') > 0)
  assert.equal(parseDeployTag('sf-data-5367939661d7a890'), null)
})

test('cleanTitle and extractIssueRefs normalize issue prefixes and PR suffixes', () => {
  const parsed = cleanTitle('[#61] Vehicle crash damage follow-ups: bent wheels (#67)')
  assert.deepEqual(parsed, {
    title: 'Vehicle crash damage follow-ups: bent wheels',
    prNumber: 67,
    issueNumbers: [61],
  })
  assert.deepEqual(extractIssueRefs('[#61] Title (#67)', 'Closes #61.\nFixes #62'), [61, 62])
})

test('extractReleaseSummary prefers explicit Release notes section verbatim', () => {
  const body = [
    'Closes #70',
    '',
    '## Release notes',
    '<!-- guidance comment -->',
    'Every verified production deploy now publishes a GitHub Release with clear highlights.',
    '',
    '## What changed',
    '- Internal implementation details that should not appear when explicit notes exist.',
    '',
    '## Checks',
    '- `npm run check`: 18 passed',
  ].join('\n')

  const summary = extractReleaseSummary(body, { singleItem: true })
  assert.equal(summary.source, 'explicit')
  assert.equal(summary.markdown, 'Every verified production deploy now publishes a GitHub Release with clear highlights.')
})

test('extractReleaseSummary distills changes and strips checks, bot footers, local paths, and docs-stamp noise', () => {
  const body = [
    'Closes #61.',
    '',
    '### Changes',
    '- **Bent wheels**: Crushed corners now shift and tilt the wheel inward under the fender (`/tmp/probe-after2/`).',
    '- **Repair key**: Bound `F` while driving and added a mobile Repair button.',
    '- **Docs**: Updated `guide/gameplay.md` and verified stamps with `node scripts/docs.mjs`.',
    '',
    '### Checks',
    '- `npm run check -- --ci --webgl`: 18 passed, 0 failed',
    '',
    '## Still missing',
    '- Follow-up tuning.',
    '',
    '🤖 Generated with Claude Code',
  ].join('\n')

  const summary = extractReleaseSummary(body, { singleItem: true })
  assert.equal(summary.source, 'distilled')
  assert.match(summary.markdown, /\*\*Bent wheels\*\*:/)
  assert.match(summary.markdown, /\*\*Repair key\*\*:/)
  assert.doesNotMatch(summary.markdown, /\/tmp\/probe/)
  assert.doesNotMatch(summary.markdown, /verified stamps/)
  assert.doesNotMatch(summary.markdown, /18 passed/)
  assert.doesNotMatch(summary.markdown, /Follow-up tuning/)
  assert.doesNotMatch(summary.markdown, /Generated with/)
})

test('classifyArea and summarizeTouchedAreas prioritize product areas over docs', () => {
  assert.equal(classifyArea(['engine/page/deform.ts', 'guide/engine-page.md']), 'realm')
  assert.equal(classifyArea(['site/static/site.css', 'guide/site.md']), 'site')
  assert.equal(classifyArea(['deploy/release.mjs', '.github/workflows/deploy.yml', 'guide/deploy.md']), 'deploy')
  assert.equal(classifyArea(['guide/building.md', 'README.md']), 'docs')
  assert.deepEqual(
    summarizeTouchedAreas(['engine/page/main.ts', 'deploy/release.mjs', 'guide/deploy.md']),
    ['realm', 'deploy', 'docs'],
  )
})

test('findReleaseState detects idempotent existing release and ignores sf-data releases', () => {
  const tagMap = new Map([
    ['v2026.11.26.2', 'aaaa2222'],
    ['v2026.11.26.1', 'aaaa1111'],
    ['sf-data-5367939661d7a890', 'aaaa3333'],
  ])
  const releases = [
    { tag_name: 'sf-data-5367939661d7a890', draft: false, html_url: 'https://example/data' },
    { tag_name: 'v2026.11.26.1', draft: false, html_url: 'https://example/1' },
    { tag_name: 'v2026.11.26.2', draft: false, html_url: 'https://example/2' },
    { tag_name: 'v2026.11.26.3', draft: true, html_url: 'https://example/draft' },
  ]
  const resolveTag = (t) => tagMap.get(t) ?? null
  const isAncestor = (a, b) => a !== b && a.startsWith('aaaa')

  const already = findReleaseState(releases, { sha: 'aaaa2222', resolveTag, isAncestor })
  assert.equal(already.existing.tag_name, 'v2026.11.26.2')

  const next = findReleaseState(releases, { sha: 'bbbb9999', resolveTag, isAncestor })
  assert.equal(next.existing, null)
  assert.equal(next.previous.tag, 'v2026.11.26.2')
  assert.equal(next.previous.sha, 'aaaa2222')
})

test('formatReleaseTitle and renderReleaseNotes produce clean single-item and multi-item notes', () => {
  const items = [
    {
      prNumber: 67,
      sha: 'a1870d7c1234567890abcdef1234567890abcdef',
      shortSha: 'a1870d7c',
      title: 'Vehicle crash damage follow-ups: bent wheels and repair key',
      issues: [61],
      area: 'realm',
      summary: { source: 'distilled', markdown: '- **Bent wheels**: Crushed corners tuck wheels inward.\n- **Repair key**: Press `F` to repair while driving.' },
    },
    {
      prNumber: 70,
      sha: 'bbbb11111234567890abcdef1234567890abcdef',
      shortSha: 'bbbb1111',
      title: 'Record each deploy as a GitHub Release',
      issues: [70],
      area: 'deploy',
      summary: null,
    },
  ]

  assert.equal(
    formatReleaseTitle('v2026.11.26.2', [items[0]]),
    'v2026.11.26.2 — Vehicle crash damage follow-ups: bent wheels and repair key',
  )
  assert.equal(
    formatReleaseTitle('v2026.11.26.2', items),
    'v2026.11.26.2 — Vehicle crash damage follow-ups: bent wheels and repair key and 1 more change',
  )

  const notes = renderReleaseNotes({
    tag: 'v2026.11.26.2',
    sha: 'bbbb11111234567890abcdef1234567890abcdef',
    previousTag: 'v2026.11.26.1',
    repo: 'voxelwright/voxelwright',
    items,
    pin: '6c8b52e8bd657d85e7445ce255a99758784a7603a35343e5e60a339b6f2ac5d3',
    previousPin: '94869d520e5f0000000000000000000000000000000000000000000000000000',
    dataTag: 'sf-data-5367939661d7a890',
    changedAreas: ['realm', 'deploy'],
    runUrl: 'https://github.com/voxelwright/voxelwright/actions/runs/123',
  })

  assert.match(notes, /## San Francisco Realm & Engine/)
  assert.match(notes, /### Vehicle crash damage follow-ups: bent wheels and repair key \(#67, closes #61\)/)
  assert.match(notes, /## Deploy\n\n- \*\*Record each deploy as a GitHub Release\*\* \(#70\)/)
  assert.match(notes, /updated `94869d520e5f` → `6c8b52e8bd65` \(bundle `sf-data-5367939661d7a890`\)/)
  assert.match(notes, /compare\/v2026\.11\.26\.1\.\.\.v2026\.11\.26\.2/)
})
