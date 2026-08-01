import SiteNav from '../components/SiteNav'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Services — MD Media Marketing, Melbourne',
  description:
    'Content production, ongoing marketing, branding, personal brand, podcast studio, and website optimisation. One team, one system, built in-house in Melbourne.',
  robots: 'index, follow',
  alternates: { canonical: 'https://www.mdmmarketing.com.au/services' },
  openGraph: {
    type: 'website',
    url: 'https://www.mdmmarketing.com.au/services',
    title: 'Services — MD Media Marketing',
    description: 'Content, marketing, branding, and strategy built as one system.',
    siteName: 'MD Media Marketing',
    locale: 'en_AU',
  },
}

export default function ServicesLayout({ children }: { children: React.ReactNode }) {
  return <><SiteNav />{children}</>
}
