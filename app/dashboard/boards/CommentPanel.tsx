'use client'

import { useEffect, useState } from 'react'
import { Check, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { roleLabel } from '@/app/lib/identity-core'
import {
  commentsFor, KIND_LABEL, plainText, whenLabel, type CanvasComment, type ItemKind,
} from '@/app/lib/board-canvas-core'
import type { LiveItem } from './useBoard'

/**
 * The comments on ONE item — who, when, and the words — with a box to add
 * one. Never a thread for the whole board: the panel opens for the item
 * that was picked and says which one at the top. What is in the list has
 * already been filtered for this viewer's role, so a client's comment is
 * here for the account manager and absent for an editor.
 */
export default function CommentPanel({ item, comments, onAdd, onResolve, onClose, className }: {
  item: LiveItem
  comments: CanvasComment[]
  onAdd: (body: string) => Promise<boolean>
  onResolve: (id: string) => Promise<void>
  onClose: () => void
  className?: string
}) {
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const mine = commentsFor(item.id, comments)
  useEffect(() => { setDraft('') }, [item.id])

  const send = async () => {
    const body = draft.trim()
    if (!body) return
    setBusy(true)
    const ok = await onAdd(body)
    setBusy(false)
    if (ok) setDraft('')
  }

  return (
    <aside className={cn('flex flex-col rounded-card border border-border bg-popover text-popover-foreground shadow-lg', className)} aria-label="Comments" data-no-drag>
      <div className="flex items-start gap-2 border-b border-border px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">Comments on this {KIND_LABEL[item.kind as ItemKind].toLowerCase()}</p>
          <p className="truncate text-[15px] font-semibold">{itemTitle(item)}</p>
        </div>
        <button type="button" onClick={onClose} aria-label="Close comments" className="-mr-2 -mt-1 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full hover:bg-foreground/[0.06]">
          <X className="h-4 w-4" />
        </button>
      </div>
      <ol className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-3">
        {mine.length === 0 && (
          <li className="py-6 text-center text-[13px] text-muted-foreground">Nothing yet. Say what you think of this one.</li>
        )}
        {mine.map(c => (
          <li key={c.id} className={cn('rounded-inner bg-paper px-3 py-2.5', c.resolved_at && 'opacity-60')}>
            <div className="flex items-baseline gap-2">
              <span className="text-[13px] font-semibold">{c.author_name}</span>
              <span className="text-[12px] text-muted-foreground">{roleLabel(c.author_role)} · {whenLabel(c.created_at)}</span>
            </div>
            <p className="mt-1 whitespace-pre-wrap text-[14px] leading-[1.45]">{c.body}</p>
            {c.resolved_at ? (
              <p className="mt-1 text-[12px] text-muted-foreground">Done</p>
            ) : (
              <button type="button" onClick={() => void onResolve(c.id)} className="mt-1 inline-flex h-9 items-center gap-1 rounded-full px-2 text-[12px] font-semibold hover:bg-foreground/[0.06] [@media(pointer:coarse)]:h-11">
                <Check className="h-3.5 w-3.5" /> Mark done
              </button>
            )}
          </li>
        ))}
      </ol>
      <form className="flex flex-col gap-2 border-t border-border px-4 py-3" onSubmit={e => { e.preventDefault(); void send() }}>
        <Textarea
          value={draft}
          onChange={e => setDraft(e.target.value)}
          placeholder="Write a comment…"
          rows={2}
          maxLength={4000}
          onKeyDown={e => {
            e.stopPropagation()
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); void send() }
          }}
        />
        <div className="flex justify-end">
          <Button type="submit" size="sm" disabled={busy || !draft.trim()}>{busy ? 'Sending…' : 'Comment'}</Button>
        </div>
      </form>
    </aside>
  )
}

/** The words a person would use to say which item this is. */
export function itemTitle(item: LiveItem): string {
  switch (item.kind as ItemKind) {
    case 'note': return plainText(item.text ?? '').split('\n')[0] || 'Untitled note'
    case 'heading': return item.text ?? 'Heading'
    case 'column': return item.column_title ?? 'Column'
    case 'link': return item.label ?? item.url ?? 'Link'
    case 'board': return item.label ?? 'Board'
    case 'image': return item.label ?? 'Image'
  }
}
