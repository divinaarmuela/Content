'use client'
import { useParams } from 'next/navigation'
import NotesPanel from '../NotesPanel'

export default function ClientNotesPage() {
  const { id } = useParams<{ id: string }>()
  return <NotesPanel clientId={id} />
}
