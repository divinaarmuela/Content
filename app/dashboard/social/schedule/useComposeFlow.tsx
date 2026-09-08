'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  approveWithoutClientQuestion, type SuggestedTime,
} from '@/app/lib/social-schedule-core'
import { friendlyError, loadFailedMessage } from '@/app/lib/support-core'
import { readLocations } from '@/app/lib/schedule-compose-core'
import type { UploadedPostSummary } from '@/app/lib/schedule-upload-core'
import type { Role } from '@/app/lib/identity-core'
import ImageEditor, { type ImageEditorTarget } from './ImageEditor'
import NewPostDialog, { type ComposerTarget } from './NewPostDialog'
import NewPostSources from './NewPostSources'
import type { RailMedia, ScheduleData, SchedulePostRow } from './useSchedulePosts'

/**
 * ONE ACTION: ADD THE MEDIA, SEE IT, SEND IT — WHEREVER YOU ARE STANDING.
 *
 * The owner, more than once: "ONE BUTTON… IT SHOULD BE ONE ACTION WHERE I CAN
 * PUT FILES OR DRIVE TO SEND TO MY AM FOR APPROVAL", and "where is this
 * preview feature in the Scheduler page? my New post is still taking me to the
 * Schedule page." The Scheduler's button used to navigate to the Schedule page
 * and open the composer over there, which is the one thing they said not to do.
 *
 * This is the Schedule page's OWN flow, lifted whole so both pages run the
 * same one rather than a copy each:
 *
 *   `NewPostSources`  the files — drop them, or take them out of the client's
 *                     Google Drive folder (read only, trap 13), or pick a
 *                     piece that is already approved.
 *   `NewPostDialog`   the composer, with the per-network preview
 *                     (`PostPreview` / `post-preview-core`) on its own tab.
 *   its footer        `footerActions` — "Send for approval" for somebody who
 *                     needs one, scheduling or posting for an account manager
 *                     or a super admin who does not (`mayPostWithoutApproval`).
 *                     Nobody is ever shown a button the server would refuse.
 *
 * It is a hook rather than a component because the Schedule page opens the
 * same windows from six places — the rail, an empty slot, a suggested time, a
 * tile, a piece dragged onto a day, a file dropped on one — and each of those
 * is an opener, not a prop.
 */

/**
 * The client somebody worked on last, remembered in this browser.
 *
 * ONE key, shared: the Schedule page opens on it, and the Scheduler page's
 * button offers it first. Two keys would mean two "last clients" and a person
 * posting for whoever the other screen happened to remember.
 */
export const CLIENT_KEY = 'md-schedule-client'

export type ComposeFlow = {
  /** an empty slot, a suggested time, or a button: ask what goes in it */
  openAt: (at: string | null) => void
  /** a piece from the rail or the approved grid */
  openNew: (media: RailMedia, at: string | null) => void
  /** an upload that just became a post — open the composer on it */
  openMade: (made: UploadedPostSummary, at: string | null) => void
  /** an existing post */
  openPost: (post: SchedulePostRow) => void
  /** a piece named in a link — the bell, or the "approve this post" email */
  openItem: (itemId: string) => void
  /** the manager's own sign-off on a piece, asked first */
  approve: (media: RailMedia) => void
  /** the one image editor, opened from the week's chooser or the composer */
  edit: (target: ImageEditorTarget | null) => void
  /** is any of it on screen */
  open: boolean
  /** everything above, drawn */
  windows: React.ReactNode
}

export function useComposeFlow({ clientId, data, role, suggested, reviewOnly }: {
  clientId: string | null
  data: ScheduleData
  role: Role | null
  suggested: SuggestedTime[]
  /** the approval step (the Scheduler page): no clock, one press that sends
   *  it for a decision. Posting is chosen afterwards, on the Schedule page. */
  reviewOnly?: boolean
}): ComposeFlow {
  /**
   * The composer, held as "which piece, and which post" rather than as a copy
   * of the post: the row itself is looked up in the LIVE list every render, so
   * an approval landing in another tab changes the window's pill and its
   * button without anything here refetching.
   */
  const [composing, setComposing] = useState<
    { itemId: string; postId: string | null; at: string | null } | null>(null)
  /**
   * "New post" with nothing chosen yet.
   *
   * NOTHING IS PICKED FOR ANYBODY. The time the click meant is carried into
   * the chooser and on into the composer.
   */
  const [choosing, setChoosing] = useState<{ at: string | null } | null>(null)
  /**
   * A POST THAT WAS A FILE ON SOMEBODY'S LAPTOP A SECOND AGO.
   *
   * The rows are live, so the piece and the post an upload just made arrive by
   * themselves — but not instantly, and a window that does not open is
   * indistinguishable from a press that did nothing. So the server's own
   * answer is held and the composer opens on THAT; the live rows take over the
   * moment they land.
   */
  const [pending, setPending] = useState<UploadedPostSummary | null>(null)

  const openNew = useCallback((media: RailMedia, at: string | null) => {
    if (!media.ok) return
    setChoosing(null)
    // one post per piece: a second "new post" on a piece that has one opens
    // the one that exists, which is what the server would insist on anyway
    const existing = data.posts.find(p => p.item_id === media.itemId) ?? null
    setComposing({ itemId: media.itemId, postId: existing?.id ?? null, at })
  }, [data.posts])

  const openMade = useCallback((made: UploadedPostSummary, at: string | null) => {
    setChoosing(null)
    setPending(made)
    setComposing({ itemId: made.itemId, postId: made.postId || null, at })
  }, [])

  const openPost = useCallback((post: SchedulePostRow) =>
    setComposing({ itemId: post.item_id, postId: post.id, at: null }), [])

  const openItem = useCallback((itemId: string) =>
    setComposing({ itemId, postId: null, at: null }), [])

  const openAt = useCallback((at: string | null) => setChoosing({ at }), [])

  /**
   * "Approve without client" — the manager's own sign-off.
   *
   * One question first, because it skips the client. The move itself is the
   * EXISTING transition to `approved_for_scheduling`: the same edge, the same
   * refusals and the same activity trail as the item page, so nobody gains a
   * right by being on this screen.
   */
  const [approving, setApproving] = useState<RailMedia | null>(null)
  const [approveNote, setApproveNote] = useState<string | null>(null)
  const [approveBusy, setApproveBusy] = useState(false)

  const approve = useCallback((m: RailMedia) => { setApproveNote(null); setApproving(m) }, [])

  const approveWithoutClient = async (m: RailMedia) => {
    setApproveBusy(true)
    setApproveNote(null)
    try {
      const res = await fetch(`/api/production/items/${m.itemId}/transition`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: 'approved_for_scheduling' }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setApproveNote(friendlyError(String(json?.error ?? ''), 'Schedule'))
        return
      }
      setApproving(null)
    } catch {
      setApproveNote(loadFailedMessage('that approval'))
    } finally {
      setApproveBusy(false)
    }
  }

  // Escape closes the question, like every other window here. A dialog only
  // the mouse can dismiss is one somebody gets stuck in.
  useEffect(() => {
    if (!approving) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setApproving(null) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [approving])

  /**
   * ONE IMAGE EDITOR, TWO WAYS IN — the week's "Edit media" chooser and the
   * composer's own "Edit image" button. Two copies would drift, and one opened
   * over the other is a window nobody can get out of.
   */
  const [editing, setEditing] = useState<ImageEditorTarget | null>(null)
  const [editSaved, setEditSaved] = useState<string | null>(null)

  // a note about a save clears itself: it is a receipt, not a state
  useEffect(() => {
    if (!editSaved) return
    const id = window.setTimeout(() => setEditSaved(null), 8000)
    return () => window.clearTimeout(id)
  }, [editSaved])

  const target: ComposerTarget | null = useMemo(() => {
    if (!composing) return null
    const media = data.media.find(m => m.itemId === composing.itemId)
    const post = composing.postId
      ? data.posts.find(p => p.id === composing.postId) ?? null
      : data.posts.find(p => p.item_id === composing.itemId) ?? null
    // the upload's own answer, until the live rows carry it
    const fresh = pending && pending.itemId === composing.itemId ? pending : null
    if (!media && !post && !fresh) return null
    return {
      itemId: composing.itemId,
      title: media?.title ?? post?.item_title ?? fresh?.title ?? 'Post',
      contentType: media?.contentType ?? String(post?.item_type ?? fresh?.contentType ?? ''),
      approved: media?.slides ?? fresh?.slides ?? [],
      knownUrls: media?.knownUrls ?? (fresh ? fresh.slides.map(s => s.url) : []),
      coverUrl: media?.coverUrl ?? null,
      versionNumber: post?.version_number ?? null,
      needsClientApproval: media?.needsClientApproval ?? Boolean(fresh?.needsApproval),
      // a fresh upload never saw the board; an opened post reads its piece
      boardApproved: media?.boardApproved ?? false,
      // a post made from an upload a moment ago was never the client's to approve
      clientApproved: media?.clientApproved ?? false,
      itemStatus: media?.status
        ?? (fresh
          ? (fresh.itemStatus || (fresh.needsApproval ? 'draft_uploaded' : 'approved_for_scheduling'))
          : 'approved_for_scheduling'),
      post,
      at: composing.at,
    }
  }, [composing, data.media, data.posts, pending])

  /** the places this client tags Instagram posts at — saved on their Social
   *  page, because Instagram wants a Facebook Page id and has no search */
  const locations = useMemo(
    () => readLocations((data.client as { instagram_locations?: unknown } | null)?.instagram_locations),
    [data.client])
  /** the client has a Drive folder we can read — no folder, no Drive tab */
  const driveAvailable = Boolean(
    String((data.client as { drive_folder_id?: string | null } | null)?.drive_folder_id ?? '').trim())

  const windows = (
    <>
      {choosing && (
        <NewPostSources
          clientId={clientId}
          media={data.media}
          at={choosing.at}
          tz={data.tz}
          role={role}
          postWithoutApproval={data.postWithoutApproval}
          clientSignsOff={data.clientSignsOff}
          driveAvailable={driveAvailable}
          // Schedule offers approved pieces only; Post approval's window uploads
          allowUploads={reviewOnly === true}
          onPick={m => openNew(m, choosing.at)}
          onApprove={approve}
          onCreated={made => openMade(made, choosing.at)}
          onClose={() => setChoosing(null)}
        />
      )}

      {approving && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Approve without the client"
          onMouseDown={e => { if (e.target === e.currentTarget) setApproving(null) }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/55 p-4"
        >
          <div className="flex w-full max-w-[420px] flex-col gap-3 rounded-card bg-popover p-4 shadow-xl">
            <h2 className="text-section-title">
              {approveWithoutClientQuestion(approving.versionNumber)}
            </h2>
            <p className="text-[13px] text-muted-foreground">
              {`“${approving.title}” is signed off in your name and can be posted. `}
              The client is not asked.
            </p>
            {approveNote && (
              <p className="rounded-inner border border-accent-red/40 bg-tint-red px-3 py-2 text-[12px] font-medium">
                {approveNote}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setApproving(null)}
                className="min-h-11 rounded-full border border-border bg-surface px-4 text-[13px] font-semibold"
              >
                Not yet
              </button>
              <button
                type="button"
                disabled={approveBusy}
                onClick={() => void approveWithoutClient(approving)}
                className="min-h-11 rounded-full bg-foreground px-4 text-[13px] font-semibold text-background disabled:opacity-60"
              >
                {approveBusy ? 'Approving…' : 'Approve without client'}
              </button>
            </div>
          </div>
        </div>
      )}

      {target && (
        <NewPostDialog
          reviewOnly={reviewOnly}
          target={target}
          tz={data.tz}
          accounts={data.accounts}
          suggested={suggested.slice(0, 3)}
          role={role}
          clientSignsOff={data.clientSignsOff}
          locations={locations}
          clientName={(data.client as { name?: string | null } | null)?.name ?? null}
          onClose={() => { setComposing(null); setPending(null) }}
          onOpenPost={id => setComposing(c => (c ? { ...c, postId: id } : c))}
          onEditMedia={setEditing}
        />
      )}

      {editSaved && (
        <div
          role="status"
          className="fixed bottom-6 left-1/2 z-50 max-w-[440px] -translate-x-1/2 rounded-card border border-border bg-popover px-4 py-3 text-[13px] font-medium shadow-xl"
        >
          {editSaved}
        </div>
      )}

      {editing && (
        <ImageEditor
          target={editing}
          mayApprove={data.postWithoutApproval}
          onClose={() => setEditing(null)}
          onSaved={message => {
            setEditSaved(message)
            setEditing(null)
          }}
        />
      )}
    </>
  )

  return {
    openAt, openNew, openMade, openPost, openItem, approve,
    edit: setEditing,
    open: choosing !== null || target !== null || approving !== null || editing !== null,
    windows,
  }
}

/**
 * GOOD TIMES TO POST.
 *
 * The one thing on the Schedule page that is fetched rather than subscribed:
 * it is ninety days of results averaged into three hours a day, it changes
 * when a post lands and not before, and the rule that computes it needs
 * analytics rows no page has another reason to hold. A missing suggestion is a
 * missing hint, not a broken week.
 */
export function useSuggestedTimes(
  clientId: string | null,
  network: string,
  tz: string,
): SuggestedTime[] {
  const [suggested, setSuggested] = useState<SuggestedTime[]>([])
  useEffect(() => {
    if (!clientId) { setSuggested([]); return }
    let cancelled = false
    const url = `/api/social/schedule/suggested?clientId=${encodeURIComponent(clientId)}`
      + `&network=${encodeURIComponent(network)}&tz=${encodeURIComponent(tz)}`
    fetch(url)
      .then(r => (r.ok ? r.json() : { times: [] }))
      .then(json => { if (!cancelled) setSuggested((json.times ?? []) as SuggestedTime[]) })
      .catch(() => { /* a missing suggestion is a missing hint */ })
    return () => { cancelled = true }
  }, [clientId, network, tz])
  return suggested
}
