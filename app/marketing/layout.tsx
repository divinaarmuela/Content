import SiteNav from '../components/SiteNav'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Ongoing Marketing & Content Systems · MD Media, Melbourne',
  description:
    'Consistent marketing, without the full-time hire. MD Media runs content, campaigns and reporting for Australian businesses. A full marketing system that runs whether you\'re in the room or not.',
  keywords:
    'ongoing marketing Melbourne, content marketing agency, social media management Australia, marketing retainer, outsourced marketing, fractional marketing team, content system',
  robots: 'index, follow, max-image-preview:large',
  alternates: { canonical: 'https://marketing.mdmmarketing.com.au/' },
  openGraph: {
    type: 'website',
    url: 'https://marketing.mdmmarketing.com.au/',
    title: 'Consistent marketing, without the full-time hire. · MD Media',
    description: "Agencies deliver posts. We deliver a system. Ongoing marketing for businesses who can't afford to go quiet.",
    images: 'https://static.wixstatic.com/media/c5a69a_cbe685f642bb4d75b6f9b0759d5482e2~mv2.jpg',
    siteName: 'MD Media Marketing',
    locale: 'en_AU',
  },
}

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return <><SiteNav />{children}</>
}
