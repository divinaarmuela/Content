import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Check } from 'lucide-react'
import { getPortalDataByToken } from '../../../lib/portal-data'
import { portalPostHref } from '../../../lib/post-page-core'
import { archivo, sometype } from '../../../components/lama/fonts'
import PortalShell from '../../../components/portal/PortalShell'
import PortalLive from '../../../components/portal/PortalLive'

export const metadata: Metadata = {
  title: 'Waiting on you — MD Media',
  robots: 'noindex, nofollow',
}
export const dynamic = 'force-dynamic'

/**
 * EVERYTHING WAITING ON YOU, ON ONE PAGE (the owner's decision 15; research
 * S3: one link that stays open and lists every post waiting on the client).
 *
 * One row per post that is with the client, reached them, and is still open —
 * the one whose answer is needed soonest first. Each row says what it is,
 * where and when it goes, and when the answer is needed by, and opens the
 * post's own page. Built from the version they were sent (never the live
 * post), from the post's stage (never the edit card). A post whose time went
 * while it waited is not asked for; the page says the team will send a new time.
 */
export default async function PortalWaitingPage({ params }: { params: Promise<{ token: string }> }) {
  const { token: raw } = await params
  const token = decodeURIComponent(raw).split('--').pop() ?? raw
  const data = await getPortalDataByToken(token)
  if (!data) notFound()
  const waiting = data.post_approvals

  return (
    <PortalShell className={`dbx ${archivo.variable} ${sometype.variable}`}>
      <PortalLive clientId={data.client.id} />
      <div className="min-h-screen bg-background text-foreground" style={{ fontFamily: 'var(--font-archivo), Helvetica, Arial, sans-serif' }}>
        <header className="sticky top-0 z-20 border-b border-border bg-background/85 backdrop-blur">
          <div className="mx-auto flex h-14 w-full max-w-3xl items-center gap-3 px-5 pr-14 sm:px-8">
            <Link href={`/portal/${token}`} className="inline-flex min-h-11 items-center gap-2 text-[14px] font-semibold">← Your board</Link>
          </div>
        </header>
        <main className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-5 pb-24 pt-6 sm:px-8">
          <div className="flex flex-col gap-1">
            <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground" style={{ fontFamily: 'var(--font-sometype), monospace' }}>
              MD Media · {data.client.name}
            </p>
            <h1 className="text-[26px] font-semibold leading-tight sm:text-[32px]">
              {waiting.length === 0 ? 'Nothing is waiting on you' : waiting.length === 1 ? 'One post is waiting on you' : `${waiting.length} posts are waiting on you`}
            </h1>
            {waiting.length > 0 && <p className="text-[14px] text-muted-foreground">Open each one to look at it, leave a note on any picture, and approve it or ask for a change.</p>}
          </div>

          {waiting.length > 0 && (
            <ul className="flex flex-col gap-3" data-portal-waiting>
              {waiting.map(p => (
                <li key={p.id}>
                  <Link href={portalPostHref(token, p.id)}
                    className="flex items-center gap-3 rounded-card border border-border bg-card p-3 hover:bg-muted">
                    <span className="h-20 w-20 shrink-0 overflow-hidden rounded-tile bg-foreground/[0.06]">
                      {p.cover && (p.cover.type === 'video'
                        ? <video src={p.cover.url} muted playsInline preload="metadata" className="h-full w-full object-cover" />
                        // eslint-disable-next-line @next/next/no-img-element
                        : <img src={p.cover.url} alt="" loading="lazy" className="h-full w-full object-cover" />)}
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="truncate text-[16px] font-semibold">{p.title}</span>
                      <span className="text-[13px] text-muted-foreground">
                        {[p.type_line, p.networks.join(' · ') || null, p.when ? `Goes out ${p.when}` : null].filter(Boolean).join(' · ')}
                      </span>
                      {p.approve_by && <span className="text-[13px] font-semibold">{p.approve_by}</span>}
                    </span>
                    <span className="hidden shrink-0 items-center gap-1.5 rounded-full bg-foreground px-4 py-2 text-[14px] font-semibold text-background sm:inline-flex">
                      <Check className="h-4 w-4" aria-hidden /> Review
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}

          {data.posts_missed > 0 && (
            <p role="status" className="rounded-card border border-border bg-card px-4 py-3 text-[14px]">
              {data.posts_missed === 1 ? 'One post' : `${data.posts_missed} posts`} passed {data.posts_missed === 1 ? 'its' : 'their'} time before you could answer. The team will send you a new time.
            </p>
          )}
          {waiting.length === 0 && (
            <p className="text-[14px] text-muted-foreground">
              When the team sends you a post to approve, it appears here. <Link href={`/portal/${token}`} className="font-semibold text-foreground underline underline-offset-4">Back to your board</Link>.
            </p>
          )}
        </main>
      </div>
    </PortalShell>
  )
}
