import { afterEach, describe, expect, it, vi } from 'vitest'
import { seedDb } from './helpers/fake-db'
import type { Row } from '@/lib/db-types'

/**
 * THE HOURLY SWEEP OF THE VIDEO EDITORS SOP (§6, §7), on a fake database:
 * the 12-hour follow-up with Ops copied, the 24-hour flag to leadership,
 * and the morning-after acknowledge nudge — each fires ONCE. Run live it
 * would stamp and email every real card in the tree, so it is pinned here.
 */

const emails: Record<string, unknown>[] = []
vi.mock('../app/lib/mailer', () => ({
  notify: vi.fn(async (m: Record<string, unknown>) => { emails.push(m); return 'sent' }),
  renderEmail: (h: string, b: string) => `${h}${b}`,
  escapeHtml: (s: string) => s,
}))

const { runEditorSopNudges } = await import('../app/lib/editor-sop-notify')

const EDITOR = { id: 'e1', role: 'editor', email: 'ed@zz.invalid', name: 'Eddie', active_status: true }
const AM = { id: 'a1', role: 'account_manager', email: 'am@zz.invalid', name: 'Priya', active_status: true }
const OPS = { id: 'o1', role: 'account_manager', email: 'ops@zz.invalid', name: 'Abby', active_status: true, ops_contact: true }
const BOSS = { id: 's1', role: 'super_admin', email: 'boss@zz.invalid', name: 'Divina', active_status: true }

const NOW = new Date('2026-09-12T09:00:00.000Z')
const ago = (hours: number) => new Date(NOW.getTime() - hours * 3600_000).toISOString()

let fake: ReturnType<typeof seedDb>
afterEach(() => fake.restore())

describe('the editor SOP sweep fires each nudge once', () => {
  it('12 h: the named person and Ops; 24 h: leadership; the morning after: the editor — and never twice', async () => {
    fake = seedDb({
      team_users: [EDITOR, AM, OPS, BOSS] as unknown as Row[],
      content_items: [
        { id: 'twelve', title: 'Reel A', client_id: 'c1', owner_id: EDITOR.id, status: 'draft_uploaded', blocked_at: ago(13), blocked_need: 'brief', blocked_from_id: AM.id, blocked_note: 'No objective', created_at: ago(2) },
        { id: 'twentyfour', title: 'Reel B', client_id: 'c1', owner_id: EDITOR.id, status: 'draft_uploaded', blocked_at: ago(25), blocked_need: 'footage', blocked_nudged_12_at: ago(13), blocked_note: 'Scene 3 missing', created_at: ago(2) },
        { id: 'unacked', title: 'Reel C', client_id: 'c1', owner_id: EDITOR.id, status: 'draft_uploaded', created_at: ago(30) },
        { id: 'acked', title: 'Reel D', client_id: 'c1', owner_id: EDITOR.id, status: 'draft_uploaded', created_at: ago(30) },
      ] as unknown as Row[],
      workflow_activity: [
        { id: 'w1', entity_type: 'content_item', entity_id: 'acked', action: 'acknowledged', actor_id: EDITOR.id, created_at: ago(29) },
      ] as unknown as Row[],
    })
    emails.length = 0
    const first = await runEditorSopNudges(NOW)
    expect(first).toEqual({ twelve: 1, twentyFour: 1, ack: 1 })
    const by = (type: string) => emails.filter(e => e.eventType === type).map(e => String(e.recipientEmail)).sort()
    expect(by('editor_blocked_12h')).toEqual(['am@zz.invalid', 'ops@zz.invalid'])
    expect(by('editor_blocked_24h')).toEqual(['boss@zz.invalid', 'ops@zz.invalid'])
    expect(by('editor_ack_nudge')).toEqual(['ed@zz.invalid'])
    expect(emails.filter(e => String(e.entityId).startsWith('unacked'))).toHaveLength(1)
    expect(emails.some(e => String(e.entityId).startsWith('acked'))).toBe(false)

    // the stamps are on the rows…
    const rows = Object.fromEntries(fake.rows('content_items').map(r => [r.id, r as Record<string, unknown>]))
    expect(rows.twelve.blocked_nudged_12_at).toBeTruthy()
    expect(rows.twentyfour.blocked_nudged_24_at).toBeTruthy()
    expect(rows.unacked.ack_nudged_at).toBeTruthy()
    expect(rows.acked.ack_nudged_at).toBeUndefined()

    // …so the next hour sends nothing again
    emails.length = 0
    expect(await runEditorSopNudges(new Date(NOW.getTime() + 3600_000))).toEqual({ twelve: 0, twentyFour: 0, ack: 0 })
    expect(emails).toEqual([])

    // twelve more hours on, the first card reaches its 24-hour flag, once
    expect(await runEditorSopNudges(new Date(NOW.getTime() + 12 * 3600_000))).toEqual({ twelve: 0, twentyFour: 1, ack: 0 })
    expect(emails.map(e => String(e.entityId)).sort()).toEqual(['twelve#blocked-24#o1', 'twelve#blocked-24#s1'])
  })
})
