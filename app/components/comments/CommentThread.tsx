'use client'

import { CheckCircle2, CircleDashed } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { formatInZone } from '../../lib/timezone-core'

/** One comment as the item API sends it. */
export type ThreadComment = {
  id: string
  created_at: string
  author_id: string | null
  author_name?: string | null
  visibility: string
  body: string
  resolved: boolean
  /** the person this note is for — tagged with "@Name" */
  assigned_to?: string | null
}

/**
 * The comment list, purely presentational — the SAME rows the item page
 * draws, extracted so the board drawer and the page can never drift apart:
 * the check/dashed-circle resolve button (a 44px target), the amber "this
 * one is for you" tint, "Waiting on you / Waiting on {name}", and the
 * "visible to client" badge for team eyes.
 *
 * No fetching here: whoever renders it hands over the comments the server
 * already filtered for this viewer, and handles the resolve click.
 */
export default function CommentThread({
  comments, viewerId, viewerTz, isTeam, nameOf, onToggleResolved, emptyText,
}: {
  comments: ThreadComment[]
  /** the reader — "Waiting on you" is said to them, not about them */
  viewerId: string | null | undefined
  /** the reader's zone; timestamps on what people DID belong to their clock */
  viewerTz: string | null
  /** team members may resolve and see visibility badges; clients see neither */
  isTeam: boolean
  /** a display name for a user id, when the roster is loaded */
  nameOf: (uid: string) => string | null
  onToggleResolved: (c: ThreadComment) => void
  emptyText?: string
}) {
  if (comments.length === 0) {
    return (
      <p className="text-body-15 text-muted-foreground">
        {emptyText
          ?? 'No comments yet. Type @ and a name to ask someone something — they get an email and it stays on their list until it is marked done.'}
      </p>
    )
  }
  return (
    <>
      {comments.map(c => {
        const forMe = c.assigned_to === viewerId
        const forName = c.assigned_to ? nameOf(c.assigned_to) : null
        return (
          <div key={c.id} className={`flex items-start gap-2.5 rounded-inner border px-3 py-2 ${
            forMe && !c.resolved ? 'border-accent-amber/35 bg-tint-amber' : 'border-border'
          }`}>
            <button onClick={() => isTeam && onToggleResolved(c)} disabled={!isTeam}
              aria-label={c.resolved ? 'Reopen' : 'Mark done'} title={c.resolved ? 'Reopen' : 'Mark done'}
              className="-m-2 flex h-11 w-11 shrink-0 items-center justify-center">
              {c.resolved
                ? <CheckCircle2 className="h-4 w-4 text-accent-green" />
                : <CircleDashed className="h-4 w-4 text-muted-foreground" />}
            </button>
            <div className="min-w-0 flex-1">
              <p className={`whitespace-pre-wrap text-body-15 ${c.resolved ? 'text-muted-foreground line-through' : ''}`}>{c.body}</p>
              <p className="mt-0.5 flex flex-wrap items-center gap-2 text-[12px] text-muted-foreground">
                {c.author_name && <span className="text-muted-foreground">{c.author_name}</span>}
                <span suppressHydrationWarning>{viewerTz ? formatInZone(c.created_at, viewerTz, 'short') : ''}</span>
                {c.assigned_to && !c.resolved && (
                  <span className="rounded-full bg-tint-amber px-2.5 py-1.5 text-chip-12 font-medium text-foreground">
                    {forMe ? 'Waiting on you' : `Waiting on ${forName ?? 'someone'}`}
                  </span>
                )}
                {isTeam && c.visibility === 'client' && (
                  <Badge variant="outline" className="border-accent-blue/25 bg-tint-blue font-normal text-accent-blue-deep">visible to client</Badge>
                )}
              </p>
            </div>
          </div>
        )
      })}
    </>
  )
}
