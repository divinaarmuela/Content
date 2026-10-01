import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Toaster } from 'sonner'
import { getPortalPost } from '../../../../lib/portal-post'
import { getPortalPostPage } from '../../../../lib/portal-thread'
import { archivo, sometype } from '../../../../components/lama/fonts'
import PortalShell from '../../../../components/portal/PortalShell'
import PortalLive from '../../../../components/portal/PortalLive'
import PortalPostReview from '../../../../components/portal/PortalPostReview'
import Sparkline from '../../../../components/Sparkline'
import {
  compactCount, METRICS_PENDING_LINE, metricCells, metricsPending,
} from '../../../../lib/post-analytics-core'
import { portalFollowersLine } from '../../../../lib/post-performance-core'

export const metadata: Metadata = {
  title: 'Your post — MD Media',
  robots: 'noindex, nofollow',
}
export const dynamic = 'force-dynamic'

/**
 * ONE POST, ON THE CLIENT'S OWN PAGE (the posting rebuild, 29 Sep 2026; SPEC §4.4).
 *
 * The same address for the whole of a post's life. While it is with them: the
 * version they were sent, a note on any file, and Approve or Ask for a change.
 * After: what became of it, in true words — "You approved this", "Approved by
 * Divina for you", "The team is updating this post", "Live on Instagram" with
 * each network's own link — and, once it is live, how it did.
 *
 * Everything comes from the post's stage and its FROZEN version; nothing from
 * the edit card, nothing from the live working copy (audit P2, P5, P6, P13).
 *
 * THERE IS NO PREVIEW HERE (audit P4: `?preview=1` showed internal posts to
 * anyone holding the link). This page is exactly the client's, for everybody:
 * the portal's token pages run without Clerk (middleware.ts), so no sign-in
 * can be checked on them, and an address flag is not a sign-in. The team's
 * look through the client's eyes belongs behind Clerk in the dashboard —
 * `getPortalPostPage(token, id, { team: true })` builds it, with nothing to
 * press — never on the share link.
 */
export default async function PortalPostPage({ params }: {
  params: Promise<{ token: string; id: string }>
}) {
  const { token: raw, id } = await params
  const token = decodeURIComponent(raw).split('--').pop() ?? raw
  const data = await getPortalPostPage(raw, id)
  if (!data) notFound()
  const live = data.view.state === 'posted' && !data.preview_mode ? await getPortalPost(raw, id) : null

  const perf = live?.performance ?? null
  const cells = live ? metricCells(live.metrics) : []
  const pending = live ? metricsPending(live.metrics) : true
  const followers = portalFollowersLine(perf?.followers ?? null)

  return (
    <PortalShell className={`dbx ${archivo.variable} ${sometype.variable}`}>
      <PortalLive clientId={data.client.id} />
      <div
        className="min-h-screen bg-background text-foreground"
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
          <div className="mx-auto flex h-14 w-full max-w-[1280px] items-center gap-3 px-5 pr-14 sm:px-8">
            <Link href={`/portal/${token}`} className="inline-flex min-h-11 items-center gap-2 text-[14px] font-semibold">
              ← Your board
            </Link>
            <p className="ml-auto hidden text-[11px] uppercase tracking-[0.2em] text-muted-foreground sm:block" style={{ fontFamily: 'var(--font-sometype), monospace' }}>
              MD Media · {data.client.name}
            </p>
          </div>
        </header>

        <main className="mx-auto flex w-full max-w-[1280px] flex-col gap-6 px-5 pb-24 pt-6 sm:px-8 sm:pb-16">
          <h1 className="text-[26px] font-semibold leading-tight sm:text-[32px]">{data.title}</h1>
          <PortalPostReview token={token} data={data} />

          {/* ── once it is live: how it did ── */}
          {live && (
            <div className="flex max-w-3xl flex-col gap-8">
              <section className="flex flex-col gap-3">
                <h2 className="text-[18px] font-semibold">How it did</h2>
                {pending || (!perf && cells.length === 0) ? (
                  <p className="text-[14px] text-muted-foreground">{METRICS_PENDING_LINE}</p>
                ) : (
                  <>
                    {perf && perf.interactions !== null && (
                      <div className="flex flex-wrap items-baseline gap-x-2">
                        <span className="text-[40px] font-semibold leading-none tracking-tight">{compactCount(perf.interactions)}</span>
                        <span className="text-[15px] text-muted-foreground">{perf.interactions === 1 ? 'person interacted' : 'people interacted'}</span>
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

              <section className="flex flex-col gap-3">
                <h2 className="text-[18px] font-semibold">Comments</h2>
                <p className="text-[14px]">
                  {live.comment_count === 0
                    ? 'Nobody has commented yet.'
                    : live.comment_count === 1 ? '1 person commented' : `${live.comment_count} people commented`}
                </p>
              </section>
            </div>
          )}
        </main>
        <Toaster position="top-center" />
      </div>
    </PortalShell>
  )
}
