'use client'
import { useParams } from 'next/navigation'
import ContactsPanel from '../ContactsPanel'

export default function ClientContactsPage() {
  const { id } = useParams<{ id: string }>()
  return <ContactsPanel clientId={id} />
}
