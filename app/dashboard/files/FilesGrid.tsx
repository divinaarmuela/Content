'use client'

import { FileText, Film, Folder, Image as ImageIcon, Music, Plus, Table2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  extensionBadge, formatBytes, formatModified, isFolder, kindOf,
  type Crumb, type DriveEntry, type FileKind,
} from '@/app/lib/files-core'

/**
 * The middle of the page: folders first, then files with a picture on them.
 *
 * Two grids rather than one mixed list, exactly as the mockup has it, because
 * a folder and a file are answers to different questions — "where do I go
 * next" and "what is in here". Mixing them makes both harder to scan.
 *
 * Every tile is focusable and every tile is draggable. A drag never moves
 * anything on its own: dropping opens a question naming what is being moved
 * and where, and the Move button in that question is what changes Drive. The
 * keyboard route to the same thing is the Move… item, which opens a folder
 * picker — a page whose only way to file something is a mouse gesture is a
 * page some people cannot use.
 */

const ICON: Record<FileKind, typeof FileText> = {
  folder: Folder, image: ImageIcon, video: Film, audio: Music,
  pdf: FileText, doc: FileText, sheet: Table2, slides: Table2, other: FileText,
}

const ICON_TONE: Record<FileKind, string> = {
  folder: 'text-accent-blue', image: 'text-accent-green', video: 'text-accent-blue',
  audio: 'text-accent-blue', pdf: 'text-accent-red', doc: 'text-foreground/70',
  sheet: 'text-accent-green', slides: 'text-accent-amber', other: 'text-foreground/50',
}

export type GridProps = {
  entries: DriveEntry[]
  view: 'grid' | 'list'
  selected: string[]
  onPick: (id: string, mods: { shift?: boolean; ctrl?: boolean }) => void
  onOpenFolder: (crumb: Crumb) => void
  onNewFolder: () => void
  onDropOnto: (folderId: string, folderName: string) => void
  onDragStart: (id: string) => void
  onDragEnd: () => void
  draggingIds: string[]
  now: Date
}

export default function FilesGrid(props: GridProps) {
  const folders = props.entries.filter(isFolder)
  const files = props.entries.filter(e => !isFolder(e))

  if (props.view === 'list') return <ListView {...props} />

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-[18px] overflow-y-auto pr-1">
      <section className="flex flex-col gap-2.5">
        <SectionLabel>Folders</SectionLabel>
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {folders.map(folder => (
            <FolderTile key={folder.id} folder={folder} {...props} />
          ))}
          <button
            type="button"
            onClick={props.onNewFolder}
            className="flex h-14 items-center gap-3 rounded-inner border-[1.5px] border-dashed border-foreground/25 px-4 text-body-15 font-semibold text-foreground/60 transition-colors hover:border-foreground/40 hover:text-foreground"
          >
            <Plus className="h-[22px] w-[22px]" strokeWidth={2} />
            New folder
          </button>
        </div>
      </section>

      <section className="flex min-h-0 flex-1 flex-col gap-2.5">
        <SectionLabel>Files</SectionLabel>
        {files.length === 0 ? (
          <p className="text-secondary-13 text-muted-foreground">
            Nothing in here yet. Drop files on this page to add some.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {files.map(file => <FileTile key={file.id} file={file} {...props} />)}
          </div>
        )}
      </section>
    </div>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[12px] font-semibold uppercase tracking-[0.08em] text-foreground/45">
      {children}
    </span>
  )
}

function FolderTile({
  folder, selected, onPick, onOpenFolder, onDropOnto, onDragStart, onDragEnd, draggingIds,
}: GridProps & { folder: DriveEntry }) {
  const isSelected = selected.includes(folder.id)
  const canDrop = draggingIds.length > 0 && !draggingIds.includes(folder.id)
  return (
    <div
      role="button"
      tabIndex={0}
      draggable
      aria-pressed={isSelected}
      onDragStart={() => onDragStart(folder.id)}
      onDragEnd={onDragEnd}
      onDragOver={e => { if (canDrop) { e.preventDefault(); e.dataTransfer.dropEffect = 'move' } }}
      onDrop={e => {
        if (!canDrop) return
        e.preventDefault()
        e.stopPropagation()
        onDropOnto(folder.id, folder.name)
      }}
      onClick={e => onPick(folder.id, { shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey })}
      onDoubleClick={() => onOpenFolder({ id: folder.id, name: folder.name })}
      onKeyDown={e => {
        if (e.key === 'Enter') { e.preventDefault(); onOpenFolder({ id: folder.id, name: folder.name }) }
        if (e.key === ' ') { e.preventDefault(); onPick(folder.id, { ctrl: true }) }
      }}
      className={cn(
        'flex h-14 cursor-pointer items-center gap-3 rounded-inner border bg-surface px-4 text-body-15 font-semibold outline-none transition-colors',
        'focus-visible:ring-2 focus-visible:ring-ring',
        isSelected ? 'border-accent-blue ring-1 ring-accent-blue' : 'border-border hover:border-foreground/25',
        canDrop && 'border-accent-blue ring-1 ring-accent-blue',
      )}
    >
      <Folder className="h-[22px] w-[22px] shrink-0 text-accent-blue" strokeWidth={1.8} />
      <span className="truncate">{folder.name}</span>
    </div>
  )
}

function FileTile({
  file, selected, onPick, onDragStart, onDragEnd,
}: GridProps & { file: DriveEntry }) {
  const kind = kindOf(file.mimeType, file.name)
  const Icon = ICON[kind]
  const isSelected = selected.includes(file.id)
  return (
    <div
      role="button"
      tabIndex={0}
      draggable
      aria-pressed={isSelected}
      onDragStart={() => onDragStart(file.id)}
      onDragEnd={onDragEnd}
      onClick={e => onPick(file.id, { shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey })}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick(file.id, {}) }
      }}
      className={cn(
        'flex cursor-pointer flex-col overflow-hidden rounded-inner border bg-surface text-left outline-none transition-colors',
        'focus-visible:ring-2 focus-visible:ring-ring',
        isSelected ? 'border-accent-blue ring-1 ring-accent-blue' : 'border-border hover:border-foreground/25',
      )}
    >
      <div className="flex h-12 items-center gap-2.5 px-3.5 text-secondary-13 font-semibold">
        <Icon className={cn('h-4 w-4 shrink-0', ICON_TONE[kind])} strokeWidth={2} />
        <span className="truncate">{file.name}</span>
      </div>
      <div className="relative h-[150px] border-t border-border bg-paper">
        {file.hasThumbnail ? (
          // eslint-disable-next-line @next/next/no-img-element -- a Drive
          // thumbnail is proxied by us and has no known width or height, so
          // next/image would need a layout it cannot be given
          <img
            src={`/api/drive/thumbnail?id=${encodeURIComponent(file.id)}`}
            alt=""
            loading="lazy"
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <Icon className={cn('h-9 w-9 opacity-40', ICON_TONE[kind])} strokeWidth={1.5} />
          </div>
        )}
        <span className="absolute bottom-2.5 left-2.5 rounded-full bg-ink/70 px-2 py-0.5 text-[10px] font-bold uppercase text-cream">
          {extensionBadge(file.name, kind)}
          {file.size ? ` · ${formatBytes(file.size)}` : ''}
        </span>
      </div>
    </div>
  )
}

function ListView({
  entries, selected, onPick, onOpenFolder, onDropOnto, onDragStart, onDragEnd, draggingIds, now,
}: GridProps) {
  return (
    <div className="min-h-0 flex-1 overflow-auto rounded-inner border border-border bg-surface">
      <table className="w-full text-left text-secondary-13">
        <thead className="sticky top-0 bg-surface">
          <tr className="border-b border-border text-[12px] font-semibold uppercase tracking-[0.06em] text-foreground/45">
            <th scope="col" className="px-4 py-3">Name</th>
            <th scope="col" className="px-4 py-3">Owner</th>
            <th scope="col" className="px-4 py-3">Last changed</th>
            <th scope="col" className="px-4 py-3">Size</th>
          </tr>
        </thead>
        <tbody>
          {entries.map(entry => {
            const kind = kindOf(entry.mimeType, entry.name)
            const Icon = ICON[kind]
            const folder = isFolder(entry)
            const canDrop = folder && draggingIds.length > 0 && !draggingIds.includes(entry.id)
            return (
              <tr
                key={entry.id}
                tabIndex={0}
                draggable
                onDragStart={() => onDragStart(entry.id)}
                onDragEnd={onDragEnd}
                onDragOver={e => { if (canDrop) e.preventDefault() }}
                onDrop={e => {
                  if (!canDrop) return
                  e.preventDefault()
                  onDropOnto(entry.id, entry.name)
                }}
                onClick={e => onPick(entry.id, { shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey })}
                onDoubleClick={() => folder && onOpenFolder({ id: entry.id, name: entry.name })}
                onKeyDown={e => {
                  if (e.key !== 'Enter') return
                  e.preventDefault()
                  if (folder) onOpenFolder({ id: entry.id, name: entry.name })
                  else onPick(entry.id, {})
                }}
                className={cn(
                  'cursor-pointer border-b border-border outline-none last:border-0',
                  'focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                  selected.includes(entry.id) ? 'bg-tint-blue' : 'hover:bg-foreground/[0.03]',
                  canDrop && 'ring-1 ring-inset ring-accent-blue',
                )}
              >
                <td className="px-4 py-3">
                  <span className="flex min-h-[24px] items-center gap-2.5 font-semibold">
                    <Icon className={cn('h-4 w-4 shrink-0', ICON_TONE[kind])} strokeWidth={2} />
                    <span className="truncate">{entry.name}</span>
                  </span>
                </td>
                <td className="px-4 py-3 text-muted-foreground">{entry.ownerName ?? '—'}</td>
                <td className="px-4 py-3 text-muted-foreground">{formatModified(entry.modified, now)}</td>
                <td className="px-4 py-3 text-muted-foreground">
                  {folder ? '—' : formatBytes(entry.size)}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
