'use client'

/**
 * THE SCHEDULE PAGE'S DATA, LIVE.
 *
 * Every row the calendar draws comes from a Realtime Database listener, not
 * from a fetch: a post that somebody books, moves or cancels in another tab
 * has to appear on this week without anyone pressing anything.
 *
 *   social_posts    the tiles — each read by `readPostState`, off its own STAGE
 *   content_items   the media rail, and a post's title
 *   asset_versions  the media a post can be made from
 *   social_accounts the client's channels — the avatars in the profiles bar
 *   schedule_notes  the team's own notes pinned to a day
 *   batches, work_kinds, team_user_clients   what this viewer may see
 *
 * WHERE A POST STANDS IS `social_posts.stage` AND NOTHING ELSE (the posting
 * rebuild, 29 Sep 2026). The old join worked a tile's state out of the edit
 * card's `posting_approval_state` and the publish jobs, and drew a draft
 * nobody approved as green "Approved" (audit S2) and a live post as not
 * posted (audit S5). No edit card, no job and no `status` column is read to
 * decide anything here: the words, the colours and the buttons all come from
 * `post-stage-core`, through `schedule-stage-core`.
 *
 * NOTHING HERE DECIDES ANYTHING. What this viewer may see is `scope-client`'s
 * `visibleItems` with the shared `scopeContextOf`, the same pair the items API
 * and the boards use. This file subscribes and assembles.
 */

import { DELIVER_ONLY_REASON, deliverOnly } from '@/app/lib/deliver-only-core'
import { folderOf } from '@/app/lib/card-link-core'
import { useMemo, useRef, useState } from 'react'
import { useTable } from '@/lib/db-client'
import type {
  AssetVersion, Batch, BatchComment, Client, ClientContact, ContentItem, ItemComment, ScheduleNote,
  SocialAccount, SocialPost, TeamUserClient, WorkflowActivity, WorkKind,
} from '@/lib/db-types'
import {
  assetsApprovedOnBoard, clientSignsOffEveryPost, coverForSlide, mayPostWithoutApproval, postingEligibility, type Eligibility,
  postPlatforms,
} from '@/app/lib/social-schedule-core'
import {
  anyNetworkLive, hatsFor, readPostState,
  type AccountRef, type OfferedAction, type PostStage, type PostState, type Viewer,
} from '@/app/lib/post-stage-core'
import { binAction, moveBlockReason, scheduleFacts, type ScheduleFacts } from '@/app/lib/schedule-stage-core'
import { safeZone } from '@/app/lib/timezone-core'
import { isAdHocUploadVersion } from '@/app/lib/schedule-upload-core'
import {
  accessibleClientIdsOf, scopeContextOf, visibleItems, type ScopeViewer,
} from '@/app/lib/scope-client'
import { slidesOf, type Slide } from '@/app/lib/version-files-core'
import { postedLine, readPostedSlides, remainingSlides, takenSlideUrls } from '@/app/lib/posted-slides-core'

/**
 * A post as the calendar draws it: the row, the typed stage the rules read,
 * and what the page says about it NOW (the page's minute clock feeds `facts`,
 * so a time missed while the page is open shows as missed — audit S12).
 */
export type SchedulePostRow = Omit<SocialPost, 'slides' | 'channels' | 'publish_job_ids' | 'outcomes' | 'source_deleted'> & {
  /** the post as `post-stage-core` reads it — the one source of truth */
  state: PostState
  /** `state.stage`, lifted for the views and the filters */
  stage: PostStage
  slides: Slide[]
  /** the account ids the row stores — what the channel filter matches on */
  channels: string[]
  /** the NETWORKS those accounts are on — every one gets a logo (audit S14) */
  platforms: string[]
  /** the edit card's title, or the caption's first words when there is no card */
  item_title: string | null
  item_type: string | null
  /** the edit card this came from was deleted — the post still shows (audit S9) */
  source_deleted: boolean
  /** words, colour, missed, alerts, per-network lines — worked out at `now` */
  facts: ScheduleFacts
  /** the sentence that stops a drag to a new time, or null (from `postActions`) */
  move_block: string | null
  /** the bin: "Delete draft" on a never-sent draft, "Cancel post" elsewhere, or null */
  bin: OfferedAction | null
  /** the booked jobs, from `booking.job_ids` */
  publish_job_ids: string[]
}

/** One card in the media rail: an approved item's media, or the plain reason
 *  it cannot start a post yet. */
export type RailMedia = {
  itemId: string
  /** whom the piece is for: null for the business, a contact's id for a person (15 Sep 2026) */
  forContactId?: string | null
  title: string
  contentType: string
  slides: Slide[]
  cover: Slide | null
  /** may this start a post */
  ok: boolean
  /** why not, in the words a person would use */
  reason: string | null
  /**
   * Usable, but the client has not seen the EDIT yet.
   *
   * Only ever true for an account manager or a super admin. The card wears a
   * quiet marker so they know what they are making a post of. Never a block,
   * and never an approval: the post itself still goes through the quality
   * check (the owner's decision 3).
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
  /** where the piece is in the funnel */
  status: string
  /** the pieces were approved ON THE BOARD (Draft → Internal check → With
   *  client → Ready to post). False for a file uploaded straight onto Schedule. */
  boardApproved: boolean
  /** the version the client would be approving */
  versionNumber: number | null
  /** does THIS CLIENT sign every post off (`clients.client_approval_required`) */
  clientSignsOff: boolean
  /** every file of this piece is in a post already */
  used: boolean
  /**
   * A post made from this piece is Booked in, or has gone out on a network:
   * the piece cannot be removed until its posts come off the schedule
   * (SPEC §4.3). The Remove button still shows, with that reason beside it.
   */
  holdsBooking?: boolean
  /** "2 of 4 posted" while a piece is part-way out (posted-slides-core) */
  posted: string | null
  /** the Drive folder a scheduler was handed to post from (the card's link),
   *  when the card carries one — the post window's Drive tab opens on it */
  driveFolderUrl?: string | null
  /**
   * Every file this piece has EVER held, across every version.
   *
   * Not decoration: it is how the composer tells "somebody brought a new file
   * in" from "somebody dragged slide 3 to the front".
   */
  knownUrls: string[]
  /**
   * The cover picture somebody chose in the image editor, if they did — the
   * frame that goes OUT with a video, sent as the post's `thumbnailUrl`.
   */
  coverUrl: string | null
  updatedAt: string
}

const asArray = <T,>(v: unknown): T[] =>
  (Array.isArray(v) ? (v as T[]) : v && typeof v === 'object' ? (Object.values(v) as T[]) : [])

export type ScheduleData = {
  /** the clients this person may pick between, by name */
  clients: Client[]
  client: Client | null
  /** the client's zone — every day key and every time on the page is in it */
  tz: string
  /** every post of this client that has a stage — the views choose which to draw */
  posts: SchedulePostRow[]
  notes: ScheduleNote[]
  accounts: SocialAccount[]
  allAccounts: SocialAccount[]
  /** the client's people — a connection can be one of theirs (15 Sep 2026) */
  contacts: ClientContact[]
  media: RailMedia[]
  /** this client signs every post off themselves (clients.client_approval_required) */
  clientSignsOff: boolean
  /** …and so this viewer may use media the client has not signed off yet */
  postWithoutApproval: boolean
  /** posts still being approved — they live on Post approval; this page only counts them */
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
 *
 * `now` is the page's clock. Pass the minute tick: the words a tile wears
 * ("Missed — needs a new time") depend on it, and a clock read once when the
 * data loaded froze them (audit S12). A caller with no clock gets the time of
 * its render.
 */
export function useSchedulePosts(
  viewer: (ScopeViewer & Viewer) | null,
  clientId: string | null,
  now?: number,
): ScheduleData {
  // no clock given: the time of the first render, held — a fresh Date.now()
  // on every render would make every row new on every render
  const [mounted] = useState(() => Date.now())
  const clock = now ?? mounted
  const byClient = useMemo(() => ({ client_id: clientId ?? '' }), [clientId])
  const on = Boolean(clientId)

  const posts = useTable<SocialPost>('social_posts', { by: byClient, enabled: on })
  // `client_id` is an indexed column, so this is one client's items rather
  // than a live subscription to every client's work in every browser
  const items = useTable<ContentItem>('content_items', { by: byClient, enabled: on })
  // `asset_versions` carries no client_id, so it cannot be narrowed the same
  // way — the boards read it whole today (`useLiveWork.ts`'s `versions`), and
  // this follows that precedent rather than inventing a second answer
  const versions = useTable<AssetVersion>('asset_versions', { enabled: on })
  const accounts = useTable<SocialAccount>('social_accounts', { by: byClient, enabled: on })
  const contacts = useTable<ClientContact>('client_contacts', { by: byClient, enabled: on })
  const notes = useTable<ScheduleNote>('schedule_notes', { by: byClient, enabled: on })
  const clients = useTable<Client>('clients')
  const assignments = useTable<TeamUserClient>('team_user_clients')
  // the two the scope context needs: a shoot opens the items under it, and a
  // work kind is how a shoot plan is told apart from a piece of content
  const batches = useTable<Batch>('batches', { enabled: on })
  const workKinds = useTable<WorkKind>('work_kinds', { enabled: on })
  // and the grants — tags and creation — read off the same tables the
  // boards hold, or an editor sees less here than on their own board
  const itemComments = useTable<ItemComment>('item_comments', { enabled: on })
  const batchComments = useTable<BatchComment>('batch_comments', { enabled: on })
  const activity = useTable<WorkflowActivity>('workflow_activity', { enabled: on })

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
        itemComments: itemComments.rows,
        batchComments: batchComments.rows,
        activity: activity.rows,
        workKinds: workKinds.rows,
        clients: clients.rows,
      }),
    ).filter(i => i.client_id === clientId)
      // a shoot plan is a plan for a shoot, not something to post: it has no
      // files and was showing in the rail as "No media yet" (the owner, 9 Sep
      // 2026: "why does the super admin see August 2026 as no media yet")
      .filter(i => (workKinds.rows.find(k => k.id === i.work_kind_id)?.slug ?? '') !== 'shoot_brief')
  }, [viewer, items.rows, assignments.rows, batches.rows, itemComments.rows, batchComments.rows, activity.rows, workKinds.rows, clientId])

  const itemById = useMemo(
    () => new Map(scopedItems.map(i => [i.id, i])), [scopedItems])

  /** every edit card of this client, visible or not — to tell "deleted" from "not yours to see" */
  const clientItemIds = useMemo(
    () => new Set(items.rows.filter(i => i.client_id === clientId).map(i => i.id)), [items.rows, clientId])

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
   * offering something that cannot happen. The tiles are read against all of
   * them, because a post already booked onto a channel that has since been
   * revoked has to be able to SAY so, in red, not only in a hover (audit S13).
   */
  const clientAccounts = useMemo(
    () => accounts.rows.filter(a => a.client_id === clientId),
    [accounts.rows, clientId])
  const liveAccounts = useMemo(
    () => clientAccounts.filter(a => a.active), [clientAccounts])

  /** the channels as the rules read them: connected or not, by network */
  const accountRefs: AccountRef[] = useMemo(
    () => clientAccounts.map(a => ({
      id: a.id,
      platform: String(a.platform ?? ''),
      live: a.active !== false,
      name: (a as { name?: string | null }).name ?? null,
    })),
    [clientAccounts])

  /** the posts, typed once — the time-free half, so the clock tick does not re-read every row */
  const typed = useMemo(() => {
    const out: { row: SocialPost; state: PostState }[] = []
    for (const row of posts.rows) {
      if (row.client_id !== clientId) continue
      // a row the migration has not given a stage yet is not drawn: guessing
      // one from its old columns is the bug this rebuild removes
      const state = readPostState(row as unknown as Record<string, unknown>)
      if (!state) continue
      // A POST IS SCOPED BY ITS OWN CLIENT, never by whether its edit card is
      // visible to this person (review fix, 29 Sep 2026; SPEC §1.3): the client
      // picker already holds only this person's clients, and the server asks the
      // same question (`mayActOn`). The card is a title and a file source — a
      // scheduler's upload is still on the calendar for the next scheduler, and a
      // deleted card hides nothing (audit S9)
      out.push({ row, state })
    }
    return out
  }, [posts.rows, clientId])

  /**
   * The rows handed out last time, by post id. The clock ticks every minute,
   * and a row object that is new every minute is a post window that re-seeds
   * itself under somebody's typing (audit W1). So a row whose post, card and
   * words have not changed is handed back as the SAME object, and the list as
   * the same array.
   */
  const lastRows = useRef<{ list: SchedulePostRow[]; byId: Map<string, { sig: string; raw: SocialPost; row: SchedulePostRow }> }>({ list: [], byId: new Map() })

  /** the tiles, at `now` — the clock is a dependency on purpose: "Missed" has to appear the minute it becomes true */
  const tiles: SchedulePostRow[] = useMemo(() => {
    const fresh = typed.map(({ row, state }) => {
      const item = state.source_item_id ? itemById.get(state.source_item_id) ?? null : null
      const hats = hatsFor(viewer, state)
      const firstLine = state.caption.trim().split('\n')[0]?.slice(0, 60) || null
      const cardGone = !!state.source_item_id && !items.loading && !clientItemIds.has(state.source_item_id)
      return {
        ...row,
        state,
        stage: state.stage,
        slides: state.slides,
        channels: state.channels,
        platforms: postPlatforms(state.channels, clientAccounts),
        item_title: (item?.title as string | null | undefined) || firstLine,
        item_type: (item?.content_type as string | null | undefined) ?? null,
        source_deleted: state.source_deleted || cardGone,
        facts: scheduleFacts(state, accountRefs, clock),
        move_block: moveBlockReason(state, hats, clock),
        bin: binAction(state, hats, clock),
        publish_job_ids: state.booking?.job_ids ?? [],
      } satisfies SchedulePostRow
    })
      .sort((a, b) => String(a.scheduled_for ?? '').localeCompare(String(b.scheduled_for ?? '')))

    const byId = new Map<string, { sig: string; raw: SocialPost; row: SchedulePostRow }>()
    let same = fresh.length === lastRows.current.list.length
    const list = fresh.map((row, i) => {
      const raw = typed.find(t => t.state.id === row.state.id)!.row
      const sig = JSON.stringify([row.facts, row.move_block, row.bin, row.platforms, row.item_title, row.item_type, row.source_deleted])
      const prev = lastRows.current.byId.get(row.state.id)
      const keep = prev && prev.raw === raw && prev.sig === sig ? prev.row : row
      if (keep !== lastRows.current.list[i]) same = false
      byId.set(row.state.id, { sig, raw, row: keep })
      return keep
    })
    const out = same ? lastRows.current.list : list
    lastRows.current = { list: out, byId }
    return out
  }, [typed, itemById, clientItemIds, items.loading, clientAccounts, accountRefs, viewer, clock])

  /**
   * MAY THIS PERSON USE MEDIA THE CLIENT HAS NOT SIGNED OFF YET?
   *
   * About the EDIT only — which pieces the rail offers to make a post from.
   * It never approves a post: every post still goes through the quality check.
   */
  const clientSignsOff = clientSignsOffEveryPost(client)
  const postWithoutApproval = mayPostWithoutApproval(viewer?.role ?? null, clientSignsOff)

  /** the media rail: one card per item, ready-to-use first */
  const media: RailMedia[] = useMemo(() => {
    return scopedItems
      .map(item => {
        const itemVersions = versionsByItem.get(item.id) ?? []
        // DELIVER ONLY (11 Sep 2026): the client posts this themselves — it
        // is delivered, never booked from here
        const elig: Eligibility = deliverOnly(item as { deliver_only?: unknown }, client as { posts_own_content?: unknown } | null)
          ? { ok: false, reason: DELIVER_ONLY_REASON }
          : postingEligibility(item, itemVersions, postWithoutApproval)
        // A PIECE POSTED IN PARTS (9 Sep 2026): a file already held by a post
        // — by that post's STAGE, never its old status (audit S6) — or marked
        // posted by hand, is not offered again
        const own = posts.rows.filter(p => (p.source_item_id ?? p.item_id) === item.id)
        const gone = takenSlideUrls(own)
        for (const u of readPostedSlides((item as { posted_slides?: unknown }).posted_slides)?.urls ?? []) gone.add(u)
        const slides = elig.ok ? remainingSlides(elig.slides, gone) : []
        const holdsBooking = own.some(p => {
          const st = readPostState(p as unknown as Record<string, unknown>)
          return !!st && (st.stage === 'booked' || anyNetworkLive(st))
        })
        return {
          itemId: item.id,
          forContactId: (item as { for_contact_id?: string | null }).for_contact_id ?? null,
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
          boardApproved: assetsApprovedOnBoard(item),
          clientSignsOff,
          versionNumber: itemVersions.reduce(
            (best, v) => Math.max(best, Number(v?.version_number ?? 0)), 0) || null,
          // "used" means nothing left to post — every file is in a post
          used: elig.ok && elig.slides.length > 0 && slides.length === 0,
          holdsBooking,
          posted: postedLine(readPostedSlides((item as { posted_slides?: unknown }).posted_slides)),
          driveFolderUrl: folderOf(item as Parameters<typeof folderOf>[0])?.kind === 'drive' ? folderOf(item as Parameters<typeof folderOf>[0])!.url : null,
          knownUrls: [...new Set(itemVersions.flatMap(v => slidesOf(v).map(sl => sl.url)))],
          coverUrl: coverForSlide(slides[0]?.url, itemVersions),
          updatedAt: String(item.updated_at ?? ''),
        }
      })
      .sort((a, b) =>
        Number(b.ok) - Number(a.ok) || b.updatedAt.localeCompare(a.updatedAt))
  }, [scopedItems, versionsByItem, posts.rows, postWithoutApproval, clientSignsOff, client])

  /** posts still being approved — they live on Post approval; this page only counts them */
  const waiting = useMemo(
    () => tiles.filter(p => p.stage === 'quality_check' || p.stage === 'with_client').length,
    [tiles])

  // The page waits only on what the tiles are made of. Versions and accounts
  // decorate the rail and the badges; a missing one leaves a card plain
  // rather than the week blank.
  const loading = viewer === null
    || clients.loading
    || (on && (posts.loading || items.loading))

  // A listener that could not read is a FAILURE, not an empty week — an empty
  // calendar drawn over a dropped subscription looks like an answer.
  const error = posts.error || items.error || clients.error || null

  return useMemo(() => ({
    clients: pickable,
    client,
    tz,
    posts: tiles,
    notes: notes.rows.filter(n => n.client_id === clientId),
    accounts: liveAccounts,
    /** every account on the client, revoked ones included — for the bar */
    allAccounts: clientAccounts,
    contacts: contacts.rows,
    media,
    clientSignsOff,
    postWithoutApproval,
    waiting,
    loading,
    error,
  }), [
    pickable, client, tz, tiles, notes.rows, liveAccounts, clientAccounts, contacts.rows, media,
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
