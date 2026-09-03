import { describe, it, expect } from 'vitest'
import { buildOverview, pipelineOf, unassignedOf } from '@/app/lib/overview-core'

/**
 * The Overview's numbers, pinned.
 *
 * `/api/overview` and the Overview PAGE now call this one function — the page
 * over live listener rows, the route over rows it read — so these tests are
 * what keeps a card on screen meaning the same thing as the endpoint that
 * used to draw it.
 */

const NOW = Date.parse('2026-09-03T00:00:00.000Z')

const item = (over: Partial<Record<string, unknown>> = {}) => ({
  id: 'i', title: 'T', status: 'draft_uploaded', content_type: 'reel',
  priority: 'normal', due_date: null, client_id: 'c1', owner_id: null,
  updated_at: '2026-09-01T00:00:00.000Z', clients: { name: 'Acme' },
  ...over,
}) as never

describe('pipelineOf', () => {
  it('counts one per status', () => {
    const p = pipelineOf([
      item({ id: 'a', status: 'internal_review' }),
      item({ id: 'b', status: 'internal_review' }),
      item({ id: 'c', status: 'client_review' }),
    ])
    expect(p.internal_review).toBe(2)
    expect(p.client_review).toBe(1)
    expect(p.published).toBe(0)
  })

  it('leaves out a booked shoot plan but keeps one still in review', () => {
    const brief = { slug: 'shoot_brief', uses_media: true }
    const p = pipelineOf([
      item({ id: 'a', status: 'scheduled', work_kinds: brief }),
      item({ id: 'b', status: 'client_review', work_kinds: brief }),
    ])
    expect(p.scheduled).toBe(0)
    expect(p.client_review).toBe(1)
  })

  it('leaves out internal tasks entirely', () => {
    const p = pipelineOf([item({ status: 'internal_review', work_kinds: { slug: 'copy', uses_media: false } })])
    expect(p.internal_review).toBe(0)
  })
})

describe('unassignedOf', () => {
  it('is unowned assets before approval, and nothing else', () => {
    const rows = [
      item({ id: 'ok' }),
      item({ id: 'owned', owner_id: 'u1' }),
      item({ id: 'approved', status: 'approved_for_scheduling' }),
      item({ id: 'brief', work_kinds: { slug: 'shoot_brief', uses_media: true } }),
      item({ id: 'task', work_kinds: { slug: 'copy', uses_media: false } }),
    ]
    expect(unassignedOf(rows).map(i => i.id)).toEqual(['ok'])
  })
})

describe('buildOverview', () => {
  const tagged = { items: [] as string[], batches: [] as string[] }

  it('gives an editor their own work and the open pool', () => {
    const out = buildOverview({
      user: { id: 'u1', role: 'editor', name: 'Ed' },
      items: [
        item({ id: 'mine', owner_id: 'u1', status: 'revision_required' }),
        item({ id: 'mine2', owner_id: 'u1', status: 'internal_review' }),
        item({ id: 'theirs', owner_id: 'u2' }),
        item({ id: 'free' }),
      ],
      tagged, now: NOW,
    }) as never as { editor: Record<string, never> }
    expect(out.editor.my_items).toBe(2)
    expect(out.editor.revisions_needed).toBe(1)
    expect(out.editor.in_internal_review).toBe(1)
    expect((out.editor.needs_action as unknown as { id: string }[]).map(i => i.id)).toEqual(['mine'])
    expect(out.editor.unassigned_count).toBe(1)
  })

  it('gives a scheduler the approved queue, without briefs or tasks', () => {
    const out = buildOverview({
      user: { id: 'u1', role: 'scheduler', name: 'Sam' },
      items: [
        item({ id: 'q', status: 'approved_for_scheduling' }),
        item({ id: 'handed', status: 'approved_for_scheduling', scheduler_ids: ['u2'] }),
        item({ id: 'brief', status: 'approved_for_scheduling', work_kinds: { slug: 'shoot_brief', uses_media: true } }),
        item({ id: 'task', status: 'approved_for_scheduling', work_kinds: { slug: 'copy', uses_media: false } }),
      ],
      tagged,
      entries: [
        { id: 'e1', scheduled_at: new Date(NOW + 86_400_000).toISOString() },
        { id: 'e2', scheduled_at: new Date(NOW + 40 * 86_400_000).toISOString() },
        { id: 'e3', scheduled_at: null, published_at: new Date(NOW - 86_400_000).toISOString() },
      ],
      now: NOW,
    }) as never as { scheduler: Record<string, never> }
    expect(out.scheduler.to_schedule).toBe(1)
    expect(out.scheduler.upcoming_count).toBe(1)
    expect(out.scheduler.published_week).toBe(1)
  })

  it('gives a manager the two review stages and leads only when allowed', () => {
    const items = [
      item({ id: 'r1', status: 'internal_review' }),
      item({ id: 'r2', status: 'revision_complete' }),
      item({ id: 'c1', status: 'client_review' }),
      item({ id: 'mine', owner_id: 'u1', status: 'draft_uploaded' }),
    ]
    const base = {
      user: { id: 'u1', role: 'account_manager', name: 'Div' },
      items, tagged, clientCount: 4, now: NOW,
      leads: [{ id: 'l1', created_at: new Date(NOW - 86_400_000).toISOString() }],
    }
    const withLeads = buildOverview({ ...base, mayLeads: true }) as never as { manager: Record<string, never> }
    expect(withLeads.manager.clients).toBe(4)
    expect(withLeads.manager.awaiting_internal_review).toBe(2)
    expect(withLeads.manager.awaiting_client).toBe(1)
    expect(withLeads.manager.leads_week).toBe(1)
    expect(withLeads.manager.my_tasks_count).toBe(1)

    const without = buildOverview({ ...base, mayLeads: false }) as never as { manager: Record<string, never> }
    expect(without.manager.leads_total).toBeUndefined()
    expect(without.manager.latest_leads).toBeUndefined()
  })

  it('carries a tagged item the scoped list never held', () => {
    const out = buildOverview({
      user: { id: 'u1', role: 'editor', name: 'Ed' },
      items: [],
      tagged: { items: ['x'], batches: ['b'] },
      taggedExtraItems: [item({ id: 'x' })],
      taggedShoots: [{ id: 'b', title: 'Shoot', client_id: 'c1', clients: { name: 'Acme' } }],
      now: NOW,
    }) as never as { waiting_on_you: { items: { id: string }[]; shoots: { id: string }[] } }
    expect(out.waiting_on_you.items.map(i => i.id)).toEqual(['x'])
    expect(out.waiting_on_you.shoots.map(s => s.id)).toEqual(['b'])
  })
})
