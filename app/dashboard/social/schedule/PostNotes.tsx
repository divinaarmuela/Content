'use client'

import { useMemo, useState } from 'react'
import { cn } from '@/lib/utils'
import {
  COMMENT_VISIBILITY_LABEL, DEFAULT_COMMENT_VISIBILITY, type CommentVisibility,
} from '@/app/lib/post-stage-core'
import { noteCounts, notesAt, type NoteInput, type PostNote } from '@/app/lib/post-window-core'
import type { Slide } from '@/app/lib/version-files-core'
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
  const [thread, setThread] = useState<CommentVisibility>(DEFAULT_COMMENT_VISIBILITY)
  const [at, setAt] = useState<string | null>(null)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const counts = useMemo(() => noteCounts(notes), [notes])
  const place = at && slides.some(s => s.url === at) ? at : null
  const shown = notesAt(notes, place, thread)
  const index = place ? slides.findIndex(s => s.url === place) : -1

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
              onClick={() => setThread(t)}
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
            Whole post
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
              {(counts.get(s.url) ?? 0) > 0 && (
                <span className="absolute bottom-0.5 right-0.5 rounded-full bg-accent-blue px-1 text-[10px] font-bold text-ink">
                  {counts.get(s.url)}
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      <ul className="flex flex-col gap-1.5">
        {shown.length === 0 && (
          <li className="text-[12px] text-muted-foreground">
            {place ? `No ${thread} notes on file ${index + 1} yet.` : `No ${thread} notes on the whole post yet.`}
          </li>
        )}
        {shown.map(n => (
          <li key={n.id} className="rounded-tile bg-paper px-2.5 py-1.5 text-[13px]">
            <span className="font-semibold">{n.author_name ?? 'Someone'}</span>
            {n.version != null && <span className="text-[11px] text-muted-foreground"> · version {n.version}</span>}
            <p className="whitespace-pre-wrap">{n.body}</p>
          </li>
        ))}
      </ul>

      <label className="flex flex-col gap-1">
        <span className="sr-only">New note</span>
        <textarea
          value={text}
          onChange={e => setText(e.target.value)}
          rows={2}
          placeholder={place ? `A note on file ${index + 1}` : 'A note on the whole post'}
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
    </section>
  )
}
