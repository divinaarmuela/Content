import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { portalOwnerByToken } from '../../../lib/portal-owner'
import { campaignsOfClient, todayInMelbourne } from '../../../lib/creator-campaigns'
import { clientCampaign, seatLine, type ClientCampaign } from '../../../lib/creator-portal-core'
import CreatorsFrame from '../../../components/portal/CreatorsFrame'

export const metadata: Metadata = { title: 'Your creators — MD Media', robots: 'noindex, nofollow' }
export const dynamic = 'force-dynamic'

/** THE CLIENT'S CREATOR CAMPAIGNS — every one the team has opened to them, newest first. Drafts and hidden ones are absent. */
export default async function PortalCampaignsPage({ params }: { params: Promise<{ token: string }> }) {
  const { token: raw } = await params
  const owner = await portalOwnerByToken(raw)
  if (!owner) notFound()
  const today = todayInMelbourne()
  const shown = (await campaignsOfClient(owner.client.id))
    .map(c => clientCampaign(c.campaign, c.creators, today))
    .filter((c): c is ClientCampaign => !!c)

  return (
    <CreatorsFrame clientName={owner.client.name} crumb="Creators">
      <h1 className="text-[28px] font-semibold leading-tight sm:text-[34px]">Your creator campaigns</h1>
      {shown.length === 0 ? (
        <p className="rounded-card border border-border bg-card p-6 text-[15px] text-muted-foreground">Nothing here yet. When we have creators for you to choose from, they will be on this page.</p>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {shown.map(c => (
            <li key={c.id}>
              <Link href={`/portal/${owner.token}/creators/${c.id}`} className="flex h-full min-h-[120px] flex-col gap-2 rounded-card border border-border bg-card p-4 transition-colors hover:border-foreground focus-visible:border-foreground focus-visible:outline-none">
                <span className="text-[18px] font-semibold leading-snug">{c.title}</span>
                <span className="text-[14px] text-muted-foreground">{seatLine(c)}</span>
                <span className="mt-auto text-[15px]">{c.next_step}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </CreatorsFrame>
  )
}
