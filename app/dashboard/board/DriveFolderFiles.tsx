'use client'

import { useEffect, useState } from 'react'
import { ExternalLink, File, Film, Image as ImageIcon, Play, X } from 'lucide-react'
import type { DriveEntry } from '../../lib/files-core'
import {
  folderFilesWords, folderTilesOf, readableFolderId, subfolderCount, tileActionWords, type FolderTile,
} from '../../lib/drive-folder-files-core'

/**
 * THE FILES BEHIND A CARD'S DRIVE LINK, AS TILES (the owner, 15 Sep 2026:
 * "display files as their thumbnail and play it from there" — "the Drive
 * link"). Read only: one listing, Drive's own thumbnails through our proxy,
 * and Drive's own preview when a tile is pressed — Google's player plays the
 * clip, nothing is downloaded here. A Dropbox link, or a link to one file,
 * draws nothing: the card's "Open the folder" link is for those.
 */
export default function DriveFolderFiles({ url, wide = false }: {
  url: string | null | undefined
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

  useEffect(() => {
    setShowing(null)
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
  }, [folderId])

  if (!folderId || state.at === 'idle') return null

  return (
    <div className="flex flex-col gap-2" data-drive-folder-files>
      {state.at === 'looking' && <p role="status" className="text-[13px] text-muted-foreground">Looking in the folder…</p>}
      {state.at === 'failed' && <p role="status" className="text-[13px] text-muted-foreground">{state.words}</p>}
      {state.at === 'ready' && (
        <>
          <p className="text-[13px] text-muted-foreground">
            {state.note ?? folderFilesWords(state.tiles.length, state.folders)}{state.more ? ' — the first 60 are shown; open the folder for the rest' : ''}
          </p>

          {showing && (
            <div className="flex flex-col gap-2 rounded-inner border border-border p-2" data-drive-file-viewer>
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-[13px] font-semibold" title={showing.name}>{showing.name}</span>
                <div className="flex shrink-0 items-center gap-1">
                  <a href={showing.open} target="_blank" rel="noreferrer noopener"
                    className="inline-flex min-h-11 items-center gap-1 px-2 text-[12px] underline-offset-4 hover:underline">
                    <ExternalLink className="h-3.5 w-3.5" aria-hidden /> Open in Drive<span className="sr-only">, opens in a new tab</span>
                  </a>
                  <button type="button" onClick={() => setShowing(null)} aria-label={`Close ${showing.name}`}
                    className="flex h-11 w-11 items-center justify-center rounded-full hover:bg-muted">
                    <X className="h-4 w-4" aria-hidden />
                  </button>
                </div>
              </div>
              {/* Drive's own preview: the clip plays here, a still shows large.
                  Mounted only on the press — nothing loads for a tile nobody opened */}
              <iframe key={showing.id} src={showing.preview} title={showing.name} allow="autoplay; fullscreen" allowFullScreen
                className="aspect-video w-full rounded-tile border-0 bg-zinc-950" />
            </div>
          )}

          {state.tiles.length > 0 && (
            <ul className={wide ? 'grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5' : 'grid grid-cols-2 gap-2 sm:grid-cols-3'}>
              {state.tiles.map(t => {
                const open = showing?.id === t.id
                const Glyph = t.kind === 'video' ? Film : t.kind === 'image' ? ImageIcon : File
                return (
                  <li key={t.id} className={`flex flex-col gap-1 rounded-inner border p-2 ${open ? 'border-foreground' : 'border-border'}`}>
                    <button type="button" onClick={() => setShowing(open ? null : t)} aria-pressed={open}
                      aria-label={`${tileActionWords(t.kind)} ${t.name}`}
                      className="relative block aspect-square w-full overflow-hidden rounded-tile bg-foreground/[0.06] hover:opacity-90">
                      {t.thumb
                        // eslint-disable-next-line @next/next/no-img-element -- proxied, same origin
                        ? <img src={t.thumb} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />
                        : <span className="flex h-full w-full items-center justify-center text-muted-foreground"><Glyph className="h-6 w-6" strokeWidth={1.6} aria-hidden /></span>}
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
