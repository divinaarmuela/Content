import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { portalOwnerByToken } from '../../../../lib/portal-owner'
import { campaignForClient, campaignsOfClient, todayInMelbourne } from '../../../../lib/creator-campaigns'
import { clientCampaign, closesWords, seatLine } from '../../../../lib/creator-portal-core'
import CreatorsFrame from '../../../../components/portal/CreatorsFrame'
import CreatorShortlist from '../../../../components/portal/CreatorShortlist'

export const metadata: Metadata = { title: 'Your creators — MD Media', robots: 'noindex, nofollow' }
export const dynamic = 'force-dynamic'

/**
 * ONE CREATOR CAMPAIGN, ON THE CLIENT'S PORTAL (the owner, 25 Nov 2026). Under the portal link the client already
 * has. A campaign that is another client's, still a draft, or hidden by the team is simply not found — the page
 * never says which. The client reads who is suggested and why, and says yes or no.
 */
export default async function PortalCampaignPage({ params }: { params: Promise<{ token: string; id: string }> }) {
  const { token: raw, id } = await params
  const owner = await portalOwnerByToken(raw)
  if (!owner) notFound()
  const found = await campaignForClient(owner.client.id, id)
  const view = found ? clientCampaign(found.campaign, found.creators, todayInMelbourne()) : null
  if (!view) notFound()
  const others = (await campaignsOfClient(owner.client.id)).filter(c => c.campaign.id !== id && clientCampaign(c.campaign, c.creators, todayInMelbourne()))

  const when = view.starts_at ? new Date(view.starts_at).toLocaleString('en-AU', { timeZone: 'Australia/Melbourne', weekday: 'long', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit' }) : null
  const closes = closesWords(view.closes_on)

  return (
    <CreatorsFrame clientName={owner.client.name} crumb="Creators">
      <section className="flex flex-col gap-3" data-campaign-overview>
        {others.length > 0 && (
          <Link href={`/portal/${owner.token}/creators`} className="inline-flex min-h-11 items-center text-[14px] text-muted-foreground underline underline-offset-2">All your creator campaigns</Link>
        )}
        <h1 className="text-[28px] font-semibold leading-tight sm:text-[34px]">{view.title}</h1>
        <p className="text-[16px] text-muted-foreground">{[when, view.place].filter(Boolean).join(' · ') || 'Date to come'}</p>
        <div className="flex flex-col gap-1 rounded-card border border-border bg-card p-4">
          <p className="text-[17px] font-semibold">{seatLine(view)}</p>
          <p className="text-[15px]">{view.next_step}</p>
          {closes && view.open_for_answers && <p className="text-[14px] text-muted-foreground">Please answer by {closes}.</p>}
        </div>
        {(view.deliverables.length > 0 || view.usage_terms) && (
          <div className="flex flex-col gap-2 rounded-card border border-border bg-card p-4">
            {view.deliverables.length > 0 && (
              <>
                <p className="text-[15px] font-semibold">What each creator delivers</p>
                <ul className="list-disc pl-5 text-[15px]">{view.deliverables.map(d => <li key={d}>{d}</li>)}</ul>
              </>
            )}
            {view.usage_terms && <p className="text-[14px] text-muted-foreground">How you may use the content: {view.usage_terms}</p>}
          </div>
        )}
      </section>

      <CreatorShortlist token={owner.token} campaignId={view.id} open={view.open_for_answers} closedReason={view.closed_reason}
        shortlist={view.shortlist} chosen={view.chosen} passed={view.passed} />
    </CreatorsFrame>
  )
}
