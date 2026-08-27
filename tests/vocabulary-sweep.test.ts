import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

/**
 * The words on screen, swept from the source itself.
 *
 * workflow-core.test.ts guards the label CONSTANTS. This guards everything
 * else: a raw database status printed with `.replace(/_/g, ' ')`, or a label
 * from the old one-board vocabulary hard-coded into a component. Those are the
 * two ways jargon has repeatedly got back onto the screen, and neither shows
 * up in a test of the constants — so they are checked against the tree.
 *
 * KNOWN is the debt list, not an excuse: each entry is a real site the sweep
 * found and this task was not allowed to change. Fixing one makes the "no
 * stale entries" test fail, which is the point — the fix and the entry's
 * removal ship together.
 */

const APP = join(process.cwd(), 'app')

type Hit = { file: string; line: number; text: string }

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) sourceFiles(full, out)
    else if (/\.(ts|tsx)$/.test(name)) out.push(full)
  }
  return out
}

const FILES = sourceFiles(APP)

function sweep(pattern: RegExp): Hit[] {
  const hits: Hit[] = []
  for (const file of FILES) {
    const rel = relative(process.cwd(), file).split(sep).join('/')
    readFileSync(file, 'utf8').split(/\r?\n/).forEach((text, i) => {
      if (pattern.test(text)) hits.push({ file: rel, line: i + 1, text: text.trim() })
    })
  }
  return hits
}

/** file + a distinguishing fragment of the line, so the exemption is narrow. */
type Known = { file: string; contains: string; why: string }

function split(hits: Hit[], known: Known[]) {
  const matched = new Set<Known>()
  const unexpected = hits.filter(h => {
    const k = known.find(k => k.file === h.file && h.text.includes(k.contains))
    if (k) { matched.add(k); return false }
    return true
  })
  return { unexpected, stale: known.filter(k => !matched.has(k)) }
}

const show = (hits: Hit[]) => hits.map(h => `${h.file}:${h.line}  ${h.text}`).join('\n')

describe('no raw database words reach the screen', () => {
  // Not every underscore-stripping is a status: a base64url decode and a
  // metrics-key fallback are legitimate. The ones that ARE statuses are the
  // debt.
  const KNOWN: Known[] = [
    { file: 'app/dashboard/production/[id]/page.tsx', contains: 'status.replace(/_/g',
      why: 'publishStatusWord renders a SCHEDULE ROW publish_status — an integration state, not an item status. "scheduled" and "published" get real words; the underscore strip is only the tidy-up for an unmapped provider state, and is correct here.' },
    { file: 'app/dashboard/social/[id]/page.tsx', contains: "METRIC_LABEL[k] ?? k.replace(/_/g",
      why: 'fallback for an unmapped analytics metric key, not an item status' },
    { file: 'app/lib/gmail-core.ts', contains: "replace(/-/g, '+').replace(/_/g",
      why: 'base64url → base64 decoding; nothing to do with words on screen' },
    { file: 'app/lib/timezone-core.ts', contains: "last.replace(/_/g",
      why: 'the city out of an IANA zone id — "Los_Angeles" is IANA\'s spelling of a place name, not a database status word' },
  ]

  const hits = sweep(/replace\(\/_\/g/)
  const { unexpected, stale } = split(hits, KNOWN)

  it('no NEW `.replace(/_/g, …)` has appeared in app/', () => {
    expect(unexpected, `underscore-stripping outside the known sites:\n${show(unexpected)}`).toEqual([])
  })

  it('the known list has no stale entries — remove one when its site is fixed', () => {
    expect(stale.map(s => `${s.file} — ${s.contains}`), 'these no longer match; delete them from KNOWN').toEqual([])
  })
})

describe('the one-board vocabulary is gone', () => {
  // Every phrase the three-pages build retired. "Mark scheduled" is NOT here:
  // it is the scheduler's own words and it stays.
  const RETIRED = [
    'Hand to a scheduler',
    'Assign changes to editor',
    'client bypass',
    'Approve for scheduling',
    'Mark revision complete',
    'Request revisions',
    'Fixed — send back',
    'Request further revisions',
  ]

  const KNOWN: Known[] = [
    { file: 'app/api/production/items/route.ts', contains: 'Hand to a scheduler',
      why: 'a code comment describing the retired action; no user ever reads it' },
    { file: 'app/lib/brief-task-core.ts', contains: 'Approve for scheduling',
      why: 'a code comment quoting the content-pipeline wording it deliberately overrides' },
  ]

  // whole-file, whitespace-collapsed, comment markers stripped: a label
  // wrapped across two lines by the formatter is still the label, and a
  // line-by-line grep would miss it
  const hits: Hit[] = []
  for (const file of FILES) {
    const rel = relative(process.cwd(), file).split(sep).join('/')
    const flat = readFileSync(file, 'utf8')
      .replace(/^[ \t]*(\/\/+|\*)[ \t]?/gm, '')
      .replace(/\s+/g, ' ')
    for (const phrase of RETIRED) {
      if (flat.includes(phrase)) hits.push({ file: rel, line: 0, text: phrase })
    }
  }
  const { unexpected, stale } = split(hits, KNOWN)

  it('no retired label is in app/', () => {
    expect(unexpected, `retired vocabulary still in the tree:\n${show(unexpected)}`).toEqual([])
  })

  it('the known list has no stale entries — remove one when its site is fixed', () => {
    expect(stale.map(s => `${s.file} — ${s.contains}`), 'these no longer match; delete them from KNOWN').toEqual([])
  })

  it('"Mark scheduled" survived the sweep — it is the scheduler\'s own word', () => {
    const kept = sweep(/Mark scheduled/)
    expect(kept.length).toBeGreaterThan(0)
  })
})

describe('the canonical words are the only words', () => {
  /**
   * One thing had six names — item, content item, asset, job, piece, work —
   * and a second thing had four: shoot, batch, brief, brief task. Taking a job
   * had four verbs. This is the list of the losing side.
   *
   * Phrases, never bare words: "batch" appears in a hundred identifiers and a
   * table name, and a sweep that fails on those teaches people to disable the
   * sweep. What is banned is what a PERSON reads.
   */
  const RETIRED = [
    'content item',
    'brief task',
    'Brief task',
    'Take this job',
    'Take this task',
    "I'll schedule this",
    'Up for grabs',
    'master registry',
    'master database',
    'Briefs in flight',
    'pick up work',
  ]

  /**
   * The debt, not an excuse. Every entry is a real site this pass was not
   * allowed to touch — the three role pages and the item detail page were
   * being rewritten by someone else at the time. Fixing one makes the "no
   * stale entries" test below fail, which is the point: the fix and the
   * entry's removal ship together.
   */
  const KNOWN: Known[] = [
    { file: 'app/dashboard/editor/page.tsx', contains: 'content item',
      why: 'wave 2: the Editor board — "New content item" button' },
    { file: 'app/dashboard/editor/page.tsx', contains: 'Take this job',
      why: 'wave 2: the Editor board — claim button label' },
    { file: 'app/dashboard/production/NewItemDialog.tsx', contains: 'content item',
      why: 'wave 2: the create dialog title and its success toast' },
    { file: 'app/dashboard/production/NewItemDialog.tsx', contains: 'brief task',
      why: 'wave 2: the create dialog — "New brief task" and the comment explaining the shoot picker' },
    { file: 'app/dashboard/production/NewItemDialog.tsx', contains: 'Brief task',
      why: 'wave 2: the create dialog success toast' },
    { file: 'app/dashboard/production/page.tsx', contains: 'content item',
      why: 'wave 2: the Production board — a comment describing when items exist' },
    { file: 'app/dashboard/production/page.tsx', contains: 'brief task',
      why: 'wave 2: the Production board — chip label and surrounding copy' },
    { file: 'app/dashboard/production/page.tsx', contains: 'Brief task',
      why: 'wave 2: the Production board — the chip on a shoot-plan card' },
    { file: 'app/dashboard/production/page.tsx', contains: 'Take this task',
      why: 'wave 2: the Production board — claim button label' },
    { file: 'app/dashboard/production/[id]/page.tsx', contains: 'Take this job',
      why: 'wave 2: the item detail page — claim button label' },
    { file: 'app/dashboard/production/[id]/page.tsx', contains: "I'll schedule this",
      why: 'wave 2: the item detail page — the scheduler claim label' },
    { file: 'app/api/production/batches/[id]/route.ts', contains: 'content item',
      why: 'a 409 message and a file comment; the API vocabulary follows the screens, not the other way round' },
    { file: 'app/api/production/items/route.ts', contains: 'brief task',
      why: 'a 409 message and two comments on the create path' },
    { file: 'app/dashboard/production/[id]/page.tsx', contains: 'content item',
      why: 'wave 2: the item detail page — the shoot-booked line on a shoot plan' },
    { file: 'app/lib/brief-task-core.ts', contains: 'content item',
      why: 'the reason string on a blocked edge; it moves with the Production board' },
    { file: 'app/lib/production-publish.ts', contains: 'content item',
      why: 'a console.error for a developer, not a screen' },
    { file: 'app/lib/publish.ts', contains: 'content item',
      why: 'an API error string on the publish path; wave 2 with the board' },
    { file: 'app/lib/glossary-core.ts', contains: 'brief task',
      why: 'DELIBERATE: the glossary defines "shoot plan" BY naming the old word, which is the only way somebody who has only ever seen "brief task" finds the entry' },
  ]

  /**
   * Comments are STRIPPED here, unlike the sweep above. That sweep is hunting
   * a code pattern, where a comment is evidence; this one is hunting words a
   * person reads, and a doc comment explaining that `batches` is the shoot
   * table is not a word anybody reads. Keeping them turned the list into
   * thirty library files and taught nobody anything.
   */
  const stripComments = (src: string) =>
    src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*/g, '$1 ')

  const hits: Hit[] = []
  for (const file of FILES) {
    const rel = relative(process.cwd(), file).split(sep).join('/')
    const flat = stripComments(readFileSync(file, 'utf8')).replace(/\s+/g, ' ')
    for (const phrase of RETIRED) {
      if (flat.includes(phrase)) hits.push({ file: rel, line: 0, text: phrase })
    }
  }
  const { unexpected, stale } = split(hits, KNOWN)

  it('no retired word is on a screen', () => {
    expect(unexpected, `the old vocabulary is back:
${show(unexpected)}`).toEqual([])
  })

  it('the known list has no stale entries — remove one when its site is fixed', () => {
    expect(stale.map(s => `${s.file} — ${s.contains}`), 'these no longer match; delete them from KNOWN').toEqual([])
  })

  it('the section people are sent to has exactly one spelling', () => {
    // three strings named one place on one screen, and two of them were wrong
    const constant = readFileSync(join(process.cwd(), 'app', 'lib', 'section-names.ts'), 'utf8')
    expect(constant).toMatch(/SHOOT_PLAN_SECTION/)
    // only the constant's own explanation may still name the old spelling
    const others = sweep(/Briefs in flight/).filter(h => h.file !== 'app/lib/section-names.ts')
    expect(others).toEqual([])
  })
})

describe('the overview sends people to the right page', () => {
  const overview = readFileSync(join(APP, 'dashboard', 'page.tsx'), 'utf8')

  it('board links go to Editor and Scheduler, never to the old combined board', () => {
    // a bare '/dashboard/production' from the overview would be the one board
    // again; Production is reached from the sidebar, and item deep links
    // (/dashboard/production/<id>) are the detail page, not a board
    expect(overview).not.toMatch(/['"`]\/dashboard\/production['"`]/)
    expect(overview).toContain('/dashboard/editor')
    expect(overview).toContain('/dashboard/scheduler')
  })

  it('Production is still reachable — from the sidebar, as the shoots page', () => {
    const layout = readFileSync(join(APP, 'dashboard', 'layout.tsx'), 'utf8')
    expect(layout).toMatch(/href: '\/dashboard\/production'/)
  })
})
