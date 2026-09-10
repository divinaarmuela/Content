'use client'

import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, FolderOpen, Plus, Star } from 'lucide-react'
import type { Slide } from '@/app/lib/version-files-core'
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
  media, waiting, drafts = 0, onDrafts, loading, role, postWithoutApproval, onNew, onPick, onApprove, onRemove,
}: {
  media: RailMedia[]
  waiting: number
  /** posts saved and left — never drawn on a grid; the List is where they are */
  drafts?: number
  onDrafts?: () => void
  loading: boolean
  /** the viewer's role — an account manager or a super admin may sign a piece
   *  off without the client from here */
  role: string | null
  /** …and for those two the rail also carries media the client has not signed
   *  off yet, which is why the heading cannot say "Approved" to them */
  postWithoutApproval: boolean
  /** start a post with nothing chosen yet */
  onNew: () => void
  /** start a post from this piece — with only the ticked files, when given */
  onPick: (media: RailMedia, slides?: Slide[]) => void
  /** sign this piece off without waiting for the client */
  onApprove: (media: RailMedia) => void
  /** a manager throwing a piece away from here — the rail had no way to
   *  delete anything (the owner, 10 Sep 2026: "as a super admin or AM why
   *  wasn't I able to delete this") */
  onRemove?: (media: RailMedia) => Promise<void> | void
}) {
  const [removing, setRemoving] = useState<string | null>(null)
  // "Unused" starts on, as the design has it: the rail is for finding the
  // next thing to post, and media already in a post is not that
  const [filters, setFilters] = useState<Set<RailFilter>>(() => new Set<RailFilter>(['Unused']))
  const [starred, toggleStar] = useStars()
  const shown = useMemo(() => filterMedia(media, filters, starred), [media, filters, starred])

  /**
   * A FOLDER PER PIECE (the owner, 9 Sep 2026: "make sure approved media
   * shows like a folder so we know we can select from there which one to
   * post … once we select and see there we know which one we want to
   * schedule"). Open a folder, tick the files, press Post — the composer
   * opens with just those. Files already in a booked post are not offered.
   */
  const [openFolder, setOpenFolder] = useState<string | null>(null)
  const [ticked, setTicked] = useState<Set<string>>(() => new Set())
  const openIt = (m: RailMedia) => {
    if (openFolder === m.itemId) { setOpenFolder(null); return }
    setOpenFolder(m.itemId)
    setTicked(new Set(m.slides.map(sl => sl.url)))
  }
  const tick = (url: string) => setTicked(prev => {
    const next = new Set(prev)
    if (next.has(url)) next.delete(url); else next.add(url)
    return next
  })

  const flip = (f: RailFilter) => setFilters(prev => {
    const next = new Set(prev)
    if (next.has(f)) next.delete(f); else next.add(f)
    return next
  })

  return (
    <div data-tour="media-rail" className="flex h-full min-h-0 flex-col gap-3">
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
        <span className="flex flex-col leading-[1.15]">
          <span className="text-[13px] font-semibold">
            {postWithoutApproval ? 'Media' : 'Approved media'}
          </span>
          {/* the scheduler's question, answered in the heading (9 Sep 2026):
              what is approved and not yet posted */}
          <span className="text-[11px] text-muted-foreground">
            {filters.has('Unused') ? 'Approved, not yet posted' : 'Everything approved'}
          </span>
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
          <div className="flex flex-col gap-2">
            {shown.map(m => {
              const isOpen = openFolder === m.itemId
              const chosen = m.slides.filter(sl => ticked.has(sl.url))
              return (
                <div
                  key={m.itemId}
                  draggable={m.ok}
                  onDragStart={e => {
                    e.dataTransfer.effectAllowed = 'copy'
                    e.dataTransfer.setData(RAIL_DRAG_TYPE, m.itemId)
                    e.dataTransfer.setData('text/plain', m.title)
                  }}
                  className={cn('rounded-tile border border-border bg-surface', !m.ok && 'border-dashed')}
                >
                  {/* the folder's face: cover, name, how many files, how many gone */}
                  <div className="flex items-center gap-2 p-1.5">
                    <button
                      type="button"
                      disabled={!m.ok}
                      onClick={() => openIt(m)}
                      aria-expanded={isOpen}
                      aria-label={m.ok ? `Open ${m.title}` : `${m.title} — ${m.reason}`}
                      className="flex min-w-0 flex-1 items-center gap-2 text-left disabled:cursor-not-allowed"
                    >
                      <span className="relative h-11 w-11 shrink-0 overflow-hidden rounded-[6px] bg-foreground/[0.06]">
                        <Thumb slide={m.cover} label={m.title} className={cn('h-full w-full', !m.ok && 'opacity-45')} />
                        {m.ok && !m.needsClientApproval && (
                          <span className="absolute left-0.5 top-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-accent-green text-[8px] font-bold text-ink">✓</span>
                        )}
                      </span>
                      <span className="flex min-w-0 flex-col leading-[1.2]">
                        <span className="truncate text-[13px] font-semibold">{m.title}</span>
                        <span className="truncate text-[11px] text-muted-foreground">
                          {m.ok
                            ? `${m.slides.length} ${m.slides.length === 1 ? 'file' : 'files'} to post${m.posted ? ` · ${m.posted}` : ''}${m.needsClientApproval ? ` · ${NOT_CLIENT_APPROVED}` : ''}`
                            : m.reason}
                        </span>
                      </span>
                    </button>
                    <button
                      type="button"
                      aria-pressed={starred.has(m.itemId)}
                      aria-label={starred.has(m.itemId) ? `Unstar ${m.title}` : `Star ${m.title}`}
                      onClick={() => toggleStar(m.itemId)}
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted"
                    >
                      <Star className={cn('h-3.5 w-3.5', starred.has(m.itemId) && 'fill-accent-amber text-accent-amber')} strokeWidth={2} />
                    </button>
                    {m.ok && (
                      <button type="button" onClick={() => openIt(m)} aria-label={isOpen ? 'Close folder' : 'Open folder'}
                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted">
                        {isOpen ? <ChevronDown className="h-4 w-4" /> : <FolderOpen className="h-4 w-4" />}
                      </button>
                    )}
                  </div>

                  {/* open: the files, ticked, and the one press */}
                  {isOpen && m.ok && (
                    <div className="flex flex-col gap-2 border-t border-border p-1.5">
                      <div className="grid grid-cols-3 gap-1.5">
                        {m.slides.map((sl, i) => {
                          const on = ticked.has(sl.url)
                          return (
                            <button
                              key={sl.url}
                              type="button"
                              onClick={() => tick(sl.url)}
                              aria-pressed={on}
                              aria-label={`${on ? 'Untick' : 'Tick'} ${sl.type === 'video' ? 'video' : 'photo'} ${i + 1}`}
                              className={cn(
                                'relative aspect-square overflow-hidden rounded-[6px] bg-foreground/[0.06]',
                                on ? 'outline outline-2 outline-offset-1 outline-foreground' : 'opacity-60',
                              )}
                            >
                              <Thumb slide={sl} label={sl.name} className="h-full w-full" />
                              <span className={cn(
                                'absolute left-1 top-1 flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-bold',
                                on ? 'bg-foreground text-background' : 'bg-cream/90 text-ink',
                              )}>{i + 1}</span>
                            </button>
                          )
                        })}
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <button type="button" onClick={() => setTicked(new Set(chosen.length === m.slides.length ? [] : m.slides.map(sl => sl.url)))}
                          className="text-[12px] font-semibold underline-offset-4 hover:underline">
                          {chosen.length === m.slides.length ? 'Untick all' : 'Tick all'}
                        </button>
                        <button
                          type="button"
                          disabled={chosen.length === 0}
                          onClick={() => onPick(m, chosen)}
                          className="flex min-h-9 items-center gap-1.5 rounded-full bg-foreground px-3.5 text-[12px] font-semibold text-background disabled:opacity-40"
                        >
                          <Plus className="h-3.5 w-3.5" /> Post {chosen.length === m.slides.length ? 'all' : chosen.length} {chosen.length === 1 ? 'file' : 'files'}
                        </button>
                      </div>
                    </div>
                  )}

                  {/* a manager removes a piece from here: two presses, and
                      never one the channel is holding */}
                  {onRemove && (role === 'account_manager' || role === 'super_admin') && isOpen && (
                    removing === m.itemId ? (
                      <div className="flex items-center justify-between gap-2 border-t border-border px-2 py-1.5">
                        <span className="text-[11px] font-semibold">Remove this piece and its files?</span>
                        <span className="flex gap-1.5">
                          <button type="button" onClick={() => setRemoving(null)} className="min-h-8 rounded-full border border-border px-2.5 text-[11px] font-semibold hover:bg-muted">Keep it</button>
                          <button type="button" onClick={() => { setRemoving(null); void onRemove(m) }} className="min-h-8 rounded-full bg-accent-red px-2.5 text-[11px] font-semibold text-cream">Remove</button>
                        </span>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setRemoving(m.itemId)}
                        className="min-h-8 w-full border-t border-border px-2 text-left text-[11px] font-semibold text-muted-foreground hover:bg-muted"
                      >
                        Remove this piece
                      </button>
                    )
                  )}
                  {/* waiting on somebody, and this person could be that
                      somebody: sign it off, after one question */}
                  {!m.ok && mayApproveWithoutClient(role, m.status, m.clientSignsOff) && (
                    <button
                      type="button"
                      onClick={() => onApprove(m)}
                      title={m.reason ? `${m.title} — ${m.reason}` : m.title}
                      className="min-h-9 w-full rounded-b-tile border-t border-border bg-cream/95 px-2 text-[11px] font-semibold text-ink hover:bg-cream"
                    >
                      Approve without client
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      <p className="px-1.5 text-center text-[12px] text-muted-foreground">
        Open a folder, tick the files you want, press Post. Or drag a folder
        onto a time.
      </p>

      <div className="flex min-h-10 items-center justify-center rounded-full border border-border bg-paper px-3 text-[13px] font-semibold">
        Waiting for approval · {waiting}
      </div>
      {drafts > 0 && (
        <button
          type="button"
          onClick={onDrafts}
          className="flex min-h-10 flex-col items-center justify-center rounded-full border border-dashed border-border px-3 text-[13px] font-semibold hover:bg-muted"
        >
          <span>Drafts · {drafts}</span>
          <span className="text-[11px] font-normal text-muted-foreground">Not on the calendar until scheduled</span>
        </button>
      )}
    </div>
  )
}
