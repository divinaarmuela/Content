'use client'

import { useMemo } from 'react'
import Link from 'next/link'
import { ExternalLink, MessageCircle } from 'lucide-react'
import { useTable } from '@/lib/db-client'
import type { PostAnalytic } from '@/lib/db-types'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import PlatformIcon from '../../PlatformIcon'
import PageTitle from '../../../ui/PageTitle'
import Chip from '../../../ui/Chip'
import SlideCarousel from '../../../../components/media/SlideCarousel'
import type { PostPageData } from '../../../../lib/post-page'
import {
  compactCount, metricsPending, updatedAgo,
} from '../../../../lib/post-analytics-core'
import {
  followersLine, followersNote, hasNumbers, noNumbersLine, readPerformance, shownFollowers,
  type PostPerformance,
} from '../../../../lib/post-performance-core'
import {
  analyticsForPost, channelExtraLines, clientTone, inboxHref, networkName,
  NO_COMMENTS_LINE, postPageStatus,
} from '../../../../lib/post-page-core'
import { formatWithZone } from '../../../../lib/timezone-core'
import { jobWords } from '../../../../lib/publish-activity-core'
import type { PublishJob } from '../../../../lib/publish-activity-core'
import DayGraph from './DayGraph'
import { postedAt } from '../../../../lib/portal-core'

/**
 * ONE POST, ON ITS OWN PAGE.
 *
 * The owner asked for an address per post — something you can send somebody —
 * showing everything about a post that went out through the board, and asked
 * for it to be automatic: nobody presses anything after posting, and the page
 * only reads what the scheduled jobs have already written.
 *
 * So the page NEVER FETCHES. The server handed it the post, the card, the
 * channels and the cached rows; from there it subscribes to those rows
 * (`post_analytics` for this card), and everything
 * on screen moves when a sweep writes. There is no refresh button because
 * there is nothing for a person to do.
 *
 * Read in the order somebody asks: what is this and where did it go, what
 * was posted, how did it do, and who commented.
 */
export default function PostView({ data }: { data: PostPageData }) {
  const { post, item, client, channels, jobs } = data

  // LIVE: the card's cached rows. The server's copy draws the first frame, so
  // the page is never blank while the listener connects.
  const byItem = useMemo(() => ({ item_id: item.id }), [item.id])
  const { rows: liveRows, loading } = useTable<PostAnalytic>('post_analytics', { by: byItem })
  const rows = useMemo(() => {
    const mine = analyticsForPost(liveRows, { item_id: item.id, publish_job_ids: post.publish_job_ids })
    return mine.length > 0 ? mine : data.analytics
  }, [liveRows, item.id, post.publish_job_ids, data.analytics])

  const main = rows[0] ?? null
  const performance: PostPerformance | null = readPerformance(main?.performance)
  const platform = main?.platform ?? channels[0]?.platform ?? null
  const tz = client.timezone

  const failed = jobs.find(j => j.status === 'failed') ?? null
  const failure = failed ? jobWords(failed as unknown as PublishJob).detail : null
  // when it went out: the analytics, the job, or the post's own per-network record — never `sent_at`,
  // which the new engine does not write (review fix, 29 Sep 2026)
  const st = post.state
  const outAt = st && (st.stage === 'posted' || Object.keys(st.outcomes).length > 0) ? postedAt(st) : null
  const wentOut = main?.published_at ?? jobs.find(j => j.published_at)?.published_at ?? outAt ?? null
  const dueAt = post.scheduled_for ?? null
  const whenLabel = wentOut
    ? formatWithZone(wentOut, tz, 'long')
    : dueAt ? formatWithZone(dueAt, tz, 'long') : null
  // the words come from the post's STAGE (decision 12) — no old status word is read or made
  const status = postPageStatus(st, { whenLabel, failure, wentOut: !!wentOut || rows.length > 0 })
  const links = [
    ...rows.map(r => r.platform_post_url).filter((u): u is string => Boolean(u)),
    ...jobs.map(j => j.permalink).filter((u): u is string => Boolean(u)),
  ].filter((u, i, all) => all.indexOf(u) === i)

  const pending = metricsPending(main)
  const numbers = performance && hasNumbers(performance) && !pending


  return (
    <div className="flex flex-col gap-4 pb-10">
      <PageTitle
        title={item.title}
        summary={data.card_gone
          ? 'The card this post was made from has been deleted. What went out, and how it did, is kept here.'
          : (status.detail ?? 'Everything about this post, in one place.')}
      />

      {/* ── where it went, and where it got to ─────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2">
        <Chip tone={clientTone(client.id)}>{client.name}</Chip>
        <Chip tone={status.tone === 'red-outline' ? 'red' : status.tone === 'ink' ? 'ink' : status.tone}>
          {status.headline}
        </Chip>
        {channels.map(c => (
          <Chip key={c.account_id} tone="surface">
            <PlatformIcon platform={c.platform} size={12} />
            {c.name?.trim() || (c.username ? `@${c.username}` : networkName(c.platform))}
          </Chip>
        ))}
        {whenLabel && <Chip tone="muted">{whenLabel}</Chip>}
      </div>

      {links.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          {links.map(url => (
            <a key={url} href={url} target="_blank" rel="noreferrer noopener"
              className="inline-flex min-h-11 items-center gap-1.5 text-body-15 font-semibold underline-offset-4 hover:underline">
              <ExternalLink className="h-3.5 w-3.5" /> See the live post
            </a>
          ))}
        </div>
      )}

      {/* ── the post itself ────────────────────────────────────────────── */}
      <Card>
        <CardHeader><CardTitle>The post</CardTitle></CardHeader>
        <CardContent className="flex flex-col gap-4 pt-0">
          <PostMedia slides={post.slides} title={item.title} />
          {post.caption?.trim()
            ? <p className="whitespace-pre-line text-body-15">{post.caption}</p>
            : <p className="text-body-15 text-muted-foreground">No caption.</p>}
          <ChannelSettings post={post} channels={channels} />
        </CardContent>
      </Card>

      {/* ── how it did ─────────────────────────────────────────────────── */}
      <Card>
        <CardHeader><CardTitle>How it did</CardTitle></CardHeader>
        <CardContent className="flex flex-col gap-4 pt-0">
          {!numbers ? (
            <p className="text-body-15 text-muted-foreground">
              {loading && rows.length === 0 ? 'Checking…' : noNumbersLine(platform)}
            </p>
          ) : (
            <Numbers p={performance!} />
          )}

          {numbers && performance!.timeline.series.length > 1 && (
            <DayGraph series={performance!.timeline.series} days={performance!.timeline.days} />
          )}

          {rows.length > 1 && (
            <div className="flex flex-col gap-2">
              <h3 className="text-secondary-13 font-semibold">Channel by channel</h3>
              <ul className="flex flex-col gap-1.5">
                {rows.map(r => {
                  const p = readPerformance(r.performance)
                  const total = p?.interactions.total ?? null
                  return (
                    <li key={r.id} className="flex flex-wrap items-center gap-2 text-body-15">
                      <span className="inline-flex items-center gap-1.5 font-medium">
                        <PlatformIcon platform={String(r.platform ?? '')} size={14} />
                        {networkName(r.platform)}
                      </span>
                      <span className="text-muted-foreground">
                        {total === null
                          ? 'nothing counted yet'
                          : `${compactCount(total)} ${total === 1 ? 'interaction' : 'interactions'}`}
                      </span>
                    </li>
                  )
                })}
              </ul>
            </div>
          )}

          {main?.synced_at && (
            <p className="text-secondary-13 text-muted-foreground" suppressHydrationWarning>
              {updatedAgo(main.synced_at)}
            </p>
          )}
        </CardContent>
      </Card>

      {/* ── who commented ─────────────────────────────────────────────── */}
      <Card>
        <CardHeader><CardTitle>Comments</CardTitle></CardHeader>
        <CardContent className="flex flex-col gap-5 pt-0">
          <Commented p={performance} />
        </CardContent>
      </Card>
    </div>
  )
}

/* ── the media ─────────────────────────────────────────────────────────── */

/**
 * What was posted, at full size.
 *
 * A carousel is the composer's own viewer, so the page shows the post the way
 * the calendar's preview and the client's page already do. A single clip
 * plays by itself and silently, like a reference clip on a board: the point
 * of a post's page is to see the post, and a still of a Reel is not the post.
 */
function PostMedia({ slides, title }: { slides: { url: string; name: string; type: string }[]; title: string }) {
  if (slides.length === 0) {
    return <p className="text-body-15 text-muted-foreground">No pictures on this one — the words are the post.</p>
  }
  const only = slides.length === 1 ? slides[0] : null
  if (only && only.type === 'video') {
    return (
      // eslint-disable-next-line jsx-a11y/media-has-caption
      <video
        src={only.url}
        autoPlay muted loop playsInline controls
        aria-label={title}
        className="max-h-[70vh] w-full rounded-inner bg-black object-contain"
      />
    )
  }
  return (
    <SlideCarousel
      slides={slides.map(s => ({ url: s.url, name: s.name, type: s.type === 'video' ? 'video' : 'image' }))}
      aspect="natural"
      mode="full"
      className="overflow-hidden rounded-inner"
      label={`${title}${slides.length > 1 ? ` — ${slides.length} slides` : ''}`}
    />
  )
}

/* ── the per-channel extras ────────────────────────────────────────────── */

function ChannelSettings({ post, channels }: {
  post: PostPageData['post']
  channels: PostPageData['channels']
}) {
  const blocks = channels
    .map(c => ({
      channel: c,
      caption: post.per_channel[c.account_id]?.caption?.trim() || null,
      lines: channelExtraLines(post.per_channel[c.account_id], c.platform),
    }))
    .filter(b => b.caption || b.lines.length > 0)
  if (blocks.length === 0) return null
  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-secondary-13 font-semibold">Set differently on some channels</h3>
      {blocks.map(b => (
        <div key={b.channel.account_id} className="flex flex-col gap-1.5 rounded-tile border border-border p-3">
          <span className="inline-flex items-center gap-1.5 text-body-15 font-medium">
            <PlatformIcon platform={b.channel.platform} size={14} />
            {b.channel.name?.trim() || networkName(b.channel.platform)}
          </span>
          {b.caption && (
            <p className="whitespace-pre-line text-body-15 text-muted-foreground">{b.caption}</p>
          )}
          <ul className="flex flex-col gap-0.5">
            {b.lines.map(l => (
              <li key={l.field} className="flex flex-wrap gap-x-2 text-secondary-13">
                <span className="text-muted-foreground">{l.label}</span>
                <span className="font-medium text-foreground">{l.value}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  )
}

/* ── the numbers ───────────────────────────────────────────────────────── */

function Numbers({ p }: { p: PostPerformance }) {
  const total = p.interactions.total
  const followers = shownFollowers(p)
  const fLine = followersLine(followers)
  const fNote = followersNote(followers)
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="text-[44px] font-semibold leading-none tracking-tight">
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
        </div>
      ) : (
        <p className="text-secondary-13 text-muted-foreground">
          Followers since this post: not tracked yet — the account&rsquo;s daily count arrives from tomorrow.
        </p>
      )}
    </div>
  )
}

/* ── the comments ──────────────────────────────────────────────────────── */

function Commented({ p }: { p: PostPerformance | null }) {
  const comments = p?.comments ?? []
  return (
    <section className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <MessageCircle className="h-4 w-4 text-muted-foreground" />
        <h3 className="text-secondary-13 font-semibold">Who commented</h3>
        {comments.length > 0 && (
          <Button size="sm" variant="ghost" className="ml-auto" asChild>
            <Link href={inboxHref(p?.provider_post_id)}>Reply <ExternalLink className="h-3.5 w-3.5" /></Link>
          </Button>
        )}
      </div>
      {comments.length === 0 ? (
        <p className="text-body-15 text-muted-foreground">{NO_COMMENTS_LINE}</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {comments.map(c => (
            <li key={c.id} className="flex flex-col gap-0.5 rounded-tile bg-foreground/[0.04] px-3 py-2">
              <span className="flex flex-wrap items-baseline gap-x-2 text-body-15">
                <span className="font-semibold">@{c.author}</span>
                {c.at && (
                  <span className="text-secondary-13 text-muted-foreground" suppressHydrationWarning>
                    {updatedAgo(c.at)}
                  </span>
                )}
              </span>
              <span className="text-body-15">{c.text}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
