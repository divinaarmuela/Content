import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Meta's reviewer logs into the dashboard (6 Nov 2026). Their docs reject an app that "appears incomplete",
 * and a supplier's name on screen invites the question of whose app is really making the calls. So the pages
 * the reviewer and the screen recordings use never SHOW the word "Zernio". Code names (ZernioEvent, zernio:)
 * and comments are fine — only text a person can read is checked.
 *
 * NOT listed yet: app/dashboard/reports/v2/PlatformSection.tsx — it carries another session's uncommitted
 * report-v2 work; add it here once that lands and its two "Zernio's daily count" lines are reworded.
 */
const REVIEWER_PAGES = [
  'app/dashboard/clients/MdAppDirect.tsx',
  'app/dashboard/clients/[id]/social/page.tsx',
  'app/dashboard/page.tsx',
  'app/dashboard/reports/page.tsx',
  'app/dashboard/reports/ReportFigures.tsx',
  'app/dashboard/scheduler/TodayPanel.tsx',
  'app/dashboard/social/automations/page.tsx',
  'app/dashboard/social/content-tracker/page.tsx',
]

/** drop block comments, JSX comments and line comments, so only code and visible text are left */
function withoutComments(src: string): string {
  return src
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
}

describe('no supplier name on the pages Meta reviews', () => {
  for (const file of REVIEWER_PAGES) {
    it(file, () => {
      const src = withoutComments(readFileSync(join(process.cwd(), file), 'utf8'))
      // \bZernio\b matches the word on its own ("through Zernio", "Zernio’s") but not ZernioEvent or zernio:
      const hits = src.split('\n').filter(l => /\bZernio\b/.test(l))
      expect(hits).toEqual([])
    })
  }
})
