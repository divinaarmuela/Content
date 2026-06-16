import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Our Work — MD Media Marketing, Melbourne',
  description:
    'Client work across hospitality, finance, fashion, automotive, and personal brands. Real results from real campaigns.',
  robots: 'index, follow',
  alternates: { canonical: 'https://www.mdmmarketing.com.au/work' },
  openGraph: {
    type: 'website',
    url: 'https://www.mdmmarketing.com.au/work',
    title: 'Our Work — MD Media Marketing',
    description: 'Client work across hospitality, finance, fashion, and personal brands.',
    images: 'https://static.wixstatic.com/media/c5a69a_cbe685f642bb4d75b6f9b0759d5482e2~mv2.jpg',
    siteName: 'MD Media Marketing',
    locale: 'en_AU',
  },
}

export default function WorkLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
