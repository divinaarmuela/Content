'use client'

import { useEffect, useMemo, useState } from 'react'
import { Check, ChevronRight, Film, Folder, Image as ImageIcon, RefreshCw, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { friendlyError, loadFailedMessage } from '@/app/lib/support-core'
import {
  NO_FILTERS, crumbTrail, extensionBadge, isFolder, kindOf, openForPath, pathInto, pathUpTo, toggleOpen,
  type Crumb, type DriveEntry,
} from '@/app/lib/files-core'
import {
  CANVAS_DRIVE_FILES_MAX, driveFileFromEntry, driveThumbnailUrl, isPickableEntry, type CanvasDriveFile,
} from '@/app/lib/canvas-drive-core'
import FilesTree from '@/app/dashboard/files/FilesTree'
import { useDriveBrowse, useFolderChildren } from '@/app/dashboard/files/useDriveBrowse'

/**
 * PICK A DRIVE FILE FOR A POST CARD (the owner, 22 Sep 2026: "I should be
 * able to add the Drive file and it will read [it and] put it on the post I
 * chose"). The Files page's own window — the same tree, the same listing
 * hook, the same thumbnails through the same proxy — cut down to what a
 * post can take: folders to walk into, pictures and clips to pick.
 *
 * READ ONLY, like everything the dashboard does with Drive (trap 13). A
 * pick hands the card the file's id, name and kind; nothing is copied,
 * uploaded, moved or renamed, and the dialog has no button that would.
 *
 * A single-media post takes one file and the dialog closes on the press; a
 * carousel takes several, ticked one by one and added together.
 */
type RootInfo = { id: string; name: string }

export default function DriveFilePicker({ open, multiple = false, onClose, onPick }: {
  open: boolean
  /** a carousel: tick several, then add them together */
  multiple?: boolean
  onClose: () => void
  onPick: (files: CanvasDriveFile[]) => void
}) {
  const [root, setRoot] = useState<RootInfo | null>(null)
  const [rootError, setRootError] = useState<string | null>(null)
  const [path, setPath] = useState<Crumb[]>([])
  const [treeOpen, setTreeOpen] = useState<string[]>([])
  const [search, setSearch] = useState('')
  const [debounced, setDebounced] = useState('')
  const [ticked, setTicked] = useState<CanvasDriveFile[]>([])

  // where the cabinet is — the same GET the Files page starts with, which
  // reads and nothing else; nothing picked means the message says so
  useEffect(() => {
    if (!open || root) return
    let live = true
    void fetch('/api/drive/root', { cache: 'no-store' })
      .then(async res => {
        const json = await res.json().catch(() => null) as { root?: RootInfo; message?: string; error?: string } | null
        if (!live) return
        if (!res.ok || json?.error) { setRootError(friendlyError(json?.error ?? '', 'Files')); return }
        if (!json?.root) { setRootError(json?.message ?? loadFailedMessage('Files')); return }
        setRoot(json.root)
        setPath([{ id: json.root.id, name: json.root.name }])
      })
      .catch(() => { if (live) setRootError(loadFailedMessage('Files')) })
    return () => { live = false }
  }, [open, root])

  // a fresh pick each time the dialog opens; the folder you were in is kept
  useEffect(() => { if (open) { setTicked([]); setSearch(''); setDebounced('') } }, [open])

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 300)
    return () => clearTimeout(t)
  }, [search])

  useEffect(() => { if (path.length) setTreeOpen(prev => openForPath(prev, path)) }, [path])

  const here = path[path.length - 1] ?? null
  const { branches } = useFolderChildren(treeOpen, open && !!root)
  const browse = useDriveBrowse({
    parentId: here?.id ?? null, text: debounced || null, filters: NO_FILTERS, sort: { by: 'name', dir: 'asc' }, ready: open && !!root,
  })
  const entries = useMemo(() => browse.entries.filter(isPickableEntry), [browse.entries])
  const folders = entries.filter(isFolder)
  const files = entries.filter(e => !isFolder(e))
  const trail = crumbTrail(path)

  const openFolder = (crumb: Crumb) => {
    setSearch(''); setDebounced('')
    setPath(prev => pathInto(prev, crumb))
  }

  const press = (entry: DriveEntry) => {
    const file = driveFileFromEntry(entry)
    if (!file) return
    if (!multiple) { onPick([file]); onClose(); return }
    setTicked(prev => prev.some(f => f.id === file.id)
      ? prev.filter(f => f.id !== file.id)
      : prev.length >= CANVAS_DRIVE_FILES_MAX ? prev : [...prev, file])
  }

  return (
    <Dialog open={open} onOpenChange={o => { if (!o) onClose() }}>
      <DialogContent className="flex max-h-[85vh] flex-col gap-3 bg-popover sm:max-w-4xl" data-drive-file-picker>
        <DialogHeader>
          <DialogTitle>{multiple ? 'Add Drive files to the carousel' : 'Add a Drive file to the post'}</DialogTitle>
          <DialogDescription>
            Google Drive, read only — a picked file is shown on the post from where it sits. Nothing in Drive changes.
          </DialogDescription>
        </DialogHeader>

        {rootError ? (
          <p role="status" className="rounded-inner border border-border p-4 text-[13px] text-muted-foreground">{rootError}</p>
        ) : !root ? (
          <p role="status" className="text-[13px] text-muted-foreground">Opening Drive…</p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <nav aria-label="Where you are" className="flex min-w-0 flex-1 flex-wrap items-center gap-0.5 text-[13px]">
                {trail.visible.map((c, i) => (
                  <span key={c.id} className="flex items-center gap-0.5">
                    {i > 0 && <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />}
                    {i === 1 && trail.hidden.length > 0 && <span className="px-1 text-muted-foreground">…<ChevronRight className="inline h-3.5 w-3.5" aria-hidden /></span>}
                    <button type="button" onClick={() => setPath(prev => pathUpTo(prev, c.id))}
                      className={cn('min-h-9 rounded px-1.5 hover:bg-foreground/[0.06]', i === trail.visible.length - 1 ? 'font-semibold' : 'text-muted-foreground')}
                      aria-current={i === trail.visible.length - 1 ? 'location' : undefined}>
                      {c.name}
                    </button>
                  </span>
                ))}
              </nav>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                <Input value={search} onChange={e => setSearch(e.target.value)} placeholder={`Search in ${here?.name ?? 'Drive'}…`}
                  aria-label="Search files" className="h-10 w-56 rounded-full bg-surface pl-9" />
              </div>
              <Button type="button" variant="ghost" size="icon" className="h-10 w-10 rounded-full" onClick={browse.refresh} aria-label="Refresh" title="Refresh">
                <RefreshCw className={cn('h-4 w-4', browse.loading && 'animate-spin')} aria-hidden />
              </Button>
            </div>

            <div className="grid min-h-0 flex-1 gap-3 overflow-hidden md:grid-cols-[220px_1fr]">
              <div className="hidden min-h-0 overflow-y-auto rounded-inner border border-border p-1 md:block">
                <FilesTree root={root} branches={branches} open={treeOpen} path={path}
                  onToggle={id => setTreeOpen(prev => toggleOpen(prev, id))} onOpenFolder={openFolder} />
              </div>
              <div className="flex min-h-0 flex-col gap-3 overflow-y-auto pr-1">
                {browse.error ? (
                  <p role="status" className="text-[13px] text-muted-foreground">{browse.error}</p>
                ) : browse.loading ? (
                  <p role="status" className="text-[13px] text-muted-foreground">Looking…</p>
                ) : (
                  <>
                    {folders.length > 0 && !debounced && (
                      <section className="flex flex-col gap-2">
                        <span className="text-[12px] font-semibold uppercase tracking-[0.08em] text-foreground/45">Folders</span>
                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                          {folders.map(f => (
                            <button key={f.id} type="button" onClick={() => openFolder({ id: f.id, name: f.name })}
                              className="flex h-11 items-center gap-2.5 rounded-inner border border-border bg-surface px-3 text-left text-[13px] font-semibold hover:border-foreground/25">
                              <Folder className="h-[18px] w-[18px] shrink-0 text-accent-blue" strokeWidth={1.8} aria-hidden />
                              <span className="truncate">{f.name}</span>
                            </button>
                          ))}
                        </div>
                      </section>
                    )}
                    <section className="flex flex-col gap-2">
                      <span className="text-[12px] font-semibold uppercase tracking-[0.08em] text-foreground/45">
                        {debounced ? `Pictures and clips matching “${debounced}”` : 'Pictures and clips'}
                      </span>
                      {files.length === 0 ? (
                        <p className="text-[13px] text-muted-foreground">
                          {debounced ? 'No picture or clip matches here or below.' : 'No pictures or clips in this folder. Open a folder on the left, or search.'}
                        </p>
                      ) : (
                        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                          {files.map(f => {
                            const kind = kindOf(f.mimeType, f.name)
                            const on = ticked.some(t => t.id === f.id)
                            const Glyph = kind === 'video' ? Film : ImageIcon
                            return (
                              <button key={f.id} type="button" onClick={() => press(f)} aria-pressed={multiple ? on : undefined}
                                aria-label={`${multiple ? (on ? 'Untick' : 'Tick') : 'Put on the post'}: ${f.name}`}
                                className={cn('relative flex flex-col overflow-hidden rounded-inner border bg-surface text-left outline-none focus-visible:ring-2 focus-visible:ring-ring',
                                  on ? 'border-foreground ring-1 ring-foreground' : 'border-border hover:border-foreground/25')}>
                                <span className="relative block aspect-square w-full bg-foreground/[0.06]">
                                  {f.hasThumbnail
                                    // eslint-disable-next-line @next/next/no-img-element -- proxied, same origin
                                    ? <img src={driveThumbnailUrl(f.id, 400)} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />
                                    : <span className="flex h-full w-full items-center justify-center text-muted-foreground"><Glyph className="h-7 w-7" strokeWidth={1.5} aria-hidden /></span>}
                                  <span className="absolute bottom-1.5 left-1.5 rounded-full bg-ink/70 px-1.5 py-0.5 text-[9px] font-bold uppercase text-cream">{extensionBadge(f.name, kind)}</span>
                                  {on && (
                                    <span className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-foreground text-background shadow">
                                      <Check className="h-3.5 w-3.5" strokeWidth={3} aria-hidden />
                                    </span>
                                  )}
                                </span>
                                <span className="truncate px-2 py-1.5 text-[12px] font-semibold" title={f.name}>{f.name}</span>
                              </button>
                            )
                          })}
                        </div>
                      )}
                      {browse.nextPage && (
                        <Button type="button" variant="outline" onClick={browse.loadMore} disabled={browse.loadingMore} className="h-10 w-fit rounded-full px-4 text-[13px] font-semibold">
                          {browse.loadingMore ? 'Loading…' : 'Show more'}
                        </Button>
                      )}
                      {browse.capped && <p className="text-[12px] text-muted-foreground">The search stopped early — open the folder to see the rest.</p>}
                    </section>
                  </>
                )}
              </div>
            </div>

            {multiple && (
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
                <span className="text-[13px] text-muted-foreground">
                  {ticked.length === 0 ? `Tick up to ${CANVAS_DRIVE_FILES_MAX} pictures or clips.` : `${ticked.length} ticked`}
                </span>
                <Button type="button" disabled={ticked.length === 0} onClick={() => { onPick(ticked); onClose() }}
                  className="h-11 rounded-full bg-foreground px-4 text-[13px] font-semibold text-background hover:bg-foreground/90">
                  {ticked.length <= 1 ? 'Add to the carousel' : `Add ${ticked.length} to the carousel`}
                </Button>
              </div>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
