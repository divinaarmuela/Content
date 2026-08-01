import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getPortalDataByToken } from '../../lib/portal-data'
import { CommitmentCards, PortalSection } from '../../components/portal/PortalSections'

export const metadata: Metadata = {
  title: 'Content progress — MD Media',
  robots: 'noindex, nofollow', // secret-link page — never indexed
}

// always fresh — share links are checked live, no caching of client data
export const dynamic = 'force-dynamic'

/** View-only portal behind an unguessable per-client token. No login, no
 *  actions — progress, schedule, and published links only. */
export default async function SharedPortalPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const data = await getPortalDataByToken(token)
  if (!data) notFound()

  return (
    <div className="dbx min-h-screen bg-zinc-50 text-zinc-900 antialiased">
      <header className="sticky top-0 z-20 border-b border-zinc-200 bg-white/85 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-4xl items-center gap-3 px-4 sm:px-6">
          <div className="flex items-center rounded-lg bg-gradient-to-b from-zinc-800 to-zinc-950 px-2.5 py-2 shadow-sm">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/MDLogo-trim.png" alt="MD Media" className="h-3.5 w-auto" />
          </div>
          <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-zinc-400">Progress view</p>
          <p className="ml-auto font-mono text-[10px] uppercase tracking-wider text-zinc-400">read-only</p>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-4xl flex-col gap-4 px-4 py-6 sm:px-6 sm:py-8">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">{data.client.name}</h1>
          <p className="text-sm text-zinc-500">
            Live progress from MD Media. To review or approve content, use your portal login.
          </p>
        </div>

        <CommitmentCards data={data} />
        <PortalSection
          title="Awaiting client review"
          items={data.needs_review}
          empty="Nothing awaiting review."
        />
        <div className="grid gap-4 lg:grid-cols-2">
          <PortalSection title="In production" items={data.in_production} empty="Nothing in production right now." />
          <PortalSection title="Approved & scheduled" items={[...data.approved, ...data.scheduled]} empty="Nothing queued yet." />
        </div>
        <PortalSection title="Published" items={data.published} empty="Published posts will appear here with live links." />
      </main>

      <footer className="mx-auto max-w-4xl px-4 pb-8 sm:px-6">
        <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-zinc-400">
          MD Media · get seen · get known · get booked
        </p>
      </footer>
    </div>
  )
}
