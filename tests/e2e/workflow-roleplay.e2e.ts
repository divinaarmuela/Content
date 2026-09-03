import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { table } from '../../lib/db'
import type { TeamUser } from '../../app/lib/authz'
import { performTransition, addVersion, type ContentItem } from '../../app/lib/workflow'
import { loadItemForUser, shapeItemDetail, accessibleClientIds } from '../../app/lib/production-access'
import { SCHEDULER_STATUSES } from '../../app/lib/workflow-core'

/**
 * The full production flow, played live against the real database by the
 * three dashboard roles plus the client — exactly the funnel in
 * docs/DASHBOARD_WORKFLOW_SPEC.txt §3:
 *
 *   editor uploads draft → AM internal review → revision loop →
 *   client review (portal) → client requests changes → second loop →
 *   client approves → scheduler schedules → published
 *
 * Uses ONLY the dedicated "ZZ TEST" client and the four .invalid test
 * accounts, so every notification the flow fans out lands on an
 * undeliverable address and no real team member hears about it.
 */

const TEST_CLIENT_ID = '99ba2c6f-4db5-4782-9395-9048f215886c'
const IDS = {
  am: '3548cc71-5a34-4fe9-9130-11579d1a4137',
  editor: 'e30e0242-63f1-4855-8e3a-b23b293ec11d',
  scheduler: '0e7fcf9f-bcf5-4080-ab7c-1b1f8fed1d13',
  client: '634d5636-70a7-4f5a-96e9-5b48cce73999',
}

let am: TeamUser, editor: TeamUser, scheduler: TeamUser, clientUser: TeamUser
let itemId: string

/** item_id has no dedicated bucket per platform here — one row per (item, platform). */
async function scheduleEntryFor(itemId: string, platform: string) {
  return (await table('schedule_entries')
    .list({ by: { item_id: itemId }, where: (r: any) => r.platform === platform }))[0] ?? null
}
async function upsertSchedule(row: Record<string, unknown>) {
  const existing = await scheduleEntryFor(row.item_id as string, row.platform as string)
  return existing ? table('schedule_entries').update(existing.id, row) : table('schedule_entries').insert(row as any)
}
async function markLiveUrl(itemId: string, platform: string, liveUrl: string) {
  const entry = await scheduleEntryFor(itemId, platform)
  if (entry) {
    await table('schedule_entries').update(entry.id, {
      live_url: liveUrl, publish_status: 'published', published_at: new Date().toISOString(),
    })
  }
}

const freshItem = async (): Promise<ContentItem> => {
  const row = await table('content_items').get(itemId)
  if (!row) throw new Error('not found')
  return row as unknown as ContentItem
}

beforeAll(async () => {
  const ids = new Set(Object.values(IDS))
  const rows = await table('team_users').list({ where: (r: any) => ids.has(r.id) })
  const by = Object.fromEntries(rows.map((u: any) => [u.id, u as TeamUser]))
  am = by[IDS.am]; editor = by[IDS.editor]; scheduler = by[IDS.scheduler]; clientUser = by[IDS.client]
  if (!am || !editor || !scheduler || !clientUser) throw new Error('Test accounts missing — recreate them first')

  // the editor creates the item, exactly as the items POST route does
  const item = await table('content_items').insert({
    client_id: TEST_CLIENT_ID,
    title: `E2E roleplay ${new Date().toISOString()}`,
    content_type: 'reel',
    platform_targets: ['instagram'],
    owner_id: editor.id,
    priority: 'normal',
    client_approval_required: true,
    // both were Postgres column defaults; an item that reads back without a
    // status is on no board at all (CLAUDE.md — insert() carries no defaults)
    status: 'draft_uploaded',
    current_version_number: 0,
  } as any)
  itemId = item.id
})

afterAll(async () => {
  // remove everything the run created; the test client + accounts stay for
  // manual role-play in the dashboard
  if (!itemId) return
  // let the fire-and-forget notification fan-outs settle before teardown
  await new Promise(r => setTimeout(r, 3000))
  await table('schedule_entries').removeWhere((r: any) => r.item_id === itemId)
  await table('item_comments').removeWhere((r: any) => r.item_id === itemId)
  await table('asset_versions').removeWhere((r: any) => r.item_id === itemId)
  await table('approvals').removeWhere((r: any) => r.item_id === itemId)
  await table('content_items').remove(itemId)
  await table('notification_log').removeWhere((r: any) => typeof r.entity_id === 'string' && r.entity_id.startsWith(itemId))
})

describe('the funnel, role by role', () => {
  it('scoping: AM and editor see the test client; scheduler is status-scoped', async () => {
    expect(await accessibleClientIds(am)).toContain(TEST_CLIENT_ID)
    expect(await accessibleClientIds(editor)).toContain(TEST_CLIENT_ID)
    expect(await accessibleClientIds(scheduler)).toBeNull()
    expect(await accessibleClientIds(clientUser)).toEqual([TEST_CLIENT_ID])
  })

  it('editor: cannot submit for review without a version (evidence rule)', async () => {
    await expect(performTransition(editor, await freshItem(), 'internal_review'))
      .rejects.toThrow(/Add a version/)
  })

  it('editor: uploads v1 and submits for internal review', async () => {
    const v = await addVersion(editor, itemId, {
      dropbox_url: 'https://www.dropbox.com/s/test-master-v1',
      file_url: 'https://example.com/preview-v1.mp4',
      notes: 'First cut',
    })
    expect(v.version_number).toBe(1)
    const updated = await performTransition(editor, await freshItem(), 'internal_review')
    expect(updated.status).toBe('internal_review')
  })

  it('scheduler: cannot even see the item pre-approval', async () => {
    expect(SCHEDULER_STATUSES).not.toContain('internal_review')
    await expect(loadItemForUser(scheduler, itemId)).rejects.toThrow(/not found/i)
  })

  it('editor: cannot approve their own work for the client', async () => {
    await expect(performTransition(editor, await freshItem(), 'client_review'))
      .rejects.toThrow()
  })

  it('AM: reviews and asks for a revision; editor redelivers', async () => {
    expect((await performTransition(am, await freshItem(), 'revision_required')).status).toBe('revision_required')
    const v2 = await addVersion(editor, itemId, {
      dropbox_url: 'https://www.dropbox.com/s/test-master-v2',
      file_url: 'https://example.com/preview-v2.mp4',
      notes: 'Tightened the hook per AM note',
    })
    expect(v2.version_number).toBe(2)
    expect((await performTransition(editor, await freshItem(), 'revision_complete')).status).toBe('revision_complete')
  })

  it('AM: sends it to the client portal', async () => {
    expect((await performTransition(am, await freshItem(), 'client_review')).status).toBe('client_review')
  })

  it('comment visibility: client never sees internal notes, editor never sees client notes, scheduler sees none', async () => {
    await Promise.all([
      { item_id: itemId, author_id: am.id, visibility: 'internal', body: 'Internal: watch the logo safe-zone' },
      { item_id: itemId, author_id: clientUser.id, visibility: 'client', body: 'Client: can the intro be shorter?' },
    ].map(r => table('item_comments').insert(r as any)))
    const item = await table('content_items').get(itemId)
    const versions = await table('asset_versions').list({ by: { item_id: itemId }, orderBy: [['version_number', 'desc']] })
    const comments = await table('item_comments').list({ by: { item_id: itemId } })

    type Shaped = { versions: Record<string, unknown>[]; comments: { visibility: string }[] }
    const asClient = shapeItemDetail(clientUser, item!, versions as never, comments as never) as unknown as Shaped
    expect(asClient.comments.every(c => c.visibility === 'client')).toBe(true)
    expect(asClient.versions).toHaveLength(1) // latest only
    expect(asClient.versions[0]).not.toHaveProperty('dropbox_url') // master link stays internal

    const asEditor = shapeItemDetail(editor, item!, versions as never, comments as never) as unknown as Shaped
    expect(asEditor.comments.every(c => c.visibility === 'internal')).toBe(true)

    const asScheduler = shapeItemDetail(scheduler, item!, versions as never, comments as never) as unknown as Shaped
    expect(asScheduler.comments).toHaveLength(0) // stays out of revision loops
  })

  it('client: requests changes — and the loop returns through the AM, never straight to the editor', async () => {
    expect((await performTransition(clientUser, await freshItem(), 'client_changes_requested')).status)
      .toBe('client_changes_requested')
    // the AM triages it back into the revision loop
    expect((await performTransition(am, await freshItem(), 'revision_required')).status).toBe('revision_required')
    await addVersion(editor, itemId, {
      dropbox_url: 'https://www.dropbox.com/s/test-master-v3',
      file_url: 'https://example.com/preview-v3.mp4',
    })
    expect((await performTransition(editor, await freshItem(), 'revision_complete')).status).toBe('revision_complete')
    expect((await performTransition(am, await freshItem(), 'client_review')).status).toBe('client_review')
  })

  it('client: approves for scheduling', async () => {
    expect((await performTransition(clientUser, await freshItem(), 'approved_for_scheduling')).status)
      .toBe('approved_for_scheduling')
    const approvals = await table('approvals').list({ by: { item_id: itemId } })
    expect(approvals.some((a: any) => a.approval_type === 'client' && a.decision === 'approved')).toBe(true)
  })

  it('scheduler: NOW sees the item, but cannot schedule without a dated entry', async () => {
    const item = await loadItemForUser(scheduler, itemId) // no longer 404
    expect(item.status).toBe('approved_for_scheduling')
    await expect(performTransition(scheduler, await freshItem(), 'scheduled'))
      .rejects.toThrow(/platform with a date/)
  })

  it('scheduler: sets a platform + time, marks scheduled, adds the live link, marks published', async () => {
    await upsertSchedule({
      item_id: itemId, platform: 'instagram', scheduler_id: scheduler.id,
      scheduled_at: new Date(Date.now() + 86_400_000).toISOString(),
    })
    expect((await performTransition(scheduler, await freshItem(), 'scheduled')).status).toBe('scheduled')

    // published needs the live URL first — evidence rule again
    await expect(performTransition(scheduler, await freshItem(), 'published'))
      .rejects.toThrow(/live link/i)
    await markLiveUrl(itemId, 'instagram', 'https://instagram.com/p/test')
    expect((await performTransition(scheduler, await freshItem(), 'published')).status).toBe('published')
  })

  it('optimistic concurrency: a stale transition loses the race with a 409, never double-applies', async () => {
    const stale = { ...(await freshItem()), status: 'approved_for_scheduling' } as ContentItem
    await expect(performTransition(scheduler, stale, 'scheduled'))
      .rejects.toThrow(/updated by someone else/)
  })

  it('no real person was notified: every notification this item produced went to a .invalid test address', async () => {
    // give the async fan-outs a moment to write their rows
    await new Promise(r => setTimeout(r, 2500))
    const data = await table('notification_log')
      .list({ where: (r: any) => typeof r.entity_id === 'string' && r.entity_id.startsWith(itemId) })
    expect(data.length).toBeGreaterThan(0) // the flow really did fan out
    // a claim row to a real address with status 'failed' is the kill-switch
    // doing its job (real schedulers exist on the roster now); only a SENT
    // email to a real person is a leak
    const leaked = data.filter((r: any) => !r.recipient_email.endsWith('.invalid') && r.status === 'sent')
    expect(leaked, `leaked to: ${leaked.map((r: any) => `${r.recipient_email} (${r.entity_id})`).join(', ')}`)
      .toHaveLength(0)
  })
})
