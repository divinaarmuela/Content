'use client'

import Link from 'next/link'
import { clientTone } from '../../../lib/post-page-core'
import { makePostHref } from '../../../lib/post-board-core'
import { SCHEDULE_PAGE } from '../../../lib/page-access-core'
import type { LiveItem } from '../../useLiveWork'
import Chip from '../../ui/Chip'

/**
 * EDITS READY TO BECOME POSTS (SPEC §4.2) — above the board, not a lane.
 *
 * The old board put edit cards in its Draft lane beside real posts, so an
 * edit still being revised sat there looking like a post (audit B3, L5). An
 * edit is only where a post's files come from: it is listed here once it is
 * approved for posting (or handed to a scheduler to post) and no post has
 * been made from it yet, with one button
 * that opens the composer on it. Its name opens the edit itself.
 */
export default function SourceTray({ items, onOpenEdit, nameOf }: {
  items: readonly LiveItem[]
  /** open the edit card beside the board */
  onOpenEdit: (id: string) => void
  nameOf: (id: string | null | undefined) => string | null
}) {
  if (items.length === 0) return null
  return (
    <section aria-label="Edits ready to become posts" className="flex flex-col gap-2.5 rounded-card border border-border bg-surface px-4 py-3.5">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <h2 className="text-[15px] font-semibold">Edits ready to become posts · {items.length}</h2>
        <p className="text-[13px] text-muted-foreground">Approved edits with no post yet. Make a post to send it for quality check.</p>
      </div>
      <ul className="flex flex-col gap-2">
        {items.map(i => (
          <li key={i.id} className="flex flex-col gap-2 rounded-inner border border-border bg-background px-3 py-2 sm:flex-row sm:items-center">
            <button type="button" onClick={() => onOpenEdit(i.id)}
              className="flex min-h-11 min-w-0 flex-1 flex-wrap items-center gap-2 text-left underline-offset-4 hover:underline">
              <Chip tone={clientTone(i.client_id)}>{i.clients?.name ?? 'Client'}</Chip>
              <span className="min-w-0 break-words text-[14px] font-semibold">{i.title}</span>
              {Array.isArray(i.scheduler_ids) && i.scheduler_ids.length > 0 && (
                <Chip tone="green">Handed to {(i.scheduler_ids as unknown[]).map(id => nameOf(String(id)) ?? 'a scheduler').join(', ')}</Chip>
              )}
            </button>
            <Link href={makePostHref(i, SCHEDULE_PAGE)}
              className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-full bg-foreground px-4 text-[13px] font-semibold text-background hover:bg-foreground/90">
              Make a post
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}
