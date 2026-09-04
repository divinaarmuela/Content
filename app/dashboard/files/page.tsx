'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ChevronDown, ChevronRight, Grid2X2, Info, List, Plus, RefreshCw, Search, Upload,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useTable } from '@/lib/db-client'
import type { Client, DriveFile } from '@/lib/db-types'
import { friendlyError, loadFailedMessage } from '@/app/lib/support-core'
import {
  MODIFIED_FILTERS, NO_FILTERS, PARTIAL_VIEW_NOTE, SORT_LABEL, TYPE_FILTERS,
  crumbTrail, filterEntries, isFolder, nextSelection, openForPath, pathInto, pathUpTo,
  searchWords, toggleOpen, uploadPercent, uploadSummary, uploadWords,
  type Crumb, type DriveEntry, type Filters, type Sort, type SortBy,
} from '@/app/lib/files-core'
import PageTitle from '../ui/PageTitle'
import FilesTree from './FilesTree'
import FilesGrid from './FilesGrid'
import FilesPanel from './FilesPanel'
import {
  MoveDialog, NewFolderDialog, RenameDialog, ShareDialog, type MoveRequest,
} from './FilesDialogs'
import { forgetFolder, readTrail, useDriveBrowse, useFolderChildren } from './useDriveBrowse'
import { useUploads } from './useUploads'

/**
 * FILES — Google Drive, in MD Media's clothes.
 *
 * The tree on the left, the folder in the middle, the file on the right. It
 * looks like Drive on purpose: the team has used Drive for years and this page
 * has to be the same shape, or it becomes a second place to look rather than a
 * better one.
 *
 * Three things it refuses to get wrong.
 *
 *  1. IT SAYS WHAT IT CANNOT SEE. The app holds Google's `drive.file` scope —
 *     it sees folders it made and folders a person handed it through the
 *     chooser, and nothing else. A page that quietly showed part of somebody's
 *     Drive as if it were all of it would be worse than one that says which
 *     part. The line is on the screen, not in a tooltip.
 *  2. NOTHING MOVES OR IS RENAMED BY ACCIDENT. Dropping a file on a folder
 *     ASKS. The question names what is moving and where it is going, and the
 *     button in it is the only thing that sends the confirmation the server
 *     insists on. There is no delete anywhere on this page.
 *  3. DRIVE IS FETCHED, OURS IS LIVE. A folder listing is a request with a
 *     30-second soft cache and a Refresh button; `drive_files` — which is how
 *     the page knows a file belongs to Pure Allure — is a database listener,
 *     so a mirror landing in another tab repaints the Client filter without a
 *     reload.
 */

/** `useTable` memoises on the identity of this, so it lives outside the
 *  component rather than being rebuilt every render. */
const CLIENTS_BY_NAME: ['name', 'asc'][] = [['name', 'asc']]

const OPEN_KEY = 'md-files-open'
const VIEW_KEY = 'md-files-view'

type RootInfo = { id: string; name: string; clientsFolderId: string | null }

export default function FilesPage() {
  const [root, setRoot] = useState<RootInfo | null>(null)
  const [rootError, setRootError] = useState<string | null>(null)
  const [path, setPath] = useState<Crumb[]>([])
  const [open, setOpen] = useState<string[]>([])
  const [view, setView] = useState<'grid' | 'list'>('grid')
  const [filters, setFilters] = useState<Filters>(NO_FILTERS)
  const [sort, setSort] = useState<Sort>({ by: 'name', dir: 'asc' })
  const [search, setSearch] = useState('')
  const [debounced, setDebounced] = useState('')
  const [selected, setSelected] = useState<string[]>([])
  const [dragging, setDragging] = useState<string[]>([])
  const [dropHere, setDropHere] = useState(false)
  const [panelOpen, setPanelOpen] = useState(true)
  const [now] = useState(() => new Date())

  const [newFolder, setNewFolder] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [renaming, setRenaming] = useState<DriveEntry | null>(null)
  const [sharing, setSharing] = useState<DriveEntry | null>(null)
  const [moving, setMoving] = useState<MoveRequest | null>(null)
  const filePicker = useRef<HTMLInputElement>(null)

  /* ── where the cabinet is ─────────────────────────────────────────────── */

  // This GET reads and nothing else. It used to be able to CREATE a folder in
  // the tech account's Drive through a fallback, so opening the page out of
  // curiosity before the owner had chosen HQ settled a question nobody had
  // answered. Now: no folder chosen means no folder chosen, said out loud.
  useEffect(() => {
    void fetch('/api/drive/root', { cache: 'no-store' })
      .then(async res => {
        const json = await res.json().catch(() => null) as {
          root?: RootInfo; message?: string; error?: string
        } | null
        if (!res.ok || json?.error) {
          setRootError(friendlyError(json?.error ?? '', 'Files'))
          return
        }
        if (!json?.root) {
          // the route says WHICH of "not set up", "not connected", "nobody has
          // picked HQ" and "could not reach Google" this is — three of those
          // used to read as the second one, which sent people to a Settings
          // page that already said Connected
          setRootError(json?.message ?? loadFailedMessage('Files'))
          return
        }
        setRoot(json.root)
        setPath([{ id: json.root.id, name: json.root.name }])
      })
      .catch(() => setRootError(loadFailedMessage('Files')))
  }, [])

  /* ── the tree's memory ────────────────────────────────────────────────── */

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(OPEN_KEY) ?? '[]') as unknown
      if (Array.isArray(saved)) setOpen(saved.map(String).slice(0, 200))
      const savedView = localStorage.getItem(VIEW_KEY)
      if (savedView === 'list' || savedView === 'grid') setView(savedView)
    } catch { /* a blocked localStorage is not worth a broken page */ }
  }, [])

  useEffect(() => {
    try { localStorage.setItem(OPEN_KEY, JSON.stringify(open)) } catch { /* private mode */ }
  }, [open])

  useEffect(() => {
    try { localStorage.setItem(VIEW_KEY, view) } catch { /* private mode */ }
  }, [view])

  // wherever you are, the tree shows it — arriving by breadcrumb, by search
  // or by link should never leave the rail collapsed somewhere else
  useEffect(() => {
    if (path.length) setOpen(prev => openForPath(prev, path))
  }, [path])

  /* ── searching ────────────────────────────────────────────────────────── */

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 300)
    return () => clearTimeout(t)
  }, [search])

  const here = path[path.length - 1] ?? null
  const { branches, forget } = useFolderChildren(open, !!root)
  const browse = useDriveBrowse({
    parentId: here?.id ?? null,
    text: debounced || null,
    filters,
    sort,
    ready: !!root,
  })

  /* ── what the app knows about these files ─────────────────────────────── */

  // Which client a file belongs to arrives WITH the listing — one join on the
  // server, for the files actually on screen. The browser used to subscribe to
  // the whole of `drive_files` to answer the same question, which grows with
  // every mirrored file the agency has ever made.
  //
  // The live subscription is still here, because the brief asks for realtime
  // where the data is ours — but only while the Client filter is actually in
  // use, which is the one moment it changes what a person sees. `enabled`
  // false means no listener and no payload at all.
  const usingClientFilter = filters.client !== null
  const mirrored = useTable<DriveFile>('drive_files', { enabled: usingClientFilter })
  const clients = useTable<Client>('clients', { orderBy: CLIENTS_BY_NAME })

  const clientOf = useCallback((driveFileId: string) => {
    if (usingClientFilter) {
      const live = mirrored.rows.find(r => r.drive_file_id === driveFileId)
      if (live) return live.client_id ?? null
    }
    return browse.clients[driveFileId] ?? null
  }, [usingClientFilter, mirrored.rows, browse.clients])

  const entries = useMemo(
    () => filterEntries(browse.entries, filters, clientOf, now),
    [browse.entries, filters, clientOf, now],
  )
  const people = useMemo(() => {
    const seen = new Map<string, string>()
    for (const e of browse.entries) {
      if (e.ownerEmail && !seen.has(e.ownerEmail)) seen.set(e.ownerEmail, e.ownerName ?? e.ownerEmail)
    }
    return [...seen].map(([email, name]) => ({ email, name }))
  }, [browse.entries])

  /* ── navigating ───────────────────────────────────────────────────────── */

  const openFolder = useCallback((crumb: Crumb) => {
    setSelected([])
    setSearch('')
    setDebounced('')
    setPath(prev => pathInto(prev, crumb))
    setOpen(prev => (prev.includes(crumb.id) ? prev : [...prev, crumb.id]))
  }, [])

  const goToCrumb = useCallback((id: string) => {
    setSelected([])
    setPath(prev => pathUpTo(prev, id))
  }, [])

  // a search result lives somewhere else; opening its folder has to rebuild
  // the trail, or the breadcrumb would claim you are where you started
  const openSearchResult = useCallback(async (entry: DriveEntry) => {
    if (!isFolder(entry)) { setSelected([entry.id]); return }
    try {
      const trail = await readTrail(entry.id)
      setPath(trail.length ? trail : [{ id: entry.id, name: entry.name }])
      setSearch('')
      setDebounced('')
    } catch {
      openFolder({ id: entry.id, name: entry.name })
    }
  }, [openFolder])

  /* ── uploading ────────────────────────────────────────────────────────── */

  const afterWrite = useCallback((folderId: string) => {
    forgetFolder(folderId)
    forget(folderId)
    browse.refresh()
  }, [browse, forget])

  const uploads = useUploads(afterWrite)
  const inFlight = uploads.uploads.filter(u => u.status !== 'done')

  /* ── moving ───────────────────────────────────────────────────────────── */

  const idsForDrag = useCallback((id: string) => (
    selected.includes(id) ? selected : [id]
  ), [selected])

  const namesOf = useCallback((ids: string[]) => (
    ids.map(id => browse.entries.find(e => e.id === id)?.name ?? 'a file')
  ), [browse.entries])

  const askToMove = useCallback((folderId: string, folderName: string) => {
    const ids = dragging.length ? dragging : selected
    setDragging([])
    if (!ids.length) return
    setMoving({ ids, names: namesOf(ids), target: { id: folderId, name: folderName } })
  }, [dragging, selected, namesOf])

  /* ── the page ─────────────────────────────────────────────────────────── */

  if (rootError) {
    return (
      <div className="flex flex-col gap-4">
        <PageTitle title="Files" summary="The agency's Google Drive, in one place." />
        <p className="rounded-card border border-border bg-surface p-5 text-body-15">{rootError}</p>
      </div>
    )
  }

  const trail = crumbTrail(path)

  return (
    <div
      className="flex min-h-0 flex-1 flex-col gap-4"
      onDragOver={e => {
        if (!e.dataTransfer.types.includes('Files')) return
        e.preventDefault()
        setDropHere(true)
      }}
      onDragLeave={() => setDropHere(false)}
      onDrop={e => {
        if (!e.dataTransfer.files.length || !here) return
        e.preventDefault()
        setDropHere(false)
        uploads.add(e.dataTransfer.files, here.id)
      }}
    >
      <PageTitle
        title="Files"
        summary="The agency's Google Drive, in one place."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => setNewFolder(true)} className={GHOST}>
              <Plus className="h-4 w-4" strokeWidth={2} />New folder
            </button>
            <button type="button" onClick={() => filePicker.current?.click()} className={INK}>
              <Upload className="h-4 w-4" strokeWidth={2} />Upload
            </button>
            <button type="button" onClick={browse.refresh} className={GHOST} aria-label="Refresh">
              <RefreshCw className={cn('h-4 w-4', browse.loading && 'animate-spin')} strokeWidth={2} />
              Refresh
            </button>
          </div>
        }
      />

      <input
        ref={filePicker}
        type="file"
        multiple
        className="hidden"
        onChange={e => {
          if (e.target.files?.length && here) uploads.add(e.target.files, here.id)
          e.target.value = ''
        }}
      />

      <p className="text-secondary-13 text-muted-foreground">{PARTIAL_VIEW_NOTE}</p>

      {notice && (
        <p
          role="status"
          className="flex items-center justify-between gap-3 rounded-inner border border-border bg-tint-blue px-4 py-3 text-secondary-13"
        >
          {notice}
          <button type="button" onClick={() => setNotice(null)} className="shrink-0 underline">
            Close
          </button>
        </p>
      )}

      <div className="flex min-h-0 flex-1 gap-4">
        {/* ── the tree ─────────────────────────────────────────────────── */}
        <nav
          aria-label="Folder tree"
          className="hidden w-[224px] shrink-0 overflow-y-auto rounded-card border border-border bg-surface p-3 lg:block"
        >
          <FilesTree
            root={root}
            branches={branches}
            open={open}
            path={path}
            draggingIds={dragging}
            onToggle={id => setOpen(prev => toggleOpen(prev, id))}
            onOpenFolder={openFolder}
            onDropOnto={askToMove}
          />
        </nav>

        {/* ── the folder ───────────────────────────────────────────────── */}
        <main className="flex min-h-0 min-w-0 flex-1 flex-col gap-3.5">
          <div className="flex flex-wrap items-center gap-2.5">
            <nav aria-label="Where you are" className="flex min-w-0 items-center gap-1.5">
              {trail.hidden.length > 0 && (
                <span className="text-body-15 text-muted-foreground">…</span>
              )}
              {trail.visible.map((crumb, index) => (
                <span key={crumb.id} className="flex min-w-0 items-center gap-1.5">
                  {index > 0 && (
                    <ChevronRight className="h-4 w-4 shrink-0 text-foreground/40" strokeWidth={2} />
                  )}
                  <button
                    type="button"
                    onClick={() => goToCrumb(crumb.id)}
                    className={cn(
                      'truncate rounded text-[22px] font-semibold tracking-[-0.02em]',
                      index === trail.visible.length - 1
                        ? 'text-foreground'
                        : 'font-medium text-foreground/50 hover:text-foreground',
                    )}
                  >
                    {crumb.name}
                  </button>
                </span>
              ))}
            </nav>

            <div className="flex-1" />

            <label className="flex h-10 w-full max-w-[300px] items-center gap-2.5 rounded-full border border-border bg-surface px-3.5">
              <Search className="h-4 w-4 shrink-0 text-foreground/50" strokeWidth={1.8} />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search in Files"
                aria-label="Search in Files"
                className="w-full bg-transparent text-secondary-13 outline-none placeholder:text-foreground/50"
              />
            </label>

            <div
              role="group"
              aria-label="How to show them"
              className="flex items-center gap-0.5 rounded-full border border-border bg-surface p-[3px]"
            >
              <Toggle on={view === 'list'} onClick={() => setView('list')} label="List">
                <List className="h-4 w-4" strokeWidth={2} />
              </Toggle>
              <Toggle on={view === 'grid'} onClick={() => setView('grid')} label="Grid">
                <Grid2X2 className="h-4 w-4" strokeWidth={2} />
              </Toggle>
            </div>

            <button
              type="button"
              onClick={() => setPanelOpen(o => !o)}
              aria-pressed={panelOpen}
              className={cn(GHOST, 'lg:hidden')}
            >
              <Info className="h-4 w-4" strokeWidth={2} />Details
            </button>
          </div>

          {/* ── filters ────────────────────────────────────────────────── */}
          <div className="flex flex-wrap items-center gap-2">
            <FilterSelect
              label="Type"
              value={filters.type}
              onChange={v => setFilters(f => ({ ...f, type: v as Filters['type'] }))}
              options={TYPE_FILTERS.map(t => ({ value: t.value, label: t.label }))}
            />
            <FilterSelect
              label="People"
              value={filters.person ?? ''}
              onChange={v => setFilters(f => ({ ...f, person: v || null }))}
              options={[{ value: '', label: 'Anyone' },
                ...people.map(p => ({ value: p.email, label: p.name }))]}
            />
            <FilterSelect
              label="Modified"
              value={filters.modified}
              onChange={v => setFilters(f => ({ ...f, modified: v as Filters['modified'] }))}
              options={MODIFIED_FILTERS.map(m => ({ value: m.value, label: m.label }))}
            />
            <FilterSelect
              label="Client"
              value={filters.client ?? ''}
              onChange={v => setFilters(f => ({ ...f, client: v || null }))}
              options={[{ value: '', label: 'Any client' },
                ...clients.rows.map(c => ({ value: c.id, label: c.name }))]}
            />
            <div className="flex-1" />
            <FilterSelect
              label="Sort"
              value={`${sort.by}:${sort.dir}`}
              onChange={v => {
                const [by, dir] = v.split(':')
                setSort({ by: by as SortBy, dir: dir === 'desc' ? 'desc' : 'asc' })
              }}
              options={(['name', 'modified', 'size'] as const).flatMap(by => ([
                { value: `${by}:asc`, label: `${SORT_LABEL[by]} ↑` },
                { value: `${by}:desc`, label: `${SORT_LABEL[by]} ↓` },
              ]))}
            />
          </div>

          {/* ── uploads in flight ──────────────────────────────────────── */}
          {uploads.uploads.length > 0 && (
            <div className="flex flex-col gap-2 rounded-inner border border-border bg-surface p-3">
              <div className="flex items-center justify-between text-secondary-13 font-semibold">
                <span>{uploadSummary(uploads.uploads)}</span>
                {inFlight.length === 0 && (
                  <button type="button" onClick={uploads.clearFinished} className="underline">
                    Clear
                  </button>
                )}
              </div>
              {uploads.uploads.map(upload => (
                <div key={upload.id} className="flex items-center gap-3 text-secondary-13">
                  <span className="min-w-0 flex-1 truncate">{upload.name}</span>
                  <span
                    className="h-1.5 w-32 overflow-hidden rounded-full bg-foreground/10"
                    role="progressbar"
                    aria-valuenow={uploadPercent(upload)}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label={`${upload.name} going up`}
                  >
                    <span
                      className={cn('block h-full', upload.status === 'failed' ? 'bg-accent-red' : 'bg-accent-blue')}
                      style={{ width: `${uploadPercent(upload)}%` }}
                    />
                  </span>
                  <span className={cn('w-40 shrink-0 text-right', upload.status === 'failed' && 'text-accent-red')}>
                    {uploadWords(upload)}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* ── the files ──────────────────────────────────────────────── */}
          <div className="flex min-h-0 flex-1 gap-[18px]">
            <div className={cn(
              'flex min-h-0 min-w-0 flex-1 flex-col rounded-card transition-colors',
              dropHere && 'ring-2 ring-accent-blue ring-offset-4 ring-offset-background',
            )}>
              {browse.error && <p className="text-body-15">{browse.error}</p>}
              {!browse.error && browse.loading && (
                <p className="text-secondary-13 text-muted-foreground">Looking…</p>
              )}
              {!browse.error && !browse.loading && (
                <>
                  {debounced && (
                    <p className="mb-2.5 text-secondary-13 text-muted-foreground">
                      {searchWords(entries.length, debounced, browse.searched, browse.capped)}
                    </p>
                  )}
                  <FilesGrid
                    entries={entries}
                    view={view}
                    selected={selected}
                    now={now}
                    draggingIds={dragging}
                    onPick={(id, mods) => setSelected(prev =>
                      nextSelection(prev, entries.map(e => e.id), id, mods))}
                    onOpenFolder={crumb => {
                      if (debounced) {
                        void openSearchResult(
                          entries.find(e => e.id === crumb.id) ?? { ...crumb } as DriveEntry,
                        )
                      } else openFolder(crumb)
                    }}
                    onNewFolder={() => setNewFolder(true)}
                    onDropOnto={askToMove}
                    onDragStart={id => setDragging(idsForDrag(id))}
                    onDragEnd={() => setDragging([])}
                    onRename={setRenaming}
                    onShare={setSharing}
                    onMoveOne={entry => setMoving({
                      ids: [entry.id], names: [entry.name], target: null,
                    })}
                  />
                  {browse.nextPage && (
                    <button
                      type="button"
                      onClick={browse.loadMore}
                      className={cn(GHOST, 'mt-3 self-center')}
                    >
                      {browse.loadingMore ? 'Loading…' : 'Show more'}
                      <ChevronDown className="h-4 w-4" strokeWidth={2} />
                    </button>
                  )}
                </>
              )}
            </div>

            {/* Tailwind emits `.hidden` after `.block`, so at equal specificity
                `hidden` wins whatever the order in the string — the panel could
                never be revealed on a phone. Pick ONE of the two per breakpoint. */}
            <div className={cn(panelOpen ? 'block' : 'hidden', 'lg:block')}>
              <FilesPanel
                selectedId={selected.length === 1 ? selected[0] : null}
                selectedCount={selected.length}
                now={now}
                onRename={setRenaming}
                onShare={setSharing}
                onMove={() => setMoving({ ids: selected, names: namesOf(selected), target: null })}
              />
            </div>
          </div>
        </main>
      </div>

      <NewFolderDialog
        open={newFolder}
        parent={here}
        onClose={() => setNewFolder(false)}
        onMade={(folderId, created) => {
          setNewFolder(false)
          // adopt-not-duplicate, said out loud — otherwise "it did nothing"
          // is indistinguishable from "it worked"
          setNotice(created ? null : 'That folder is already there — nothing new was made.')
          afterWrite(folderId)
        }}
      />
      <RenameDialog
        entry={renaming}
        onClose={() => setRenaming(null)}
        onDone={() => { const at = here?.id; setRenaming(null); if (at) afterWrite(at) }}
      />
      <MoveDialog
        request={moving}
        root={root ? { id: root.id, name: root.name } : null}
        onClose={() => setMoving(null)}
        onDone={targetId => {
          setMoving(null)
          setSelected([])
          afterWrite(targetId)
          if (here) afterWrite(here.id)
        }}
        // some of it moved and some did not: the dialog stays open naming what
        // Google refused, but the folders still have to catch up
        onMoved={targetId => {
          setSelected([])
          afterWrite(targetId)
          if (here) afterWrite(here.id)
        }}
      />
      <ShareDialog entry={sharing} onClose={() => setSharing(null)} />
    </div>
  )
}

const INK = cn(
  'inline-flex min-h-[44px] items-center gap-2 rounded-full bg-foreground px-4',
  'text-secondary-13 font-semibold text-background',
)
const GHOST = cn(
  'inline-flex min-h-[44px] items-center gap-2 rounded-full border border-border bg-surface px-4',
  'text-secondary-13 font-semibold text-foreground hover:bg-foreground/[0.04]',
)

function Toggle({
  on, onClick, label, children,
}: {
  on: boolean; onClick: () => void; label: string; children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      aria-label={label}
      className={cn(
        'flex h-[34px] w-[34px] items-center justify-center rounded-full transition-colors',
        on ? 'bg-foreground text-background' : 'text-foreground hover:bg-foreground/[0.06]',
      )}
    >
      {children}
    </button>
  )
}

function FilterSelect({
  label, value, onChange, options,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  options: { value: string; label: string }[]
}) {
  return (
    <label className="inline-flex h-9 items-center gap-1.5 rounded-full border border-border bg-surface pl-3 pr-1 text-chip-12">
      <span className="text-foreground">{label}</span>
      <select
        value={value}
        aria-label={label}
        onChange={e => onChange(e.target.value)}
        className="h-full cursor-pointer bg-transparent pr-1 text-chip-12 text-foreground outline-none"
      >
        {options.map(option => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </label>
  )
}
