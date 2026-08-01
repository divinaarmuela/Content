import SiteNav from '../components/SiteNav'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Journal — MD Media Marketing, Melbourne',
  description:
    'Straight talk on marketing, content, and brand for Australian businesses. Why the known business beats the best one, and what to do about it.',
  robots: 'index, follow',
  alternates: { canonical: 'https://www.mdmmarketing.com.au/journal' },
  openGraph: {
    type: 'website',
    url: 'https://www.mdmmarketing.com.au/journal',
    title: 'Journal — MD Media Marketing',
    description: 'Straight talk on marketing, content, and brand for Australian businesses.',
    siteName: 'MD Media Marketing',
    locale: 'en_AU',
  },
}

export default function JournalLayout({ children }: { children: React.ReactNode }) {
  return <><SiteNav />{children}</>
}
