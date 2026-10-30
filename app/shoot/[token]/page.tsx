import type { Metadata, Viewport } from 'next'
import { notFound, redirect } from 'next/navigation'
import { onePortalFormRedirect } from '../../lib/one-portal-forms'
import { archivo, sometype } from '../../components/lama/fonts'
import { getShootByToken } from '../../lib/shoots'
import ShootAnswer from './ShootAnswer'

export const metadata: Metadata = {
  title: 'Shoot proposal — MD Media',
  robots: 'noindex, nofollow', // secret-link page, never indexed
}

export const viewport: Viewport = { width: 'device-width', initialScale: 1 }

// answers change state; never cache this page
export const dynamic = 'force-dynamic'

/** The client's side of a shoot proposal, behind an unguessable token. */
export default async function ShootPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  // a client on the one portal: this old link opens the same form inside their one link (Shoot brief tab)
  const moved = await onePortalFormRedirect('proposal', token)
  if (moved) redirect(moved)
  const proposal = await getShootByToken(token)
  if (!proposal) notFound()

  return (
    <div className={`${archivo.variable} ${sometype.variable}`}>
      <ShootAnswer
        token={token}
        clientName={proposal.clients?.name ?? ''}
        title={proposal.title}
        startsAt={proposal.starts_at}
        endsAt={proposal.ends_at}
        location={proposal.location}
        note={proposal.note}
        initialStatus={proposal.status}
      />
    </div>
  )
}
