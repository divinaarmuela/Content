'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Search, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { mayApproveWithoutClient } from '@/app/lib/social-schedule-core'
import { formatInZone } from '@/app/lib/timezone-core'
import { Thumb } from './tiles'
import type { RailMedia } from './useSchedulePosts'

/**
 * ADD MEDIA — the step in front of the composer.
 *
 * "New post" used to open the window already loaded with whichever approved
 * piece happened to sort first, media and all. Someone clicking Thursday 10am
 * to mean "put something here" got a composition nobody chose, one reflex
 * press of Send for approval away from queueing the wrong piece.
 *
 * So nothing is picked for anybody. The time the click meant is carried
 * across and said out loud at the top; the choice is the whole screen.
 *
 * A piece that cannot start a post is still listed, greyed, with the reason
 * on it — hiding it only makes somebody ask where their video went.
 */
export default function PiecePicker({ media, at, tz, role, onPick, onApprove, onClose }: {
  media: RailMedia[]
  /** the time the click meant, carried through to the composer */
  at: string | null
  tz: string
  /** the viewer's role — an account manager or a super admin may sign a piece
   *  off without the client from here */
  role: string | null
  onPick: (media: RailMedia) => void
  /** sign this piece off without waiting for the client */
  onApprove: (media: RailMedia) => void
  onClose: () => void
}) {
  const [q, setQ] = useState('')
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    box.current?.focus()
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', esc)
    return () => document.removeEventListener('keydown', esc)
  }, [onClose])

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const rows = needle
      ? media.filter(m => m.title.toLowerCase().includes(needle))
      : media
    // ready first, then unused before used, then newest
    return [...rows].sort((a, b) =>
      Number(b.ok) - Number(a.ok)
      || Number(a.used) - Number(b.used)
      || b.updatedAt.localeCompare(a.updatedAt))
  }, [media, q])

  const when = at ? formatInZone(at, tz, 'full') : null

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Add media"
      onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}
      className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-ink/55 p-3 sm:items-center sm:p-6"
    >
      <div
        ref={box}
        tabIndex={-1}
        className="flex max-h-full w-full max-w-[720px] flex-col gap-3.5 rounded-card bg-surface p-4 shadow-xl outline-none sm:p-5"
      >
        <div className="flex items-start justify-between gap-2">
          <div className="flex flex-col">
            <h2 className="text-section-title">Add media</h2>
            <p className="text-[13px] text-muted-foreground">
              {when
                ? `Choose what goes out on ${when}.`
                : 'Choose what this post is made of.'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full hover:bg-muted"
          >
            <X className="h-[18px] w-[18px]" strokeWidth={2} aria-hidden />
          </button>
        </div>

        <label className="relative flex items-center">
          <Search
            className="pointer-events-none absolute left-3.5 h-4 w-4 text-muted-foreground"
            strokeWidth={1.8}
            aria-hidden
          />
          <span className="sr-only">Search the approved media</span>
          <input
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="Search by name"
            className="min-h-11 w-full rounded-full border border-border bg-paper pl-10 pr-4 text-[14px] outline-none"
          />
        </label>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {shown.length === 0 ? (
            <p className="py-6 text-center text-[13px] text-muted-foreground">
              {media.length === 0
                ? 'Nothing approved yet. Media shows up here once the client signs it off.'
                : 'Nothing matches that.'}
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
              {shown.map(m => (
                <div
                  key={m.itemId}
                  className={cn(
                    'group relative flex aspect-[4/5] flex-col overflow-hidden rounded-tile border border-border bg-foreground/[0.06] text-left',
                    // the dim goes on the PICTURE: `opacity` on the tile makes
                    // a stacking context, and no class on a button inside it
                    // can bring the button back to full strength
                    m.ok ? 'hover:shadow-md' : 'border-dashed',
                  )}
                >
                  <button
                    type="button"
                    disabled={!m.ok}
                    onClick={() => onPick(m)}
                    title={m.ok ? m.title : `${m.title} — ${m.reason}`}
                    aria-label={m.ok ? `Choose ${m.title}` : `${m.title} — ${m.reason}`}
                    className="absolute inset-0 z-0 disabled:cursor-not-allowed"
                  />
                  <Thumb
                    slide={m.cover}
                    label={m.title}
                    className={cn('pointer-events-none h-full w-full', !m.ok && 'opacity-45')}
                  />
                  {/* waiting on somebody, and this person could be that
                      somebody: one press signs it off, after one question */}
                  {!m.ok && mayApproveWithoutClient(role, m.status, m.clientApprovalRequired) && (
                    <button
                      type="button"
                      onClick={() => onApprove(m)}
                      className="absolute inset-x-1.5 bottom-[46px] z-10 flex min-h-11 items-center justify-center rounded-full bg-cream px-2 text-center text-[11px] font-semibold leading-[1.2] text-ink hover:opacity-90"
                    >
                      Approve without client
                    </button>
                  )}
                  <span className="pointer-events-none absolute inset-x-0 bottom-0 bg-ink/70 px-1.5 py-1 text-[11px] font-semibold text-cream">
                    <span className="block truncate">{m.title}</span>
                    {!m.ok && m.reason && (
                      <span className="block truncate font-normal text-cream/80">{m.reason}</span>
                    )}
                    {m.ok && m.used && (
                      <span className="block truncate font-normal text-cream/80">
                        Already has a post
                      </span>
                    )}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <p className="text-[12px] text-muted-foreground">
          Only media the client has approved can start a post. Files from Google Drive
          or your computer are added inside the post window, and go back to the client
          for approval first.
        </p>
      </div>
    </div>
  )
}
