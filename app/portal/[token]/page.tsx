import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { Toaster } from 'sonner'
import { getPortalDataByToken, type PortalItem } from '../../lib/portal-data'
import { archivo, sometype } from '../../components/lama/fonts'
import Reveal from '../../components/lama/Reveal'
import Rule from '../../components/lama/Rule'
import { Scramble } from '../../components/lama/Scramble'
import PortalShell from '../../components/portal/PortalShell'
import {
  CommitmentCards, PortalSection, ReviewSection,
} from '../../components/portal/PortalSections'
import ShootSection from '../../components/portal/ShootSection'

export const metadata: Metadata = {
  title: 'Your content — MD Media',
  robots: 'noindex, nofollow', // secret-link page — never indexed
}

// always fresh — share links are checked live, no caching of client data
export const dynamic = 'force-dynamic'

/**
 * The client portal in the marketing site's own voice: ink and cream, Archivo
 * display over a hero cut from the client's latest work, Sometype mono
 * kickers with scramble entrances, growing hairline rules, staggered
 * reveals. One stage for every client — the client's brand is the work on it.
 */

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

  return (
    <PortalShell className={`dbx ${archivo.variable} ${sometype.variable}`}>
      <div style={{
        fontFamily: 'var(--font-archivo), Helvetica, Arial, sans-serif',
        ['--p-heading-font' as string]: 'var(--font-archivo), sans-serif',
        ['--p-mono-font' as string]: 'var(--font-sometype), monospace',
      }}>
      {/* ── hero: the client's name over their own work ── */}
      <div className="relative overflow-hidden" style={{ background: '#000' }}>
        {hero && (
          <div className="absolute inset-0">
            {/\.(mp4|webm|mov)(\?|$)/i.test(hero) ? (
              <video src={hero} autoPlay muted loop playsInline className="h-full w-full object-cover opacity-50" />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={hero} alt="" className="h-full w-full object-cover opacity-50" />
            )}
            <div className="absolute inset-0" style={{ background: 'linear-gradient(to top, #0B0B0B 6%, rgba(11,11,11,0.55) 45%, rgba(11,11,11,0.2) 100%)' }} />
          </div>
        )}
        <div className="absolute left-6 top-5 z-10 sm:left-10">
          <div className="flex w-fit items-center rounded-lg bg-gradient-to-b from-zinc-800 to-zinc-950 px-2.5 py-2 shadow-sm">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/MDLogo-trim.png" alt="MD Media" className="h-3.5 w-auto" />
          </div>
        </div>
        <div className="relative flex min-h-[300px] flex-col justify-end px-6 pb-8 pt-24 text-cream sm:min-h-[420px] sm:px-10 sm:pb-10">
          <Scramble
            gate={false}
            text="CONTENT PORTAL"
            className="mb-4 block text-[11px] uppercase tracking-[0.24em] [word-spacing:0.45em]"
            as="p"
          />
          <Reveal gate={false}>
            <h1 className="font-medium uppercase leading-[1.0] tracking-[-0.04em] text-[clamp(2.2rem,7vw,6rem)]">
              {firstWords}
              {lastWord && (
                <>
                  {' '}
                  <span className="bg-cream px-[0.12em] py-[0.02em] text-ink [box-decoration-break:clone] [-webkit-box-decoration-break:clone]">
                    {lastWord}
                  </span>
                </>
              )}
            </h1>
          </Reveal>
          <Reveal gate={false} delay={160}>
            <div className="mt-7 flex flex-wrap gap-x-10 gap-y-3" style={{ fontFamily: 'var(--font-sometype), monospace' }}>
              {[
                // the counters, the headings and the chips are the SAME four
                // words — a client counting "01" finds the section that says it
                // a shoot plan waiting on them counts: the section below asks
                // for a decision, and a counter reading 00 above it is the
                // page telling the client there is nothing to do
                ['Needs your review', data.needs_review.length + data.plans_awaiting],
                ['In production', data.in_production.length + data.changes_requested.length],
                ['Approved', data.approved.length + data.scheduled.length],
                ['Published', data.published.length],
              ].map(([label, n]) => (
                <div key={label as string}>
                  <p className="text-[9px] uppercase tracking-[0.2em] opacity-50">{label}</p>
                  <p className="text-lg tabular-nums" style={{ opacity: (n as number) > 0 ? 1 : 0.35 }}>
                    {String(n).padStart(2, '0')}
                  </p>
                </div>
              ))}
            </div>
          </Reveal>
        </div>
      </div>

      {/* ── sticky mini-header once scrolled past the hero ── */}
      <header className="sticky top-0 z-20 backdrop-blur" style={{ background: 'color-mix(in srgb, var(--p-bg) 85%, transparent)', borderBottom: '1px solid var(--p-border)' }}>
        <div className="flex h-12 items-center gap-3 px-6 sm:px-10">
          <div className="flex shrink-0 items-center rounded-md bg-gradient-to-b from-zinc-800 to-zinc-950 px-2 py-1.5">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/MDLogo-trim.png" alt="MD Media" className="h-2.5 w-auto" />
          </div>
          <p className="truncate text-sm font-medium uppercase tracking-tight">{data.client.name}</p>
          <p className="ml-auto shrink-0 text-[9px] uppercase tracking-[0.2em] opacity-40" style={{ fontFamily: 'var(--font-sometype), monospace' }}>
            by MD Media
          </p>
        </div>
      </header>

      <main className="flex w-full flex-col gap-16 px-6 py-14 sm:px-10">
        <Reveal gate={false}><ReviewSection items={data.needs_review} token={token} amName={data.am_name} /></Reveal>
        <Reveal gate={false}><ShootSection shoots={data.shoots} clientName={data.client.name} token={token} amName={data.am_name} /></Reveal>
        <Reveal gate={false}><CommitmentCards data={data} /></Reveal>
        {data.changes_requested.length > 0 && (
          // the one thing a client wants to see after asking for changes is
          // that the note landed — not their piece filed under "in production"
          <Reveal gate={false}>
            <PortalSection title="Your changes are being made" items={data.changes_requested}
              empty="" token={token} />
          </Reveal>
        )}
        <div className="grid gap-12 lg:grid-cols-2">
          <Reveal gate={false}><PortalSection title="In production" items={data.in_production} empty="Nothing in production right now." token={token} /></Reveal>
          <Reveal gate={false} delay={120}><PortalSection title="Approved" items={[...data.approved, ...data.scheduled]} empty="Nothing approved yet." token={token} /></Reveal>
        </div>
        <Reveal gate={false}><PortalSection title="Published" items={data.published} empty="Published posts appear here with live links." token={token} /></Reveal>
      </main>

      <footer className="px-6 pb-10 sm:px-10">
        <Rule className="mb-6 bg-current opacity-30" once />
        <p className="text-[10px] uppercase tracking-[0.14em] opacity-40" style={{ fontFamily: 'var(--font-sometype), monospace' }}>
          MD Media · get seen · get known · get booked
        </p>
      </footer>
      <Toaster position="top-center" />
      </div>
    </PortalShell>
  )
}
