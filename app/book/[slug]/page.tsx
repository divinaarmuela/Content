import type { Metadata } from 'next'
import { loadPublicService } from '../../lib/booking'
import BookingFlow from './BookingFlow'

export const dynamic = 'force-dynamic'

export async function generateMetadata(
  { params }: { params: Promise<{ slug: string }> },
): Promise<Metadata> {
  const { slug } = await params
  const loaded = await loadPublicService(slug)
  if (!loaded) return { title: 'Book with MD Media' }
  return {
    title: `Book: ${loaded.service.name} — MD Media`,
    description: loaded.service.description ?? `Book ${loaded.service.name} with MD Media.`,
  }
}

/** The shareable booking link: /book/<service-slug>. Public, no login. */
export default async function BookServicePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  return <BookingFlow slug={slug} />
}
