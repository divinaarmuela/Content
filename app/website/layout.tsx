import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Website Design & Optimisation · MD Media, Melbourne',
  description:
    'Websites that convert, not just exist. MD Media designs, builds, and optimises sites with SEO, copy, and conversion in mind. WordPress, Shopify, Squarespace, and custom.',
  keywords:
    'website design Melbourne, website optimisation, conversion rate optimisation, SEO agency Australia, Shopify developer, WordPress design, landing page design',
  robots: 'index, follow, max-image-preview:large',
  alternates: { canonical: 'https://www.mdmmarketing.com.au/website' },
  openGraph: {
    type: 'website',
    url: 'https://www.mdmmarketing.com.au/website',
    title: 'Website Design & Optimisation · MD Media, Melbourne',
    description:
      'Design, SEO, copy, and conversion optimisation. Built to turn visitors into customers.',
    images: 'https://static.wixstatic.com/media/c5a69a_cbe685f642bb4d75b6f9b0759d5482e2~mv2.jpg',
    siteName: 'MD Media Marketing',
    locale: 'en_AU',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Website Design & Optimisation · MD Media, Melbourne',
    description: 'Design, SEO, copy, and conversion optimisation. Built to turn visitors into customers.',
    images: 'https://static.wixstatic.com/media/c5a69a_cbe685f642bb4d75b6f9b0759d5482e2~mv2.jpg',
  },
}

export default function WebsiteLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
