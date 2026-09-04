'use client'

import { useEffect, useRef, useState } from 'react'
import { Trash2 } from 'lucide-react'
import { formatInZone } from '@/app/lib/timezone-core'

/**
 * A note on the calendar, being written — or being read.
 *
 * Opens where it will live — in the column, at the time it is pinned to —
 * rather than in a window over the week, so the answer to "when is this note
 * about?" is where you are looking. It is a message between the team: it
 * never reaches a client and never goes to a channel, and the editor says so
 * once rather than making anybody wonder.
 *
 * Somebody who may not change this note gets it READ-ONLY, with the reason,
 * rather than a textarea that lets them type a paragraph and then refuses to
 * save it. The rule is the server's (`editNote`, `removeNote`): the person
 * who wrote it, or an account manager. Hiding a control is presentation — the
 * server still refuses — but offering one that will be refused is its own
 * small lie.
 *
 * Deleting asks first. The note is often the only record of a decision
 * ("client away until the 19th"), and one tap is not a decision.
 */
export default function NoteEditor({
  at, tz, text, canEdit, canDelete, busy, error, onSave, onDelete, onClose,
}: {
  /** the instant the note is pinned to */
  at: string
  tz: string
  /** the words it already has, or '' for a new one */
  text: string
  /** may this person change the words */
  canEdit: boolean
  canDelete: boolean
  busy: boolean
  error: string | null
  onSave: (text: string) => void
  onDelete?: () => void
  onClose: () => void
}) {
  const [draft, setDraft] = useState(text)
  const [confirming, setConfirming] = useState(false)
  const box = useRef<HTMLTextAreaElement | null>(null)
  const close = useRef<HTMLButtonElement | null>(null)
  useEffect(() => {
    // the editor is keyed on the note, so this runs for each note opened —
    // opening a second note does not leave the caret in the first one
    if (canEdit) box.current?.focus()
    else close.current?.focus()
  }, [canEdit])

  const when = formatInZone(at, tz, 'short') ?? ''
  const save = () => {
    const words = draft.trim()
    if (words && canEdit) onSave(words)
  }

  return (
    <div
      // the column under it opens the composer on a click and reads a time
      // off a drag; a note being written is neither
      onClick={e => e.stopPropagation()}
      onMouseDown={e => e.stopPropagation()}
      onPointerDown={e => e.stopPropagation()}
      onContextMenu={e => e.stopPropagation()}
      onKeyDown={e => {
        if (e.key === 'Escape') { e.stopPropagation(); onClose() }
        // Enter saves, Shift+Enter is a second line — a note is one line most
        // of the time and reaching for a button for four words is a chore
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); save() }
      }}
      className="flex w-full flex-col gap-1.5 rounded-tile border border-border bg-popover p-2 shadow-lg"
    >
      <span className="text-[11px] font-semibold text-muted-foreground">
        Note · {when} · only your team sees it
      </span>

      {canEdit ? (
        <textarea
          ref={box}
          value={draft}
          onChange={e => setDraft(e.target.value)}
          rows={2}
          maxLength={500}
          placeholder="What should the team know about this time?"
          aria-label="Note"
          className="w-full resize-none rounded-inner border border-border bg-surface px-2 py-1.5 text-[13px] outline-none focus-visible:border-accent-blue"
        />
      ) : (
        <>
          <p className="rounded-inner border border-border bg-surface px-2 py-1.5 text-[13px]">
            {text}
          </p>
          <span className="text-[11px] text-muted-foreground">
            Only the person who wrote this note, or an account manager, can change it.
          </span>
        </>
      )}

      {error && (
        <span className="rounded-inner border border-accent-red/40 bg-tint-red px-2 py-1 text-[11px] font-medium">
          {error}
        </span>
      )}

      {confirming ? (
        <div className="flex flex-col gap-1.5">
          <span className="text-[12px] font-semibold">Delete this note for everybody?</span>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="ml-auto min-h-11 rounded-full border border-border bg-surface px-3 text-[12px] font-semibold hover:bg-muted"
            >
              Keep it
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={onDelete}
              className="min-h-11 rounded-full bg-accent-red px-3 text-[12px] font-semibold text-cream disabled:opacity-60"
            >
              {busy ? 'Deleting…' : 'Yes, delete it'}
            </button>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-1.5">
          {canDelete && onDelete && (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              disabled={busy}
              aria-label="Delete this note"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-accent-red disabled:opacity-60"
            >
              <Trash2 className="h-4 w-4" strokeWidth={1.8} aria-hidden />
            </button>
          )}
          <button
            ref={close}
            type="button"
            onClick={onClose}
            className="ml-auto min-h-11 rounded-full border border-border bg-surface px-3 text-[12px] font-semibold hover:bg-muted"
          >
            {canEdit ? 'Cancel' : 'Close'}
          </button>
          {canEdit && (
            <button
              type="button"
              onClick={save}
              disabled={busy || draft.trim() === ''}
              className="min-h-11 rounded-full bg-foreground px-3 text-[12px] font-semibold text-background disabled:opacity-60"
            >
              {busy ? 'Saving…' : 'Save note'}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
