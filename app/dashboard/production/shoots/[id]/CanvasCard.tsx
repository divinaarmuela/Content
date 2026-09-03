'use client'

import React from 'react'
import {
  Bookmark, Forward, Globe, Heart, ImagePlus, MessageCircle, MoreHorizontal,
  Music2, Play, Send, ThumbsUp,
} from 'lucide-react'
import { Link2 } from 'lucide-react'
import type { CanvasCard as Card } from '../../../../lib/batch-brief-core'
import { embedUrlFor, isPlayableFile } from '../../../../lib/link-preview-core'

/** Sticky-note palette — light and dark resolved as pairs, never inverted. */
export const NOTE_COLORS: Record<string, string> = {
  paper: 'bg-surface border-border',
  yellow: 'bg-tint-amber border-accent-amber/35',
  orange: 'bg-tint-amber border-accent-amber/35',
  red: 'bg-tint-red border-accent-red/30',
  pink: 'bg-tint-red border-accent-red/30',
  purple: 'bg-tint-blue border-accent-blue/25',
  blue: 'bg-tint-blue border-accent-blue/25',
  teal: 'bg-tint-green border-accent-green/30',
  green: 'bg-tint-green border-accent-green/30',
  ink: 'bg-foreground border-border',
}

/** One card on the board. Memoised per card object — a drag re-renders one
 *  card, not two hundred. Position is applied by the parent via transform. */
/** The badge that turns a still into a player. Its own component because the
 *  image card and the link card both need it, and because it must stop the
 *  pointer reaching the canvas — a click that starts a drag is a click that
 *  never plays anything. */
function PlayBadge({ onPlay, label }: { onPlay?: () => void; label: string }) {
  return (
    <button
      type="button"
      aria-label={`Play ${label}`}
      onPointerDown={e => e.stopPropagation()}
      onClick={e => { e.stopPropagation(); onPlay?.() }}
      className="absolute inset-0 flex items-center justify-center"
    >
      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-black/60 backdrop-blur-sm transition-transform hover:scale-110">
        <Play className="h-4 w-4 translate-x-[1px] fill-white text-white" />
      </span>
    </button>
  )
}

function CanvasCardInner({
  card, selected, editing, clientName, onCommitText, onUpdate, playing, onPlay,
}: {
  card: Card
  selected: boolean
  editing: boolean
  clientName?: string
  /** this is the one card allowed to be a live player right now */
  playing?: boolean
  /** ask the canvas to make it that card */
  onPlay?: () => void
  onCommitText: (text: string) => void
  /** whole-card change (todo rows etc.) — absent means read-only */
  onUpdate?: (next: Card) => void
}) {
  // carousel mockups page through their slides — per-card, view-only state
  const [slide, setSlide] = React.useState(0)
  if (card.kind === 'todo') {
    const items = card.items ?? []
    const done = items.filter(t => t.done).length
    return (
      <div className="w-full rounded-inner border border-border bg-surface p-3 shadow-sm" style={{ width: card.w }}>
        <div className="mb-1.5 flex items-baseline justify-between gap-2">
          <span className="text-[12px] font-semibold text-foreground">{card.name || 'To-do'}</span>
          {items.length > 0 && (
            <span className="font-mono text-[12px] tabular-nums text-muted-foreground">{done}/{items.length}</span>
          )}
        </div>
        <div className="flex flex-col gap-1">
          {items.length === 0 && (
            <span className="text-[12px] text-muted-foreground">Nothing to do yet.</span>
          )}
          {items.map(t => (
            <label key={t.id} className="group/row flex items-center gap-1.5"
              onPointerDown={e => e.stopPropagation()}>
              <input type="checkbox" checked={t.done} disabled={!onUpdate}
                className="h-3.5 w-3.5 shrink-0 accent-[var(--dbx-blue)]"
                onChange={e => onUpdate?.({ ...card, items: items.map(x => x.id === t.id ? { ...x, done: e.target.checked } : x) })} />
              {onUpdate ? (
                <input key={`${t.id}:${t.text}`} defaultValue={t.text}
                  className={`min-w-0 flex-1 bg-transparent text-[12px] outline-none ${t.done ? 'text-muted-foreground line-through' : 'text-foreground'}`}
                  onBlur={e => {
                    const v = e.target.value.trim()
                    if (v === t.text) return
                    onUpdate({ ...card, items: v === ''
                      ? items.filter(x => x.id !== t.id)
                      : items.map(x => x.id === t.id ? { ...x, text: v } : x) })
                  }}
                  onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Escape') { e.stopPropagation(); (e.target as HTMLInputElement).blur() } }} />
              ) : (
                <span className={`text-[12px] ${t.done ? 'text-muted-foreground line-through' : 'text-foreground'}`}>{t.text}</span>
              )}
            </label>
          ))}
        </div>
        {onUpdate && items.length < 30 && (
          <button type="button"
            className="mt-1.5 text-[12px] text-muted-foreground hover:text-foreground"
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
          className="w-56 bg-transparent font-mono text-body-15 uppercase tracking-widest text-muted-foreground outline-none placeholder:text-muted-foreground dark:placeholder:text-muted-foreground"
          onBlur={e => onCommitText(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' || e.key === 'Escape') { e.stopPropagation(); (e.target as HTMLInputElement).blur() }
          }}
          onPointerDown={e => e.stopPropagation()}
        />
      )
    }
    return (
      <span className="select-none whitespace-nowrap font-mono text-body-15 uppercase tracking-widest text-muted-foreground">
        {card.text || 'Double-click to name this section'}
      </span>
    )
  }

  if (card.kind === 'note') {
    const palette = NOTE_COLORS[card.color ?? 'paper'] ?? NOTE_COLORS.paper
    // 'ink' is dark in both themes — its text must not follow the theme
    const inkText = card.color === 'ink' ? 'text-background' : 'text-foreground'
    return (
      <div className={`rounded-inner border p-3 shadow-sm ${palette} ${selected ? '' : ''}`} style={{ width: card.w }}>
        {editing ? (
          <textarea
            autoFocus
            defaultValue={card.text ?? ''}
            rows={Math.max(3, (card.text ?? '').split('\n').length)}
            className={`w-full resize-none bg-transparent text-[13px] leading-relaxed outline-none placeholder:text-muted-foreground ${inkText}`}
            placeholder="Write it down…"
            onBlur={e => onCommitText(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Escape') { e.stopPropagation(); (e.target as HTMLTextAreaElement).blur() }
            }}
            onPointerDown={e => e.stopPropagation()}
          />
        ) : (
          <p className={`whitespace-pre-wrap break-words text-[13px] leading-relaxed ${inkText}`}>
            {card.text || <span className="text-muted-foreground">Write it down…</span>}
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
      <div className="flex h-full w-full flex-col items-center justify-center gap-1 text-muted-foreground">
        <ImagePlus className="h-5 w-5" />
        <span className="text-[12px]">Select, then add the image</span>
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
        <div className="overflow-hidden rounded-card border border-border bg-black shadow-lg shadow-foreground/10" style={{ width: card.w }}>
          <div className="relative" style={{ aspectRatio: '9 / 16' }}>
            <div className="absolute inset-0 bg-foreground">{img}</div>
            {ig && (
              <div className="absolute inset-x-0 top-0 flex items-center gap-2 bg-gradient-to-b from-black/60 to-transparent p-2">
                <span className="h-6 w-6 rounded-full bg-gradient-to-tr from-amber-400 via-rose-500 to-violet-500 p-[2px]">
                  {avatar('h-full w-full bg-foreground text-[9px] text-background')}
                </span>
                <span className="text-[12px] font-semibold text-white">{handle}</span>
                <span className="text-[9px] text-white/70">{platform === 'ig_story' ? '2h' : 'Reels'}</span>
                <MoreHorizontal className="ml-auto h-3.5 w-3.5 text-white" />
              </div>
            )}
            {platform === 'yt_short' && (
              <div className="absolute inset-x-0 top-0 flex items-center justify-between bg-gradient-to-b from-black/60 to-transparent p-2">
                <span className="text-[12px] font-semibold text-white">Shorts</span>
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
                    {avatar('h-5 w-5 bg-foreground/[0.20] text-[8px] text-background')}
                    <span className="truncate text-[12px] font-semibold text-white">@{handle}</span>
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
                <span className="h-0.5 flex-1 rounded bg-surface/90" />
                <span className="h-0.5 flex-1 rounded bg-surface/30" />
              </div>
            )}
          </div>
        </div>
      )
    }

    if (platform === 'youtube') {
      // 16:9 watch-page card
      return (
        <div className="overflow-hidden rounded-card border border-border bg-surface shadow-lg shadow-foreground/10" style={{ width: card.w }}>
          <div className="relative bg-foreground/[0.06]" style={{ aspectRatio: '16 / 9' }}>
            {img}
            {card.url && (
              <span className="absolute inset-0 m-auto flex h-9 w-12 items-center justify-center rounded-inner bg-black/70">
                <Play className="h-4 w-4 fill-white text-white" />
              </span>
            )}
            <span className="absolute bottom-1.5 right-1.5 rounded bg-black/80 px-1 py-0.5 font-mono text-[8.5px] tabular-nums text-white">0:34</span>
          </div>
          <div className="flex gap-2 p-2.5">
            {avatar('h-7 w-7 bg-foreground/[0.08] text-[12px] text-muted-foreground')}
            <span className="min-w-0 flex-1">
              {editing ? captionEditor('text-[12px] font-semibold leading-snug text-foreground') : (
                <span className="block truncate text-[12px] font-semibold leading-snug text-foreground">
                  {caption || card.name || 'Video title'}
                </span>
              )}
              <span className="block text-[9px] text-muted-foreground">{name} · 1.2K views · 2 hours ago</span>
            </span>
            <MoreHorizontal className="ml-auto h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          </div>
        </div>
      )
    }

    if (platform === 'linkedin' || platform === 'facebook') {
      const fb = platform === 'facebook'
      return (
        <div className="overflow-hidden rounded-inner border border-border bg-surface shadow-lg shadow-foreground/10" style={{ width: card.w }}>
          <div className="flex items-center gap-2 p-2.5">
            {avatar(`h-8 w-8 text-secondary-13 text-cream ${fb ? 'bg-accent-blue-deep' : 'bg-accent-blue'}`)}
            <span className="min-w-0">
              <span className="block truncate text-[12px] font-semibold text-foreground">{name}</span>
              <span className="flex items-center gap-1 text-[9px] text-muted-foreground">
                {fb ? <>2h · <Globe className="h-2.5 w-2.5" /></> : '1,204 followers · 2h'}
              </span>
            </span>
            <MoreHorizontal className="ml-auto h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          </div>
          {(caption || editing) && (
            <div className="px-2.5 pb-2 text-[12px] leading-snug text-foreground">
              {editing ? captionEditor('text-[12px]') : <p className="whitespace-pre-wrap break-words">{caption}</p>}
            </div>
          )}
          <div className="relative bg-foreground/[0.06]" style={{ aspectRatio: fb ? '1 / 1' : '1.91 / 1' }}>{img}</div>
          <div className="flex items-center justify-around px-3 py-2 text-muted-foreground">
            <span className="flex items-center gap-1 text-[12px]"><ThumbsUp className="h-3 w-3" /> Like</span>
            <span className="flex items-center gap-1 text-[12px]"><MessageCircle className="h-3 w-3" /> Comment</span>
            <span className="flex items-center gap-1 text-[12px]">
              {fb ? <Forward className="h-3 w-3" /> : <Send className="h-3 w-3" />} Share
            </span>
          </div>
        </div>
      )
    }

    // ig_post / ig_carousel — square feed frame
    return (
      <div className="overflow-hidden rounded-inner border border-border bg-surface shadow-lg shadow-foreground/10" style={{ width: card.w }}>
        <div className="flex items-center gap-2 p-2">
          <span className="h-6 w-6 rounded-full bg-gradient-to-tr from-amber-400 via-rose-500 to-violet-500 p-[2px]">
            {avatar('h-full w-full bg-surface text-[9px] text-muted-foreground')}
          </span>
          <span className="text-[12px] font-semibold text-foreground">{handle}</span>
          <MoreHorizontal className="ml-auto h-3.5 w-3.5 text-muted-foreground" />
        </div>
        <div className="relative bg-foreground/[0.06]" style={{ aspectRatio: '1 / 1' }}>
          {platform === 'ig_carousel' ? (() => {
            const slides = card.urls?.length ? card.urls : card.url ? [card.url] : []
            const count = Math.max(1, slides.length)
            const idx = Math.min(slide, count - 1)
            const src = slides[idx]
            const step = (d: number) => setSlide((idx + d + count) % count)
            return (
              <>
                {src ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={src} alt={`slide ${idx + 1}`} loading="lazy" decoding="async" draggable={false}
                    className="h-full w-full select-none object-cover" />
                ) : (
                  <div className="flex h-full w-full flex-col items-center justify-center gap-1 text-muted-foreground">
                    <ImagePlus className="h-5 w-5" />
                    <span className="text-[12px]">Select, then add the images</span>
                  </div>
                )}
                {slides.length > 1 && (
                  <>
                    <button type="button" aria-label="Previous slide"
                      className="absolute left-1.5 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 text-white"
                      onPointerDown={e => e.stopPropagation()}
                      onClick={e => { e.stopPropagation(); step(-1) }}>‹</button>
                    <button type="button" aria-label="Next slide"
                      className="absolute right-1.5 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 text-white"
                      onPointerDown={e => e.stopPropagation()}
                      onClick={e => { e.stopPropagation(); step(1) }}>›</button>
                  </>
                )}
                <span className="absolute right-2 top-2 rounded-full bg-black/60 px-1.5 py-0.5 text-[9px] text-white">
                  {idx + 1}/{count}
                </span>
                <div className="absolute inset-x-0 bottom-1.5 flex justify-center gap-1">
                  {Array.from({ length: count }, (_, i) => (
                    <span key={i} className={`h-1 w-1 rounded-full ${i === idx ? 'bg-accent-blue' : 'bg-surface/60'}`} />
                  ))}
                </div>
              </>
            )
          })() : img}
        </div>
        <div className="flex items-center gap-3 px-2.5 py-2 text-muted-foreground">
          <Heart className="h-4 w-4" /><MessageCircle className="h-4 w-4" /><Send className="h-4 w-4" />
          <Bookmark className="ml-auto h-4 w-4" />
        </div>
        <div className="px-2.5 pb-2 text-[12px] leading-snug text-muted-foreground">
          {editing ? captionEditor('text-[12px] text-foreground') : (
            <p className="break-words">
              <span className="font-semibold text-foreground">{handle}</span>{' '}
              {caption || <span className="opacity-50">Double-click to write the caption…</span>}
            </p>
          )}
        </div>
      </div>
    )
  }

  if (card.kind === 'image') {
    // A dropped .mp4 is an image card whose url is a video, and it rendered as
    // an <img> — a broken picture on the board with no way to tell why. It is
    // a <video>, and it PLAYS: `preload="none"` so a board full of clips costs
    // nothing to open, `controls` only once somebody asked for it.
    const isFilm = isPlayableFile(card.url ?? '')
    return (
      <div className="overflow-hidden rounded-inner border border-border bg-surface shadow-sm" style={{ width: card.w }}>
        {isFilm ? (
          <div className="relative">
            <video
              src={card.url}
              // the whole point of playing in place: the element must get the
              // pointer, and the canvas must not read that as a drag
              controls={playing}
              autoPlay={playing}
              playsInline
              preload={playing ? 'metadata' : 'none'}
              className="w-full select-none bg-black"
              style={{ pointerEvents: playing ? 'auto' : 'none' }}
            />
            {!playing && <PlayBadge onPlay={onPlay} label={card.name ?? 'video'} />}
          </div>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={card.url} alt={card.name ?? 'reference'} loading="lazy" decoding="async"
            draggable={false} className="w-full select-none" />
        )}
        {card.name && (
          <p className="truncate px-2 py-1 text-[12px] text-muted-foreground">{card.name}</p>
        )}
      </div>
    )
  }

  // link card — click selects; opening happens via the toolbar or ctrl+click
  let host = card.url ?? ''
  try { host = new URL(card.url ?? '').hostname.replace(/^www\./, '') } catch { /* show as-is */ }
  const heading = card.title || card.name || host

  // With a picture it is a REFERENCE — the reason somebody dropped a Reel on
  // the board was to look at it, and a chip naming its hostname is the least
  // useful thing that link can be. Without one it stays the chip it was: a
  // grey box promising a picture that never comes is worse than a tidy line.
  const embed = embedUrlFor(card.url ?? '')

  // Playing IN PLACE, not in a lightbox. The reason to put a competitor's Reel
  // on a moodboard is to watch it next to the concept it is sitting beside;
  // taking over the screen to do that loses the comparison, which was the
  // whole point. One card plays at a time — the canvas owns that — so the
  // "ten players froze a tab" problem never arises.
  if (playing && embed) {
    return (
      <div
        className="overflow-hidden rounded-inner border-2 border-accent-blue/25 bg-black shadow-lg"
        style={{ width: card.w }}
      >
        <iframe
          src={embed}
          title={card.title || card.name || 'Embedded post'}
          allow="autoplay; encrypted-media; picture-in-picture; clipboard-write"
          allowFullScreen
          // Instagram's embed is a tall post, TikTok's is a 9:16 player,
          // YouTube is 16:9. Guessing one shape for all three crops two of
          // them, so the frame follows the platform.
          className={`w-full border-0 bg-black ${
            card.provider === 'YouTube' || card.provider === 'Vimeo' ? 'aspect-video'
              : card.provider === 'TikTok' ? 'aspect-[9/16]'
              : 'aspect-[4/5]'
          }`}
        />
      </div>
    )
  }

  if (card.thumb) {
    return (
      <div
        className="overflow-hidden rounded-inner border border-border bg-surface shadow-sm"
        style={{ width: card.w }}
      >
        <div className="relative bg-foreground/[0.06]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={card.thumb}
            alt={heading}
            loading="lazy"
            decoding="async"
            draggable={false}
            // vertical for a Reel or a Short, wide for anything else: a 9:16
            // clip letterboxed into 16:9 is mostly grey, and grey is what the
            // board is trying not to be
            className={`w-full object-cover ${card.media === 'video' ? 'aspect-[4/5]' : 'aspect-video'}`}
          />
          {/* a badge that plays where we can, and opens the post where we
              cannot — never one that does nothing */}
          {(card.media === 'video' || embed) && (
            embed
              ? <PlayBadge onPlay={onPlay} label={card.title ?? 'post'} />
              : <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-black/55 backdrop-blur-sm">
                    <Play className="h-4 w-4 translate-x-[1px] fill-white text-white" />
                  </span>
                </span>
          )}
          {card.provider && (
            <span className="pointer-events-none absolute left-2 top-2 rounded bg-black/60 px-1.5 py-0.5 text-[12px] font-medium uppercase tracking-wide text-white backdrop-blur-sm">
              {card.provider}
            </span>
          )}
        </div>
        <div className="p-2">
          <span className="block truncate text-[12px] font-medium text-foreground">
            {heading}
          </span>
          <span className="block truncate text-[12px] text-muted-foreground">{host}</span>
        </div>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-2 rounded-inner border border-border bg-surface p-3 shadow-sm" style={{ width: card.w }}>
      <Link2 className="h-4 w-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0">
        <span className="block truncate text-[13px] font-medium text-foreground">
          {heading}
        </span>
        <span className="block truncate text-[12px] text-muted-foreground">
          {/* Instagram and Facebook tell a server nothing — say so, and say
              what to do about it, rather than looking merely unfinished */}
          {card.provider && !card.title ? `${card.provider} · drop an image on it for a cover` : host}
        </span>
      </span>
    </div>
  )
}

export const CanvasCardView = React.memo(CanvasCardInner)
