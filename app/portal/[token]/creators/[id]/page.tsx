import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { portalOwnerByToken } from '../../../../lib/portal-owner'
import { campaignForClient, campaignsOfClient, todayInMelbourne } from '../../../../lib/creator-campaigns'
import { clientCampaign } from '../../../../lib/creator-portal-core'
import CreatorsFrame from '../../../../components/portal/CreatorsFrame'
import CreatorPortal from '../../../../components/portal/CreatorPortal'

export const metadata: Metadata = { title: 'Your creators — MD Media', robots: 'noindex, nofollow' }
export const dynamic = 'force-dynamic'

/**
 * ONE CREATOR CAMPAIGN, ON THE CLIENT'S PORTAL (the owner, 25 Nov 2026). Under the portal link the client already
 * has. A campaign that is another client's, still a draft, or hidden by the team is simply not found — the page
 * never says which. The client reads who is suggested and why, and says yes or no (CreatorPortal draws it).
 */
export default async function PortalCampaignPage({ params }: { params: Promise<{ token: string; id: string }> }) {
  const { token: raw, id } = await params
  const owner = await portalOwnerByToken(raw)
  if (!owner) notFound()
  const today = todayInMelbourne()
  const found = await campaignForClient(owner.client.id, id)
  const view = found ? clientCampaign(found.campaign, found.creators, today) : null
  if (!view) notFound()
  const others = (await campaignsOfClient(owner.client.id)).filter(c => c.campaign.id !== id && clientCampaign(c.campaign, c.creators, today))

  const when = view.starts_at
    ? new Date(view.starts_at).toLocaleString('en-AU', { timeZone: 'Australia/Melbourne', weekday: 'long', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit' })
    : null

  return (
    <CreatorsFrame clientName={owner.client.name} crumb="Creators" bleed>
      <CreatorPortal token={owner.token} clientName={owner.client.name} view={view} when={when}
        backHref={others.length > 0 ? `/portal/${owner.token}/creators` : null} />
    </CreatorsFrame>
  )
}
