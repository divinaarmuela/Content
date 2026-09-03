import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { EDITOR_LANES, SCHEDULER_LANES } from '../app/lib/work-pages-core'
import { STATUS_LABELS } from '../app/lib/workflow-core'

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
    'I’ll schedule this',
    'Up for grabs',
    'master registry',
    'master database',
    'Briefs in flight',
    'pick up work',
    // wave 2 — the words the three pages and the item page stopped using
    'Briefs being planned',
    'BRIEFS BEING PLANNED',
    'Approved — to schedule',
    'Assets in the edit',
    'New content item',
    'New brief task',
    'Brief in progress',
    'Submit brief for review',
    'Brief revisions done',
    'Choose who schedules',
  ]

  /**
   * The debt, not an excuse. Every entry is a real site this pass was not
   * allowed to touch. Fixing one makes the "no stale entries" test below
   * fail, which is the point: the fix and the entry's removal ship together.
   */
  const KNOWN: Known[] = [
    // the 409 here used to read "This shoot has content items — wrap it
    // instead of deleting". It now says what happens to the pieces instead of
    // naming the table they live in, so this entry has nothing left to track.
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

describe('"brief" is retired — the word is "shoot plan"', () => {
  /**
   * One document, one name. "Brief" survived in half the copy long after the
   * glossary settled on "shoot plan", so the same thing had two names
   * depending on which button you were reading. This sweeps every string a
   * PERSON reads on the three work pages for the word — identifiers
   * (brief_url, shoot_brief, isBriefKind) never match because the word
   * boundary stops at underscores, and the bare status value 'brief' (the
   * batches.status enum) is excluded as a code value, not copy.
   */
  const stripComments = (src: string) =>
    src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*/g, '$1 ')

  const KNOWN: Known[] = []

  const hits: Hit[] = []
  for (const file of FILES) {
    const rel = relative(process.cwd(), file).split(sep).join('/')
    if (!/app\/dashboard\/(editor|scheduler|production)\//.test(rel)) continue
    const flat = stripComments(readFileSync(file, 'utf8'))
    // every quoted string literal on the pages that reads as COPY: it has a
    // space in it, or is the bare word itself. Paths ("…/batch-brief-core"),
    // svg ids ("url(#brief-arrowhead)") and enum values ('brief') never do.
    for (const m of flat.matchAll(/(["'])((?:(?!\1)[^\n])*)\1/g)) {
      const lit = m[2]
      const readsAsCopy = lit.includes(' ') || /^briefs?$/i.test(lit)
      if (lit === 'brief') continue // the batches.status enum value
      if (readsAsCopy && /\bbriefs?\b/i.test(lit)) hits.push({ file: rel, line: 0, text: `"${lit}"` })
    }
    // …and every JSX text node
    for (const m of flat.matchAll(/>([^<{}\n]*\bbriefs?\b[^<{}\n]*)</gi)) {
      hits.push({ file: rel, line: 0, text: `>${m[1].trim()}<` })
    }
  }
  const { unexpected, stale } = split(hits, KNOWN)

  it('no user-facing "brief" is left on the work pages', () => {
    expect(unexpected, `"brief" copy still on screen (the word is "shoot plan"):\n${show(unexpected)}`).toEqual([])
  })

  it('the known list has no stale entries — remove one when its site is fixed', () => {
    expect(stale.map(s => `${s.file} — ${s.contains}`), 'these no longer match; delete them from KNOWN').toEqual([])
  })
})

describe('the columns say the status words, and the claim says one thing', () => {
  // statically imported, not awaited inside the test: both modules are pure,
  // and a dynamic import here made the assertion race the 5s test timeout
  // whenever the suite ran under load — a green/red result that depended on
  // how busy the machine was, which is no result at all
  it('every "approved" column is the status label, never the bare word "Approved"', () => {
    expect(EDITOR_LANES.find(l => l.key === 'approved')?.title).toBe(STATUS_LABELS.approved_for_scheduling)
    expect(SCHEDULER_LANES[0].title).toBe(STATUS_LABELS.approved_for_scheduling)
    expect(STATUS_LABELS.approved_for_scheduling).not.toBe('Approved')
  })

  it('"Take this" is the only claim label in the tree', () => {
    // every ClaimButton either takes the default or says exactly "Take this"
    const hits = sweep(/<ClaimButton[^>]*label=/)
    expect(hits.filter(h => !/label="Take this"/.test(h.text)), `other claim labels:\n${show(hits)}`).toEqual([])
  })

  it('the section people are sent to is the glossary word', () => {
    const constant = readFileSync(join(process.cwd(), 'app', 'lib', 'section-names.ts'), 'utf8')
    expect(constant).toMatch(/SHOOT_PLAN_SECTION = 'Shoot plans'/)
  })

  it('every work page and the item page carry a Getting started panel', () => {
    for (const rel of [
      'app/dashboard/editor/page.tsx',
      'app/dashboard/scheduler/page.tsx',
      'app/dashboard/production/page.tsx',
      'app/dashboard/production/[id]/page.tsx',
    ]) {
      const src = readFileSync(join(process.cwd(), rel), 'utf8')
      expect(src, `${rel} has no Getting started panel`).toMatch(/<GettingStarted /)
    }
  })

  it('no developer word is shown on the work pages', () => {
    // identifiers may say batch_id and uses_media all they like; what is
    // banned is the word inside a string or a JSX text node — the part a
    // person reads. Scoped to the three pages and the item page.
    const jsxText = />[^<{}\n]*\b(ad-hoc|adhoc|reconcile)\b[^<{}\n]*</i
    const stringLit = /["'][^"'\n]*\b(ad-hoc|adhoc|reconcile)\b[^"'\n]*["']/i
    const hits = [...sweep(jsxText), ...sweep(stringLit)]
      .filter(h => /app\/dashboard\/(editor|scheduler|production)\//.test(h.file))
      .filter(h => !/^(import|\/\/|\*|\/\*)/.test(h.text))
    expect(hits, `developer words on screen:\n${show(hits)}`).toEqual([])
  })

  it('nothing on the work pages is hover-only', () => {
    const sites = sweep(/opacity-0 group-hover:opacity-100/)
      .filter(h => /app\/dashboard\/(editor|scheduler|production)\//.test(h.file))
    expect(sites, `hover-only controls:\n${show(sites)}`).toEqual([])
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
