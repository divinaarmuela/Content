'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { ExternalLink, MessageCircle } from 'lucide-react'
import { useTable } from '@/lib/db-client'
import type { PostAnalytic } from '@/lib/db-types'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import Sparkline from '../../../components/Sparkline'
import Chip from '../../ui/Chip'
import { compactCount, metricsPending, updatedAgo } from '../../../lib/post-analytics-core'
import {
  followersLine, followersNote, hasNumbers, noNumbersLine, readPerformance, shownFollowers,
  type PostPerformance,
} from '../../../lib/post-performance-core'
import type { PostPerformanceResponse } from '../../../api/social/post-performance/route'
import { fromThisPostLine, readInteractors, type FollowedFromPost } from '../../../lib/followers-core'

/**
 * HOW IT DID — the section on a posted card.
 *
 * The owner's question, answered in the order they asked it: did anyone
 * interact (the big number, then what kind), how many people it reached, is
 * it still growing (the sparkline), did the account gain followers since
 * (with the window it was counted over), and who said what (the latest
 * comments, with a way to answer them in the Inbox).
 *
 * LIVE: the numbers come off the post's cached row through a database
 * listener, so they change on the card the moment the sweep writes them.
 * One request to `/api/social/post-performance` on open nudges a stale row
 * to refresh and learns whether a provider is connected at all — the words
 * for "nothing yet" depend on that. The section never shows an error and
 * never goes blank: with nothing to show, it says so and why.
 */
export default function HowItDid({ itemId, platformHint, compact = false }: {
  itemId: string
  /** the platform the card was scheduled for, when the cache has none yet */
  platformHint?: string | null
  /** in the side panel: tighter spacing, the same content */
  compact?: boolean
}) {
  const byItem = useMemo(() => ({ item_id: itemId }), [itemId])
  const { rows, loading } = useTable<PostAnalytic>('post_analytics', { by: byItem })
  const row = useMemo(() => {
    const sorted = [...rows].sort((a, b) => (b.published_at ?? '').localeCompare(a.published_at ?? ''))
    return sorted[0] ?? null
  }, [rows])

  const [asked, setAsked] = useState<PostPerformanceResponse | null>(null)
  useEffect(() => {
    let stopped = false
    const ask = async () => {
      try {
        const res = await fetch(`/api/social/post-performance?item=${encodeURIComponent(itemId)}`, { cache: 'no-store' })
        if (!res.ok || stopped) return
        setAsked(await res.json() as PostPerformanceResponse)
      } catch { /* the listener still draws whatever is cached */ }
    }
    void ask()
    return () => { stopped = true }
  }, [itemId])

  // the live row wins; the route's answer fills in while the listener connects
  const performance: PostPerformance | null = row
    ? readPerformance(row.performance)
    : asked?.performance ?? null
  const platform = row?.platform ?? asked?.platform ?? platformHint ?? null
  const postUrl = row?.platform_post_url ?? asked?.post_url ?? null
  const syncedAt = row?.synced_at ?? asked?.synced_at ?? null
  const pending = row ? metricsPending(row) : asked ? asked.pending : true
  const configured = asked ? asked.configured : true

  const body = (
    <div className={`flex flex-col ${compact ? 'gap-3' : 'gap-4'}`}>
      {!performance || !hasNumbers(performance) || pending ? (
        <p className="text-body-15 text-muted-foreground">
          {loading && !asked
            ? 'Checking…'
            : !configured
              ? 'No numbers yet — the posting account is not connected. Connect it under Social to see how posts do.'
              : noNumbersLine(platform)}
        </p>
      ) : (
        <Numbers p={performance} compact={compact} followed={readInteractors(row?.interactors)?.followed ?? []} />
      )}

      {performance && performance.comments.length > 0 && (
        <Comments p={performance} compact={compact} />
      )}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-secondary-13 text-muted-foreground">
        {syncedAt && <Ago iso={syncedAt} />}
        {postUrl && (
          <a href={postUrl} target="_blank" rel="noreferrer noopener"
            className="inline-flex min-h-11 items-center gap-1 font-medium text-foreground underline-offset-4 hover:underline md:min-h-0">
            See the live post <ExternalLink className="h-3.5 w-3.5" />
          </a>
        )}
      </div>
    </div>
  )

  if (compact) {
    return (
      <section aria-label="How it did" className="flex flex-col gap-2 rounded-tile border border-border bg-surface p-3">
        <h3 className="text-secondary-13 font-semibold">How it did</h3>
        {body}
      </section>
    )
  }
  return (
    <Card id="how-it-did" className="scroll-mt-4">
      <CardHeader>
        <CardTitle>How it did</CardTitle>
      </CardHeader>
      <CardContent className="pt-0">{body}</CardContent>
    </Card>
  )
}

function Numbers({ p, compact, followed }: { p: PostPerformance; compact: boolean; followed: FollowedFromPost[] }) {
  const total = p.interactions.total
  const followers = shownFollowers(p)
  const fLine = followersLine(followers)
  const fNote = followersNote(followers)
  const spark = p.timeline.series
  return (
    <div className={`grid gap-4 ${compact ? '' : 'md:grid-cols-[1fr_auto] md:items-start'}`}>
      <div className="flex min-w-0 flex-col gap-2.5">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className={`font-semibold leading-none tracking-tight ${compact ? 'text-[32px]' : 'text-[40px]'}`}>
            {total === null ? '—' : compactCount(total)}
          </span>
          <span className="text-body-15 text-muted-foreground">
            {total === null ? 'interactions not counted yet' : total === 1 ? 'person interacted' : 'people interacted'}
          </span>
        </div>
        {p.chips.length > 0 && (
          <ul className="flex flex-wrap gap-1.5" aria-label="What the platform counted">
            {p.chips.map(c => (
              <li key={c.key}>
                <Chip tone="muted">
                  <span className="font-semibold tabular-nums text-foreground">{compactCount(c.value)}</span>
                  <span className="ml-1">{c.label}</span>
                </Chip>
              </li>
            ))}
          </ul>
        )}
        {fLine ? (
          <div className="flex flex-col gap-0.5">
            <p className="text-body-15 font-medium">
              <span className={followers && followers.delta > 0 ? 'text-accent-green' : followers && followers.delta < 0 ? 'text-accent-red' : ''}>
                {fLine}
              </span>
            </p>
            {fNote && <p className="text-secondary-13 text-muted-foreground">{fNote}</p>}
            <FollowedFromThisPost followed={followed} />
          </div>
        ) : (
          <p className="text-secondary-13 text-muted-foreground">
            Followers since this post: not tracked yet — the account&rsquo;s daily count arrives from tomorrow.
          </p>
        )}
      </div>
      {spark.length > 0 && (
        <figure className={`flex flex-col gap-1 ${compact ? '' : 'md:items-end'}`}>
          <div className="text-accent-blue dark:text-accent-blue">
            <Sparkline points={spark} width={compact ? 160 : 200} height={44}
              label={`Interactions over ${p.timeline.days} ${p.timeline.days === 1 ? 'day' : 'days'}`} />
          </div>
          <figcaption className="text-secondary-13 text-muted-foreground">
            {p.timeline.days <= 1 ? 'Day one' : `Last ${Math.min(p.timeline.days, 30)} days`}
          </figcaption>
        </figure>
      )}
    </div>
  )
}

/**
 * "7 of them liked or commented on this post" — the people who followed on
 * or after the day this went up AND liked or commented on it. Faces in a
 * row, like the assignee avatars; a tap opens the names. Nothing when the
 * cross is empty: the sentence is only said when it is true.
 */
function FollowedFromThisPost({ followed }: { followed: FollowedFromPost[] }) {
  const line = fromThisPostLine(followed)
  if (!line) return null
  const faces = followed.slice(0, 8)
  return (
    <details className="group mt-1">
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 text-body-15 text-foreground [&::-webkit-details-marker]:hidden">
        <span className="flex -space-x-2" aria-hidden>
          {faces.map(f => f.profile_pic ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={f.username} src={f.profile_pic} alt="" className="h-7 w-7 rounded-full border-2 border-surface object-cover" loading="lazy" />
          ) : (
            <span key={f.username} className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-surface bg-foreground/[0.08] text-[11px] font-semibold">
              {f.username.slice(0, 1).toUpperCase()}
            </span>
          ))}
        </span>
        <span className="font-medium underline-offset-4 group-open:underline">{line}</span>
      </summary>
      <ul className="mt-2 flex flex-col gap-1">
        {followed.map(f => (
          <li key={f.username} className="flex min-h-11 items-center gap-2 text-body-15">
            <span className="font-medium">{f.full_name || f.username}</span>
            <span className="font-mono text-secondary-13 text-muted-foreground">@{f.username} · {f.how}</span>
          </li>
        ))}
      </ul>
    </details>
  )
}

function Comments({ p, compact }: { p: PostPerformance; compact: boolean }) {
  const inbox = p.provider_post_id
    ? `/dashboard/social/inbox?post=${encodeURIComponent(p.provider_post_id)}`
    : '/dashboard/social/inbox'
  const shown = compact ? p.comments.slice(0, 5) : p.comments
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <MessageCircle className="h-4 w-4 text-muted-foreground" />
        <span className="text-secondary-13 font-semibold">
          {p.comments.length === 1 ? 'Latest comment' : `Latest ${shown.length} comments`}
        </span>
        <Button size="sm" variant="ghost" className="ml-auto min-h-11 md:min-h-8" asChild>
          <Link href={inbox}>Reply in Inbox <ExternalLink className="h-3.5 w-3.5" /></Link>
        </Button>
      </div>
      <ul className="flex flex-col gap-1.5">
        {shown.map(c => (
          <li key={c.id} className="rounded-tile bg-foreground/[0.04] px-3 py-2 text-body-15">
            <span className="font-semibold">@{c.author}</span>{' '}
            <span className="text-foreground">{c.text}</span>
          </li>
        ))}
      </ul>
      {(p.comments.length > shown.length || p.comments.length >= 10) && (
        <Link href={inbox} className="text-secondary-13 font-medium underline-offset-4 hover:underline">
          See all in Inbox
        </Link>
      )}
    </div>
  )
}

/** "Updated 12 min ago", ticking — computed after mount so it never
 *  disagrees with the server's render. */
function Ago({ iso }: { iso: string }) {
  const [text, setText] = useState<string | null>(null)
  useEffect(() => {
    const tick = () => setText(updatedAgo(iso))
    tick()
    const t = setInterval(tick, 60_000)
    return () => clearInterval(t)
  }, [iso])
  return <span suppressHydrationWarning>{text ?? ''}</span>
}
