'use client'

import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { clientTone } from '../../lib/post-page-core'
import { postWindowHref } from '../../lib/post-board-core'
import { SCHEDULE_PAGE } from '../../lib/page-access-core'
import {
  postOthersLabel, postWaitingTitle, type PostWaitingRow,
} from '../../lib/post-waiting-core'
import type { OfferedAction, PostState } from '../../lib/post-stage-core'
import Chip from '../ui/Chip'
import TintCard from '../ui/TintCard'

/**
 * WAITING ON YOU — every post somebody is held up by, above the board.
 *
 * The rows are POSTS, read off their stage (`post-waiting-core`, which reads
 * `waitingOn` — the same line the card says). A post the client asked to
 * change is on the named person's list (audit B8); a post with the client is
 * shown, folded, as the client's — never as the manager's to approve (audit
 * W5, B7). "since" is when the post entered its stage (audit B14).
 *
 * The buttons are the card's own (`boardActions`) and press through the same
 * handler as the board, so a row never offers what the server would refuse.
 * Hidden entirely when nothing is waiting.
 */
export default function WaitingOnYou({ rows, busyId, errorFor, onPress }: {
  rows: readonly PostWaitingRow[]
  busyId: string | null
  errorFor: (id: string) => string | null
  onPress: (post: PostState, action: OfferedAction) => void
}) {
  if (rows.length === 0) return null
  const yours = rows.filter(r => r.onYou)
  const others = rows.filter(r => !r.onYou)
  const item = (row: PostWaitingRow) => (
    <li key={row.id}>
      <WaitingItem row={row} busy={busyId === row.id} error={errorFor(row.id)} onPress={onPress} />
    </li>
  )

  return (
    <TintCard tone={yours.length > 0 ? 'amber' : 'surface'} title={postWaitingTitle(rows)}>
      {yours.length > 0 && <ul className="flex flex-col gap-2.5">{yours.map(item)}</ul>}
      {others.length > 0 && (
        // what is out with somebody else: counted and one press away, never in
        // front of the things this person can actually answer
        <details open={yours.length === 0} className="group">
          <summary className="inline-flex min-h-11 cursor-pointer list-none items-center text-[13px] font-semibold text-foreground underline-offset-4 hover:underline">
            {postOthersLabel(others)}
            <span aria-hidden className="ml-1.5 transition-transform group-open:rotate-90">›</span>
          </summary>
          <ul className="flex flex-col gap-2.5 pt-1.5">{others.map(item)}</ul>
        </details>
      )}
    </TintCard>
  )
}

/** One row: the client, the post, who it waits on and since when — and the answers. */
function WaitingItem({ row, busy, error, onPress }: {
  row: PostWaitingRow
  busy: boolean
  error: string | null
  onPress: (post: PostState, action: OfferedAction) => void
}) {
  const { face } = row
  const blocked = row.actions[0]?.blocked ?? null
  return (
    <div className="flex flex-col gap-2.5 rounded-inner border border-border bg-surface p-3 sm:flex-row sm:items-center sm:gap-3">
      <Link href={postWindowHref(row.post, SCHEDULE_PAGE)}
        className="flex min-w-0 flex-1 flex-col gap-1.5 text-left underline-offset-4 hover:underline">
        <span className="flex flex-wrap items-center gap-2">
          <Chip tone={clientTone(face.clientId)}>{face.client}</Chip>
          <span className="min-w-0 break-words text-[15px] font-semibold text-foreground">{face.title}</span>
          <Chip tone={face.stage.tone}>{face.stage.label}</Chip>
          {face.missed && <Chip tone="red">{face.missed}</Chip>}
        </span>
        <span className="text-[13px] text-muted-foreground">
          {face.waiting.line}
          {face.waiting.sinceWords && <span className="whitespace-nowrap"> · {face.waiting.sinceWords}</span>}
        </span>
        {face.changes && <span className="text-[13px] text-foreground">{face.changes}</span>}
      </Link>
      {row.actions.length > 0 && (
        <div className="flex shrink-0 flex-col gap-1.5 sm:items-end">
          <div className="flex flex-wrap gap-2">
            {row.actions.map((a, i) => (
              <Button
                key={a.action}
                variant={i === 0 ? 'default' : 'outline'}
                disabled={busy || !!a.blocked}
                title={a.blocked ?? undefined}
                onClick={() => onPress(row.post, a)}
                className={i === 0
                  ? 'h-auto min-h-11 whitespace-normal rounded-full px-4 py-2 text-[13px] font-semibold'
                  : 'h-auto min-h-11 whitespace-normal rounded-full border-border bg-surface px-4 py-2 text-[13px] font-semibold'}
              >
                {busy && i === 0 ? 'Working…' : a.label}
              </Button>
            ))}
          </div>
          {(error || blocked) && <p role={error ? 'alert' : undefined} className="max-w-xs text-[12px] font-medium text-foreground">{error ?? blocked}</p>}
        </div>
      )}
    </div>
  )
}
