'use client'
import { useParams } from 'next/navigation'
import BrandPanel from '../BrandPanel'

export default function ClientBrandPage() {
  const { id } = useParams<{ id: string }>()
  return <BrandPanel clientId={id} />
}
