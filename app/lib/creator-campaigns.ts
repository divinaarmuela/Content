import 'server-only'
import { randomUUID } from 'node:crypto'
import { table } from '@/lib/db'
import type { Client, TeamUser as TeamUserRow } from '@/lib/db-types'
import type { TeamUser } from './authz'
import { accessibleClientIds } from './production-access'
import {
  campaignCreatorId, clientMayDecide, isCreatorStage, mayCreateFor, mayDeleteCampaign, mayEditCampaign, maySeeCampaign,
  sanitiseCampaignInput, sanitiseCreatorInput, seatCount, stageMove,
  type Campaign, type CampaignCreator, type Creator, type CreatorStage, type SeatCount, type Viewer,
} from './creator-campaign-core'

/**
 * CREATOR CAMPAIGNS — the server's half (the rules are in creator-campaign-core; nothing is decided here that the
 * core does not say). Every write re-reads the row inside `claim` and carries the row's own `rev`: two people
 * pressing at once means one wins and the other is handed the row as it now stands. Never check-then-write.
 */

export type Result<T> = { ok: true; value: T } | { ok: false; status: 400 | 403 | 404 | 409; reason: string; fresh?: unknown }

const campaigns = () => table<Campaign>('creator_campaigns')
const onCampaign = () => table<CampaignCreator & { created_at?: string; updated_at?: string }>('campaign_creators')
const directory = () => table<Creator>('creators')

const STALE = 'Somebody changed this just now — here it is as it stands'
const GONE = 'That campaign is not here'

/** RTDB keeps no empty list: a campaign saved with nobody on it comes back with the key missing. */
const whole = (c: Campaign): Campaign => ({ ...c, deliverables: c.deliverables ?? [], member_ids: c.member_ids ?? [] })
const wholeRow = (r: CampaignCreator): CampaignCreator => ({ ...r, samples: r.samples ?? [], sample_images: r.sample_images ?? [] })

/** The client's own day, YYYY-MM-DD — the agency and its clients are in Melbourne. */
export const todayInMelbourne = (now = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Melbourne' }).format(now)

/** Who is asking, with the clients that are theirs. Only a super admin has every client here. */
export async function viewerOf(user: TeamUser): Promise<Viewer> {
  if (user.role === 'super_admin') return { id: user.id, role: user.role, clientIds: null }
  if (user.role !== 'account_manager') return { id: user.id, role: user.role, clientIds: [] }
  return { id: user.id, role: user.role, clientIds: (await accessibleClientIds(user)) ?? [] }
}

const clientNames = async () => new Map((await table<Client>('clients').list()).map(c => [c.id, c]))

export type CampaignCard = Campaign & { client_name: string; counts: SeatCount; with_client: number; creators: number }

export async function listCampaigns(v: Viewer): Promise<CampaignCard[]> {
  const [all, rows, clients] = await Promise.all([campaigns().list(), onCampaign().list(), clientNames()])
  return all.map(whole).filter(c => maySeeCampaign(v, c))
    .map(c => {
      const mine = rows.filter(r => r.campaign_id === c.id)
      return { ...c, client_name: clients.get(c.client_id)?.name ?? 'A client', counts: seatCount(c, mine), with_client: mine.filter(r => r.stage === 'with_client').length, creators: mine.length }
    })
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
}

/** The clients this person may make a campaign for: their own, or every client for a super admin. Never a lead. */
export async function campaignClients(v: Viewer): Promise<{ id: string; name: string }[]> {
  const all = await table<Client>('clients').list({ where: c => String((c as { status?: string }).status ?? '') !== 'lead' })
  return all.filter(c => mayCreateFor(v, c.id)).map(c => ({ id: c.id, name: c.name })).sort((a, b) => a.name.localeCompare(b.name))
}

/** The team, for the "who is on this campaign" list. */
export async function campaignPeople(): Promise<{ id: string; name: string; role: string }[]> {
  const team = await table<TeamUserRow>('team_users').list({ where: r => r.role !== 'client' && r.active_status === true })
  return team.map(u => ({ id: u.id, name: u.name || u.email, role: u.role })).sort((a, b) => a.name.localeCompare(b.name))
}

export type LoadedCampaign = {
  campaign: Campaign; creators: CampaignCreator[]; client_name: string; portal_token: string | null
  may: { edit: boolean; remove: boolean }
}

/** One campaign with its creators — or null when it is not there OR not this person's (the two look the same). */
export async function loadCampaign(v: Viewer, id: string): Promise<LoadedCampaign | null> {
  const found = await campaigns().get(id)
  if (!found) return null
  const campaign = whole(found)
  if (!maySeeCampaign(v, campaign)) return null
  const [rows, client] = await Promise.all([
    onCampaign().list({ where: r => r.campaign_id === id }),
    table<Client>('clients').get(campaign.client_id).catch(() => null),
  ])
  return {
    campaign,
    creators: rows.map(wholeRow).sort((a, b) => a.name.localeCompare(b.name)),
    client_name: client?.name ?? 'A client',
    portal_token: (client as { share_token?: string | null } | null)?.share_token ?? null,
    may: { edit: mayEditCampaign(v, campaign), remove: mayDeleteCampaign(v, campaign) },
  }
}

export async function createCampaign(v: Viewer, raw: unknown): Promise<Result<Campaign>> {
  const input = sanitiseCampaignInput(raw)
  if (!input.client_id) return { ok: false, status: 400, reason: 'Choose the client' }
  if (!input.title) return { ok: false, status: 400, reason: 'Give the campaign a name' }
  if (!mayCreateFor(v, input.client_id)) return { ok: false, status: 403, reason: 'That client is not one of yours' }
  const client = await table<Client>('clients').get(input.client_id).catch(() => null)
  if (!client) return { ok: false, status: 400, reason: 'Choose the client' }
  const now = new Date().toISOString()
  const made = await campaigns().insert({
    client_id: client.id, title: input.title, kind: input.kind ?? 'event',
    starts_at: input.starts_at ?? null, ends_at: input.ends_at ?? null, place: input.place ?? null,
    seats: input.seats ?? null, closes_on: input.closes_on ?? null,
    deliverables: input.deliverables ?? [], usage_terms: input.usage_terms ?? null, cover_url: input.cover_url ?? null,
    // a new campaign is the team's own until somebody opens it to the client
    status: 'draft', client_visible: false,
    member_ids: [], created_by: v.id, created_at: now, updated_at: now, rev: 1,
  } as never)
  return { ok: true, value: whole(made) }
}

export async function patchCampaign(v: Viewer, id: string, raw: unknown, expectRev: number): Promise<Result<Campaign>> {
  if (!Number.isInteger(expectRev)) return { ok: false, status: 400, reason: 'Reload the page and try again' }
  // the client a campaign is for never changes: it would carry creators the first client approved over to another
  const { client_id: _client, ...input } = sanitiseCampaignInput(raw)
  void _client
  if (input.member_ids) {
    const real = new Set((await campaignPeople()).map(p => p.id))
    input.member_ids = input.member_ids.filter(m => real.has(m))
  }
  const now = new Date().toISOString()
  let refusal: Result<Campaign> | null = null
  const res = await campaigns().claim(id, found => {
    refusal = null
    const current = found ? whole(found) : null
    if (!current || !maySeeCampaign(v, current)) { refusal = { ok: false, status: 404, reason: GONE }; return null }
    if (!mayEditCampaign(v, current)) { refusal = { ok: false, status: 403, reason: 'You can look at this campaign, not change it' }; return null }
    if (current.rev !== expectRev) { refusal = { ok: false, status: 409, reason: STALE, fresh: current }; return null }
    return { ...current, ...input, rev: current.rev + 1, updated_at: now }
  })
  if (res.claimed) return { ok: true, value: whole(res.row) }
  return refusal ?? { ok: false, status: 409, reason: STALE, fresh: res.current }
}

export async function deleteCampaign(v: Viewer, id: string): Promise<Result<true>> {
  // WIN THE CAMPAIGN FIRST (review, 26 Nov 2026 — it was read, then deleted: a colleague making it live in between
  // had a live campaign deleted under them). The rule is asked inside the claim, on the row as it is at that instant,
  // and winning closes and hides it — so anybody else's change is now stale and the client no longer sees it. Only
  // then do its creators go, and the campaign last: a failure part-way leaves a closed, hidden campaign, never a live
  // one with its creators gone.
  let refusal: Result<true> | null = null
  const res = await campaigns().claim(id, found => {
    refusal = null
    const current = found ? whole(found) : null
    if (!current || !maySeeCampaign(v, current)) { refusal = { ok: false, status: 404, reason: GONE }; return null }
    if (!mayDeleteCampaign(v, current)) { refusal = { ok: false, status: 403, reason: 'Only a super admin deletes a campaign that is live, or one somebody else made' }; return null }
    return { ...current, status: 'closed', client_visible: false, rev: current.rev + 1, updated_at: new Date().toISOString() }
  })
  if (!res.claimed) return refusal ?? { ok: false, status: 409, reason: STALE, fresh: res.current ? whole(res.current) : null }
  await onCampaign().removeWhere(r => r.campaign_id === id)
  await campaigns().remove(id)
  return { ok: true, value: true }
}

/** The campaign, if this person may change it — else the refusal to send back. */
async function editable(v: Viewer, campaignId: string): Promise<{ ok: true; campaign: Campaign } | { ok: false; status: 403 | 404; reason: string }> {
  const found = await campaigns().get(campaignId, { fresh: true })
  const campaign = found ? whole(found) : null
  if (!campaign || !maySeeCampaign(v, campaign)) return { ok: false, status: 404, reason: GONE }
  if (!mayEditCampaign(v, campaign)) return { ok: false, status: 403, reason: 'You can look at this campaign, not change it' }
  return { ok: true, campaign }
}

/** The agency-wide list, by name or handle. An empty search gives the most recent. */
export async function searchCreators(q: string): Promise<Creator[]> {
  const needle = q.trim().toLowerCase().replace(/^@/, '')
  const all = await directory().list()
  return all
    .filter(c => !needle || c.name.toLowerCase().includes(needle) || (c.instagram ?? '').includes(needle) || (c.tiktok ?? '').includes(needle))
    .sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)))
    .slice(0, 20)
}

/**
 * Put a creator on a campaign, as an idea. `creator_id` picks one from the agency's list; without it the creator is
 * typed in, and is kept in that list for next time (matched to an existing one by Instagram or TikTok handle, so the
 * same person typed twice is one entry).
 */
export async function addCreator(v: Viewer, campaignId: string, raw: unknown): Promise<Result<CampaignCreator>> {
  const gate = await editable(v, campaignId)
  if (!gate.ok) return gate
  const input = sanitiseCreatorInput(raw)
  const pickedId = raw && typeof raw === 'object' && typeof (raw as { creator_id?: unknown }).creator_id === 'string' ? (raw as { creator_id: string }).creator_id : null
  const now = new Date().toISOString()

  let known: Creator | null = pickedId ? await directory().get(pickedId) : null
  if (pickedId && !known) return { ok: false, status: 400, reason: 'That creator is not in the list any more' }
  if (!known) {
    if (!input.name) return { ok: false, status: 400, reason: 'Type the creator’s name' }
    const all = await directory().list()
    known = all.find(c => (input.instagram && c.instagram === input.instagram) || (input.tiktok && c.tiktok === input.tiktok)) ?? null
  }
  // what was typed wins; a box left blank keeps what the list already holds (it is not an order to wipe it)
  const profile = {
    name: input.name ?? known?.name ?? '',
    photo_url: input.photo_url ?? known?.photo_url ?? null,
    instagram: input.instagram ?? known?.instagram ?? null,
    instagram_followers: input.instagram_followers ?? known?.instagram_followers ?? null,
    tiktok: input.tiktok ?? known?.tiktok ?? null,
    tiktok_followers: input.tiktok_followers ?? known?.tiktok_followers ?? null,
  }
  // a creator new to the list is put in it first (the campaign row needs their id); one already in it is updated
  // only AFTER they are on the campaign, so a refused add changes nothing
  const kept = known ?? await directory().insert({ ...profile, created_by: v.id, created_at: now, updated_at: now } as never)

  const id = campaignCreatorId(campaignId, kept.id)
  const res = await onCampaign().claim(id, current => current ? null : {
    id, campaign_id: campaignId, client_id: gate.campaign.client_id, creator_id: kept.id, ...profile,
    why: input.why ?? null, terms: input.terms ?? 'gifted', rate: input.rate ?? null, samples: input.samples ?? [], sample_images: input.sample_images ?? [],
    stage: 'idea', client_note: null, decided_at: null, decided_by: null, created_at: now, updated_at: now, rev: 1,
  })
  if (!res.claimed) return { ok: false, status: 409, reason: `${res.current?.name ?? profile.name} is already on this campaign`, fresh: res.current ? wholeRow(res.current) : null }
  if (known) await directory().upsert({ ...known, ...profile, updated_at: now })
  return { ok: true, value: wholeRow(res.row) }
}

export async function patchCreator(v: Viewer, campaignId: string, rowId: string, raw: unknown, expectRev: number): Promise<Result<CampaignCreator>> {
  if (!Number.isInteger(expectRev)) return { ok: false, status: 400, reason: 'Reload the page and try again' }
  const gate = await editable(v, campaignId)
  if (!gate.ok) return gate
  const input = sanitiseCreatorInput(raw)
  const now = new Date().toISOString()
  let refusal: Result<CampaignCreator> | null = null
  const res = await onCampaign().claim(rowId, current => {
    refusal = null
    if (!current || current.campaign_id !== campaignId) { refusal = { ok: false, status: 404, reason: 'That creator is not on this campaign' }; return null }
    if (current.rev !== expectRev) { refusal = { ok: false, status: 409, reason: STALE, fresh: wholeRow(current) }; return null }
    return { ...current, ...input, rev: current.rev + 1, updated_at: now }
  })
  if (res.claimed) return { ok: true, value: wholeRow(res.row) }
  return refusal ?? { ok: false, status: 409, reason: STALE, fresh: res.current }
}

export type MoveActor = { kind: 'team'; viewer: Viewer } | { kind: 'client'; clientId: string; actorId: string }

/**
 * Move a creator to another stage — the team's move, or the client's answer. The rule is `stageMove`; a client's
 * move also needs the campaign to be THEIRS (else it is not there, as far as they can tell) and still open.
 * Every move that lands leaves a line in `campaign_creator_events`.
 */
export async function moveCreator(actor: MoveActor, campaignId: string, rowId: string, to: CreatorStage, expectRev: number, note?: string | null): Promise<Result<CampaignCreator>> {
  if (!isCreatorStage(to) || !Number.isInteger(expectRev)) return { ok: false, status: 400, reason: 'Reload the page and try again' }
  let actorId: string
  if (actor.kind === 'team') {
    const gate = await editable(actor.viewer, campaignId)
    if (!gate.ok) return gate
    actorId = actor.viewer.id
  } else {
    const found = await campaigns().get(campaignId, { fresh: true })
    if (!found || found.client_id !== actor.clientId) return { ok: false, status: 404, reason: GONE }
    const open = clientMayDecide(found, todayInMelbourne())
    if (!open.ok) return { ok: false, status: 403, reason: open.reason }
    actorId = actor.actorId
  }
  const words = typeof note === 'string' ? note.trim().slice(0, 600) || null : null
  const now = new Date().toISOString()
  let from: CreatorStage | null = null
  let refusal: Result<CampaignCreator> | null = null
  const res = await onCampaign().claim(rowId, current => {
    refusal = null; from = null
    if (!current || current.campaign_id !== campaignId) { refusal = { ok: false, status: 404, reason: 'That creator is not on this list' }; return null }
    if (current.rev !== expectRev) { refusal = { ok: false, status: 409, reason: STALE, fresh: wholeRow(current) }; return null }
    const move = stageMove(current.stage, to, actor.kind)
    if (!move.ok) { refusal = { ok: false, status: 409, reason: move.reason, fresh: wholeRow(current) }; return null }
    from = current.stage
    const answered = to === 'approved' || to === 'passed'
    return {
      ...current, stage: to, rev: current.rev + 1, updated_at: now,
      ...(answered ? { decided_at: now, decided_by: actorId, client_note: actor.kind === 'client' ? words : current.client_note } : {}),
      // taken back from the client, or put in front of them again: the old answer no longer stands
      ...(to === 'idea' || to === 'with_client' ? { decided_at: null, decided_by: null, client_note: null } : {}),
    }
  })
  if (!res.claimed) return refusal ?? { ok: false, status: 409, reason: STALE, fresh: res.current }
  await table('campaign_creator_events').insert({
    id: randomUUID(), campaign_id: campaignId, row_id: rowId, from: from ?? '', to, actor: actor.kind, actor_id: actorId, note: words, at: now,
  } as never)
  return { ok: true, value: wholeRow(res.row) }
}

/** Take a creator off a campaign — only while they are still the team's own idea. */
export async function removeCreator(v: Viewer, campaignId: string, rowId: string): Promise<Result<true>> {
  const gate = await editable(v, campaignId)
  if (!gate.ok) return gate
  const current = await onCampaign().get(rowId, { fresh: true })
  if (!current || current.campaign_id !== campaignId) return { ok: false, status: 404, reason: 'That creator is not on this campaign' }
  if (current.stage !== 'idea') return { ok: false, status: 409, reason: 'A creator the client has seen stays on the list. Take them back first.', fresh: wholeRow(current) }
  await onCampaign().remove(rowId)
  return { ok: true, value: true }
}

/** What a client's portal shows for one campaign of theirs — every creator row; `clientSees` (core) does the choosing. */
export async function campaignForClient(clientId: string, campaignId: string): Promise<{ campaign: Campaign; creators: CampaignCreator[] } | null> {
  const found = await campaigns().get(campaignId)
  if (!found || found.client_id !== clientId) return null
  const rows = await onCampaign().list({ where: r => r.campaign_id === campaignId })
  return { campaign: whole(found), creators: rows.map(wholeRow).sort((a, b) => a.name.localeCompare(b.name)) }
}

export async function campaignsOfClient(clientId: string): Promise<{ campaign: Campaign; creators: CampaignCreator[] }[]> {
  const [all, rows] = await Promise.all([campaigns().list({ where: c => c.client_id === clientId }), onCampaign().list({ where: r => r.client_id === clientId })])
  return all.map(whole).map(campaign => ({ campaign, creators: rows.filter(r => r.campaign_id === campaign.id).map(wholeRow) }))
    .sort((a, b) => String(b.campaign.created_at).localeCompare(String(a.campaign.created_at)))
}
