'use client'
import { useParams } from 'next/navigation'
import SocialChannels from '../../SocialChannels'
import InstagramLocations from '../../InstagramLocations'

export default function ClientSocialPage() {
  const { id } = useParams<{ id: string }>()
  return (
    <div className="flex flex-col gap-5">
      <SocialChannels clientId={id} />
      {/* The places posts can be tagged at. It lives beside the channels
          because it is the same kind of thing — a setting about this client's
          accounts that the composer then just uses. */}
      <InstagramLocations clientId={id} />
    </div>
  )
}
