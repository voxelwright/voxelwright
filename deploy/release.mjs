// Record a verified production deploy as a GitHub Release with structured, meaningful release notes.
//
// Usage:
//   node deploy/release.mjs [--dry-run] [--sha <ref>] [--since <ref>] [--tag <tag>] [--date <YYYY-MM-DD>] [--offline]
//
// Runs in `.github/workflows/deploy.yml` immediately after `deploy/publish.sh` confirms both Cloudflare Workers
// (voxelwright.world and zahynailo.dev) are live. Uses `vYYYY.MM.DD.N` tags (UTC date + daily sequence) marked
// Latest so deploy releases stay distinct from `sf-data-*` data bundle releases.
import { execFileSync } from 'node:child_process'
import { appendFileSync, existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = dirname(here)
const DEFAULT_REPO = 'voxelwright/voxelwright'

export const DEPLOY_TAG_RE = /^v(\d{4})\.(\d{2})\.(\d{2})\.(\d+)$/

export const AREAS = [
  { id: 'realm', heading: 'San Francisco Realm & Engine', label: 'realm' },
  { id: 'site', heading: 'Site & Blog', label: 'site' },
  { id: 'deploy', heading: 'Deploy', label: 'deploy' },
  { id: 'master', heading: 'Master Server', label: 'master' },
  { id: 'docs', heading: 'Documentation', label: 'docs' },
  { id: 'other', heading: 'Other', label: 'other' },
]

const AREA_PRIORITY = new Map(AREAS.map((area, index) => [area.id, index]))

const SKIP_HEADING_RE = /^(?:checks?|verification|how\s+it\s+was\s+(?:checked|made|tested)|testing|test\s+plan|(?:crash\s+)?benchmarks?|before\s*\/\s*after|visual|screenshots?|still\s+missing|not\s+done|known\s+gaps?|costs?\b|docs?-unchanged)/i
const RELEASE_NOTES_HEADING_RE = /^release\s+notes\b/i
const CHANGE_HEADING_RE = /^(?:summary|changes|what\s+changed|what\s+changes|highlights|behaviou?r|details|overview)\b/i
const NOISE_LINE_RE = /^(?:(?:closes|fixes|resolves)\s+#\d+\.?|docs-unchanged:.*|🤖\s*generated\s+with.*|co-authored-by:.*|signed-off-by:.*)$/i
const DOCS_ONLY_BULLET_RE = /^[-*]\s+(?:\*\*)?docs(?:\*\*)?\s*:/i
const MERGE_NOISE_RE = /^merge\s+(?:remote-tracking\s+)?branch\s+/i

const RELEASE_OPTIONS = {
  'dry-run': { type: 'boolean', default: false },
  offline: { type: 'boolean', default: false },
  sha: { type: 'string' },
  since: { type: 'string' },
  tag: { type: 'string' },
  date: { type: 'string' },
  help: { type: 'boolean', short: 'h', default: false },
}

export function parseReleaseArgs(argv) {
  const { values, positionals } = parseArgs({
    args: argv,
    options: RELEASE_OPTIONS,
    allowPositionals: true,
    strict: true,
  })
  if (positionals.length) throw new Error(`unknown argument: ${positionals.join(', ')}`)
  const opts = {
    help: Boolean(values.help),
    dryRun: Boolean(values['dry-run']),
    offline: Boolean(values.offline),
    sha: values.sha ?? null,
    since: values.since ?? null,
    tag: values.tag ?? null,
    date: values.date ?? null,
  }
  if (opts.date && !/^\d{4}-\d{2}-\d{2}$/.test(opts.date)) {
    throw new Error(`--date must be YYYY-MM-DD (got ${opts.date})`)
  }
  if (opts.tag && !DEPLOY_TAG_RE.test(opts.tag)) {
    throw new Error(`--tag must match vYYYY.MM.DD.N (got ${opts.tag})`)
  }
  if (opts.offline && !opts.dryRun) {
    throw new Error('--offline requires --dry-run')
  }
  return opts
}

export function parseDeployTag(tag) {
  const m = typeof tag === 'string' ? DEPLOY_TAG_RE.exec(tag) : null
  if (!m) return null
  return {
    year: Number(m[1]),
    month: Number(m[2]),
    day: Number(m[3]),
    seq: Number(m[4]),
  }
}

export function compareDeployTags(a, b) {
  const pa = parseDeployTag(a)
  const pb = parseDeployTag(b)
  if (!pa && !pb) return 0
  if (!pa) return -1
  if (!pb) return 1
  return (pa.year - pb.year) || (pa.month - pb.month) || (pa.day - pb.day) || (pa.seq - pb.seq)
}

export function formatUtcDatePrefix(date = new Date()) {
  if (typeof date === 'string') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`invalid date: ${date}`)
    return `v${date.replaceAll('-', '.')}`
  }
  const yyyy = String(date.getUTCFullYear()).padStart(4, '0')
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(date.getUTCDate()).padStart(2, '0')
  return `v${yyyy}.${mm}.${dd}`
}

export function nextDeployTag(existingTags, date = new Date()) {
  const prefix = formatUtcDatePrefix(date)
  let maxSeq = 0
  for (const tag of existingTags) {
    if (typeof tag !== 'string' || !tag.startsWith(`${prefix}.`)) continue
    const parsed = parseDeployTag(tag)
    if (parsed && parsed.seq > maxSeq) maxSeq = parsed.seq
  }
  return `${prefix}.${maxSeq + 1}`
}

export function cleanTitle(raw) {
  let text = String(raw ?? '').trim()
  const issueNumbers = []
  let prNumber = null

  const leadingIssues = /^((?:\[#\d+\]\s*)+)/.exec(text)
  if (leadingIssues) {
    for (const m of leadingIssues[1].matchAll(/\[#(\d+)\]/g)) {
      const n = Number(m[1])
      if (!issueNumbers.includes(n)) issueNumbers.push(n)
    }
    text = text.slice(leadingIssues[0].length).trim()
  }

  const trailingPr = /\s*\(#(\d+)\)\s*$/.exec(text)
  if (trailingPr) {
    prNumber = Number(trailingPr[1])
    text = text.slice(0, trailingPr.index).trim()
  }

  return { title: text || String(raw ?? '').trim(), prNumber, issueNumbers }
}

export function extractIssueRefs(title, body) {
  const issues = [...cleanTitle(title).issueNumbers]
  const text = String(body ?? '')
  for (const m of text.matchAll(/\b(?:closes|fixes|resolves)\s+#(\d+)\b/gi)) {
    const n = Number(m[1])
    if (!issues.includes(n)) issues.push(n)
  }
  return issues
}

function stripLocalPaths(line) {
  return line
    .replace(/\s*\(`?\/(?:tmp|Users|home)\/[^)`\s]+`?\)/g, '')
    .replace(/`\/(?:tmp|Users|home)\/[^`\s]+`/g, '')
    .trimEnd()
}

function cleanLine(line) {
  const trimmed = line.trim()
  if (!trimmed) return ''
  if (NOISE_LINE_RE.test(trimmed)) return ''
  return stripLocalPaths(line)
}

function splitMarkdownSections(markdown) {
  const sections = [{ heading: null, lines: [] }]
  let inFence = false
  for (const rawLine of markdown.split('\n')) {
    const trimmed = rawLine.trim()
    if (/^```|^~~~/.test(trimmed)) {
      inFence = !inFence
      sections.at(-1).lines.push(rawLine)
      continue
    }
    if (!inFence) {
      const heading = /^#{1,3}\s+(.+?)\s*$/.exec(rawLine)
      if (heading) {
        sections.push({ heading: heading[1].trim(), lines: [] })
        continue
      }
    }
    sections.at(-1).lines.push(rawLine)
  }
  return sections
}

function normalizeBulletsAndParagraphs(lines) {
  const entries = []
  let current = []
  let currentType = null

  const flush = () => {
    if (!current.length) return
    const text = current.join('\n').trim()
    if (text) entries.push({ type: currentType, text })
    current = []
    currentType = null
  }

  for (const rawLine of lines) {
    const cleaned = cleanLine(rawLine)
    const trimmed = cleaned.trim()
    if (!trimmed) {
      flush()
      continue
    }
    if (/^[-*]\s+/.test(trimmed)) {
      flush()
      currentType = 'bullet'
      current.push(`- ${trimmed.replace(/^[-*]\s+/, '')}`)
    } else if (currentType === 'bullet' && /^\s{2,}\S/.test(cleaned)) {
      // Continuation line of a bullet
      current[0] = `${current[0]} ${trimmed}`
    } else if (currentType === 'paragraph') {
      current.push(trimmed)
    } else {
      flush()
      currentType = 'paragraph'
      current.push(trimmed)
    }
  }
  flush()
  return entries
}

function trimEntryText(text, limit) {
  if (text.length <= limit) return text
  const cut = text.slice(0, limit)
  const sentenceEnd = cut.lastIndexOf('. ')
  if (sentenceEnd >= Math.floor(limit * 0.55)) return cut.slice(0, sentenceEnd + 1)
  const semiEnd = cut.lastIndexOf('; ')
  if (semiEnd >= Math.floor(limit * 0.55)) return `${cut.slice(0, semiEnd)}.`
  const wordEnd = cut.lastIndexOf(' ')
  return `${(wordEnd > 40 ? cut.slice(0, wordEnd) : cut).replace(/[,:;(\s]+$/, '')}…`
}

export function extractReleaseSummary(body, { singleItem = false, title = '' } = {}) {
  if (!body || !String(body).trim()) return null
  const normalized = String(body)
    .replace(/\r\n?/g, '\n')
    .replace(/<!--[\s\S]*?-->/g, '')
    .trim()
  if (!normalized) return null

  const sections = splitMarkdownSections(normalized)

  // Priority 1: explicit author-written `## Release notes` / `### Release notes` section.
  const explicit = sections.find((s) => s.heading && RELEASE_NOTES_HEADING_RE.test(s.heading))
  if (explicit) {
    const cleaned = explicit.lines
      .map((line) => cleanLine(line))
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
    if (cleaned) return { source: 'explicit', markdown: cleaned }
  }

  // Priority 2: distill intro and substantive change sections while dropping check/verification logs.
  const maxBullets = singleItem ? 8 : 4
  const maxChars = singleItem ? 1800 : 750
  const maxSingleBullet = singleItem ? 420 : 260

  const keptIntro = []
  const keptBullets = []
  const keptFallbackParagraphs = []
  const normalizedTitle = cleanTitle(title).title.toLowerCase()

  for (const section of sections) {
    if (section.heading && SKIP_HEADING_RE.test(section.heading)) continue
    const entries = normalizeBulletsAndParagraphs(section.lines)
    if (!section.heading) {
      for (const entry of entries) {
        if (entry.type === 'paragraph') {
          if (entry.text.toLowerCase() === normalizedTitle) continue
          keptIntro.push(entry.text)
        } else {
          keptBullets.push(entry.text)
        }
      }
      continue
    }
    const isChangeSection = CHANGE_HEADING_RE.test(section.heading)
    for (const entry of entries) {
      if (entry.type === 'bullet') {
        keptBullets.push(entry.text)
      } else if (isChangeSection) {
        keptFallbackParagraphs.push(entry.text)
      }
    }
  }

  // Drop pure docs-stamp bookkeeping bullets when substantive product/code bullets exist.
  const substantiveBullets = keptBullets.filter((b) => !DOCS_ONLY_BULLET_RE.test(b))
  const finalBullets = substantiveBullets.length ? substantiveBullets : keptBullets

  const out = []
  let chars = 0

  if (keptIntro.length) {
    const introText = trimEntryText(keptIntro[0], singleItem ? 420 : 280)
    out.push(introText)
    chars += introText.length
  }

  if (finalBullets.length) {
    const bulletBlock = []
    for (const bullet of finalBullets) {
      if (bulletBlock.length >= maxBullets) break
      const trimmedBullet = trimEntryText(bullet, maxSingleBullet)
      if (chars + trimmedBullet.length > maxChars && (bulletBlock.length > 0 || out.length > 0)) break
      bulletBlock.push(trimmedBullet)
      chars += trimmedBullet.length
    }
    if (bulletBlock.length) out.push(bulletBlock.join('\n'))
  } else if (!out.length && keptFallbackParagraphs.length) {
    for (const para of keptFallbackParagraphs.slice(0, singleItem ? 3 : 1)) {
      const trimmedPara = trimEntryText(para, singleItem ? 420 : 280)
      if (chars + trimmedPara.length > maxChars && out.length > 0) break
      out.push(trimmedPara)
      chars += trimmedPara.length
    }
  }

  const markdown = out.join('\n\n').trim()
  return markdown ? { source: 'distilled', markdown } : null
}

function areaOfFile(path) {
  const file = String(path ?? '').replaceAll('\\', '/')
  if (file.startsWith('engine/')) return 'realm'
  if (file.startsWith('site/')) return 'site'
  if (file.startsWith('deploy/') || file === '.github/workflows/deploy.yml' || file === '.github/pull_request_template.md') return 'deploy'
  if (file.startsWith('master/')) return 'master'
  if (file.startsWith('guide/') || file.startsWith('scripts/doc') || /\.md$/i.test(file)) return 'docs'
  return 'other'
}

export function classifyArea(files) {
  if (!files?.length) return 'other'
  let best = 'other'
  let bestRank = AREA_PRIORITY.get('other')
  for (const file of files) {
    const area = areaOfFile(file)
    const rank = AREA_PRIORITY.get(area)
    if (rank < bestRank) {
      best = area
      bestRank = rank
    }
  }
  return best
}

export function summarizeTouchedAreas(files) {
  const seen = new Set()
  for (const file of files ?? []) seen.add(areaOfFile(file))
  return AREAS.filter((a) => seen.has(a.id)).map((a) => a.label)
}

function truncateTitle(text, max) {
  if (text.length <= max) return text
  const cut = text.slice(0, max)
  const space = cut.lastIndexOf(' ')
  return `${(space > 24 ? cut.slice(0, space) : cut).replace(/[,:;(\s]+$/, '')}…`
}

export function formatReleaseTitle(tag, items) {
  if (!items.length) return `${tag} — Maintenance deploy`
  if (items.length === 1) return `${tag} — ${truncateTitle(items[0].title, 120)}`
  const sorted = [...items].sort((a, b) => (AREA_PRIORITY.get(a.area) ?? 99) - (AREA_PRIORITY.get(b.area) ?? 99))
  const lead = sorted[0]
  const rest = items.length - 1
  return `${tag} — ${truncateTitle(lead.title, 76)} and ${rest} more ${rest === 1 ? 'change' : 'changes'}`
}

function formatRefBadge(item) {
  const parts = []
  if (item.prNumber) parts.push(`#${item.prNumber}`)
  else if (item.shortSha) parts.push(`\`${item.shortSha}\``)
  const extraIssues = (item.issues ?? []).filter((n) => n !== item.prNumber)
  if (extraIssues.length) {
    const label = item.prNumber ? 'closes' : 'issue'
    parts.push(`${label} ${extraIssues.map((n) => `#${n}`).join(', ')}`)
  }
  return parts.join(', ')
}

export function renderReleaseNotes({
  tag,
  sha,
  previousTag = null,
  repo = DEFAULT_REPO,
  items = [],
  pin = null,
  previousPin = null,
  dataTag = null,
  changedAreas = [],
  runUrl = null,
}) {
  const lines = [
    'Deployed to [voxelwright.world](https://voxelwright.world/) and [zahynailo.dev](https://zahynailo.dev/).',
  ]

  const byArea = new Map()
  for (const item of items) {
    const list = byArea.get(item.area) ?? []
    list.push(item)
    byArea.set(item.area, list)
  }

  for (const area of AREAS) {
    const areaItems = byArea.get(area.id)
    if (!areaItems?.length) continue
    lines.push('', `## ${area.heading}`)
    const detailed = areaItems.some((item) => item.summary?.markdown)
    if (detailed) {
      for (const item of areaItems) {
        const badge = formatRefBadge(item)
        const heading = badge ? `${item.title} (${badge})` : item.title
        lines.push('', `### ${heading}`)
        if (item.summary?.markdown) {
          lines.push('', item.summary.markdown)
        }
      }
    } else {
      lines.push('')
      for (const item of areaItems) {
        const badge = formatRefBadge(item)
        lines.push(badge ? `- **${item.title}** (${badge})` : `- **${item.title}**`)
      }
    }
  }

  if (!items.length) {
    lines.push('', 'Re-deployed current `main` with no new commits since the previous release.')
  }

  const shortSha = sha.slice(0, 8)
  const details = [
    `- **Live**: [voxelwright.world](https://voxelwright.world/) · [zahynailo.dev](https://zahynailo.dev/)`,
    `- **Commit**: [\`${shortSha}\`](https://github.com/${repo}/commit/${sha})`,
  ]
  if (pin) {
    const pinText = previousPin && previousPin !== pin
      ? `updated \`${previousPin.slice(0, 12)}\` → \`${pin.slice(0, 12)}\``
      : `\`${pin.slice(0, 12)}\``
    const bundleNote = dataTag ? ` (bundle \`${dataTag}\`)` : ''
    details.push(`- **SF city pin**: ${pinText}${bundleNote}`)
  }
  if (changedAreas.length) {
    details.push(`- **Changed areas**: ${changedAreas.join(', ')}`)
  }
  if (runUrl) {
    details.push(`- **Workflow run**: ${runUrl}`)
  }
  if (previousTag) {
    details.push(`- **Full changelog**: https://github.com/${repo}/compare/${previousTag}...${tag}`)
  }

  lines.push('', '## Deploy details', '', ...details)
  return `${lines.join('\n')}\n`
}

export function findReleaseState(releases, { sha, resolveTag, isAncestor }) {
  const deployReleases = (releases ?? [])
    .filter((r) => !r.draft && DEPLOY_TAG_RE.test(r.tag_name))
    .sort((a, b) => compareDeployTags(b.tag_name, a.tag_name))

  for (const r of deployReleases) {
    const tagSha = resolveTag(r.tag_name) ?? (typeof r.target_commitish === 'string' && /^[0-9a-f]{40}$/i.test(r.target_commitish) ? r.target_commitish : null)
    if (tagSha === sha) {
      return { existing: r, previous: null }
    }
  }

  for (const r of deployReleases) {
    const tagSha = resolveTag(r.tag_name)
    if (tagSha && tagSha !== sha && isAncestor(tagSha, sha)) {
      return { existing: null, previous: { tag: r.tag_name, sha: tagSha, url: r.html_url } }
    }
  }

  return { existing: null, previous: null }
}

function git(args, { cwd = repoRoot, allowFailure = false } = {}) {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }).trimEnd()
  } catch (err) {
    if (allowFailure) return null
    throw err
  }
}

function resolveToken(env = process.env) {
  if (env.GH_TOKEN) return env.GH_TOKEN
  if (env.GITHUB_TOKEN) return env.GITHUB_TOKEN
  try {
    return execFileSync('gh', ['auth', 'token'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null
  } catch {
    return null
  }
}

function makeGitHubClient({ repo, token }) {
  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'voxelwright-deploy-release',
    'X-GitHub-Api-Version': '2022-11-28',
  }
  if (token) headers.Authorization = `Bearer ${token}`

  async function request(path, { method = 'GET', body = null, okStatuses = [200] } = {}) {
    const res = await fetch(`https://api.github.com${path}`, {
      method,
      headers: body ? { ...headers, 'Content-Type': 'application/json' } : headers,
      body: body ? JSON.stringify(body) : undefined,
    })
    if (!okStatuses.includes(res.status)) {
      const detail = (await res.text()).slice(0, 400)
      const err = new Error(`GitHub API ${method} ${path} returned HTTP ${res.status}: ${detail}`)
      err.status = res.status
      err.detail = detail
      throw err
    }
    return res.status === 204 ? null : res.json()
  }

  return {
    async listReleases() {
      const all = []
      for (let page = 1; page <= 5; page++) {
        const batch = await request(`/repos/${repo}/releases?per_page=100&page=${page}`)
        all.push(...batch)
        if (batch.length < 100) break
      }
      return all
    },
    async getCommitPulls(sha) {
      return request(`/repos/${repo}/commits/${sha}/pulls`)
    },
    async getPull(number) {
      return request(`/repos/${repo}/pulls/${number}`)
    },
    async createRelease(payload) {
      return request(`/repos/${repo}/releases`, { method: 'POST', body: payload, okStatuses: [201] })
    },
  }
}

function readPinAt(ref) {
  if (!ref) return null
  const content = git(['show', `${ref}:engine/sf/pilot/current.json`], { allowFailure: true })
  if (!content) return null
  try {
    return JSON.parse(content).release ?? null
  } catch {
    return null
  }
}

function readLocalDataInfo() {
  let pin = null
  let dataTag = null
  const pinFile = join(repoRoot, 'engine/sf/pilot/current.json')
  const dataFile = join(here, 'data.json')
  if (existsSync(pinFile)) {
    try { pin = JSON.parse(readFileSync(pinFile, 'utf8')).release ?? null } catch {}
  }
  if (existsSync(dataFile)) {
    try { dataTag = JSON.parse(readFileSync(dataFile, 'utf8')).tag ?? null } catch {}
  }
  return { pin, dataTag }
}

function listCommitsInRange(sha, sinceRef) {
  const SEP_REC = '\x1e'
  const SEP_FLD = '\x1f'
  const rangeArgs = sinceRef ? [`${sinceRef}..${sha}`] : ['-n', '1', sha]
  const raw = git(['log', '--first-parent', `--format=%H${SEP_FLD}%s${SEP_FLD}%b${SEP_REC}`, ...rangeArgs])
  if (!raw) return []
  return raw
    .split(SEP_REC)
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk) => {
      const [commitSha, subject = '', body = ''] = chunk.split(SEP_FLD)
      const filesRaw = git(['diff-tree', '--no-commit-id', '--name-only', '-r', '-m', '--first-parent', commitSha], { allowFailure: true }) ?? ''
      const files = filesRaw.split('\n').map((f) => f.trim()).filter(Boolean)
      return { sha: commitSha.trim(), subject: subject.trim(), body: body.trim(), files }
    })
}

async function buildItems(commits, api) {
  const nonMerge = commits.filter((c) => !MERGE_NOISE_RE.test(c.subject))
  const chosen = nonMerge.length ? nonMerge : commits
  const singleItem = chosen.length === 1
  const seenPrs = new Set()
  const items = []

  for (const commit of chosen) {
    const parsedSubject = cleanTitle(commit.subject)
    let prNumber = parsedSubject.prNumber
    let pr = null

    if (api) {
      try {
        if (!prNumber) {
          const pulls = await api.getCommitPulls(commit.sha)
          const merged = pulls.find((p) => p.merged_at) ?? pulls[0]
          if (merged) {
            prNumber = merged.number
            pr = merged
          }
        }
        if (prNumber && !pr) {
          pr = await api.getPull(prNumber)
        }
      } catch (err) {
        console.warn(`release: warning: could not read PR metadata for ${commit.sha.slice(0, 8)}: ${err.message}`)
      }
    }

    if (prNumber && seenPrs.has(prNumber)) continue
    if (prNumber) seenPrs.add(prNumber)

    const rawTitle = pr?.title ?? commit.subject
    const rawBody = pr?.body ?? commit.body
    const cleaned = cleanTitle(rawTitle)
    const issues = extractIssueRefs(rawTitle, `${commit.subject}\n${rawBody}`)
    const summary = extractReleaseSummary(rawBody, { singleItem, title: cleaned.title })

    items.push({
      prNumber: prNumber ?? cleaned.prNumber,
      sha: commit.sha,
      shortSha: commit.sha.slice(0, 8),
      title: cleaned.title,
      issues,
      area: classifyArea(commit.files),
      files: commit.files,
      summary,
      url: pr?.html_url ?? null,
    })
  }

  return items
}

function appendStepSummary(line) {
  const summaryPath = process.env.GITHUB_STEP_SUMMARY
  if (!summaryPath) return
  try {
    appendFileSync(summaryPath, `${line}\n`)
  } catch {}
}

function resolveBootstrapSince(sha, env = process.env) {
  const before = env.DEPLOY_BEFORE_SHA
  if (!before || /^0+$/.test(before)) return null
  const resolved = git(['rev-parse', '--verify', '--quiet', `${before}^{commit}`], { allowFailure: true })
  if (!resolved || resolved === sha) return null
  const ancestor = git(['merge-base', '--is-ancestor', resolved, sha], { allowFailure: true })
  if (ancestor === null) return null
  const count = Number(git(['rev-list', '--first-parent', '--count', `${resolved}..${sha}`], { allowFailure: true }) ?? '999')
  return count > 0 && count <= 30 ? resolved : null
}

async function main() {
  const opts = parseReleaseArgs(process.argv.slice(2))
  if (opts.help) {
    console.log('usage: node deploy/release.mjs [--dry-run] [--sha <ref>] [--since <ref>] [--tag <tag>] [--date <YYYY-MM-DD>] [--offline]')
    return
  }

  const repo = process.env.GITHUB_REPOSITORY || DEFAULT_REPO
  const sha = git(['rev-parse', '--verify', `${opts.sha ?? process.env.GITHUB_SHA ?? 'HEAD'}^{commit}`])
  const token = opts.offline ? null : resolveToken(process.env)
  if (!opts.dryRun && !token) {
    throw new Error('GH_TOKEN (or an authenticated `gh` CLI) is required to create a GitHub Release')
  }
  const api = opts.offline ? null : makeGitHubClient({ repo, token })

  const localTags = (git(['tag', '--list', 'v*'], { allowFailure: true }) ?? '')
    .split('\n')
    .map((t) => t.trim())
    .filter((t) => DEPLOY_TAG_RE.test(t))

  let releases = []
  if (api) {
    releases = await api.listReleases()
  } else {
    releases = localTags.map((tag_name) => ({ tag_name, draft: false }))
  }

  const resolveTag = (tag) => git(['rev-parse', '--verify', '--quiet', `${tag}^{commit}`], { allowFailure: true })
  const isAncestor = (a, b) => git(['merge-base', '--is-ancestor', a, b], { allowFailure: true }) !== null
  const { existing, previous } = findReleaseState(releases, { sha, resolveTag, isAncestor })

  if (existing && !opts.dryRun) {
    const where = existing.html_url ?? existing.tag_name
    console.log(`release: ${sha.slice(0, 8)} is already released as ${existing.tag_name} (${where})`)
    appendStepSummary(`- Release already exists for \`${sha.slice(0, 8)}\`: [${existing.tag_name}](${where}).`)
    return
  }

  const sinceRef = opts.since
    ? git(['rev-parse', '--verify', `${opts.since}^{commit}`])
    : (previous?.sha ?? resolveBootstrapSince(sha, process.env))
  const previousTag = opts.since ? (DEPLOY_TAG_RE.test(opts.since) ? opts.since : null) : (previous?.tag ?? null)

  const allDeployTags = new Set([
    ...localTags,
    ...releases.map((r) => r.tag_name).filter((t) => DEPLOY_TAG_RE.test(t)),
  ])
  const tag = opts.tag ?? nextDeployTag(allDeployTags, opts.date ?? new Date())

  const commits = listCommitsInRange(sha, sinceRef)
  const items = await buildItems(commits, api)
  const allFiles = [...new Set(commits.flatMap((c) => c.files))]
  const changedAreas = summarizeTouchedAreas(allFiles)
  const { pin, dataTag } = readLocalDataInfo()
  const previousPin = sinceRef ? readPinAt(sinceRef) : null
  const runUrl = process.env.GITHUB_RUN_ID
    ? `https://github.com/${repo}/actions/runs/${process.env.GITHUB_RUN_ID}`
    : null

  const title = formatReleaseTitle(tag, items)
  const body = renderReleaseNotes({
    tag,
    sha,
    previousTag,
    repo,
    items,
    pin,
    previousPin,
    dataTag,
    changedAreas,
    runUrl,
  })

  if (opts.dryRun) {
    console.log(`Tag:   ${tag}`)
    console.log(`Title: ${title}`)
    console.log(`Range: ${previousTag ?? sinceRef?.slice(0, 8) ?? '(single commit)'}..${sha.slice(0, 8)} (${items.length} item${items.length === 1 ? '' : 's'})`)
    if (existing) console.log(`Note:  ${sha.slice(0, 8)} is already released as ${existing.tag_name}`)
    console.log('\n---\n')
    console.log(body)
    return
  }

  const createPayload = (releaseTag) => ({
    tag_name: releaseTag,
    target_commitish: sha,
    name: formatReleaseTitle(releaseTag, items),
    body: renderReleaseNotes({
      tag: releaseTag,
      sha,
      previousTag,
      repo,
      items,
      pin,
      previousPin,
      dataTag,
      changedAreas,
      runUrl,
    }),
    draft: false,
    prerelease: false,
    make_latest: 'true',
  })

  let created
  try {
    created = await api.createRelease(createPayload(tag))
  } catch (err) {
    if (err.status === 422 && !opts.tag && /already_exists/i.test(err.detail ?? '')) {
      const refreshed = await api.listReleases()
      const refreshedState = findReleaseState(refreshed, { sha, resolveTag, isAncestor })
      if (refreshedState.existing) {
        const where = refreshedState.existing.html_url ?? refreshedState.existing.tag_name
        console.log(`release: ${sha.slice(0, 8)} is already released as ${refreshedState.existing.tag_name} (${where})`)
        appendStepSummary(`- Release already exists for \`${sha.slice(0, 8)}\`: [${refreshedState.existing.tag_name}](${where}).`)
        return
      }
      const retryTag = nextDeployTag(
        [...allDeployTags, ...refreshed.map((r) => r.tag_name).filter((t) => DEPLOY_TAG_RE.test(t))],
        opts.date ?? new Date(),
      )
      created = await api.createRelease(createPayload(retryTag))
    } else {
      throw err
    }
  }

  console.log(`release: published ${created.tag_name} (${created.html_url})`)
  appendStepSummary(`- Recorded GitHub Release [\`${created.tag_name}\`](${created.html_url}) for \`${sha.slice(0, 8)}\`.`)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(`release: ${err.message}`)
    process.exit(1)
  })
}
