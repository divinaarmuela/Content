import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Toaster } from 'sonner'
import { getPortalShootDetail } from '../../../../lib/portal-thread'
import { archivo, sometype } from '../../../../components/lama/fonts'
import PortalShell from '../../../../components/portal/PortalShell'
import ShootSection from '../../../../components/portal/ShootSection'
import CommentThread from '../../../../components/portal/CommentThread'

export const metadata: Metadata = {
  title: 'Your content — MD Media',
  robots: 'noindex, nofollow',
}
export const dynamic = 'force-dynamic'

/**
 * One shoot plan, on its own page: the plan, the board, and a persistent
 * comment thread shared with the team. No popups.
 */
export default async function PortalShootPage({ params }: { params: Promise<{ token: string; id: string }> }) {
  const { token: raw, id } = await params
  const data = await getPortalShootDetail(raw, id)
  if (!data) notFound()
  const token = decodeURIComponent(raw).split('--').pop() ?? raw

  return (
    <PortalShell className={`dbx ${archivo.variable} ${sometype.variable}`}>
      <div style={{
        fontFamily: 'var(--font-archivo), Helvetica, Arial, sans-serif',
        ['--p-heading-font' as string]: 'var(--font-archivo), sans-serif',
        ['--p-mono-font' as string]: 'var(--font-sometype), monospace',
      }}>
        <header className="sticky top-0 z-20 backdrop-blur" style={{ background: 'color-mix(in srgb, var(--p-bg) 85%, transparent)', borderBottom: '1px solid var(--p-border)' }}>
          <div className="flex h-12 items-center gap-3 px-6 sm:px-10">
            <Link href={`/portal/${token}`} className="flex items-center gap-2 text-[11px] uppercase tracking-[0.14em] opacity-70 hover:opacity-100"
              style={{ fontFamily: 'var(--font-sometype), monospace' }}>
              ← {data.client.name}
            </Link>
            <p className="ml-auto shrink-0 text-[9px] uppercase tracking-[0.2em] opacity-40" style={{ fontFamily: 'var(--font-sometype), monospace' }}>
              by MD Media
            </p>
          </div>
        </header>

        <main className="mx-auto flex w-full max-w-5xl flex-col gap-10 px-6 py-12 sm:px-10">
          {/* the token is what makes the plan's PDF and its Approve /
              Request-changes block exist — without it this page was the plan
              with every action stripped out */}
          <ShootSection shoots={[data.shoot]} clientName={data.client.name} token={token}
            amName={data.am_name} bare />
          <div className="mx-auto w-full max-w-3xl">
            <CommentThread token={token} kind="shoot" id={data.shoot.id} comments={data.comments} />
          </div>
        </main>
        <Toaster position="bottom-right" />
      </div>
    </PortalShell>
  )
}
