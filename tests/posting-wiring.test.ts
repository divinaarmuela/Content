import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * THE SEAMS BETWEEN THE POSTING PACKAGES (the posting rebuild, 29 Sep 2026).
 * P1's engine hands every team notice to `deps.notify`; P7 wrote the sender.
 * P7 wrote the 24h / 1h reminder sweep; P2 owns the dispatcher it runs in.
 * Each package tested its own half. These pins make sure the halves stay joined.
 */
describe('the posting packages are wired together', () => {
  it("the engine's default notify is P7's sendPostNotice, not a no-op", () => {
    const s = readFileSync('app/lib/post-stage.ts', 'utf8')
    expect(s).toContain("notify: async notice => { const { sendPostNotice } = await import('./post-notify'); await sendPostNotice(notice) },")
    expect(s).not.toContain('notify: async () => {},')
  })
  it('the approval reminders run inside the existing publish dispatcher (no new function, no re-sync)', () => {
    const s = readFileSync('app/inngest/functions.ts', 'utf8')
    const sweep = s.slice(s.indexOf("await step.run('sweep', async () => ({"), s.indexOf('ids: await dueJobIds(),'))
    expect(sweep).toContain("const { sendApprovalReminders } = await import('../lib/post-notify')")
    expect(s).toContain("return { due: ids.length, reclaimed, corrected, recorded, reminded, synced: '2026-09-08' }")
  })
})
