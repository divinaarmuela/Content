'use client'

import React from 'react'
import { Bookmark, Heart, ImagePlus, MessageCircle, MoreHorizontal, Send, ThumbsUp } from 'lucide-react'
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

  if (card.kind === 'mockup') {
    const platform = card.platform ?? 'ig_post'
    const handle = 'yourclient'
    const img = card.url ? (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={card.url} alt="mockup" loading="lazy" decoding="async" draggable={false}
        className="h-full w-full select-none object-cover" />
    ) : (
      <div className="flex h-full w-full flex-col items-center justify-center gap-1 text-zinc-400">
        <ImagePlus className="h-5 w-5" />
        <span className="text-[10px]">Select, then add the image</span>
      </div>
    )

    if (platform === 'ig_story' || platform === 'ig_reel') {
      // 9:16 phone frame
      return (
        <div className="overflow-hidden rounded-2xl border border-zinc-300 bg-black shadow-md dark:border-zinc-700" style={{ width: card.w }}>
          <div className="relative" style={{ aspectRatio: '9 / 16' }}>
            <div className="absolute inset-0 bg-zinc-900">{img}</div>
            <div className="absolute inset-x-0 top-0 flex items-center gap-2 bg-gradient-to-b from-black/60 to-transparent p-2">
              <span className="h-6 w-6 rounded-full bg-gradient-to-tr from-amber-400 via-rose-500 to-violet-500 p-[2px]">
                <span className="block h-full w-full rounded-full bg-zinc-800" />
              </span>
              <span className="text-[10px] font-semibold text-white">{handle}</span>
              <span className="text-[9px] text-white/70">{platform === 'ig_story' ? '2h' : 'Reels'}</span>
              <MoreHorizontal className="ml-auto h-3.5 w-3.5 text-white" />
            </div>
            {platform === 'ig_reel' && (
              <div className="absolute bottom-2 right-2 flex flex-col items-center gap-2.5 text-white">
                <Heart className="h-4 w-4" /><MessageCircle className="h-4 w-4" /><Send className="h-4 w-4" />
              </div>
            )}
            {platform === 'ig_story' && (
              <div className="absolute inset-x-0 top-1 flex gap-1 px-2">
                <span className="h-0.5 flex-1 rounded bg-white/90" />
                <span className="h-0.5 flex-1 rounded bg-white/30" />
              </div>
            )}
          </div>
        </div>
      )
    }

    if (platform === 'linkedin') {
      return (
        <div className="overflow-hidden rounded-lg border border-zinc-300 bg-white shadow-md dark:border-zinc-700 dark:bg-zinc-900" style={{ width: card.w }}>
          <div className="flex items-center gap-2 p-2.5">
            <span className="h-8 w-8 rounded-full bg-sky-700" />
            <span className="min-w-0">
              <span className="block text-[11px] font-semibold text-zinc-900 dark:text-zinc-100">Your Client</span>
              <span className="block text-[9px] text-zinc-500">1,204 followers · 2h</span>
            </span>
            <MoreHorizontal className="ml-auto h-3.5 w-3.5 text-zinc-400" />
          </div>
          <div className="relative bg-zinc-100 dark:bg-zinc-800" style={{ aspectRatio: '1.91 / 1' }}>{img}</div>
          <div className="flex items-center gap-4 px-3 py-2 text-zinc-500">
            <span className="flex items-center gap-1 text-[10px]"><ThumbsUp className="h-3 w-3" /> Like</span>
            <span className="flex items-center gap-1 text-[10px]"><MessageCircle className="h-3 w-3" /> Comment</span>
            <span className="flex items-center gap-1 text-[10px]"><Send className="h-3 w-3" /> Share</span>
          </div>
        </div>
      )
    }

    // ig_post / ig_carousel — square feed frame
    return (
      <div className="overflow-hidden rounded-lg border border-zinc-300 bg-white shadow-md dark:border-zinc-700 dark:bg-zinc-900" style={{ width: card.w }}>
        <div className="flex items-center gap-2 p-2">
          <span className="h-6 w-6 rounded-full bg-gradient-to-tr from-amber-400 via-rose-500 to-violet-500 p-[2px]">
            <span className="block h-full w-full rounded-full bg-white dark:bg-zinc-900" />
          </span>
          <span className="text-[11px] font-semibold text-zinc-900 dark:text-zinc-100">{handle}</span>
          <MoreHorizontal className="ml-auto h-3.5 w-3.5 text-zinc-400" />
        </div>
        <div className="relative bg-zinc-100 dark:bg-zinc-800" style={{ aspectRatio: '1 / 1' }}>
          {img}
          {platform === 'ig_carousel' && (
            <>
              <span className="absolute right-2 top-2 rounded-full bg-black/60 px-1.5 py-0.5 text-[9px] text-white">1/5</span>
              <div className="absolute inset-x-0 bottom-1.5 flex justify-center gap-1">
                {[0, 1, 2, 3, 4].map(i => (
                  <span key={i} className={`h-1 w-1 rounded-full ${i === 0 ? 'bg-sky-500' : 'bg-white/60'}`} />
                ))}
              </div>
            </>
          )}
        </div>
        <div className="flex items-center gap-3 px-2.5 py-2 text-zinc-700 dark:text-zinc-300">
          <Heart className="h-4 w-4" /><MessageCircle className="h-4 w-4" /><Send className="h-4 w-4" />
          <Bookmark className="ml-auto h-4 w-4" />
        </div>
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
