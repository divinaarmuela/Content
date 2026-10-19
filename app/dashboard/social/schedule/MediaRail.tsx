'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { ChevronDown, FolderOpen, Plus, Star } from 'lucide-react'
import type { Slide } from '@/app/lib/version-files-core'
import { cn } from '@/lib/utils'
import { NOT_CLIENT_APPROVED } from '@/app/lib/social-schedule-core'
import { POST_APPROVAL_BOARD } from '@/app/lib/overview-links-core'
import { Thumb } from './tiles'
import { baseName, startOpenFolders, tileTree, type TileFolder } from '@/app/lib/drive-folder-files-core'
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
 * Tapping a card opens its files; dragging one onto the calendar starts a
 * post at the hour it was dropped on. A card that CANNOT start a post still
 * opens: to say why, and so a manager can remove it (audit S11: a greyed
 * card could never be removed from here).
 *
 * NOTHING IS APPROVED FROM HERE (the owner's decision 1). A post made from a
 * piece is a draft that goes to the quality check. The old "Approve without
 * client" button signed the EDIT off from the Schedule page, and is gone.
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
  media, waiting, drafts = 0, onDrafts, loading, role, postWithoutApproval, onNew, onPick, onRemove,
}: {
  media: RailMedia[]
  /** posts still being approved (Quality check, With client) — on Post approval */
  waiting: number
  /** drafts — never drawn on a grid; the List's Drafts filter is where they are */
  drafts?: number
  onDrafts?: () => void
  loading: boolean
  /** the viewer's role — an account manager or a super admin may remove a piece */
  role: string | null
  /** for those two the rail also carries media the client has not signed off
   *  yet, which is why the heading cannot say "Approved" to them */
  postWithoutApproval: boolean
  /** start a post with nothing chosen yet */
  onNew: () => void
  /** start a post from this piece — with only the ticked files, when given */
  onPick: (media: RailMedia, slides?: Slide[]) => void
  /** a manager throwing a piece away from here — the rail had no way to
   *  delete anything (the owner, 10 Sep 2026: "as a super admin or AM why
   *  wasn't I able to delete this") */
  onRemove?: (media: RailMedia) => Promise<void> | void
}) {
  const [removing, setRemoving] = useState<string | null>(null)
  // "Unused" starts on, as the design has it: the rail is for finding the
  // next thing to post, and media already in a post is not that
  // EVERYTHING APPROVED by default (19 Oct 2026): a piece already in a post is there to be used again for
  // another network, rather than uploaded a second time — free pieces still come first. "Unused" is one press.
  const [filters, setFilters] = useState<Set<RailFilter>>(() => new Set<RailFilter>())
  const [starred, toggleStar] = useStars()
  const shown = useMemo(() => filterMedia(media, filters, starred), [media, filters, starred])

  /**
   * A FOLDER PER PIECE (the owner, 9 Sep 2026: "make sure approved media
   * shows like a folder so we know we can select from there which one to
   * post … once we select and see there we know which one we want to
   * schedule"). Open a folder, tick the files, press Post — the composer
   * opens with just those. Files already in a post are offered too, marked, and
   * start unticked unless nothing else is free — the same stored file, so its
   * preview and any copy already made are used again (19 Oct 2026).
   */
  const [openFolder, setOpenFolder] = useState<string | null>(null)
  const [ticked, setTicked] = useState<Set<string>>(() => new Set())
  /** which subfolders of the open card are open — a lone wrapping folder opens by itself */
  const [openSub, setOpenSub] = useState<Set<string>>(() => new Set())
  const toggleSub = (path: string) => setOpenSub(prev => {
    const next = new Set(prev)
    if (next.has(path)) next.delete(path); else next.add(path)
    return next
  })
  const openIt = (m: RailMedia) => {
    if (openFolder === m.itemId) { setOpenFolder(null); return }
    setOpenFolder(m.itemId)
    setOpenSub(startOpenFolders(tileTree(m.allSlides.length ? m.allSlides : m.slides)))
    setTicked(new Set((m.slides.length ? m.slides : m.allSlides).map(sl => sl.url)))
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
          <span className="text-[12px] text-muted-foreground">
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
              // every approved file, in order; the ones a post already holds are marked
              const offer = m.allSlides.length ? m.allSlides : m.slides
              const taken = new Set(m.takenUrls)
              const chosen = offer.filter(sl => ticked.has(sl.url))
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
                      onClick={() => openIt(m)}
                      aria-expanded={isOpen}
                      aria-label={m.ok ? `Open ${m.title}` : `${m.title} — ${m.reason}`}
                      className="flex min-w-0 flex-1 items-center gap-2 text-left"
                    >
                      <span className="relative h-11 w-11 shrink-0 overflow-hidden rounded-[6px] bg-foreground/[0.06]">
                        <Thumb slide={m.cover} label={m.title} className={cn('h-full w-full', !m.ok && 'opacity-45')} />
                        {m.ok && !m.needsClientApproval && (
                          <span className="absolute left-0.5 top-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-accent-green text-[8px] font-bold text-ink">✓</span>
                        )}
                      </span>
                      <span className="flex min-w-0 flex-col leading-[1.2]">
                        <span className="truncate text-[13px] font-semibold">{m.title}</span>
                        <span className="truncate text-[12px] text-muted-foreground">
                          {m.ok
                            ? (m.used
                              ? `In a post · use again${m.posted ? ` · ${m.posted}` : ''}`
                              : `${m.slides.length} ${m.slides.length === 1 ? 'file' : 'files'} to post${m.posted ? ` · ${m.posted}` : ''}${m.needsClientApproval ? ` · ${NOT_CLIENT_APPROVED}` : ''}`)
                            : m.reason}
                        </span>
                        {/* THE FOLDER THE SCHEDULER WAS HANDED (the owner, 13 Sep
                            2026): "in their UI on schedule or overview it will be
                            folder to work from" — they download from it and make
                            their own post */}
                        {m.driveFolderUrl && (
                          <a href={m.driveFolderUrl} target="_blank" rel="noreferrer noopener"
                            onClick={e => e.stopPropagation()}
                            className="inline-flex min-h-11 items-center gap-1 truncate text-[12px] font-semibold underline underline-offset-4">
                            Folder to work from<span className="sr-only">, opens in a new tab</span>
                          </a>
                        )}
                      </span>
                    </button>
                    <button
                      type="button"
                      aria-pressed={starred.has(m.itemId)}
                      aria-label={starred.has(m.itemId) ? `Unstar ${m.title}` : `Star ${m.title}`}
                      onClick={() => toggleStar(m.itemId)}
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted"
                    >
                      <Star className={cn('h-4 w-4', starred.has(m.itemId) && 'fill-accent-amber text-accent-amber')} strokeWidth={2} aria-hidden />
                    </button>
                    {m.ok && (
                      <button type="button" onClick={() => openIt(m)} aria-label={isOpen ? 'Close folder' : 'Open folder'}
                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted">
                        {isOpen ? <ChevronDown className="h-4 w-4" aria-hidden /> : <FolderOpen className="h-4 w-4" aria-hidden />}
                      </button>
                    )}
                  </div>

                  {/* open: the files, ticked, and the one press */}
                  {isOpen && m.ok && (
                    <div className="flex flex-col gap-2 border-t border-border p-1.5">
                      {/* THE FOLDERS OF THE HANDED-IN LINK (19 Oct 2026): the main folder's files, then each
                          subfolder's, Drive's way round — a folder can be ticked whole, so a carousel's clips go
                          out as one post */}
                      <RailFolder node={tileTree(offer)} depth={0} open={openSub} onToggle={toggleSub}
                        onTickFolder={files => setTicked(new Set(files.map(f => f.url)))}
                        file={sl => {
                          const i = offer.indexOf(sl)
                          const on = ticked.has(sl.url)
                          return (
                            <button
                              key={sl.url}
                              type="button"
                              onClick={() => tick(sl.url)}
                              aria-pressed={on}
                              aria-label={`${on ? 'Untick' : 'Tick'} ${sl.type === 'video' ? 'video' : 'photo'} ${i + 1}${taken.has(sl.url) ? ', already in a post' : ''}`}
                              className={cn(
                                'relative aspect-square overflow-hidden rounded-[6px] bg-foreground/[0.06]',
                                on ? 'outline outline-2 outline-offset-1 outline-foreground' : 'opacity-60',
                              )}
                            >
                              <Thumb slide={sl} label={baseName(sl.name)} className="h-full w-full" />
                              {taken.has(sl.url) && (
                                <span className="absolute inset-x-0 bottom-0 bg-ink/70 px-1 py-0.5 text-center text-[9px] font-semibold text-cream">In a post</span>
                              )}
                              <span className={cn(
                                'absolute left-1 top-1 flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-bold',
                                on ? 'bg-foreground text-background' : 'bg-cream/90 text-ink',
                              )}>{i + 1}</span>
                            </button>
                          )
                        }} />
                      <div className="flex items-center justify-between gap-2">
                        <button type="button" onClick={() => setTicked(new Set(chosen.length === offer.length ? [] : offer.map(sl => sl.url)))}
                          className="-my-1 inline-flex min-h-11 items-center text-[12px] font-semibold underline-offset-4 hover:underline">
                          {chosen.length === offer.length ? 'Untick all' : 'Tick all'}
                        </button>
                        <button
                          type="button"
                          disabled={chosen.length === 0}
                          onClick={() => onPick(m, chosen)}
                          className="flex min-h-11 items-center gap-1.5 rounded-full bg-foreground px-3.5 text-[12px] font-semibold text-background disabled:opacity-40"
                        >
                          <Plus className="h-3.5 w-3.5" aria-hidden /> Post {chosen.length === offer.length && offer.length > 1 ? 'all' : chosen.length} {chosen.length === 1 ? 'file' : 'files'}
                        </button>
                      </div>
                    </div>
                  )}

                  {/* open on a card that cannot start a post: why, in words */}
                  {isOpen && !m.ok && m.reason && (
                    <p className="border-t border-border px-2 py-1.5 text-[12px] text-muted-foreground">
                      {m.reason}. It cannot become a post yet.
                    </p>
                  )}

                  {/* a manager removes a piece from here: two presses, on ANY
                      card (audit S11), and never one whose posts are booked
                      in or live. The button stays, with the reason beside it */}
                  {onRemove && (role === 'account_manager' || role === 'super_admin') && isOpen && (
                    m.holdsBooking ? (
                      <div className="flex items-center justify-between gap-2 border-t border-border px-2 py-1.5">
                        <button type="button" disabled className="min-h-11 shrink-0 text-left text-[12px] font-semibold text-muted-foreground opacity-50">
                          Remove this piece
                        </button>
                        <span className="text-right text-[12px] text-muted-foreground">Take its posts off the schedule first</span>
                      </div>
                    ) : removing === m.itemId ? (
                      <div className="flex items-center justify-between gap-2 border-t border-border px-2 py-1.5">
                        <span className="text-[12px] font-semibold">Remove this piece and its files?</span>
                        <span className="flex gap-1.5">
                          <button type="button" onClick={() => setRemoving(null)} className="min-h-11 rounded-full border border-border px-2.5 text-[12px] font-semibold hover:bg-muted">Keep it</button>
                          <button type="button" onClick={() => { setRemoving(null); void onRemove(m) }} className="min-h-11 rounded-full bg-accent-red px-2.5 text-[12px] font-semibold text-cream">Remove</button>
                        </span>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setRemoving(m.itemId)}
                        className="min-h-11 w-full border-t border-border px-2 text-left text-[12px] font-semibold text-muted-foreground hover:bg-muted"
                      >
                        Remove this piece
                      </button>
                    )
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

      {/* POSTS STILL BEING APPROVED live on Post approval (the owner's
          decision 1): this page only counts them and says where they are */}
      {waiting > 0 && (
      <Link
        href={POST_APPROVAL_BOARD}
        className="flex min-h-11 flex-col items-center justify-center rounded-full border border-border bg-paper px-3 text-[13px] font-semibold hover:bg-muted"
      >
        <span>Being approved · {waiting}</span>
        <span className="text-[12px] font-normal text-muted-foreground">On Post approval</span>
      </Link>
      )}
      {drafts > 0 && (
        <button
          type="button"
          onClick={onDrafts}
          className="flex min-h-10 flex-col items-center justify-center rounded-full border border-dashed border-border px-3 text-[13px] font-semibold hover:bg-muted"
        >
          <span>Drafts · {drafts}</span>
          <span className="text-[12px] font-normal text-muted-foreground">Not on the calendar — they go to quality check first</span>
        </button>
      )}
    </div>
  )
}

/**
 * One folder of a card's files in the rail (19 Oct 2026): its own files three to a row, then its subfolders as
 * rows that open in place — each with its name, how many files, and "Tick this folder".
 */
function RailFolder({ node, depth, open, onToggle, onTickFolder, file }: {
  node: TileFolder<Slide>
  depth: number
  open: ReadonlySet<string>
  onToggle: (path: string) => void
  onTickFolder: (files: Slide[]) => void
  file: (s: Slide) => React.ReactNode
}) {
  const everyFile = (f: TileFolder<Slide>): Slide[] => [...f.files, ...f.folders.flatMap(everyFile)]
  return (
    <div className="flex flex-col gap-1.5">
      {node.files.length > 0 && <div className="grid grid-cols-3 gap-1.5">{node.files.map(sl => <span key={sl.url} className="contents">{file(sl)}</span>)}</div>}
      {node.folders.map(f => {
        const isOpen = open.has(f.path)
        return (
          <div key={f.path} className="flex flex-col gap-1.5" data-rail-subfolder={f.path}>
            <div className="flex items-center gap-1 rounded-[6px] border border-border bg-surface pr-1">
              <button type="button" onClick={() => onToggle(f.path)} aria-expanded={isOpen}
                className="flex min-h-9 min-w-0 flex-1 items-center gap-1.5 px-1.5 text-left">
                <ChevronDown className={cn('h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform', !isOpen && '-rotate-90')} aria-hidden />
                <FolderOpen className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                <span className="truncate text-[12px] font-semibold" title={f.path}>{f.name}</span>
                <span className="shrink-0 text-[11px] text-muted-foreground">{f.count}</span>
              </button>
              <button type="button" onClick={() => onTickFolder(everyFile(f))}
                className="min-h-9 shrink-0 px-1.5 text-[11px] font-semibold underline-offset-4 hover:underline">
                Tick this folder
              </button>
            </div>
            {isOpen && (
              <div className="border-l border-border pl-1.5">
                <RailFolder node={f} depth={depth + 1} open={open} onToggle={onToggle} onTickFolder={onTickFolder} file={file} />
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
