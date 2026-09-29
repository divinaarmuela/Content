import 'server-only'
import { randomUUID } from 'node:crypto'
import { table } from '@/lib/db'
import type { AssetVersion, Client, ContentItem } from '@/lib/db-types'
import { AuthzError, type TeamUser } from './authz'
import { announceItemChange } from './production-live'
import { onItemsCreated } from './gdrive-hooks'
import { mirrorVersionSlides } from './gdrive-mirror'
import { previewVideos } from './stream'
import { addVersion, logActivity } from './workflow'
import { resolveKindForWrite, type WorkKind } from './work-kinds-core'
import {
  clientSignsOffEveryPost, CLIENT_POLICY_UNREADABLE,
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
 * (no-shoot) shape with its reason recorded, `draft_uploaded` at birth. Opened in
 * Production later it is indistinguishable from one somebody typed in — that
 * is the test this file is written to pass.
 *
 * The card is only the holder of the files (SPEC §2.5): it stays at `draft_uploaded` and is never
 * moved through the edit's approval (review fix, 29 Sep 2026). The POST is born a Draft, and its own
 * Send for quality check and the reviewer's Pass are its approval (the owner's decisions 3 and 7).
 */

/* ── what a caller may hand over ────────────────────────────────────────── */

export type UploadPostInput = {
  client_id: string
  /** whom the post is for: the business (null), or one of the client's people (15 Sep 2026) */
  for_contact_id?: string | null
  /** the slides — files already in OUR storage (an upload, or a Drive file
   *  already copied across by `/api/social/schedule/drive`) */
  files: unknown
  caption?: string | null
  scheduled_for?: string | null
  timezone?: string | null
  /** what to call the piece; derived from the file name when absent */
  title?: string | null
}

export type UploadPostResult = {
  post: PlannedPost
  item: ContentItem
  version_number: number
  /** always true: an upload is a DRAFT post, and every post passes the quality check (decision 3) */
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
  user: TeamUser, clientId: string, title: string, contentType: string, signsOff: boolean, forContact: string | null,
): Promise<ContentItem> {
  const kinds = await table<WorkKind>('work_kinds').list().catch(() => [] as WorkKind[])
  const kind = resolveKindForWrite(kinds as WorkKind[], null)
  if (!kind.ok) throw new ComposeError([kind.reason])

  const item = await table<ContentItem>('content_items').insert({
    id: randomUUID(),
    work_kind_id: kind.id,
    client_id: clientId,
    for_contact_id: forContact,
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
  // WHOM THE POST IS FOR (15 Sep 2026): the business, or one of the client's
  // people — checked to be on this client
  const forContact = typeof input.for_contact_id === 'string' && input.for_contact_id.trim() ? input.for_contact_id.trim() : null
  if (forContact) {
    const person = await table<{ id: string; client_id: string }>('client_contacts').get(forContact).catch(() => null)
    if (!person || person.client_id !== clientId) throw new ComposeError(['That person is not on this client'])
  }

  const slides = await checkedSlides(input.files)
  const contentType = contentTypeForFiles(slides)
  const shapeProblem = slidesSatisfyType(contentType, slides)
  if (shapeProblem) throw new ComposeError([shapeProblem])

  const title = titleForUpload({
    fileName: slides[0]?.name ?? null,
    caption: input.title ? String(input.title) : (input.caption ?? null),
  })

  const item = await createBackingItem(user, clientId, title, contentType, signsOff, forContact)

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
   * THE UPLOAD IS A POST, AND ONLY A POST (the owner's decision 7; SPEC §1.3, §2.5 — review fix,
   * 29 Sep 2026). The card made above is only the holder of the files. It is NOT moved through the
   * edit's own approval any more: that sent the edit workflow's "ready for quality check" notices about
   * a card nobody would ever see on Post approval, and answered "Approved — ready to book in" for a post
   * that was a Draft. The post is born a Draft; its own Send for quality check, and the reviewer's Pass,
   * are its approval.
   */
  const current = item
  const post = await startPostOnItem(user, current, {
    slides,
    version,
    caption: input.caption ?? null,
    scheduled_for: input.scheduled_for ?? null,
    timezone: input.timezone ?? null,
  })

  return {
    post,
    item: current,
    version_number: versionNumber,
    needs_approval: true,
    message: 'Saved as a draft post. Write the caption and pick the time, then send it for quality check.',
  }
}
