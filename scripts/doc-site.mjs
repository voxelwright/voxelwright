// What Mintlify needs from guide/: every page parses as MDX, has a title and a
// description, and appears exactly once in the navigation of guide/docs.json.
// `mint validate` and `mint broken-links` (the docs-site check) confirm the build.

// Code is shown as written, so a comment or heading inside it is not one.
const prose = body => body.replace(/^(```|~~~)[^\n]*\n[\s\S]*?^\1[ \t]*$/gm, '').replace(/`[^`\n]*`/g, '')

export function frontmatter(content) {
  const block = content.match(/^---\n([\s\S]*?)\n---\n/)
  if (!block) return null
  const fields = Object.fromEntries([...block[1].matchAll(/^(\w+):[ \t]*(.*)$/gm)].map(([, key, value]) => [key, value.trim()]))
  return {fields, body: content.slice(block[0].length)}
}

export function pageProblems(page, content) {
  const errors = []
  const front = frontmatter(content)
  if (!front) return [`${page}: start with YAML frontmatter holding a title and a description`]
  for (const key of ['title', 'description']) if (!front.fields[key]) errors.push(`${page}: frontmatter needs a ${key}`)
  for (const [key, value] of Object.entries(front.fields)) {
    // YAML reads an unquoted `: ` or ` #` as structure, and Mintlify then refuses the page.
    if (!/^(["']).*\1$/.test(value) && /: | #/.test(value)) errors.push(`${page}: quote the frontmatter ${key}, or drop its colon`)
  }
  const text = prose(front.body)
  if (text.includes('<!--')) errors.push(`${page}: Mintlify reads pages as MDX; use {/* comment */}, not <!-- comment -->`)
  if (/^# /m.test(text)) errors.push(`${page}: the frontmatter title is the page heading; start sections at ##`)
  return errors
}

// Page paths in guide/docs.json, wherever the navigation nests them.
export function navigation(config) {
  const pages = []
  const walk = node => {
    if (Array.isArray(node)) node.forEach(walk)
    else if (node && typeof node === 'object') {
      for (const [key, value] of Object.entries(node)) {
        if (key === 'pages' && Array.isArray(value)) value.forEach(item => typeof item === 'string' ? pages.push(item) : walk(item))
        else walk(value)
      }
    }
  }
  walk(config.navigation)
  return pages
}

// Each page's own problems are checked with the page (pageProblems), after any generation.
export function site(paths, docsJson) {
  const errors = []
  const pages = paths.filter(path => /^guide\/[^/]+\.mdx?$/.test(path))
  const listed = navigation(JSON.parse(docsJson))
  const slugs = pages.map(page => page.slice('guide/'.length).replace(/\.mdx?$/, ''))
  for (const slug of slugs) if (!listed.includes(slug)) errors.push(`guide/${slug}.md is missing from the navigation in guide/docs.json`)
  for (const slug of listed) if (!slugs.includes(slug)) errors.push(`guide/docs.json lists ${slug}, which has no page`)
  for (const slug of new Set(listed)) if (listed.indexOf(slug) !== listed.lastIndexOf(slug)) errors.push(`guide/docs.json lists ${slug} twice`)
  return errors
}
