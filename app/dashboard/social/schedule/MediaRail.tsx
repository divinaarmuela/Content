'use client'

import { useEffect, useMemo, useState } from 'react'
import { Plus, Star } from 'lucide-react'
import { cn } from '@/lib/utils'
import { mayApproveWithoutClient, NOT_CLIENT_APPROVED } from '@/app/lib/social-schedule-core'
import { Thumb } from './tiles'
import type { RailMedia } from './useSchedulePosts'

/**
 * The media rail: the client's approved photos and videos, ready to become a
 * post.
 *
 * "Media" everywhere, never "graphics" — a Reel is not a graphic, and the
 * people using this page call the whole lot media. A piece that CANNOT start
 * a post is still shown, greyed, with the reason on it: hiding it only makes
 * someone ask where their video went.
 *
 * Tapping a card starts a post from it; dragging one onto the calendar does
 * the same with the hour it was dropped on. A card that CANNOT start a post
 * is not clickable and says why, rather than opening a window that would
 * immediately refuse.
 */

export const RAIL_FILTERS = ['Unused', 'Videos', 'Photos', 'Starred'] as const
export type RailFilter = (typeof RAIL_FILTERS)[number]

const STAR_KEY = 'md-schedule-starred'

/** What a rail card carries when it is dragged onto the calendar. */
export const RAIL_DRAG_TYPE = 'application/x-md-item'

/** Stars are a personal marker — one person's shortlist for the week, kept in
 *  their own browser. Nothing about a star reaches anybody else, so it is not
 *  a row in the database and never travels with the item. */
function useStars(): [Set<string>, (id: string) => void] {
  // read AFTER mounting: this component is rendered on the server too, where
  // there is no localStorage, and seeding state from it would also make the
  // first client render disagree with the server's
  const [ids, setIds] = useState<Set<string>>(() => new Set<string>())
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STAR_KEY)
      if (raw) setIds(new Set<string>(JSON.parse(raw) as string[]))
    } catch { /* private mode — stars are a convenience, not data */ }
  }, [])
  const toggle = (id: string) => {
    setIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      try { window.localStorage.setItem(STAR_KEY, JSON.stringify([...next])) } catch { /* private mode */ }
      return next
    })
  }
  return [ids, toggle]
}

export function filterMedia(
  media: RailMedia[], filters: Set<RailFilter>, starred: Set<string>,
): RailMedia[] {
  return media.filter(m => {
    if (filters.has('Unused') && m.used) return false
    if (filters.has('Starred') && !starred.has(m.itemId)) return false
    const kind = m.cover?.type ?? null
    if (filters.has('Videos') && filters.has('Photos')) return kind !== null
    if (filters.has('Videos') && kind !== 'video') return false
    if (filters.has('Photos') && kind !== 'image') return false
    return true
  })
}

export default function MediaRail({
  media, waiting, loading, role, postWithoutApproval, onNew, onPick, onApprove,
}: {
  media: RailMedia[]
  waiting: number
  loading: boolean
  /** the viewer's role — an account manager or a super admin may sign a piece
   *  off without the client from here */
  role: string | null
  /** …and for those two the rail also carries media the client has not signed
   *  off yet, which is why the heading cannot say "Approved" to them */
  postWithoutApproval: boolean
  /** start a post with nothing chosen yet */
  onNew: () => void
  /** start a post from this piece */
  onPick: (media: RailMedia) => void
  /** sign this piece off without waiting for the client */
  onApprove: (media: RailMedia) => void
}) {
  // "Unused" starts on, as the design has it: the rail is for finding the
  // next thing to post, and media already in a post is not that
  const [filters, setFilters] = useState<Set<RailFilter>>(() => new Set<RailFilter>(['Unused']))
  const [starred, toggleStar] = useStars()
  const shown = useMemo(() => filterMedia(media, filters, starred), [media, filters, starred])

  const flip = (f: RailFilter) => setFilters(prev => {
    const next = new Set(prev)
    if (next.has(f)) next.delete(f); else next.add(f)
    return next
  })

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      {/* the rail's one action */}
      <button
        type="button"
        onClick={onNew}
        className="flex min-h-11 w-full items-center justify-center gap-2 rounded-full bg-foreground text-[14px] font-semibold text-background transition-opacity hover:opacity-90"
      >
        <Plus className="h-4 w-4" strokeWidth={2.2} aria-hidden />
        New post
      </button>

      <div className="flex flex-wrap gap-1.5">
        {RAIL_FILTERS.map(f => {
          const on = filters.has(f)
          return (
            <button
              key={f}
              type="button"
              aria-pressed={on}
              onClick={() => flip(f)}
              className={cn(
                'rounded-full px-2.5 py-1.5 text-chip-12 transition-colors [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:px-4',
                on
                  ? 'bg-foreground text-background'
                  : 'border border-border bg-paper text-foreground hover:bg-muted',
              )}
            >
              {f}
            </button>
          )
        })}
      </div>

      {/* the client's name is on the picker two inches away; repeating it here
          only truncated it */}
      <div className="flex items-center justify-between gap-2 px-0.5">
        <span className="text-[13px] font-semibold">
          {postWithoutApproval ? 'Media' : 'Approved media'}
        </span>
        <span className="shrink-0 text-[12px] font-semibold text-muted-foreground">{shown.length}</span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading ? (
          <div className="grid grid-cols-2 gap-2">
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="h-[84px] animate-pulse rounded-tile bg-foreground/[0.06]" />
            ))}
          </div>
        ) : shown.length === 0 ? (
          <p className="px-1 text-[13px] text-muted-foreground">
            {media.length === 0
              // NOT "nothing here yet", full stop. An empty rail used to be
              // the end of the road on a workspace with no pieces in it —
              // which is exactly when somebody most needs to post something.
              // The way in is one button above this line, and it says so.
              ? 'Nothing here yet. Press New post to upload a photo or video.'
              : 'Nothing matches those filters.'}
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {shown.map(m => (
              <div
                key={m.itemId}
                title={m.ok
                  ? (m.needsClientApproval ? `${m.title} — ${NOT_CLIENT_APPROVED}` : m.title)
                  : `${m.title} — ${m.reason}`}
                draggable={m.ok}
                onDragStart={e => {
                  e.dataTransfer.effectAllowed = 'copy'
                  e.dataTransfer.setData(RAIL_DRAG_TYPE, m.itemId)
                  e.dataTransfer.setData('text/plain', m.title)
                }}
                className={cn(
                  'group relative h-[84px] overflow-hidden rounded-tile border border-border bg-foreground/[0.06]',
                  // the DIM goes on the picture, never on the card: `opacity`
                  // makes a stacking context, so a button inside a 45% parent
                  // cannot be drawn at full strength by any class of its own —
                  // which is how the one new affordance on this page ended up
                  // at 45%, cream on a dimmed thumbnail
                  !m.ok && 'border-dashed',
                )}
              >
                <button
                  type="button"
                  disabled={!m.ok}
                  onClick={() => onPick(m)}
                  aria-label={m.ok ? `Start a post from ${m.title}` : `${m.title} — ${m.reason}`}
                  className="absolute inset-0 z-0 disabled:cursor-not-allowed"
                />
                <Thumb
                  slide={m.cover}
                  label={m.title}
                  className={cn('pointer-events-none h-full w-full', !m.ok && 'opacity-45')}
                />
                {m.ok && !m.needsClientApproval && (
                  <span className="pointer-events-none absolute left-1.5 top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-accent-green text-[9px] font-bold text-ink">
                    ✓<span className="sr-only">Approved</span>
                  </span>
                )}
                <button
                  type="button"
                  aria-pressed={starred.has(m.itemId)}
                  aria-label={starred.has(m.itemId) ? `Unstar ${m.title}` : `Star ${m.title}`}
                  onClick={() => toggleStar(m.itemId)}
                  className={cn(
                    // a phone has no hover: the rail is a bottom sheet there,
                    // so the star is always visible (and 44px) on a touch
                    // screen and appears on hover on a desktop
                    'absolute right-1 top-1 z-10 flex h-6 w-6 items-center justify-center rounded-full bg-ink/55 text-cream transition-opacity focus-visible:opacity-100 group-hover:opacity-100 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11 [@media(pointer:coarse)]:opacity-100',
                    starred.has(m.itemId) ? 'opacity-100' : 'opacity-60 md:opacity-0',
                  )}
                >
                  <Star
                    className={cn('h-3.5 w-3.5', starred.has(m.itemId) && 'fill-accent-amber text-accent-amber')}
                    strokeWidth={2}
                  />
                </button>
                {/* TWO MARKERS, TWO DIFFERENT SENTENCES.
                    "Not yet approved by the client" is a piece nobody has
                    asked the client about — it is usable, and the sign-off
                    happens by itself when the post goes out. "With the client
                    now" is a piece on the client's screen AT THIS MOMENT: it
                    is NOT usable in one press, because posting it would take
                    it out from under somebody who is reading it. That one is
                    only ever skipped on purpose, through the button below and
                    the question it asks. */}
                {m.ok && m.needsClientApproval && (
                  <span className="pointer-events-none absolute inset-x-1 bottom-1 truncate rounded-full bg-ink/70 px-2 py-0.5 text-[10px] font-semibold text-cream">
                    {NOT_CLIENT_APPROVED}
                  </span>
                )}
                {/* waiting on somebody, and this person could be that
                    somebody: the whole bottom of the card signs it off, after
                    one question. The reason sits ABOVE the button rather than
                    being replaced by it — a manager pressing "Approve without
                    client" has to be able to read that the client is looking
                    at it right now. */}
                {!m.ok && mayApproveWithoutClient(role, m.status, m.clientSignsOff) ? (
                  <>
                    {m.reason && (
                      <span className="pointer-events-none absolute inset-x-1 bottom-12 truncate rounded-full bg-ink/70 px-2 py-0.5 text-[10px] font-semibold text-cream">
                        {m.reason}
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => onApprove(m)}
                      title={m.reason ? `${m.title} — ${m.reason}` : m.title}
                      className="absolute inset-x-0 bottom-0 z-10 min-h-11 w-full bg-cream/95 px-2 text-[11px] font-semibold leading-[1.2] text-ink hover:bg-cream"
                    >
                      Approve without client
                    </button>
                  </>
                ) : !m.ok && m.reason ? (
                  <span className="pointer-events-none absolute inset-x-1 bottom-1 truncate rounded-full bg-ink/70 px-2 py-0.5 text-[10px] font-semibold text-cream">
                    {m.reason}
                  </span>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </div>

      <p className="px-1.5 text-center text-[12px] text-muted-foreground">
        Pick a piece of media to start a post, or drag it onto a time. You can
        also drop a file straight onto the calendar.
      </p>

      <div className="flex min-h-10 items-center justify-center rounded-full border border-border bg-paper px-3 text-[13px] font-semibold">
        Waiting for approval · {waiting}
      </div>
    </div>
  )
}
