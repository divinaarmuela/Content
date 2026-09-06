'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  ChevronRight, Columns3, FolderPlus, Heading, ImagePlus, Link2, Maximize2, MessageCircle, Minus,
  Pencil, Plus, StickyNote, Trash2,
} from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { useTable } from '@/lib/db-client'
import type { Board } from '@/lib/db-types'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { uploadMedia } from '../uploadMedia'
import { useIsMobile } from '../useIsMobile'
import { useRole } from '../useRole'
import {
  canvasToScreen, carryStack, columnUnder, commentsFor, DEFAULT_VIEW, drawOrder, fitAll, isSafeUrl,
  itemsInColumn, keyboardNudge, moveTo, panBy, resizeTo, screenToCanvas, viewCentre, zoomAt, ZOOM_STEP,
  zoomLabel, type CanvasColour, type CanvasItem, type ItemKind, type Point, type View,
} from '@/app/lib/board-canvas-core'
import CanvasItemView, { type ChildBoard } from './CanvasItemView'
import CommentPanel, { itemTitle } from './CommentPanel'
import NewBoardDialog, { SwatchRow } from './NewBoardDialog'
import AddDialog, { type AddKind } from './AddDialog'
import { useBoard, type LiveItem } from './useBoard'

/**
 * THE CANVAS. A free surface things sit on where they were put.
 *
 * Pan by dragging the empty canvas (or two fingers on a trackpad); zoom with
 * ctrl/⌘ + wheel or the buttons; drag an item to move it, its corner to
 * resize it; pick one and the arrow keys nudge it. Every position lands
 * through the API the moment the pointer lets go, snapped by the core.
 *
 * Reusable: the Boards page mounts it for a client's board, and
 * `ItemBoard` mounts it as the sub-page behind a piece of work. It takes a
 * board id and nothing else.
 */

type Gesture =
  | { mode: 'pan'; start: Point; origin: View; moved: boolean }
  | { mode: 'drag'; id: string; start: Point; origin: Point; moved: boolean }
  | { mode: 'resize'; id: string; start: Point; origin: { w: number; h: number }; moved: boolean }

const VIEW_KEY = (id: string) => `md-board-view-${id}`

export default function BoardCanvas({ boardId, backHref, embedded = false }: {
  boardId: string
  /** where the first breadcrumb goes back to — the Boards list, or the card */
  backHref?: { href: string; label: string }
  /** inside another page: shorter, no page title of its own */
  embedded?: boolean
}) {
  const router = useRouter()
  const mobile = useIsMobile()
  const { role } = useRole()
  const {
    board, loading, error, items, comments, crumbs, inside,
    preview, patchItem, addItem, removeItem, makeBoard, renameBoard, addComment, resolveComment,
  } = useBoard(boardId, role)

  // the client's boards, live, for tile names/icons and the breadcrumb words
  const boardsBy = useMemo(() => ({ client_id: board?.client_id ?? '' }), [board?.client_id])
  const clientBoards = useTable<Board>('boards', { by: boardsBy, enabled: !!board?.client_id })
  const children = useMemo(() => {
    const m = new Map<string, ChildBoard>()
    for (const b of clientBoards.rows) m.set(b.id, { id: b.id, name: b.name, icon: b.icon, colour: b.colour })
    return m
  }, [clientBoards.rows])

  const containerRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const [view, setView] = useState<View>(DEFAULT_VIEW)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [commentsFor_, setCommentsFor] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<LiveItem | null>(null)
  const [dialog, setDialog] = useState<AddKind | 'board' | 'rename' | null>(null)
  const gesture = useRef<Gesture | null>(null)
  const viewRef = useRef(view)
  viewRef.current = view

  /* ── the view: remembered per board, fitted on first open ─────────────── */
  useEffect(() => {
    try {
      const saved = localStorage.getItem(VIEW_KEY(boardId))
      if (saved) { setView(JSON.parse(saved)); return }
    } catch { /* no storage — start at the default */ }
    setView(DEFAULT_VIEW)
  }, [boardId])
  useEffect(() => {
    try { localStorage.setItem(VIEW_KEY(boardId), JSON.stringify(view)) } catch { /* fine */ }
  }, [boardId, view])

  const viewportSize = () => {
    const el = containerRef.current
    return { w: el?.clientWidth ?? 1000, h: el?.clientHeight ?? 700 }
  }

  /* ── the pointer ─────────────────────────────────────────────────────── */
  const itemById = useCallback((id: string) => items.find(i => i.id === id) ?? null, [items])

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return
    const target = e.target as HTMLElement
    if (target.closest('[data-no-drag]')) return
    const container = containerRef.current
    if (!container) return
    const start = { x: e.clientX, y: e.clientY }
    const handle = target.closest('[data-resize]') as HTMLElement | null
    const el = target.closest('[data-item]') as HTMLElement | null
    if (handle && selectedId) {
      const it = itemById(selectedId)
      if (!it) return
      gesture.current = { mode: 'resize', id: it.id, start, origin: { w: it.w, h: it.h }, moved: false }
    } else if (el) {
      const id = el.dataset.item as string
      if (editingId && editingId !== id) setEditingId(null)
      if (editingId === id) return
      setSelectedId(id)
      const it = itemById(id)
      if (!it) return
      gesture.current = { mode: 'drag', id, start, origin: { x: it.x, y: it.y }, moved: false }
    } else {
      setEditingId(null)
      gesture.current = { mode: 'pan', start, origin: viewRef.current, moved: false }
    }
    container.setPointerCapture(e.pointerId)
    container.focus({ preventScroll: true })
  }

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const g = gesture.current
    if (!g) return
    const dx = e.clientX - g.start.x
    const dy = e.clientY - g.start.y
    if (!g.moved && Math.hypot(dx, dy) < 4) return
    g.moved = true
    const zoom = viewRef.current.zoom
    if (g.mode === 'pan') {
      setView({ ...g.origin, panX: g.origin.panX + dx, panY: g.origin.panY + dy })
    } else if (g.mode === 'drag') {
      const it = itemById(g.id)
      if (!it) return
      const to = { x: g.origin.x + dx / zoom, y: g.origin.y + dy / zoom }
      preview(g.id, to)
      if (it.kind === 'column') {
        for (const p of carryStack(it, to, itemsInColumn(it, items))) preview(p.id, p)
      }
    } else {
      preview(g.id, { w: g.origin.w + dx / zoom, h: g.origin.h + dy / zoom })
    }
  }

  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const g = gesture.current
    gesture.current = null
    containerRef.current?.releasePointerCapture(e.pointerId)
    if (!g) return
    if (g.mode === 'pan') {
      if (!g.moved) { setSelectedId(null); setCommentsFor(null) }
      return
    }
    if (!g.moved) return
    const it = itemById(g.id)
    if (!it) return
    if (g.mode === 'drag') {
      const to = moveTo({ x: it.x, y: it.y })
      const patch: Record<string, unknown> = { x: to.x, y: to.y }
      if (it.kind !== 'column') {
        const col = columnUnder({ ...it, ...to } as CanvasItem, items.filter(i => i.id !== it.id))
        const parent = col?.id ?? null
        if (parent !== (it.parent_item_id ?? null)) patch.parent_item_id = parent
      }
      void patchItem(it.id, patch)
    } else {
      const s = resizeTo(it.kind as ItemKind, { w: it.w, h: it.h })
      void patchItem(it.id, { w: s.w, h: s.h })
    }
  }

  /* ── the wheel: pan, or zoom with ctrl/⌘ ─────────────────────────────── */
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const rect = el.getBoundingClientRect()
      const at = { x: e.clientX - rect.left, y: e.clientY - rect.top }
      if (e.ctrlKey || e.metaKey) {
        setView(v => zoomAt(v, e.deltaY < 0 ? 1.1 : 1 / 1.1, at))
      } else {
        setView(v => panBy(v, { x: -e.deltaX, y: -e.deltaY }))
      }
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  /* ── the keyboard ────────────────────────────────────────────────────── */
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (editingId) return
    if (e.key === 'Escape') { setSelectedId(null); setCommentsFor(null); return }
    if (!selectedId) return
    const it = itemById(selectedId)
    if (!it) return
    const nudge = keyboardNudge(e.key, e.shiftKey)
    if (nudge) {
      e.preventDefault()
      const to = moveTo({ x: it.x + nudge.x, y: it.y + nudge.y })
      void patchItem(it.id, to)
      return
    }
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); askDelete(it); return }
    if (e.key === 'Enter' && (it.kind === 'note' || it.kind === 'heading' || it.kind === 'column' || it.kind === 'link')) {
      e.preventDefault(); setEditingId(it.id)
    }
  }

  /* ── adding things ───────────────────────────────────────────────────── */
  const centre = () => viewCentre(viewRef.current, viewportSize())

  const addNote = async () => {
    const at = centre()
    const made = await addItem({ kind: 'note', text: '', x: at.x - 144, y: at.y - 88 })
    if (made) { setSelectedId(made.id); setEditingId(made.id) }
  }

  const addFromDialog = async (kind: AddKind, v: { url?: string; label?: string; text?: string }) => {
    const at = centre()
    const made = kind === 'link'
      ? await addItem({ kind: 'link', url: v.url, label: v.label, x: at.x - 144, y: at.y - 48 })
      : kind === 'heading'
        ? await addItem({ kind: 'heading', text: v.text, x: at.x - 480, y: at.y - 32 })
        : await addItem({ kind: 'column', column_title: v.text, x: at.x - 160, y: at.y - 240 })
    if (made) setSelectedId(made.id)
  }

  const addImages = async (files: File[], at?: Point) => {
    const images = files.filter(f => f.type.startsWith('image/'))
    if (!images.length) { toast.error('Drop or paste an image — other files go on as a link'); return }
    let where = at ?? centre()
    for (const file of images) {
      try {
        const { url } = await uploadMedia(file, { purpose: 'board' })
        const made = await addItem({ kind: 'image', url, label: file.name, x: where.x - 160, y: where.y - 120 })
        if (made) setSelectedId(made.id)
        where = { x: where.x + 32, y: where.y + 32 }
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'That image did not upload — try dropping it again')
      }
    }
  }

  // paste: an image file, a link, or words
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const el = containerRef.current
      if (!el || !el.contains(document.activeElement) || editingId) return
      const files = Array.from(e.clipboardData?.files ?? [])
      if (files.length) { e.preventDefault(); void addImages(files); return }
      const text = e.clipboardData?.getData('text/plain')?.trim()
      if (!text) return
      e.preventDefault()
      const at = centre()
      const maybeUrl: unknown = text
      if (isSafeUrl(maybeUrl)) void addItem({ kind: 'link', url: maybeUrl, x: at.x - 144, y: at.y - 48 })
      else void addItem({ kind: 'note', text: `<p>${text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\n/g, '<br>')}</p>`, x: at.x - 144, y: at.y - 88 })
    }
    document.addEventListener('paste', onPaste)
    return () => document.removeEventListener('paste', onPaste)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingId, addItem])

  const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    const rect = containerRef.current?.getBoundingClientRect()
    const at = rect ? screenToCanvas(viewRef.current, { x: e.clientX - rect.left, y: e.clientY - rect.top }) : centre()
    const files = Array.from(e.dataTransfer.files)
    if (files.length) { void addImages(files, at); return }
    const url = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain')
    if (url && isSafeUrl(url.trim())) void addItem({ kind: 'link', url: url.trim(), x: at.x, y: at.y })
  }

  /* ── deleting ────────────────────────────────────────────────────────── */
  const askDelete = (it: LiveItem) => {
    if (it.kind === 'board' || it.kind === 'column' || commentsFor(it.id, comments).length) setConfirmDelete(it)
    else { void removeItem(it.id); setSelectedId(null) }
  }

  /* ── render ──────────────────────────────────────────────────────────── */
  const selected = selectedId ? itemById(selectedId) : null
  const commentItem = commentsFor_ ? itemById(commentsFor_) : null
  const ordered = useMemo(() => drawOrder(items), [items])
  const selectedScreen = selected ? canvasToScreen(view, selected) : null
  const canDraw = role !== null && role !== 'client'

  if (error) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center gap-3 rounded-card border border-dashed border-border bg-surface py-16 text-center">
        <p className="text-[17px] font-semibold">This board could not be opened</p>
        <p className="max-w-xs text-[13px] text-muted-foreground">{error}</p>
        {backHref && <Button asChild variant="outline"><Link href={backHref.href}>{backHref.label}</Link></Button>}
      </div>
    )
  }

  return (
    <div className={cn('flex flex-col gap-3', embedded ? 'h-[70dvh] min-h-[480px]' : 'h-[calc(100dvh-var(--dbx-chrome,9rem))] min-h-[520px]')}>
      {/* breadcrumbs and the board's own controls */}
      <div className="flex flex-wrap items-center gap-1 text-[13px]">
        {backHref && (
          <>
            <Link href={backHref.href} className="inline-flex min-h-11 items-center rounded-full px-2 font-semibold text-muted-foreground hover:text-foreground">{backHref.label}</Link>
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          </>
        )}
        {crumbs.map((c, i) => (
          <span key={c.id} className="inline-flex items-center gap-1">
            {i < crumbs.length - 1 ? (
              <>
                <Link href={`/dashboard/boards/${c.id}`} className="inline-flex min-h-11 items-center rounded-full px-2 font-semibold text-muted-foreground hover:text-foreground">{children.get(c.id)?.name ?? c.name}</Link>
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              </>
            ) : (
              /* the board's name IS the page's title; inside a card it is
                 the card's page and the crumb stays a span */
              <span className="inline-flex min-h-11 items-center gap-1 px-2 text-[17px] font-semibold">
                {embedded
                  ? <span>{board?.name ?? c.name}</span>
                  : <h1 className="text-[17px] font-semibold">{board?.name ?? c.name}</h1>}
                {canDraw && (
                  <button type="button" onClick={() => setDialog('rename')} aria-label="Rename this board" className="inline-flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11">
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                )}
              </span>
            )}
          </span>
        ))}
        {loading && !crumbs.length && <Skeleton className="h-6 w-40" />}
        <div className="ml-auto flex items-center gap-1">
          <button type="button" aria-label="Zoom out" onClick={() => setView(v => zoomAt(v, 1 / ZOOM_STEP, { x: viewportSize().w / 2, y: viewportSize().h / 2 }))} className="inline-flex h-11 w-11 items-center justify-center rounded-full hover:bg-foreground/[0.06]"><Minus className="h-4 w-4" /></button>
          <span className="w-12 text-center tabular-nums text-muted-foreground">{zoomLabel(view.zoom)}</span>
          <button type="button" aria-label="Zoom in" onClick={() => setView(v => zoomAt(v, ZOOM_STEP, { x: viewportSize().w / 2, y: viewportSize().h / 2 }))} className="inline-flex h-11 w-11 items-center justify-center rounded-full hover:bg-foreground/[0.06]"><Plus className="h-4 w-4" /></button>
          <button type="button" aria-label="Fit everything on screen" title="Fit everything" onClick={() => setView(fitAll(items, viewportSize()))} className="inline-flex h-11 w-11 items-center justify-center rounded-full hover:bg-foreground/[0.06]"><Maximize2 className="h-4 w-4" /></button>
        </div>
      </div>

      <div className="relative min-h-0 flex-1">
        {/* the surface */}
        <div
          ref={containerRef}
          tabIndex={0}
          role="application"
          aria-label={`${board?.name ?? 'Board'} canvas`}
          className={cn(
            'relative h-full w-full touch-none overflow-hidden rounded-card border border-border bg-paper outline-none focus-visible:ring-2 focus-visible:ring-ring',
            'bg-[radial-gradient(circle,rgba(0,0,0,0.07)_1px,transparent_1px)] dark:bg-[radial-gradient(circle,rgba(255,255,255,0.07)_1px,transparent_1px)]',
            gesture.current?.mode === 'pan' ? 'cursor-grabbing' : 'cursor-grab',
          )}
          style={{ backgroundSize: `${16 * view.zoom}px ${16 * view.zoom}px`, backgroundPosition: `${view.panX}px ${view.panY}px` }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onKeyDown={onKeyDown}
          onDragOver={e => e.preventDefault()}
          onDrop={onDrop}
        >
          <div
            className="absolute left-0 top-0"
            style={{ transform: `translate(${view.panX}px, ${view.panY}px) scale(${view.zoom})`, transformOrigin: '0 0' }}
          >
            {ordered.map(it => (
              <CanvasItemView
                key={it.id}
                item={it}
                selected={it.id === selectedId}
                editing={it.id === editingId}
                commentCount={commentsFor(it.id, comments).filter(c => !c.resolved_at).length}
                inside={it.kind === 'board' && it.child_board_id ? inside[it.child_board_id]
                  : it.kind === 'column' ? { cards: itemsInColumn(it, items).length, boards: 0 } : undefined}
                child={it.child_board_id ? children.get(it.child_board_id) : undefined}
                onEdit={() => canDraw && setEditingId(it.id)}
                onStopEditing={() => setEditingId(null)}
                onCommitText={patch => void patchItem(it.id, patch)}
                onOpenBoard={id => router.push(`/dashboard/boards/${id}`)}
                onOpenComments={() => { setSelectedId(it.id); setCommentsFor(it.id) }}
              />
            ))}
            {/* the resize corner of the selected item */}
            {selected && canDraw && selected.kind !== 'board' && (
              <div
                data-resize
                aria-label="Resize"
                className="absolute z-[3000] h-6 w-6 cursor-nwse-resize rounded-full border-2 border-background bg-accent-blue"
                style={{ left: selected.x + selected.w - 12, top: selected.y + selected.h - 12, transform: `scale(${1 / view.zoom})` }}
              />
            )}
          </div>

          {/* the bar over the selected item: colour, comment, delete */}
          {selected && selectedScreen && !editingId && (
            <div
              data-no-drag
              className="absolute z-[4000] flex items-center gap-1 rounded-full border border-border bg-popover p-1 text-popover-foreground shadow-lg"
              style={{ left: Math.max(8, selectedScreen.x), top: Math.max(8, selectedScreen.y - 56) }}
            >
              {canDraw && selected.kind !== 'image' && (
                <SwatchRow size="sm" value={selected.colour as CanvasColour | null} onChange={c => void patchItem(selected.id, { colour: c })} />
              )}
              <button type="button" onClick={() => setCommentsFor(selected.id)} className="inline-flex h-9 items-center gap-1 rounded-full px-3 text-[12px] font-semibold hover:bg-foreground/[0.06] [@media(pointer:coarse)]:h-11">
                <MessageCircle className="h-4 w-4" /> Comment
              </button>
              {canDraw && (
                <button type="button" onClick={() => askDelete(selected)} aria-label="Remove from the board" className="inline-flex h-9 w-9 items-center justify-center rounded-full text-accent-red hover:bg-tint-red [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11">
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </div>
          )}

          {/* the toolbar: what can go on the board */}
          {canDraw && (
            <div className={cn('absolute z-[4000] flex gap-1 rounded-full border border-border bg-popover p-1 text-popover-foreground shadow-lg', mobile ? 'bottom-3 left-1/2 -translate-x-1/2' : 'left-3 top-3')}>
              <Tool icon={<StickyNote className="h-4 w-4" />} label="Note" onClick={() => void addNote()} compact={mobile} />
              <Tool icon={<ImagePlus className="h-4 w-4" />} label="Image" onClick={() => fileRef.current?.click()} compact={mobile} />
              <Tool icon={<Link2 className="h-4 w-4" />} label="Link" onClick={() => setDialog('link')} compact={mobile} />
              <Tool icon={<FolderPlus className="h-4 w-4" />} label="Board" onClick={() => setDialog('board')} compact={mobile} />
              <Tool icon={<Heading className="h-4 w-4" />} label="Heading" onClick={() => setDialog('heading')} compact={mobile} />
              <Tool icon={<Columns3 className="h-4 w-4" />} label="Column" onClick={() => setDialog('column')} compact={mobile} />
            </div>
          )}
          <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={e => { const f = Array.from(e.target.files ?? []); e.target.value = ''; void addImages(f) }} />

          {!loading && items.length === 0 && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <p className="max-w-xs rounded-card bg-surface/80 px-5 py-4 text-center text-[14px] text-muted-foreground">
                {canDraw ? 'An empty board. Add a note, drop an image, paste a link, or make a board inside this one.' : 'Nothing on this board yet.'}
              </p>
            </div>
          )}
        </div>

        {commentItem && (
          <CommentPanel
            item={commentItem}
            comments={comments}
            onAdd={body => addComment(commentItem.id, body)}
            onResolve={id => resolveComment(commentItem.id, id)}
            onClose={() => setCommentsFor(null)}
            className={mobile ? 'absolute inset-x-2 bottom-2 top-1/3 z-[5000]' : 'absolute bottom-3 right-3 top-3 z-[5000] w-[340px]'}
          />
        )}
      </div>

      <NewBoardDialog
        open={dialog === 'board'}
        onOpenChange={o => setDialog(o ? 'board' : null)}
        onSubmit={async v => {
          const at = centre()
          const made = await makeBoard({ ...v, at: { x: at.x - 96, y: at.y - 96 } })
          if (made) toast.success(`${made.name} is ready`, { action: { label: 'Open', onClick: () => router.push(`/dashboard/boards/${made.id}`) } })
        }}
      />
      <NewBoardDialog
        open={dialog === 'rename'}
        onOpenChange={o => setDialog(o ? 'rename' : null)}
        title="This board"
        submitLabel="Save"
        initial={board ? { name: board.name, icon: board.icon, colour: board.colour } : undefined}
        onSubmit={v => renameBoard(v)}
      />
      {(dialog === 'link' || dialog === 'heading' || dialog === 'column') && (
        <AddDialog kind={dialog} open onOpenChange={o => setDialog(o ? dialog : null)} onSubmit={v => addFromDialog(dialog, v)} />
      )}

      <AlertDialog open={!!confirmDelete} onOpenChange={o => { if (!o) setConfirmDelete(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove “{confirmDelete ? itemTitle(confirmDelete) : ''}”?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmDelete?.kind === 'board'
                ? 'The board and everything inside it go with it. This cannot be undone.'
                : confirmDelete?.kind === 'column'
                  ? 'The column goes; what was in it stays on the board.'
                  : 'Its comments go with it.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction onClick={() => { if (confirmDelete) { void removeItem(confirmDelete.id); setSelectedId(null); setCommentsFor(null) } setConfirmDelete(null) }}>
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function Tool({ icon, label, onClick, compact }: { icon: React.ReactNode; label: string; onClick: () => void; compact: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={compact ? label : undefined}
      title={label}
      className={cn('inline-flex h-11 items-center gap-1.5 rounded-full text-[13px] font-semibold hover:bg-foreground/[0.06]', compact ? 'w-11 justify-center' : 'px-3')}
    >
      {icon}{!compact && label}
    </button>
  )
}
