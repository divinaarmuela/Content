import { describe, expect, it } from 'vitest'
import { writeFileSync } from 'node:fs'
import { table } from '../../lib/db'
import type { Batch } from '../../lib/db-types'
import {
  STAGE_LABEL, briefChecklist, clientPlanWords, isFootageOnly, nextStepWords, shootStage, stampLines, type SopShoot,
} from '../../app/lib/shoot-sop-core'

/**
 * EVERY REAL SHOOT, READ THROUGH THE REBUILT PAGE'S RULES — read only.
 *
 * "We have live data" (the owner, 13 Sep 2026): every existing shoot must
 * still open and land in the right stage with nothing lost. This reads the
 * whole batches table and runs each row through the same pure functions the
 * page draws from (`shootStage`, `briefChecklist`, `stampLines`,
 * `nextStepWords`, `clientPlanWords`, `isFootageOnly`). Nothing is written.
 *
 *   npx vitest run --config vitest.e2e.config.mts tests/e2e/shoot-live-rows.e2e.ts
 */
const OUT = 'C:/Users/User/AppData/Local/Temp/claude/C--Users-User-myProjects-content/c33ff7c1-ad55-46c0-8973-dffcbb410744/scratchpad/shoot-live-rows.txt'

describe('every real shoot lands in a stage', () => {
  it('reads every batch row through the page’s pure rules without throwing', async () => {
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Australia/Melbourne' })
    const rows = await table<Batch>('batches').list({ fresh: true, limit: 2000 })
    const people = await table<{ id: string; name?: string | null; email?: string | null }>('team_users').list({ fresh: true })
    const nameOf = (id: string | null | undefined) => {
      const p = id ? people.find(u => u.id === id) : null
      return p ? (p.name || p.email || null) : null
    }
    const lines: string[] = [`${rows.length} shoots read ${new Date().toISOString()} (Melbourne ${today})`, '']
    const counts: Record<string, number> = {}
    for (const b of rows) {
      const s = b as unknown as SopShoot
      const stage = shootStage(s, today)
      const list = briefChecklist(s)
      counts[stage] = (counts[stage] ?? 0) + 1
      const log = stampLines(s, nameOf)
      lines.push(`• ${b.title} — ${STAGE_LABEL[stage]} · ${list.words}${isFootageOnly(s) ? ' · footage only' : ''}${clientPlanWords(s) ? ` · ${clientPlanWords(s)}` : ''}`)
      lines.push(`    ${log[0].text} · ${nextStepWords(s, today)}`)
      expect(STAGE_LABEL[stage]).toBeTruthy()
      expect(list.total).toBe(9)
      expect(log.length).toBeGreaterThanOrEqual(7)
    }
    lines.push('', 'by stage: ' + Object.entries(counts).map(([k, n]) => `${STAGE_LABEL[k as keyof typeof STAGE_LABEL]} ${n}`).join(' · '))
    writeFileSync(OUT, lines.join('\n'), 'utf8')
    console.log(lines.join('\n'))
  })
})
