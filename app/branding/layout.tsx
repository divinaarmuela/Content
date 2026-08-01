import SiteNav from '../components/SiteNav'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Brand Strategy & Identity — MD Media, Melbourne',
  description:
    "Looking like everyone else is a strategy too. Just a bad one. MD Media builds distinct brand identities, strategies and messaging systems. Melbourne based, Australia-wide.",
  keywords:
    'brand strategy Melbourne, brand identity design, rebrand agency, visual identity Australia, brand positioning, brand messaging',
  robots: 'index, follow, max-image-preview:large',
  alternates: { canonical: 'https://brand.mdmmarketing.com.au/' },
  openGraph: {
    type: 'website',
    url: 'https://brand.mdmmarketing.com.au/',
    title: 'Looking like everyone else is a strategy. Just a bad one. — MD Media',
    description: "We build brands people can't ignore, and competitors can't copy.",
    images: 'https://static.wixstatic.com/media/c5a69a_8ff71d938a1447a1b0987a2bb9272b1c~mv2.jpg',
    siteName: 'MD Media Marketing',
    locale: 'en_AU',
  },
}

export default function BrandingLayout({ children }: { children: React.ReactNode }) {
  return <><SiteNav />{children}</>
}
