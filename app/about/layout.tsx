import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'About — MD Media Marketing, Melbourne',
  description:
    'Founded in 2024 by Divina Armuela and Martin Kormushoski. A Melbourne studio of 15 running content ecosystems for businesses across finance, hospitality, real estate, health, automotive, and personal brands.',
  robots: 'index, follow',
  alternates: { canonical: 'https://www.mdmmarketing.com.au/about' },
  openGraph: {
    type: 'website',
    url: 'https://www.mdmmarketing.com.au/about',
    title: 'About — MD Media Marketing',
    description: 'The people behind MD Media, and why the studio exists.',
    siteName: 'MD Media Marketing',
    locale: 'en_AU',
  },
}

export default function AboutLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
