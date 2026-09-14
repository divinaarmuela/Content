'use client'

import { useEffect, useRef, useState } from 'react'
import { ExternalLink, MessageCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import Chip from '../ui/Chip'
import {
  boardTileLayout, colourOf, countLabel, iconOf, linkService, sanitizeRichText, SERVICE_LABEL, type Inside, type ItemKind,
} from '@/app/lib/board-canvas-core'
import { COLOUR_CLASS, ICON } from './canvasTone'
import NoteEditor from './NoteEditor'
import type { LiveItem } from './useBoard'

/**
 * One thing on the canvas, drawn by its kind.
 *
 * Presentation: it does not know about the pointer, the view or the API.
 * The canvas positions it, decides whether it is selected or being edited,
 * and hands it what to do when its words change. Everything a finger can
 * hit inside it is 44px or marked `data-no-drag` so a tap on it never
 * starts a drag.
 */

export type ChildBoard = { id: string; name: string; icon: string; colour: string }

export default function CanvasItemView({
  item, selected, editing, commentCount, inside, child, onEdit, onStopEditing, onCommitText, onOpenBoard,
  onOpenComments,
}: {
  item: LiveItem
  selected: boolean
  editing: boolean
  commentCount: number
  /** for a board tile: what the board holds */
  inside?: Inside
  /** for a board tile: the board itself, for its icon and current name */
  child?: ChildBoard
  onEdit: () => void
  onStopEditing: () => void
  onCommitText: (patch: { text?: string; label?: string; column_title?: string }) => void
  onOpenBoard: (boardId: string) => void
  onOpenComments: () => void
}) {
  const kind = item.kind as ItemKind
  const colour = colourOf(kind, item.colour)
  const shell = cn(
    'group absolute flex flex-col overflow-hidden rounded-inner shadow-[0_1px_2px_rgba(0,0,0,0.06)] transition-[box-shadow] select-none',
    COLOUR_CLASS[colour],
    selected && 'ring-2 ring-accent-blue ring-offset-2 ring-offset-background',
    kind === 'column' && 'rounded-card',
  )
  const style = { left: item.x, top: item.y, width: item.w, height: item.h, zIndex: item.z + (kind === 'column' ? 0 : 1000) }

  const badge = commentCount > 0 && (
    <button
      type="button"
      data-no-drag
      onClick={onOpenComments}
      aria-label={`${commentCount} comments — open`}
      className="absolute right-1.5 top-1.5 inline-flex h-8 items-center gap-1 rounded-full bg-surface/90 px-2 text-[12px] font-semibold text-foreground shadow-sm hover:bg-surface [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:min-w-11"
    >
      <MessageCircle className="h-3.5 w-3.5" />{commentCount}
    </button>
  )

  if (kind === 'note') {
    return (
      <div data-item={item.id} data-kind="note" className={shell} style={style} onDoubleClick={onEdit}>
        {editing ? (
          <NoteEditor html={item.text ?? ''} onCommit={text => onCommitText({ text })} onClose={onStopEditing} />
        ) : (
          <div className="canvas-note h-full overflow-hidden px-3 py-2.5 text-[14px] leading-[1.45]">
            {item.text
              // stored text was sanitised on the way in; sanitising again on
              // the way out costs nothing and means no other writer can
              // ever put a script on a board
              ? <div dangerouslySetInnerHTML={{ __html: sanitizeRichText(item.text) }} />
              : <span className="text-muted-foreground">Double-click to write</span>}
          </div>
        )}
        {!editing && badge}
      </div>
    )
  }

  if (kind === 'image') {
    return (
      <div data-item={item.id} data-kind="image" className={cn(shell, 'bg-paper')} style={style}>
        {item.url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={item.url} alt={item.label ?? ''} draggable={false} className="h-full w-full object-cover" />
        )}
        {badge}
      </div>
    )
  }

  if (kind === 'link' && item.url) {
    const service = linkService(item.url)
    return (
      <div data-item={item.id} data-kind="link" className={cn(shell, 'flex-row items-center gap-3 px-3')} style={style} onDoubleClick={onEdit}>
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-tile bg-foreground/[0.06]">
          <ExternalLink className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          {editing ? (
            <InlineText value={item.label ?? ''} onCommit={label => { onCommitText({ label }); onStopEditing() }} onCancel={onStopEditing} />
          ) : (
            <p className="truncate text-[15px] font-semibold">{item.label}</p>
          )}
          <p className="truncate text-[12px] text-muted-foreground">{SERVICE_LABEL[service]} · opens where it lives</p>
        </div>
        <a
          data-no-drag
          href={item.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex h-11 shrink-0 items-center rounded-full bg-foreground px-4 text-[13px] font-semibold text-background hover:bg-foreground/90"
        >
          Open
        </a>
        {badge}
      </div>
    )
  }

  if (kind === 'board') {
    const Icon = ICON[iconOf(child?.icon)]
    const name = child?.name ?? item.label ?? 'Board'
    // a short tile gives things up in order — Open floats, then the icon and
    // words go small — so a resize never clips the icon or the name
    // (board-canvas-core.boardTileLayout, 14 Sep 2026)
    const tile = boardTileLayout(item.h)
    return (
      <div
        data-item={item.id}
        data-kind="board"
        data-tile={tile.small ? 'small' : tile.openFloats ? 'short' : 'full'}
        className={cn(shell, 'items-center justify-center p-3 text-center', tile.small ? 'gap-1.5' : 'gap-2')}
        style={style}
        onDoubleClick={() => item.child_board_id && onOpenBoard(item.child_board_id)}
      >
        <div className={cn('flex shrink-0 items-center justify-center rounded-card bg-surface/70 dark:bg-foreground/10', tile.small ? 'h-10 w-10' : 'h-14 w-14')}>
          <Icon className={tile.small ? 'h-5 w-5' : 'h-7 w-7'} />
        </div>
        <p className={cn('line-clamp-2 max-w-full break-words font-semibold leading-tight', tile.small ? 'text-[13px]' : 'text-[15px]')}>{name}</p>
        <p className={cn('truncate max-w-full text-muted-foreground', tile.small ? 'text-[11px]' : 'text-[12px]')}>{countLabel(inside ?? { cards: 0, boards: 0 })}</p>
        <button
          type="button"
          data-no-drag
          onClick={() => item.child_board_id && onOpenBoard(item.child_board_id)}
          className={cn(
            'inline-flex h-11 shrink-0 items-center justify-center rounded-full bg-foreground px-4 text-[13px] font-semibold text-background opacity-0 transition-opacity hover:bg-foreground/90 focus:opacity-100 group-hover:opacity-100 [@media(pointer:coarse)]:opacity-100',
            tile.openFloats ? 'absolute inset-x-3 bottom-2' : 'mt-1',
          )}
        >
          Open
        </button>
        {badge}
      </div>
    )
  }

  if (kind === 'heading') {
    return (
      <div data-item={item.id} data-kind="heading" className={cn(shell, 'justify-center px-5')} style={style} onDoubleClick={onEdit}>
        {editing ? (
          <InlineText value={item.text ?? ''} onCommit={text => { onCommitText({ text }); onStopEditing() }} onCancel={onStopEditing} className="text-[20px] font-semibold uppercase tracking-wide" />
        ) : (
          <p className="truncate text-[20px] font-semibold uppercase tracking-wide">{item.text}</p>
        )}
        {badge}
      </div>
    )
  }

  if (kind === 'column') {
    return (
      <div data-item={item.id} data-kind="column" className={cn(shell, 'shadow-none')} style={style} onDoubleClick={onEdit}>
        <div className="flex h-14 shrink-0 items-center gap-2 px-4">
          {editing ? (
            <InlineText value={item.column_title ?? ''} onCommit={column_title => { onCommitText({ column_title }); onStopEditing() }} onCancel={onStopEditing} className="text-[15px] font-semibold" />
          ) : (
            <h3 className="min-w-0 flex-1 truncate text-[15px] font-semibold">{item.column_title}</h3>
          )}
          {inside && <Chip>{inside.cards}</Chip>}
        </div>
        {badge}
      </div>
    )
  }

  return null
}

/** One line of text, edited in place: Enter keeps it, Escape drops it. */
function InlineText({ value, onCommit, onCancel, className }: {
  value: string
  onCommit: (v: string) => void
  onCancel: () => void
  className?: string
}) {
  const [v, setV] = useState(value)
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => { ref.current?.focus(); ref.current?.select() }, [])
  return (
    <input
      ref={ref}
      data-no-drag
      value={v}
      onChange={e => setV(e.target.value)}
      onBlur={() => onCommit(v)}
      onKeyDown={e => {
        e.stopPropagation()
        if (e.key === 'Enter') { e.preventDefault(); onCommit(v) }
        if (e.key === 'Escape') { e.preventDefault(); onCancel() }
      }}
      className={cn('w-full min-w-0 bg-transparent outline-none', className)}
    />
  )
}
