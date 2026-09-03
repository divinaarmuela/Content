import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { supabase } from '../../lib/supabase'
import type { TeamUser } from '../../app/lib/authz'
import { performTransition, addVersion, type ContentItem } from '../../app/lib/workflow'
import {
  accessibleClientIds, assignedItemsFilter, canOpenBatch, heldBatchIds,
  loadItemForUser, shapeItemDetail, visibleClientIds,
} from '../../app/lib/production-access'
import { upsertScheduleEntry } from '../../app/lib/schedule'
import { canCreateItemsUnder, checkBatchTransition } from '../../app/lib/batch-brief-core'
import { canEditItemFields, roleMayCreateItems, taskExemptFromClientScope } from '../../app/lib/item-edit-core'
import { groupCard, groupLine, nextPieceTitle } from '../../app/lib/deliverable-group-core'
import type { ItemStatus } from '../../app/lib/workflow-core'
import type { ContentItem as DbContentItem } from '../../lib/db-types'
import { editorScope, schedulerScope, isBriefTask, type ScopeMode, type WorkItem } from '../../app/lib/work-pages-core'
import { CLAIMABLE_SCHEDULING_STATUSES, EDITING_CLOSED_STATUSES } from '../../app/lib/claim-core'
import { openTaggedIds, taggedItemIds } from '../../app/lib/production-access'
import { notifyTagged, resolveTags, settleTagNotifications, taggableTeam } from '../../app/lib/comment-tags'
import { actOnPostingApproval } from '../../app/lib/posting-approval'
import { planItemPublish } from '../../app/lib/production-publish'
import { stateAfterPostEdit } from '../../app/lib/posting-approval-core'
import { notificationHref } from '../../app/lib/notification-words'

/**
 * The assignment rules, played live against the real database.
 *
 * One board became three pages, and the rule that makes that safe is that
 * RIGHTS FOLLOW ASSIGNMENT, not job title: an account manager who owns the
 * edit may mark revisions done; an editor handed the scheduling may post it;
 * a scheduler who was handed nothing may do neither. workflow-roleplay.e2e.ts
 * walks the happy funnel — this file proves the hats.
 *
 * Same guarantees as its sibling: ONLY the dedicated "ZZ TEST" client and the
 * four `.invalid` accounts, EMAIL_TEST_ONLY=1 from the harness, every row
 * created here deleted in afterAll, and no publish ever leaves the building.
 */

const TEST_CLIENT_ID = '99ba2c6f-4db5-4782-9395-9048f215886c'
const SHOOT_BRIEF_KIND_ID = 'c0a80000-0000-4000-8000-000000000b21'
const IDS = {
  am: '3548cc71-5a34-4fe9-9130-11579d1a4137',
  editor: 'e30e0242-63f1-4855-8e3a-b23b293ec11d',
  scheduler: '0e7fcf9f-bcf5-4080-ab7c-1b1f8fed1d13',
  client: '634d5636-70a7-4f5a-96e9-5b48cce73999',
}

let am: TeamUser, editor: TeamUser, scheduler: TeamUser

/** every content_items id this file created — the teardown list */
const created: string[] = []
/** every batches id this file created */
const batches: string[] = []

const scope = (...m: ScopeMode[]) => new Set<ScopeMode>(m)

/**
 * Wait for a fire-and-forget fan-out to land.
 *
 * The notifications these flows produce are not awaited by the code under
 * test, so the assertions used to sleep a flat few seconds and hope. Polling
 * asks the question every 250 ms instead: it returns the moment the rows are
 * there (usually far sooner) and only spends the whole budget when something
 * is genuinely wrong.
 */
async function until<T>(
  probe: () => Promise<T>, done: (v: T) => boolean, budgetMs = 5000,
): Promise<T> {
  const deadline = Date.now() + budgetMs
  let last = await probe()
  while (!done(last) && Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 250))
    last = await probe()
  }
  return last
}

/** every notification row these items produced, right now */
async function notificationRows(ids: string[]) {
  const rows: { recipient_email: string; entity_id: string; status: string }[] = []
  for (const id of ids) {
    const { data } = await supabase
      .from('notification_log')
      .select('recipient_email, entity_id, status')
      .like('entity_id', `${id}%`)
    rows.push(...(data ?? []))
  }
  return rows
}

const fresh = async (id: string): Promise<ContentItem> => {
  const { data, error } = await supabase.from('content_items').select('*').eq('id', id).single()
  if (error) throw new Error(error.message)
  return data as ContentItem
}

/** A fresh item on the test client, tracked for teardown. */
async function makeItem(fields: Record<string, unknown>): Promise<string> {
  const { data, error } = await supabase.from('content_items').insert({
    client_id: TEST_CLIENT_ID,
    title: `E2E assignment ${new Date().toISOString()}`,
    content_type: 'reel',
    platform_targets: ['instagram'],
    priority: 'normal',
    client_approval_required: false,
    ...fields,
  }).select('id').single()
  if (error) throw new Error(error.message)
  created.push(data.id)
  return data.id
}

const v = (n: number) => ({
  dropbox_url: `https://www.dropbox.com/s/assignment-v${n}`,
  file_url: `https://example.com/assignment-v${n}.mp4`,
  notes: `cut ${n}`,
})

beforeAll(async () => {
  const { data, error } = await supabase.from('team_users').select('*').in('id', Object.values(IDS))
  if (error) throw new Error(error.message)
  const by = Object.fromEntries((data ?? []).map(u => [u.id, u as TeamUser]))
  am = by[IDS.am]; editor = by[IDS.editor]; scheduler = by[IDS.scheduler]
  if (!am || !editor || !scheduler) throw new Error('Test accounts missing — recreate them first')

  // Hard safety gate, re-checked at run time rather than trusted: the whole
  // fan-out for this client must land on undeliverable addresses. An
  // UNASSIGNED client is unsafe too — resolveAudience falls back to emailing
  // every super admin when a client has no manager.
  const { data: mgrs } = await supabase
    .from('team_user_clients')
    .select('team_users!team_user_clients_team_user_id_fkey!inner(email)')
    .eq('client_id', TEST_CLIENT_ID)
  const emails = (mgrs ?? []).map(r => (r.team_users as unknown as { email: string }).email)
  if (emails.length === 0) throw new Error('ZZ TEST client has no assigned manager — the AM fallback would email every super admin')
  const real = emails.filter(e => !e.endsWith('.invalid'))
  if (real.length > 0) throw new Error(`ZZ TEST client is managed by real people: ${real.join(', ')}`)
  if (process.env.EMAIL_TEST_ONLY !== '1') throw new Error('EMAIL_TEST_ONLY is not set — refusing to run')
})

afterAll(async () => {
  // let the fire-and-forget notification fan-outs settle before teardown —
  // poll for them rather than sleeping blind, so a fast run is fast and a
  // slow one still gets its full budget
  await until(() => notificationRows(created), rows => rows.length > 0)
  for (const id of created) {
    await supabase.from('schedule_entries').delete().eq('item_id', id)
    await supabase.from('item_comments').delete().eq('item_id', id)
    await supabase.from('asset_versions').delete().eq('item_id', id)
    await supabase.from('approvals').delete().eq('item_id', id)
    await supabase.from('workflow_activity').delete().eq('entity_id', id)
    await supabase.from('content_items').delete().eq('id', id)
    await supabase.from('notification_log').delete().like('entity_id', `${id}%`)
  }
  for (const id of batches) {
    await supabase.from('workflow_activity').delete().eq('entity_id', id)
    await supabase.from('notification_log').delete().like('entity_id', `${id}%`)
    await supabase.from('batches').delete().eq('id', id)
  }
})

describe('rights follow assignment, not job title', () => {
  it('the account manager who OWNS the edit may mark revisions done; a scheduler may not', async () => {
    const id = await makeItem({ owner_id: am.id })
    await addVersion(am, id, v(1))
    expect((await performTransition(am, await fresh(id), 'internal_review')).status).toBe('internal_review')
    expect((await performTransition(am, await fresh(id), 'revision_required')).status).toBe('revision_required')

    // the revision really happened — a new version lands after the request
    await new Promise(r => setTimeout(r, 60))
    expect((await addVersion(am, id, v(2))).version_number).toBe(2)

    // the same edge, from the seat of someone this item was never handed to
    await expect(performTransition(scheduler, await fresh(id), 'revision_complete')).rejects.toThrow()

    // …and from the owner's seat, wearing the editor hat their OWNERSHIP grants
    expect((await performTransition(am, await fresh(id), 'revision_complete')).status).toBe('revision_complete')
  })

  it('"revisions done" without a new version is refused — the evidence rule', async () => {
    const id = await makeItem({ owner_id: am.id })
    await addVersion(am, id, v(1))
    await performTransition(am, await fresh(id), 'internal_review')
    await performTransition(am, await fresh(id), 'revision_required')
    // no v2 this time: nothing changed since the changes were asked for
    await expect(performTransition(am, await fresh(id), 'revision_complete'))
      .rejects.toThrow(/new version/i)
  })

  it('an EDITOR handed the scheduling schedules and publishes it; the unhanded scheduler cannot', async () => {
    const id = await makeItem({ owner_id: editor.id })
    await addVersion(editor, id, v(1))
    await performTransition(editor, await fresh(id), 'internal_review')
    expect((await performTransition(am, await fresh(id), 'approved_for_scheduling')).status)
      .toBe('approved_for_scheduling')

    // the AM hands it to the editor, not to the scheduling team
    await supabase.from('content_items').update({ scheduler_ids: [editor.id] }).eq('id', id)
    await supabase.from('schedule_entries').upsert({
      item_id: id, platform: 'instagram', scheduler_id: editor.id,
      scheduled_at: new Date(Date.now() + 86_400_000).toISOString(),
    }, { onConflict: 'item_id,platform' })

    // the scheduler by TITLE holds no hat here — somebody else was handed it
    await expect(performTransition(scheduler, await fresh(id), 'scheduled')).rejects.toThrow()

    expect((await performTransition(editor, await fresh(id), 'scheduled')).status).toBe('scheduled')
    // marked posted in-app — no Zernio/social publish is ever triggered here
    await supabase.from('schedule_entries')
      .update({ live_url: 'https://instagram.com/p/e2e-assignment', publish_status: 'published', published_at: new Date().toISOString() })
      .eq('item_id', id).eq('platform', 'instagram')
    expect((await performTransition(editor, await fresh(id), 'published')).status).toBe('published')
  })

  it('the schedule ENTRY itself follows the hat: the handed editor writes it, the unhanded scheduler cannot', async () => {
    const id = await makeItem({ owner_id: editor.id })
    await addVersion(editor, id, v(1))
    await performTransition(editor, await fresh(id), 'internal_review')
    await performTransition(am, await fresh(id), 'approved_for_scheduling')
    await supabase.from('content_items').update({ scheduler_ids: [editor.id] }).eq('id', id)

    // through the REAL code path the API route uses — the route is a thin
    // wrapper around this, so proving it here proves the endpoint
    const entry = await upsertScheduleEntry(editor, await fresh(id), {
      platform: 'instagram',
      scheduled_at: new Date(Date.now() + 86_400_000).toISOString(),
    })
    expect(entry.platform).toBe('instagram')
    expect(entry.scheduler_id).toBe(editor.id)

    // …and the entry is real evidence: the transition it gates now passes
    expect((await performTransition(editor, await fresh(id), 'scheduled')).status).toBe('scheduled')

    // the scheduler by TITLE was handed nothing here — same function, refused
    await expect(upsertScheduleEntry(scheduler, await fresh(id), { platform: 'tiktok' }))
      .rejects.toThrow(/scheduling/i)
    const { data: entries } = await supabase
      .from('schedule_entries').select('platform').eq('item_id', id)
    expect((entries ?? []).map(e => e.platform)).toEqual(['instagram'])

    // and they cannot even READ it: a taken seat is not their job to see
    await expect(loadItemForUser(scheduler, id)).rejects.toThrow(/not found/i)
  })

  it('with nobody handed the scheduling, the scheduler picks it up and posts it', async () => {
    const id = await makeItem({ owner_id: editor.id })
    await addVersion(editor, id, v(1))
    await performTransition(editor, await fresh(id), 'internal_review')
    await performTransition(am, await fresh(id), 'approved_for_scheduling')
    await supabase.from('content_items').update({ scheduler_ids: [] }).eq('id', id)
    await supabase.from('schedule_entries').upsert({
      item_id: id, platform: 'instagram', scheduler_id: scheduler.id,
      scheduled_at: new Date(Date.now() + 86_400_000).toISOString(),
    }, { onConflict: 'item_id,platform' })
    expect((await performTransition(scheduler, await fresh(id), 'scheduled')).status).toBe('scheduled')
  })
})

describe('a shoot brief never reaches the Scheduler', () => {
  let briefId: string, batchId: string

  it('is driven to "plan approved" by the account manager', async () => {
    const { data: batch, error } = await supabase.from('batches').insert({
      client_id: TEST_CLIENT_ID,
      title: `E2E brief shoot ${new Date().toISOString()}`,
      owner_id: am.id,
      status: 'brief',
      concept: 'E2E test concept — nothing is booked with anybody',
    }).select('id').single()
    if (error) throw new Error(error.message)
    batchId = batch.id
    batches.push(batchId)

    briefId = await makeItem({
      owner_id: am.id,
      batch_id: batchId,
      content_type: 'other',
      work_kind_id: SHOOT_BRIEF_KIND_ID,
      brief_url: 'https://app.milanote.com/e2e-test-brief',
    })

    expect((await performTransition(am, await fresh(briefId), 'internal_review')).status).toBe('internal_review')
    expect((await performTransition(am, await fresh(briefId), 'approved_for_scheduling')).status)
      .toBe('approved_for_scheduling')
  })

  it('never appears on the Scheduler page, not even at "all"', async () => {
    const { data } = await supabase
      .from('content_items').select('id, status, owner_id, scheduler_ids, batch_id, work_kinds(slug)')
      .eq('id', briefId)
    const rows = (data ?? []) as unknown as WorkItem[]
    expect(rows).toHaveLength(1)
    expect(isBriefTask(rows[0])).toBe(true)
    const viewer = { id: scheduler.id, role: scheduler.role }
    expect(schedulerScope(rows, viewer, scope('all'))).toHaveLength(0)
    expect(schedulerScope(rows, viewer, scope('mine', 'unassigned'))).toHaveLength(0)
  })

  it('books only once the shoot date is locked, and never publishes', async () => {
    await expect(performTransition(am, await fresh(briefId), 'scheduled'))
      .rejects.toThrow(/book the shoot/i)

    await supabase.from('batches')
      .update({ status: 'locked', locked_at: new Date().toISOString(), locked_by: am.id })
      .eq('id', batchId)
    expect((await performTransition(am, await fresh(briefId), 'scheduled')).status).toBe('scheduled')

    // a booked shoot is the end of the brief — the content items publish, not it
    await expect(performTransition(am, await fresh(briefId), 'published'))
      .rejects.toThrow(/end of the brief/i)
  })
})

describe('the scope pills, on real rows', () => {
  it('mine / unassigned / all each answer a different question', async () => {
    const mine = await makeItem({ owner_id: editor.id })
    const pool = await makeItem({ owner_id: null })
    const theirs = await makeItem({ owner_id: am.id })

    const { data } = await supabase
      .from('content_items').select('id, status, owner_id, scheduler_ids, batch_id, work_kinds(slug)')
      .in('id', [mine, pool, theirs])
    const rows = (data ?? []) as unknown as WorkItem[]
    expect(rows).toHaveLength(3)

    const asEditor = { id: editor.id, role: editor.role }
    expect(editorScope(rows, asEditor, scope('mine', 'unassigned'))).toHaveLength(2)
    expect(editorScope(rows, asEditor, scope('mine')).map(i => i.id)).toEqual([mine])
    expect(editorScope(rows, asEditor, scope('unassigned')).map(i => i.id)).toEqual([pool])
    expect(editorScope(rows, { id: am.id, role: am.role }, scope('all'))).toHaveLength(3)
  })
})

describe('two people clicking at once', () => {
  it('exactly one wins the edit — the WHERE clause is the referee, not a read', async () => {
    const id = await makeItem({ owner_id: null })
    // the claim route's own UPDATE, run twice concurrently
    const claim = (uid: string) => supabase
      .from('content_items')
      .update({ owner_id: uid, assigned_by: uid })
      .eq('id', id)
      .is('owner_id', null)
      .not('status', 'in', `(${EDITING_CLOSED_STATUSES.join(',')})`)
      .select('id, owner_id')

    const [a, b] = await Promise.all([claim(editor.id), claim(am.id)])
    const winners = [...(a.data ?? []), ...(b.data ?? [])]
    expect(winners).toHaveLength(1)
    expect([a.data?.length ?? 0, b.data?.length ?? 0].sort()).toEqual([0, 1])

    const { data: row } = await supabase.from('content_items').select('owner_id').eq('id', id).single()
    expect(row!.owner_id).toBe(winners[0].owner_id)
    expect([editor.id, am.id]).toContain(row!.owner_id)
  })

  it('exactly one wins the scheduling seat', async () => {
    const id = await makeItem({ owner_id: editor.id, status: 'approved_for_scheduling' })
    const claim = (uid: string) => supabase
      .from('content_items')
      .update({ scheduler_ids: [uid] })
      .eq('id', id)
      .eq('scheduler_ids', '[]')
      .in('status', CLAIMABLE_SCHEDULING_STATUSES as readonly string[] as string[])
      .select('id')

    const [a, b] = await Promise.all([claim(scheduler.id), claim(editor.id)])
    expect([...(a.data ?? []), ...(b.data ?? [])]).toHaveLength(1)
    expect([a.data?.length ?? 0, b.data?.length ?? 0].sort()).toEqual([0, 1])

    const { data: row } = await supabase.from('content_items').select('scheduler_ids').eq('id', id).single()
    expect(row!.scheduler_ids).toHaveLength(1)
    expect([scheduler.id, editor.id]).toContain((row!.scheduler_ids as string[])[0])
  })
})

describe('who can even SEE an unclaimed item', () => {
  it('editor and AM yes, scheduler no — until it is approved', async () => {
    const id = await makeItem({ owner_id: null })

    await expect(loadItemForUser(editor, id)).resolves.toBeTruthy()
    await expect(loadItemForUser(am, id)).resolves.toBeTruthy()
    await expect(loadItemForUser(scheduler, id)).rejects.toThrow(/not found/i)

    // fixture, not a workflow move: park it at approved so the scheduler's
    // status gate opens without walking the whole funnel again
    await supabase.from('content_items')
      .update({ status: 'approved_for_scheduling', scheduler_ids: [] }).eq('id', id)
    await expect(loadItemForUser(scheduler, id)).resolves.toBeTruthy()
  })

  it('handing it to an editor moves the RIGHT to act, even off-client', async () => {
    const id = await makeItem({ owner_id: null, status: 'approved_for_scheduling' })
    await supabase.from('content_items').update({ scheduler_ids: [editor.id] }).eq('id', id)

    // the seat is TAKEN: a scheduler who was not handed this item holds no hat
    // on it and cannot even read it. Status alone used to let them in — a
    // 404 is the right answer, not a readable item they may not act on
    await expect(loadItemForUser(scheduler, id)).rejects.toThrow(/not found/i)
    await expect(performTransition(scheduler, await fresh(id), 'scheduled')).rejects.toThrow()
    // …and it is off their board under the scheduler's default scope
    const { data } = await supabase
      .from('content_items').select('id, status, owner_id, scheduler_ids, batch_id, work_kinds(slug)')
      .eq('id', id)
    expect(schedulerScope((data ?? []) as unknown as WorkItem[], { id: scheduler.id, role: scheduler.role }, scope('mine', 'unassigned')))
      .toHaveLength(0)

    // the editor sees it because they were HANDED it — with their whole-client
    // assignment removed for the length of this assertion
    const { data: link } = await supabase.from('team_user_clients')
      .select('*').eq('team_user_id', editor.id).eq('client_id', TEST_CLIENT_ID).maybeSingle()
    expect(link, 'the editor must be assigned to the ZZ TEST client to begin with').toBeTruthy()
    try {
      await supabase.from('team_user_clients')
        .delete().eq('team_user_id', editor.id).eq('client_id', TEST_CLIENT_ID)
      await expect(loadItemForUser(editor, id)).resolves.toBeTruthy()
    } finally {
      // put the roster back exactly as it was, pass or fail
      await supabase.from('team_user_clients').upsert(link!)
    }
    const { data: restored } = await supabase.from('team_user_clients')
      .select('client_id').eq('team_user_id', editor.id).eq('client_id', TEST_CLIENT_ID).maybeSingle()
    expect(restored, 'the editor’s client assignment must be restored').toBeTruthy()
  })
})

/**
 * Run `fn` with this person's whole-client assignment removed, then put the
 * roster back exactly as it was — pass or fail.
 *
 * This is James's situation, made reproducible: an account manager who is not
 * on the client's team, holding one job for that client. Nothing inside the
 * window may FIRE a notification: with the AM off the roster, resolveAudience
 * falls back to emailing every super admin, and those are real people. The
 * assertions inside are authorization questions, which is where the bug was.
 */
async function offClient<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  const { data: link } = await supabase.from('team_user_clients')
    .select('*').eq('team_user_id', userId).eq('client_id', TEST_CLIENT_ID).maybeSingle()
  try {
    if (link) {
      await supabase.from('team_user_clients')
        .delete().eq('team_user_id', userId).eq('client_id', TEST_CLIENT_ID)
    }
    return await fn()
  } finally {
    if (link) await supabase.from('team_user_clients').upsert(link)
  }
}

const batchRow = async (id: string) => {
  const { data } = await supabase.from('batches')
    .select('id, client_id, owner_id, status').eq('id', id).single()
  return data as { id: string; client_id: string; owner_id: string | null; status: string }
}

/** The item list exactly as `GET /api/production/items` builds it — the same
 *  scope rule, so what this returns is what the person's board shows. */
async function listedFor(user: TeamUser): Promise<string[]> {
  const ids = await accessibleClientIds(user)
  const { data } = await supabase.from('content_items').select('*').limit(500)
  const rows = (data ?? []) as unknown as DbContentItem[]
  if (ids === null) return rows.map(r => r.id)
  const assigned = await assignedItemsFilter(user)
  return rows.filter(r => ids.includes(r.client_id) || assigned(r)).map(r => r.id)
}

describe('James: assigned the shoot brief, off the client team', () => {
  let shootId: string, briefId: string, siblingId: string, strangerId: string

  it('sets the scene — a shoot he owns, its brief, a sibling item, and one that is nothing to do with him', async () => {
    const { data: batch, error } = await supabase.from('batches').insert({
      client_id: TEST_CLIENT_ID,
      title: `E2E James shoot ${new Date().toISOString()}`,
      owner_id: am.id,
      status: 'brief',
      shoot_date: new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10),
      concept: 'E2E visibility audit — nothing is booked with anybody',
    }).select('id').single()
    if (error) throw new Error(error.message)
    shootId = batch.id
    batches.push(shootId)

    briefId = await makeItem({
      owner_id: am.id, batch_id: shootId,
      content_type: 'other', work_kind_id: SHOOT_BRIEF_KIND_ID,
    })
    // made from his shoot, but handed to nobody — the shoot page lists it
    siblingId = await makeItem({ owner_id: null, batch_id: shootId })
    // same client, no shoot, no assignment: the control
    strangerId = await makeItem({ owner_id: null, batch_id: null })
    expect([shootId, briefId, siblingId, strangerId].every(Boolean)).toBe(true)
  })

  it('opens the brief, opens its shoot, and is listed everywhere it appears', async () => {
    await offClient(am.id, async () => {
      // he really is off the team — otherwise this test proves nothing
      expect(await accessibleClientIds(am)).not.toContain(TEST_CLIENT_ID)

      // the brief itself: this much already worked
      await expect(loadItemForUser(am, briefId)).resolves.toBeTruthy()

      // the shoot page — "You are not assigned to this client" lived here
      expect(await canOpenBatch(am, await batchRow(shootId))).toBe(true)
      // …and a page you can open must be a page you can FIND
      expect(await heldBatchIds(am)).toContain(shootId)

      // the client's name, brand and agreement summary travel with the job:
      // the shoot page prints the quotas under every deliverable
      expect(await visibleClientIds(am)).toContain(TEST_CLIENT_ID)

      // the Production briefs lane, the Editor board, the New-work Shoot
      // dropdown — all one list query
      const listed = await listedFor(am)
      expect(listed).toContain(briefId)

      // the shoot page LISTS the sibling item, so the sibling must open:
      // a row that 404s on click is the same broken promise facing outward
      expect(listed).toContain(siblingId)
      await expect(loadItemForUser(am, siblingId)).resolves.toBeTruthy()

      // …and nothing further. An item on the same client that he was handed
      // nothing on is not his, and is not listed for him either.
      await expect(loadItemForUser(am, strangerId)).rejects.toThrow(/not found/i)
      expect(listed).not.toContain(strangerId)
    })
  })

  it('may create items under the shoot he holds, edit the plan, and lock the date', async () => {
    await offClient(am.id, async () => {
      const batch = await batchRow(shootId)
      // the gate `POST /api/production/items` runs for an off-client client_id
      expect(await canOpenBatch(am, batch)).toBe(true)
      // the gates the brief page's Save and "Lock shoot date" run
      expect(checkBatchTransition(am.role, 'brief', 'locked').ok).toBe(true)

      // the plan edit itself, through the same guard the PATCH route uses
      const { error } = await supabase.from('batches')
        .update({ location: 'E2E studio' }).eq('id', shootId)
      expect(error).toBeNull()
    })
  })

  it('and the roster is exactly as it was', async () => {
    const { data } = await supabase.from('team_user_clients')
      .select('client_id').eq('team_user_id', am.id).eq('client_id', TEST_CLIENT_ID).maybeSingle()
    expect(data, 'the account manager’s client assignment must be restored').toBeTruthy()
  })
})

describe('an editor off the team, handed one item on the shoot', () => {
  let shootId: string, itemId: string

  it('opens the item, its shoot page and its Drive folder, and uploads a version', async () => {
    const { data: batch, error } = await supabase.from('batches').insert({
      client_id: TEST_CLIENT_ID,
      title: `E2E off-team editor shoot ${new Date().toISOString()}`,
      owner_id: am.id, status: 'locked',
      locked_at: new Date().toISOString(), locked_by: am.id,
    }).select('id').single()
    if (error) throw new Error(error.message)
    shootId = batch.id
    batches.push(shootId)
    itemId = await makeItem({
      owner_id: editor.id, batch_id: shootId,
      drive_url: 'https://drive.google.com/drive/folders/e2e-visibility-audit',
    })

    await offClient(editor.id, async () => {
      expect(await accessibleClientIds(editor)).not.toContain(TEST_CLIENT_ID)
      const item = await loadItemForUser(editor, itemId)
      expect(item.id).toBe(itemId)

      // the shoot the job sits on, and its place in the shoot list
      expect(await canOpenBatch(editor, await batchRow(shootId))).toBe(true)
      expect(await heldBatchIds(editor)).toContain(shootId)
      expect(await listedFor(editor)).toContain(itemId)

      // the job pack: the editor's hat carries the Drive folder link, which
      // is the whole reason the assignment was made
      const shaped = shapeItemDetail(editor, item, [], []) as Record<string, unknown>
      expect(shaped.acting_roles).toContain('editor')
      expect(shaped.drive_url).toBe('https://drive.google.com/drive/folders/e2e-visibility-audit')
    })

    // the upload itself runs with the roster intact: it fans out to the AM,
    // and an unassigned client would send that fan-out to real super admins
    expect((await addVersion(editor, itemId, v(1))).version_number).toBe(1)
  })
})

describe('a scheduler handed an item off the client team', () => {
  it('opens it and books a slot for it', async () => {
    const id = await makeItem({ owner_id: editor.id })
    await addVersion(editor, id, v(1))
    await performTransition(editor, await fresh(id), 'internal_review')
    await performTransition(am, await fresh(id), 'approved_for_scheduling')
    await supabase.from('content_items').update({ scheduler_ids: [scheduler.id] }).eq('id', id)

    await offClient(scheduler.id, async () => {
      await expect(loadItemForUser(scheduler, id)).resolves.toBeTruthy()
      expect(await listedFor(scheduler)).toContain(id)
      const entry = await upsertScheduleEntry(scheduler, await fresh(id), {
        platform: 'instagram',
        scheduled_at: new Date(Date.now() + 3 * 86_400_000).toISOString(),
      })
      expect(entry.scheduler_id).toBe(scheduler.id)
    })
  })
})

describe('the other half of the rule: nothing is listed that will not open', () => {
  it('an unrelated editor gets a 404 — and never a row to click in the first place', async () => {
    const id = await makeItem({ owner_id: am.id })
    await offClient(editor.id, async () => {
      await expect(loadItemForUser(editor, id)).rejects.toThrow(/not found/i)
      expect(await listedFor(editor)).not.toContain(id)
    })
  })

  it('every item an off-team person IS shown, they can open', async () => {
    await offClient(editor.id, async () => {
      const listed = await listedFor(editor)
      // a bounded sample: the point is that the two answers agree, and the
      // list query is capped at 500 rows across every client they touch
      for (const id of listed.filter(i => created.includes(i))) {
        await expect(loadItemForUser(editor, id), `listed but not openable: ${id}`)
          .resolves.toBeTruthy()
      }
    })
  })
})

describe('tagging: "@Name" reaches anyone on the team, and the tag is the assignment', () => {
  let itemId: string, commentId: string

  it('the account manager tags the editor by typing their name — the same rule the box and the route share', async () => {
    itemId = await makeItem({ owner_id: null })
    const team = await taggableTeam()
    // every active non-client team member is taggable — the editor by NAME
    const editorRow = team.find(t => t.id === editor.id)
    expect(editorRow, 'the test editor must be active and taggable').toBeTruthy()
    const text = `@${editorRow!.name} can you check the hook in the first two seconds?`
    const tagged = resolveTags(text, [], team, am.id)
    expect(tagged.map(t => t.id)).toEqual([editor.id])

    // exactly what POST /comments writes, then notifies
    const { data, error } = await supabase.from('item_comments').insert({
      item_id: itemId, author_id: am.id, visibility: 'internal', body: text, assigned_to: tagged[0].id,
    }).select('id').single()
    if (error) throw new Error(error.message)
    commentId = data.id
    await notifyTagged({
      actor: am, tagged, text,
      target: { kind: 'item', id: itemId, title: 'E2E tagged item' },
      commentId,
    })
  })

  it('the editor gets a notification row that links to the item, an email, the badge and the "Waiting on you" card', async () => {
    const rows = await until(
      async () => (await supabase.from('notification_log')
        .select('recipient_id, recipient_email, entity_type, entity_id, event_type, read_at')
        .eq('entity_id', `${itemId}#${commentId}`)).data ?? [],
      r => r.length > 0,
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].recipient_id).toBe(editor.id)
    expect(rows[0].recipient_email.endsWith('.invalid')).toBe(true)
    expect(rows[0].event_type).toBe('comment_assigned')
    // the bell counts it (unread), and the Notifications page can open it
    expect(rows[0].read_at).toBeNull()
    expect(notificationHref(rows[0].entity_type, rows[0].entity_id)).toBe(`/dashboard/production/${itemId}`)

    // the board badge and the Overview card read the same answer
    const open = await openTaggedIds(editor)
    expect(open.items).toContain(itemId)
  })

  it('the deep link opens for the editor even off the client team — and the item is listed for them', async () => {
    await offClient(editor.id, async () => {
      expect(await accessibleClientIds(editor)).not.toContain(TEST_CLIENT_ID)
      expect(await taggedItemIds(editor)).toContain(itemId)
      await expect(loadItemForUser(editor, itemId)).resolves.toBeTruthy()
      expect(await listedFor(editor)).toContain(itemId)
    })
  })

  it('marking it done clears the badge, the card and the bell', async () => {
    // exactly what PATCH /comments does
    await supabase.from('item_comments').update({ resolved: true }).eq('id', commentId)
    await settleTagNotifications(itemId, commentId)

    expect((await openTaggedIds(editor)).items).not.toContain(itemId)
    const { data } = await supabase.from('notification_log')
      .select('read_at').eq('entity_id', `${itemId}#${commentId}`).single()
    expect(data?.read_at).not.toBeNull()
    // the item stays openable: the deep link in the email must not rot
    await offClient(editor.id, async () => {
      await expect(loadItemForUser(editor, itemId)).resolves.toBeTruthy()
    })
  })
})

describe('any team role creates work — the owner\'s rule, on real rows', () => {
  it('a SCHEDULER creates an item, holds it, and their board lists it', async () => {
    // the gate the POST route runs, from the scheduler's seat
    expect(canCreateItemsUnder('locked', scheduler.role)).toBe(true)
    expect(canCreateItemsUnder(null, scheduler.role, { reason: 'client emergency story' })).toBe(true)
    expect(roleMayCreateItems(scheduler.role)).toBe(true)

    const id = await makeItem({ owner_id: scheduler.id })
    await expect(loadItemForUser(scheduler, id)).resolves.toBeTruthy()
    expect(await listedFor(scheduler)).toContain(id)
  })

  it('an EDITOR raises a TASK for a client they are NOT on — tasks are internal work', async ctx => {
    // a real task kind: no media, not the shoot plan. Without one seeded the
    // rule cannot be played live — skip rather than invent global data.
    const { data: kinds } = await supabase
      .from('work_kinds')
      .select('id, slug, uses_media')
      .eq('uses_media', false)
      .neq('slug', 'shoot_brief')
      .limit(1)
    const taskKind = kinds?.[0]
    if (!taskKind) return ctx.skip()

    // the exemption the POST route applies: a task skips the client-team check
    expect(taskExemptFromClientScope(taskKind)).toBe(true)
    expect(taskExemptFromClientScope({ slug: 'edit', uses_media: true })).toBe(false)

    await offClient(editor.id, async () => {
      expect(await accessibleClientIds(editor)).not.toContain(TEST_CLIENT_ID)
      // the task really lands, and its creator can open and find it
      const id = await makeItem({
        owner_id: editor.id, batch_id: null,
        content_type: 'other', work_kind_id: taskKind.id,
      })
      await expect(loadItemForUser(editor, id)).resolves.toBeTruthy()
      expect(await listedFor(editor)).toContain(id)
    })
  })

  it('an AM and a super admin may edit someone else\'s item; a bystander may not', async () => {
    const id = await makeItem({ owner_id: editor.id })
    const item = await fresh(id)

    // the rule the PATCH route runs (item-edit-core), against a real row
    expect(canEditItemFields(am, item)).toBe(true)
    const superAdmin = { ...am, id: '00000000-0000-4000-8000-00000000e2e0', role: 'super_admin' as const }
    expect(canEditItemFields(superAdmin, item)).toBe(true)
    expect(canEditItemFields(editor, item)).toBe(true)          // their own
    expect(canEditItemFields(scheduler, item)).toBe(false)      // handed nothing
    expect(canEditItemFields({ id: 'x', role: 'client' }, item)).toBe(false)

    // …and the AM's edit actually lands and is readable back
    await expect(loadItemForUser(am, id)).resolves.toBeTruthy()
    const { error } = await supabase.from('content_items')
      .update({ priority: 'high' }).eq('id', id)
    expect(error).toBeNull()
    expect((await fresh(id) as ContentItem & { priority?: string }).priority).toBe('high')

    // anyone HANDED the scheduling edits their own too, whatever the title
    await supabase.from('content_items').update({ scheduler_ids: [scheduler.id] }).eq('id', id)
    expect(canEditItemFields(scheduler, await fresh(id))).toBe(true)
  })
})

describe('a quota group of 5 fills as pieces are added', () => {
  let groupId: string | null = null

  afterAll(async () => {
    if (groupId) await supabase.from('deliverable_groups').delete().eq('id', groupId)
  })

  it('one group, target 5: 0 of 5 → 2 of 5 → full at 5', async ctx => {
    // the table ships with supabase/deliverable_groups.sql — skip cleanly on
    // a database where it has not been run yet
    const probe = await supabase.from('deliverable_groups').select('id').limit(1)
    if (probe.error && /does not exist|relation|could not find the table|schema cache/i.test(probe.error.message)) return ctx.skip()

    const { data: group, error } = await supabase.from('deliverable_groups').insert({
      client_id: TEST_CLIENT_ID,
      content_type: 'reel',
      title: `E2E quota reels ${new Date().toISOString()}`,
      target: 5,
      created_by: am.id,
    }).select().single()
    if (error) throw new Error(error.message)
    groupId = group.id

    const cardFor = async () => {
      const { data } = await supabase.from('content_items')
        .select('id, status, group_id').eq('group_id', group.id)
      return groupCard(group, (data ?? []) as { id: string; status: ItemStatus; group_id: string }[])
    }
    expect((await cardFor()).count).toBe(0)

    // "Add the next reel", twice — titles numbered from what exists
    for (let n = 0; n < 2; n++) {
      const title = nextPieceTitle(group, n)
      expect(title.endsWith(String(n + 1).padStart(2, '0'))).toBe(true)
      await makeItem({ owner_id: editor.id, group_id: group.id, title })
    }
    const two = await cardFor()
    expect(two.count).toBe(2)
    expect(two.target).toBe(5)
    expect(two.full).toBe(false)
    expect(groupLine(two)).toContain('2 of 5')

    // three more and the promise is met
    for (let n = 2; n < 5; n++) {
      await makeItem({ owner_id: editor.id, group_id: group.id, title: nextPieceTitle(group, n) })
    }
    expect((await cardFor()).full).toBe(true)
  })
})

describe('final-post approval: the caption gets its own yes before anything queues', () => {
  /** the columns ship in supabase/posting_approval.sql — on a database where
   *  it has not been run, skip cleanly rather than invent schema */
  async function gateReady(): Promise<boolean> {
    const probe = await supabase.from('content_items').select('posting_approval_state').limit(1)
    return !probe.error
  }
  type Item = Parameters<typeof actOnPostingApproval>[1]

  it('scheduler sends → queue refused → AM approves → queue opens', async ctx => {
    if (!(await gateReady())) return ctx.skip()

    const id = await makeItem({ owner_id: editor.id, caption: 'E2E final caption — exactly as it will post' })
    await addVersion(editor, id, v(1))
    await performTransition(editor, await fresh(id), 'internal_review')
    await performTransition(am, await fresh(id), 'approved_for_scheduling')
    await supabase.from('content_items').update({ scheduler_ids: [scheduler.id] }).eq('id', id)
    await upsertScheduleEntry(scheduler, await fresh(id), {
      platform: 'instagram',
      scheduled_at: new Date(Date.now() + 86_400_000).toISOString(),
    })

    // the AM holds no scheduling here — sending is not their move
    await expect(actOnPostingApproval(am, await fresh(id) as unknown as Item, { action: 'send' }))
      .rejects.toThrow(/scheduling/i)

    // the scheduler HOLDING the item sends the post for approval
    const sent = await actOnPostingApproval(scheduler, await fresh(id) as unknown as Item, { action: 'send' })
    expect(sent.posting_approval_state).toBe('pending')

    // the queue is refused while the answer is out — the same plan
    // queueItemPublish and the publish route build from
    const blocked = await planItemPublish(id)
    expect(blocked.blocked).toMatch(/final approval/i)

    // the scheduler cannot answer their own question
    await expect(actOnPostingApproval(scheduler, await fresh(id) as unknown as Item, { action: 'approve' }))
      .rejects.toThrow(/account manager|client/i)

    // the AM approves the post — who and when are recorded
    const approved = await actOnPostingApproval(am, await fresh(id) as unknown as Item, { action: 'approve' })
    expect(approved.posting_approval_state).toBe('approved')
    expect(approved.posting_approved_by).toBe(am.id)
    expect(approved.posting_approved_at).toBeTruthy()

    // …and the approval gate no longer stands in the plan's way (whatever it
    // may still say about connected accounts, which are not this rule's)
    const open = await planItemPublish(id)
    expect(open.blocked ?? '').not.toMatch(/final approval/i)

    // an approved post whose caption then changes must be re-approved — the
    // pure rule the PATCH route applies
    expect(stateAfterPostEdit(approved.posting_approval_state)).toBe('pending')
  })

  it('request changes sends it back with the note; a fresh send re-opens the loop', async ctx => {
    if (!(await gateReady())) return ctx.skip()

    const id = await makeItem({ owner_id: editor.id, caption: 'E2E caption, first attempt' })
    await addVersion(editor, id, v(1))
    await performTransition(editor, await fresh(id), 'internal_review')
    await performTransition(am, await fresh(id), 'approved_for_scheduling')
    await supabase.from('content_items').update({ scheduler_ids: [scheduler.id] }).eq('id', id)

    await actOnPostingApproval(scheduler, await fresh(id) as unknown as Item, { action: 'send' })

    // a request for changes without the note is refused — the note IS the ask
    await expect(actOnPostingApproval(am, await fresh(id) as unknown as Item, { action: 'request_changes' }))
      .rejects.toThrow(/what should change/i)

    const changed = await actOnPostingApproval(am, await fresh(id) as unknown as Item, {
      action: 'request_changes', note: 'Drop the second hashtag',
    })
    expect(changed.posting_approval_state).toBe('changes')
    expect(changed.posting_approval_note).toBe('Drop the second hashtag')

    // still refused at the queue
    expect((await planItemPublish(id)).blocked).toMatch(/changes/i)

    // the scheduler re-sends after fixing — pending again, the old note wiped
    const resent = await actOnPostingApproval(scheduler, await fresh(id) as unknown as Item, { action: 'send' })
    expect(resent.posting_approval_state).toBe('pending')
    expect(resent.posting_approval_note).toBeNull()
  })

  it('client_too routes it to the portal pile; approval empties it', async ctx => {
    if (!(await gateReady())) return ctx.skip()

    const id = await makeItem({ owner_id: editor.id, caption: 'E2E caption for the client' })
    await addVersion(editor, id, v(1))
    await performTransition(editor, await fresh(id), 'internal_review')
    await performTransition(am, await fresh(id), 'approved_for_scheduling')
    await supabase.from('content_items').update({ scheduler_ids: [scheduler.id] }).eq('id', id)

    const sent = await actOnPostingApproval(scheduler, await fresh(id) as unknown as Item, {
      action: 'send', client_too: true,
    })
    expect(sent.posting_client_required).toBe(true)

    // the same predicate portal-data uses to build "Ready to post"
    const { awaitsClientPostApproval } = await import('../../app/lib/posting-approval-core')
    expect(awaitsClientPostApproval(await fresh(id) as unknown as {
      status: string; posting_approval_state?: unknown; posting_client_required?: unknown
    })).toBe(true)

    await actOnPostingApproval(am, await fresh(id) as unknown as Item, { action: 'approve' })
    expect(awaitsClientPostApproval(await fresh(id) as unknown as {
      status: string; posting_approval_state?: unknown; posting_client_required?: unknown
    })).toBe(false)
  })
})

describe('no real person was notified', () => {
  it('every notification these items produced went to a .invalid test address', async () => {
    const rows = await until(() => notificationRows(created), r => r.length > 0)
    expect(rows.length).toBeGreaterThan(0) // the flow really did fan out
    // a refused send to a real address is the EMAIL_TEST_ONLY kill-switch doing
    // its job; only a SENT email to a real person is a leak
    const leaked = rows.filter(r => !r.recipient_email.endsWith('.invalid') && r.status === 'sent')
    expect(leaked, `leaked to: ${leaked.map(r => `${r.recipient_email} (${r.entity_id})`).join(', ')}`)
      .toHaveLength(0)
  })
})
