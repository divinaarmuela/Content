import SiteNav from '../components/SiteNav'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Founder Personal Branding — MD Media, Melbourne',
  description:
    "AI can write. It can't be you. We help founders build the personal brand AI can't fake.",
  keywords:
    'personal brand Melbourne, founder content, personal branding agency Australia, thought leadership content, founder brand strategy',
  robots: 'index, follow, max-image-preview:large',
  alternates: { canonical: 'https://personalbrand.mdmmarketing.com.au/' },
  openGraph: {
    type: 'website',
    url: 'https://personalbrand.mdmmarketing.com.au/',
    title: "AI can write. It can't be you. — MD Media",
    description: "We help founders build the personal brand AI can't fake.",
    images: 'https://static.wixstatic.com/media/c5a69a_f7f8354362924f419652f444431d3d59~mv2.jpg',
    siteName: 'MD Media Marketing',
    locale: 'en_AU',
  },
}

export default function PersonalBrandLayout({ children }: { children: React.ReactNode }) {
  return <><SiteNav />{children}</>
}
