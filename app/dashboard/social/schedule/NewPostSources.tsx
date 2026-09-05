'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Check, FolderOpen, Search, Upload, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { mayApproveWithoutClient, NOT_CLIENT_APPROVED } from '@/app/lib/social-schedule-core'
import {
  CLIENT_SIGNS_OFF_UPLOAD_NOTE, firstSource, newPostSources, refusedFilesLine,
  uploadOutcomeLine, UPLOAD_ACCEPT, usableUploadFiles,
  type NewPostSourceKey, type UploadedPostSummary,
} from '@/app/lib/schedule-upload-core'
import { friendlyError } from '@/app/lib/support-core'
import { formatInZone } from '@/app/lib/timezone-core'
import { slideTypeFromUrl, type Slide } from '@/app/lib/version-files-core'
import { clearGroup, dismissUpload, uploadFiles } from '../../uploadQueue'
import { UploadRows, useUploadGroup } from '../../UploadRows'
import { Thumb } from './tiles'
import type { RailMedia } from './useSchedulePosts'

/**
 * NEW POST — THE MEDIA COMES FIRST.
 *
 * This window used to be a list of PIECES. On a workspace with no pieces it
 * showed "Nothing here yet" and stopped, which read as a feature that did not
 * exist: the owner's words were "there should be no approval they should
 * simply be here upload media, upload drive files any media".
 *
 * So the first thing it offers is the file: drag photos or video in, or take
 * one out of the client's Google Drive folder. Approved media — the pieces
 * that already exist — is the third tab, offered only when there is some.
 *
 * The piece a post has to hang off is still made, but the app makes it, and
 * nobody here is asked about it. What that costs a person is stated plainly at
 * the bottom before they press anything: an account manager's post goes out
 * with nothing waiting on anybody; everybody else's waits for the manager's
 * check, exactly as it does today.
 */
export default function NewPostSources({
  clientId, media, at, tz, role, postWithoutApproval, clientSignsOff, driveAvailable,
  onPick, onApprove, onCreated, onClose,
}: {
  clientId: string | null
  media: RailMedia[]
  /** the time the click meant, carried through to the composer */
  at: string | null
  tz: string
  role: string | null
  /** this person may post with no approval step in the way */
  postWithoutApproval: boolean
  /** …unless this client signs every post off themselves */
  clientSignsOff: boolean
  /** the client has a Drive folder we can read — no folder, no tab */
  driveAvailable: boolean
  onPick: (media: RailMedia) => void
  onApprove: (media: RailMedia) => void
  /** the upload became a post: open the composer on it */
  onCreated: (made: UploadedPostSummary) => void
  onClose: () => void
}) {
  const sources = useMemo(
    () => newPostSources({ driveAvailable, approvedCount: media.length }),
    [driveAvailable, media.length])
  const [source, setSource] = useState<NewPostSourceKey>(() => firstSource(sources))
  const [q, setQ] = useState('')
  const [chosen, setChosen] = useState<Slide[]>([])
  const [problem, setProblem] = useState<string | null>(null)
  /** making the post — the one thing that blocks the footer */
  const [busy, setBusy] = useState(false)
  /** …and reading the Drive folder, which must not look like the same wait */
  const [loadingDrive, setLoadingDrive] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  const group = useMemo(() => `new-post:${clientId ?? 'none'}`, [clientId])
  const uploads = useUploadGroup(group)
  useEffect(() => () => clearGroup(group), [group])

  useEffect(() => {
    box.current?.focus()
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', esc)
    return () => document.removeEventListener('keydown', esc)
  }, [onClose])

  /* ── the files somebody picked ────────────────────────────────────────── */

  const takeFiles = useCallback(async (files: File[]) => {
    const { keep, refused } = usableUploadFiles(files)
    setProblem(refusedFilesLine(refused))
    if (keep.length === 0) return
    try {
      const { done } = uploadFiles(keep as unknown as File[], { group, purpose: 'social' })
      const landed = await done
      setChosen(prev => [...prev, ...landed.map(({ file, url }) => ({
        url,
        name: file.name,
        type: file.type.startsWith('video/') ? 'video' as const : slideTypeFromUrl(url),
        bytes: file.size,
        source: 'upload' as const,
      }))])
    } catch (e) {
      setProblem(friendlyError(e instanceof Error ? e.message : '', 'the upload'))
    }
  }, [group])

  /* ── Google Drive: read only, always ──────────────────────────────────── */

  type DriveRow = { id: string; name: string; type: 'image' | 'video'; bytes: number | null }
  const [drive, setDrive] = useState<DriveRow[] | null>(null)
  const [driveNote, setDriveNote] = useState<string | null>(null)
  const [bringing, setBringing] = useState<string | null>(null)

  useEffect(() => {
    if (source !== 'drive' || drive !== null || !clientId) return
    let cancelled = false
    setLoadingDrive(true)
    fetch(`/api/social/schedule/drive?clientId=${encodeURIComponent(clientId)}`)
      .then(r => r.json())
      .then(json => {
        if (cancelled) return
        if (json?.error) { setDriveNote(String(json.error)); setDrive([]) }
        else { setDrive((json?.files ?? []) as DriveRow[]); setDriveNote(null) }
      })
      .catch(() => {
        if (!cancelled) { setDriveNote(friendlyError('', 'Google Drive')); setDrive([]) }
      })
      .finally(() => { if (!cancelled) setLoadingDrive(false) })
    return () => { cancelled = true }
  }, [source, drive, clientId])

  const bringAcross = async (row: DriveRow) => {
    if (!clientId) return
    setBringing(row.id)
    setProblem(null)
    try {
      const res = await fetch('/api/social/schedule/drive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: clientId, file_ids: [row.id] }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(String(json?.error ?? 'Could not bring that file across'))
      const files = ((json?.files ?? []) as Slide[])
      setChosen(prev => [...prev, ...files])
    } catch (e) {
      setProblem(friendlyError(e instanceof Error ? e.message : '', 'Google Drive'))
    } finally {
      setBringing(null)
    }
  }

  /* ── …and the post they came for ──────────────────────────────────────── */

  const makeThePost = async () => {
    if (!clientId || chosen.length === 0) return
    setBusy(true)
    setProblem(null)
    try {
      const res = await fetch('/api/social/schedule/from-upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: clientId, files: chosen, scheduled_for: at }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        const list = Array.isArray(json?.problems) ? json.problems as string[] : []
        setProblem(list[0] ?? friendlyError(String(json?.error ?? ''), 'Schedule'))
        return
      }
      onCreated({
        itemId: String(json.item_id),
        postId: String(json.post?.id ?? ''),
        title: String(json.item_title ?? 'Post'),
        contentType: String(json.content_type ?? ''),
        slides: (json.post?.slides ?? chosen) as Slide[],
        needsApproval: Boolean(json.needs_approval),
      })
    } catch {
      setProblem(friendlyError('', 'Schedule'))
    } finally {
      setBusy(false)
    }
  }

  /* ── the approved grid, as it was ─────────────────────────────────────── */

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const rows = needle ? media.filter(m => m.title.toLowerCase().includes(needle)) : media
    return [...rows].sort((a, b) =>
      Number(b.ok) - Number(a.ok)
      || Number(a.used) - Number(b.used)
      || b.updatedAt.localeCompare(a.updatedAt))
  }, [media, q])

  const when = at ? formatInZone(at, tz, 'full') : null
  const uploading = uploads.some(u => u.status !== 'done' && u.status !== 'failed')

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="New post"
      onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}
      className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-ink/55 p-3 sm:items-center sm:p-6"
    >
      <div
        ref={box}
        tabIndex={-1}
        className="flex max-h-full w-full max-w-[720px] flex-col gap-3.5 rounded-card bg-surface p-4 shadow-xl outline-none sm:p-5"
      >
        <div className="flex items-start justify-between gap-2">
          <div className="flex flex-col">
            <h2 className="text-section-title">New post</h2>
            <p className="text-[13px] text-muted-foreground">
              {when ? `What goes out on ${when}?` : 'Pick the photos or video that go out.'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full hover:bg-muted"
          >
            <X className="h-[18px] w-[18px]" strokeWidth={2} aria-hidden />
          </button>
        </div>

        {/* the sources, upload first */}
        <div className="flex flex-wrap gap-2">
          {sources.map(s => (
            <button
              key={s.key}
              type="button"
              aria-pressed={source === s.key}
              onClick={() => setSource(s.key)}
              className={cn(
                'flex min-h-11 items-center gap-1.5 rounded-full border px-4 text-[13px] font-semibold transition-colors',
                source === s.key
                  ? 'border-foreground bg-foreground text-background'
                  : 'border-border bg-paper hover:bg-muted',
              )}
            >
              {s.key === 'upload' && <Upload className="h-4 w-4" strokeWidth={2} aria-hidden />}
              {s.key === 'drive' && <FolderOpen className="h-4 w-4" strokeWidth={2} aria-hidden />}
              {s.key === 'approved' && <Check className="h-4 w-4" strokeWidth={2.2} aria-hidden />}
              {s.label}
            </button>
          ))}
        </div>
        <p className="text-[12px] text-muted-foreground">
          {sources.find(s => s.key === source)?.help}
        </p>

        {problem && (
          <p className="rounded-inner border border-accent-red/40 bg-tint-red px-3 py-2 text-[12px] font-medium">
            {problem}
          </p>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto">
          {source === 'upload' ? (
            <div className="flex flex-col gap-3">
              <label
                onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy' }}
                onDrop={e => {
                  e.preventDefault()
                  void takeFiles(Array.from(e.dataTransfer.files ?? []))
                }}
                className="flex min-h-[132px] cursor-pointer flex-col items-center justify-center gap-2 rounded-card border-2 border-dashed border-border bg-paper px-4 py-6 text-center hover:bg-muted"
              >
                <Upload className="h-6 w-6 text-muted-foreground" strokeWidth={1.8} aria-hidden />
                <span className="text-[14px] font-semibold">Drop photos or video here</span>
                <span className="text-[12px] text-muted-foreground">or browse your computer</span>
                <input
                  ref={fileInput}
                  type="file"
                  multiple
                  accept={UPLOAD_ACCEPT}
                  className="sr-only"
                  onChange={e => {
                    void takeFiles(Array.from(e.target.files ?? []))
                    e.target.value = ''
                  }}
                />
              </label>
              <UploadRows uploads={uploads} onDismiss={dismissUpload} />
              <ChosenStrip files={chosen} onRemove={i => setChosen(c => c.filter((_, n) => n !== i))} />
            </div>
          ) : source === 'drive' ? (
            <div className="flex flex-col gap-2">
              {driveNote && (
                <p className="rounded-inner border border-border bg-paper px-3 py-2 text-[12px]">
                  {driveNote}
                </p>
              )}
              {drive === null || loadingDrive ? (
                <p className="py-6 text-center text-[13px] text-muted-foreground">Looking in Drive…</p>
              ) : drive.length === 0 && !driveNote ? (
                <p className="py-6 text-center text-[13px] text-muted-foreground">
                  Nothing to post in this client’s Drive folder.
                </p>
              ) : (
                drive.map(row => (
                  <div
                    key={row.id}
                    className="flex items-center gap-3 rounded-inner border border-border bg-paper px-3 py-2"
                  >
                    <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{row.name}</span>
                    <span className="shrink-0 text-[11px] font-semibold uppercase text-muted-foreground">
                      {row.type}
                    </span>
                    <button
                      type="button"
                      disabled={bringing === row.id}
                      onClick={() => void bringAcross(row)}
                      className="min-h-11 shrink-0 rounded-full border border-border bg-surface px-4 text-[13px] font-semibold hover:bg-muted disabled:opacity-60"
                    >
                      {bringing === row.id ? 'Copying…' : 'Use this'}
                    </button>
                  </div>
                ))
              )}
              <ChosenStrip files={chosen} onRemove={i => setChosen(c => c.filter((_, n) => n !== i))} />
            </div>
          ) : (
            <>
              <label className="relative mb-3 flex items-center">
                <Search
                  className="pointer-events-none absolute left-3.5 h-4 w-4 text-muted-foreground"
                  strokeWidth={1.8}
                  aria-hidden
                />
                <span className="sr-only">Search the media</span>
                <input
                  value={q}
                  onChange={e => setQ(e.target.value)}
                  placeholder="Search by name"
                  className="min-h-11 w-full rounded-full border border-border bg-paper pl-10 pr-4 text-[14px] outline-none"
                />
              </label>
              {shown.length === 0 ? (
                <p className="py-6 text-center text-[13px] text-muted-foreground">
                  Nothing matches that.
                </p>
              ) : (
                <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                  {shown.map(m => (
                    <div
                      key={m.itemId}
                      className={cn(
                        'group relative flex aspect-[4/5] flex-col overflow-hidden rounded-tile border border-border bg-foreground/[0.06] text-left',
                        m.ok ? 'hover:shadow-md' : 'border-dashed',
                      )}
                    >
                      <button
                        type="button"
                        disabled={!m.ok}
                        onClick={() => onPick(m)}
                        title={m.ok
                          ? (m.needsClientApproval ? `${m.title} — ${NOT_CLIENT_APPROVED}` : m.title)
                          : `${m.title} — ${m.reason}`}
                        aria-label={m.ok ? `Choose ${m.title}` : `${m.title} — ${m.reason}`}
                        className="absolute inset-0 z-0 disabled:cursor-not-allowed"
                      />
                      <Thumb
                        slide={m.cover}
                        label={m.title}
                        className={cn('pointer-events-none h-full w-full', !m.ok && 'opacity-45')}
                      />
                      {/* waiting on somebody, and this person could be that
                          somebody: one press signs it off, after one question */}
                      {!m.ok && mayApproveWithoutClient(role, m.status, m.clientSignsOff) && (
                        <button
                          type="button"
                          onClick={() => onApprove(m)}
                          className="absolute inset-x-1.5 bottom-[46px] z-10 flex min-h-11 items-center justify-center rounded-full bg-cream px-2 text-center text-[11px] font-semibold leading-[1.2] text-ink hover:opacity-90"
                        >
                          Approve without client
                        </button>
                      )}
                      <span className="pointer-events-none absolute inset-x-0 bottom-0 bg-ink/70 px-1.5 py-1 text-[11px] font-semibold text-cream">
                        <span className="block truncate">{m.title}</span>
                        {!m.ok && m.reason && (
                          <span className="block truncate font-normal text-cream/80">{m.reason}</span>
                        )}
                        {m.ok && m.needsClientApproval && (
                          <span className="block truncate font-normal text-cream/80">
                            {NOT_CLIENT_APPROVED}
                          </span>
                        )}
                        {m.ok && m.used && (
                          <span className="block truncate font-normal text-cream/80">
                            Already has a post
                          </span>
                        )}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        <p className="text-[12px] text-muted-foreground">
          {clientSignsOff
            ? CLIENT_SIGNS_OFF_UPLOAD_NOTE
            : uploadOutcomeLine(postWithoutApproval)}
        </p>

        {source !== 'approved' && (
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="min-h-11 rounded-full border border-border bg-surface px-4 text-[13px] font-semibold hover:bg-muted"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={chosen.length === 0 || busy || uploading}
              onClick={() => void makeThePost()}
              className="min-h-11 rounded-full bg-foreground px-5 text-[13px] font-semibold text-background transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {busy ? 'Setting it up…' : uploading ? 'Uploading…'
                : chosen.length > 1 ? `Use these ${chosen.length} files` : 'Use this file'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

/** What is going into the post, with a way to take one back out. */
function ChosenStrip({ files, onRemove }: {
  files: Slide[]
  onRemove: (index: number) => void
}) {
  if (files.length === 0) return null
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[12px] font-semibold">
        In this post · {files.length}
      </span>
      <div className="flex flex-wrap gap-2">
        {files.map((f, i) => (
          <div
            key={`${f.url}-${i}`}
            className="relative h-[72px] w-[72px] overflow-hidden rounded-tile border border-border bg-foreground/[0.06]"
          >
            <Thumb slide={f} label={f.name} className="h-full w-full" />
            <button
              type="button"
              onClick={() => onRemove(i)}
              aria-label={`Remove ${f.name}`}
              className="absolute right-0.5 top-0.5 flex h-7 w-7 items-center justify-center rounded-full bg-ink/70 text-cream hover:bg-ink"
            >
              <X className="h-3.5 w-3.5" strokeWidth={2.4} aria-hidden />
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
