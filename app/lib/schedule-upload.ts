import 'server-only'
import { randomUUID } from 'node:crypto'
import { table } from '@/lib/db'
import type { AssetVersion, Client, ContentItem } from '@/lib/db-types'
import { AuthzError, type TeamUser } from './authz'
import { announceItemChange } from './production-live'
import { mayPostStraightOut } from './social-schedule'
import { onItemsCreated } from './gdrive-hooks'
import { mirrorVersionSlides } from './gdrive-mirror'
import { previewVideos } from './stream'
import { addVersion, logActivity, performTransition } from './workflow'
import { actingRoles } from './workflow-core'
import { resolveKindForWrite, type WorkKind } from './work-kinds-core'
import {
  clientSignsOffEveryPost, mayPostWithoutApproval, CLIENT_POLICY_UNREADABLE,
} from './social-schedule-core'
import {
  assertClientAccess, ComposeError, startPostOnItem, type PlannedPost,
} from './social-schedule'
import { headStoredObject, publicBase, MAX_DERIVED_BYTES } from './storage'
import { MAX_STORED_FILE_BYTES, ourStorageUrl, storedFileIsUsable } from './storage-core'
import { normaliseSlides, slidesSatisfyType, type Slide } from './version-files-core'
import { UPLOAD_ADHOC_REASON, contentTypeForFiles, titleForUpload } from './schedule-upload-core'

/**
 * A POST FROM A FILE, WITH NO PIECE IN THE WAY.
 *
 * The rule the Schedule page was built on was "a post hangs off a piece of
 * work, and a piece of work comes from Production". True, and useless to the
 * person who has the photo on their laptop and a client expecting it up by
 * five: with no pieces in the database there was nothing in the rail, nothing
 * in the chooser and nothing to drag, and the feature read as missing.
 *
 * So the piece is still there — the version numbering, the Drive mirror, the
 * client portal and the publish planner all key off it — but it is MADE FOR
 * THEM, out of the file they picked, and they never see the word.
 *
 * What lands is an ordinary item: the same work kind, the same ad-hoc
 * (no-shoot) shape with its reason recorded, `draft_uploaded` at birth and
 * then moved forward on the ORDINARY edges, as this person. Opened in
 * Production later it is indistinguishable from one somebody typed in — that
 * is the test this file is written to pass.
 *
 * The approval question is answered by the same machinery as everywhere else
 * (`mayPostWithoutApproval` + `performTransition`), never by a second rule
 * living here:
 *
 *   • an account manager or a super admin — on any client, lock or no lock
 *     (the owner, 9 Sep 2026) — gets the piece carried to `approved_for_scheduling` on
 *     the ordinary "Approve without client" edge, recorded against them. Their
 *     post can go out at once, and `scheduleWithoutApproval` has nothing left
 *     to do for the media;
 *   • everybody else gets the piece left at `internal_review`, which is what
 *     "waiting for the manager's check" already means. The post exists, holds
 *     the media and cannot be sent — exactly the position an uploaded file was
 *     in before this change, minus the dead end.
 */

/* ── what a caller may hand over ────────────────────────────────────────── */

export type UploadPostInput = {
  client_id: string
  /** the slides — files already in OUR storage (an upload, or a Drive file
   *  already copied across by `/api/social/schedule/drive`) */
  files: unknown
  caption?: string | null
  scheduled_for?: string | null
  timezone?: string | null
  /** what to call the piece; derived from the file name when absent */
  title?: string | null
  /**
   * WHAT HAPPENS TO THE PIECE THE MOMENT IT IS UPLOADED (Post approval page,
   * 8 Sep 2026 — "make it simple"):
   *   'ask'     → Internal check, the named people are asked (anybody)
   *   'approve' → Ready to post, in this person's name (managers only)
   *   'client'  → With client (managers only)
   *   absent    → a manager's is approved as before; anybody else's waits in
   *               Draft for them to send it from the composer
   */
  decision?: 'ask' | 'approve' | 'client' | null
  /** who is asked, for 'ask' */
  reviewer_ids?: unknown
  /** a line for whoever is asked, or for the client */
  note?: string | null
}

export type UploadPostResult = {
  post: PlannedPost
  item: ContentItem
  version_number: number
  /** does this post still need somebody's approval before it can go out? */
  needs_approval: boolean
  /** the one sentence to show */
  message: string
}

export { UPLOAD_ADHOC_REASON }

/**
 * The biggest file this path will accept onto a post: what the storage takes.
 *
 * This was a 1 GB ceiling of its own, from before the smaller-copy flow, on
 * the theory that a bigger video "would fail at the provider hours later".
 * It no longer would: YouTube and TikTok take a multi-GB master, and every
 * other channel is handed a smaller copy made for it — the 5:50 pm post on
 * 8 Sep 2026 went out to all four from a 2 GB file. What the ceiling did on
 * 9 Sep was refuse the owner's 1.4 GB C6437.MP4 the moment it finished
 * uploading, which is the opposite of help. Whether a network takes a file
 * is answered per channel (media-fit-core, the composer's own check), not
 * by a second number here.
 */
export const MAX_POST_FILE_BYTES = MAX_STORED_FILE_BYTES

/* ── the files ──────────────────────────────────────────────────────────── */

/**
 * Every file, checked against our own storage before anything is written.
 *
 * A URL is not a file. The browser hands back where it says the bytes landed,
 * and this is the only place that can tell the difference between "the file
 * we just signed an upload for" and "any address on the internet" — the same
 * guard the crop save uses, for the same reason: what comes out the other end
 * is published under this agency's name.
 */
async function checkedSlides(files: unknown): Promise<Slide[]> {
  const slides = normaliseSlides(files)
  if (slides.length === 0) throw new ComposeError(['Pick at least one photo or video'])

  const base = publicBase()
  if (!base) {
    throw new ComposeError(['File storage is not set up yet, so a file cannot be posted'], 503)
  }

  for (const slide of slides) {
    const kind = slide.type === 'video' ? 'video' : 'image'
    const ours = ourStorageUrl(slide.url, base, kind)
    if (!ours) {
      throw new ComposeError([
        `${slide.name || 'That file'} is not one of ours — upload it again`,
      ])
    }
    const head = await headStoredObject(ours)
    // a picture is capped where every other derived picture is; a video gets
    // the posting ceiling, which is what a provider will actually take
    const usable = storedFileIsUsable(
      head, kind, kind === 'video' ? MAX_POST_FILE_BYTES : MAX_DERIVED_BYTES)
    if (!usable.ok) throw new ComposeError([`${slide.name || 'That file'}: ${usable.why}`])
  }
  return slides
}

/* ── the client's own policy ────────────────────────────────────────────── */

/** `clients.client_approval_required`, explicitly true — and it FAILS CLOSED,
 *  the same posture `social-schedule.ts` takes: a client we cannot read is a
 *  client we do not post for without asking. */
async function clientSignsOff(clientId: string): Promise<{ client: Client | null; signsOff: boolean }> {
  let client: Client | null
  try {
    client = await table<Client>('clients').get(clientId)
  } catch {
    throw new AuthzError(CLIENT_POLICY_UNREADABLE, 503)
  }
  return { client, signsOff: clientSignsOffEveryPost(client) }
}

/* ── the piece nobody asked for ─────────────────────────────────────────── */

/**
 * Make the backing item, exactly as `NewItemDialog` would.
 *
 * Same work kind resolution (`edit`, or the first active one), same `null`
 * shoot with the reason recorded on the activity line, same `draft_uploaded`
 * birth status and `current_version_number: 0`. The one deliberate difference
 * is the owner: the person uploading owns it, which is what gives them the
 * editor hat on their own upload and lets them move it forward.
 */
async function createBackingItem(
  user: TeamUser, clientId: string, title: string, contentType: string, signsOff: boolean,
): Promise<ContentItem> {
  const kinds = await table<WorkKind>('work_kinds').list().catch(() => [] as WorkKind[])
  const kind = resolveKindForWrite(kinds as WorkKind[], null)
  if (!kind.ok) throw new ComposeError([kind.reason])

  const item = await table<ContentItem>('content_items').insert({
    id: randomUUID(),
    work_kind_id: kind.id,
    client_id: clientId,
    batch_id: null,
    title,
    content_type: contentType,
    platform_targets: [],
    owner_id: user.id,
    assigned_by: null,
    due_date: null,
    priority: 'normal',
    caption: null,
    raw_assets_url: null,
    brief: null,
    raw_assets: [],
    // media uploaded straight onto the Schedule page is not a piece of
    // production work waiting on anyone: the person uploading it is posting
    // it. Whoever may post straight out (a manager, a super admin, and a
    // scheduler for a client who does not sign off) owns it outright; only
    // when the uploader could NOT have approved it does the client's word
    // still stand in the way.
    // THE CLIENT'S OWN RULE, not the uploader's rank (9 Sep 2026). Set from
    // "could this person post straight out", a scheduler's upload was marked
    // as needing the client, and the manager's board then offered only "Send
    // to client" — no Approve — on a client who does not sign every post off.
    client_approval_required: signsOff,
    // a post made on the Schedule page is a POST, not production work: it
    // keeps its card (the file, the versions, the numbers afterwards) but
    // never appears on the Production, Editor or Scheduler boards
    adhoc_post: true,
    status: 'draft_uploaded',
    current_version_number: 0,
  } as unknown as ContentItem)

  await logActivity({
    actor: user, clientId,
    entityType: 'content_item', entityId: item.id,
    action: 'created', newValue: item.title,
    detail: `ad-hoc: ${UPLOAD_ADHOC_REASON}`,
  })
  announceItemChange({
    item_id: item.id, client_id: clientId, status: String(item.status), kind: 'created',
  })
  // a folder per deliverable, in the background and only where the owner has
  // switched auto filing on — `onItemsCreated` refuses by itself otherwise
  onItemsCreated([item as unknown as Parameters<typeof onItemsCreated>[0][number]])
  return item
}

/* ── the whole move ─────────────────────────────────────────────────────── */

export async function createPostFromFiles(
  user: TeamUser, input: UploadPostInput,
): Promise<UploadPostResult> {
  if (user.role === 'client') {
    throw new AuthzError('Only the team can put a post together', 403)
  }
  const clientId = String(input.client_id ?? '').trim()
  if (!clientId) throw new ComposeError(['Pick a client first'])
  await assertClientAccess(user, clientId)

  const { client, signsOff } = await clientSignsOff(clientId)
  if (!client) throw new AuthzError('That client no longer exists', 404)

  const slides = await checkedSlides(input.files)
  const contentType = contentTypeForFiles(slides)
  const shapeProblem = slidesSatisfyType(contentType, slides)
  if (shapeProblem) throw new ComposeError([shapeProblem])

  // a decision this person may not make is refused before a single row is
  // written — a piece nobody wanted is worse than a refusal
  if (input.decision === 'approve' || input.decision === 'client') {
    if (!await mayPostStraightOut(user, { client_id: clientId } as ContentItem)) {
      throw new AuthzError('Only an account manager or a super admin can approve a piece here — send it to one instead', 403)
    }
  }
  if (input.decision === 'ask' && !(Array.isArray(input.reviewer_ids) && input.reviewer_ids.length > 0)) {
    throw new ComposeError(['Pick who should approve it'])
  }

  const title = titleForUpload({
    fileName: slides[0]?.name ?? null,
    caption: input.title ? String(input.title) : (input.caption ?? null),
  })

  const item = await createBackingItem(user, clientId, title, contentType, signsOff)

  // version 1 — the same call the item page's upload makes, so the numbering,
  // the Drive mirror and the video preview all happen as usual
  let version: AssetVersion
  try {
    version = await addVersion(user, item.id, {
      file_url: slides[0].url, files: slides,
      // the note is what tells the Schedule page this piece was never the
      // client's to approve (`isAdHocUploadVersion`)
      notes: UPLOAD_ADHOC_REASON,
    }) as unknown as AssetVersion
  } catch (e) {
    // an item with no version is an orphan on somebody's board; it is not
    // worth leaving behind for a failure that happened one line later
    await table<ContentItem>('content_items').remove(item.id).catch(() => {})
    throw e
  }
  const versionNumber = Number(version.version_number ?? 1)
  mirrorVersionSlides(item.id, versionNumber, slides)
  previewVideos(slides.map(s => s.url))

  /**
   * FORWARD ON THE ORDINARY EDGES, NEVER AROUND THEM.
   *
   * `draft_uploaded → internal_review` is "Submit for review", and it needs a
   * reviewable asset — which the version above is. The person uploading owns
   * the item, so they wear the editor hat on it and may make the move whatever
   * their job title is.
   */
  let current = item
  /* THE PROPER FLOW (8 Sep 2026, final). A manager's upload clears itself
   * below. A scheduler's stays at `draft_uploaded` — NOT submitted here —
   * because the submit is theirs to make from the composer: "Send for
   * approval", to the account manager THEY pick. Submitting it here would
   * fan the "ready for review" note out to every manager before the
   * scheduler had chosen one. */
  const straightOut = mayPostWithoutApproval(
    actingRoles({ id: user.id, role: user.role }, current), signsOff)
  const reviewerIds = (Array.isArray(input.reviewer_ids) ? input.reviewer_ids : [])
    .map(x => String(x ?? '')).filter(Boolean).slice(0, 20)
  const note = String(input.note ?? '').trim().slice(0, 2000) || undefined
  const decision = input.decision ?? (straightOut ? 'approve' : null)
  if (decision) {
    try {
      current = await performTransition(user, item as never, 'internal_review', {
        note: decision === 'ask' ? note : UPLOAD_ADHOC_REASON,
        // 'ask': the "ready for review" note goes to the people named, not to
        // every manager of the client
        reviewerIds: decision === 'ask' ? reviewerIds : undefined,
        // the manager is about to answer it themselves in the next line
        skipAudiences: decision === 'ask' ? undefined : ['account_managers'],
      }) as unknown as ContentItem
    } catch (e) {
      // the media is saved either way; a piece that stayed at draft is a piece
      // somebody can still submit by hand, and losing the upload would not be
      // recoverable
      console.error('upload post — could not submit the new piece for review:', e)
    }
  }
  if (decision === 'client' && String(current.status) === 'internal_review') {
    try {
      current = await performTransition(user, current as never, 'client_review', { note }) as unknown as ContentItem
    } catch (e) {
      console.error('upload post — could not send the new piece to the client:', e)
    }
  }

  /**
   * …and the manager's own sign-off, performed rather than asked for.
   *
   * The same edge the "Approve without client" button presses, recorded
   * against this person, so the item page's history and the client portal see
   * an ordinary approval. A scheduler or an editor never reaches this: their
   * piece waits at `internal_review` for the manager's check, which is what it
   * did before this change too.
   */
  if (decision === 'approve' && String(current.status) === 'internal_review') {
    try {
      current = await performTransition(user, current as never, 'approved_for_scheduling', {
        note: note ?? UPLOAD_ADHOC_REASON,
        // the "ready for review" note went to the same people one line ago,
        // about a piece this person has just signed off themselves
        skipAudiences: ['account_managers'],
      }) as unknown as ContentItem
    } catch (e) {
      console.error('upload post — could not record the self-approval:', e)
    }
  }

  const post = await startPostOnItem(user, current, {
    slides,
    version,
    caption: input.caption ?? null,
    scheduled_for: input.scheduled_for ?? null,
    timezone: input.timezone ?? null,
  })

  const needsApproval = String(current.status) !== 'approved_for_scheduling'
  return {
    post,
    item: current,
    version_number: versionNumber,
    needs_approval: needsApproval,
    message: !needsApproval
      ? 'Approved — it is on the Schedule page, ready to book in.'
      : decision === 'ask'
        ? 'Sent for approval. It is in Internal check until they answer.'
        : decision === 'client'
          ? `Sent to ${client.name} — it is in With client until they answer.`
          : signsOff
            ? 'Saved. Write the caption, pick the time, then send it to the client — they sign off every post.'
            : 'Saved. Write the caption, pick the time, then send it to your account manager to approve.',
  }
}
