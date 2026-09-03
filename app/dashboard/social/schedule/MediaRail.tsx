'use client'

import { useEffect, useMemo, useState } from 'react'
import { Plus, Star } from 'lucide-react'
import { cn } from '@/lib/utils'
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
 * Read-only in this pass: dragging a card onto the calendar arrives with the
 * composer, so the rail says what it can do rather than pretending.
 */

export const RAIL_FILTERS = ['Unused', 'Videos', 'Photos', 'Starred'] as const
export type RailFilter = (typeof RAIL_FILTERS)[number]

const STAR_KEY = 'md-schedule-starred'

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
  media, waiting, loading,
}: {
  media: RailMedia[]
  waiting: number
  loading: boolean
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
      {/* New post is the rail's one action, and it is not built yet: it says
          so on the button rather than opening nothing. */}
      <button
        type="button"
        disabled
        title="Making a post arrives with the composer"
        className="flex min-h-11 w-full cursor-not-allowed items-center justify-center gap-2 rounded-full bg-foreground/[0.06] text-[14px] font-semibold text-muted-foreground"
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
        <span className="text-[13px] font-semibold">Approved media</span>
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
              ? 'Nothing approved yet. Media shows up here once the client signs it off.'
              : 'Nothing matches those filters.'}
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {shown.map(m => (
              <div
                key={m.itemId}
                title={m.ok ? m.title : `${m.title} — ${m.reason}`}
                className={cn(
                  'group relative h-[84px] overflow-hidden rounded-tile border border-border bg-foreground/[0.06]',
                  !m.ok && 'opacity-45',
                )}
              >
                <Thumb slide={m.cover} label={m.title} className="h-full w-full" />
                {m.ok && (
                  <span className="absolute left-1.5 top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-accent-green text-[9px] font-bold text-ink">
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
                    'absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-ink/55 text-cream transition-opacity focus-visible:opacity-100 group-hover:opacity-100 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11 [@media(pointer:coarse)]:opacity-100',
                    starred.has(m.itemId) ? 'opacity-100' : 'opacity-60 md:opacity-0',
                  )}
                >
                  <Star
                    className={cn('h-3.5 w-3.5', starred.has(m.itemId) && 'fill-accent-amber text-accent-amber')}
                    strokeWidth={2}
                  />
                </button>
                {!m.ok && m.reason && (
                  <span className="absolute inset-x-1 bottom-1 truncate rounded-full bg-ink/70 px-2 py-0.5 text-[10px] font-semibold text-cream">
                    {m.reason}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <p className="px-1.5 text-center text-[12px] text-muted-foreground">
        Pick a piece of media to start a post. Moving a post arrives next.
      </p>

      <div className="flex min-h-10 items-center justify-center rounded-full border border-border bg-paper px-3 text-[13px] font-semibold">
        Waiting for approval · {waiting}
      </div>
    </div>
  )
}
