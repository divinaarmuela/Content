'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { approveWithoutClientQuestion, type SuggestedTime } from '@/app/lib/social-schedule-core'
import { friendlyError, loadFailedMessage } from '@/app/lib/support-core'
import { readLocations } from '@/app/lib/schedule-compose-core'
import { STAGE_MEANING, isPostStage } from '@/app/lib/post-stage-core'
import { dayKeyInZone, formatInZone } from '@/app/lib/timezone-core'
import type { UploadedPostSummary } from '@/app/lib/schedule-upload-core'
import type { Role } from '@/app/lib/identity-core'
import ImageEditor, { type ImageEditorTarget } from './ImageEditor'
import PostWindow, { type PostWindowContext, type PostWindowOutcome, type PostWindowSeed } from './PostWindow'
import NewPostSources from './NewPostSources'
import type { RailMedia, ScheduleData } from './useSchedulePosts'
import type { Slide } from '@/app/lib/version-files-core'

/**
 * ONE ACTION: ADD THE MEDIA, SEE IT, SEND IT — WHEREVER YOU ARE STANDING.
 *
 * The Schedule page's flow, and the Post approval page's New post button runs
 * the same one (the posting rebuild, 29 Sep 2026):
 *
 *   `NewPostSources`  the files — drop them, take them out of the client's
 *                     Google Drive folder (read only, trap 13), or pick a
 *                     piece.
 *   `PostWindow`      the one post window: the stage and what happens next,
 *                     the post, and only the buttons `postActions` gives this
 *                     person for this stage. The same window wherever it opens.
 *   the answer        after a press, the server's own words, read from the
 *                     stage the post landed in.
 *
 * It is a hook rather than a component because the Schedule page opens the
 * same windows from six places — the rail, an empty slot, a suggested time, a
 * tile, a piece dragged onto a day, a file dropped on one — and each of those
 * is an opener, not a prop.
 */

/**
 * The client somebody worked on last, remembered in this browser — one key,
 * shared by the Schedule page and the Post approval page's New post button.
 */
export const CLIENT_KEY = 'md-schedule-client'

export type ComposeFlow = {
  /** an empty slot, a suggested time, or a button: ask what goes in it */
  openAt: (at: string | null) => void
  /** a piece from the rail — with, optionally, only SOME of its files (the folder's ticks) */
  openNew: (media: RailMedia, at: string | null, slides?: Slide[] | null) => void
  /** an upload that just became a post — open the window on it */
  openMade: (made: UploadedPostSummary, at: string | null) => void
  /** an existing post */
  openPost: (post: { id: string; item_id?: string | null; source_item_id?: string | null }) => void
  /** a piece named in a link — the bell, or an email: its draft post, or a new one */
  openItem: (itemId: string) => void
  /** the manager's own sign-off on a piece (the EDIT's approval — never a post's) */
  approve: (media: RailMedia) => void
  /** the one image editor, opened from the week's chooser or the post window */
  edit: (target: ImageEditorTarget | null) => void
  /** is any of it on screen */
  open: boolean
  /** everything above, drawn */
  windows: React.ReactNode
}

/** The draft post already being made from this piece — the one a second "new post" reopens. */
function draftOf(posts: ScheduleData['posts'], itemId: string) {
  return posts.find(p => ((p as { source_item_id?: string | null }).source_item_id ?? p.item_id) === itemId && p.stage === 'draft') ?? null
}

export function useComposeFlow({ clientId, data, role, userId, suggested, onShowDay, forContact = null }: {
  clientId: string | null
  /** whom a new upload is for: null for the business, a contact's id for a person (15 Sep 2026) */
  forContact?: string | null
  data: ScheduleData
  role: Role | null
  /** who is looking (the post window reads its own viewer; kept for the page's call) */
  userId?: string | null
  suggested: SuggestedTime[]
  /** "Show on calendar" after a press: the page moves its week to that day */
  onShowDay?: (dayKey: string) => void
}): ComposeFlow {
  void userId
  /** which post, or which piece a new post is made from — the row itself is read live by the window */
  const [composing, setComposing] = useState<
    { itemId: string | null; postId: string | null; at: string | null; slides?: Slide[] | null } | null>(null)
  const [choosing, setChoosing] = useState<{ at: string | null } | null>(null)
  /** an upload's own answer, until the live rows carry it */
  const [pending, setPending] = useState<UploadedPostSummary | null>(null)
  /** what the server said after the last press, once the window has closed */
  const [done, setDone] = useState<PostWindowOutcome | null>(null)

  const openNew = useCallback((media: RailMedia, at: string | null, slides?: Slide[] | null) => {
    setChoosing(null)
    // one DRAFT per piece: a second "new post" on a piece that has one being
    // made opens it — unless files were ticked in the folder, which is a new
    // post of those files
    const existing = slides?.length ? null : draftOf(data.posts, media.itemId)
    setComposing({ itemId: media.itemId, postId: existing?.id ?? null, at, slides: slides ?? null })
  }, [data.posts])

  const openMade = useCallback((made: UploadedPostSummary, at: string | null) => {
    setChoosing(null)
    setPending(made)
    setComposing({ itemId: made.itemId, postId: made.postId || null, at })
  }, [])

  const openPost = useCallback((post: { id: string; item_id?: string | null; source_item_id?: string | null }) =>
    setComposing({ itemId: post.source_item_id ?? post.item_id ?? null, postId: post.id, at: null }), [])

  const openItem = useCallback((itemId: string) => {
    const existing = draftOf(data.posts, itemId)
    setComposing({ itemId, postId: existing?.id ?? null, at: null })
  }, [data.posts])

  const openAt = useCallback((at: string | null) => setChoosing({ at }), [])

  /* "Approve without client" — the EDIT's sign-off, through the edit's own transition. It never moves a post. */
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
      if (!res.ok) { setApproveNote(friendlyError(String(json?.error ?? ''), 'Schedule')); return }
      setApproving(null)
    } catch {
      setApproveNote(loadFailedMessage('that approval'))
    } finally {
      setApproveBusy(false)
    }
  }
  useEffect(() => {
    if (!approving) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setApproving(null) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [approving])

  /* ONE IMAGE EDITOR, two ways in — the week's chooser and the post window's own button */
  const [editing, setEditing] = useState<ImageEditorTarget | null>(null)
  const [editSaved, setEditSaved] = useState<string | null>(null)
  useEffect(() => {
    if (!editSaved) return
    const t = window.setTimeout(() => setEditSaved(null), 8000)
    return () => window.clearTimeout(t)
  }, [editSaved])

  /** the new post's files, when the window opens on a piece rather than a post */
  const seed: PostWindowSeed | null = useMemo(() => {
    if (!composing || composing.postId || !composing.itemId) return null
    const media = data.media.find(m => m.itemId === composing.itemId)
    const fresh = pending && pending.itemId === composing.itemId ? pending : null
    if (!media && !fresh) return null
    return {
      itemId: composing.itemId,
      title: media?.title ?? fresh?.title ?? 'Post',
      slides: composing.slides?.length ? composing.slides : (media?.slides ?? fresh?.slides ?? []),
      pieceFiles: media?.slides ?? fresh?.slides ?? [],
      pieceVersions: media?.versions,
      versionNumber: media?.versionNumber ?? null,
      coverUrl: media?.coverUrl ?? null,
      at: composing.at,
    }
  }, [composing, data.media, pending])

  /** the files of the piece, for the media picker of a SAVED post too */
  const pieceFor = useCallback((itemId: string | null) => data.media.find(m => m.itemId === itemId) ?? null, [data.media])

  const context: PostWindowContext | null = useMemo(() => (clientId ? {
    clientId,
    tz: data.tz,
    client: data.client as PostWindowContext['client'],
    accounts: data.accounts,
    allAccounts: data.allAccounts,
    contacts: data.contacts,
    locations: readLocations((data.client as { instagram_locations?: unknown } | null)?.instagram_locations),
    suggested: suggested.slice(0, 3),
  } : null), [clientId, data.tz, data.client, data.accounts, data.allAccounts, data.contacts, suggested])

  const driveAvailable = Boolean(
    String((data.client as { drive_folder_id?: string | null } | null)?.drive_folder_id ?? '').trim())

  const showWindow = !!composing && !!context && (!!composing.postId || !!seed)
  const piece = composing ? pieceFor(composing.itemId) : null

  const windows = (
    <>
      {choosing && (
        <NewPostSources
          clientId={clientId}
          forContact={forContact}
          media={data.media}
          at={choosing.at}
          tz={data.tz}
          role={role}
          postWithoutApproval={data.postWithoutApproval}
          clientSignsOff={data.clientSignsOff}
          driveAvailable={driveAvailable || data.media.some(m => m.driveFolderUrl)}
          handedFolders={data.media.filter(m => m.driveFolderUrl).map(m => ({ itemId: m.itemId, title: m.title }))}
          // an upload straight from here is a post from birth, for everyone who
          // builds posts (the owner's decisions 4 and 7): it goes to the quality
          // check like any other
          allowUploads
          onPick={m => openNew(m, choosing.at)}
          onApprove={approve}
          onCreated={made => openMade(made, choosing.at)}
          onOpenExisting={(itemId, postId) => { setChoosing(null); setComposing({ itemId, postId, at: null }) }}
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
            <h2 className="text-section-title">{approveWithoutClientQuestion(approving.versionNumber)}</h2>
            <p className="text-[13px] text-muted-foreground">
              {`“${approving.title}” is signed off in your name. `}This is the piece&rsquo;s approval, not a post&rsquo;s — every post made from it still goes through the quality check.
            </p>
            {approveNote && (
              <p className="rounded-inner border border-accent-red/40 bg-tint-red px-3 py-2 text-[12px] font-medium">{approveNote}</p>
            )}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setApproving(null)} className="min-h-11 rounded-full border border-border bg-surface px-4 text-[13px] font-semibold">Not yet</button>
              <button type="button" disabled={approveBusy} onClick={() => void approveWithoutClient(approving)}
                className="min-h-11 rounded-full bg-foreground px-4 text-[13px] font-semibold text-background disabled:opacity-60">
                {approveBusy ? 'Approving…' : 'Approve without client'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showWindow && composing && context && (
        <PostWindow
          postId={composing.postId}
          seed={seed ?? (piece ? {
            itemId: piece.itemId, title: piece.title, slides: piece.slides, pieceFiles: piece.slides, pieceVersions: piece.versions,
            versionNumber: piece.versionNumber ?? null, coverUrl: piece.coverUrl ?? null, at: null,
          } : null)}
          context={context}
          onClose={() => { setComposing(null); setPending(null) }}
          onOpenPost={pid => setComposing(c => (c ? { ...c, postId: pid } : c))}
          onEditMedia={setEditing}
          onDone={outcome => { setComposing(null); setPending(null); setDone(outcome) }}
        />
      )}

      {done && (() => {
        const stage = isPostStage(done.stage) ? done.stage : null
        const when = done.at ? formatInZone(done.at, data.tz, 'full') : null
        const onCalendar = !!done.at && !!stage && ['quality_check', 'with_client', 'ready', 'booked', 'posted'].includes(stage)
        const reopen = () => { const o = done; setDone(null); if (o.postId) setComposing({ itemId: o.itemId, postId: o.postId, at: null }) }
        return (
          <div
            role="dialog"
            aria-modal="true"
            aria-label={done.words}
            onMouseDown={e => { if (e.target === e.currentTarget) setDone(null) }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-ink/55 p-4"
          >
            <div className="flex w-full max-w-[440px] flex-col gap-3 rounded-card bg-popover p-5 text-popover-foreground shadow-xl">
              <h2 className="text-section-title">{done.words}</h2>
              {stage && (
                <p className="text-[14px] leading-[1.5] text-muted-foreground">
                  {STAGE_MEANING[stage]}{when ? ` Posting time: ${when}.` : ''}
                </p>
              )}
              {done.link && (
                <div className="flex flex-col gap-1.5">
                  <p className="text-[13px] font-medium">Send the client this link yourself — nothing was emailed:</p>
                  <input readOnly value={done.link} onFocus={e => e.currentTarget.select()} aria-label="The client's link"
                    className="min-h-11 w-full rounded-full border border-border bg-paper px-3 text-[13px]" />
                  <button type="button" onClick={() => { void navigator.clipboard?.writeText(done.link!).catch(() => {}) }}
                    className="min-h-11 self-start rounded-full border border-border px-4 text-[13px] font-semibold">Copy the link</button>
                </div>
              )}
              <div className="mt-1 flex flex-wrap items-center justify-end gap-2">
                {done.postId && stage && (
                  <button type="button" onClick={reopen} className="min-h-11 rounded-full border border-border px-4 text-[13px] font-semibold">Open the post</button>
                )}
                {done.createdPostId && (
                  <button type="button" onClick={() => { const o = done; setDone(null); setComposing({ itemId: o.itemId, postId: o.createdPostId!, at: null }) }}
                    className="min-h-11 rounded-full border border-border px-4 text-[13px] font-semibold">Open the new post</button>
                )}
                {onCalendar && onShowDay && (
                  <button type="button"
                    onClick={() => { const key = dayKeyInZone(done.at!, data.tz); setDone(null); if (key) onShowDay(key) }}
                    className="min-h-11 rounded-full border border-border px-4 text-[13px] font-semibold">
                    Show on calendar
                  </button>
                )}
                <button type="button" onClick={() => setDone(null)} className="min-h-11 rounded-full bg-foreground px-5 text-[13px] font-semibold text-background">Done</button>
              </div>
            </div>
          </div>
        )
      })()}

      {editSaved && (
        <div role="status" className="fixed bottom-6 left-1/2 z-50 max-w-[440px] -translate-x-1/2 rounded-card border border-border bg-popover px-4 py-3 text-[13px] font-medium shadow-xl">
          {editSaved}
        </div>
      )}

      {editing && (
        <ImageEditor
          target={editing}
          mayApprove={data.postWithoutApproval}
          onClose={() => setEditing(null)}
          onSaved={message => { setEditSaved(message); setEditing(null) }}
        />
      )}
    </>
  )

  return {
    openAt, openNew, openMade, openPost, openItem, approve,
    edit: setEditing,
    open: choosing !== null || showWindow || approving !== null || editing !== null || done !== null,
    windows,
  }
}

/**
 * GOOD TIMES TO POST — fetched rather than subscribed: ninety days of results
 * averaged into three hours a day. A missing suggestion is a missing hint.
 */
export function useSuggestedTimes(clientId: string | null, network: string, tz: string): SuggestedTime[] {
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
