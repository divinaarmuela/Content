'use client'
import { useParams } from 'next/navigation'
import SocialChannels from '../../SocialChannels'
import InstagramLocations from '../../InstagramLocations'
import ClientApproval from '../../ClientApproval'
import MetaDirectInstagram from '../../MetaDirectInstagram'
import MetaDirectFacebook from '../../MetaDirectFacebook'
import MdAppDirect from '../../MdAppDirect'
import { useRole } from '../../../useRole'

export default function ClientSocialPage() {
  const { id } = useParams<{ id: string }>()
  const { can } = useRole()
  return (
    <div className="flex flex-col gap-5">
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
      {/* The agency's own Instagram Login, for testing (1 Oct 2026). Last,
          and drawn for super admins only, so it stays out of the way of the
          channels above, which is where posting still happens. */}
      <MetaDirectInstagram clientId={id} />
      {/* …and its Facebook Page twin (6 Nov 2026). */}
      <MetaDirectFacebook clientId={id} />
      {/* MD App, Meta's new app with Unified Login (6 Nov 2026) — super admins only, opt-in per client. */}
      <MdAppDirect clientId={id} />
    </div>
  )
}
