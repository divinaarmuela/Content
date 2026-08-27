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
    { file: 'app/dashboard/notifications/page.tsx', contains: 'r.event_type.replace(/_/g',
      why: 'event_type is an internal event name, not an item status' },
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
