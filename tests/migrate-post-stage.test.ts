/**
 * The post stage migration (SPEC §6, package P8), run against a scrubbed
 * snapshot of the live rows the spec cites (tests/fixtures/migrate-post-stage.json,
 * read 29 Sep 2026). The script's rules are checked against the app's own
 * readers: every row it writes must read as a post (readPostState), the
 * client's page must say the right thing (clientPostView), and the next move
 * must be allowed (checkPostTransition). The writer is checked with an
 * in-memory REST fake — nothing here touches a real database.
 */
import { describe, it, expect } from 'vitest'
import fixture from './fixtures/migrate-post-stage.json'
import {
  planMigration, planDropLegacy, applyPlan, makeRest, parseArgs, rowsOf, stableJson, sameRow,
  approvalHatOf, LEGACY_POST_FIELDS, LEGACY_ITEM_FIELDS, NULL_ETAG,
} from '../scripts/migrate-post-stage.mjs'
import * as stage from '@/app/lib/post-stage-core'
import * as outcome from '@/app/lib/post-outcome-core'
import * as publish from '@/app/lib/publish-core'
import { clientPostView } from '@/app/lib/portal-core'

const cores = { stage, outcome, publish }
const NOW = '2026-09-29T02:00:00.000Z'

type Row = Record<string, any>
type Snap = Record<string, Row[]>
const freshSnap = (): Snap => {
  const f = JSON.parse(JSON.stringify(fixture)) as Record<string, unknown>
  delete f._about
  return f as Snap
}
const plan = () => planMigration(freshSnap(), cores, { now: NOW })
const byShort = (p: ReturnType<typeof plan>, id: string) => {
  const found = p.plans.find((x: Row) => x.id.startsWith(id))
  if (!found) throw new Error(`no post ${id}`)
  return found
}
const afterOf = (p: ReturnType<typeof plan>, id: string): Row => {
  const w = p.postWrites.find((x: Row) => x.id.startsWith(id))
  if (!w) throw new Error(`no write for ${id}`)
  return w.after
}
const stateOf = (p: ReturnType<typeof plan>, id: string) => {
  const s = stage.readPostState(afterOf(p, id))
  if (!s) throw new Error(`${id} does not read as a post`)
  return s
}

describe('which stage each cited post gets (SPEC §6, first match wins)', () => {
  const p = plan()
  it.each([
    ['11b9a6cc', 'M1', 'cancelled'],
    ['9024fe1c', 'M1', 'cancelled'],
    ['a7a5f0de', 'M2', 'posted'],
    ['bbf70b79', 'M2', 'posted'],
    ['3192d68f', 'M2', 'posted'],
    ['34adf560', 'M2', 'posted'],
    ['84f9420e', 'M2', 'posted'],
    ['1c6d107e', 'M2', 'posted'],
    ['01444e51', 'M2', 'posted'],
    ['ff85fac3', 'M2', 'posted'],
    ['d5830a61', 'M2', 'posted'],
    ['4e742215', 'M5', 'cancelled'],
    ['fc3ee75b', 'M5', 'cancelled'],
    ['0d892f0f', 'M6', 'cancelled'],
    ['1a78c21a', 'M6', 'cancelled'],
    ['2a74c976', 'M7', 'with_client'],
    ['e7f0e7a3', 'M7', 'with_client'],
    ['e410ee80', 'M8', 'quality_check'],
    ['e2d47057', 'M9', 'draft'],
    ['7bc2f99b', 'M11', 'draft'],
    ['008f0eeb', 'M11', 'cancelled'],
  ])('%s → %s %s', (id, rule, want) => {
    const x = byShort(p, id)
    expect(x.rule).toBe(rule)
    expect(x.stage).toBe(want)
    expect(stateOf(p, id).stage).toBe(want)
  })

  it('maps every post in the snapshot, and every written row reads as a post', () => {
    expect(p.plans.filter((x: Row) => x.unmapped)).toEqual([])
    expect(p.plans.filter((x: Row) => x.invalid_after)).toEqual([])
    for (const w of p.postWrites) expect(stage.readPostState(w.after)).not.toBeNull()
  })

  it('never reads a stage from anything but its own rules: laneOf is the stage it wrote', () => {
    for (const w of p.postWrites) {
      const s = stage.readPostState(w.after)!
      expect(stage.laneOf(s)).toBe(w.after.stage)
    }
  })
})

describe('what a migrated post carries', () => {
  const p = plan()

  it('ff85fac3: its re-sends join the booking, approved by the super admin, never "sent to client"', () => {
    const s = stateOf(p, 'ff85fac3')
    expect(s.booking?.job_ids).toEqual(expect.arrayContaining([
      expect.stringMatching(/^a8854fc7/), expect.stringMatching(/^54f9c381/), expect.stringMatching(/^fdb70988/),
    ]))
    expect(s.approval).toMatchObject({ hat: 'super_admin', version: 1, on_behalf_of_client: false })
    expect(s.approval?.by).toMatch(/^b9be2fe1/)
    expect(s.client_send).toBeNull()
    expect(stage.liveNetworks(s).sort()).toEqual(['instagram', 'linkedin', 'tiktok'])
  })

  it('a7a5f0de went out on LinkedIn only', () => {
    const s = stateOf(p, 'a7a5f0de')
    expect(Object.keys(s.outcomes)).toEqual(['linkedin'])
    expect(s.outcomes.linkedin.status).toBe('published')
    expect(s.problem).toBeNull()
  })

  it('posted rows keep a live link only on the network it belongs to (audit L1)', () => {
    for (const w of p.postWrites.filter((x: Row) => x.after.stage === 'posted')) {
      for (const [platform, o] of Object.entries(w.after.outcomes as Record<string, Row>)) {
        if (o.url) expect(outcome.urlBelongsTo(platform, o.url, true)).toBe(true)
      }
    }
  })

  it('M7: frozen v1 from the migration, sent to the client when the card was, and the client can answer', () => {
    const s = stateOf(p, '2a74c976')
    expect(s.sent_version).toBe(1)
    expect(s.draft_version).toBe(2)
    expect(s.approval_steps).toBe('team_then_client')
    expect(s.client_send).toMatchObject({ version: 1, via: 'email', at: '2026-09-28T02:40:47.610Z' })
    expect(s.client_send!.to).toEqual(['client@example.invalid'])
    expect(Date.parse(s.client_send!.approve_by!)).toBeLessThan(Date.parse(s.scheduled_for!))
    const v = p.versionWrites.find((x: Row) => x.post_id === s.id)!.row
    expect(v).toMatchObject({ n: 1, frozen_for: 'migration', from_migration: true, id: stage.postVersionId(s.id, 1) })
    expect(v.slides).toEqual(afterOf(p, '2a74c976').slides)
    expect(clientPostView(s, NOW)?.state).toBe('review')
    const ok = stage.checkPostTransition(s, 'approve_for_client', { id: 'am', hats: ['am'] },
      { version: 1, agreed_via: 'call' }, { now: NOW }, { lenient: true })
    expect(ok.ok).toBe(true)
    expect(byShort(p, '2a74c976').notes.join(' ')).toMatch(/Frozen at migration, not at send/)
  })

  it('M8: at the quality check with v1, team only, and the reviewer can pass it', () => {
    const s = stateOf(p, 'e410ee80')
    expect(s.sent_version).toBe(1)
    expect(s.approval_steps).toBe('team')
    expect(s.client_send).toBeNull()
    expect(clientPostView(s, NOW)).toBeNull()
    const ok = stage.checkPostTransition(s, 'pass', { id: 'qr', hats: ['qr'] }, { version: 1 }, { now: NOW }, { lenient: true })
    expect(ok.ok).toBe(true)
  })

  it('M9: the client asked, the time that passed is cleared, and the portal thanks the client for their note', () => {
    const s = stateOf(p, 'e2d47057')
    expect(s.changes_asked).toMatchObject({ who: 'client', version: 1 })
    expect(s.changes_asked?.by).toMatch(/^20e16098/)
    expect(s.scheduled_for).toBeNull()
    expect(s.sent_version).toBe(1)
    expect(clientPostView(s, NOW)?.state).toBe('thanks')
    // the frozen copy keeps the time it was sent with
    const v = p.versionWrites.find((x: Row) => x.post_id === s.id)!.row
    expect(v.scheduled_for).toBe('2026-09-28T08:00:00.000Z')
  })

  it('an approver whose role cannot approve is not carried over, and says so', () => {
    const s = stateOf(p, 'd5830a61')
    expect(s.approval).toBeNull()
    expect(byShort(p, 'd5830a61').notes.join(' ')).toMatch(/scheduler/)
  })

  it('every post whose card was deleted is marked source_deleted; the unposted ones are cancelled as "card deleted"', () => {
    const snap = freshSnap()
    const items = new Set(snap.content_items.map(i => i.id))
    for (const w of p.postWrites) {
      const orphan = !items.has(w.before.item_id)
      expect(w.after.source_deleted).toBe(orphan)
      if (orphan && w.after.stage !== 'posted') {
        expect(w.after.stage).toBe('cancelled')
        if (w.before.status !== 'cancelled') expect(w.after.cancelled.reason).toBe('card deleted')
      }
    }
  })

  it('a post never frozen has no sent version, so it can still be deleted as a draft', () => {
    const s = stateOf(p, '7bc2f99b')
    expect(s.sent_version).toBeNull()
    expect(p.versionWrites.some((x: Row) => x.post_id === s.id)).toBe(false)
    expect(stage.checkPostTransition(s, 'delete_draft', { id: s.created_by, hats: ['creator'] }, { confirm: true }, { now: NOW }).ok).toBe(true)
  })

  it('keeps the old fields in --write (only --drop-legacy removes them) and writes one event per post at its new rev', () => {
    for (const w of p.postWrites) {
      for (const f of LEGACY_POST_FIELDS) if (f in w.before) expect(w.after[f]).toEqual(w.before[f])
      const e = p.eventWrites.find((x: Row) => x.post_id === w.id)!
      expect(e.id).toBe(stage.postEventId(w.id, w.after.rev))
      expect(e.row).toMatchObject({ from: null, to: w.after.stage, action: 'migrate', hat: 'system' })
    }
  })

  it('does not change the snapshot it was given', () => {
    const snap = freshSnap()
    const before = stableJson(snap)
    planMigration(snap, cores, { now: NOW })
    expect(stableJson(snap)).toBe(before)
  })
})

describe('schedule rows, one per network (L1, L2, L8)', () => {
  const p = plan()
  const find = (id: string): Row | undefined => p.scheduleWrites.find((w: Row) => w.id.startsWith(id))
  const write = (id: string): Row => { const w = find(id); if (!w) throw new Error(`no schedule write for ${id}`); return w }

  it('the eight rows carrying another network\'s link are rewritten, each to its own network or no link', () => {
    for (const id of ['664bc5e9', 'db43d45c', 'ade9808c', '8f3a9862', 'd6cd38f7', '93ebe5c9', '2f178d68', 'c8fd52cf']) {
      const w = write(id)
      if (w.after.live_url) expect(outcome.urlBelongsTo(w.after.platform, w.after.live_url, true)).toBe(true)
    }
  })

  it('c8fd52cf: Instagram never went out, so the row is no longer published, and the report says it is owed', () => {
    const w = write('c8fd52cf')
    expect(w.after.publish_status).toBeUndefined()
    expect(w.after.live_url).toBeUndefined()
    expect(p.scheduleNotes.some((n: Row) => n.item_id.startsWith('054e0959') && /Instagram/.test(n.text))).toBe(true)
  })

  it('48f70493 takes the time of the job that published it, not the cancelled one', () => {
    const w = write('48f70493')
    const job = freshSnap().publish_jobs.find(j => j.id.startsWith('3d2e8537'))!
    expect(w.after.scheduled_at).toBe(job.scheduled_for)
  })

  it('leaves the rows of deleted cards alone', () => {
    expect(p.orphanScheduleRows.some((id: string) => id.startsWith('034bda63'))).toBe(true)
    expect(find('034bda63')).toBeUndefined()
  })
})

describe('the edit side (L4) and unowned jobs', () => {
  const p = plan()
  it('stamps the cards that reached the client before rounds were kept, and normalises 9169e122', () => {
    const w = (id: string) => p.itemWrites.find((x: Row) => x.id.startsWith(id))
    expect(w('370209f1')?.after).toMatchObject({ client_round: 1, client_rounds: [1] })
    expect(w('b98b07a3')?.after).toMatchObject({ client_round: 1, client_rounds: [1] })
    expect(w('9169e122')?.after.client_rounds).toEqual([2])
    expect(w('411da9a1')).toBeUndefined()
  })
  it('lists the jobs no post holds, but not the re-sends it joined', () => {
    const ids = p.unownedJobs.map((j: Row) => j.id.slice(0, 8))
    expect(ids).toContain('e63c744f')
    expect(ids).not.toContain('54f9c381')
    expect(ids).not.toContain('fdb70988')
  })
})

/* ── the writer, against an in-memory REST fake ─────────────────────────── */

function fakeRest(seed: Snap) {
  const store = new Map<string, unknown>()
  for (const [t, rows] of Object.entries(seed)) for (const r of rows) store.set(`/mdm/tables/${t}/${r.id}`, JSON.parse(JSON.stringify(r)))
  const etag = (v: unknown) => (v == null ? NULL_ETAG : `e${stableJson(v).length}_${[...stableJson(v)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7)}`)
  const touched: string[] = []
  return {
    store, touched,
    async get(p: string) { const value = store.get(p) ?? null; return { etag: etag(value), value } },
    async put(p: string, value: unknown, ifMatch: string) {
      touched.push(p)
      if (etag(store.get(p) ?? null) !== ifMatch) return { ok: false, conflict: true }
      store.set(p, JSON.parse(JSON.stringify(value)))
      return { ok: true }
    },
  }
}

describe('--write, against a fake database', () => {
  it('writes every planned row under /mdm/tables, and a second run changes nothing', async () => {
    const snap = freshSnap()
    const p = planMigration(snap, cores, { now: NOW })
    const rest = fakeRest(snap)
    const first = await applyPlan(p, rest)
    expect(first.every((r: Row) => r.outcome === 'written')).toBe(true)
    expect(rest.touched.every(t => t.startsWith('/mdm/tables/'))).toBe(true)
    const posts = [...rest.store.entries()].filter(([k]) => k.startsWith('/mdm/tables/social_posts/')).map(([, v]) => v as Row)
    expect(posts.every(r => stage.readPostState(r) !== null)).toBe(true)
    const again = await applyPlan(p, rest)
    expect(again.every((r: Row) => r.outcome === 'already')).toBe(true)
  })

  it('never overwrites a row someone changed after the read (trap 11)', async () => {
    const snap = freshSnap()
    const p = planMigration(snap, cores, { now: NOW })
    const rest = fakeRest(snap)
    const target = p.postWrites.find((w: Row) => w.id.startsWith('e410ee80'))!
    const key = `/mdm/tables/social_posts/${target.id}`
    const theirs = { ...(rest.store.get(key) as Row), caption: 'edited meanwhile' }
    rest.store.set(key, theirs)
    const results = await applyPlan(p, rest)
    expect(results.find((r: Row) => r.id === target.id && r.table === 'social_posts')?.outcome).toBe('changed')
    expect(rest.store.get(key)).toEqual(theirs)
    // and its event is not written for a move that did not land
    expect(rest.store.has(`/mdm/tables/post_events/${stage.postEventId(target.id, target.after.rev)}`)).toBe(false)
  })

  it('leaves a post alone when a different version 1 is already there', async () => {
    const snap = freshSnap()
    const p = planMigration(snap, cores, { now: NOW })
    const rest = fakeRest(snap)
    const target = p.postWrites.find((w: Row) => w.id.startsWith('2a74c976'))!
    rest.store.set(`/mdm/tables/post_versions/${stage.postVersionId(target.id, 1)}`, { id: 'x', caption: 'someone else\'s v1' })
    const results = await applyPlan(p, rest)
    expect(results.find((r: Row) => r.id === target.id && r.table === 'social_posts')?.outcome).toMatch(/^skipped/)
    expect((rest.store.get(`/mdm/tables/social_posts/${target.id}`) as Row).stage).toBeUndefined()
  })

  it('--drop-legacy is refused before --write, and after it strips only the old fields', async () => {
    const snap = freshSnap()
    expect(planDropLegacy(snap, cores).refused).toMatch(/no stage/)
    const p = planMigration(snap, cores, { now: NOW })
    const rest = fakeRest(snap)
    await applyPlan(p, rest)
    const read = (t: string) => rowsOf(Object.fromEntries([...rest.store.entries()]
      .filter(([k]) => k.startsWith(`/mdm/tables/${t}/`)).map(([k, v]) => [k.split('/').pop()!, v])))
    const migrated = { ...snap, social_posts: read('social_posts'), content_items: read('content_items') }
    const drop = planDropLegacy(migrated, cores)
    expect(drop.refused).toBeNull()
    for (const w of drop.writes) {
      const fields = w.table === 'social_posts' ? LEGACY_POST_FIELDS : LEGACY_ITEM_FIELDS
      for (const f of fields) expect(f in w.after).toBe(false)
      const kept = Object.keys(w.before).filter(k => !fields.includes(k))
      for (const k of kept) expect(w.after[k]).toEqual(w.before[k])
      if (w.table === 'social_posts') expect(stage.readPostState(w.after)?.stage).toBe(w.before.stage)
    }
  })

  it('the REST client refuses any path outside /mdm/tables', async () => {
    const rest = makeRest('https://example.invalid', (async () => { throw new Error('must not be called') }) as never)
    await expect(rest.get('/other/thing')).rejects.toThrow(/only \/mdm\/tables/)
    await expect(rest.put('/mdm/uniq/x', {}, NULL_ETAG)).rejects.toThrow(/only \/mdm\/tables/)
  })
})

describe('the command line', () => {
  it('is a dry run unless --write is given', () => {
    expect(parseArgs([]).write).toBe(false)
    expect(parseArgs(['--dry-run']).write).toBe(false)
    expect(parseArgs(['--write']).write).toBe(true)
    expect(parseArgs(['--drop-legacy']).write).toBe(false)
    expect(() => parseArgs(['--dry-run', '--write'])).toThrow()
    expect(() => parseArgs(['--wirte'])).toThrow(/Unknown flag/)
  })
})

describe('helpers', () => {
  it('compares rows whatever order their keys are in', () => {
    expect(sameRow({ a: 1, b: { c: 2, d: 3 } }, { b: { d: 3, c: 2 }, a: 1 })).toBe(true)
    expect(sameRow({ a: 1 }, { a: 2 })).toBe(false)
  })
  it('reads the approving role from team_users', () => {
    expect(approvalHatOf({ role: 'super_admin' })).toBe('super_admin')
    expect(approvalHatOf({ role: 'account_manager' })).toBe('account_manager')
    expect(approvalHatOf({ role: 'quality_checker' })).toBe('quality_reviewer')
    expect(approvalHatOf({ role: 'editor', quality_reviewer: true })).toBe('quality_reviewer')
    expect(approvalHatOf({ role: 'client' })).toBe('client')
    expect(approvalHatOf({ role: 'scheduler' })).toBeNull()
    expect(approvalHatOf(null)).toBeNull()
  })
})
