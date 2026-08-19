import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { Toaster } from 'sonner'
import { getPortalDataByToken } from '../../lib/portal-data'
import { pickPortalTheme, googleFontsHref } from '../../lib/portal-theme'
import {
  CommitmentCards, PortalSection, ReviewSection,
} from '../../components/portal/PortalSections'

export const metadata: Metadata = {
  title: 'Your content — MD Media',
  robots: 'noindex, nofollow', // secret-link page — never indexed
}

// always fresh — share links are checked live, no caching of client data
export const dynamic = 'force-dynamic'

/**
 * The client's portal, dressed in the client's own brand: background,
 * accent, and typography come from their scanned brand guidelines, so
 * opening this page feels like theirs, not ours. The share token is the
 * client's authority — reviewing and approving happen right here.
 */
export default async function SharedPortalPage({ params }: { params: Promise<{ token: string }> }) {
  const { token: raw } = await params
  // links read "/portal/clientname--token"; the trailing token is still the
  // only thing checked — memorable, never guessable. Old links keep working.
  const token = decodeURIComponent(raw).split('--').pop() ?? raw
  const data = await getPortalDataByToken(token)
  if (!data) notFound()

  const theme = pickPortalTheme(data.brand as Parameters<typeof pickPortalTheme>[0])
  const fontsHref = googleFontsHref(theme.fontFamilies)

  return (
    <div
      className="dbx min-h-screen antialiased"
      style={{
        background: 'var(--p-bg)',
        color: 'var(--p-ink)',
        fontFamily: theme.bodyFont || undefined,
        ['--p-bg' as string]: theme.bg,
        ['--p-ink' as string]: theme.ink,
        ['--p-surface' as string]: theme.surface,
        ['--p-border' as string]: theme.border,
        ['--p-accent' as string]: theme.accent,
        ['--p-accent-ink' as string]: theme.accentInk,
        ['--p-heading-font' as string]: theme.headingFont || 'inherit',
      }}
    >
      {/* the client's typefaces, when Google hosts them; fallbacks otherwise */}
      {fontsHref && <link rel="stylesheet" href={fontsHref} />}

      <header
        className="sticky top-0 z-20 backdrop-blur"
        style={{ background: 'color-mix(in srgb, var(--p-bg) 85%, transparent)', borderBottom: '1px solid var(--p-border)' }}
      >
        <div className="mx-auto flex h-16 max-w-5xl items-center gap-3 px-4 sm:px-6">
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: 'var(--p-accent)' }} />
          <p className="truncate text-sm font-semibold tracking-tight" style={{ fontFamily: 'var(--p-heading-font)' }}>
            {data.client.name}
          </p>
          <p className="ml-auto shrink-0 font-mono text-[10px] uppercase tracking-[0.18em] opacity-40">
            content portal · by MD Media
          </p>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-5xl flex-col gap-10 px-4 py-10 sm:px-6">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl" style={{ fontFamily: 'var(--p-heading-font)' }}>
            {data.client.name}
          </h1>
          <p className="mt-2 max-w-xl text-sm opacity-60">
            Your content, live — review new pieces, follow production, and find every published post in one place.
          </p>
        </div>

        <ReviewSection items={data.needs_review} token={token} />
        <CommitmentCards data={data} />
        <div className="grid gap-8 lg:grid-cols-2">
          <PortalSection title="In production" items={data.in_production} empty="Nothing in production right now." />
          <PortalSection title="Approved & scheduled" items={[...data.approved, ...data.scheduled]} empty="Nothing queued yet." />
        </div>
        <PortalSection title="Published" items={data.published} empty="Published posts appear here with live links." />
      </main>

      <footer className="mx-auto max-w-5xl px-4 pb-10 sm:px-6">
        <p className="font-mono text-[10px] uppercase tracking-[0.14em] opacity-40">
          MD Media · get seen · get known · get booked
        </p>
      </footer>
      <Toaster position="bottom-right" />
    </div>
  )
}
