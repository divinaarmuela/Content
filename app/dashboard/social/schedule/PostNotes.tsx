'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { COMMENT_VISIBILITY_LABEL, type CommentVisibility } from '@/app/lib/post-stage-core'
import { firstNoteThread, openNoteCounts, placeNotes, type NoteInput, type PostNote } from '@/app/lib/post-window-core'
import { slideTypeFromUrl, type Slide } from '@/app/lib/version-files-core'
import { X } from 'lucide-react'
import { Thumb } from './tiles'

/**
 * NOTES ON THE POST — per file, from the first build (the owner's decision 9,
 * 29 Sep 2026: "comment is per file").
 *
 * Pick where the note goes — the whole post, or one of its files — and which
 * thread: Team (the default, never shown to the client) or Client (the client
 * sees it on their review page). A note is pinned to the FILE, not to its
 * place in the carousel, so moving the pictures around cannot move a note
 * onto the wrong one (audit P10).
 */
export default function PostNotes({ slides, notes, version, onAdd, className }: {
  /** the files on screen — the frozen version, or the draft being made */
  slides: Slide[]
  notes: PostNote[]
  /** the version a new note belongs to (the one on screen) */
  version: number
  /** writes the note; the list itself arrives live */
  onAdd: (note: NoteInput) => Promise<{ ok: true } | { ok: false; reason: string }>
  className?: string
}) {
  // the client's thread first when the client has said anything — that is the work (30 Sep 2026: Jordan's notes sat
  // behind the Team tab and a click per slide, so the post looked like it had none)
  const [thread, setThread] = useState<CommentVisibility>(() => firstNoteThread(notes))
  const chosen = useRef(false)
  useEffect(() => { if (!chosen.current) setThread(firstNoteThread(notes)) }, [notes])
  const [at, setAt] = useState<string | null>(null)
  const [text, setText] = useState('')
  // THE SLIDE, BIG (the owner, 30 Sep 2026: "when clicking it we should be able to see the image popup") — the slide
  // as it is now, or the earlier one a note was written on, to check the change was made
  const [zoom, setZoom] = useState<{ slide: Slide; caption: string } | null>(null)
  useEffect(() => {
    if (!zoom) return
    // on WINDOW, capturing: it runs before the post window's own Escape (on document), which would close it all
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopImmediatePropagation(); e.stopPropagation(); setZoom(null) } }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [zoom])
  const earlier = (url: string, slide: number | null): Slide => ({ url, type: slideTypeFromUrl(url), name: `Earlier slide ${slide ?? ''}`.trim() })
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const place = at && slides.some(s => s.url === at) ? at : null
  const index = place ? slides.findIndex(s => s.url === place) : -1
  const placed = useMemo(() => placeNotes(notes, slides).filter(p => p.note.visibility === thread), [notes, slides, thread])
  const counts = useMemo(() => openNoteCounts(placed), [placed])
  // "Whole post" lists EVERY note of the thread, each with its slide; a slide lists its own, the replaced ones too
  const shown = place ? placed.filter(p => p.slide === index + 1) : placed

  const add = async () => {
    const body = text.trim()
    if (!body) { setProblem('Write the note first.'); return }
    setBusy(true); setProblem(null)
    const r = await onAdd({ body, file_url: place, slide_index: index >= 0 ? index : null, version, visibility: thread })
    setBusy(false)
    if (r.ok) setText('')
    else setProblem(r.reason)
  }

  return (
    <section aria-label="Notes" className={cn('flex flex-col gap-2.5 rounded-inner border border-border p-3', className)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-[13px] font-semibold">Notes</h3>
        <div className="flex gap-1 rounded-full border border-border p-0.5" role="tablist" aria-label="Which thread">
          {(['team', 'client'] as const).map(t => (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={thread === t}
              onClick={() => { chosen.current = true; setThread(t) }}
              className={cn(
                'min-h-9 rounded-full px-3 text-[12px] font-semibold',
                thread === t ? 'bg-foreground text-background' : 'hover:bg-muted',
              )}
            >
              {t === 'team' ? 'Team' : 'Client'}
            </button>
          ))}
        </div>
      </div>
      <p className="text-[12px] text-muted-foreground" data-note-thread={thread}>{COMMENT_VISIBILITY_LABEL[thread]}</p>

      {slides.length > 0 && (
        <div className="flex gap-1.5 overflow-x-auto pb-1" role="group" aria-label="Which file">
          <button
            type="button"
            aria-pressed={place === null}
            onClick={() => setAt(null)}
            className={cn(
              'flex h-[56px] min-w-[64px] shrink-0 items-center justify-center rounded-tile border px-2 text-[11px] font-semibold',
              place === null ? 'border-foreground' : 'border-border hover:bg-muted',
            )}
          >
            All notes
          </button>
          {slides.map((s, i) => (
            <button
              key={`${s.url}-${i}`}
              type="button"
              aria-pressed={place === s.url}
              aria-label={`Notes on file ${i + 1}`}
              onClick={() => setAt(s.url)}
              className={cn(
                'relative h-[56px] w-[46px] shrink-0 overflow-hidden rounded-tile bg-foreground/[0.06]',
                place === s.url && 'outline outline-2 outline-offset-2 outline-accent-blue',
              )}
            >
              <Thumb slide={s} label={s.name} className="h-full w-full" />
              <span className="absolute left-0.5 top-0.5 rounded-full bg-ink/70 px-1 text-[10px] font-bold text-cream">{i + 1}</span>
              {(counts.get(i + 1) ?? 0) > 0 && (
                <span className="absolute bottom-0.5 right-0.5 rounded-full bg-accent-blue px-1 text-[10px] font-bold text-ink">
                  {counts.get(i + 1)}
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {place && index >= 0 && (
        <button type="button" onClick={() => setZoom({ slide: slides[index], caption: `Slide ${index + 1} — as it is now` })}
          aria-label={`See slide ${index + 1} bigger`}
          className="group relative self-start overflow-hidden rounded-tile border border-border">
          <Thumb slide={slides[index]} label={slides[index].name} className="h-44 w-[141px]" />
          <span className="absolute inset-x-0 bottom-0 bg-ink/60 px-1.5 py-0.5 text-center text-[11px] font-semibold text-cream opacity-0 transition-opacity group-hover:opacity-100">Click to enlarge</span>
        </button>
      )}

      <ul className="flex flex-col gap-1.5">
        {shown.length === 0 && (
          <li className="text-[12px] text-muted-foreground">
            {place ? `No ${thread} notes on slide ${index + 1} yet.` : `No ${thread} notes yet.`}
          </li>
        )}
        {shown.map(({ note: n, slide, replaced }) => (
          <li key={n.id} data-note-replaced={replaced || undefined}
            className={cn('rounded-tile bg-paper px-2.5 py-1.5 text-[13px]', replaced && 'opacity-60')}>
            <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              {slide == null ? 'Whole post' : `Slide ${slide}`}
              {replaced && ' · on the earlier slide, since replaced'}
            </span>
            <span className="block">
              <span className="font-semibold">{n.author_name ?? 'Someone'}</span>
              {n.version != null && <span className="text-[11px] text-muted-foreground"> · version {n.version}</span>}
            </span>
            <p className="whitespace-pre-wrap">{n.body}</p>
            {replaced && n.file_url && (
              <button type="button" onClick={() => setZoom({ slide: earlier(n.file_url!, slide), caption: `Slide ${slide ?? ''} — the earlier one this note was written on` })}
                className="mt-1 flex items-center gap-2 text-[12px] font-semibold underline-offset-2 hover:underline">
                <span className="h-10 w-8 overflow-hidden rounded border border-border"><Thumb slide={earlier(n.file_url, slide)} className="h-full w-full" /></span>
                See the earlier slide
              </button>
            )}
          </li>
        ))}
      </ul>

      <label className="flex flex-col gap-1">
        <span className="sr-only">New note</span>
        <textarea
          value={text}
          onChange={e => setText(e.target.value)}
          rows={2}
          placeholder={place ? `A note on slide ${index + 1}` : 'A note on the whole post'}
          className="w-full resize-y rounded-inner border border-border bg-surface p-2 text-[13px] outline-none"
        />
      </label>
      {problem && <p role="alert" className="text-[12px] font-medium text-accent-red-deep">{problem}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={busy || !text.trim()}
          onClick={() => void add()}
          className="min-h-11 rounded-full bg-foreground px-4 text-[13px] font-semibold text-background disabled:opacity-50"
        >
          {busy ? 'Adding…' : thread === 'client' ? 'Add to the client thread' : 'Add team note'}
        </button>
        {thread === 'client' && <span className="text-[12px] font-medium text-foreground">The client sees this note.</span>}
      </div>
      {zoom && (
        <div role="dialog" aria-modal="true" aria-label={zoom.caption} onClick={() => setZoom(null)}
          className="fixed inset-0 z-[70] flex flex-col items-center justify-center gap-3 bg-ink/85 p-4">
          <button type="button" aria-label="Close" onClick={() => setZoom(null)}
            className="absolute right-4 top-4 flex h-11 w-11 items-center justify-center rounded-full bg-cream/15 text-cream hover:bg-cream/25">
            <X className="h-5 w-5" aria-hidden />
          </button>
          {zoom.slide.type === 'video'
            ? <video src={zoom.slide.url} controls className="max-h-[80vh] max-w-full rounded-inner" onClick={e => e.stopPropagation()} />
            // eslint-disable-next-line @next/next/no-img-element
            : <img src={zoom.slide.url} alt={zoom.caption} className="max-h-[80vh] max-w-full rounded-inner object-contain" />}
          <p className="text-[13px] font-medium text-cream">{zoom.caption}</p>
        </div>
      )}
    </section>
  )
}
