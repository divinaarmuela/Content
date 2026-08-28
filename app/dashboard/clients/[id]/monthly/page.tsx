'use client'
import { useParams } from 'next/navigation'
import MonthlyPanel from '../MonthlyPanel'

export default function ClientMonthlyPage() {
  const { id } = useParams<{ id: string }>()
  return <MonthlyPanel clientId={id} />
}
