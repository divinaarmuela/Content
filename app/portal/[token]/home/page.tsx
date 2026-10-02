import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Toaster } from 'sonner'
import { archivo, sometype } from '../../../components/lama/fonts'
import PortalShell from '../../../components/portal/PortalShell'
import PortalLive from '../../../components/portal/PortalLive'
import EditingReview from '../../../components/portal/EditingReview'
import { PortalCardView } from '../../../components/portal/PortalBoard'
import { PortalHelpLine } from '../../../components/portal/PortalSections'
import OnePortalTabs from '../../../components/portal/OnePortalTabs'
import OnePortalWorkList from '../../../components/portal/OnePortalWorkList'
import OnePortalShoots from '../../../components/portal/OnePortalShoots'
import { loadOnePortal } from '../../../lib/one-portal-page'
import { loadScheduling, schedulingWaiting } from '../../../lib/one-portal-schedule'
import OnePortalScheduling from '../../../components/portal/OnePortalScheduling'
import { getEditingPortal, editingPortalWaiting } from '../../../lib/editing-portal'
import { PORTAL_TABS, onePortalPath, readTab } from '../../../lib/one-portal-core'

export const metadata: Metadata = {
  title: 'Your portal — MD Media',
  robots: 'noindex, nofollow',
}
export const dynamic = 'force-dynamic'

/**
 * THE ONE PORTAL (docs/ONE_PORTAL_SPEC.md; the owner, 2 Oct 2026: "we don't wanna keep sending them different
 * links"). One page per link — the business's or a person's — with four tabs: Shoot brief, Editing, Designing,
 * Scheduling. `?tab=` opens a tab and `&id=` one thing in it, so every email is this one address. Only for a
 * client on the one portal (clients.portal_one); anyone else's link answers 404 here and keeps today's portal.
 */
export default async function OnePortalPage({ params, searchParams }: {
  params: Promise<{ token: string }>
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}) {
  const { token: raw } = await params
  const page = await loadOnePortal(raw)
  if (!page) notFound()
  const sp = (await searchParams) ?? {}
  const askedTab = typeof sp.tab === 'string' ? readTab(sp.tab) : null
  // the booked posts always (the tab's badge); the posted feeds only when the Scheduling tab is open
  const profiles = await loadScheduling(page.client.id, page.scope, page.data.client.timezone, new Date(), askedTab === 'scheduling' || askedTab === null)
  page.waiting.scheduling = schedulingWaiting(profiles)
  // no tab asked for: the first one with something waiting on them, else Scheduling (what goes out next)
  const tab = typeof sp.tab === 'string' ? readTab(sp.tab) : (PORTAL_TABS.find(t => page.waiting[t.key] > 0)?.key ?? 'scheduling')
  const id = typeof sp.id === 'string' ? sp.id : null
  const { token, data } = page
  const tabLabel = PORTAL_TABS.find(t => t.key === tab)!.label

  // one piece opened inside Editing / Designing: today's review, on this page
  let opened: React.ReactNode = null
  if (id && (tab === 'editing' || tab === 'designing')) {
    const card = (tab === 'editing' ? page.editing : page.designing).find(c => c.id === id) ?? null
    if (!card) notFound()
    const review = card.editing ? await getEditingPortal(token, id) : null
    const waiting = !review && card.editing ? await editingPortalWaiting(token, id) : null
    opened = (
      <div className="flex flex-col gap-5" data-one-portal-open={id}>
        <Link href={onePortalPath(token, tab)} className="inline-flex min-h-10 w-fit items-center text-[13px] font-semibold underline-offset-4 hover:underline">
          ← All {tab === 'editing' ? 'edits' : 'designs'}
        </Link>
        <div className="flex flex-wrap items-end gap-x-6 gap-y-2">
          <h1 className="text-[26px] font-semibold leading-tight tracking-tight sm:text-[34px]">{card.title}</h1>
          {review && <p className="pb-1 text-[13px] text-muted-foreground">{review.item.status_label}</p>}
        </div>
        {review ? <EditingReview data={review} />
          : waiting ? <p className="max-w-md text-[15px] text-muted-foreground">Your edit is on its way — the files are still arriving. Refresh in a minute.</p>
          : <PortalCardView card={card} amName={data.am_name} surface={{ token }} className="max-w-3xl" />}
      </div>
    )
  }

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
          ['--p-heading-font' as string]: 'var(--font-archivo), sans-serif',
          ['--p-mono-font' as string]: 'var(--font-sometype), monospace',
        }}
      >
        <header className="sticky top-0 z-20 border-b border-border bg-background/90 backdrop-blur">
          <div className="flex flex-col gap-1 px-5 pt-3 pr-14 sm:px-10 sm:pr-10">
            <div className="flex items-center gap-3">
              <div className="flex shrink-0 items-center rounded-md bg-gradient-to-b from-zinc-800 to-zinc-950 px-2 py-1.5">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/MDLogo-trim.png" alt="MD Media" className="h-2.5 w-auto" />
              </div>
              <p className="truncate text-sm font-medium uppercase tracking-tight">{data.client.name}</p>
              <p className="ml-auto hidden shrink-0 text-[9px] uppercase tracking-[0.2em] opacity-40 sm:block" style={{ fontFamily: 'var(--font-sometype), monospace' }}>
                Your portal · by MD Media
              </p>
            </div>
            <OnePortalTabs token={token} active={tab} waiting={page.waiting} />
          </div>
        </header>

        <main className="portal-legible flex w-full flex-col gap-6 px-5 py-8 sm:px-10 sm:py-10" data-one-portal-tab={tab}>
          {opened ?? (
            <>
              <h1 className="text-[26px] font-semibold leading-tight tracking-tight sm:text-[34px]">{tabLabel}</h1>
              {tab === 'shoot' && <OnePortalShoots token={token} data={data} shoots={page.shoots} initialCardId={typeof sp.card === 'string' ? sp.card : null} />}
              {tab === 'editing' && <OnePortalWorkList token={token} tab="editing" cards={page.editing} empty="No edits to look at yet. When a video is ready for you, it shows here." />}
              {tab === 'designing' && <OnePortalWorkList token={token} tab="designing" cards={page.designing} empty="No designs to look at yet. When a design is ready for you, it shows here." />}
              {tab === 'scheduling' && <OnePortalScheduling token={token} profiles={profiles} openPostId={id} />}
            </>
          )}
        </main>

        <footer className="px-5 pb-24 sm:px-10 sm:pb-10">
          <PortalHelpLine amName={data.am_name} className="mb-3 text-muted-foreground opacity-100" />
          <p className="text-[12px] uppercase tracking-[0.14em] text-muted-foreground" style={{ fontFamily: 'var(--font-sometype), monospace' }}>
            MD Media · get seen · get known · get booked
          </p>
        </footer>
        <Toaster position="top-center" />
      </div>
    </PortalShell>
  )
}
