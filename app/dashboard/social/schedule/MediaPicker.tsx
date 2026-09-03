'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ArrowLeft, ArrowRight, Check, FolderOpen, Upload, X,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Thumb } from './tiles'
import { clearGroup, dismissUpload, uploadFiles } from '../../uploadQueue'
import { UploadRows, useUploadGroup } from '../../UploadRows'
import {
  addToPost, inPost, limitsLine, moveInPost, removeFromPost,
  NEW_VERSION_NOTICE, PICKER_HELP, PICKER_LIBRARY_HELP,
  type MediaSource,
} from '@/app/lib/schedule-compose-core'
import { friendlyError } from '@/app/lib/support-core'
import { slideTypeFromUrl, type Slide } from '@/app/lib/version-files-core'

/**
 * ADD MEDIA — the library on the left, the post on the right.
 *
 * The composer stays behind it, dimmed, because what is being arranged only
 * makes sense next to the caption and the channels it belongs to.
 *
 * The rule the whole window is built around: **only media the client approved
 * gets posted**. The Approved tab is the item's approved version and nothing
 * else. A Drive file or an upload is not refused — that would send people
 * back to email — but it is not slipped in either: it becomes a new version
 * of the piece, the client is asked, and the footer says so before anybody
 * clicks anything.
 *
 * Drag a file across to add it; drag inside the tray to reorder; drop on a
 * slot to replace it. Every one of those has a button as well, because a drag
 * is not available to somebody using a keyboard and "the feature exists but
 * not for you" is not a thing this app does.
 */

const SOURCES: { key: MediaSource; label: string }[] = [
  { key: 'approved', label: 'Approved' },
  { key: 'drive', label: 'Google Drive' },
  { key: 'upload', label: 'Upload' },
]

/** A Drive row, as the tab reads it back. */
type DriveRow = { id: string; name: string; type: 'image' | 'video'; bytes: number | null }

const DRAG_TYPE = 'application/x-md-slide'

export default function MediaPicker({
  open, onClose, itemId, approved, versionLabel, slides, platforms, onSave, saving,
}: {
  open: boolean
  onClose: () => void
  itemId: string
  /** the APPROVED version's files — the only ones that need no new approval */
  approved: Slide[]
  /** "Menu carousel · version 3" */
  versionLabel: string
  slides: Slide[]
  platforms: string[]
  /** hands back the arrangement; the parent decides whether that is an edit
   *  or a whole new version */
  onSave: (next: Slide[]) => void | Promise<void>
  saving: boolean
}) {
  const [tray, setTray] = useState<Slide[]>(slides)
  const [source, setSource] = useState<MediaSource>('approved')
  const [drive, setDrive] = useState<DriveRow[] | null>(null)
  const [driveNote, setDriveNote] = useState<string | null>(null)
  const [brought, setBrought] = useState<Slide[]>([])
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [over, setOver] = useState<number | 'tray' | null>(null)

  const uploadGroup = useMemo(() => `schedule-media:${itemId}`, [itemId])
  const uploads = useUploadGroup(uploadGroup)

  // reopening on a different post must not show the last one's arrangement
  useEffect(() => { if (open) { setTray(slides); setProblem(null) } }, [open, slides])

  const approvedUrls = useMemo(() => new Set(approved.map(s => s.url)), [approved])
  /** what is in the tray that the client has never seen */
  const unapproved = useMemo(
    () => tray.filter(s => !approvedUrls.has(s.url)), [tray, approvedUrls])

  const library: Slide[] = useMemo(() => {
    if (source === 'approved') return approved
    if (source === 'drive') return []
    return brought.filter(s => !approvedUrls.has(s.url))
  }, [source, approved, brought, approvedUrls])

  /* ── Google Drive ─────────────────────────────────────────────────────── */

  useEffect(() => {
    if (!open || source !== 'drive' || drive !== null) return
    let cancelled = false
    setBusy(true)
    fetch(`/api/social/schedule/drive?itemId=${encodeURIComponent(itemId)}`)
      .then(r => r.json())
      .then(json => {
        if (cancelled) return
        if (json?.error) { setDriveNote(String(json.error)); setDrive([]) }
        else { setDrive((json?.files ?? []) as DriveRow[]); setDriveNote(null) }
      })
      .catch(() => {
        if (!cancelled) {
          setDriveNote(friendlyError('', 'Google Drive'))
          setDrive([])
        }
      })
      .finally(() => { if (!cancelled) setBusy(false) })
    return () => { cancelled = true }
  }, [open, source, drive, itemId])

  const bringAcross = async (row: DriveRow) => {
    setBusy(true); setProblem(null)
    try {
      const res = await fetch('/api/social/schedule/drive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ item_id: itemId, file_ids: [row.id] }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(String(json?.error ?? 'Could not bring that file across'))
      const files = (json?.files ?? []) as Slide[]
      setBrought(b => [...files, ...b])
      setTray(t => files.reduce((acc, f) => addToPost(acc, f), t))
    } catch (e) {
      setProblem(friendlyError(e instanceof Error ? e.message : '', 'Google Drive'))
    } finally {
      setBusy(false)
    }
  }

  /* ── uploads ──────────────────────────────────────────────────────────── */

  const takeFiles = useCallback(async (chosen: File[]) => {
    if (chosen.length === 0) return
    setProblem(null)
    try {
      const { done } = uploadFiles(chosen, { group: uploadGroup, purpose: 'social' })
      const landed = await done
      const files: Slide[] = landed.map(({ file, url }) => ({
        url,
        name: file.name,
        type: file.type.startsWith('video/') ? 'video' : slideTypeFromUrl(url),
        bytes: file.size,
      }))
      setBrought(b => [...files, ...b])
      setTray(t => files.reduce((acc, f) => addToPost(acc, f), t))
    } catch (e) {
      setProblem(friendlyError(e instanceof Error ? e.message : '', 'the upload'))
    }
  }, [uploadGroup])

  useEffect(() => () => clearGroup(uploadGroup), [uploadGroup])

  if (!open) return null

  /* ── drag and drop ────────────────────────────────────────────────────── */

  const dragOut = (e: React.DragEvent, slide: Slide, from: number | null) => {
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData(DRAG_TYPE, JSON.stringify({ slide, from }))
    // Firefox will not start a drag without something on text/plain
    e.dataTransfer.setData('text/plain', slide.name)
  }

  const readDrag = (e: React.DragEvent): { slide: Slide; from: number | null } | null => {
    try {
      const raw = e.dataTransfer.getData(DRAG_TYPE)
      return raw ? JSON.parse(raw) as { slide: Slide; from: number | null } : null
    } catch { return null }
  }

  const dropOn = (e: React.DragEvent, at: number | 'tray') => {
    e.preventDefault()
    setOver(null)
    const payload = readDrag(e)
    if (!payload) return
    const { slide, from } = payload
    if (at === 'tray') {
      setTray(t => (from === null ? addToPost(t, slide) : t))
      return
    }
    setTray(t => (from === null ? addToPost(t, slide, at) : moveInPost(t, from, at)))
  }

  const limits = limitsLine(platforms, tray)

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Add media"
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/55 p-4"
    >
      <div className="flex max-h-full w-full max-w-[960px] overflow-hidden rounded-card bg-surface shadow-xl md:h-[600px]">

        {/* ── left: the library ── */}
        <div className="hidden w-[380px] shrink-0 flex-col gap-3 border-r border-border bg-paper p-4 md:flex">
          <div className="flex gap-2">
            {SOURCES.map(s => (
              <button
                key={s.key}
                type="button"
                aria-pressed={source === s.key}
                onClick={() => setSource(s.key)}
                className={cn(
                  'flex min-h-11 items-center gap-1.5 rounded-full border px-3 text-[13px] font-semibold transition-colors',
                  source === s.key
                    ? 'border-foreground bg-foreground text-background'
                    : 'border-border bg-surface hover:bg-muted',
                )}
              >
                {s.key === 'approved' && <Check className="h-3.5 w-3.5" strokeWidth={2.2} aria-hidden />}
                {s.key === 'drive' && <FolderOpen className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />}
                {s.key === 'upload' && <Upload className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />}
                {s.label}
              </button>
            ))}
          </div>

          {source === 'approved' && (
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-[13px] font-semibold">{versionLabel}</span>
              <span className="shrink-0 text-[12px] font-semibold text-muted-foreground">
                {approved.length} {approved.length === 1 ? 'file' : 'files'}
              </span>
            </div>
          )}

          <div className="min-h-0 flex-1 overflow-y-auto">
            {source === 'drive' ? (
              <DriveTab
                rows={drive}
                note={driveNote}
                busy={busy}
                inTray={url => inPost(tray, url)}
                onBring={bringAcross}
              />
            ) : source === 'upload' ? (
              <UploadTab
                uploads={uploads}
                onFiles={takeFiles}
                files={library}
                onAdd={s => setTray(t => addToPost(t, s))}
                inTray={url => inPost(tray, url)}
                onDragStart={dragOut}
              />
            ) : (
              <LibraryGrid
                files={library}
                inTray={url => inPost(tray, url)}
                onAdd={s => setTray(t => addToPost(t, s))}
                onDragStart={dragOut}
                empty="Nothing approved on this piece yet."
              />
            )}
          </div>

          {source !== 'drive' && (
            <p className="text-[12px] text-muted-foreground">{PICKER_LIBRARY_HELP}</p>
          )}
          <p className="text-[12px] text-muted-foreground">{NEW_VERSION_NOTICE}</p>
        </div>

        {/* ── right: the post ── */}
        <div className="flex min-w-0 flex-1 flex-col gap-3 p-4 sm:p-5">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-section-title">Add media</h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="flex h-11 w-11 items-center justify-center rounded-full hover:bg-muted"
            >
              <X className="h-[18px] w-[18px]" strokeWidth={2} aria-hidden />
            </button>
          </div>
          <p className="text-[13px] text-muted-foreground">{PICKER_HELP}</p>

          {/* the library, on a phone, above the tray — a 380px column and a
              390px screen do not both fit */}
          <div className="md:hidden">
            <div className="flex gap-2 overflow-x-auto pb-2">
              {SOURCES.map(s => (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => setSource(s.key)}
                  className={cn(
                    'min-h-11 shrink-0 rounded-full border px-3 text-[13px] font-semibold',
                    source === s.key
                      ? 'border-foreground bg-foreground text-background'
                      : 'border-border bg-surface',
                  )}
                >
                  {s.label}
                </button>
              ))}
            </div>
            <div className="max-h-[180px] overflow-y-auto">
              {source === 'drive' ? (
                <DriveTab
                  rows={drive} note={driveNote} busy={busy}
                  inTray={url => inPost(tray, url)} onBring={bringAcross}
                />
              ) : source === 'upload' ? (
                <UploadTab
                  uploads={uploads} onFiles={takeFiles}
                  files={library} onAdd={s => setTray(t => addToPost(t, s))}
                  inTray={url => inPost(tray, url)} onDragStart={dragOut}
                />
              ) : (
                <LibraryGrid
                  files={library} inTray={url => inPost(tray, url)}
                  onAdd={s => setTray(t => addToPost(t, s))} onDragStart={dragOut}
                  empty="Nothing approved on this piece yet."
                />
              )}
            </div>
          </div>

          <div
            onDragOver={e => { e.preventDefault(); setOver('tray') }}
            onDragLeave={() => setOver(o => (o === 'tray' ? null : o))}
            onDrop={e => dropOn(e, 'tray')}
            className={cn(
              'flex min-h-0 flex-1 flex-col gap-3 rounded-inner border-2 border-dashed p-3.5 transition-colors',
              over !== null ? 'border-accent-blue bg-tint-blue' : 'border-accent-blue/45 bg-tint-blue/40',
            )}
          >
            <div className="flex flex-wrap gap-2.5 overflow-y-auto">
              {tray.length === 0 && (
                <p className="text-[13px] text-muted-foreground">
                  Nothing in the post yet. Add a file from the left.
                </p>
              )}
              {tray.map((slide, i) => (
                <div
                  key={`${slide.url}-${i}`}
                  draggable
                  onDragStart={e => dragOut(e, slide, i)}
                  onDragOver={e => { e.preventDefault(); setOver(i) }}
                  onDrop={e => { e.stopPropagation(); dropOn(e, i) }}
                  className={cn(
                    'group relative h-[110px] w-[88px] overflow-hidden rounded-tile border bg-surface',
                    over === i ? 'border-accent-blue ring-2 ring-accent-blue' : 'border-border',
                  )}
                >
                  <Thumb slide={slide} label={slide.name} className="h-full w-full" />
                  <span className="absolute left-1 top-1 flex h-[18px] w-[18px] items-center justify-center rounded-full bg-ink text-[10px] font-bold text-cream">
                    {i + 1}
                  </span>
                  <button
                    type="button"
                    aria-label={`Take ${slide.name} out of the post`}
                    onClick={() => setTray(t => removeFromPost(t, slide.url))}
                    className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-ink/70 text-cream"
                  >
                    <X className="h-3 w-3" strokeWidth={2.4} aria-hidden />
                  </button>
                  {/* the keyboard's version of dragging */}
                  <span className="absolute inset-x-1 bottom-1 flex justify-between">
                    <button
                      type="button"
                      disabled={i === 0}
                      aria-label={`Move ${slide.name} earlier`}
                      onClick={() => setTray(t => moveInPost(t, i, i - 1))}
                      className="flex h-6 w-6 items-center justify-center rounded-full bg-ink/70 text-cream disabled:opacity-30"
                    >
                      <ArrowLeft className="h-3 w-3" strokeWidth={2.4} aria-hidden />
                    </button>
                    <button
                      type="button"
                      disabled={i === tray.length - 1}
                      aria-label={`Move ${slide.name} later`}
                      onClick={() => setTray(t => moveInPost(t, i, i + 1))}
                      className="flex h-6 w-6 items-center justify-center rounded-full bg-ink/70 text-cream disabled:opacity-30"
                    >
                      <ArrowRight className="h-3 w-3" strokeWidth={2.4} aria-hidden />
                    </button>
                  </span>
                </div>
              ))}
            </div>

            <div className="mt-auto">
              {limits && <p className="text-[12px] text-muted-foreground">{limits}</p>}
            </div>
          </div>

          {unapproved.length > 0 && (
            <p className="rounded-inner border border-accent-amber/40 bg-tint-amber px-3 py-2 text-[12px] font-medium">
              {unapproved.length === 1 ? 'One file here has' : `${unapproved.length} files here have`}
              {' '}not been approved by the client. Saving adds
              {unapproved.length === 1 ? ' it' : ' them'} as a new version and asks them.
            </p>
          )}
          {problem && (
            <p className="rounded-inner border border-accent-red/40 bg-tint-red px-3 py-2 text-[12px] font-medium">
              {problem}
            </p>
          )}

          <div className="flex items-center justify-end gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="flex min-h-11 items-center rounded-full border border-border px-4 text-[14px] font-semibold hover:bg-muted"
            >
              Discard changes
            </button>
            <button
              type="button"
              disabled={saving || busy}
              onClick={() => void onSave(tray)}
              className="flex min-h-11 items-center rounded-full bg-foreground px-4 text-[14px] font-semibold text-background disabled:opacity-60"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

/** The grid of files on the left. Faded once they are in the post. */
function LibraryGrid({ files, inTray, onAdd, onDragStart, empty }: {
  files: Slide[]
  inTray: (url: string) => boolean
  onAdd: (slide: Slide) => void
  onDragStart: (e: React.DragEvent, slide: Slide, from: number | null) => void
  empty: string
}) {
  if (files.length === 0) {
    return <p className="px-0.5 text-[13px] text-muted-foreground">{empty}</p>
  }
  return (
    <div className="grid grid-cols-3 gap-2.5">
      {files.map(slide => {
        const used = inTray(slide.url)
        return (
          <button
            key={slide.url}
            type="button"
            draggable
            onDragStart={e => onDragStart(e, slide, null)}
            onClick={() => onAdd(slide)}
            title={used ? `${slide.name} — already in the post` : `Add ${slide.name}`}
            className={cn(
              'relative aspect-square overflow-hidden rounded-tile border border-border bg-foreground/[0.06]',
              used && 'opacity-40',
            )}
          >
            <Thumb slide={slide} label={slide.name} className="h-full w-full" />
            <span className="absolute left-1.5 top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-accent-green text-ink">
              <Check className="h-2.5 w-2.5" strokeWidth={3.5} aria-hidden />
            </span>
          </button>
        )
      })}
    </div>
  )
}

/** Files in the piece's Google Drive folder. They are not in the post until
 *  they have been copied across, so the button says what it does. */
function DriveTab({ rows, note, busy, inTray, onBring }: {
  rows: DriveRow[] | null
  note: string | null
  busy: boolean
  inTray: (url: string) => boolean
  onBring: (row: DriveRow) => void
}) {
  if (note) return <p className="px-0.5 text-[13px] text-muted-foreground">{note}</p>
  if (rows === null || busy) {
    return <p className="px-0.5 text-[13px] text-muted-foreground">Looking in Drive…</p>
  }
  if (rows.length === 0) {
    return <p className="px-0.5 text-[13px] text-muted-foreground">No pictures or video in that Drive folder.</p>
  }
  return (
    <ul className="flex flex-col gap-1.5">
      {rows.map(row => (
        <li key={row.id}>
          <button
            type="button"
            onClick={() => onBring(row)}
            disabled={busy}
            className="flex min-h-11 w-full items-center gap-2 rounded-tile border border-border bg-surface px-2.5 text-left text-[13px] hover:bg-muted disabled:opacity-60"
          >
            <FolderOpen className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.8} aria-hidden />
            <span className="min-w-0 flex-1 truncate">{row.name}</span>
            <span className="shrink-0 text-[12px] font-semibold text-muted-foreground">
              {inTray(row.id) ? 'Added' : 'Bring across'}
            </span>
          </button>
        </li>
      ))}
    </ul>
  )
}

/** Files from this computer. They land in storage first, then in the tray. */
function UploadTab({ uploads, onFiles, files, onAdd, inTray, onDragStart }: {
  uploads: ReturnType<typeof useUploadGroup>
  onFiles: (files: File[]) => void
  files: Slide[]
  onAdd: (slide: Slide) => void
  inTray: (url: string) => boolean
  onDragStart: (e: React.DragEvent, slide: Slide, from: number | null) => void
}) {
  return (
    <div className="flex flex-col gap-3">
      <label
        onDragOver={e => e.preventDefault()}
        onDrop={e => {
          e.preventDefault()
          onFiles([...(e.dataTransfer.files ?? [])])
        }}
        className="flex min-h-[88px] cursor-pointer flex-col items-center justify-center gap-1 rounded-inner border-2 border-dashed border-border px-3 text-center text-[13px] text-muted-foreground hover:bg-muted"
      >
        <Upload className="h-4 w-4" strokeWidth={1.8} aria-hidden />
        Drop files here, or choose them
        <input
          type="file"
          multiple
          accept="image/*,video/*"
          className="sr-only"
          onChange={e => {
            onFiles([...(e.target.files ?? [])])
            e.target.value = ''
          }}
        />
      </label>
      <UploadRows uploads={uploads} onDismiss={dismissUpload} compact />
      <LibraryGrid
        files={files}
        inTray={inTray}
        onAdd={onAdd}
        onDragStart={onDragStart}
        empty="Nothing uploaded here yet."
      />
    </div>
  )
}
