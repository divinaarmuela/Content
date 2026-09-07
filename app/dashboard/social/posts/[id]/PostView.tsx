'use client'

import { useMemo } from 'react'
import Link from 'next/link'
import { ExternalLink, MessageCircle } from 'lucide-react'
import { useTable } from '@/lib/db-client'
import type { FollowerSnapshot, PostAnalytic } from '@/lib/db-types'
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
  fromThisPostLine, readInteractors, type FollowedFromPost, type Interactor,
} from '../../../../lib/followers-core'
import {
  analyticsForPost, channelExtraLines, clientTone, inboxHref, likedLine, networkName,
  NAMES_PENDING_LINE, NO_COMMENTS_LINE, peopleFrom, postStatusWords, PRIVATE_ACCOUNT_NOTE,
  whoLikedNote,
} from '../../../../lib/post-page-core'
import { formatWithZone } from '../../../../lib/timezone-core'
import { jobWords } from '../../../../lib/publish-activity-core'
import type { PublishJob } from '../../../../lib/publish-activity-core'
import DayGraph from './DayGraph'

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
 * (`post_analytics` for this card) and to the follower looks, and everything
 * on screen moves when a sweep writes. There is no refresh button because
 * there is nothing for a person to do.
 *
 * Read in the order somebody asks: what is this and where did it go, what
 * was posted, how did it do, and who were the people.
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

  // LIVE: the follower looks, so "as of" moves when the morning read lands
  const byClient = useMemo(() => ({ client_id: client.id }), [client.id])
  const { rows: looks } = useTable<FollowerSnapshot>('follower_snapshots', { by: byClient })
  const lastLook = useMemo(() => {
    const done = looks.filter(l => l.status === 'done' || l.status === 'private')
    return done.sort((a, b) => (b.taken_at ?? '').localeCompare(a.taken_at ?? ''))[0] ?? null
  }, [looks])

  const main = rows[0] ?? null
  const performance: PostPerformance | null = readPerformance(main?.performance)
  const interactors = readInteractors(main?.interactors)
  const platform = main?.platform ?? channels[0]?.platform ?? null
  const tz = client.timezone

  const failed = jobs.find(j => j.status === 'failed') ?? null
  const failure = failed ? jobWords(failed as unknown as PublishJob).detail : null
  const wentOut = main?.published_at ?? jobs.find(j => j.published_at)?.published_at ?? post.sent_at ?? null
  const dueAt = post.scheduled_for ?? null
  const whenLabel = wentOut
    ? formatWithZone(wentOut, tz, 'long')
    : dueAt ? formatWithZone(dueAt, tz, 'long') : null
  const status = postStatusWords(
    failed ? 'failed' : rows.length > 0 || wentOut ? 'published' : post.status,
    { whenLabel, failure },
  )
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
        summary={status.detail ?? 'Everything about this post, in one place.'}
        actions={
          <Button variant="outline" size="sm" asChild>
            <Link href={`/dashboard/production/${item.id}`}>Open the card</Link>
          </Button>
        }
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

      {/* ── the people ─────────────────────────────────────────────────── */}
      <Card>
        <CardHeader><CardTitle>People</CardTitle></CardHeader>
        <CardContent className="flex flex-col gap-5 pt-0">
          <Commented p={performance} />
          <Liked
            people={peopleFrom(interactors, 'likers')}
            platform={platform}
            unread={interactors === null}
            privateAccount={lastLook?.status === 'private'}
          />
          <Followed
            followed={interactors?.followed ?? []}
            p={performance}
          />
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

/* ── the people ────────────────────────────────────────────────────────── */

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

function Liked({ people, platform, unread, privateAccount }: {
  people: Interactor[]
  platform: string | null
  unread: boolean
  privateAccount: boolean
}) {
  const note = whoLikedNote(platform)
  const line = likedLine(people.length)
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-secondary-13 font-semibold">Who liked</h3>
      {note ? (
        <p className="text-body-15 text-muted-foreground">{note}</p>
      ) : privateAccount ? (
        <p className="text-body-15 text-muted-foreground">{PRIVATE_ACCOUNT_NOTE}</p>
      ) : people.length === 0 ? (
        <p className="text-body-15 text-muted-foreground">
          {unread ? NAMES_PENDING_LINE : 'Nobody yet.'}
        </p>
      ) : (
        <details className="group">
          <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 text-body-15 [&::-webkit-details-marker]:hidden">
            <Faces people={people} />
            <span className="font-medium underline-offset-4 group-open:underline">{line}</span>
          </summary>
          <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
            {people.map(f => (
              <li key={f.username} className="flex min-h-11 items-center gap-2 text-body-15 md:min-h-0">
                <span className="font-medium">{f.full_name || f.username}</span>
                <span className="font-mono text-secondary-13 text-muted-foreground">@{f.username}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  )
}

function Followed({ followed, p }: { followed: FollowedFromPost[]; p: PostPerformance | null }) {
  const line = fromThisPostLine(followed)
  const since = followersLine(shownFollowers(p))
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-secondary-13 font-semibold">Followed from this post</h3>
      {line ? (
        <details className="group">
          <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 text-body-15 [&::-webkit-details-marker]:hidden">
            <Faces people={followed} />
            <span className="font-medium underline-offset-4 group-open:underline">{line}</span>
          </summary>
          <ul className="mt-2 flex flex-col gap-1">
            {followed.map(f => (
              <li key={f.username} className="flex min-h-11 items-center gap-2 text-body-15 md:min-h-0">
                <span className="font-medium">{f.full_name || f.username}</span>
                <span className="font-mono text-secondary-13 text-muted-foreground">@{f.username} · {f.how}</span>
              </li>
            ))}
          </ul>
        </details>
      ) : (
        <p className="text-body-15 text-muted-foreground">
          Nobody who followed since this went up has liked or commented on it.
        </p>
      )}
      {since && <p className="text-body-15 font-medium">{since}</p>}
    </section>
  )
}

function Faces({ people }: { people: Interactor[] }) {
  return (
    <span className="flex -space-x-2" aria-hidden>
      {people.slice(0, 8).map(f => f.profile_pic ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img key={f.username} src={f.profile_pic} alt="" loading="lazy"
          className="h-7 w-7 rounded-full border-2 border-surface object-cover" />
      ) : (
        <span key={f.username}
          className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-surface bg-foreground/[0.08] text-[11px] font-semibold">
          {f.username.slice(0, 1).toUpperCase()}
        </span>
      ))}
    </span>
  )
}
