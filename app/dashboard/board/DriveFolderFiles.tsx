'use client'

import { useEffect, useState } from 'react'
import { Check, ExternalLink, File, Film, Image as ImageIcon, Play, X } from 'lucide-react'
import type { DriveEntry } from '../../lib/files-core'
import {
  folderFilesWords, folderTilesOf, readableDriveId, readableFolderId, subfolderCount, tileActionWords, type FolderTile,
} from '../../lib/drive-folder-files-core'
import { kindOf } from '../../lib/files-core'
import type { PullFile } from '../../lib/drive-pull-core'
import { fileRound, roundLabel, roundsOf } from '../../lib/edit-round-core'
import HoverClip from '../../components/media/HoverClip'
import { usePreviewRows } from '../../components/media/usePreviewRows'
import { pickPoster, streamThumbnailUrl } from '../../lib/stream-core'

/**
 * THE FILES BEHIND A CARD'S DRIVE LINK, AS TILES (the owner, 15 Sep 2026:
 * "display files as their thumbnail and play it from there" — "the Drive
 * link"). Read only: one listing, Drive's own thumbnails through our proxy,
 * and Drive's own preview when a tile is pressed — Google's player plays the
 * clip, nothing is downloaded here. A Dropbox link, or a link to one file,
 * draws nothing: the card's "Open the folder" link is for those.
 */
export default function DriveFolderFiles({ url, wide = false, reviewHref, approvedIds, copies, selected, onSelect, noRounds = false, pickRound }: {
  /** SELECT MODE (the side-by-side view, 16 Sep 2026): the ticked files, and the press that ticks one */
  selected?: ReadonlySet<string>
  onSelect?: (tile: FolderTile, round: number, on: boolean) => void
  /** THE FOLDER TO WORK FROM HAS NO VERSIONS (the owner, 16 Sep 2026: "what's
   *  this version 1 and version 2 — that is the files to work from"): one
   *  tile per file, whatever round the copy was tagged with, and no pills */
  noRounds?: boolean
  /** the round a pick on this grid is keyed by — 0 for the folder to work from,
   *  so the same file on a version tab is a different pick (16 Sep 2026) */
  pickRound?: number
  url: string | null | undefined
  /** THE CLIP'S OWN PAGE (15 Sep 2026): where a press on a clip goes — the
   *  review page with the comments — instead of Drive's preview on the card */
  reviewHref?: (tile: FolderTile) => string
  /** the clips the client approved on their editing portal — a tick on the tile (16 Sep 2026) */
  approvedIds?: string[]
  /** OUR COPIES (the Drive pull, 16 Sep 2026: "when you click the folder it
   *  opens like now but faster, since we uploaded it"): once the folder has
   *  been pulled in, the tiles are its files in our storage — a picture from
   *  the copy, a clip played from the copy, a Download of the copy — with a
   *  pill per version when the folder holds more than one round */
  copies?: PullFile[]
  /** the card's page: more tiles across, and a bigger player */
  wide?: boolean
}) {
  // a folder to list, or one file whose copy we may hold (16 Sep 2026)
  const folderId = readableFolderId(url)
  const driveId = readableDriveId(url)
  const [state, setState] = useState<
    | { at: 'idle' }
    | { at: 'looking' }
    | { at: 'ready'; tiles: FolderTile[]; folders: number; more: boolean; note: string | null }
    | { at: 'failed'; words: string }
  >({ at: 'idle' })
  const [showing, setShowing] = useState<FolderTile | null>(null)
  const doneAll = (copies ?? []).filter(f => f.status === 'done' && !!f.url)
  const done = noRounds ? doneAll.filter((f, i, arr) => arr.findIndex(o => o.id === f.id) === i).map(f => ({ ...f, version: 1 })) : doneAll
  const rounds = noRounds ? [] : roundsOf(done)
  const pickKeyRound = pickRound ?? null
  const [round, setRound] = useState<number | null>(null)
  const shownRound = round ?? rounds[0] ?? 1
  const copyTiles: FolderTile[] = done
    .filter(f => fileRound(f) === shownRound)
    .map(f => {
      const kind = kindOf(f.mime, f.name)
      return { id: f.id, name: f.name, kind, thumb: kind === 'image' ? (f.url as string) : null, preview: f.url as string, open: f.url as string }
    })
  const fromCopies = done.length > 0
  const isCopy = (t: FolderTile) => fromCopies && done.some(f => f.id === t.id)
  // the preview copies (Cloudflare Stream) of the video copies: a still and
  // hover frames the moment they are ready (16 Sep 2026)
  const previews = usePreviewRows(done.filter(f => kindOf(f.mime, f.name) === 'video').map(f => f.url as string))
  const previewOf = (t: FolderTile) => { const r = previews.get(t.preview); return r && r.state === 'ready' ? r : null }

  useEffect(() => {
    setShowing(null)
    // our copies are here: nothing to ask Drive for
    if (fromCopies) { setState({ at: 'ready', tiles: [], folders: 0, more: false, note: null }); return }
    // one file, not yet copied in: one tile, Drive's own preview
    if (!folderId && driveId) { setState({ at: 'ready', tiles: [{ id: driveId, name: 'The file', kind: 'video', thumb: null, preview: `https://drive.google.com/file/d/${encodeURIComponent(driveId)}/preview`, open: `https://drive.google.com/file/d/${encodeURIComponent(driveId)}/view` }], folders: 0, more: false, note: 'One file — it is copied in as you read this, and shows by name once it is here.' }); return }
    if (!folderId) { setState({ at: 'idle' }); return }
    let live = true
    setState({ at: 'looking' })
    fetch(`/api/drive/children?id=${encodeURIComponent(folderId)}`)
      .then(async res => {
        const json = await res.json().catch(() => ({})) as { entries?: DriveEntry[]; more?: boolean; note?: string | null; error?: string }
        if (!live) return
        if (!res.ok || !Array.isArray(json.entries)) {
          setState({ at: 'failed', words: json.error || 'Could not read the folder just now — open it in Drive.' })
          return
        }
        setState({ at: 'ready', tiles: folderTilesOf(json.entries), folders: subfolderCount(json.entries), more: json.more === true, note: json.note ?? null })
      })
      .catch(() => { if (live) setState({ at: 'failed', words: 'Could not read the folder just now — open it in Drive.' }) })
    return () => { live = false }
  }, [folderId, driveId, fromCopies])

  if (!driveId || state.at === 'idle') return null
  const tiles = fromCopies ? copyTiles : state.at === 'ready' ? state.tiles : []

  return (
    <div className="flex flex-col gap-2" data-drive-folder-files>
      {state.at === 'looking' && <p role="status" className="text-[13px] text-muted-foreground">Looking in the folder…</p>}
      {state.at === 'failed' && <p role="status" className="text-[13px] text-muted-foreground">{state.words}</p>}
      {state.at === 'ready' && (
        <>
          <p className="text-[13px] text-muted-foreground">
            {fromCopies ? `${folderFilesWords(tiles.length, 0)} — from our copy, so they open at once` : `${state.note ?? folderFilesWords(state.tiles.length, state.folders)}${state.more ? ' — the first 60 are shown; open the folder for the rest' : ''}`}
          </p>
          {fromCopies && rounds.length > 1 && (
            <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label="Versions">
              {rounds.map(r => (
                <button key={r} type="button" role="tab" aria-selected={r === shownRound} onClick={() => { setRound(r); setShowing(null) }}
                  className={`inline-flex min-h-9 items-center rounded-full border px-3 text-[12px] font-semibold ${r === shownRound ? 'border-foreground bg-foreground text-background' : 'border-border hover:bg-muted'}`}>
                  {roundLabel(r)}{r === rounds[0] ? ' · latest' : ''}
                </button>
              ))}
            </div>
          )}

          {showing && (
            <div className="flex flex-col gap-2 rounded-inner border border-border p-2" data-drive-file-viewer>
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-[13px] font-semibold" title={showing.name}>{showing.name}</span>
                <div className="flex shrink-0 items-center gap-1">
                  <a href={showing.open} target="_blank" rel="noreferrer noopener" {...(isCopy(showing) ? { download: true } : {})}
                    className="inline-flex min-h-11 items-center gap-1 px-2 text-[12px] underline-offset-4 hover:underline">
                    <ExternalLink className="h-3.5 w-3.5" aria-hidden /> {isCopy(showing) ? 'Download' : 'Open in Drive'}<span className="sr-only">, opens in a new tab</span>
                  </a>
                  <button type="button" onClick={() => setShowing(null)} aria-label={`Close ${showing.name}`}
                    className="flex h-11 w-11 items-center justify-center rounded-full hover:bg-muted">
                    <X className="h-4 w-4" aria-hidden />
                  </button>
                </div>
              </div>
              {/* Drive's own preview: the clip plays here, a still shows large.
                  Mounted only on the press — nothing loads for a tile nobody opened */}
              {isCopy(showing)
                ? showing.kind === 'video'
                  ? <video key={showing.id} src={showing.preview} controls playsInline preload="metadata" className="max-h-[480px] w-full rounded-tile bg-black" />
                  : showing.kind === 'image'
                    // eslint-disable-next-line @next/next/no-img-element -- our own copy
                    ? <img key={showing.id} src={showing.preview} alt={showing.name} className="max-h-[480px] w-full rounded-tile object-contain" />
                    : <p className="p-3 text-[13px] text-muted-foreground">Download it to open it.</p>
                : <iframe key={showing.id} src={showing.preview} title={showing.name} allow="autoplay; fullscreen" allowFullScreen
                    className="aspect-video w-full rounded-tile border-0 bg-zinc-950" />}
            </div>
          )}

          {tiles.length > 0 && (
            <ul className={fromCopies ? 'grid grid-cols-2 gap-3' : wide ? 'grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5' : 'grid grid-cols-2 gap-2 sm:grid-cols-3'}>
              {tiles.map(t => {
                const open = showing?.id === t.id
                const Glyph = t.kind === 'video' ? Film : t.kind === 'image' ? ImageIcon : File
                return (
                  <li key={t.id} className={`relative flex flex-col gap-1 rounded-inner border p-2 ${open || selected?.has(`${t.id}@${pickKeyRound ?? shownRound}`) ? 'border-foreground' : 'border-border'}`}>
                    {onSelect && (t.kind === 'video' || t.kind === 'image') && (
                      <label className="absolute right-3 top-3 z-20 flex h-8 w-8 cursor-pointer items-center justify-center rounded-full bg-white/90 shadow" title="Pick for side by side">
                        <input type="checkbox" className="h-4 w-4 accent-foreground" checked={selected?.has(`${t.id}@${pickKeyRound ?? shownRound}`) ?? false}
                          onChange={e => onSelect(t, pickKeyRound ?? shownRound, e.target.checked)} aria-label={`Pick ${t.name} for side by side`} />
                      </label>
                    )}
                    <button type="button" onClick={() => { if (onSelect) { onSelect(t, pickKeyRound ?? shownRound, !(selected?.has(`${t.id}@${pickKeyRound ?? shownRound}`) ?? false)); return } if (reviewHref && (t.kind === 'video' || t.kind === 'image')) { window.location.assign(reviewHref(t)); return } setShowing(open ? null : t) }} aria-pressed={open}
                      aria-label={`${tileActionWords(t.kind)} ${t.name}`}
                      className={`relative block w-full overflow-hidden rounded-tile bg-foreground/[0.06] hover:opacity-95 ${fromCopies ? 'aspect-[4/5]' : 'aspect-square'}`}>
                      {t.thumb
                        // eslint-disable-next-line @next/next/no-img-element -- proxied, same origin
                        ? <img src={t.thumb} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />
                        : isCopy(t) && t.kind === 'video'
                          // THE CLIP'S OWN FIRST FRAME (16 Sep 2026): our copy is seekable, so
                          // the tile is the clip a moment in, and no picture has to be made
                          ? <HoverClip src={t.preview} className="h-full w-full object-cover" poster={pickPoster(previewOf(t), null)} duration={previewOf(t)?.duration_sec ?? null}
                              frames={previewOf(t) ? (s => streamThumbnailUrl(previewOf(t), { time: `${s}s`, height: 480 }) as string) : null} />
                          : <span className="flex h-full w-full items-center justify-center text-muted-foreground"><Glyph className="h-6 w-6" strokeWidth={1.6} aria-hidden /></span>}
                      {approvedIds?.includes(t.id) && (
                        <span className="absolute left-1.5 top-1.5 z-10 inline-flex items-center gap-1 rounded-full bg-accent-green px-2 py-0.5 text-[11px] font-semibold text-ink shadow" title="Approved by the client">
                          <Check className="h-3 w-3" strokeWidth={3} aria-hidden /> Approved
                        </span>
                      )}
                      {t.kind === 'video' && (
                        <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
                          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-black/60 text-white shadow">
                            <Play className="ml-0.5 h-4 w-4" fill="currentColor" aria-hidden />
                          </span>
                        </span>
                      )}
                    </button>
                    <span className="truncate text-[12px] font-semibold" title={t.name}>{t.name}</span>
                  </li>
                )
              })}
            </ul>
          )}
        </>
      )}
    </div>
  )
}
