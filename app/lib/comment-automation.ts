import 'server-only'
import { randomUUID } from 'node:crypto'
import { table } from '@/lib/db'
import type { Client, CommentAutomation, PublishJob, SocialAccount, SocialPost } from '@/lib/db-types'
import type { TeamUser } from './authz'
import { getPublisher } from './publisher'
import { accessibleClientIds } from './production-access'
import { postVersionId, readPostState } from './post-stage-core'
import { releaseClaimLock, takeClaimLock } from './claim-lock'
import {
  CANCELLED_REASON, armDecision, postAutomationProblem, postAutomationRowId, postTitleOf, readPostAutomation,
  appPostChoice, chooseBinding, createdAutomationId, defaultName, finalLink, isAccountWide, isAutomationPlatform,
  isZernioPostId, mergeChoices, parseAutomationInput, platformIdByPermalink, platformPostIdOn, readAccountPosts,
  readZernioAutomation, readZernioAutomations, shapeLogs, updatePatch, waitingOnOldBooking, zernioPayload,
  type AccountPost, type Binding, type PostAutomation, type AutomationLogRow, type AutomationStats, type PostChoice, type ZernioAutomation,
} from './comment-automation-core'

/**
 * COMMENT-TO-DM AUTOMATIONS, ONE POST EACH — the I/O half. The rules are
 * comment-automation-core.ts; this file reads our tables, asks Zernio, and
 * records what was switched on in `comment_automations` (a ghost table,
 * scripts/gen-db-types.mjs).
 *
 * Zernio calls, all through app/lib/publisher.ts (its key and base URL):
 *   POST   /v1/comment-automations            createAutomation
 *   GET    /v1/comment-automations            listAutomations (stats for the list)
 *   GET    /v1/comment-automations/{id}       getAutomation (stats + recent logs)
 *   PATCH  /v1/comment-automations/{id}       updateAutomation (on/off, text)
 *   DELETE /v1/comment-automations/{id}       deleteAutomation
 *   GET    /v1/accounts/{accountId}/posts     accountPosts (the account's own 25 latest)
 *   GET    /v1/posts/{postId}                 getPost (a posted app post's Instagram id)
 *
 * The browser never names the post's ids: it sends the key of a choice, and
 * the server rebuilds the list and finds that key in it. So a binding can only
 * ever be a post on THIS account that this server itself found.
 */

type Fail = { ok: false; error: string; status: number }
const fail = (error: string, status = 400): Fail => ({ ok: false, error, status })

const automations = () => table<CommentAutomation>('comment_automations')

async function mayTouchClient(user: TeamUser, clientId: string): Promise<boolean> {
  const allowed = await accessibleClientIds(user)
  return allowed === null || allowed.includes(clientId)
}

/* ── the form's first two steps: client → account ───────────────────────── */

export type SetupAccount = {
  id: string; platform: string; username: string | null; name: string | null; avatar_url: string | null
}
export type SetupClient = {
  id: string; name: string; slug: string
  /** why nothing can be set up for this client, in a sentence; null when it can */
  problem: string | null
  accounts: SetupAccount[]
}

export async function setupClients(user: TeamUser): Promise<SetupClient[]> {
  const allowed = await accessibleClientIds(user)
  const [clients, accounts] = await Promise.all([
    table<Client>('clients').list(),
    table<SocialAccount>('social_accounts').list(),
  ])
  const out: SetupClient[] = []
  for (const c of clients) {
    if (allowed !== null && !allowed.includes(c.id)) continue
    const mine = accounts.filter(a => a.client_id === c.id)
    if (mine.length === 0) continue
    const usable = mine.filter(a => a.active !== false && isAutomationPlatform(a.platform) && a.provider_account_id)
    const problem = !c.social_profile_id
      ? 'This client has no Zernio profile yet — link its accounts on the Schedule access page first.'
      : usable.length === 0 ? 'No Instagram or Facebook account is connected for this client.' : null
    out.push({
      id: c.id, name: c.name, slug: c.slug, problem,
      accounts: usable.map(a => ({
        id: a.id, platform: String(a.platform).toLowerCase(), username: a.username, name: a.name, avatar_url: a.avatar_url,
      })),
    })
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

/** The client and one of its accounts, checked: the account belongs to the client and can run an automation. */
async function clientAndAccount(clientId: string, accountId: string):
  Promise<{ ok: true; client: Client; account: SocialAccount } | Fail> {
  const [client, account] = await Promise.all([
    table<Client>('clients').get(clientId),
    table<SocialAccount>('social_accounts').get(accountId),
  ])
  if (!client) return fail('That client is not there any more', 404)
  if (!account || account.client_id !== client.id) return fail('That account is not one of this client\'s', 400)
  if (account.active === false) return fail('That account is not connected any more — reconnect it first', 400)
  if (!isAutomationPlatform(account.platform)) return fail('Comment automations run on Instagram and Facebook only', 400)
  if (!account.provider_account_id) return fail('That account has no Zernio id — reconnect it first', 400)
  if (!client.social_profile_id) return fail('This client has no Zernio profile yet — link its accounts on the Schedule access page first.', 400)
  return { ok: true, client, account }
}

/* ── step three: the post ───────────────────────────────────────────────── */

/**
 * Every post this account's automation may answer on: the app's own posts on
 * this account that are booked or posted, then the account's own recent
 * posts that were not made here.
 */
async function choicesFor(client: Client, account: SocialAccount): Promise<{ choices: PostChoice[]; accountPostsRead: boolean }> {
  const publisher = getPublisher()
  const platform = String(account.platform).toLowerCase()
  const [rows, accountRaw] = await Promise.all([
    table<SocialPost>('social_posts').list({ where: p => p.client_id === client.id }),
    publisher.accountPosts(account.provider_account_id).catch(() => null),
  ])
  const accountPosts: AccountPost[] = readAccountPosts(accountRaw)
  const states = rows
    .map(r => readPostState(r as unknown as Record<string, unknown>))
    .filter((p): p is NonNullable<typeof p> => !!p && (p.stage === 'booked' || p.stage === 'posted') && p.channels.includes(account.id))
  const jobIds = new Set(states.flatMap(p => p.booking?.job_ids ?? []))
  const jobs = jobIds.size
    ? await table<PublishJob>('publish_jobs').list({ where: j => jobIds.has(j.id) })
    : []

  const app: PostChoice[] = []
  for (const p of states) {
    const input = {
      id: p.id, stage: p.stage, caption: p.caption, scheduled_for: p.scheduled_for, channels: p.channels,
      slides: p.slides.map(s => ({ url: s.url, type: s.type })),
      outcomes: p.outcomes as Record<string, { status: string; url: string | null; at: string | null }>,
      job_ids: p.booking?.job_ids ?? [],
    }
    const jobRows = jobs.map(j => ({ id: j.id, status: j.status, provider_post_id: j.provider_post_id, targets: j.targets }))
    let platformId: string | null = null
    const outcome = p.outcomes[platform]
    if (p.stage === 'posted' || outcome?.status === 'published') {
      platformId = platformIdByPermalink(outcome?.url ?? null, accountPosts)
      if (!platformId) {
        // older than the account's latest 25, or the link was never recorded: ask Zernio for the post itself
        const zid = jobRows.filter(j => input.job_ids.includes(j.id)).map(j => j.provider_post_id).find(isZernioPostId)
        if (zid) platformId = platformPostIdOn(await publisher.getPost(zid).catch(() => null), account.provider_account_id).id
      }
    }
    const choice = appPostChoice(input, { id: account.id, platform }, jobRows, platformId)
    if (choice) app.push(choice)
  }
  return { choices: mergeChoices(app, accountPosts), accountPostsRead: accountRaw != null }
}

export async function postChoices(user: TeamUser, clientId: string, accountId: string):
  Promise<{ ok: true; choices: PostChoice[]; accountPostsRead: boolean } | Fail> {
  if (!(await mayTouchClient(user, clientId))) return fail('That client is not one of yours', 403)
  const checked = await clientAndAccount(clientId, accountId)
  if (!checked.ok) return checked
  return { ok: true, ...(await choicesFor(checked.client, checked.account)) }
}

/* ── switching one on ───────────────────────────────────────────────────── */

export async function createForPost(user: TeamUser, raw: unknown): Promise<{ ok: true; row: CommentAutomation } | Fail> {
  const parsed = parseAutomationInput(raw)
  if (!parsed.ok) return fail(parsed.error)
  const input = parsed.value
  if (!(await mayTouchClient(user, input.client_id))) return fail('That client is not one of yours', 403)
  const checked = await clientAndAccount(input.client_id, input.social_account_id)
  if (!checked.ok) return checked
  const { client, account } = checked

  const { choices } = await choicesFor(client, account)
  const choice = choices.find(c => c.key === input.post_key) ?? null
  if (!choice) return fail('That post is not on this account any more — pick it again.')
  const bound = chooseBinding(choice)
  if (!bound.ok) return fail(bound.error)

  const link = finalLink(input, client.slug)
  if (!link.ok) return fail(link.error)

  const name = input.name ?? defaultName(input.keywords, choice.title)
  const payload = zernioPayload(
    input,
    { profileId: client.social_profile_id!, accountId: account.provider_account_id },
    bound.binding,
    { name, postTitle: choice.title, link: link.link },
  )

  let zernioId: string | null
  try {
    zernioId = createdAutomationId(await getPublisher().createAutomation(payload))
  } catch (e) {
    return fail(`Zernio refused it: ${e instanceof Error ? e.message : 'unknown error'}`, 502)
  }
  if (!zernioId) return fail('Zernio did not say the automation was made — look on Zernio before trying again.', 502)

  const at = new Date().toISOString()
  try {
    const row = await automations().insert({
      id: randomUUID(),
      client_id: client.id,
      social_account_id: account.id,
      provider_account_id: account.provider_account_id,
      platform: String(account.platform).toLowerCase(),
      zernio_automation_id: zernioId,
      social_post_id: choice.social_post_id,
      platform_post_id: bound.binding.kind === 'live' ? bound.binding.platformPostId : null,
      zernio_post_id: bound.binding.kind === 'pending' ? bound.binding.postId : choice.zernio_post_id,
      post_title: choice.title,
      post_thumb: choice.thumb,
      post_date: choice.date,
      name,
      keywords: input.keywords,
      match_mode: input.match_mode,
      dm_message: input.dm_message,
      button_title: input.button_title && link.link ? input.button_title : null,
      link: link.link,
      comment_reply: input.comment_reply,
      dm_variations: input.dm_variations,
      reply_variations: input.reply_variations,
      active: true,
      paused_reason: null,
      created_by: user.id,
      created_at: at,
      updated_at: at,
    })
    return { ok: true, row }
  } catch (e) {
    // an automation running at Zernio that nobody here can see or switch off is exactly what the
    // owner's rule forbids — take it back down rather than leave it
    console.error('comment automation: could not record, deleting it at Zernio', zernioId, e)
    await getPublisher().deleteAutomation(zernioId).catch(err => console.error('comment automation: delete after failed record also failed', zernioId, err))
    return fail('It could not be recorded here, so it was switched off again. Try once more.', 500)
  }
}

/* ── the list ───────────────────────────────────────────────────────────── */

export type ViewRow = {
  id: string
  client_id: string
  client_name: string
  account: { id: string; platform: string; username: string | null }
  post: { title: string | null; thumb: string | null; date: string | null; social_post_id: string | null; bound: 'live' | 'pending' }
  name: string
  keywords: string[]
  match_mode: string
  dm_message: string
  button_title: string | null
  link: string | null
  comment_reply: string | null
  dm_variations: string[]
  reply_variations: string[]
  active: boolean
  paused_reason: string | null
  created_at: string
  stats: AutomationStats | null
  logs: AutomationLogRow[]
  /** a sentence when something is wrong with it */
  warning: string | null
}

export type OutsideRow = {
  id: string
  name: string
  client_id: string | null
  client_name: string | null
  account_username: string | null
  platform: string
  keywords: string[]
  active: boolean
  account_wide: boolean
  stats: AutomationStats
}

export async function listForView(user: TeamUser): Promise<{ rows: ViewRow[]; outside: OutsideRow[]; zernioRead: boolean }> {
  const allowed = await accessibleClientIds(user)
  const ok = (clientId: string | null | undefined) => allowed === null || (!!clientId && allowed.includes(clientId))
  const publisher = getPublisher()
  const [ours, clients, accounts, zernioRaw] = await Promise.all([
    automations().list(),
    table<Client>('clients').list(),
    table<SocialAccount>('social_accounts').list(),
    publisher.listAutomations().catch(() => null),
  ])
  const zernio = new Map<string, ZernioAutomation>(readZernioAutomations(zernioRaw).map(a => [a.id, a]))
  const clientName = new Map(clients.map(c => [c.id, c.name]))
  const accountById = new Map(accounts.map(a => [a.id, a]))
  const visible = ours.filter(r => ok(r.client_id))

  // the posts behind them, for "waiting on an old booking"
  const postIds = [...new Set(visible.map(r => r.social_post_id).filter(Boolean) as string[])]
  const postRows = postIds.length ? await table<SocialPost>('social_posts').list({ where: p => postIds.includes(p.id) }) : []
  const postStates = new Map(postRows.map(r => [r.id, readPostState(r as unknown as Record<string, unknown>)]))
  const jobIds = new Set([...postStates.values()].flatMap(p => p?.booking?.job_ids ?? []))
  const jobs = jobIds.size ? await table<PublishJob>('publish_jobs').list({ where: j => jobIds.has(j.id) }) : []

  const rows: ViewRow[] = await Promise.all(visible.map(async r => {
    const z = zernio.get(r.zernio_automation_id) ?? null
    const detail = await publisher.getAutomation(r.zernio_automation_id).catch(() => null)
    const zd = detail ? readZernioAutomation(detail) : null
    const acc = accountById.get(r.social_account_id)
    const state = r.social_post_id ? postStates.get(r.social_post_id) ?? null : null
    const zernioIds = (state?.booking?.job_ids ?? [])
      .map(id => jobs.find(j => j.id === id)?.provider_post_id).filter(isZernioPostId)
    let warning: string | null = null
    if (zernioRaw != null && !z) warning = 'Zernio no longer has this automation — it is not running. Delete it here and set it up again.'
    else if (state?.stage === 'cancelled') warning = 'The post was cancelled, so this was switched off.'
    else if (waitingOnOldBooking(r, state ? { stage: state.stage, zernio_ids: zernioIds } : null)) {
      warning = 'The post was booked again after this was set up, so it is waiting on the old booking and will never start. Delete it and set it up again.'
    }
    return {
      id: r.id,
      client_id: r.client_id,
      client_name: clientName.get(r.client_id) ?? 'Unknown client',
      account: { id: r.social_account_id, platform: r.platform, username: acc?.username ?? null },
      post: {
        title: r.post_title, thumb: r.post_thumb, date: r.post_date, social_post_id: r.social_post_id,
        bound: r.platform_post_id || zd?.platformPostId || z?.platformPostId ? 'live' : 'pending',
      },
      name: r.name,
      keywords: Array.isArray(r.keywords) ? (r.keywords as unknown[]).map(String) : [],
      match_mode: r.match_mode,
      dm_message: r.dm_message,
      button_title: r.button_title,
      link: r.link,
      comment_reply: r.comment_reply,
      dm_variations: Array.isArray(r.dm_variations) ? (r.dm_variations as unknown[]).map(String) : [],
      reply_variations: Array.isArray(r.reply_variations) ? (r.reply_variations as unknown[]).map(String) : [],
      // Zernio's word on/off wins — it is the one that sends
      active: zd ? zd.isActive : z ? z.isActive : r.active,
      paused_reason: r.paused_reason,
      created_at: r.created_at,
      stats: zd?.stats ?? z?.stats ?? null,
      logs: detail ? shapeLogs(detail) : [],
      warning,
    }
  }))
  rows.sort((a, b) => a.client_name.localeCompare(b.client_name) || b.created_at.localeCompare(a.created_at))

  // automations at Zernio this page did not make (the older page, or Zernio's own dashboard)
  const known = new Set(ours.map(r => r.zernio_automation_id))
  const byProvider = new Map(accounts.map(a => [a.provider_account_id, a]))
  const outside: OutsideRow[] = []
  for (const a of zernio.values()) {
    if (known.has(a.id)) continue
    const acc = byProvider.get(a.accountId) ?? null
    if (!ok(acc?.client_id ?? null)) continue
    outside.push({
      id: a.id, name: a.name, client_id: acc?.client_id ?? null,
      client_name: acc?.client_id ? clientName.get(acc.client_id) ?? null : null,
      account_username: acc?.username ?? null, platform: a.platform, keywords: a.keywords,
      active: a.isActive, account_wide: isAccountWide(a), stats: a.stats,
    })
  }
  return { rows, outside, zernioRead: zernioRaw != null }
}

/* ── changing one ───────────────────────────────────────────────────────── */

/** An automation this page did not make is addressed as `z:<zernio id>`. */
const OUTSIDE = 'z:'

async function outsideAutomation(user: TeamUser, zernioId: string): Promise<{ ok: true; a: ZernioAutomation } | Fail> {
  const a = readZernioAutomation(await getPublisher().getAutomation(zernioId).catch(() => null))
  if (!a) return fail('Zernio has no such automation', 404)
  const acc = (await table<SocialAccount>('social_accounts').list({ where: r => r.provider_account_id === a.accountId }))[0] ?? null
  // an automation on an account we do not hold is only a super admin's to touch
  if (!acc?.client_id ? user.role !== 'super_admin' : !(await mayTouchClient(user, acc.client_id))) {
    return fail('That automation is not on one of your clients', 403)
  }
  return { ok: true, a }
}

export async function updateAutomation(user: TeamUser, id: string, raw: unknown): Promise<{ ok: true } | Fail> {
  if (id.startsWith(OUTSIDE)) {
    const found = await outsideAutomation(user, id.slice(OUTSIDE.length))
    if (!found.ok) return found
    const r = (raw ?? {}) as Record<string, unknown>
    if (typeof r.active !== 'boolean' || Object.keys(r).length !== 1) {
      return fail('An automation made outside this page can only be switched on or off here.')
    }
    if (r.active && isAccountWide(found.a)) {
      return fail('This one answers every comment on the account. Nothing here switches that on — set one up for a single post instead.')
    }
    try { await getPublisher().updateAutomation(found.a.id, { isActive: r.active }) }
    catch (e) { return fail(`Zernio refused it: ${e instanceof Error ? e.message : 'unknown error'}`, 502) }
    return { ok: true }
  }

  const row = await automations().get(id, { fresh: true })
  if (!row) return fail('That automation is not there any more', 404)
  if (!(await mayTouchClient(user, row.client_id))) return fail('That automation is not on one of your clients', 403)
  const patch = updatePatch(raw, { link: row.link, hasButton: !!row.button_title })
  if (!patch.ok) return fail(patch.error)
  // switching one back on: the post it answers on must still be a post (never a cancelled one)
  if (patch.patch.isActive === true && row.social_post_id) {
    const post = readPostState((await table<SocialPost>('social_posts').get(row.social_post_id)) as unknown as Record<string, unknown>)
    if (!post || post.stage === 'cancelled') return fail('The post this answers on was cancelled — it cannot be switched back on.')
  }
  try { await getPublisher().updateAutomation(row.zernio_automation_id, patch.patch) }
  catch (e) { return fail(`Zernio refused it: ${e instanceof Error ? e.message : 'unknown error'}`, 502) }
  await automations().update(row.id, { ...patch.ours, updated_at: new Date().toISOString() } as Partial<CommentAutomation>)
  return { ok: true }
}

export async function deleteAutomation(user: TeamUser, id: string): Promise<{ ok: true } | Fail> {
  if (id.startsWith(OUTSIDE)) {
    const found = await outsideAutomation(user, id.slice(OUTSIDE.length))
    if (!found.ok) return found
    try { await getPublisher().deleteAutomation(found.a.id) }
    catch (e) { return fail(`Zernio refused it: ${e instanceof Error ? e.message : 'unknown error'}`, 502) }
    return { ok: true }
  }
  const row = await automations().get(id, { fresh: true })
  if (!row) return fail('That automation is not there any more', 404)
  if (!(await mayTouchClient(user, row.client_id))) return fail('That automation is not on one of your clients', 403)
  try { await getPublisher().deleteAutomation(row.zernio_automation_id) }
  catch (e) {
    const why = e instanceof Error ? e.message : ''
    // already gone at Zernio: the record goes too
    if (!/not found|404/i.test(why)) return fail(`Zernio refused it: ${why || 'unknown error'}`, 502)
  }
  await automations().remove(row.id)
  return { ok: true }
}

/* ── the post was taken off ─────────────────────────────────────────────── */

/**
 * A post that is cancelled, taken off the schedule, opened for an edit or
 * moved to a new time must not go on DMing people (cancelling is somebody
 * saying "stop"). Every automation on it is switched OFF at Zernio and marked
 * here — never deleted, so its history stays. The reason says the app did it,
 * which is what lets a re-booking switch it back on (armDecision); one a
 * person switched off stays off. Best-effort: never throws into the caller.
 */
export async function pauseAutomationsForPost(postId: string, reason: string = CANCELLED_REASON): Promise<void> {
  try {
    const rows = await automations().list({ where: r => r.social_post_id === postId && r.active })
    for (const row of rows) {
      try {
        await getPublisher().updateAutomation(row.zernio_automation_id, { isActive: false })
        await automations().update(row.id, { active: false, paused_reason: reason, updated_at: new Date().toISOString() })
        console.info('comment automation switched off', { post: postId, automation: row.zernio_automation_id, reason })
      } catch (e) {
        console.error('comment automation: could not switch off for a post taken off', row.zernio_automation_id, e instanceof Error ? e.message : e)
      }
    }
  } catch (e) {
    console.error('comment automation: could not read automations for a post taken off', postId, e instanceof Error ? e.message : e)
  }
}

/* ── the automation set up while scheduling: made when the booking reaches Zernio ── */

const ARMABLE = ['scheduled', 'published', 'duplicate']

const jobPlatformsOf = (targets: unknown): string[] =>
  (Array.isArray(targets) ? targets : [])
    .map(t => String((t as { platform?: unknown } | null)?.platform ?? '').toLowerCase())
    .filter(Boolean)

/**
 * A BOOKING REACHED ZERNIO — make (or switch back on) the comment-to-DM automation of every post that
 * holds this job and has one turned on (the owner, 29 Sep 2026: "ManyChat-style").
 *
 * Called where the post hears its job (publish.ts tellThePost: the dispatch, the reconciler, the
 * webhook), because the Zernio post id is only known once Zernio has accepted the job. So it runs many
 * times for one booking and must be idempotent: ONE row per post and account (postAutomationRowId),
 * taken under a claim lock, and armDecision says what — if anything — is left to do.
 *
 * Bound to the booking's Zernio post (`postId`, pending until it publishes — the docs: "the automation
 * stays pending and arms itself when that post publishes"), or, once the post is live and Zernio knows
 * the network's id, to that (`platformPostId`). Never to the account. Best-effort: never throws.
 */
export async function armPostAutomations(jobId: string): Promise<void> {
  try {
    const job = await table<PublishJob>('publish_jobs').get(jobId, { fresh: true })
    if (!job || !isZernioPostId(job.provider_post_id) || !ARMABLE.includes(job.status) || !job.client_id) return
    const holdsJob = new Set([job.id, ...(job.resend_of ? [job.resend_of] : [])])
    const rows = await table<SocialPost>('social_posts').list({ where: p => p.client_id === job.client_id })
    for (const row of rows) {
      const post = readPostState(row as unknown as Record<string, unknown>)
      if (!post || post.stage === 'cancelled' || !(post.booking?.job_ids ?? []).some(id => holdsJob.has(id))) continue
      // the frozen version is what was approved and booked — its automation, not the working copy's
      const frozen = post.sent_version != null
        ? await table<{ id: string; automation?: unknown }>('post_versions').get(postVersionId(post.id, post.sent_version)).catch(() => null)
        : null
      const automation = (frozen ? readPostAutomation(frozen.automation) : null) ?? post.automation ?? null
      if (!automation?.on) continue
      const client = await table<Client>('clients').get(post.client_id)
      if (!client?.social_profile_id) { console.error('comment automation: client has no Zernio profile', post.client_id); continue }
      const problem = postAutomationProblem(automation, client.slug)
      if (problem) { console.error('comment automation: not made —', problem, { post: post.id }); continue }
      const platforms = jobPlatformsOf(job.targets)
      const accounts = (await table<SocialAccount>('social_accounts').list({ where: a => post.channels.includes(a.id) }))
        .filter(a => a.active !== false && isAutomationPlatform(a.platform) && a.provider_account_id
          && (platforms.length === 0 || platforms.includes(String(a.platform).toLowerCase())))
      for (const account of accounts) {
        const outcome = post.outcomes[String(account.platform).toLowerCase()]?.status ?? null
        await armOne({ postId: post.id, caption: post.caption, stage: post.stage, outcome, thumb: post.slides.find(s => s.type === 'image')?.url ?? null },
          client, account, automation, job)
      }
    }
  } catch (e) {
    console.error('comment automation: could not arm for job', jobId, e instanceof Error ? e.message : e)
  }
}

async function armOne(
  post: { postId: string; caption: string; stage: string; outcome: string | null; thumb: string | null },
  client: Client, account: SocialAccount, automation: PostAutomation, job: PublishJob,
): Promise<void> {
  const publisher = getPublisher()
  const zid = String(job.provider_post_id)
  // live already? then Zernio knows the network's id, and the docs say bind by that alone
  let binding: Binding = { kind: 'pending', postId: zid }
  const maybeLive = job.status !== 'scheduled' || post.stage === 'posted' || post.outcome === 'published'
  if (maybeLive) {
    const remote = platformPostIdOn(await publisher.getPost(zid).catch(() => null), account.provider_account_id)
    if (remote.id) binding = { kind: 'live', platformPostId: remote.id }
    else if (job.status !== 'scheduled') {
      // out, but Zernio has not said its network id yet — the reconciler asks again
      console.info('comment automation: post is out but its network id is not known yet', { post: post.postId, job: job.id })
      return
    }
  }

  const rowId = postAutomationRowId(post.postId, account.id)
  const lockKey = `comment_automation__${rowId}`
  const holder = randomUUID()
  const lock = await takeClaimLock(lockKey, holder, async () => false)
  if (!lock.ok) return
  try {
    const row = await automations().get(rowId, { fresh: true })
    const decision = armDecision(row, binding)
    const at = new Date().toISOString()
    if (decision === 'none') return
    if (decision === 'reactivate' && row) {
      await publisher.updateAutomation(row.zernio_automation_id, { isActive: true })
      await automations().update(row.id, { active: true, paused_reason: null, updated_at: at })
      console.info('comment automation switched back on', { post: post.postId, automation: row.zernio_automation_id })
      return
    }
    if (decision === 'rebind' && row) {
      // the earlier booking was pulled (a move re-books): its automation waited on a Zernio post that is
      // gone and never armed, so it is replaced. One that DID fire keeps its history and is only switched off.
      const old = readZernioAutomation(await publisher.getAutomation(row.zernio_automation_id).catch(() => null))
      if (old && old.stats.triggered > 0) await publisher.updateAutomation(old.id, { isActive: false }).catch(() => {})
      else if (old) await publisher.deleteAutomation(old.id).catch(e => console.error('comment automation: old pending one would not go', old.id, e))
    }
    // the same reading the form's save used (postAutomationProblem) — variations checked, blanks dropped
    const parsed = parseAutomationInput({ client_id: 'x', social_account_id: 'x', post_key: 'x', ...automation })
    if (!parsed.ok) { console.error('comment automation: not made —', parsed.error, { post: post.postId }); return }
    const variations = { dm: parsed.value.dm_variations, reply: parsed.value.reply_variations }
    const link = finalLink(parsed.value, client.slug)
    if (!link.ok) { console.error('comment automation: not made —', link.error, { post: post.postId }); return }
    const title = postTitleOf(post.caption, job.scheduled_for)
    const name = defaultName(automation.keywords, title)
    const payload = zernioPayload(
      { ...parsed.value, match_mode: 'word' },
      { profileId: client.social_profile_id!, accountId: account.provider_account_id },
      binding,
      { name, postTitle: title, link: link.link },
    )
    const zernioId = createdAutomationId(await publisher.createAutomation(payload))
    if (!zernioId) { console.error('comment automation: Zernio gave no id', { post: post.postId }); return }
    const record: CommentAutomation = {
      id: rowId,
      client_id: client.id,
      social_account_id: account.id,
      provider_account_id: account.provider_account_id,
      platform: String(account.platform).toLowerCase(),
      zernio_automation_id: zernioId,
      social_post_id: post.postId,
      platform_post_id: binding.kind === 'live' ? binding.platformPostId : null,
      zernio_post_id: zid,
      post_title: title,
      post_thumb: post.thumb,
      post_date: job.scheduled_for ?? job.published_at ?? null,
      name,
      keywords: automation.keywords,
      match_mode: 'word',
      dm_message: automation.dm_message,
      button_title: automation.button_title && link.link ? automation.button_title : null,
      link: link.link,
      comment_reply: automation.comment_reply,
      dm_variations: variations.dm,
      reply_variations: variations.reply,
      active: true,
      paused_reason: null,
      created_by: row?.created_by ?? job.created_by ?? null,
      created_at: row?.created_at ?? at,
      updated_at: at,
    }
    if (row) await automations().update(rowId, record)
    else await automations().insert(record)
    console.info('comment automation made for a booked post', { post: post.postId, account: account.id, automation: zernioId, binding: binding.kind })
  } catch (e) {
    console.error('comment automation: could not make it for a booked post', post.postId, e instanceof Error ? e.message : e)
  } finally {
    await releaseClaimLock(lockKey, holder).catch(() => {})
  }
}

/** One post's automations as the post window shows them ("waiting for the post" / "live · 12 DMs"). */
export type PostAutomationState = { account_id: string; made: boolean; active: boolean; live: boolean; stats: AutomationStats | null; paused_reason: string | null }

export async function postAutomationState(user: TeamUser, postId: string): Promise<{ ok: true; rows: PostAutomationState[] } | Fail> {
  const post = await table<SocialPost>('social_posts').get(postId)
  if (!post) return fail('That post is not there any more', 404)
  if (!(await mayTouchClient(user, post.client_id))) return fail('That post is not one of yours', 403)
  const rows = await automations().list({ where: r => r.social_post_id === postId })
  const publisher = getPublisher()
  return {
    ok: true,
    rows: await Promise.all(rows.map(async r => {
      const z = readZernioAutomation(await publisher.getAutomation(r.zernio_automation_id).catch(() => null))
      return {
        account_id: r.social_account_id,
        made: true,
        active: z ? z.isActive : r.active,
        live: !!(z?.platformPostId ?? r.platform_post_id),
        stats: z?.stats ?? null,
        paused_reason: r.paused_reason,
      }
    })),
  }
}

