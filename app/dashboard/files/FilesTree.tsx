'use client'

import { useState } from 'react'
import { ChevronRight, Folder, HardDrive } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Crumb } from '@/app/lib/files-core'
import type { TreeNode } from './useDriveBrowse'

/**
 * The left rail: the HQ folder and everything under it, one branch at a time.
 *
 * A real `role="tree"`, which means the keyboard contract that goes with it:
 * Up and Down walk the rows that are actually VISIBLE (a shut branch's
 * children are not in the sequence), Right opens a branch, Left shuts it,
 * Home and End jump to the ends, and Enter opens the folder. One row at a time
 * holds `tabIndex={0}` — a roving tabindex — so Tab crosses the whole rail in
 * one press instead of walking three hundred folders.
 *
 * Branches load the first time they are opened: the owner's HQ has thousands
 * of folders under it, and asking for the shape up front would be a minute of
 * waiting for a rail nobody has clicked.
 *
 * Nothing here is a drop target and nothing is draggable. The dashboard makes
 * no writes to Google Drive, so there is no move to start and no upload to
 * land — a file dragged onto the rail does nothing at all, which is the
 * honest behaviour rather than a gesture that half works.
 */

export type TreeProps = {
  root: { id: string; name: string } | null
  branches: Record<string, TreeNode[]>
  open: string[]
  path: Crumb[]
  onToggle: (id: string) => void
  onOpenFolder: (crumb: Crumb) => void
}

/**
 * The rows a keyboard can actually reach, top to bottom.
 *
 * Exactly what is on the screen: a folder whose branch is shut contributes
 * itself and nothing below it. Up and Down move through THIS list, which is
 * what makes the arrow keys agree with what a person can see.
 */
export function visibleRows(
  root: TreeNode, branches: Record<string, TreeNode[]>, open: readonly string[],
): string[] {
  const rows: string[] = []
  const walk = (node: TreeNode) => {
    rows.push(node.id)
    if (!open.includes(node.id)) return
    for (const kid of branches[node.id] ?? []) walk(kid)
  }
  walk(root)
  return rows
}

/** Where an arrow key lands. Both ends stop rather than wrap — a tree that
 *  wraps loses people, because nothing on screen says it did. */
export function rowAfterKey(
  rows: readonly string[], from: string, key: string,
): string | null {
  const at = rows.indexOf(from)
  if (at === -1) return rows[0] ?? null
  if (key === 'ArrowDown') return rows[Math.min(at + 1, rows.length - 1)] ?? null
  if (key === 'ArrowUp') return rows[Math.max(at - 1, 0)] ?? null
  if (key === 'Home') return rows[0] ?? null
  if (key === 'End') return rows[rows.length - 1] ?? null
  return null
}

export default function FilesTree(props: TreeProps) {
  const { root, branches, open, path } = props
  const rows = root ? visibleRows(root, branches, open) : []
  // the one row Tab reaches: where you are, or the top
  const here = path[path.length - 1]?.id
  const [focus, setFocus] = useState<string | null>(null)
  const roving = (focus && rows.includes(focus) ? focus : null)
    ?? (here && rows.includes(here) ? here : null)
    ?? rows[0]
    ?? null

  const move = (from: string, key: string) => {
    const to = rowAfterKey(rows, from, key)
    if (!to) return
    setFocus(to)
    // the DOM node owns focus; React only decides which row may hold it
    document.getElementById(`files-tree-${to}`)?.focus()
  }

  if (!root) return null
  return (
    <div role="tree" aria-label="Folders" className="flex flex-col gap-0.5">
      <Branch {...props} node={root} depth={0} roving={roving} onMove={move} />
    </div>
  )
}

function Branch({
  node, depth, branches, open, path, onToggle, onOpenFolder, root, roving, onMove,
}: TreeProps & {
  node: TreeNode; depth: number
  roving: string | null
  onMove: (from: string, key: string) => void
}) {
  const isOpen = open.includes(node.id)
  const isCurrent = path.length > 0 && path[path.length - 1]?.id === node.id
  const onPath = path.some(c => c.id === node.id)
  const kids = branches[node.id]

  return (
    <div role="none">
      <div
        role="treeitem"
        aria-expanded={isOpen}
        aria-selected={isCurrent}
        aria-level={depth + 1}
        id={`files-tree-${node.id}`}
        tabIndex={roving === node.id ? 0 : -1}
        onClick={() => onOpenFolder({ id: node.id, name: node.name })}
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onOpenFolder({ id: node.id, name: node.name })
            return
          }
          if (e.key === 'ArrowRight' && !isOpen) { e.preventDefault(); onToggle(node.id); return }
          if (e.key === 'ArrowLeft' && isOpen) { e.preventDefault(); onToggle(node.id); return }
          if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
            e.preventDefault()
            onMove(node.id, e.key)
          }
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
              roving={roving}
              onMove={onMove}
            />
          ))}
        </div>
      )}
    </div>
  )
}
