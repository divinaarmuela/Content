import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getPortalPost } from '../../../../lib/portal-post'
import { archivo, sometype } from '../../../../components/lama/fonts'
import PortalShell from '../../../../components/portal/PortalShell'
import PortalLive from '../../../../components/portal/PortalLive'
import SlideCarousel from '../../../../components/media/SlideCarousel'
import Sparkline from '../../../../components/Sparkline'
import {
  compactCount, METRICS_PENDING_LINE, metricCells, metricsPending,
} from '../../../../lib/post-analytics-core'
import { portalFollowersLine } from '../../../../lib/post-performance-core'
import { formatWithZone } from '../../../../lib/timezone-core'

export const metadata: Metadata = {
  title: 'Your post — MD Media',
  robots: 'noindex, nofollow',
}
export const dynamic = 'force-dynamic'

/**
 * ONE POST, ON THE CLIENT'S OWN PAGE.
 *
 * The same page the team reads, in the client's words: what went out, where,
 * when, how many people interacted, how the account moved around it, and —
 * only when their Followers switch is on — who. No service is named, no id
 * is shown, and nothing here asks a platform anything: every figure was
 * written by a sweep that already runs, and `PortalLive` re-renders the page
 * on the server when something about this client changes, so the sanitising
 * happens once, in one place, every time.
 */
export default async function PortalPostPage({ params }: {
  params: Promise<{ token: string; id: string }>
}) {
  const { token: raw, id } = await params
  const token = decodeURIComponent(raw).split('--').pop() ?? raw
  const post = await getPortalPost(raw, id)
  if (!post) notFound()

  const perf = post.performance
  const cells = metricCells(post.metrics)
  const pending = metricsPending(post.metrics)
  const followers = portalFollowersLine(perf?.followers ?? null)
  const when = post.posted_at ? formatWithZone(post.posted_at, post.timezone, 'long') : null

  return (
    <PortalShell className={`dbx ${archivo.variable} ${sometype.variable}`}>
      <PortalLive clientId={post.client.id} />
      <div
        className="bg-background text-foreground"
        style={{
          fontFamily: 'var(--font-archivo), Helvetica, Arial, sans-serif',
          ['--p-bg' as string]: 'hsl(var(--background))',
          ['--p-ink' as string]: 'hsl(var(--foreground))',
          ['--p-surface' as string]: 'hsl(var(--card))',
          ['--p-border' as string]: 'hsl(var(--border))',
          ['--p-accent' as string]: 'hsl(var(--primary))',
          ['--p-accent-ink' as string]: 'hsl(var(--primary-foreground))',
          ['--p-mono-font' as string]: 'var(--font-sometype), monospace',
        }}
      >
        <header className="sticky top-0 z-20 border-b border-border bg-background/85 backdrop-blur">
          <div className="mx-auto flex h-14 w-full max-w-3xl items-center gap-3 px-5 pr-14 sm:px-10">
            <Link href={`/portal/${token}`} className="inline-flex min-h-11 items-center gap-2 text-[14px] font-semibold">
              ← Your board
            </Link>
          </div>
        </header>

        <main className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-5 py-8 pb-24 sm:px-10 sm:pb-16">
          <div className="flex flex-col gap-2">
            <h1 className="text-[26px] font-semibold leading-tight sm:text-[32px]">{post.title}</h1>
            <p className="text-[14px] text-muted-foreground">
              {[post.networks.join(' · ') || null, when].filter(Boolean).join(' · ') || 'Not out yet.'}
            </p>
          </div>

          {post.slides.length > 0 && (
            <SlideCarousel
              slides={post.slides}
              aspect="natural"
              mode="full"
              className="overflow-hidden rounded-inner"
              label={`${post.title}${post.slides.length > 1 ? ` — ${post.slides.length} slides` : ''}`}
            />
          )}

          {post.caption?.trim() && (
            <p className="whitespace-pre-line text-[15px] leading-[1.5]">{post.caption}</p>
          )}

          {post.live_urls.length > 0 && (
            <div className="flex flex-wrap gap-x-5 gap-y-1">
              {post.live_urls.map(url => (
                <a key={url} href={url} target="_blank" rel="noreferrer noopener"
                  className="inline-flex min-h-11 items-center text-[14px] font-semibold underline-offset-4 hover:underline">
                  See the live post
                </a>
              ))}
            </div>
          )}

          {/* ── how it did ─────────────────────────────────────────────── */}
          <section className="flex flex-col gap-3">
            <h2 className="text-[18px] font-semibold">How it did</h2>
            {pending || (!perf && cells.length === 0) ? (
              <p className="text-[14px] text-muted-foreground">{METRICS_PENDING_LINE}</p>
            ) : (
              <>
                {perf && perf.interactions !== null && (
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="text-[40px] font-semibold leading-none tracking-tight">
                      {compactCount(perf.interactions)}
                    </span>
                    <span className="text-[15px] text-muted-foreground">
                      {perf.interactions === 1 ? 'person interacted' : 'people interacted'}
                    </span>
                  </div>
                )}
                {cells.length > 0 && (
                  <ul className="flex flex-wrap gap-x-4 gap-y-1">
                    {cells.map(c => (
                      <li key={c.key} className="flex items-baseline gap-1">
                        <span className="text-[15px] font-semibold tabular-nums">{compactCount(c.value)}</span>
                        <span className="text-[13px] text-muted-foreground">{c.label}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {perf && perf.spark.length > 1 && (
                  <figure className="flex flex-col gap-1">
                    <span style={{ color: 'var(--p-accent, currentColor)' }}>
                      <Sparkline points={perf.spark} width={320} height={64} label="Interactions, day by day" />
                    </span>
                    <figcaption className="text-[13px] text-muted-foreground">Interactions, day by day</figcaption>
                  </figure>
                )}
                {followers && <p className="text-[15px] font-medium">{followers}</p>}
              </>
            )}
          </section>

          {/* ── the people ─────────────────────────────────────────────── */}
          <section className="flex flex-col gap-3">
            <h2 className="text-[18px] font-semibold">People</h2>
            <p className="text-[14px]">
              {post.comment_count === 0
                ? 'Nobody has commented yet.'
                : post.comment_count === 1 ? '1 person commented' : `${post.comment_count} people commented`}
              {post.liked_count > 0 && (
                <> · {post.liked_count === 1 ? '1 person liked it' : `${post.liked_count} people liked it`}</>
              )}
              {post.followed_count > 0 && (
                <> · {post.followed_count === 1
                  ? '1 of them followed you from this post'
                  : `${post.followed_count} of them followed you from this post`}</>
              )}
            </p>

            {post.shows_people ? (
              <>
                {post.comments.length > 0 && (
                  <ul className="flex flex-col gap-1.5">
                    {post.comments.map(c => (
                      <li key={c.id} className="rounded-tile bg-foreground/[0.04] px-3 py-2 text-[14px]">
                        {c.name && <span className="font-semibold">{c.name}</span>}{' '}
                        <span>{c.text}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {post.liked.length > 0 && (
                  <p className="text-[14px] text-muted-foreground">
                    Liked by {post.liked.map(p => p.name).join(', ')}
                  </p>
                )}
                {post.followed.length > 0 && (
                  <p className="text-[14px] text-muted-foreground">
                    Followed you from this post: {post.followed.map(p => p.name).join(', ')}
                  </p>
                )}
              </>
            ) : (
              <p className="text-[13px] text-muted-foreground">
                We keep the names to ourselves unless you ask for them — say the word and they appear here.
              </p>
            )}
          </section>
        </main>
      </div>
    </PortalShell>
  )
}
