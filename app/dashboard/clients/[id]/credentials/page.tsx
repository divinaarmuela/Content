'use client'
import { useParams } from 'next/navigation'
import CredentialsPanel from '../../../CredentialsPanel'

export default function ClientCredentialsPage() {
  const { id } = useParams<{ id: string }>()
  return <CredentialsPanel endpoint={`/api/website/clients/${id}/credentials`} />
}
