'use client'
import { useParams } from 'next/navigation'
import IntakePanel from '../IntakePanel'

export default function ClientIntakePage() {
  const { id } = useParams<{ id: string }>()
  return <IntakePanel clientId={id} />
}
