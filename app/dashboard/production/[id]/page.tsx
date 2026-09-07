'use client'

import { useParams } from 'next/navigation'
import CardDetail from './CardDetail'

/**
 * THE CARD PAGE — the full page a direct link, an email or the portal lands
 * on. Everything on it is `CardDetail`, the same component the boards slide
 * in from the right; this file only reads the id out of the address.
 */
export default function ItemDetailPage() {
  const { id } = useParams<{ id: string }>()
  return <CardDetail id={id} layout="page" />
}
