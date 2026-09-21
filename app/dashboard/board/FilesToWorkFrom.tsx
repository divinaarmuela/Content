'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Columns2, Download, ExternalLink, Film, FolderOpen, Play, Plus, X } from 'lucide-react'
import { downloadHref } from '../../lib/download-core'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import SafeVideo from '../../components/media/SafeVideo'
import VideoTile from '../../components/media/VideoTile'
import DriveFolderFiles from './DriveFolderFiles'
import DrivePullBar from './DrivePullBar'
import { filesOf, type PullFile } from '../../lib/drive-pull-core'
import { uploadFiles } from '../uploadQueue'
import { driveTargetOf, finishedEditOf, linkKindOf } from '../../lib/card-link-core'
import { finishedVersionsOf, handInRound, roundLabel } from '../../lib/edit-round-core'
import { finalFilesAsPulls } from '../../lib/final-files-core'
import { useTable } from '@/lib/db-client'
import type { DrivePull } from '@/lib/db-types'
import {
  FILES_TO_WORK_FROM, filesToWorkFromWords, mergeRawAssets, rawAssetKind, readRawAssets, withoutRawAsset,
  type RawAsset,
} from '../../lib/raw-assets-core'

/**
 * FILES TO WORK FROM — what a manager hands the editor.
 *
 * The owner, 11 Sep 2026: "Abby (super admin) will assign an editor to edit
 * and she will show the files there". Footage, stills and references, or a
 * Drive/Dropbox folder link, kept on the card ABOVE the editor's own
 * versions and separate from them. A manager adds and removes; the editor
 * sees, opens and downloads. Stored as the card's raw assets, so the job
 * pack email and the Drive mirror already know the shape.
 *
 * SEE IT HERE (the owner, 15 Sep 2026: "display files as their thumbnail
 * and play it from there"): every tile is a picture of the file — the image
 * itself, or Cloudflare's still of the clip (VideoTile: a still, never a
 * `<video>`, so ten tiles are not ten downloads) — and pressing it opens the
 * file above the grid, where a clip plays (SafeVideo, mounted only on the
 * press) and a still shows large. Open still downloads the file.
 */
export default function FilesToWorkFrom({ item, isManager, frozen, linkOnly = false, showFolderFiles = true, fallbackFolder = null, wideFiles = false, holder = false, reviewHref, approvedIds, versions = false, filesOnly = false }: {
  item: { id: string; raw_assets?: unknown; raw_assets_url?: string | null; link_url?: string | null; link_kind?: string | null; link_final?: boolean | null; adhoc_post?: boolean | null; final_files?: unknown }
  isManager: boolean
  /** booked in or posted: the work is done, nothing more is added */
  frozen: boolean
  /** the maker's drawer (the owner, 15 Sep 2026: "not files"): a manager
   *  holding their own card adds the folder link, never files */
  linkOnly?: boolean
  /** A DESIGNER'S CARD (the owner, 17 Sep 2026: "for designers it's files, not
   *  Drive links — when they create a card, files to work from"): the files
   *  are added by whoever holds or manages the card, and there is no folder link */
  filesOnly?: boolean
  /** the files behind a Drive folder link, as tiles (15 Sep 2026) — off where
   *  the drawer already draws them under its own Footage folder line */
  showFolderFiles?: boolean
  /** the shoot's footage folder, shown when the card carries none of its own (15 Sep 2026) */
  fallbackFolder?: string | null
  /** the card's page: more tiles across */
  wideFiles?: boolean
  /** the card's page: a press on a clip opens its review page (15 Sep 2026) */
  reviewHref?: (tile: { id: string; name: string }) => string
  /** the clips the client approved on their editing portal (16 Sep 2026) */
  approvedIds?: string[]
  /** the person holding the card — they may change the folder link too (the
   *  owner, 15 Sep 2026: "allow the editor, or anyone assigned to that card,
   *  or a super admin or AM to replace the folder to work from") */
  holder?: boolean
  /** THE VERSION TABS (the owner, 16 Sep 2026: "on the left there should
   *  automatically be a Version 1 tab they can switch between — the folder to
   *  work from and the submitted final edit"): the card's page draws a tab
   *  per finished edit handed in beside the folder, newest first and open */
  versions?: boolean
}) {
  const files = readRawAssets(item.raw_assets)
  const folder = item.raw_assets_url ?? fallbackFolder ?? null
  const [busy, setBusy] = useState<string | null>(null)
  const [linkOpen, setLinkOpen] = useState(false)
  const [link, setLink] = useState(folder ?? '')
  useEffect(() => { setLink(folder ?? '') }, [folder])
  const input = useRef<HTMLInputElement | null>(null)
  const linkCheck = linkKindOf(link)
  const mayEdit = (isManager || holder) && !frozen
  // files are the manager's to add; the holder changes the folder link only
  const mayAddFiles = filesOnly ? (isManager || holder) && !frozen : isManager && !linkOnly && !frozen
  /** the file open above the grid — a clip playing, or a still shown large */
  const [showing, setShowing] = useState<RawAsset | null>(null)
  useEffect(() => { setShowing(null) }, [item.id])

  const save = async (patch: Record<string, unknown>, said: string) => {
    const res = await fetch(`/api/production/items/${item.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch),
    })
    if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error ?? 'Could not save that')
    toast.success(said)
  }
  const add = async (picked: File[]) => {
    if (picked.length === 0) return
    setBusy(`Uploading ${picked.length} ${picked.length === 1 ? 'file' : 'files'}`)
    try {
      const { done } = uploadFiles(picked, { purpose: 'social' })
      const landed = await done
      const added: RawAsset[] = landed.map(({ file, url }) => ({ url, name: file.name }))
      await save({ raw_assets: mergeRawAssets(files, added) }, `${added.length} ${added.length === 1 ? 'file' : 'files'} added — the editor has been told`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Upload failed')
    } finally {
      setBusy(null)
      if (input.current) input.current.value = ''
    }
  }
  const remove = async (url: string) => {
    setBusy('Removing')
    try {
      await save({ raw_assets: withoutRawAsset(files, url) }, 'Removed')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not remove it')
    } finally { setBusy(null) }
  }
  const saveLink = async () => {
    const url = link.trim()
    if (url && !linkCheck.ok) { toast.error(linkCheck.reason); return }
    setBusy('Saving the link')
    try {
      await save({ raw_assets_url: url || null }, url ? 'Folder link saved — the editor has been told' : 'Folder link removed')
      setLinkOpen(false)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save the link')
    } finally { setBusy(null) }
  }

  // THE PULL (16 Sep 2026): the folder's copies in our storage, with the bar
  // while they land; once they are all here they are the files box, and
  // Drive's own tiles step aside
  const [pulled, setPulled] = useState<PullFile[]>([])
  // THE VERSIONS HANDED IN (16 Sep 2026): the card's pull rows, live, one tab
  // per round; the newest opens first — that is what everyone came to see
  const { rows: pullRows } = useTable<DrivePull>('drive_pulls', { by: { scope_id: item.id } as never, enabled: versions })
  const finished = finishedEditOf(item)
  const versionTabs = versions
    ? finishedVersionsOf<PullFile>([...pullRows, { id: 'uploads', kind: 'item', scope_id: item.id, folder_id: 'uploads', folder_url: '', status: 'done', purpose: 'finished', files: finalFilesAsPulls(item), started_at: '' }] as never, { itemId: item.id, finishedFolderId: driveTargetOf(finished?.url)?.id ?? null, filesOf: r => filesOf(r), currentRound: handInRound(item as never) })
    : []
  const [tab, setTab] = useState<'folder' | number | null>(null)
  useEffect(() => { setTab(null) }, [item.id])
  // SELECT MODE (the owner, 16 Sep 2026: "a select view where I can choose
  // videos, as many as I want, and see them side by side with their
  // comments across all the versions"): the picks survive a switch between
  // the folder tab and the version tabs; Open side by side carries them
  const router = useRouter()
  const [selecting, setSelecting] = useState(false)
  const [picked, setPicked] = useState<Map<string, { id: string; round: number; name: string }>>(() => new Map())
  const pickedKeys = useMemo(() => new Set(picked.keys()), [picked])
  const pick = (t: { id: string; name: string }, round: number, on: boolean) => setPicked(m => { const n = new Map(m); const k = `${t.id}@${round}`; if (on) n.set(k, { id: t.id, round, name: t.name }); else n.delete(k); return n })
  const openSideBySide = () => { if (picked.size === 0) return; router.push(`/dashboard/editor/${item.id}/compare?f=${encodeURIComponent([...picked.values()].map(p => `${p.id}@${p.round}`).join(','))}`) }
  const shownVersion = tab === 'folder' ? null : (tab === null ? versionTabs[0] : versionTabs.find(v => v.round === tab)) ?? null
  const ownFolder = folder === String((item as { raw_assets_url?: string | null }).raw_assets_url ?? '').trim()
  const pullScope = ownFolder ? { kind: 'item' as const, id: item.id } : { kind: 'batch' as const, id: String((item as { batch_id?: string | null }).batch_id ?? '') }
  const button = 'inline-flex h-11 items-center gap-1.5 rounded-full border border-border px-4 text-[13px] font-semibold hover:bg-muted disabled:opacity-50'

  return (
    <div className="flex flex-col gap-3 border-b border-border px-5 py-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">{shownVersion ? `${roundLabel(shownVersion.round)} — the finished edit` : FILES_TO_WORK_FROM}</p>
        {versions && (
          <Button variant="outline" className={`inline-flex h-11 items-center gap-1.5 rounded-full border px-4 text-[13px] font-semibold ${selecting ? 'border-foreground bg-foreground text-background hover:bg-foreground/90' : 'border-border hover:bg-muted'}`}
            aria-pressed={selecting} onClick={() => { setSelecting(s => !s); if (selecting) setPicked(new Map()) }}>
            <Columns2 className="h-4 w-4" aria-hidden /> {selecting ? 'Done picking' : 'Select'}
          </Button>
        )}
        {mayEdit && !shownVersion && (
          <div className="flex flex-wrap gap-2">
            {mayAddFiles && (
              <Button variant="outline" className={button} disabled={busy !== null} onClick={() => input.current?.click()}>
                <Plus className="h-4 w-4" aria-hidden /> Add files
              </Button>
            )}
            {!filesOnly && (
              <Button variant="outline" className={button} disabled={busy !== null} onClick={() => setLinkOpen(o => !o)}>
                <FolderOpen className="h-4 w-4" aria-hidden /> {folder ? 'Change the source working folder' : 'Add the source working folder'}
              </Button>
            )}
            <input ref={input} type="file" multiple accept="image/*,video/*" className="hidden"
              aria-label="Files for the editor to work from"
              onChange={e => { void add(Array.from(e.target.files ?? [])); }} />
          </div>
        )}
      </div>
      {versionTabs.length > 0 && (
        <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label="The folder to work from, and each finished edit" data-version-tabs>
          <button type="button" role="tab" aria-selected={!shownVersion} onClick={() => setTab('folder')}
            className={`inline-flex min-h-10 items-center rounded-full border px-3.5 text-[13px] font-semibold ${!shownVersion ? 'border-foreground bg-foreground text-background' : 'border-border hover:bg-muted'}`}>
            Folder to work from
          </button>
          {versionTabs.map(v => (
            <button key={v.round} type="button" role="tab" aria-selected={shownVersion?.round === v.round} onClick={() => setTab(v.round)}
              className={`inline-flex min-h-10 items-center rounded-full border px-3.5 text-[13px] font-semibold ${shownVersion?.round === v.round ? 'border-foreground bg-foreground text-background' : 'border-border hover:bg-muted'}`}>
              {roundLabel(v.round)}{v === versionTabs[0] ? ' · latest' : ''}{v.inFlight ? ' · copying in' : ''}
            </button>
          ))}
        </div>
      )}
      {shownVersion ? (
        <>
          <p className="text-[13px] text-muted-foreground">
            {shownVersion.files.length > 0
              ? `${shownVersion.files.length} ${shownVersion.files.length === 1 ? 'file' : 'files'} handed in as ${roundLabel(shownVersion.round)}.`
              : `${roundLabel(shownVersion.round)} is being copied in — its files show here as they land.`}
          </p>
          {shownVersion.folderUrl && (
            <a href={shownVersion.folderUrl} target="_blank" rel="noreferrer noopener"
              className="inline-flex min-h-11 w-fit items-center gap-2 rounded-full border border-border px-4 text-[13px] font-semibold hover:bg-muted">
              <FolderOpen className="h-4 w-4" aria-hidden /> Open the finished edit
              <span className="sr-only">, opens in a new tab</span>
            </a>
          )}
          {shownVersion.folderUrl && (
            <DrivePullBar kind="item" scopeId={item.id} folderUrl={shownVersion.folderUrl} which="finished" mayStart={mayEdit && shownVersion.folderUrl === (finished?.url ?? '')} showFiles={false} />
          )}
          {/* an uploaded version has no folder — its files are the copies, drawn as they are (22 Sep 2026: the Version 2 tab was blank) */}
          {(shownVersion.folderUrl || shownVersion.files.length > 0) && (
            <DriveFolderFiles url={shownVersion.folderUrl} wide={wideFiles} reviewHref={reviewHref} approvedIds={approvedIds} copies={shownVersion.files} selected={selecting ? pickedKeys : undefined} onSelect={selecting ? pick : undefined} />
          )}
        </>
      ) : (
      <>
      <p className="text-[13px] text-muted-foreground">{filesToWorkFromWords(files.length, !!folder)}</p>
      {busy && <p role="status" className="text-[13px] text-muted-foreground">{busy}…</p>}

      {linkOpen && mayEdit && (
        <div className="flex flex-col gap-2 rounded-inner border border-border p-3">
          <label htmlFor="work-folder" className="text-[12px] font-semibold">Where the files live — a Google Drive or Dropbox folder</label>
          <input id="work-folder" value={link} onChange={e => setLink(e.target.value)} placeholder="https://drive.google.com/…"
            className="min-h-11 rounded-inner border border-border bg-surface px-3 text-[14px]" />
          {link.trim() !== '' && (
            <p className="text-[12px] text-muted-foreground">{linkCheck.ok ? `This is a ${linkCheck.label} link.` : linkCheck.reason}</p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button className="h-11 rounded-full bg-foreground px-5 text-[14px] font-semibold text-background hover:bg-foreground/90"
              disabled={busy !== null} onClick={() => void saveLink()}>Save the link</Button>
            <Button variant="ghost" className="h-11 rounded-full px-4 text-[14px] font-semibold" onClick={() => setLinkOpen(false)}>Cancel</Button>
          </div>
        </div>
      )}

      {folder && !linkOpen && (
        <a href={folder} target="_blank" rel="noreferrer noopener"
          className="inline-flex min-h-11 w-fit items-center gap-2 rounded-full border border-border px-4 text-[13px] font-semibold hover:bg-muted">
          <FolderOpen className="h-4 w-4" aria-hidden /> Open the folder
          <span className="sr-only">, opens in a new tab</span>
        </a>
      )}
      {folder && !linkOpen && (
        <DrivePullBar kind={pullScope.kind} scopeId={pullScope.id} folderUrl={folder} mayStart={mayEdit && !!pullScope.id} showFiles={false} onPulled={files => setPulled(files)} />
      )}
      {folder && !linkOpen && showFolderFiles && <DriveFolderFiles url={folder} wide={wideFiles} reviewHref={reviewHref} approvedIds={approvedIds} copies={pulled} selected={selecting ? pickedKeys : undefined} onSelect={selecting ? pick : undefined} noRounds pickRound={0} />}

      {showing && (
        <div className="flex flex-col gap-2 rounded-inner border border-border p-2" data-file-viewer>
          <div className="flex items-center justify-between gap-2">
            <span className="truncate text-[13px] font-semibold" title={showing.name}>{showing.name}</span>
            <button type="button" onClick={() => setShowing(null)} aria-label={`Close ${showing.name}`}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full hover:bg-muted">
              <X className="h-4 w-4" aria-hidden />
            </button>
          </div>
          {rawAssetKind(showing) === 'video' ? (
            // the press WAS the play: no second poster to press
            <SafeVideo key={showing.url} src={showing.url} autoStart ariaLabel={showing.name}
              className="max-h-[60vh] w-full rounded-tile bg-zinc-950 object-contain" noticeClassName="w-full" />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={showing.url} alt={showing.name} className="max-h-[60vh] w-full rounded-tile bg-foreground/[0.06] object-contain" />
          )}
        </div>
      )}

      {files.length > 0 && (
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {files.map(f => {
            const kind = rawAssetKind(f)
            const open = showing?.url === f.url
            return (
              <li key={f.url} className={`flex flex-col gap-1 rounded-inner border p-2 ${open ? 'border-foreground' : 'border-border'}`}>
                {kind === 'other' ? (
                  <span className="flex aspect-square w-full items-center justify-center rounded-tile bg-foreground/[0.06] text-muted-foreground">
                    <Film className="h-6 w-6" strokeWidth={1.6} aria-hidden />
                  </span>
                ) : (
                  // the tile is the button: press the picture to see it, or play it, above
                  <button type="button" onClick={() => setShowing(open ? null : f)} aria-pressed={open}
                    aria-label={`${kind === 'video' ? 'Play' : 'See'} ${f.name}`}
                    className="relative block aspect-square w-full overflow-hidden rounded-tile bg-foreground/[0.06] hover:opacity-90">
                    {kind === 'image'
                      // eslint-disable-next-line @next/next/no-img-element
                      ? <img src={f.url} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />
                      : <VideoTile url={f.url} className="h-full w-full" />}
                    {kind === 'video' && (
                      <span className="absolute inset-0 flex items-center justify-center">
                        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-black/60 text-white shadow">
                          <Play className="ml-0.5 h-4 w-4" fill="currentColor" aria-hidden />
                        </span>
                      </span>
                    )}
                  </button>
                )}
                <span className="truncate text-[12px] font-semibold" title={f.name}>{f.name}</span>
                <div className="flex items-center gap-1">
                  <a href={f.url} target="_blank" rel="noreferrer noopener"
                    className="inline-flex min-h-11 items-center gap-1 text-[12px] underline-offset-4 hover:underline">
                    <ExternalLink className="h-3.5 w-3.5" aria-hidden /> Open
                    <span className="sr-only">{f.name}, opens in a new tab</span>
                  </a>
                  {/* a real download — same origin, attachment (download-core, 17 Sep 2026) */}
                  <a href={downloadHref(f) ?? f.url} download={f.name}
                    className="inline-flex min-h-11 flex-1 items-center gap-1 text-[12px] underline-offset-4 hover:underline">
                    <Download className="h-3.5 w-3.5" aria-hidden /> Download
                    <span className="sr-only">{f.name}</span>
                  </a>
                  {mayEdit && (
                    <button type="button" disabled={busy !== null} onClick={() => void remove(f.url)}
                      aria-label={`Remove ${f.name}`}
                      className="flex h-11 w-11 items-center justify-center rounded-full text-muted-foreground hover:bg-muted disabled:opacity-50">
                      <X className="h-4 w-4" aria-hidden />
                    </button>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}
      </>
      )}
      {/* one small pill, never a growing list (the owner, 16 Sep 2026: "the bottom circle is becoming big") */}
      {selecting && (
        <div className="sticky bottom-3 z-30 mx-auto flex w-fit max-w-full items-center gap-3 rounded-full border border-border bg-popover py-1.5 pl-4 pr-1.5 shadow-lg" role="status" aria-live="polite" data-select-bar>
          <span className="whitespace-nowrap text-[13px] font-semibold">{picked.size === 0 ? 'Tick files, from any version' : `${picked.size} picked`}</span>
          <Button className="h-9 rounded-full bg-foreground px-3.5 text-[13px] font-semibold text-background" disabled={picked.size === 0} onClick={openSideBySide}>
            <Columns2 className="mr-1.5 h-4 w-4" aria-hidden /> Side by side
          </Button>
        </div>
      )}
    </div>
  )
}
