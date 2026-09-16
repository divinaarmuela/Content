'use client'

import { useEffect, useState } from 'react'
import { Check, ExternalLink, File, Film, Image as ImageIcon, Play, X } from 'lucide-react'
import type { DriveEntry } from '../../lib/files-core'
import {
  folderFilesWords, folderTilesOf, readableFolderId, subfolderCount, tileActionWords, type FolderTile,
} from '../../lib/drive-folder-files-core'
import { kindOf } from '../../lib/files-core'
import type { PullFile } from '../../lib/drive-pull-core'
import { fileRound, roundLabel, roundsOf } from '../../lib/edit-round-core'
import HoverClip from '../../components/media/HoverClip'

/**
 * THE FILES BEHIND A CARD'S DRIVE LINK, AS TILES (the owner, 15 Sep 2026:
 * "display files as their thumbnail and play it from there" — "the Drive
 * link"). Read only: one listing, Drive's own thumbnails through our proxy,
 * and Drive's own preview when a tile is pressed — Google's player plays the
 * clip, nothing is downloaded here. A Dropbox link, or a link to one file,
 * draws nothing: the card's "Open the folder" link is for those.
 */
export default function DriveFolderFiles({ url, wide = false, reviewHref, approvedIds, copies }: {
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
  const folderId = readableFolderId(url)
  const [state, setState] = useState<
    | { at: 'idle' }
    | { at: 'looking' }
    | { at: 'ready'; tiles: FolderTile[]; folders: number; more: boolean; note: string | null }
    | { at: 'failed'; words: string }
  >({ at: 'idle' })
  const [showing, setShowing] = useState<FolderTile | null>(null)
  const done = (copies ?? []).filter(f => f.status === 'done' && !!f.url)
  const rounds = roundsOf(done)
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

  useEffect(() => {
    setShowing(null)
    if (!folderId) { setState({ at: 'idle' }); return }
    // our copies are here: nothing to ask Drive for
    if (fromCopies) { setState({ at: 'ready', tiles: [], folders: 0, more: false, note: null }); return }
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
  }, [folderId, fromCopies])

  if (!folderId || state.at === 'idle') return null
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
            {/* our copies scrub on hover, so their tiles are big enough to watch (16 Sep 2026) */}
            <ul className={fromCopies ? 'grid grid-cols-2 gap-3 sm:grid-cols-3' : wide ? 'grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5' : 'grid grid-cols-2 gap-2 sm:grid-cols-3'}>
              {tiles.map(t => {
                const open = showing?.id === t.id
                const Glyph = t.kind === 'video' ? Film : t.kind === 'image' ? ImageIcon : File
                return (
                  <li key={t.id} className={`flex flex-col gap-1 rounded-inner border p-2 ${open ? 'border-foreground' : 'border-border'}`}>
                    <button type="button" onClick={() => { if (reviewHref && t.kind === 'video') { window.location.assign(reviewHref(t)); return } setShowing(open ? null : t) }} aria-pressed={open}
                      aria-label={`${tileActionWords(t.kind)} ${t.name}`}
                      className={`relative block w-full overflow-hidden rounded-tile bg-foreground/[0.06] hover:opacity-95 ${fromCopies ? 'aspect-[4/5]' : 'aspect-square'}`}>
                      {t.thumb
                        // eslint-disable-next-line @next/next/no-img-element -- proxied, same origin
                        ? <img src={t.thumb} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />
                        : isCopy(t) && t.kind === 'video'
                          // THE CLIP'S OWN FIRST FRAME (16 Sep 2026): our copy is seekable, so
                          // the tile is the clip a moment in, and no picture has to be made
                          ? <HoverClip src={t.preview} className="h-full w-full object-cover" />
                          : <span className="flex h-full w-full items-center justify-center text-muted-foreground"><Glyph className="h-6 w-6" strokeWidth={1.6} aria-hidden /></span>}
                      {approvedIds?.includes(t.id) && (
                        <span className="absolute left-1.5 top-1.5 z-10 inline-flex items-center gap-1 rounded-full bg-accent-green px-2 py-0.5 text-[11px] font-semibold text-ink shadow" title="Approved by the client">
                          <Check className="h-3 w-3" strokeWidth={3} aria-hidden /> Approved
                        </span>
                      )}
                      {t.kind === 'video' && (
                        <span className="absolute inset-0 flex items-center justify-center">
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
