/**
 * POST STRAIGHT FROM A FILE — the pure half.
 *
 * The Schedule page used to be able to offer only media that already hung off
 * a piece in Production. On a workspace with no pieces yet that reads as a
 * missing feature: "New post" opened an empty chooser, the rail said nothing
 * here yet, and there was nothing to drag. The owner's words: "there should be
 * no approval they should simply be here upload media, upload drive files any
 * media".
 *
 * So the New post window opens on the SOURCES — Upload, Google Drive, and the
 * approved media that already exists — and a file picked there is enough to
 * make a post. The piece the media has to hang off is made for the person,
 * silently, out of the facts in this file: what it is called, what kind of
 * post it is, and what happens next.
 *
 * No I/O here. Everything below is decided from values, so it can be tested
 * without a database, a bucket or a browser.
 */

import type { Slide } from './version-files-core'

/**
 * Why an item exists with no shoot behind it — recorded, as the gate asks,
 * AND written on the upload's own version 1 as its note. That note is how the
 * Schedule page later tells "a picture the client said yes to" from "a
 * picture somebody dropped on the calendar": the piece behind an upload was
 * made silently and the client was never asked about it, so there is no
 * approval to lose when it is edited.
 */
export const UPLOAD_ADHOC_REASON = 'posted straight from an upload on the Schedule page'

/** Was this version the upload a post was made from on the Schedule page? */
export function isAdHocUploadVersion(
  version: { version_number?: unknown; notes?: unknown } | null | undefined,
): boolean {
  return Number(version?.version_number ?? 0) === 1
    && String(version?.notes ?? '') === UPLOAD_ADHOC_REASON
}

/* ── the sources New post opens on ──────────────────────────────────────── */

export type NewPostSourceKey = 'upload' | 'drive' | 'approved'

export type NewPostSource = {
  key: NewPostSourceKey
  label: string
  /** one line under the tab, in the words a person would use */
  help: string
}

/**
 * The sources, in the order they are offered.
 *
 * UPLOAD IS FIRST, always. The thing somebody wants to post at four o'clock on
 * a Friday is nearly always a file on their laptop, and making them find a
 * "piece" first is the step this whole change removes.
 *
 * Google Drive is offered only where Drive is actually connected and this
 * client has a folder — a tab that can only say "not set up" is a dead end.
 * Approved media is offered only when there is some: an empty grid was the
 * whole of what this page used to show.
 */
export function newPostSources(input: {
  driveAvailable: boolean
  approvedCount: number
  /** false on Schedule (8 Sep 2026): "the Schedule page is only for approved
   *  items to be posted" — uploads happen on Post approval */
  uploads?: boolean
}): NewPostSource[] {
  if (input.uploads === false) {
    return [{
      key: 'approved',
      label: 'Approved media',
      help: input.approvedCount > 0
        ? 'Pieces that have been approved on Post approval.'
        : 'Nothing approved yet — pieces are uploaded and approved on Post approval, then appear here.',
    }]
  }
  const out: NewPostSource[] = [{
    key: 'upload',
    label: 'Upload',
    help: 'Drag photos or video in, or browse your computer.',
  }]
  if (input.driveAvailable) {
    out.push({
      key: 'drive',
      label: 'Google Drive',
      help: 'Pick from this client’s Drive folder. We copy the file — nothing in Drive changes.',
    })
  }
  if (input.approvedCount > 0) {
    out.push({
      key: 'approved',
      label: 'Approved media',
      help: 'Media that is already on a piece of work.',
    })
  }
  return out
}

/** Which tab New post should open on. */
export function firstSource(sources: readonly NewPostSource[]): NewPostSourceKey {
  return sources[0]?.key ?? 'upload'
}

/* ── what the post becomes ──────────────────────────────────────────────── */

/**
 * What kind of post a set of files makes.
 *
 * Two or more files is a carousel — that is what more than one picture in one
 * post IS. One video is a Reel, which is what a video posted to Instagram is
 * today. One picture is a still. Nobody is asked: the answer is in the files,
 * and the composer can still say otherwise per channel.
 */
export function contentTypeForFiles(slides: readonly { type?: string | null }[]): string {
  const list = Array.isArray(slides) ? slides : []
  if (list.length > 1) return 'carousel'
  return String(list[0]?.type ?? '') === 'video' ? 'reel' : 'static'
}

/** Strip the extension and tidy a file name into something readable. */
function prettyFileName(name: string): string {
  const base = String(name ?? '').split(/[\\/]/).pop() ?? ''
  const dot = base.lastIndexOf('.')
  const stem = dot > 0 ? base.slice(0, dot) : base
  return stem.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim()
}

/** The longest a made-up title may be — the same 120 the items API keeps. */
export const MAX_ITEM_TITLE = 120

/**
 * What the piece behind an uploaded post is CALLED.
 *
 * The caption first when there is one — that is what the post is about, in the
 * person's own words — and the file name otherwise. Never blank: a piece with
 * no title is unfindable on the production board, and this one is going to
 * turn up there whether anybody planned it or not.
 */
export function titleForUpload(input: {
  fileName?: string | null
  caption?: string | null
  /** used only when there is neither, so the row is still identifiable */
  fallback?: string | null
}): string {
  const caption = String(input.caption ?? '').replace(/\s+/g, ' ').trim()
  if (caption) return clip(caption)
  const name = prettyFileName(String(input.fileName ?? ''))
  if (name) return clip(name)
  const fallback = String(input.fallback ?? '').replace(/\s+/g, ' ').trim()
  return clip(fallback || 'Social post')
}

function clip(text: string): string {
  if (text.length <= MAX_ITEM_TITLE) return text
  const cut = text.slice(0, MAX_ITEM_TITLE)
  const space = cut.lastIndexOf(' ')
  return (space > 40 ? cut.slice(0, space) : cut).trim() + '…'
}

/* ── what happens next, said before anybody presses anything ────────────── */

/**
 * The one sentence under the sources, and it has to be true for everyone (the posting rebuild, 29 Sep 2026): an
 * upload is born a Draft post and every post passes the quality check before the client or the schedule sees it —
 * managers included (the owner's decision 3). The old "Nothing waits for approval" line for managers stopped
 * being true, so there is one line now.
 */
export const UPLOAD_OUTCOME_LINE = 'Your files become a draft post. It goes to the quality check before the client or the schedule sees it.'

/* ── the desktop drag ───────────────────────────────────────────────────── */

/**
 * Is this drag carrying FILES from outside the browser?
 *
 * `DataTransfer.types` holds 'Files' when the operating system is handing over
 * real files. Everything the page drags itself carries one of our own types
 * instead, so this is what tells "a photo from the desktop" from "a tile being
 * moved" without reading the payload (which no browser lets us do on dragover).
 */
export function isFileDrag(types: readonly string[] | DOMStringList | null | undefined): boolean {
  if (!types) return false
  const list = Array.from(types as readonly string[])
  return list.includes('Files')
}

/** The file types a post may be made of, for the file input's `accept`. */
export const UPLOAD_ACCEPT = 'image/*,video/*'

/** Refuse anything that is not a photo or a video before it is uploaded. */
export function usableUploadFiles(
  files: readonly { name: string; type: string }[],
): { keep: { name: string; type: string }[]; refused: string[] } {
  const keep: { name: string; type: string }[] = []
  const refused: string[] = []
  for (const f of Array.isArray(files) ? files : []) {
    const type = String(f?.type ?? '')
    if (type.startsWith('image/') || type.startsWith('video/')) keep.push(f)
    else refused.push(String(f?.name ?? 'that file'))
  }
  return { keep, refused }
}

/** The one sentence for files that were dropped and are not media. */
export function refusedFilesLine(refused: readonly string[]): string | null {
  if (refused.length === 0) return null
  if (refused.length === 1) return `${refused[0]} is not a photo or a video.`
  return `${refused.length} of those files are not photos or video.`
}

/* ── what the server hands back ─────────────────────────────────────────── */

export type UploadedPostSummary = {
  itemId: string
  postId: string
  title: string
  contentType: string
  slides: Slide[]
  /** does this post still need somebody's approval before it can go out? */
  needsApproval: boolean
  /** where the piece actually is — a scheduler's upload sits at
   *  `draft_uploaded` until they send it; a manager's is already cleared */
  itemStatus?: string
}
