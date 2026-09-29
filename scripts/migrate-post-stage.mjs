// scripts/migrate-post-stage.mjs — give every social_posts row its one `stage`
// (the posting rebuild, docs/posting-rebuild/SPEC.md §6, package P8).
//
//   node scripts/migrate-post-stage.mjs                       dry run (the default): reads, plans, reports
//   node scripts/migrate-post-stage.mjs --report <file.md>    also writes the plan as a Markdown report
//   node scripts/migrate-post-stage.mjs --write               applies the plan
//   node scripts/migrate-post-stage.mjs --drop-legacy         plans removing the old fields (dry)
//   node scripts/migrate-post-stage.mjs --drop-legacy --write removes them
//   --backup-dir <dir>   where the backup JSON goes (default: the OS temp folder)
//
// WHEN: --write only after P1 and P2 are deployed (SPEC §7 merge order), and
// --drop-legacy only after --write has been checked on the live pages.
//
// Every mode first reads the tables it needs and saves them as a backup JSON
// on THIS machine. A dry run writes nothing to the database.
//
// How it writes (trap 11, never check-then-write): every row it changes is
// read again with its ETag and written with `if-match` on that ETag, and only
// when the row is still exactly what the plan was made from. A row someone
// changed since is skipped and reported, not overwritten. A new row
// (post_versions, post_events) is written with `if-match: null_etag`, so it is
// created only if nothing is there. It never writes outside /mdm/tables.
//
// The rules (which stage, what the post knew) are NOT written again here:
// they are read from the app's own pure files — post-stage-core.ts,
// post-outcome-core.ts and publish-core.ts — so the migration reads a job
// exactly as the live publish recorder does. The CLI loads them with jiti
// (it ships with Tailwind 3); the test hands them in directly.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'

/* ── what it reads and writes ───────────────────────────────────────────── */

export const READ_TABLES = ['social_posts', 'content_items', 'publish_jobs', 'schedule_entries', 'workflow_activity', 'team_users', 'clients']

/** Old fields the --drop-legacy pass removes (SPEC §6). Nothing new reads them. */
export const LEGACY_POST_FIELDS = ['status', 'sent_at', 'approval_mode', 'approved_at', 'approved_by', 'publish_job_ids']
export const LEGACY_ITEM_FIELDS = ['posting_approval_state', 'posting_client_required', 'client_sent']

const ROOT = '/mdm/tables'
const DRIVE_URL = /(^|\/\/)(drive|docs)\.google\.com\//i
const ACTIVE_JOB = new Set(['queued', 'publishing', 'scheduled', 'pending'])

/* ── small helpers ──────────────────────────────────────────────────────── */

const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v)
const list = v => (Array.isArray(v) ? v : isObj(v) ? Object.values(v) : [])
const strs = v => list(v).filter(x => typeof x === 'string' && x.length > 0)
const ms = v => { const t = Date.parse(String(v ?? '')); return Number.isFinite(t) ? t : NaN }
const clone = v => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)))
const short = id => String(id ?? '').slice(0, 8)
const joinNames = names => (names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`)

/** JSON with sorted keys, so two rows compare equal whatever order their keys came in. */
export function stableJson(v) {
  if (Array.isArray(v)) return `[${v.map(stableJson).join(',')}]`
  if (isObj(v)) return `{${Object.keys(v).filter(k => v[k] !== undefined).sort().map(k => `${JSON.stringify(k)}:${stableJson(v[k])}`).join(',')}}`
  return JSON.stringify(v ?? null)
}
export const sameRow = (a, b) => stableJson(a) === stableJson(b)

/** A table's node as a list of rows, each carrying its key as `id`. */
export function rowsOf(node) {
  if (!isObj(node)) return []
  return Object.entries(node).filter(([, v]) => isObj(v)).map(([k, v]) => ({ ...v, id: v.id ?? k }))
}

/** The role a person approves as, from team_users. Null for a role that cannot approve a post. */
export function approvalHatOf(user) {
  if (!user) return null
  if (user.role === 'super_admin') return 'super_admin'
  if (user.role === 'account_manager') return 'account_manager'
  if (user.role === 'quality_checker' || user.quality_reviewer === true) return 'quality_reviewer'
  if (user.role === 'client') return 'client'
  return null
}

/* ── the plan ───────────────────────────────────────────────────────────── */

/**
 * The whole migration as data: what each post becomes, and every row written.
 * Pure: `snap` is the tables as read, `cores` the app's rule files, `now` the
 * run's time. Nothing here touches the network.
 *
 * `snap`: { social_posts, content_items, publish_jobs, schedule_entries,
 *           workflow_activity, team_users, clients } — each a list of rows.
 */
export function planMigration(snap, cores, { now }) {
  const { stage: S, outcome: O, publish: P } = cores
  const nowIso = new Date(ms(now)).toISOString()
  const items = new Map(snap.content_items.map(r => [r.id, r]))
  const jobs = snap.publish_jobs
  const jobsById = new Map(jobs.map(j => [j.id, j]))
  const people = new Map()
  for (const u of snap.team_users) for (const k of [u.id, u.email, u.clerk_user_id]) if (k) people.set(k, u)
  const clients = new Map((snap.clients ?? []).map(c => [c.id, c]))
  const activity = new Map()
  for (const a of snap.workflow_activity) {
    if (a.entity_type && a.entity_type !== 'content_item') continue
    if (!activity.has(a.entity_id)) activity.set(a.entity_id, [])
    activity.get(a.entity_id).push(a)
  }
  for (const acts of activity.values()) acts.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))

  const networkWord = p => P.networkName(p)
  const latestAct = (itemId, action, cutoff) =>
    (activity.get(itemId) ?? []).filter(a => a.action === action && (!cutoff || String(a.created_at) <= cutoff)).pop() ?? null

  const plans = []
  const versionWrites = []
  const eventWrites = []
  const postWrites = []
  const postOutcomes = new Map()   // post id → { outcomes, jobs } for the schedule rows
  const heldJobs = new Set()

  for (const post of [...snap.social_posts].sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))) {
    const item = items.get(post.item_id) ?? null
    const orphan = !item
    const notes = []
    const ownIds = strs(post.publish_job_ids)
    const missing = ownIds.filter(id => !jobsById.has(id))
    const booking = ownIds.length > 0 ? O.bookingJobs(ownIds, jobs) : []
    const addedChildren = booking.map(j => j.id).filter(id => !ownIds.includes(id))
    for (const j of booking) heldJobs.add(j.id)
    if (missing.length) notes.push(`Job${missing.length === 1 ? '' : 's'} ${missing.map(short).join(', ')} named on the post ${missing.length === 1 ? 'is' : 'are'} not in publish_jobs.`)
    if (addedChildren.length) notes.push(`Re-send job${addedChildren.length === 1 ? '' : 's'} ${addedChildren.map(short).join(', ')} joined to the booking (found through resend_of).`)

    const { outcomes, platforms } = booking.length > 0 ? O.postNetworkOutcomes(booking) : { outcomes: {}, platforms: [] }
    const verdict = booking.length > 0 ? S.outcomeVerdict(outcomes, platforms) : null
    const allCancelled = booking.length > 0 && booking.every(j => j.status === 'cancelled')
    const anyActive = booking.some(j => ACTIVE_JOB.has(String(j.status ?? '')))
    const status = String(post.status ?? '')
    const failedWords = Object.entries(outcomes).filter(([, o]) => o.status === 'failed').map(([p]) => networkWord(p))
    const didNotGoOut = failedWords.length ? `Did not go out on ${joinNames(failedWords)}.` : null

    // which rule — first match wins (SPEC §6)
    let rule = null, stage = null, reason = null, cancelReason = null, fromStage = null
    const cancelOrphan = (r, why) => { rule = r; stage = 'cancelled'; cancelReason = 'card deleted'; reason = why; fromStage = null }
    if (status === 'cancelled') {
      rule = 'M1'; stage = 'cancelled'; reason = 'Stored as cancelled.'; cancelReason = orphan ? 'card deleted' : null
    } else if (booking.length > 0 && verdict === 'posted') {
      rule = 'M2'; stage = 'posted'; reason = `Every network it targeted went out (${platforms.map(networkWord).join(', ')}).`
    } else if (booking.length > 0 && verdict === 'partial') {
      rule = 'M3'; stage = 'posted'; reason = 'Went out on some networks and failed on others.'
    } else if (booking.length > 0 && anyActive && verdict === 'pending') {
      rule = 'M4'; stage = 'booked'; reason = 'A job is still waiting to go out.'
    } else if (booking.length > 0 && verdict === 'failed') {
      if (orphan) { cancelOrphan('M5', 'Every job failed and its card was deleted.'); fromStage = 'booked' }
      else { rule = 'M5'; stage = 'ready'; reason = 'Every job failed; it goes back to Ready to post.' }
    } else if (allCancelled) {
      rule = 'M6'; stage = 'cancelled'; reason = 'Its only booking was cancelled.'; fromStage = 'booked'
      cancelReason = orphan ? 'card deleted' : 'The booking was cancelled.'
    } else if (booking.length > 0) {
      rule = null; reason = `Its jobs do not add up to one answer (${booking.map(j => `${short(j.id)} ${j.status}`).join(', ')}).`
    } else if (status === 'scheduled' || status === 'published') {
      rule = null; reason = `Stored as ${status}, but it has no publishing job.`
    } else if (status === 'pending') {
      const toClient = item?.posting_client_required === true && item?.client_sent?.stage === 'post'
      if (orphan) cancelOrphan(toClient ? 'M7' : 'M8', 'Waiting on approval, but its card was deleted.')
      else if (toClient) { rule = 'M7'; stage = 'with_client'; reason = `Sent to the client ${String(item.client_sent.at ?? '').slice(0, 16)}.` }
      else { rule = 'M8'; stage = 'quality_check'; reason = 'Waiting on the team, never sent to the client.' }
    } else if (status === 'changes') {
      if (orphan) cancelOrphan('M9', 'A change was asked for, but its card was deleted.')
      else { rule = 'M9'; stage = 'draft'; reason = 'A change was asked for.' }
    } else if (status === 'approved') {
      if (orphan) cancelOrphan('M10', 'Approved, but its card was deleted.')
      else { rule = 'M10'; stage = 'ready'; reason = 'Approved, never booked.' }
    } else if (status === 'draft') {
      if (orphan) { cancelOrphan('M11', 'A draft whose card was deleted.'); fromStage = 'draft' }
      else { rule = 'M11'; stage = 'draft'; reason = 'A draft.' }
    } else {
      rule = null; reason = `Stored status "${status}" matches no rule.`
    }

    const old = {
      status, item: item ? { status: item.status ?? null, posting_approval_state: item.posting_approval_state ?? null, posting_client_required: item.posting_client_required ?? null, client_sent: item.client_sent ? { at: item.client_sent.at ?? null, stage: item.client_sent.stage ?? null, to_count: strs(item.client_sent.to).length } : null } : null,
      approved_by: post.approved_by ?? null, approved_at: post.approved_at ?? null, sent_at: post.sent_at ?? null, approval_mode: post.approval_mode ?? null,
      jobs: booking.map(j => ({ id: j.id, status: j.status ?? null, platforms: list(j.targets).map(t => String(t?.platform ?? '')).filter(Boolean), resend_of: j.resend_of ?? null })),
      scheduled_for: post.scheduled_for ?? null,
    }
    const base = { id: post.id, client: clients.get(post.client_id)?.name ?? short(post.client_id), item_id: post.item_id ?? null, item_title: item?.title ?? null, orphan, old, rule, reason, notes }

    if (!stage) { plans.push({ ...base, stage: null, unmapped: true }); continue }

    // ── what the post records ──
    const approvalFrom = (cutoff) => {
      let by = post.approved_by ?? null, at = post.approved_at ?? null
      if (!by && item) {
        const a = latestAct(item.id, 'posting_approved', cutoff)
        if (a) { by = a.actor_id ?? null; at = a.created_at ?? null }
      }
      if (!by) return { approval: null, why: 'No approval on record.' }
      const person = people.get(by) ?? null
      const hat = approvalHatOf(person)
      if (!hat) return { approval: null, why: `Approved by ${short(by)}, whose role (${person?.role ?? 'unknown'}) cannot approve a post, so no approval is carried over.` }
      return { approval: { version: 1, by: person?.id ?? by, hat, on_behalf_of_client: false, agreed_via: null, note: 'Carried over by the migration.', at: at ?? post.updated_at ?? nowIso }, why: null }
    }
    const firstJobAt = booking.map(j => String(j.created_at ?? '')).filter(Boolean).sort()[0] ?? null
    const lastOutAt = Object.values(outcomes).map(o => String(o.at ?? '')).filter(Boolean).sort().pop() ?? null

    const frozen = ['quality_check', 'with_client', 'ready', 'booked', 'posted'].includes(stage) || rule === 'M9'
    const patch = {
      stage, rev: Number.isFinite(Number(post.rev)) ? Number(post.rev) + 1 : 1,
      draft_version: frozen ? 2 : 1, sent_version: frozen ? 1 : null,
      approval: null, qc_pass: null, changes_asked: null, client_send: null, last_client_send: null,
      booking: null, outcomes: {}, problem: null, cancelled: null,
      source_item_id: post.item_id ?? null, source_deleted: orphan,
    }
    let stageAt = post.updated_at ?? nowIso

    if (stage === 'posted' || stage === 'booked' || (rule === 'M5' && stage === 'ready')) {
      const { approval, why } = approvalFrom(firstJobAt)
      patch.approval = approval
      if (why && stage === 'ready') notes.push(`${why} It cannot be booked until someone approves it — Edit is still open to it.`)
      else if (why) notes.push(why)
    }
    if (stage === 'posted' || stage === 'booked') {
      patch.booking = { job_ids: booking.map(j => j.id), pending: false, at: firstJobAt ?? nowIso, for_time: post.scheduled_for ?? null }
      patch.outcomes = clone(outcomes)
      if (rule === 'M3') patch.problem = didNotGoOut
      stageAt = stage === 'posted' ? (lastOutAt ?? post.updated_at ?? nowIso) : (firstJobAt ?? stageAt)
      const noLink = Object.entries(outcomes).filter(([, o]) => (o.status === 'published' || o.status === 'duplicate') && !o.url).map(([p]) => networkWord(p))
      if (stage === 'posted' && noLink.length) notes.push(`No live link kept for ${joinNames(noLink)}: none on record belongs to that network.`)
    }
    if (rule === 'M5' && stage === 'ready') { patch.problem = didNotGoOut ?? 'The booking did not go out.'; stageAt = booking.map(j => String(j.updated_at ?? '')).sort().pop() || stageAt }
    if (rule === 'M10') {
      const { approval, why } = approvalFrom(null)
      patch.approval = approval
      if (why) notes.push(`${why} It cannot be booked until someone approves it — Edit is still open to it.`)
      stageAt = approval?.at ?? stageAt
    }
    if (rule === 'M7') {
      const cs = item.client_sent
      const sentAt = cs.at ?? post.sent_at ?? nowIso
      const send = {
        version: 1, at: sentAt, to: strs(cs.to), via: 'email',
        approve_by: cs.approve_by ?? S.defaultApproveBy(post.scheduled_for, sentAt),
        for_time: cs.for_time ?? post.scheduled_for ?? null,
      }
      patch.client_send = send
      patch.last_client_send = clone(send)
      stageAt = sentAt
      notes.push('Frozen at migration, not at send — resend it so the client is sure to see this version.')
    }
    if (rule === 'M8') { stageAt = post.sent_at ?? stageAt; notes.push('Frozen at migration, not at send.') }
    if (rule === 'M9') {
      const a = item ? latestAct(item.id, 'posting_changes_requested', null) : null
      const asker = a ? people.get(a.actor_id) ?? null : null
      patch.changes_asked = {
        version: 1, by: a?.actor_id ?? null, who: asker?.role === 'client' ? 'client' : 'team',
        to: post.created_by ?? null, note: String(a?.detail ?? ''), at: a?.created_at ?? post.updated_at ?? nowIso,
      }
      if (!a) notes.push('No "change asked" record found, so who asked is recorded as the team.')
      stageAt = patch.changes_asked.at
      // the client had it before the change was asked: the portal then thanks them for their note
      const cs = item?.client_sent
      if (cs && cs.stage === 'post' && cs.at) {
        patch.last_client_send = { version: 1, at: cs.at, to: strs(cs.to), via: 'email', approve_by: cs.approve_by ?? null, for_time: cs.for_time ?? post.scheduled_for ?? null }
      }
    }
    if (stage === 'cancelled') {
      patch.cancelled = { by: null, at: post.updated_at ?? nowIso, from_stage: fromStage, reason: cancelReason }
      patch.draft_version = 1; patch.sent_version = null
    }

    // the working copy: a draft's time that has already gone is cleared
    const working = {}
    if (stage === 'draft' && post.scheduled_for && ms(post.scheduled_for) <= ms(nowIso)) {
      working.scheduled_for = null
      notes.push(`Its time (${post.scheduled_for}) has passed, so the time is cleared.`)
    }
    if (['draft', 'quality_check', 'with_client', 'ready'].includes(stage)) {
      const req = item?.posting_client_required
      if (req === true || req === false) patch.approval_steps = req ? 'team_then_client' : 'team'
      if (strs(post.channels).length === 0) notes.push('It has no channels chosen yet.')
    }
    patch.stage_at = stageAt

    const after = { ...post, ...patch, ...working }
    postWrites.push({ table: 'social_posts', id: post.id, before: post, after })
    postOutcomes.set(post.id, { item_id: post.item_id, outcomes: patch.outcomes, booking })

    let version = null
    if (frozen) {
      const slides = clone(list(post.slides))
      const drive = slides.filter(s => DRIVE_URL.test(String(s?.url ?? '')))
      if (drive.length) notes.push(`${drive.length} file${drive.length === 1 ? ' is a' : 's are'} Google Drive link${drive.length === 1 ? '' : 's'}, not a stored copy.`)
      version = {
        id: S.postVersionId(post.id, 1), post_id: post.id, client_id: post.client_id, n: 1,
        slides, per_channel: clone(isObj(post.per_channel) ? post.per_channel : {}), channels: strs(post.channels),
        caption: typeof post.caption === 'string' ? post.caption : null, scheduled_for: post.scheduled_for ?? null,
        timezone: post.timezone ?? 'Australia/Melbourne', frozen_for: 'migration', frozen_by: null, frozen_at: nowIso, from_migration: true,
      }
      versionWrites.push({ table: 'post_versions', id: version.id, row: version, post_id: post.id })
    }
    eventWrites.push({
      table: 'post_events', id: S.postEventId(post.id, patch.rev), post_id: post.id,
      row: { id: S.postEventId(post.id, patch.rev), post_id: post.id, client_id: post.client_id, rev: patch.rev, from: null, to: stage, action: 'migrate', actor_id: null, hat: 'system', on_behalf_of_client: false, version: patch.sent_version, note: `${rule}: ${reason}`, at: nowIso },
    })

    plans.push({
      ...base, stage, unmapped: false,
      next: {
        stage, stage_at: stageAt, sent_version: patch.sent_version, draft_version: patch.draft_version, approval_steps: patch.approval_steps ?? null,
        approval: patch.approval ? { by: short(patch.approval.by), hat: patch.approval.hat } : null,
        changes_asked: patch.changes_asked ? { who: patch.changes_asked.who, by: short(patch.changes_asked.by) } : null,
        client_send: patch.client_send ? { at: patch.client_send.at, approve_by: patch.client_send.approve_by, to_count: patch.client_send.to.length } : null,
        last_client_send: patch.last_client_send ? { at: patch.last_client_send.at } : null,
        booking_jobs: patch.booking ? patch.booking.job_ids : [],
        outcomes: Object.fromEntries(Object.entries(patch.outcomes).map(([p, o]) => [p, o.status])),
        problem: patch.problem, cancelled_reason: patch.cancelled?.reason ?? null, source_deleted: orphan,
        time_cleared: 'scheduled_for' in working, frozen_v1: !!version,
      },
      invalid_after: S.readPostState(after) ? null : 'The new row does not read as a post.',
    })
  }

  // ── schedule_entries: one row per network, that network's own word and link (L1, L2, L8) ──
  const scheduleWrites = []
  const scheduleNotes = []
  const byItem = new Map()
  for (const r of snap.schedule_entries) { if (!byItem.has(r.item_id)) byItem.set(r.item_id, []); byItem.get(r.item_id).push(r) }
  for (const [itemId, rows] of byItem) {
    if (!items.has(itemId)) continue
    const mine = [...postOutcomes.values()].filter(p => p.item_id === itemId)
    if (mine.length === 0 || mine.every(p => p.booking.length === 0)) continue
    const went = new Map()   // platform → { url, job }
    for (const p of mine) {
      for (const [platform, o] of Object.entries(p.outcomes)) {
        if (o.status !== 'published' && o.status !== 'duplicate') continue
        const job = [...p.booking].reverse().find(j => j.status !== 'cancelled'
          && O.outcomesForJob(j).some(x => x.platform === platform && x.status === 'published')) ?? null
        const had = went.get(platform)
        if (!had || (!had.url && o.url)) went.set(platform, { url: o.url ?? had?.url ?? null, job: job ?? had?.job ?? null })
      }
    }
    const itemJobs = jobs.filter(j => j.content_item_id === itemId)
    const cancelledTimes = new Set(itemJobs.filter(j => j.status === 'cancelled').map(j => j.scheduled_for).filter(Boolean))
    const liveTimes = new Set(itemJobs.filter(j => j.status !== 'cancelled').map(j => j.scheduled_for).filter(Boolean))
    for (const row of rows) {
      const platform = String(row.platform ?? '').toLowerCase()
      const w = went.get(platform)
      const patch = {}
      if (w) {
        if (row.publish_status !== 'published') patch.publish_status = 'published'
        const keep = row.live_url && O.urlBelongsTo(platform, row.live_url, true)
        const url = keep ? row.live_url : (w.url ?? null)
        if ((row.live_url ?? null) !== url) patch.live_url = url
        const jobTime = w.job?.scheduled_for ?? null
        const stale = !row.scheduled_at || (cancelledTimes.has(row.scheduled_at) && !liveTimes.has(row.scheduled_at))
        if (stale && jobTime && row.scheduled_at !== jobTime) patch.scheduled_at = jobTime
      } else if (row.publish_status === 'published') {
        patch.publish_status = null
        patch.live_url = null
        scheduleNotes.push({ item_id: itemId, platform, text: `${networkWord(platform)} never went out for this card — it is still owed.` })
      }
      if (Object.keys(patch).length === 0) continue
      const after = { ...row, ...patch }
      for (const [k, v] of Object.entries(patch)) if (v === null) delete after[k]
      scheduleWrites.push({ table: 'schedule_entries', id: row.id, before: row, after, patch, item_id: itemId })
    }
  }
  // ROWS WHOSE CARD WAS DELETED (audit L6, review fix 29 Sep 2026): no longer left as they were. Each
  // says what its card's own jobs say for its network — published (with that network's link) where it
  // went out, cancelled where it was still "scheduled" and never went. Anything reading the table directly
  // then stops counting a phantom booking.
  const orphanScheduleRows = snap.schedule_entries.filter(r => !items.has(r.item_id)).map(r => r.id)
  const orphanByItem = new Map()
  for (const r of snap.schedule_entries) {
    if (items.has(r.item_id)) continue
    if (!orphanByItem.has(r.item_id)) orphanByItem.set(r.item_id, [])
    orphanByItem.get(r.item_id).push(r)
  }
  for (const [itemId, rows] of orphanByItem) {
    const went = new Map()   // platform → url
    for (const j of jobs.filter(x => x.content_item_id === itemId)) {
      for (const o of O.outcomesForJob(j)) {
        if (o.status !== 'published') continue
        if (!went.has(o.platform) || (!went.get(o.platform) && o.url)) went.set(o.platform, o.url ?? null)
      }
    }
    for (const row of rows) {
      const platform = String(row.platform ?? '').toLowerCase()
      const patch = {}
      if (went.has(platform)) {
        if (row.publish_status !== 'published') patch.publish_status = 'published'
        const keep = row.live_url && O.urlBelongsTo(platform, row.live_url, true)
        const url = keep ? row.live_url : (went.get(platform) ?? null)
        if ((row.live_url ?? null) !== url) patch.live_url = url
      } else if (row.publish_status === 'scheduled' || row.publish_status === 'queued') {
        patch.publish_status = 'cancelled'
      }
      if (Object.keys(patch).length === 0) continue
      const after = { ...row, ...patch }
      for (const [k, v] of Object.entries(patch)) if (v === null) delete after[k]
      scheduleWrites.push({ table: 'schedule_entries', id: row.id, before: row, after, patch, item_id: itemId, orphan: true })
    }
  }

  // ── the edit side (L4): cards the client got before the round stamp existed ──
  const itemWrites = []
  for (const it of snap.content_items) {
    const rounds = Array.isArray(it.client_rounds) ? it.client_rounds.filter(n => typeof n === 'number') : []
    if (rounds.length > 0) continue
    const round = typeof it.client_round === 'number' && it.client_round >= 1 ? it.client_round : null
    if (round) {
      itemWrites.push({ table: 'content_items', id: it.id, before: it, after: { ...it, client_rounds: [round] }, why: `client_round ${round} with no client_rounds — normalised to [${round}].` })
      continue
    }
    if (it.status !== 'client_review' || it.client_sent) continue
    const sent = (activity.get(it.id) ?? []).find(a => a.action === 'status_change' && a.new_value === 'client_review')
    if (!sent) continue
    itemWrites.push({ table: 'content_items', id: it.id, before: it, after: { ...it, client_round: 1, client_rounds: [1] }, why: `At With client since ${String(sent.created_at).slice(0, 16)} with no round stamp — given round 1.` })
  }

  const unownedJobs = jobs.filter(j => !heldJobs.has(j.id)).map(j => ({
    id: j.id, status: j.status ?? null, item_id: j.content_item_id ?? null, item_exists: items.has(j.content_item_id), resend_of: j.resend_of ?? null,
    platforms: list(j.targets).map(t => String(t?.platform ?? '')).filter(Boolean),
  }))

  return { now: nowIso, plans, postWrites, versionWrites, eventWrites, scheduleWrites, scheduleNotes, orphanScheduleRows, itemWrites, unownedJobs }
}

/**
 * The --drop-legacy pass: the old fields off every post and card. Refused as a
 * whole while any post has no valid stage — that post would lose the only
 * fields that say where it is.
 */
export function planDropLegacy(snap, cores) {
  const noStage = snap.social_posts.filter(p => !cores.stage.isPostStage(p.stage)).map(p => p.id)
  if (noStage.length > 0) return { refused: `${noStage.length} post${noStage.length === 1 ? ' has' : 's have'} no stage yet — run --write first.`, noStage, writes: [] }
  const strip = (row, fields) => { const out = { ...row }; for (const f of fields) delete out[f]; return out }
  const writes = []
  for (const p of snap.social_posts) if (LEGACY_POST_FIELDS.some(f => f in p)) writes.push({ table: 'social_posts', id: p.id, before: p, after: strip(p, LEGACY_POST_FIELDS) })
  for (const it of snap.content_items) if (LEGACY_ITEM_FIELDS.some(f => f in it)) writes.push({ table: 'content_items', id: it.id, before: it, after: strip(it, LEGACY_ITEM_FIELDS) })
  return { refused: null, noStage: [], writes }
}

/* ── writing (only with --write) ────────────────────────────────────────── */

export const NULL_ETAG = 'null_etag'

/** The REST calls the writer needs, over plain fetch. Refuses any path outside /mdm/tables. */
export function makeRest(baseUrl, fetchImpl = fetch) {
  const base = String(baseUrl ?? '').replace(/\/+$/, '')
  if (!base) throw new Error('NEXT_PUBLIC_FIREBASE_DATABASE_URL is missing')
  const url = p => {
    if (!p.startsWith(`${ROOT}/`)) throw new Error(`Refusing to touch ${p}: only ${ROOT} is ours`)
    return `${base}${p.split('/').map(s => (s ? encodeURIComponent(s) : s)).join('/')}.json`
  }
  return {
    async get(p) {
      const res = await fetchImpl(url(p), { headers: { 'X-Firebase-ETag': 'true' } })
      if (!res.ok) throw new Error(`GET ${p}: ${res.status}`)
      return { etag: res.headers.get('etag'), value: await res.json() }
    },
    async put(p, value, etag) {
      const res = await fetchImpl(url(p), { method: 'PUT', headers: { 'content-type': 'application/json', 'if-match': etag }, body: JSON.stringify(value) })
      if (res.status === 412) return { ok: false, conflict: true }
      if (!res.ok) throw new Error(`PUT ${p}: ${res.status} ${await res.text().catch(() => '')}`)
      return { ok: true }
    },
  }
}

const pathOf = (table, id) => `${ROOT}/${table}/${id}`

/** Change one row, only if it is still exactly `before`. */
export async function updateRow(rest, w) {
  const cur = await rest.get(pathOf(w.table, w.id))
  if (sameRow(cur.value, w.after)) return 'already'
  if (!sameRow(cur.value, w.before)) return 'changed'
  const r = await rest.put(pathOf(w.table, w.id), w.after, cur.etag)
  return r.ok ? 'written' : 'changed'
}

/** Create one row, only if nothing is there. */
export async function createRow(rest, w) {
  const r = await rest.put(pathOf(w.table, w.id), w.row, NULL_ETAG)
  if (r.ok) return 'written'
  const cur = await rest.get(pathOf(w.table, w.id))
  return sameRow(cur.value, w.row) ? 'already' : 'changed'
}

/**
 * Apply a plan. A post's frozen version goes first; the post only changes when
 * its version is in place; its event follows. Every result is returned, one
 * line per row, so the run can be read back.
 */
export async function applyPlan(plan, rest) {
  const results = []
  const done = (w, outcome) => { results.push({ table: w.table, id: w.id, outcome }); return outcome }
  const versionOf = new Map(plan.versionWrites.map(v => [v.post_id, v]))
  const eventOf = new Map(plan.eventWrites.map(e => [e.post_id, e]))
  for (const w of plan.postWrites) {
    const v = versionOf.get(w.id)
    if (v) {
      const got = done(v, await createRow(rest, v))
      if (got === 'changed') { done(w, 'skipped: a different version 1 is already there'); continue }
    }
    const got = done(w, await updateRow(rest, w))
    if (got === 'written' || got === 'already') {
      const e = eventOf.get(w.id)
      if (e) done(e, await createRow(rest, e))
    }
  }
  for (const w of plan.scheduleWrites) done(w, await updateRow(rest, w))
  for (const w of plan.itemWrites) done(w, await updateRow(rest, w))
  return results
}

/* ── the report ─────────────────────────────────────────────────────────── */

const cell = v => String(v ?? '—').replace(/\|/g, '/').replace(/\n/g, ' ')

export function renderReport(plan, meta = {}) {
  const L = []
  const count = (f) => plan.plans.filter(f).length
  const stages = {}
  for (const p of plan.plans) { const k = p.stage ?? 'NOT MAPPED'; stages[k] = (stages[k] ?? 0) + 1 }
  L.push('# Post stage migration — dry run')
  L.push('')
  L.push(`Run ${meta.mode ?? 'dry run'} at ${plan.now}. ${meta.source ?? ''}`.trim())
  L.push('')
  L.push('Nothing was written to the database. This is what `--write` would do, row by row. It was made by `scripts/migrate-post-stage.mjs` from a read of the live tables.')
  L.push('')
  L.push('## Summary')
  L.push('')
  L.push(`- Posts read: ${plan.plans.length}. Mapped: ${count(p => !p.unmapped)}. Not mapped: ${count(p => p.unmapped)}.`)
  L.push(`- New stages: ${Object.entries(stages).map(([k, v]) => `${k} ${v}`).join(', ')}.`)
  L.push(`- Posts whose card was deleted (source_deleted): ${count(p => p.orphan)}.`)
  L.push(`- Rows --write would write: ${plan.postWrites.length} posts, ${plan.versionWrites.length} frozen versions (v1, from migration), ${plan.eventWrites.length} events, ${plan.scheduleWrites.length} schedule rows, ${plan.itemWrites.length} edit cards.`)
  L.push(`- Rules used: ${Object.entries(plan.plans.reduce((m, p) => { const k = p.rule ?? 'none'; m[k] = (m[k] ?? 0) + 1; return m }, {})).sort().map(([k, v]) => `${k} ${v}`).join(', ')}.`)
  L.push('')

  L.push('## Choices the migration makes that SPEC §6 does not spell out')
  L.push('')
  L.push('- A frozen version 1 (marked "from migration") is written for every post it puts in Quality check, With client, Ready to post, Booked in or Posted, and for a post that was sent and then had a change asked (M9). The new rules check the version a person saw against `sent_version`, and booking needs `approval.version` to equal it, so these posts need a version 1 to act on.')
  L.push('- Who approved: the post\'s own `approved_by` first, else the card\'s last "posting approved" record before the first job. Their role is read from team_users. A role that cannot approve a post (a scheduler) is not carried over, and the post says so.')
  L.push('- Approval steps: a card marked client-required becomes "team then client" on its post; one marked not required becomes "team only". Otherwise the client\'s own default applies.')
  L.push('- A draft whose time has already passed has its time cleared (the spec names e2d47057; the same rule is used for every draft). Its frozen version keeps the old time.')
  L.push('- A post the client asked to change (M9) keeps the card\'s send as `last_client_send`, so the client\'s page says "Thanks — we have your note".')
  L.push('- The old fields (`status`, `approved_by`, `client_sent`…) are left in place by `--write`. Only `--drop-legacy` removes them.')
  L.push('')

  const unmapped = plan.plans.filter(p => p.unmapped || p.invalid_after)
  L.push('## Rows it cannot map')
  L.push('')
  if (unmapped.length === 0) L.push('None. Every post gets a stage.')
  else for (const p of unmapped) L.push(`- ${p.id} (${p.client}): ${p.invalid_after ?? p.reason}`)
  L.push('')

  const flagged = plan.plans.filter(p => p.notes.length > 0)
  L.push('## Posts that need a person to look')
  L.push('')
  if (flagged.length === 0) L.push('None.')
  for (const p of flagged) L.push(`- **${short(p.id)}** (${p.client}${p.item_title ? `, "${p.item_title}"` : ''}) → ${p.stage ?? 'not mapped'}: ${p.notes.join(' ')}`)
  L.push('')

  L.push('## Every post')
  L.push('')
  L.push('Old = what the row and its card say today. New = what `--write` gives it. "v1" means a frozen version 1 is written, marked as made by the migration.')
  L.push('')
  L.push('| Post | Client / card | Old status | Old card fields | Jobs | Rule | New stage | New fields |')
  L.push('|---|---|---|---|---|---|---|---|')
  for (const p of plan.plans) {
    const o = p.old
    const card = p.orphan ? 'card deleted' : [
      `status ${o.item?.status ?? '—'}`,
      o.item?.posting_approval_state ? `approval_state ${o.item.posting_approval_state}` : null,
      o.item?.posting_client_required != null ? `client_required ${o.item.posting_client_required}` : null,
      o.item?.client_sent ? `client_sent ${o.item.client_sent.stage ?? '?'} ${String(o.item.client_sent.at ?? '').slice(0, 16)}` : null,
    ].filter(Boolean).join('; ')
    const legacy = [o.status, o.approval_mode ? `mode ${o.approval_mode}` : null, o.approved_by ? `approved_by ${short(o.approved_by)}` : null].filter(Boolean).join('; ')
    const jobsCell = o.jobs.length ? o.jobs.map(j => `${short(j.id)} ${j.status} [${j.platforms.join(',')}]${j.resend_of ? ` re-send of ${short(j.resend_of)}` : ''}`).join('<br>') : '—'
    const n = p.next
    const fields = n ? [
      n.frozen_v1 ? 'v1' : null,
      n.sent_version != null ? `sent_version ${n.sent_version}` : null,
      n.approval_steps ? `steps ${n.approval_steps}` : null,
      n.approval ? `approval ${n.approval.hat} ${n.approval.by}` : null,
      n.changes_asked ? `change asked by ${n.changes_asked.who} ${n.changes_asked.by}` : null,
      n.client_send ? `client_send ${String(n.client_send.at).slice(0, 16)}, approve by ${String(n.client_send.approve_by ?? '—').slice(0, 16)}, to ${n.client_send.to_count}` : null,
      n.last_client_send && !n.client_send ? `last_client_send ${String(n.last_client_send.at).slice(0, 16)}` : null,
      n.booking_jobs.length ? `booking ${n.booking_jobs.map(short).join(',')}` : null,
      Object.keys(n.outcomes).length ? `outcomes ${Object.entries(n.outcomes).map(([k, v]) => `${k} ${v}`).join(', ')}` : null,
      n.problem ? `problem "${n.problem}"` : null,
      n.stage === 'cancelled' ? `cancelled: ${n.cancelled_reason ?? 'no reason stored'}` : null,
      n.source_deleted ? 'source_deleted' : null,
      n.time_cleared ? 'time cleared' : null,
    ].filter(Boolean).join('; ') : p.reason
    L.push(`| ${short(p.id)} | ${cell(p.client)} / ${p.orphan ? short(p.item_id) : `${short(p.item_id)} ${cell(p.item_title)}`} | ${cell(legacy)} | ${cell(card)} | ${jobsCell} | ${p.rule ?? '—'} | **${p.stage ?? 'NOT MAPPED'}** | ${cell(fields)} |`)
  }
  L.push('')

  L.push('## Schedule rows (one per network)')
  L.push('')
  if (plan.scheduleWrites.length === 0) L.push('No schedule row changes.')
  else {
    L.push('| Row | Card | Network | Before | After |')
    L.push('|---|---|---|---|---|')
    const show = r => [r.publish_status ?? 'no status', r.live_url ? (() => { try { return new URL(r.live_url).hostname } catch { return 'link' } })() : 'no link', r.scheduled_at ? String(r.scheduled_at).slice(0, 16) : 'no time'].join(', ')
    for (const w of plan.scheduleWrites) L.push(`| ${short(w.id)} | ${short(w.item_id)} | ${w.before.platform} | ${show(w.before)} | ${show(w.after)} |`)
  }
  for (const n of plan.scheduleNotes) L.push(`- Card ${short(n.item_id)}: ${n.text}`)
  const orphanFixed = plan.scheduleWrites.filter(w => w.orphan)
  L.push(`- Rows whose card was deleted: ${plan.orphanScheduleRows.length} (${plan.orphanScheduleRows.map(short).join(', ') || 'none'}). Each is set to what its card's jobs say: published where it went out, cancelled where it was still "scheduled" and never went. ${orphanFixed.length} of them change (in the table above); the rest already say the right thing.`)
  L.push('')

  L.push('## Edit cards (the client-round stamp)')
  L.push('')
  if (plan.itemWrites.length === 0) L.push('None.')
  for (const w of plan.itemWrites) L.push(`- ${short(w.id)} "${cell(w.before.title)}": ${w.why}`)
  L.push('')

  L.push('## Publishing jobs no post holds')
  L.push('')
  if (plan.unownedJobs.length === 0) L.push('None.')
  else {
    L.push('Re-sends found through `resend_of` are joined to their post above. These are the rest; the migration leaves them as they are.')
    L.push('')
    for (const j of plan.unownedJobs) L.push(`- ${short(j.id)} ${j.status} [${j.platforms.join(',')}]: ${j.item_id ? `card ${short(j.item_id)}${j.item_exists ? '' : ' (deleted)'}` : 'no card'}${j.resend_of ? `, re-send of ${short(j.resend_of)}` : ''}.`)
  }
  L.push('')
  return L.join('\n')
}

/* ── the command line ───────────────────────────────────────────────────── */

export function parseArgs(argv) {
  const out = { write: false, dropLegacy: false, report: null, backupDir: null }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--write') out.write = true
    else if (a === '--dry-run') out.write = false
    else if (a === '--drop-legacy') out.dropLegacy = true
    else if (a === '--report') out.report = argv[++i]
    else if (a === '--backup-dir') out.backupDir = argv[++i]
    else throw new Error(`Unknown flag ${a}`)
  }
  if (argv.includes('--dry-run') && argv.includes('--write')) throw new Error('Choose --dry-run or --write, not both')
  return out
}

function readEnv(root) {
  const env = { ...process.env }
  const file = path.join(root, '.env.local')
  if (!env.NEXT_PUBLIC_FIREBASE_DATABASE_URL && fs.existsSync(file)) {
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const i = line.indexOf('=')
      if (i > 0 && !line.startsWith('#')) env[line.slice(0, i).trim()] ??= line.slice(i + 1).trim().replace(/^"|"$/g, '')
    }
  }
  return env
}

export function loadCores(root) {
  const require = createRequire(import.meta.url)
  const jiti = require('jiti')(fileURLToPath(import.meta.url), {
    interopDefault: true,
    alias: { '@': root, 'server-only': path.join(root, 'tests/stubs/server-only.ts') },
  })
  return {
    stage: jiti(path.join(root, 'app/lib/post-stage-core.ts')),
    outcome: jiti(path.join(root, 'app/lib/post-outcome-core.ts')),
    publish: jiti(path.join(root, 'app/lib/publish-core.ts')),
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  const env = readEnv(root)
  const rest = makeRest(env.NEXT_PUBLIC_FIREBASE_DATABASE_URL)
  const cores = loadCores(root)

  const raw = {}
  for (const t of READ_TABLES) raw[t] = (await rest.get(`${ROOT}/${t}`)).value ?? {}
  const snap = Object.fromEntries(READ_TABLES.map(t => [t, rowsOf(raw[t])]))

  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const dir = args.backupDir ?? path.join(os.tmpdir(), 'mdm-migrate-post-stage')
  fs.mkdirSync(dir, { recursive: true })
  const backup = path.join(dir, `backup-${stamp}.json`)
  fs.writeFileSync(backup, JSON.stringify(raw))
  console.log(`Backup of ${READ_TABLES.join(', ')} saved to ${backup}`)

  if (args.dropLegacy) {
    const drop = planDropLegacy(snap, cores)
    if (drop.refused) { console.error(drop.refused); process.exitCode = 1; return }
    console.log(`--drop-legacy: ${drop.writes.length} rows lose their old fields (${LEGACY_POST_FIELDS.join(', ')} on posts; ${LEGACY_ITEM_FIELDS.join(', ')} on cards).`)
    if (!args.write) { console.log('Dry run: nothing written. Add --write to apply.'); return }
    const results = []
    for (const w of drop.writes) results.push({ table: w.table, id: w.id, outcome: await updateRow(rest, w) })
    fs.writeFileSync(path.join(dir, `drop-legacy-${stamp}.json`), JSON.stringify(results, null, 1))
    summarise(results)
    return
  }

  const plan = planMigration(snap, cores, { now: new Date().toISOString() })
  const report = renderReport(plan, { mode: args.write ? 'WRITE' : 'dry run', source: `Read from the live database (NEXT_PUBLIC_FIREBASE_DATABASE_URL), ${ROOT}.` })
  if (args.report) { fs.writeFileSync(args.report, report); console.log(`Report written to ${args.report}`) }
  else console.log(report)
  if (!args.write) { console.log('\nDry run: nothing written. Add --write to apply.'); return }

  const results = await applyPlan(plan, rest)
  fs.writeFileSync(path.join(dir, `write-${stamp}.json`), JSON.stringify(results, null, 1))
  summarise(results)
  // read back what was written: every post must now read as a post
  const after = rowsOf((await rest.get(`${ROOT}/social_posts`)).value ?? {})
  const bad = after.filter(r => !cores.stage.readPostState(r)).map(r => r.id)
  console.log(bad.length ? `Posts still without a stage: ${bad.join(', ')}` : `Checked: all ${after.length} posts now read as posts.`)
}

function summarise(results) {
  const by = {}
  for (const r of results) by[r.outcome] = (by[r.outcome] ?? 0) + 1
  console.log('Results:', by)
  for (const r of results.filter(r => r.outcome !== 'written' && r.outcome !== 'already')) console.log(`  ${r.table}/${r.id}: ${r.outcome}`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(e => { console.error(e instanceof Error ? e.message : e); process.exitCode = 1 })
}
