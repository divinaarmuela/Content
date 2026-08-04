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

// No nav here. The journal pages moved to the dark lama system and bring their
// own LamaNav; leaving SiteNav in this layout rendered two navigations at once
// — the same bug that took the marketing homepage down earlier.
export default function JournalLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
