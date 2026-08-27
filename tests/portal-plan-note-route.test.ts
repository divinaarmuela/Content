import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * "Approve with a note" on a shoot plan, at the seam it actually crosses.
 *
 * The note the client types is filed once — in the shoot's own thread, by the
 * portal comment route — and then rides with the approval only so the account
 * manager's email carries the words that came with the yes. This route is
 * where that second half happens, so what is under test is exactly that: the
 * note reaches performTransition, and it is NOT written to the plan's thread a
 * second time.
 */

type Row = Record<string, unknown>

const TOKEN = '3ae353c7-c879-4db7-bf71-dec9657d40e3'

const tables: Record<string, Row[]> = {}
const inserted: Record<string, Row[]> = {}

const supabase = {
  from(table: string) {
    const filters: [string, unknown][] = []
    let single = false
    const rows = () => (tables[table] ?? [])
      .filter(r => filters.every(([c, v]) => r[c] === v))
      .map(r => ({ ...r }))
    const chain = {
      select: () => chain,
      eq: (c: string, v: unknown) => { filters.push([c, v]); return chain },
      in: () => chain,
      order: () => chain,
      limit: () => chain,
      maybeSingle: () => { single = true; return chain },
      single: () => { single = true; return chain },
      insert: (row: Row) => {
        ;(inserted[table] ??= []).push(row)
        return Promise.resolve({ data: { id: 'new', ...row }, error: null })
      },
      upsert: (row: Row) => { (inserted[table] ??= []).push(row); return chain },
      then: (ok: (r: unknown) => unknown, no?: (e: unknown) => unknown) => {
        const out = rows()
        return Promise.resolve({ data: single ? out[0] ?? null : out, error: null }).then(ok, no)
      },
    }
    return chain
  },
}

const performTransition = vi.fn(async (
  _actor: unknown, item: { status: string }, to: string, _opts?: { note?: string },
) => ({ ...item, status: to }))
const logActivity = vi.fn()

vi.mock('@/lib/supabase', () => ({ supabase }))
vi.mock('../app/lib/workflow', () => ({ performTransition, logActivity }))
vi.mock('../app/lib/production-live', () => ({ announceItemChange: vi.fn() }))
const notify = vi.fn()
vi.mock('../app/lib/mailer', () => ({
  notify,
  renderEmail: (h: string, b: string) => `${h}${b}`,
  escapeHtml: (s: string) => s,
}))

const { POST } = await import('../app/api/portal/act/route')

const post = async (body: unknown) => {
  const res = await POST(new Request('https://x.test/api/portal/act', {
    method: 'POST', body: JSON.stringify(body),
  }))
  return { status: res.status, json: await res.json() as Record<string, unknown> }
}

beforeEach(() => {
  for (const k of Object.keys(inserted)) delete inserted[k]
  performTransition.mockClear()
  notify.mockClear()
  tables.clients = [{ id: 'client-1', name: 'ZZ TEST', share_token: TOKEN }]
  tables.content_items = [{
    id: 'item-1', client_id: 'client-1', title: 'Winter shoot', status: 'client_review',
  }]
  tables.team_users = [{
    id: 'portal-1', email: 'portal+client-1@mdmmarketing.com.au',
    name: 'ZZ TEST (client portal)', role: 'client', active_status: false,
  }]
  tables.team_user_clients = []
})

describe('POST /api/portal/act — approving a plan with a note', () => {
  it('carries the note into the approval, so the manager’s email says it', async () => {
    const { status } = await post({
      token: TOKEN, item_id: 'item-1', action: 'approve',
      author_name: 'Dana', note: 'Please start after 9 — the cafe opens at 8.',
    })
    expect(status).toBe(200)
    expect(performTransition).toHaveBeenCalledTimes(1)
    expect(performTransition.mock.calls[0][2]).toBe('approved_for_scheduling')
    expect(performTransition.mock.calls[0][3]).toEqual({
      note: 'Please start after 9 — the cafe opens at 8.',
    })
  })

  it('does not file the note a second time — it is already in the shoot thread', async () => {
    await post({
      token: TOKEN, item_id: 'item-1', action: 'approve',
      author_name: 'Dana', note: 'Please start after 9.',
    })
    expect(inserted.item_comments ?? []).toEqual([])
  })

  it('approves exactly as the plain button does when there is no note', async () => {
    const { status } = await post({ token: TOKEN, item_id: 'item-1', action: 'approve' })
    expect(status).toBe(200)
    expect(performTransition.mock.calls[0][2]).toBe('approved_for_scheduling')
    expect(performTransition.mock.calls[0][3]).toEqual({ note: undefined })
    expect(inserted.item_comments ?? []).toEqual([])
  })

  it('still files a note sent as a comment — the change-request path is untouched', async () => {
    await post({
      token: TOKEN, item_id: 'item-1', action: 'request_changes',
      comment: 'Can we move the garden set to the morning?', author_name: 'Dana',
    })
    expect(inserted.item_comments).toHaveLength(1)
    expect(String(inserted.item_comments[0].body)).toContain('garden set')
    expect(inserted.item_comments[0].visibility).toBe('client')
  })

  it('a note is never an approval on its own — a bad link still fails', async () => {
    const { status } = await post({
      token: 'not-a-token', item_id: 'item-1', action: 'approve', note: 'hi',
    })
    expect(status).toBe(401)
    expect(performTransition).not.toHaveBeenCalled()
  })
})
