'use client'

import { ChevronRight, Folder, HardDrive } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Crumb } from '@/app/lib/files-core'
import type { TreeNode } from './useDriveBrowse'

/**
 * The left rail: the HQ folder and everything under it, one branch at a time.
 *
 * A real `role="tree"` rather than a list of links, because that is what it
 * is: arrow keys walk it, Enter opens a folder, and a screen reader announces
 * the depth. Branches load the first time they are opened — the owner's HQ has
 * thousands of folders under it and asking for the shape up front would be a
 * minute of waiting for a rail nobody has clicked.
 *
 * Every row is also a drop target. Dropping does not move anything: it asks,
 * and the page's confirmation is what actually moves a file. That is the
 * owner's rule — nothing in their Drive moves as a side effect of a gesture.
 */

export type TreeProps = {
  root: { id: string; name: string } | null
  branches: Record<string, TreeNode[]>
  open: string[]
  path: Crumb[]
  onToggle: (id: string) => void
  onOpenFolder: (crumb: Crumb) => void
  /** something was dragged onto this folder — the page asks before moving */
  onDropOnto: (folderId: string, folderName: string) => void
  draggingIds: string[]
}

export default function FilesTree(props: TreeProps) {
  const { root } = props
  if (!root) return null
  return (
    <div role="tree" aria-label="Folders" className="flex flex-col gap-0.5">
      <Branch {...props} node={root} depth={0} />
    </div>
  )
}

function Branch({
  node, depth, branches, open, path, onToggle, onOpenFolder, onDropOnto, draggingIds, root,
}: TreeProps & { node: TreeNode; depth: number }) {
  const isOpen = open.includes(node.id)
  const isCurrent = path.length > 0 && path[path.length - 1]?.id === node.id
  const onPath = path.some(c => c.id === node.id)
  const kids = branches[node.id]
  const canDrop = draggingIds.length > 0 && !draggingIds.includes(node.id)

  return (
    <div role="none">
      <div
        role="treeitem"
        aria-expanded={isOpen}
        aria-selected={isCurrent}
        aria-level={depth + 1}
        tabIndex={0}
        onClick={() => onOpenFolder({ id: node.id, name: node.name })}
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onOpenFolder({ id: node.id, name: node.name })
          }
          if (e.key === 'ArrowRight' && !isOpen) { e.preventDefault(); onToggle(node.id) }
          if (e.key === 'ArrowLeft' && isOpen) { e.preventDefault(); onToggle(node.id) }
        }}
        onDragOver={e => { if (canDrop) { e.preventDefault(); e.dataTransfer.dropEffect = 'move' } }}
        onDrop={e => {
          if (!canDrop) return
          e.preventDefault()
          e.stopPropagation()
          onDropOnto(node.id, node.name)
        }}
        style={{ paddingLeft: `${8 + depth * 14}px` }}
        className={cn(
          'flex min-h-[44px] cursor-pointer items-center gap-2 rounded-tile pr-2 text-body-15 outline-none transition-colors',
          'focus-visible:ring-2 focus-visible:ring-ring',
          isCurrent
            ? 'bg-foreground/[0.07] font-semibold text-foreground'
            : onPath
              ? 'font-semibold text-foreground hover:bg-foreground/[0.04]'
              : 'text-foreground/75 hover:bg-foreground/[0.04]',
          canDrop && 'ring-1 ring-accent-blue/40',
        )}
      >
        <button
          type="button"
          aria-label={isOpen ? `Close ${node.name}` : `Open ${node.name}`}
          onClick={e => { e.stopPropagation(); onToggle(node.id) }}
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-foreground/50 hover:bg-foreground/[0.08]"
        >
          <ChevronRight className={cn('h-4 w-4 transition-transform', isOpen && 'rotate-90')} strokeWidth={2} />
        </button>
        {depth === 0
          ? <HardDrive className="h-[18px] w-[18px] shrink-0" strokeWidth={1.8} />
          : <Folder className="h-[18px] w-[18px] shrink-0 text-accent-blue" strokeWidth={1.8} />}
        <span className="truncate">{node.name}</span>
      </div>

      {isOpen && (
        <div role="group">
          {kids === undefined && (
            <p
              style={{ paddingLeft: `${34 + depth * 14}px` }}
              className="py-2 text-secondary-13 text-muted-foreground"
            >
              Looking…
            </p>
          )}
          {kids?.length === 0 && (
            <p
              style={{ paddingLeft: `${34 + depth * 14}px` }}
              className="py-2 text-secondary-13 text-muted-foreground"
            >
              No folders in here
            </p>
          )}
          {kids?.map(kid => (
            <Branch
              key={kid.id}
              node={kid}
              depth={depth + 1}
              root={root}
              branches={branches}
              open={open}
              path={path}
              onToggle={onToggle}
              onOpenFolder={onOpenFolder}
              onDropOnto={onDropOnto}
              draggingIds={draggingIds}
            />
          ))}
        </div>
      )}
    </div>
  )
}
