'use client'

import React from 'react'
import {
  Bookmark, Forward, Globe, Heart, ImagePlus, MessageCircle, MoreHorizontal,
  Music2, Pin, Play, Send, ThumbsUp, Volume2, VolumeX,
} from 'lucide-react'
import { Link2 } from 'lucide-react'
import type { CanvasCard as Card } from '../../../../lib/batch-brief-core'
import { embedUrlFor, isPlayableFile } from '../../../../lib/link-preview-core'
import {
  autoplayEmbedUrlFor, autoplayKindFor, decideAutoplay, framePlayerOf, instagramEmbedUrlFor,
  soundCommand, YOUTUBE_LISTEN,
} from '../../../../lib/board-autoplay-core'
import { useAutoplaySlot, useReducedMotion } from '../../../../lib/board-autoplay-client'
import { colourOf, iconOf } from '../../../../lib/board-canvas-core'
import { COLOUR_CLASS, ICON } from '../../../boards/canvasTone'

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

/** The card's box. Width is always the person's; height only when they
 *  dragged one (`h`), otherwise the card is as tall as what is in it.
 *
 *  The box is ALWAYS a clipped flex column, not only once it owns a height:
 *  a corner drag writes the live height straight to the DOM before React
 *  has committed `h`, and a box that only learned to clip on commit let its
 *  words spill over the neighbours for the whole drag. With no height the
 *  column is as tall as its content and the clipping never bites. */
const boxStyle = (card: Card): React.CSSProperties => ({ width: card.w, ...(card.h ? { height: card.h } : {}) })
const BOX = 'flex flex-col overflow-hidden'

/* ────────────────────────── platform marks ────────────────────────── */

/** The platforms' own glyphs, inline and in `currentColor`, so a card wears
 *  the post's mark rather than its hostname. Drawn here because the icon
 *  set carries no brand marks; nothing is fetched. */
const MARK_PATH: Record<string, string> = {
  YouTube: 'M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z',
  TikTok: 'M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-1.99 6.15-1.58.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z',
  Threads: 'M12.186 24h-.007c-3.581-.024-6.334-1.205-8.184-3.509C2.35 18.44 1.5 15.586 1.472 12.01v-.017c.03-3.579.879-6.43 2.525-8.482C5.845 1.205 8.6.024 12.18 0h.014c2.746.02 5.043.725 6.826 2.098 1.677 1.29 2.858 3.13 3.509 5.467l-2.04.569c-1.104-3.96-3.898-5.984-8.304-6.015-2.91.022-5.11.936-6.54 2.717C4.307 6.504 3.616 8.914 3.589 12c.027 3.086.718 5.496 2.057 7.164 1.43 1.783 3.631 2.698 6.54 2.717 2.623-.02 4.358-.631 5.8-2.045 1.647-1.613 1.618-3.593 1.09-4.798-.31-.71-.873-1.3-1.634-1.75-.192 1.352-.622 2.446-1.284 3.272-.886 1.102-2.14 1.704-3.73 1.79-1.202.065-2.361-.218-3.259-.801-1.063-.689-1.685-1.74-1.752-2.964-.065-1.19.408-2.285 1.33-3.082.88-.76 2.119-1.207 3.583-1.291a13.853 13.853 0 0 1 3.02.142c-.126-.742-.375-1.332-.75-1.757-.513-.586-1.308-.883-2.359-.89h-.029c-.844 0-1.992.232-2.721 1.32L7.734 7.847c.98-1.454 2.568-2.256 4.478-2.256h.044c3.194.02 5.097 1.975 5.287 5.388.108.046.216.094.321.142 1.49.7 2.58 1.761 3.154 3.07.797 1.82.871 4.79-1.548 7.158-1.85 1.81-4.094 2.628-7.277 2.65Zm1.003-11.69c-.242 0-.487.007-.739.021-1.836.103-2.98.946-2.916 2.143.067 1.256 1.452 1.839 2.784 1.767 1.224-.065 2.818-.543 3.086-3.71a10.5 10.5 0 0 0-2.215-.221z',
  Facebook: 'M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z',
  LinkedIn: 'M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z',
  X: 'M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z',
  Vimeo: 'M23.977 6.416c-.105 2.338-1.739 5.543-4.894 9.609-3.268 4.247-6.026 6.37-8.29 6.37-1.409 0-2.578-1.294-3.553-3.881L5.322 11.4C4.603 8.816 3.834 7.522 3.01 7.522c-.179 0-.806.378-1.881 1.132L0 7.197a315.065 315.065 0 0 0 3.501-3.128C5.08 2.701 6.266 1.984 7.055 1.91c1.867-.18 3.016 1.1 3.447 3.838.465 2.953.789 4.789.971 5.507.539 2.45 1.131 3.674 1.776 3.674.502 0 1.256-.796 2.265-2.385 1.004-1.589 1.54-2.797 1.612-3.628.144-1.371-.395-2.061-1.614-2.061-.574 0-1.167.121-1.777.391 1.186-3.868 3.434-5.757 6.762-5.637 2.473.06 3.628 1.664 3.493 4.797l-.013.01z',
}

/** A platform's mark. Instagram is strokes (a rounded square, a lens, a
 *  dot); the rest are filled glyphs; a platform we do not draw gets a
 *  neutral mark, never a broken one. */
export function PlatformMark({ provider, className = 'h-3.5 w-3.5' }: { provider?: string; className?: string }) {
  if (provider === 'Instagram') {
    return (
      <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
        <circle cx="12" cy="12" r="4" />
        <circle cx="17.5" cy="6.5" r="0.6" fill="currentColor" />
      </svg>
    )
  }
  const d = provider ? MARK_PATH[provider] : undefined
  if (d) {
    return (
      <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
        <path d={d} />
      </svg>
    )
  }
  if (provider === 'Pinterest') return <Pin className={className} aria-hidden />
  return provider ? <Globe className={className} aria-hidden /> : <Link2 className={className} aria-hidden />
}

/* ─────────────────────────────── badges ─────────────────────────────── */

/** The play badge is its own element, not a wrapper around an img, because the
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
      <span className="flex h-11 w-11 items-center justify-center rounded-full bg-black/60 backdrop-blur-sm transition-transform hover:scale-110">
        <Play className="h-4 w-4 translate-x-[1px] fill-white text-white" />
      </span>
    </button>
  )
}

/** The badge a clip wears while it is already moving: silent and looping by
 *  itself, so the one thing left to offer is sound. It toggles the SAME
 *  player where it sits — no second frame, no resize, no leaving the
 *  board — and says which way it is about to go. Corner, not centre (the
 *  clip is the point), and a 44px target because it is tapped on phones. */
function SoundBadge({ on, onToggle, label }: { on: boolean; onToggle: () => void; label: string }) {
  return (
    <button
      type="button"
      aria-label={on ? `Mute ${label}` : `Play ${label} with sound`}
      aria-pressed={on}
      title={on ? 'Mute' : 'Play with sound'}
      onPointerDown={e => e.stopPropagation()}
      onClick={e => { e.stopPropagation(); onToggle() }}
      className="absolute bottom-0 right-0 flex h-11 min-w-11 items-center justify-end gap-1 pb-1.5 pr-1.5"
    >
      <span className={`flex h-8 items-center gap-1.5 rounded-full px-2.5 text-[12px] font-medium text-white backdrop-blur-sm transition-transform hover:scale-105 ${on ? 'bg-accent-blue' : 'bg-black/60'}`}>
        {on ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
        {on ? 'Sound on' : 'Sound'}
      </span>
    </button>
  )
}

/* ─────────────────────────────── caption ────────────────────────────── */

/** What the team says about the media: a text box under it on every
 *  picture, clip and link. Saved when the person clicks away; multi-line;
 *  never starts a drag. A viewer gets the words, not the box. */
function CaptionField({ value, onSave }: { value: string; onSave?: (v: string) => void }) {
  if (!onSave) {
    return value
      ? <p className="whitespace-pre-wrap break-words text-[12px] leading-snug text-foreground">{value}</p>
      : null
  }
  return (
    <textarea
      key={value}
      defaultValue={value}
      rows={Math.min(5, Math.max(1, value.split('\n').length))}
      placeholder="Write a caption…"
      aria-label="Caption"
      className="block w-full resize-none bg-transparent text-[12px] leading-snug text-foreground outline-none placeholder:text-muted-foreground"
      onPointerDown={e => e.stopPropagation()}
      onInput={e => {
        // grow with the words, up to the strip's own ceiling
        const t = e.currentTarget
        t.style.height = 'auto'
        t.style.height = `${Math.min(t.scrollHeight, 128)}px`
      }}
      onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); (e.target as HTMLTextAreaElement).blur() } }}
      onBlur={e => {
        const v = e.target.value.trim().slice(0, 1000)
        if (v !== value) onSave(v)
      }}
    />
  )
}

/* ─────────────────────────────── the card ───────────────────────────── */

function CanvasCardInner({
  card, selected, editing, clientName, onCommitText, onUpdate, playing, onPlay, sound, onSound, insideLabel, onOpen,
}: {
  card: Card
  selected: boolean
  editing: boolean
  clientName?: string
  /** this is the one card allowed to be a live player right now */
  playing?: boolean
  /** ask the canvas to make it that card */
  onPlay?: () => void
  /** this is the one clip playing with sound right now */
  sound?: boolean
  /** ask the canvas for the sound (true) or give it back (false) */
  onSound?: (on: boolean) => void
  onCommitText: (text: string) => void
  /** whole-card change (todo rows etc.) — absent means read-only */
  onUpdate?: (next: Card) => void
  /** board tile — what it holds, already worded ("3 cards · 1 board") */
  insideLabel?: string
  /** board tile — open it. Works for a viewer too: looking is not editing */
  onOpen?: () => void
}) {
  // carousel mockups page through their slides — per-card, view-only state
  const [slide, setSlide] = React.useState(0)

  // The post this card shows. A link card IS its post; a mock-up made from
  // a pasted link carries the post beside its own frame (`link_url` +
  // `preview`); anything else has none.
  const post = card.kind === 'link'
    ? card
    : card.kind === 'mockup' && card.link_url
      ? { kind: 'link' as const, url: card.link_url, ...card.preview }
      : null

  // A reference clip plays by itself: silent, looping, only while it is on
  // screen, and only a few at a time. All the deciding is in
  // board-autoplay-core; this is one seat at that table. A card that can
  // never play (a page link, or a clip for a viewer who asked for less
  // motion) is not observed at all. An Instagram card is only watched: its
  // frame goes up when the card is within range and comes down when it is
  // not, and the one tap it needs is Instagram's own play button.
  const frameRef = React.useRef<HTMLDivElement>(null)
  const videoRef = React.useRef<HTMLVideoElement>(null)
  const iframeRef = React.useRef<HTMLIFrameElement>(null)
  const reducedMotion = useReducedMotion()
  const autoKind = autoplayKindFor(post ?? card)
  const { near, inRange, chosen } = useAutoplaySlot(card.id, frameRef,
    autoKind === 'instagram' ? 'watch' : autoKind !== 'none' && !reducedMotion ? 'play' : 'off')
  const auto = decideAutoplay({ kind: autoKind, reducedMotion, near, inRange, chosen, userPlaying: playing })
  // the Instagram frame reports in when it has painted; until then the
  // thumbnail is the face, so the board never shows a blank square
  const [frameReady, setFrameReady] = React.useState(false)
  React.useEffect(() => { if (!auto.load) setFrameReady(false) }, [auto.load])
  React.useEffect(() => {
    const v = videoRef.current
    if (!v || playing) return
    if (auto.play) v.play().catch(() => { /* the browser said no; the badge is still there */ })
    else v.pause()
  }, [auto.play, playing])

  // Sound, in place. A <video> is told directly; a frame is told over
  // postMessage in its provider's own words (board-autoplay-core) — the
  // same element either way, so nothing reloads, resizes or navigates.
  const soundOn = Boolean(sound) && auto.play
  React.useEffect(() => {
    const v = videoRef.current
    if (!v || playing) return
    v.muted = !soundOn
    if (soundOn) v.play().catch(() => { /* still muted, still moving */ })
  }, [soundOn, playing])
  React.useEffect(() => {
    const f = iframeRef.current
    const player = framePlayerOf(f?.getAttribute('src'))
    if (!f?.contentWindow || !player || !frameReady) return
    const { message, targetOrigin } = soundCommand(player, soundOn)
    f.contentWindow.postMessage(message, targetOrigin)
  }, [soundOn, frameReady])
  // a clip that stops moving (scrolled away, unchosen) gives the sound back
  React.useEffect(() => { if (sound && !auto.play) onSound?.(false) }, [sound, auto.play, onSound])
  const toggleSound = () => onSound?.(!soundOn)

  // where the player's origin is stated to YouTube, so it will listen to us
  const origin = typeof window !== 'undefined' ? window.location.origin : undefined

  // The frame that plays by itself (YouTube, TikTok, Vimeo — silent, looping,
  // nothing to click) or Instagram's own embed, which waits for one tap. Its
  // src exists only while `auto.load` says so: an off-screen card is a
  // thumbnail again and costs nothing.
  const autoSrc = auto.load && post
    ? autoKind === 'instagram' ? instagramEmbedUrlFor(post.url ?? '') : autoplayEmbedUrlFor(post.url ?? '', post.canonical, origin)
    : null
  const autoFrame = autoSrc && (
    <iframe
      ref={iframeRef}
      src={autoSrc}
      title={post?.title || card.name || 'Reference clip'}
      allow="autoplay; encrypted-media; picture-in-picture"
      tabIndex={-1}
      onLoad={e => {
        setFrameReady(true)
        // YouTube starts talking (and taking commands) once told to listen
        if (framePlayerOf(autoSrc) === 'youtube') {
          e.currentTarget.contentWindow?.postMessage(YOUTUBE_LISTEN, 'https://www.youtube-nocookie.com')
        }
      }}
      // a clip that runs by itself is a picture that moves: the
      // pointer goes through it to the card, so it still drags and
      // selects. Instagram's frame must take the tap — the play
      // button is theirs — so only that one is interactive.
      className={`absolute inset-0 h-full w-full border-0 bg-black transition-opacity duration-300 ${
        frameReady ? 'opacity-100' : 'opacity-0'
      } ${autoKind === 'instagram' ? '' : 'pointer-events-none'}`}
    />
  )

  if (card.kind === 'board') {
    // the same tile as the boards page draws (CanvasItemView's board branch):
    // a tinted square, the icon, the name, the count — and an Open button
    // that is 44px and stops the pointer so it never starts a drag
    const Icon = ICON[iconOf(card.icon)]
    return (
      <div
        data-kind="board"
        className={`group flex select-none flex-col items-center justify-center gap-2 overflow-hidden rounded-inner p-3 text-center shadow-[0_1px_2px_rgba(0,0,0,0.06)] ${COLOUR_CLASS[colourOf('board', card.colour)]}`}
        style={boxStyle(card)}
      >
        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-card bg-surface/70 dark:bg-foreground/10">
          <Icon className="h-7 w-7" />
        </div>
        <p className="line-clamp-2 max-w-full break-words text-[15px] font-semibold leading-tight">{card.name || 'Board'}</p>
        <p className="truncate max-w-full text-[12px] text-muted-foreground">{insideLabel ?? 'Empty'}</p>
        <button
          type="button"
          aria-label={`Open ${card.name || 'Board'}`}
          onPointerDown={e => e.stopPropagation()}
          onClick={e => { e.stopPropagation(); onOpen?.() }}
          className="mt-1 inline-flex h-11 shrink-0 items-center rounded-full bg-foreground px-4 text-[13px] font-semibold text-background opacity-0 transition-opacity hover:bg-foreground/90 focus:opacity-100 group-hover:opacity-100 [@media(pointer:coarse)]:opacity-100"
        >
          Open
        </button>
      </div>
    )
  }
  if (card.kind === 'todo') {
    const items = card.items ?? []
    const done = items.filter(t => t.done).length
    return (
      <div className={`w-full rounded-inner border border-border bg-surface p-3 shadow-sm ${BOX}`} style={boxStyle(card)}>
        <div className="mb-1.5 flex shrink-0 items-baseline justify-between gap-2">
          <span className="min-w-0 truncate text-[12px] font-semibold text-foreground">{card.name || 'To-do'}</span>
          {items.length > 0 && (
            <span className="shrink-0 font-mono text-[12px] tabular-nums text-muted-foreground">{done}/{items.length}</span>
          )}
        </div>
        <div data-scroll className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto">
          {items.length === 0 && (
            <span className="text-[12px] text-muted-foreground">Nothing to do yet.</span>
          )}
          {items.map(t => (
            <label key={t.id} className="group/row flex items-start gap-1.5"
              onPointerDown={e => e.stopPropagation()}>
              <input type="checkbox" checked={t.done} disabled={!onUpdate}
                className="mt-[3px] h-3.5 w-3.5 shrink-0 accent-[var(--dbx-blue)]"
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
                <span className={`min-w-0 break-words text-[12px] ${t.done ? 'text-muted-foreground line-through' : 'text-foreground'}`}>{t.text}</span>
              )}
            </label>
          ))}
        </div>
        {onUpdate && items.length < 30 && (
          <button type="button"
            className="mt-1.5 shrink-0 self-start text-[12px] text-muted-foreground hover:text-foreground"
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
    // a heading wraps at its own width but never inside a word: the
    // narrowest it goes is its widest word, so no two words ever land on
    // top of each other
    return (
      <span
        className="block select-none whitespace-normal break-normal font-mono text-body-15 uppercase leading-snug tracking-widest text-muted-foreground"
        style={{ maxWidth: Math.max(card.w, 120), minWidth: 'min-content' }}
      >
        {card.text || 'Double-click to name this section'}
      </span>
    )
  }

  if (card.kind === 'note') {
    const palette = NOTE_COLORS[card.color ?? 'paper'] ?? NOTE_COLORS.paper
    // 'ink' is dark in both themes — its text must not follow the theme
    const inkText = card.color === 'ink' ? 'text-background' : 'text-foreground'
    return (
      <div className={`rounded-inner border p-3 shadow-sm ${palette} ${BOX}`} style={boxStyle(card)}>
        {editing ? (
          <textarea
            autoFocus
            defaultValue={card.text ?? ''}
            rows={Math.max(3, (card.text ?? '').split('\n').length)}
            className={`min-h-0 w-full flex-1 resize-none bg-transparent text-[13px] leading-relaxed outline-none placeholder:text-muted-foreground ${inkText}`}
            placeholder="Write it down…"
            onBlur={e => onCommitText(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Escape') { e.stopPropagation(); (e.target as HTMLTextAreaElement).blur() }
            }}
            onPointerDown={e => e.stopPropagation()}
          />
        ) : (
          // the words wrap and, in a box shorter than they are, scroll —
          // they never draw past the card's border
          <p data-scroll className={`min-h-0 flex-1 overflow-y-auto whitespace-pre-wrap break-words text-[13px] leading-relaxed ${inkText}`}>
            {card.text || <span className="text-muted-foreground">Write it down…</span>}
          </p>
        )}
      </div>
    )
  }

  if (card.kind === 'mockup') {
    const platform = card.platform ?? 'ig_post'
    const name = (clientName ?? '').trim() || 'Your client'
    // a mock-up made from a real post wears the real account
    const author = post?.author?.trim()
    const handle = author ? author.replace(/^@/, '') : name.toLowerCase().replace(/[^a-z0-9._]/g, '') || 'yourclient'
    const shown = author || name
    const initial = shown.replace(/^@/, '').charAt(0).toUpperCase()
    const avatar = (cls: string) => (
      <span className={`flex shrink-0 items-center justify-center rounded-full font-semibold ${cls}`}>{initial}</span>
    )
    // the post's own media in the frame: its picture; the clip playing by
    // itself where the platform allows (TikTok, YouTube, Vimeo, our files);
    // Instagram's picture, and Instagram's own frame behind one tap
    const igFrame = playing && autoKind === 'instagram' && post ? instagramEmbedUrlFor(post.url ?? '') : null
    const isFilm = Boolean(post?.url && isPlayableFile(post.url))
    const img = post ? (
      <div ref={frameRef} className="absolute inset-0 bg-black">
        {post.thumb && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={post.thumb} alt={post.title ?? 'post'} loading="lazy" decoding="async" draggable={false}
            className="absolute inset-0 h-full w-full select-none object-cover" />
        )}
        {isFilm && (
          <video ref={videoRef} src={auto.load ? post.url : undefined} muted loop playsInline
            preload={auto.load ? 'metadata' : 'none'}
            className="absolute inset-0 h-full w-full select-none object-cover" style={{ pointerEvents: 'none' }} />
        )}
        {/* Instagram's frame comes only behind the tap — inside a mock-up
            the picture is the face, and their frame (with its own header,
            and its own "Watch on Instagram" overlay) is what the tap opens */}
        {igFrame ? (
          <iframe src={igFrame} title={post.title || 'Instagram post'} allow="autoplay; encrypted-media"
            className="absolute inset-0 h-full w-full border-0 bg-black" />
        ) : autoKind === 'instagram' ? null : autoFrame}
        {!post.thumb && !isFilm && !autoSrc && !igFrame && (
          <div className="absolute inset-0 flex items-center justify-center text-white/60">
            <PlatformMark provider={post.provider} className="h-8 w-8" />
          </div>
        )}
        {auto.play && <SoundBadge on={soundOn} onToggle={toggleSound} label={post.title ?? 'post'} />}
        {autoKind === 'instagram' && !playing && (post.media === 'video' || !post.thumb) && (
          <PlayBadge onPlay={onPlay} label={post.title ?? 'post'} />
        )}
      </div>
    ) : card.url ? (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={card.url} alt="mockup" loading="lazy" decoding="async" draggable={false}
        className="h-full w-full select-none object-cover" />
    ) : (
      <div className="flex h-full w-full flex-col items-center justify-center gap-1 text-muted-foreground">
        <ImagePlus className="h-5 w-5" />
        <span className="text-[12px]">Select, then add the image or paste a link</span>
      </div>
    )
    const caption = (card.text ?? '').trim()
    const captionEditor = (cls: string) => (
      <textarea autoFocus defaultValue={card.text ?? ''} rows={2} placeholder="Write a caption…"
        className={`w-full resize-none bg-transparent outline-none placeholder:opacity-50 ${cls}`}
        onBlur={e => onCommitText(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Escape' || (e.key === 'Enter' && !e.shiftKey)) { e.stopPropagation(); (e.target as HTMLTextAreaElement).blur() }
        }}
        onPointerDown={e => e.stopPropagation()} />
    )
    const mark = post?.provider ? <PlatformMark provider={post.provider} className="h-3.5 w-3.5 shrink-0" /> : null

    if (platform === 'ig_story' || platform === 'ig_reel' || platform === 'yt_short' || platform === 'tiktok') {
      // 9:16 phone frame
      const ig = platform === 'ig_story' || platform === 'ig_reel'
      return (
        <div className="overflow-hidden rounded-card border border-border bg-black shadow-lg shadow-foreground/10" style={{ width: card.w }}>
          <div className="relative" style={{ aspectRatio: '9 / 16' }}>
            <div className="absolute inset-0 bg-foreground">{img}</div>
            {ig && (
              <div className="absolute inset-x-0 top-0 flex items-center gap-2 bg-gradient-to-b from-black/60 to-transparent p-2 text-white">
                <span className="h-6 w-6 rounded-full bg-gradient-to-tr from-amber-400 via-rose-500 to-violet-500 p-[2px]">
                  {avatar('h-full w-full bg-foreground text-[9px] text-background')}
                </span>
                <span className="truncate text-[12px] font-semibold text-white">{handle}</span>
                <span className="shrink-0 text-[9px] text-white/70">{platform === 'ig_story' ? '2h' : 'Reels'}</span>
                <span className="ml-auto flex shrink-0 items-center gap-1.5">{mark}<MoreHorizontal className="h-3.5 w-3.5" /></span>
              </div>
            )}
            {platform === 'yt_short' && (
              <div className="absolute inset-x-0 top-0 flex items-center justify-between bg-gradient-to-b from-black/60 to-transparent p-2 text-white">
                <span className="flex items-center gap-1.5 text-[12px] font-semibold">{mark}Shorts</span>
                <MoreHorizontal className="h-3.5 w-3.5" />
              </div>
            )}
            {platform === 'tiktok' && post && (
              <div className="absolute inset-x-0 top-0 flex items-center gap-1.5 bg-gradient-to-b from-black/60 to-transparent p-2 text-white">
                {mark}<span className="truncate text-[12px] font-semibold">{author ?? name}</span>
              </div>
            )}
            {(platform === 'ig_reel' || platform === 'yt_short' || platform === 'tiktok') && (
              <div className="pointer-events-none absolute bottom-8 right-2 flex flex-col items-center gap-2.5 text-white drop-shadow">
                {platform === 'yt_short'
                  ? <><ThumbsUp className="h-4 w-4" /><MessageCircle className="h-4 w-4" /><Forward className="h-4 w-4" /></>
                  : <><Heart className="h-4 w-4" /><MessageCircle className="h-4 w-4" /><Send className="h-4 w-4" /></>}
              </div>
            )}
            {(platform === 'yt_short' || platform === 'tiktok' || ((caption || editing) && platform === 'ig_reel')) && (
              <div className={`absolute inset-x-0 bottom-0 flex flex-col gap-1 bg-gradient-to-t from-black/70 to-transparent p-2 pr-8 ${editing ? '' : 'pointer-events-none'}`}>
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
                    <Music2 className="h-2.5 w-2.5 shrink-0" /> Original sound · {shown}
                  </span>
                )}
              </div>
            )}
            {platform === 'ig_story' && (
              <div className="pointer-events-none absolute inset-x-0 top-1 flex gap-1 px-2">
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
            {card.url && !post && (
              <span className="absolute inset-0 m-auto flex h-9 w-12 items-center justify-center rounded-inner bg-black/70">
                <Play className="h-4 w-4 fill-white text-white" />
              </span>
            )}
            {!post && <span className="absolute bottom-1.5 right-1.5 rounded bg-black/80 px-1 py-0.5 font-mono text-[8.5px] tabular-nums text-white">0:34</span>}
          </div>
          <div className="flex gap-2 p-2.5">
            {avatar('h-7 w-7 bg-foreground/[0.08] text-[12px] text-muted-foreground')}
            <span className="min-w-0 flex-1">
              {editing ? captionEditor('text-[12px] font-semibold leading-snug text-foreground') : (
                <span className="block truncate text-[12px] font-semibold leading-snug text-foreground">
                  {caption || card.name || 'Video title'}
                </span>
              )}
              <span className="flex items-center gap-1 text-[9px] text-muted-foreground">{mark}<span className="truncate">{shown} · 1.2K views · 2 hours ago</span></span>
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
              <span className="block truncate text-[12px] font-semibold text-foreground">{shown}</span>
              <span className="flex items-center gap-1 text-[9px] text-muted-foreground">
                {fb ? <>2h · <Globe className="h-2.5 w-2.5" /></> : '1,204 followers · 2h'}
              </span>
            </span>
            <span className="ml-auto flex shrink-0 items-center gap-1.5 text-muted-foreground">{mark}<MoreHorizontal className="h-3.5 w-3.5" /></span>
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
          <span className="h-6 w-6 shrink-0 rounded-full bg-gradient-to-tr from-amber-400 via-rose-500 to-violet-500 p-[2px]">
            {avatar('h-full w-full bg-surface text-[9px] text-muted-foreground')}
          </span>
          <span className="truncate text-[12px] font-semibold text-foreground">{handle}</span>
          <span className="ml-auto flex shrink-0 items-center gap-1.5 text-muted-foreground">{mark}<MoreHorizontal className="h-3.5 w-3.5" /></span>
        </div>
        <div className="relative bg-foreground/[0.06]" style={{ aspectRatio: '1 / 1' }}>
          {platform === 'ig_carousel' && !post ? (() => {
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
              {caption || <span className="opacity-50">Double-click to write a caption…</span>}
            </p>
          )}
        </div>
      </div>
    )
  }

  // the team's caption under a picture, a clip or a link — saved through
  // the same upsert as everything else on the card
  const saveCaption = onUpdate
    ? (v: string) => {
        const { caption: _old, ...rest } = card
        void _old
        onUpdate(v ? { ...rest, caption: v } : rest)
      }
    : undefined
  const captionStrip = (saveCaption || card.caption) && (
    <div data-scroll className="max-h-32 shrink-0 overflow-y-auto border-t border-border/60 px-2 py-1.5">
      <CaptionField value={card.caption ?? ''} onSave={saveCaption} />
    </div>
  )

  if (card.kind === 'image') {
    // A dropped .mp4 is an image card whose url is a video, and it rendered as
    // an <img> — a broken picture on the board with no way to tell why. It is
    // a <video>, and it PLAYS: `preload="none"` so a board full of clips costs
    // nothing to open, `controls` only once somebody asked for it.
    //
    // And it plays by itself, silently, while it is on screen (`auto`): the
    // src is only attached once the card has come near the viewport, so a
    // board full of clips still opens for free.
    const isFilm = isPlayableFile(card.url ?? '')
    return (
      <div className={`overflow-hidden rounded-inner border border-border bg-surface shadow-sm ${BOX}`} style={boxStyle(card)}>
        {isFilm ? (
          <div className="relative min-h-0 flex-1 shrink" ref={frameRef}>
            <video
              ref={videoRef}
              src={playing || auto.load ? card.url : undefined}
              // the whole point of playing in place: the element must get the
              // pointer, and the canvas must not read that as a drag
              controls={playing}
              autoPlay={playing}
              muted={!playing && !soundOn}
              loop={!playing}
              playsInline
              preload={playing || auto.load ? 'metadata' : 'none'}
              // in a box of the person's own height the clip fills it and
              // is cropped, never squashed — the face stays sharp
              className={`w-full select-none bg-black ${card.h ? 'h-full object-cover' : ''}`}
              style={{ pointerEvents: playing ? 'auto' : 'none' }}
            />
            {!playing && (auto.play
              ? <SoundBadge on={soundOn} onToggle={toggleSound} label={card.name ?? 'video'} />
              : <PlayBadge onPlay={onPlay} label={card.name ?? 'video'} />)}
          </div>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={card.url} alt={card.name ?? 'reference'} loading="lazy" decoding="async"
            draggable={false} className={`w-full min-h-0 shrink select-none ${card.h ? 'flex-1 object-cover' : ''}`} />
        )}
        {card.name && (
          <p className="shrink-0 truncate px-2 py-1 text-[12px] text-muted-foreground">{card.name}</p>
        )}
        {captionStrip}
      </div>
    )
  }

  // link card — click selects; opening happens via the toolbar or ctrl+click
  let host = card.url ?? ''
  try { host = new URL(card.url ?? '').hostname.replace(/^www\./, '') } catch { /* show as-is */ }
  // the post's own words, in one line; the platform's name where it has
  // one, the hostname only when it does not
  const postTitle = card.title || card.name || ''
  const platformName = card.provider || host
  const heading = postTitle || platformName

  // With a picture it is a REFERENCE — the reason somebody dropped a Reel on
  // the board was to look at it, and a chip naming its hostname is the least
  // useful thing that link can be. Without one it stays the chip it was: a
  // grey box promising a picture that never comes is worse than a tidy line.
  // …and never a frame for a post the provider said cannot be framed: an
  // Instagram embed that answers "this post may have been removed" is not a
  // face, it is an error message wearing our card. Such a card is a still.
  const embed = card.embeddable === false ? null : embedUrlFor(card.url ?? '', card.canonical)

  /** The strip under the media: the platform's mark and name, the account
   *  when known, the post's own words in one clipped line, and the team's
   *  caption. Never the hostname when the platform has a name. */
  const strip = (
    <div className="shrink-0 border-t border-border/60">
      <div className="min-w-0 px-2 pt-1.5">
        <span className="flex min-w-0 items-center gap-1.5 text-[12px] font-medium text-foreground">
          <PlatformMark provider={card.provider} className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{platformName}</span>
          {card.author && <span className="truncate text-muted-foreground">· {card.author}</span>}
        </span>
        {postTitle && <span className="block truncate text-[12px] text-muted-foreground">{postTitle}</span>}
      </div>
      {(saveCaption || card.caption) && (
        <div data-scroll className="max-h-32 overflow-y-auto px-2 pb-1.5 pt-1">
          <CaptionField value={card.caption ?? ''} onSave={saveCaption} />
        </div>
      )}
      {!(saveCaption || card.caption) && <div className="h-1.5" />}
    </div>
  )

  // Playing IN PLACE, not in a lightbox. The reason to put a competitor's Reel
  // on a moodboard is to watch it next to the concept it is sitting beside;
  // taking over the screen to do that loses the comparison, which was the
  // whole point. One card plays at a time — the canvas owns that — so the
  // "ten players froze a tab" problem never arises.
  if (playing && embed) {
    return (
      <div
        className={`overflow-hidden rounded-inner border-2 border-accent-blue/25 bg-surface shadow-lg ${BOX}`}
        style={boxStyle(card)}
      >
        <iframe
          src={embed}
          title={card.title || card.name || 'Embedded post'}
          allow="autoplay; encrypted-media; picture-in-picture; clipboard-write"
          allowFullScreen
          // Instagram's embed is a tall post, TikTok's is a 9:16 player,
          // YouTube is 16:9. Guessing one shape for all three crops two of
          // them, so the frame follows the platform.
          className={`w-full min-h-0 shrink border-0 bg-black ${
            card.h ? 'flex-1'
              : card.provider === 'YouTube' || card.provider === 'Vimeo' ? 'aspect-video'
              : card.provider === 'TikTok' ? 'aspect-[9/16]'
              : 'aspect-[4/5]'
          }`}
        />
        {strip}
      </div>
    )
  }

  // The face keeps one shape whether it is a still or a frame, so starting
  // to play never resizes the card under the pointer. Vertical for a Reel,
  // a Short or a TikTok; wide for the rest of YouTube and Vimeo; Instagram's
  // embed carries its header and action row, so it is taller than its media.
  const faceAspect = autoKind === 'instagram' ? 'aspect-[5/9]'
    : autoKind === 'embed'
      ? (card.provider === 'TikTok' || /\/shorts\//.test(card.url ?? '') ? 'aspect-[9/16]' : 'aspect-video')
      : card.media === 'video' ? 'aspect-[4/5]' : 'aspect-video'

  if (card.thumb || autoKind === 'embed' || autoKind === 'instagram') {
    return (
      <div
        className={`overflow-hidden rounded-inner border border-border bg-surface shadow-sm ${BOX}`}
        style={boxStyle(card)}
      >
        {/* with a height of its own the face takes what the strip leaves;
            without one it keeps the platform's shape — and it is the part
            that gives way when the card is made shorter, never the words */}
        <div className={`relative min-h-0 shrink bg-foreground/[0.06] ${card.h ? 'flex-1' : faceAspect}`} ref={frameRef}>
          {card.thumb && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={card.thumb}
              alt={heading}
              loading="lazy"
              decoding="async"
              draggable={false}
              className="absolute inset-0 h-full w-full object-cover"
            />
          )}
          {autoFrame}
          {/* a badge that plays where we can, and opens the post where we
              cannot — never one that does nothing. A clip already moving
              offers sound instead. An Instagram card never wears our badge:
              its frame is the face and the play button on it is theirs. */}
          {auto.play
            ? <SoundBadge on={soundOn} onToggle={toggleSound} label={card.title ?? 'post'} />
            : autoKind === 'instagram'
              ? null
              : (card.media === 'video' || embed) && (
                  embed
                    ? <PlayBadge onPlay={onPlay} label={card.title ?? 'post'} />
                    : <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
                        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-black/55 backdrop-blur-sm">
                          <Play className="h-4 w-4 translate-x-[1px] fill-white text-white" />
                        </span>
                      </span>
                )}
        </div>
        {strip}
      </div>
    )
  }

  return (
    <div className={`overflow-hidden rounded-inner border border-border bg-surface shadow-sm ${BOX}`} style={boxStyle(card)}>
      <div className="flex items-center gap-2 p-3">
        <PlatformMark provider={card.provider} className="h-4 w-4 shrink-0 text-muted-foreground" />
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
      {(saveCaption || card.caption) && (
        <div data-scroll className="max-h-32 shrink-0 overflow-y-auto border-t border-border/60 px-3 py-1.5">
          <CaptionField value={card.caption ?? ''} onSave={saveCaption} />
        </div>
      )}
    </div>
  )
}

export const CanvasCardView = React.memo(CanvasCardInner)
