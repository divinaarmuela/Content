'use client'

import React from 'react'
import {
  Bookmark, Forward, Globe, Heart, ImagePlus, MessageCircle, MoreHorizontal,
  Music2, Play, Send, ThumbsUp,
} from 'lucide-react'
import { Link2 } from 'lucide-react'
import type { CanvasCard as Card } from '../../../../lib/batch-brief-core'

/** Sticky-note palette — light and dark resolved as pairs, never inverted. */
export const NOTE_COLORS: Record<string, string> = {
  paper: 'bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-700',
  yellow: 'bg-amber-100 dark:bg-amber-950/60 border-amber-200 dark:border-amber-900',
  orange: 'bg-orange-100 dark:bg-orange-950/60 border-orange-200 dark:border-orange-900',
  red: 'bg-red-100 dark:bg-red-950/60 border-red-200 dark:border-red-900',
  pink: 'bg-rose-100 dark:bg-rose-950/60 border-rose-200 dark:border-rose-900',
  purple: 'bg-violet-100 dark:bg-violet-950/60 border-violet-200 dark:border-violet-900',
  blue: 'bg-sky-100 dark:bg-sky-950/60 border-sky-200 dark:border-sky-900',
  teal: 'bg-teal-100 dark:bg-teal-950/60 border-teal-200 dark:border-teal-900',
  green: 'bg-emerald-100 dark:bg-emerald-950/60 border-emerald-200 dark:border-emerald-900',
  ink: 'bg-zinc-800 dark:bg-zinc-950 border-zinc-700 dark:border-zinc-600',
}

/** One card on the board. Memoised per card object — a drag re-renders one
 *  card, not two hundred. Position is applied by the parent via transform. */
function CanvasCardInner({
  card, selected, editing, clientName, onCommitText, onUpdate,
}: {
  card: Card
  selected: boolean
  editing: boolean
  clientName?: string
  onCommitText: (text: string) => void
  /** whole-card change (todo rows etc.) — absent means read-only */
  onUpdate?: (next: Card) => void
}) {
  if (card.kind === 'todo') {
    const items = card.items ?? []
    const done = items.filter(t => t.done).length
    return (
      <div className="w-full rounded-lg border border-zinc-200 bg-white p-3 shadow-sm dark:border-zinc-700 dark:bg-zinc-900" style={{ width: card.w }}>
        <div className="mb-1.5 flex items-baseline justify-between gap-2">
          <span className="text-[12px] font-semibold text-zinc-900 dark:text-zinc-100">{card.name || 'To-do'}</span>
          {items.length > 0 && (
            <span className="font-mono text-[10px] tabular-nums text-zinc-400">{done}/{items.length}</span>
          )}
        </div>
        <div className="flex flex-col gap-1">
          {items.length === 0 && (
            <span className="text-[11px] text-zinc-400">Nothing to do yet.</span>
          )}
          {items.map(t => (
            <label key={t.id} className="group/row flex items-center gap-1.5"
              onPointerDown={e => e.stopPropagation()}>
              <input type="checkbox" checked={t.done} disabled={!onUpdate}
                className="h-3.5 w-3.5 shrink-0 accent-blue-600"
                onChange={e => onUpdate?.({ ...card, items: items.map(x => x.id === t.id ? { ...x, done: e.target.checked } : x) })} />
              {onUpdate ? (
                <input key={`${t.id}:${t.text}`} defaultValue={t.text}
                  className={`min-w-0 flex-1 bg-transparent text-[12px] outline-none ${t.done ? 'text-zinc-400 line-through' : 'text-zinc-800 dark:text-zinc-200'}`}
                  onBlur={e => {
                    const v = e.target.value.trim()
                    if (v === t.text) return
                    onUpdate({ ...card, items: v === ''
                      ? items.filter(x => x.id !== t.id)
                      : items.map(x => x.id === t.id ? { ...x, text: v } : x) })
                  }}
                  onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Escape') { e.stopPropagation(); (e.target as HTMLInputElement).blur() } }} />
              ) : (
                <span className={`text-[12px] ${t.done ? 'text-zinc-400 line-through' : 'text-zinc-800 dark:text-zinc-200'}`}>{t.text}</span>
              )}
            </label>
          ))}
        </div>
        {onUpdate && items.length < 30 && (
          <button type="button"
            className="mt-1.5 text-[11px] text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
            onPointerDown={e => e.stopPropagation()}
            onClick={e => {
              e.stopPropagation()
              onUpdate({ ...card, items: [...items, { id: Math.random().toString(36).slice(2, 10), text: 'New task', done: false }] })
            }}>
            + Add task
          </button>
        )}
      </div>
    )
  }

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
    // 'ink' is dark in both themes — its text must not follow the theme
    const inkText = card.color === 'ink' ? 'text-zinc-100' : 'text-zinc-900 dark:text-zinc-100'
    return (
      <div className={`rounded-lg border p-3 shadow-sm ${palette} ${selected ? '' : ''}`} style={{ width: card.w }}>
        {editing ? (
          <textarea
            autoFocus
            defaultValue={card.text ?? ''}
            rows={Math.max(3, (card.text ?? '').split('\n').length)}
            className={`w-full resize-none bg-transparent text-[13px] leading-relaxed outline-none placeholder:text-zinc-400 ${inkText}`}
            placeholder="Write it down…"
            onBlur={e => onCommitText(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Escape') { e.stopPropagation(); (e.target as HTMLTextAreaElement).blur() }
            }}
            onPointerDown={e => e.stopPropagation()}
          />
        ) : (
          <p className={`whitespace-pre-wrap break-words text-[13px] leading-relaxed ${inkText}`}>
            {card.text || <span className="text-zinc-400">Write it down…</span>}
          </p>
        )}
      </div>
    )
  }

  if (card.kind === 'mockup') {
    const platform = card.platform ?? 'ig_post'
    const name = (clientName ?? '').trim() || 'Your client'
    const handle = name.toLowerCase().replace(/[^a-z0-9._]/g, '') || 'yourclient'
    const initial = name.charAt(0).toUpperCase()
    const avatar = (cls: string) => (
      <span className={`flex shrink-0 items-center justify-center rounded-full font-semibold ${cls}`}>{initial}</span>
    )
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
    const caption = (card.text ?? '').trim()
    const captionEditor = (cls: string) => (
      <textarea autoFocus defaultValue={card.text ?? ''} rows={2} placeholder="Write the caption…"
        className={`w-full resize-none bg-transparent outline-none placeholder:opacity-50 ${cls}`}
        onBlur={e => onCommitText(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Escape' || (e.key === 'Enter' && !e.shiftKey)) { e.stopPropagation(); (e.target as HTMLTextAreaElement).blur() }
        }}
        onPointerDown={e => e.stopPropagation()} />
    )

    if (platform === 'ig_story' || platform === 'ig_reel' || platform === 'yt_short' || platform === 'tiktok') {
      // 9:16 phone frame
      const ig = platform === 'ig_story' || platform === 'ig_reel'
      return (
        <div className="overflow-hidden rounded-2xl border border-zinc-300 bg-black shadow-lg shadow-zinc-900/10 dark:border-zinc-700" style={{ width: card.w }}>
          <div className="relative" style={{ aspectRatio: '9 / 16' }}>
            <div className="absolute inset-0 bg-zinc-900">{img}</div>
            {ig && (
              <div className="absolute inset-x-0 top-0 flex items-center gap-2 bg-gradient-to-b from-black/60 to-transparent p-2">
                <span className="h-6 w-6 rounded-full bg-gradient-to-tr from-amber-400 via-rose-500 to-violet-500 p-[2px]">
                  {avatar('h-full w-full bg-zinc-800 text-[9px] text-white')}
                </span>
                <span className="text-[10px] font-semibold text-white">{handle}</span>
                <span className="text-[9px] text-white/70">{platform === 'ig_story' ? '2h' : 'Reels'}</span>
                <MoreHorizontal className="ml-auto h-3.5 w-3.5 text-white" />
              </div>
            )}
            {platform === 'yt_short' && (
              <div className="absolute inset-x-0 top-0 flex items-center justify-between bg-gradient-to-b from-black/60 to-transparent p-2">
                <span className="text-[10px] font-semibold text-white">Shorts</span>
                <MoreHorizontal className="h-3.5 w-3.5 text-white" />
              </div>
            )}
            {(platform === 'ig_reel' || platform === 'yt_short' || platform === 'tiktok') && (
              <div className="absolute bottom-8 right-2 flex flex-col items-center gap-2.5 text-white drop-shadow">
                {platform === 'yt_short'
                  ? <><ThumbsUp className="h-4 w-4" /><MessageCircle className="h-4 w-4" /><Forward className="h-4 w-4" /></>
                  : <><Heart className="h-4 w-4" /><MessageCircle className="h-4 w-4" /><Send className="h-4 w-4" /></>}
              </div>
            )}
            {(platform === 'yt_short' || platform === 'tiktok' || ((caption || editing) && platform === 'ig_reel')) && (
              <div className="absolute inset-x-0 bottom-0 flex flex-col gap-1 bg-gradient-to-t from-black/70 to-transparent p-2 pr-8">
                {platform !== 'ig_reel' && (
                  <span className="flex items-center gap-1.5">
                    {avatar('h-5 w-5 bg-zinc-700 text-[8px] text-white')}
                    <span className="truncate text-[10px] font-semibold text-white">@{handle}</span>
                  </span>
                )}
                {editing
                  ? captionEditor('text-[9px] leading-snug text-white')
                  : caption && <span className="line-clamp-2 text-[9px] leading-snug text-white/90">{caption}</span>}
                {platform === 'tiktok' && (
                  <span className="flex items-center gap-1 text-[8.5px] text-white/80">
                    <Music2 className="h-2.5 w-2.5 shrink-0" /> Original sound · {name}
                  </span>
                )}
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

    if (platform === 'youtube') {
      // 16:9 watch-page card
      return (
        <div className="overflow-hidden rounded-xl border border-zinc-300 bg-white shadow-lg shadow-zinc-900/10 dark:border-zinc-700 dark:bg-zinc-900" style={{ width: card.w }}>
          <div className="relative bg-zinc-100 dark:bg-zinc-800" style={{ aspectRatio: '16 / 9' }}>
            {img}
            {card.url && (
              <span className="absolute inset-0 m-auto flex h-9 w-12 items-center justify-center rounded-lg bg-black/70">
                <Play className="h-4 w-4 fill-white text-white" />
              </span>
            )}
            <span className="absolute bottom-1.5 right-1.5 rounded bg-black/80 px-1 py-0.5 font-mono text-[8.5px] tabular-nums text-white">0:34</span>
          </div>
          <div className="flex gap-2 p-2.5">
            {avatar('h-7 w-7 bg-zinc-200 text-[11px] text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300')}
            <span className="min-w-0 flex-1">
              {editing ? captionEditor('text-[11px] font-semibold leading-snug text-zinc-900 dark:text-zinc-100') : (
                <span className="block truncate text-[11px] font-semibold leading-snug text-zinc-900 dark:text-zinc-100">
                  {caption || card.name || 'Video title'}
                </span>
              )}
              <span className="block text-[9px] text-zinc-500">{name} · 1.2K views · 2 hours ago</span>
            </span>
            <MoreHorizontal className="ml-auto h-3.5 w-3.5 shrink-0 text-zinc-400" />
          </div>
        </div>
      )
    }

    if (platform === 'linkedin' || platform === 'facebook') {
      const fb = platform === 'facebook'
      return (
        <div className="overflow-hidden rounded-lg border border-zinc-300 bg-white shadow-lg shadow-zinc-900/10 dark:border-zinc-700 dark:bg-zinc-900" style={{ width: card.w }}>
          <div className="flex items-center gap-2 p-2.5">
            {avatar(`h-8 w-8 text-xs text-white ${fb ? 'bg-blue-600' : 'bg-sky-700'}`)}
            <span className="min-w-0">
              <span className="block truncate text-[11px] font-semibold text-zinc-900 dark:text-zinc-100">{name}</span>
              <span className="flex items-center gap-1 text-[9px] text-zinc-500">
                {fb ? <>2h · <Globe className="h-2.5 w-2.5" /></> : '1,204 followers · 2h'}
              </span>
            </span>
            <MoreHorizontal className="ml-auto h-3.5 w-3.5 shrink-0 text-zinc-400" />
          </div>
          {(caption || editing) && (
            <div className="px-2.5 pb-2 text-[10px] leading-snug text-zinc-800 dark:text-zinc-200">
              {editing ? captionEditor('text-[10px]') : <p className="whitespace-pre-wrap break-words">{caption}</p>}
            </div>
          )}
          <div className="relative bg-zinc-100 dark:bg-zinc-800" style={{ aspectRatio: fb ? '1 / 1' : '1.91 / 1' }}>{img}</div>
          <div className="flex items-center justify-around px-3 py-2 text-zinc-500">
            <span className="flex items-center gap-1 text-[10px]"><ThumbsUp className="h-3 w-3" /> Like</span>
            <span className="flex items-center gap-1 text-[10px]"><MessageCircle className="h-3 w-3" /> Comment</span>
            <span className="flex items-center gap-1 text-[10px]">
              {fb ? <Forward className="h-3 w-3" /> : <Send className="h-3 w-3" />} Share
            </span>
          </div>
        </div>
      )
    }

    // ig_post / ig_carousel — square feed frame
    return (
      <div className="overflow-hidden rounded-lg border border-zinc-300 bg-white shadow-lg shadow-zinc-900/10 dark:border-zinc-700 dark:bg-zinc-900" style={{ width: card.w }}>
        <div className="flex items-center gap-2 p-2">
          <span className="h-6 w-6 rounded-full bg-gradient-to-tr from-amber-400 via-rose-500 to-violet-500 p-[2px]">
            {avatar('h-full w-full bg-white text-[9px] text-zinc-700 dark:bg-zinc-900 dark:text-zinc-200')}
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
        <div className="px-2.5 pb-2 text-[10px] leading-snug text-zinc-700 dark:text-zinc-300">
          {editing ? captionEditor('text-[10px] text-zinc-800 dark:text-zinc-200') : (
            <p className="break-words">
              <span className="font-semibold text-zinc-900 dark:text-zinc-100">{handle}</span>{' '}
              {caption || <span className="opacity-50">Double-click to write the caption…</span>}
            </p>
          )}
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
