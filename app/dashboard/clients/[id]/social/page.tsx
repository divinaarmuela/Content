'use client'
import { useParams } from 'next/navigation'
import SocialChannels from '../../SocialChannels'

export default function ClientSocialPage() {
  const { id } = useParams<{ id: string }>()
  return <SocialChannels clientId={id} />
}
