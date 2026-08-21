'use client'

import React from 'react'
import { Link2 } from 'lucide-react'
import type { CanvasCard as Card } from '../../../../lib/batch-brief-core'

/** Sticky-note palette — light and dark resolved as pairs, never inverted. */
export const NOTE_COLORS: Record<string, string> = {
  paper: 'bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-700',
  yellow: 'bg-amber-100 dark:bg-amber-950/60 border-amber-200 dark:border-amber-900',
  pink: 'bg-rose-100 dark:bg-rose-950/60 border-rose-200 dark:border-rose-900',
  blue: 'bg-sky-100 dark:bg-sky-950/60 border-sky-200 dark:border-sky-900',
  green: 'bg-emerald-100 dark:bg-emerald-950/60 border-emerald-200 dark:border-emerald-900',
  purple: 'bg-violet-100 dark:bg-violet-950/60 border-violet-200 dark:border-violet-900',
}

/** One card on the board. Memoised per card object — a drag re-renders one
 *  card, not two hundred. Position is applied by the parent via transform. */
function CanvasCardInner({
  card, selected, editing, onCommitText,
}: {
  card: Card
  selected: boolean
  editing: boolean
  onCommitText: (text: string) => void
}) {
  if (card.kind === 'label') {
    if (editing) {
      return (
        <input
          autoFocus
          defaultValue={card.text ?? ''}
          placeholder="SECTION TITLE"
          className="w-56 bg-transparent font-mono text-sm uppercase tracking-widest text-zinc-500 outline-none placeholder:text-zinc-300 dark:text-zinc-400 dark:placeholder:text-zinc-600"
          onBlur={e => onCommitText(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' || e.key === 'Escape') { e.stopPropagation(); (e.target as HTMLInputElement).blur() }
          }}
          onPointerDown={e => e.stopPropagation()}
        />
      )
    }
    return (
      <span className="select-none whitespace-nowrap font-mono text-sm uppercase tracking-widest text-zinc-400 dark:text-zinc-500">
        {card.text || 'Double-click to name this section'}
      </span>
    )
  }

  if (card.kind === 'note') {
    const palette = NOTE_COLORS[card.color ?? 'paper'] ?? NOTE_COLORS.paper
    return (
      <div className={`rounded-lg border p-3 shadow-sm ${palette} ${selected ? '' : ''}`} style={{ width: card.w }}>
        {editing ? (
          <textarea
            autoFocus
            defaultValue={card.text ?? ''}
            rows={Math.max(3, (card.text ?? '').split('\n').length)}
            className="w-full resize-none bg-transparent text-[13px] leading-relaxed text-zinc-900 outline-none placeholder:text-zinc-400 dark:text-zinc-100"
            placeholder="Write it down…"
            onBlur={e => onCommitText(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Escape') { e.stopPropagation(); (e.target as HTMLTextAreaElement).blur() }
            }}
            onPointerDown={e => e.stopPropagation()}
          />
        ) : (
          <p className="whitespace-pre-wrap break-words text-[13px] leading-relaxed text-zinc-900 dark:text-zinc-100">
            {card.text || <span className="text-zinc-400">Write it down…</span>}
          </p>
        )}
      </div>
    )
  }

  if (card.kind === 'image') {
    return (
      <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900" style={{ width: card.w }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={card.url} alt={card.name ?? 'reference'} loading="lazy" decoding="async"
          draggable={false} className="w-full select-none" />
        {card.name && (
          <p className="truncate px-2 py-1 text-[11px] text-zinc-500 dark:text-zinc-400">{card.name}</p>
        )}
      </div>
    )
  }

  // link chip — click selects; opening happens via the toolbar or ctrl+click
  let host = card.url ?? ''
  try { host = new URL(card.url ?? '').hostname } catch { /* show as-is */ }
  return (
    <div className="flex items-center gap-2 rounded-lg border border-zinc-200 bg-white p-3 shadow-sm dark:border-zinc-800 dark:bg-zinc-900" style={{ width: card.w }}>
      <Link2 className="h-4 w-4 shrink-0 text-zinc-400" />
      <span className="min-w-0">
        <span className="block truncate text-[13px] font-medium text-zinc-900 dark:text-zinc-100">
          {card.name || host}
        </span>
        {card.name && <span className="block truncate text-[11px] text-zinc-400">{host}</span>}
      </span>
    </div>
  )
}

export const CanvasCardView = React.memo(CanvasCardInner)
