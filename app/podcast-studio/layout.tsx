import SiteNav from '../components/SiteNav'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Podcast & Content Studio Hire · MD Media, Melbourne',
  description:
    "Melbourne's plug-and-play podcast and content studio. Multi-cam, broadcast audio, and full lighting. Book by the hour, half-day, or fully produced with our in-house crew.",
  keywords:
    'podcast studio Melbourne, podcast studio hire, content studio rental, video studio Melbourne, podcast recording studio, studio hire Australia, multi-camera podcast studio',
  robots: 'index, follow, max-image-preview:large',
  alternates: { canonical: 'https://www.mdmmarketing.com.au/podcast-studio' },
  openGraph: {
    type: 'website',
    url: 'https://www.mdmmarketing.com.au/podcast-studio',
    title: 'Podcast & Content Studio Hire · MD Media, Melbourne',
    description:
      'Plug-and-play podcast studio. Multi-cam, broadcast audio, full lighting. Book the room, or book the room and the crew.',
    images: 'https://static.wixstatic.com/media/c5a69a_cbe685f642bb4d75b6f9b0759d5482e2~mv2.jpg',
    siteName: 'MD Media Marketing',
    locale: 'en_AU',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Podcast & Content Studio Hire · MD Media, Melbourne',
    description: 'Plug-and-play podcast studio. Multi-cam, broadcast audio, full lighting.',
    images: 'https://static.wixstatic.com/media/c5a69a_cbe685f642bb4d75b6f9b0759d5482e2~mv2.jpg',
  },
}

export default function PodcastStudioLayout({ children }: { children: React.ReactNode }) {
  return <><SiteNav />{children}</>
}
