'use client'

/**
 * THE SCHEDULE PAGE'S DATA, LIVE.
 *
 * Every row the calendar draws comes from a Realtime Database listener, not
 * from a fetch: a post that somebody approves, queues or cancels in another
 * tab has to appear on this week without anyone pressing anything. That is
 * the same discipline `useLiveWork` brought to the three boards, applied to
 * the tables a post is made of:
 *
 *   social_posts    the tiles
 *   content_items   what the post IS, and whether the client approved it
 *   publish_jobs    whether it went out
 *   asset_versions  the media a post can be made from
 *   social_accounts the client's channels — the avatars in the profiles bar
 *   schedule_notes  the team's own notes pinned to a day
 *   batches, work_kinds, team_user_clients   what this viewer may see
 *
 * NOTHING HERE DECIDES ANYTHING. The join — this post's jobs, the status it
 * wears, the networks it goes to, what is blocking it — is `postTileFacts` in
 * `social-schedule-core`, pure and tested. What this viewer may see is
 * `scope-client`'s `visibleItems` with the shared `scopeContextOf`, the same
 * pair the items API and the boards use. This file subscribes and assembles.
 */

import { useMemo } from 'react'
import { useTable } from '@/lib/db-client'
import type {
  AssetVersion, Batch, Client, ContentItem, PublishJob, ScheduleNote,
  SocialAccount, SocialPost, TeamUserClient, WorkKind,
} from '@/lib/db-types'
import {
  clientSignsOffEveryPost, coverForSlide, mayPostWithoutApproval, postingEligibility,
  postTileFacts, type SocialPostStatus, type TileJob, type TileTone,
} from '@/app/lib/social-schedule-core'
import { safeZone } from '@/app/lib/timezone-core'
import { isAdHocUploadVersion } from '@/app/lib/schedule-upload-core'
import {
  accessibleClientIdsOf, scopeContextOf, visibleItems, type ScopeViewer,
} from '@/app/lib/scope-client'
import { slidesOf, type Slide } from '@/app/lib/version-files-core'

/** A post as the calendar draws it: the row, its media, and the status, tone
 *  and networks the core gives it once the item and the jobs are read too. */
export type SchedulePostRow = SocialPost & {
  slides: Slide[]
  /** the account ids the row stores — what the channel filter matches on */
  channels: string[]
  /** the NETWORKS those accounts are on — what a logo is drawn from */
  platforms: string[]
  publish_job_ids: string[]
  live_status: SocialPostStatus
  tone: TileTone
  item_title: string | null
  item_type: string | null
  /** the one sentence the server would refuse to post with, or null */
  block_reason: string | null
}

/** One card in the media rail: an approved item's media, or the plain reason
 *  it cannot start a post yet. */
export type RailMedia = {
  itemId: string
  title: string
  contentType: string
  slides: Slide[]
  cover: Slide | null
  /** may this start a post */
  ok: boolean
  /** why not, in the words a person would use */
  reason: string | null
  /**
   * Usable, but the client has not seen it yet.
   *
   * Only ever true for an account manager or a super admin: they may post it
   * (the app does the sign-off for them when it goes out), and the card wears
   * a quiet marker so they know what they are posting. Never a block.
   */
  needsClientApproval: boolean
  /**
   * The client said yes to this media — so editing it into a different
   * picture is something they would have to see again.
   *
   * False for a piece uploaded straight on the Schedule page (made silently,
   * the client never asked) and for media a manager is posting before the
   * client has seen it. The image editor's footer is written from this.
   */
  clientApproved: boolean
  /** where the piece is in the funnel — what says whether a manager may sign
   *  it off without the client from here */
  status: string
  /** the version the client would be approving, for the question they are
   *  asked before one is skipped */
  versionNumber: number | null
  /** does THIS CLIENT sign every post off (`clients.client_approval_required`)
   *  — the one client the short cut does not exist on, for anybody */
  clientSignsOff: boolean
  /** a post already uses this item — one post, one item */
  used: boolean
  /**
   * Every file this piece has EVER held, across every version.
   *
   * Not decoration: it is how the composer tells "somebody brought a new file
   * in" from "somebody dragged slide 3 to the front". Judging that against the
   * APPROVED files alone said "all new" the moment the piece went back to the
   * client, and every reorder after that made another version.
   */
  knownUrls: string[]
  /**
   * The cover picture somebody chose in the image editor, if they did.
   *
   * Not the same thing as `cover` above, which is the tile's thumbnail — this
   * is the frame that goes OUT with a video, saved on the version and sent as
   * the post's `thumbnailUrl`. It is here so the composer can say the cover is
   * already set rather than showing an empty box next to a decision somebody
   * already made.
   */
  coverUrl: string | null
  updatedAt: string
}

const asArray = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : [])

/** The statuses that mean the work is sitting with someone for approval —
 *  the rail's footer count. */
const WAITING_STATUSES = ['client_review', 'internal_review']

export type ScheduleData = {
  /** the clients this person may pick between, by name */
  clients: Client[]
  client: Client | null
  /** the client's zone — every day key and every time on the page is in it */
  tz: string
  posts: SchedulePostRow[]
  notes: ScheduleNote[]
  accounts: SocialAccount[]
  media: RailMedia[]
  /** this client signs every post off themselves — nobody skips the wait */
  clientSignsOff: boolean
  /** …and so this viewer may post with no approval step in the way */
  postWithoutApproval: boolean
  /** how many pieces are still with someone for approval */
  waiting: number
  loading: boolean
  error: string | null
}

/**
 * Everything the Schedule page draws, for one client.
 *
 * `clientId` may be null before a client is picked: the client list and the
 * viewer's scope are still worked out, so the picker can be drawn, and the
 * per-client listeners simply return nothing.
 */
export function useSchedulePosts(
  viewer: ScopeViewer | null,
  clientId: string | null,
): ScheduleData {
  const byClient = useMemo(() => ({ client_id: clientId ?? '' }), [clientId])
  const on = Boolean(clientId)

  const posts = useTable<SocialPost>('social_posts', { by: byClient, enabled: on })
  // `client_id` is an indexed column, so this is one client's items rather
  // than a live subscription to every client's work in every browser
  const items = useTable<ContentItem>('content_items', { by: byClient, enabled: on })
  const jobs = useTable<PublishJob>('publish_jobs', { by: byClient, enabled: on })
  // `asset_versions` carries no client_id, so it cannot be narrowed the same
  // way — the boards read it whole today (`useLiveWork.ts`'s `versions`), and
  // this follows that precedent rather than inventing a second answer
  const versions = useTable<AssetVersion>('asset_versions', { enabled: on })
  const accounts = useTable<SocialAccount>('social_accounts', { by: byClient, enabled: on })
  const notes = useTable<ScheduleNote>('schedule_notes', { by: byClient, enabled: on })
  const clients = useTable<Client>('clients')
  const assignments = useTable<TeamUserClient>('team_user_clients')
  // the two the scope context needs: a shoot opens the items under it, and a
  // work kind is how a shoot plan is told apart from a piece of content
  const batches = useTable<Batch>('batches', { enabled: on })
  const workKinds = useTable<WorkKind>('work_kinds', { enabled: on })

  /** the items this viewer may see at all — the items API's own predicate,
   *  with the items API's own context (`tests/scope-client.test.ts` pins the
   *  predicate; `scopeContextOf` is what stops the context drifting) */
  const scopedItems = useMemo(() => {
    if (!viewer || !clientId) return []
    return visibleItems(
      viewer,
      items.rows as unknown as (ContentItem & { work_kinds?: null })[],
      assignments.rows,
      scopeContextOf({
        viewer,
        batches: batches.rows,
        workKinds: workKinds.rows,
      }),
    ).filter(i => i.client_id === clientId)
  }, [viewer, items.rows, assignments.rows, batches.rows, workKinds.rows, clientId])

  const itemById = useMemo(
    () => new Map(scopedItems.map(i => [i.id, i])), [scopedItems])

  /** every version of every item on screen, newest first inside each item */
  const versionsByItem = useMemo(() => {
    const out = new Map<string, AssetVersion[]>()
    for (const v of versions.rows) {
      if (!itemById.has(v.item_id)) continue
      const list = out.get(v.item_id) ?? []
      list.push(v)
      out.set(v.item_id, list)
    }
    return out
  }, [versions.rows, itemById])

  /** the client list this person may pick between: the clients they are on,
   *  plus any client an assignment already opened an item of for them */
  const pickable = useMemo(() => {
    if (!viewer) return []
    const base = accessibleClientIdsOf(viewer, assignments.rows)
    const rows = base === null
      ? clients.rows
      : clients.rows.filter(c => base.includes(c.id))
    return rows
      .filter(c => c.status !== 'archived')
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [viewer, clients.rows, assignments.rows])

  const client = useMemo(
    () => clients.rows.find(c => c.id === clientId) ?? null, [clients.rows, clientId])
  const tz = safeZone(client?.timezone ?? null)

  /**
   * This client's channels. Filtered by client_id in memory as well as by the
   * listener's key: a listener re-keys one render AFTER the client changes,
   * and a frame of the previous client's rows under the new client's name is
   * a small lie this page can do without.
   *
   * TWO lists, on purpose. The profiles bar and the composer offer only
   * channels that WORK (`liveAccounts`), because offering a revoked one is
   * offering something that cannot happen. The tiles are drawn from all of
   * them, because a post already booked onto a channel that has since been
   * revoked has to be able to SAY so — and a tile drawn from the live-only
   * list would simply lose the logo and show nothing wrong.
   */
  const clientAccounts = useMemo(
    () => accounts.rows.filter(a => a.client_id === clientId),
    [accounts.rows, clientId])
  const liveAccounts = useMemo(
    () => clientAccounts.filter(a => a.active), [clientAccounts])

  /** the tiles — each carrying the status the CORE gives it, never the stored
   *  one on its own: an approval or a job may have moved since it was written */
  const tiles: SchedulePostRow[] = useMemo(() => {
    const jobsById = new Map<string, TileJob>(
      jobs.rows.filter(j => j.client_id === clientId).map(j => [j.id, j as TileJob]))
    return posts.rows
      .filter(row => row.client_id === clientId)
      // A post whose ITEM this person may not see is not drawn at all. Drawing
      // it anyway showed the media and the time off the post row while
      // `mirrorStatus(null, …)` called a scheduled post a draft — a tile that
      // is wrong twice over, on work that was not this person's to look at.
      .filter(row => itemById.has(row.item_id))
      .map(row => {
        const item = itemById.get(row.item_id)!
        const facts = postTileFacts(row, item, jobsById, clientAccounts)
        return {
          ...row,
          slides: asArray<Slide>(row.slides),
          channels: asArray<string>(row.channels).map(String),
          publish_job_ids: asArray<string>(row.publish_job_ids).map(String),
          item_title: (item.title as string | null) ?? null,
          item_type: (item.content_type as string | null) ?? null,
          ...facts,
        }
      })
      .sort((a, b) => String(a.scheduled_for ?? '').localeCompare(String(b.scheduled_for ?? '')))
  }, [posts.rows, jobs.rows, itemById, liveAccounts, clientId])

  /**
   * DOES THIS CLIENT SIGN EVERY POST OFF, AND MAY THIS PERSON SKIP THE WAIT?
   *
   * Two questions the rail, the pickers and the composer all ask, answered
   * once here so they cannot disagree with each other — or with the server,
   * which asks the same pair of pure functions of the same two rows.
   */
  const clientSignsOff = clientSignsOffEveryPost(client)
  const postWithoutApproval = mayPostWithoutApproval(viewer?.role ?? null, clientSignsOff)

  /** the media rail: one card per item, ready-to-use first */
  const media: RailMedia[] = useMemo(() => {
    const usedItems = new Set(posts.rows.map(p => p.item_id))
    return scopedItems
      .map(item => {
        const itemVersions = versionsByItem.get(item.id) ?? []
        const elig = postingEligibility(item, itemVersions, postWithoutApproval)
        const slides = elig.ok ? elig.slides : []
        return {
          itemId: item.id,
          title: item.title,
          contentType: String(item.content_type ?? ''),
          slides,
          cover: slides[0] ?? coverOf(itemVersions),
          ok: elig.ok,
          reason: elig.ok ? null : elig.reason,
          needsClientApproval: elig.ok && elig.needsClientApproval,
          clientApproved: elig.ok && !elig.needsClientApproval
            && !itemVersions.some(isAdHocUploadVersion),
          status: String(item.status ?? ''),
          clientSignsOff,
          versionNumber: itemVersions.reduce(
            (best, v) => Math.max(best, Number(v?.version_number ?? 0)), 0) || null,
          used: usedItems.has(item.id),
          knownUrls: [...new Set(itemVersions.flatMap(v => slidesOf(v).map(sl => sl.url)))],
          coverUrl: coverForSlide(slides[0]?.url, itemVersions),
          updatedAt: String(item.updated_at ?? ''),
        }
      })
      .sort((a, b) =>
        Number(b.ok) - Number(a.ok) || b.updatedAt.localeCompare(a.updatedAt))
  }, [scopedItems, versionsByItem, posts.rows, postWithoutApproval, clientSignsOff])

  const waiting = useMemo(
    () => scopedItems.filter(i => WAITING_STATUSES.includes(String(i.status))).length,
    [scopedItems])

  // The page waits only on what the tiles are made of. Versions and accounts
  // decorate the rail and the badges; a missing one leaves a card plain
  // rather than the week blank.
  const loading = viewer === null
    || clients.loading
    || (on && (posts.loading || items.loading || jobs.loading))

  // A listener that could not read is a FAILURE, not an empty week — an empty
  // calendar drawn over a dropped subscription looks like an answer.
  const error = posts.error || items.error || jobs.error || clients.error || null

  return useMemo(() => ({
    clients: pickable,
    client,
    tz,
    posts: tiles,
    notes: notes.rows.filter(n => n.client_id === clientId),
    accounts: liveAccounts,
    media,
    clientSignsOff,
    postWithoutApproval,
    waiting,
    loading,
    error,
  }), [
    pickable, client, tz, tiles, notes.rows, liveAccounts, media,
    clientSignsOff, postWithoutApproval, waiting, loading, error, clientId,
  ])
}

/** Something to show for an item with no publishable media: the newest
 *  version's first file, so the card is not an empty grey square. */
function coverOf(versions: AssetVersion[]): Slide | null {
  const newest = [...versions].sort(
    (a, b) => Number(b.version_number ?? 0) - Number(a.version_number ?? 0))[0]
  return newest ? slidesOf(newest)[0] ?? null : null
}
