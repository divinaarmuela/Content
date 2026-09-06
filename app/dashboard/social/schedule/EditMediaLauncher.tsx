'use client'

import { useEffect, useMemo, useState } from 'react'
import { Search, Wand2, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { editMediaFooterLine } from '@/app/lib/image-edit-core'
import { Thumb } from './tiles'
import type { ImageEditorTarget } from './ImageEditor'
import type { RailMedia, SchedulePostRow } from './useSchedulePosts'

/**
 * THE WAY IN TO THE IMAGE EDITOR.
 *
 * One button on the calendar's toolbar and one chooser behind it: every file
 * of every approved piece for this client, as tiles, and a click opens it in
 * the editor. Flat rather than two steps — somebody looking for "the third
 * card of the carousel" is looking for a PICTURE, not for the piece it
 * belongs to, and making them find the piece first is a step in front of the
 * thing they can already see.
 *
 * Deliberately separate from the composer. The composer's own "Edit image"
 * button, next to the slot it belongs to, is a different (and better) way in
 * for somebody already writing a post; this is the one for somebody looking
 * at the week who wants to fix a picture before anything is planned.
 *
 * It does not OWN the editor. There is exactly one editor on the page, opened
 * by whoever asks for it — this chooser, or the composer's own button — so a
 * picture edited from one place and a picture edited from the other cannot
 * behave differently, and two of them can never be open at once.
 */
export default function EditMediaLauncher({ media, posts, mayApprove, className, onEdit }: {
  media: RailMedia[]
  posts: SchedulePostRow[]
  /** this person may schedule a post themselves — the footer says so */
  mayApprove: boolean
  className?: string
  /** hand a picture to the page's editor */
  onEdit: (target: ImageEditorTarget) => void
}) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')

  useEffect(() => {
    if (!open) return
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('keydown', esc)
    return () => document.removeEventListener('keydown', esc)
  }, [open])

  /** every file of every piece whose media the client has approved */
  const tiles = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return media
      .filter(m => m.slides.length > 0)
      .flatMap(m => m.slides.map((slide, index) => ({
        key: `${m.itemId}:${index}`,
        media: m,
        slide,
        index,
        postId: posts.find(p => p.item_id === m.itemId)?.id ?? null,
      })))
      .filter(t => !needle
        || t.media.title.toLowerCase().includes(needle)
        || t.slide.name.toLowerCase().includes(needle))
  }, [media, posts, q])

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          'flex min-h-11 items-center gap-2 rounded-full border border-border bg-surface px-4 text-[13px] font-semibold hover:bg-muted',
          className,
        )}
      >
        <Wand2 className="h-4 w-4" strokeWidth={1.8} aria-hidden />
        Edit media
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Choose a picture to edit"
          onMouseDown={e => { if (e.target === e.currentTarget) setOpen(false) }}
          className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-ink/55 p-3 sm:items-center sm:p-6"
        >
          <div className="flex max-h-full w-full max-w-[720px] flex-col gap-3.5 rounded-card bg-surface p-4 shadow-xl sm:p-5">
            <div className="flex items-start justify-between gap-2">
              <div className="flex flex-col">
                <h2 className="text-section-title">Edit media</h2>
                <p className="text-[13px] text-muted-foreground">
                  Crop, adjust or put a line of words on any approved picture.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
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
              {tiles.length === 0 ? (
                <p className="py-6 text-center text-[13px] text-muted-foreground">
                  {media.length === 0
                    ? 'Nothing approved yet. Media shows up here once the client signs it off.'
                    : 'Nothing matches that.'}
                </p>
              ) : (
                <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                  {tiles.map(t => (
                    <button
                      key={t.key}
                      type="button"
                      onClick={() => {
                        setOpen(false)
                        onEdit({
                          itemId: t.media.itemId,
                          title: t.media.title,
                          versionNumber: t.media.versionNumber,
                          slides: t.media.slides,
                          index: t.index,
                          postId: t.postId,
                          clientApproved: t.media.clientApproved,
                        })
                      }}
                      className="group relative flex aspect-[4/5] flex-col overflow-hidden rounded-tile border border-border bg-foreground/[0.06] text-left hover:shadow-md"
                    >
                      <Thumb
                        slide={t.slide}
                        label={t.media.title}
                        className="pointer-events-none h-full w-full"
                      />
                      <span className="pointer-events-none absolute inset-x-0 bottom-0 bg-ink/70 px-1.5 py-1 text-[11px] font-semibold text-cream">
                        <span className="block truncate">{t.media.title}</span>
                        {t.media.slides.length > 1 && (
                          <span className="block truncate font-normal text-cream/80">
                            {`Picture ${t.index + 1} of ${t.media.slides.length}`}
                          </span>
                        )}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <p className="text-[12px] text-muted-foreground">
              {editMediaFooterLine(mayApprove)}
            </p>
          </div>
        </div>
      )}
    </>
  )
}
