import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Content Production & Creative Assets · MD Media, Melbourne',
  description:
    'Content that gets likes is a hobby. Content that converts is a business. MD Media produces photography, video, and copy engineered to sell. Monthly subscription or project-based production.',
  keywords:
    'content production Melbourne, video production Australia, photography agency, content subscription, creative assets, UGC production, brand content studio',
  robots: 'index, follow, max-image-preview:large',
  alternates: {
    canonical: 'https://www.mdmmarketing.com.au/content',
  },
  openGraph: {
    type: 'website',
    url: 'https://www.mdmmarketing.com.au/content',
    title: 'Content that gets likes is a hobby. Content that converts is a business. · MD Media',
    description:
      'Photography, video, and copy engineered to sell. Melbourne-based studio, Australia-wide production.',
    images: 'https://static.wixstatic.com/media/c5a69a_cbe685f642bb4d75b6f9b0759d5482e2~mv2.jpg',
    siteName: 'MD Media Marketing',
    locale: 'en_AU',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Content that gets likes is a hobby. Content that converts is a business.',
    description: 'Photography, video, and copy engineered to sell.',
    images: 'https://static.wixstatic.com/media/c5a69a_cbe685f642bb4d75b6f9b0759d5482e2~mv2.jpg',
  },
}

export default function ContentLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
