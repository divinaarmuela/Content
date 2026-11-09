'use client'
import { useParams } from 'next/navigation'
import SocialChannels from '../../SocialChannels'
import InstagramLocations from '../../InstagramLocations'
import ClientApproval from '../../ClientApproval'
import MdAppDirect from '../../MdAppDirect'
import { useRole } from '../../../useRole'
import { useUser } from '@clerk/nextjs'
import { isReviewer } from '@/app/lib/reviewer-lock-core'

export default function ClientSocialPage() {
  const { id } = useParams<{ id: string }>()
  const { can } = useRole()
  // Meta's reviewer sees the Meta card and nothing else (owner, 10 Nov 2026: hide the channels, approvals and places
  // below it — they belong to our other posting tool and would only confuse the review)
  const reviewer = isReviewer(useUser().user?.id)
  if (reviewer) return <div className="flex flex-col gap-5"><MdAppDirect clientId={id} /></div>
  return (
    <div className="flex flex-col gap-5">
      {/* MD App, Meta's app with one login (6 Nov 2026) — first on the page (9 Nov 2026): it is what Meta's reviewer opens. */}
      <MdAppDirect clientId={id} />
      <SocialChannels clientId={id} />
      {/* Whether this client sees every post before it goes out. It lives
          here, above the places and the channels, because it is the rule the
          Schedule page's buttons are built on — and because until it had a
          screen the only way to honour a client's agreement was to edit the
          database by hand. */}
      <ClientApproval clientId={id} mayEdit={can('account_manager')} />
      {/* The places posts can be tagged at. It lives beside the channels
          because it is the same kind of thing — a setting about this client's
          accounts that the composer then just uses. */}
      <InstagramLocations clientId={id} />
      {/* The two cards for the OLD Meta app (MetaDirectInstagram, MetaDirectFacebook) are no longer drawn
          (6 Nov 2026): Meta's reviewer must see one Meta card only. Their files and routes stay. */}
      {/* MD App, Meta's new app with Unified Login (6 Nov 2026) — super admins only, opt-in per client. */}
    </div>
  )
}
