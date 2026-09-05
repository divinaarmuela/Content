'use client'
import { useParams } from 'next/navigation'
import SocialChannels from '../../SocialChannels'
import InstagramLocations from '../../InstagramLocations'
import ClientApproval from '../../ClientApproval'
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
    </div>
  )
}
