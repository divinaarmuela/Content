import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

/**
 * Every dashboard page needs a heading of its own.
 *
 * The shell's header title is `md:hidden` — it exists so a phone knows where
 * it is. On a desktop the ONLY thing that names the page is what the page
 * renders, so a page with no `PageTitle` (or no `<h1>`) is a page that opens
 * with no name on it at all. Five of them shipped that way; this stops the
 * sixth.
 *
 * The rules below are deliberately dumb — a grep, not a renderer. They are
 * honest about the three ways a page can be fine without saying `PageTitle`
 * itself, and every exception is named rather than pattern-matched.
 */

const DASHBOARD = join(process.cwd(), 'app', 'dashboard')

/** A page under one of these renders inside a layout that ALWAYS draws a
 *  PageTitle, so the page itself must not draw a second one. */
const LAYOUTS_THAT_TITLE_EVERYTHING = ['clients/[id]', 'scheduler', 'settings']

/**
 * `production/layout.tsx` draws a PageTitle for its own three views ONLY —
 * for anything else (the item page, a shoot's page) it returns bare children.
 * So the two views it covers are listed by hand rather than the whole subtree
 * being waved through.
 */
const TITLED_BY_PRODUCTION_LAYOUT = [
  'production/availability/page.tsx',
  'production/proposals/page.tsx',
]

/**
 * The tracker is the owner's own working page, deliberately outside the
 * restyle and outside version control. It is skipped so this test does not
 * fail on a file the branch never touched.
 */
const CARVE_OUT = ['tracker/page.tsx']

function pages(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) pages(full, found)
    else if (entry === 'page.tsx') found.push(full)
  }
  return found
}

const key = (file: string) => relative(DASHBOARD, file).replace(/\\/g, '/')

/** A page that only calls `redirect()` never renders anything to put a title on. */
const isRedirectOnly = (src: string) => src.includes('redirect(') && !src.includes('return (')

const hasHeading = (src: string) => src.includes('PageTitle') || src.includes('<h1')

/** One hop: a page whose whole body is `<SomeView />` is titled by that view. */
function delegatesToATitledComponent(file: string, src: string): boolean {
  const imports = [...src.matchAll(/from '(\.[^']+)'/g)].map(m => m[1])
  for (const rel of imports) {
    for (const ext of ['.tsx', '/index.tsx']) {
      const target = join(file, '..', rel + ext)
      try {
        if (hasHeading(readFileSync(target, 'utf8'))) return true
      } catch { /* not that file */ }
    }
  }
  return false
}

describe('every dashboard page names itself', () => {
  const all = pages(DASHBOARD).map(key)

  it('finds the dashboard pages at all (a passing sweep over nothing is not a pass)', () => {
    expect(all.length).toBeGreaterThan(40)
    expect(all).toContain('page.tsx')
    expect(all).toContain('editor/page.tsx')
  })

  it('gives each one a PageTitle, an <h1>, or a named reason it needs neither', () => {
    const nameless: string[] = []

    for (const route of all) {
      if (CARVE_OUT.includes(route)) continue
      if (TITLED_BY_PRODUCTION_LAYOUT.includes(route)) continue
      if (LAYOUTS_THAT_TITLE_EVERYTHING.some(p => route.startsWith(`${p}/`))) continue

      const file = join(DASHBOARD, route)
      const src = readFileSync(file, 'utf8')
      if (isRedirectOnly(src)) continue
      if (hasHeading(src)) continue
      if (delegatesToATitledComponent(file, src)) continue
      nameless.push(route)
    }

    expect(nameless).toEqual([])
  })

  it('keeps the five that were fixed in this wave fixed', () => {
    const read = (r: string) => readFileSync(join(DASHBOARD, r), 'utf8')
    // the AI assistant, both routes, through the component they share
    expect(readFileSync(join(DASHBOARD, 'ai', 'Assistant.tsx'), 'utf8')).toContain('PageTitle')
    expect(hasHeading(read('social/[id]/page.tsx'))).toBe(true)
    expect(hasHeading(read('production/shoots/[id]/page.tsx'))).toBe(true)
    // these two are redirects — they render nothing, so a title would be a lie
    expect(isRedirectOnly(read('calendar/page.tsx'))).toBe(true)
    expect(isRedirectOnly(read('production/shoots/page.tsx'))).toBe(true)
  })

  it('still hides the shell heading on desktop — which is why the above matters', () => {
    const shell = readFileSync(join(DASHBOARD, 'ui', 'Shell.tsx'), 'utf8')
    expect(shell).toContain('md:hidden">{pageTitle(path)}</h1>')
  })
})
