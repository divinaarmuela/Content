import SiteNav from '../components/SiteNav'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'The Room — Events by MD Media, Melbourne',
  description:
    'Small, invite-first rooms for Melbourne business owners and operators. No pitches, no panels reading slides — real conversations about growing a business.',
  robots: 'index, follow',
  alternates: { canonical: 'https://www.mdmmarketing.com.au/events' },
  openGraph: {
    type: 'website',
    url: 'https://www.mdmmarketing.com.au/events',
    title: 'The Room — Events by MD Media',
    description: 'Small, invite-first rooms for Melbourne business owners and operators.',
    siteName: 'MD Media Marketing',
    locale: 'en_AU',
  },
}

export default function EventsLayout({ children }: { children: React.ReactNode }) {
  return <><SiteNav />{children}</>
}
