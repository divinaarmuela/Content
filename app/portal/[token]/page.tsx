import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { Toaster } from 'sonner'
import { getPortalDataByToken, type PortalItem } from '../../lib/portal-data'
import { archivo, sometype } from '../../components/lama/fonts'
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
 * The client portal in MD Media's own dark, cinematic identity — near-black
 * ground, one golden accent, the client's name in display type over a hero
 * cut from their own latest work. One look for every client, deliberately:
 * the portal is the agency's stage; the client's brand is the work on it.
 */

// MD Media's own tokens — same ink and amber as the marketing site
const T = {
  bg: '#0B0B0B',
  ink: '#fafafa',
  surface: '#141414',
  border: '#262626',
  accent: '#FFB300',
  accentInk: '#0B0B0B',
}

/** The most recent piece with visible media — the hero backdrop. */
function heroMedia(items: PortalItem[]): string | null {
  for (const i of items) if (i.preview_url) return i.preview_url
  return null
}

export default async function SharedPortalPage({ params }: { params: Promise<{ token: string }> }) {
  const { token: raw } = await params
  const token = decodeURIComponent(raw).split('--').pop() ?? raw
  const data = await getPortalDataByToken(token)
  if (!data) notFound()

  const hero = heroMedia([...data.published, ...data.scheduled, ...data.approved, ...data.needs_review])
  const words = data.client.name.trim().split(/\s+/)
  const lastWord = words.length > 1 ? words.pop()! : null
  const firstWords = words.join(' ')
  const totalActive = data.needs_review.length + data.in_production.length + data.approved.length + data.scheduled.length

  return (
    <div
      className={`dbx ${archivo.variable} ${sometype.variable} min-h-screen antialiased`}
      style={{
        background: T.bg,
        color: T.ink,
        fontFamily: 'var(--font-archivo), Helvetica, Arial, sans-serif',
        ['--p-bg' as string]: T.bg,
        ['--p-ink' as string]: T.ink,
        ['--p-surface' as string]: T.surface,
        ['--p-border' as string]: T.border,
        ['--p-accent' as string]: T.accent,
        ['--p-accent-ink' as string]: T.accentInk,
        ['--p-heading-font' as string]: 'var(--font-archivo), sans-serif',
        ['--p-mono-font' as string]: 'var(--font-sometype), monospace',
      }}
    >
      {/* ── hero: the client's name over their own work ── */}
      <div className="relative overflow-hidden" style={{ background: '#000' }}>
        {hero && (
          <div className="absolute inset-0">
            {/\.(mp4|webm|mov)(\?|$)/i.test(hero) ? (
              <video src={hero} autoPlay muted loop playsInline className="h-full w-full object-cover opacity-60" />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={hero} alt="" className="h-full w-full object-cover opacity-60" />
            )}
            <div className="absolute inset-0" style={{ background: 'linear-gradient(to top, #0a0a0a 8%, rgba(10,10,10,0.55) 45%, rgba(10,10,10,0.25) 100%)' }} />
          </div>
        )}
        <div className="relative mx-auto flex min-h-[300px] max-w-5xl flex-col justify-end px-4 pb-8 pt-24 sm:min-h-[380px] sm:px-6">
          <p className="mb-3 font-mono text-[10px] uppercase tracking-[0.24em]" style={{ color: T.accent }}>
            Content portal
          </p>
          <h1 className="text-4xl font-bold uppercase leading-[0.95] tracking-tight sm:text-6xl" style={{ fontFamily: 'var(--font-archivo), sans-serif' }}>
            {firstWords}
            {lastWord && <><br /><span style={{ color: T.accent }}>{lastWord}</span></>}
          </h1>
          <div className="mt-5 flex flex-wrap gap-x-8 gap-y-2">
            {[
              ['In review', data.needs_review.length],
              ['In production', data.in_production.length],
              ['Queued', data.approved.length + data.scheduled.length],
              ['Published', data.published.length],
            ].map(([label, n]) => (
              <div key={label as string}>
                <p className="font-mono text-[9px] uppercase tracking-[0.2em] opacity-50">{label}</p>
                <p className="font-mono text-lg font-semibold tabular-nums" style={{ color: (n as number) > 0 ? T.ink : undefined, opacity: (n as number) > 0 ? 1 : 0.35 }}>
                  {String(n).padStart(2, '0')}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── sticky mini-header once scrolled past the hero ── */}
      <header className="sticky top-0 z-20 backdrop-blur" style={{ background: 'rgba(10,10,10,0.85)', borderBottom: `1px solid ${T.border}` }}>
        <div className="mx-auto flex h-12 max-w-5xl items-center gap-3 px-4 sm:px-6">
          <span className="h-2 w-2 rounded-full" style={{ background: T.accent }} />
          <p className="truncate text-sm font-semibold tracking-tight">{data.client.name}</p>
          <p className="ml-auto shrink-0 font-mono text-[9px] uppercase tracking-[0.2em] opacity-40">
            by MD Media
          </p>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-5xl flex-col gap-10 px-4 py-10 sm:px-6">
        <ReviewSection items={data.needs_review} token={token} />
        <CommitmentCards data={data} />
        <div className="grid gap-8 lg:grid-cols-2">
          <PortalSection title="In production" items={data.in_production} empty="Nothing in production right now." />
          <PortalSection title="Approved & scheduled" items={[...data.approved, ...data.scheduled]} empty="Nothing queued yet." />
        </div>
        <PortalSection title="Published" items={data.published} empty="Published posts appear here with live links." />
        {totalActive === 0 && data.published.length === 0 && (
          <p className="text-center text-sm opacity-40">Your first pieces will appear here as production begins.</p>
        )}
      </main>

      <footer className="mx-auto max-w-5xl px-4 pb-10 sm:px-6">
        <p className="font-mono text-[10px] uppercase tracking-[0.14em] opacity-40">
          MD Media · get seen · get known · get booked
        </p>
      </footer>
      <Toaster position="bottom-right" theme="dark" />
    </div>
  )
}
