import type { Metadata, Viewport } from 'next'
import { notFound } from 'next/navigation'
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
