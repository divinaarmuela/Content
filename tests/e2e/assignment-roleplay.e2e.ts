import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { supabase } from '../../lib/supabase'
import type { TeamUser } from '../../app/lib/authz'
import { performTransition, addVersion, type ContentItem } from '../../app/lib/workflow'
import { loadItemForUser } from '../../app/lib/production-access'
import { editorScope, schedulerScope, isBriefTask, type ScopeMode, type WorkItem } from '../../app/lib/work-pages-core'
import { CLAIMABLE_SCHEDULING_STATUSES, EDITING_CLOSED_STATUSES } from '../../app/lib/claim-core'

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
  // let the fire-and-forget notification fan-outs settle before teardown
  await new Promise(r => setTimeout(r, 3000))
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
      .rejects.toThrow(/lock the shoot date/i)

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

    // the scheduler may still read a post-approval item (loadItemForUser gates
    // on STATUS, not on the handoff) but holds no hat on it: the seat is taken
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

describe('no real person was notified', () => {
  it('every notification these items produced went to a .invalid test address', async () => {
    await new Promise(r => setTimeout(r, 2500))
    const rows: { recipient_email: string; entity_id: string; status: string }[] = []
    for (const id of created) {
      const { data } = await supabase
        .from('notification_log')
        .select('recipient_email, entity_id, status')
        .like('entity_id', `${id}%`)
      rows.push(...(data ?? []))
    }
    expect(rows.length).toBeGreaterThan(0) // the flow really did fan out
    // a refused send to a real address is the EMAIL_TEST_ONLY kill-switch doing
    // its job; only a SENT email to a real person is a leak
    const leaked = rows.filter(r => !r.recipient_email.endsWith('.invalid') && r.status === 'sent')
    expect(leaked, `leaked to: ${leaked.map(r => `${r.recipient_email} (${r.entity_id})`).join(', ')}`)
      .toHaveLength(0)
  })
})
