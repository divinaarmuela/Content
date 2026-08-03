import type { Metadata } from 'next'
import { archivo, sometype } from './components/lama/fonts'
import LamaLoader from './components/lama/LamaLoader'
import LamaBackdrop from './components/lama/LamaBackdrop'
import LamaNav from './components/lama/LamaNav'
import LamaSidePanel from './components/lama/LamaSidePanel'
import LamaHero from './components/lama/LamaHero'
import LamaIntro from './components/lama/LamaIntro'
import LamaSteps from './components/lama/LamaSteps'
import LamaWork from './components/lama/LamaWork'
import LamaServices from './components/lama/LamaServices'
import LamaLogos from './components/lama/LamaLogos'
import LamaCulture from './components/lama/LamaCulture'
import LamaClient from './components/lama/LamaClient'
import LamaTeam from './components/lama/LamaTeam'
import LamaContact from './components/lama/LamaContact'
import LamaFooterBar from './components/lama/LamaFooterBar'

export const metadata: Metadata = {
  title: 'MD Media | Content-Led Marketing for Founders & Local Businesses',
  description: 'MD Media helps founders and local businesses get seen, known, and booked. Content-led marketing, plus paid ads, branding, and strategy. Book a strategy call.',
  keywords: 'Melbourne marketing agency, content marketing, personal brand, local business marketing, MD Media',
  robots: 'index, follow, max-image-preview:large',
  alternates: { canonical: 'https://www.mdmmarketing.com.au/' },
  openGraph: {
    type: 'website',
    url: 'https://www.mdmmarketing.com.au/',
    title: 'MD Media | Content-Led Marketing for Founders & Local Businesses',
    description: 'Content-led marketing for founders and local businesses. Book a strategy call.',
    images: 'https://static.wixstatic.com/media/c5a69a_cbe685f642bb4d75b6f9b0759d5482e2~mv2.jpg',
    siteName: 'MD Media',
    locale: 'en_AU',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'MD Media | Content-Led Marketing for Founders & Local Businesses',
    description: 'Content-led marketing for founders and local businesses. Book a strategy call.',
    images: 'https://static.wixstatic.com/media/c5a69a_cbe685f642bb4d75b6f9b0759d5482e2~mv2.jpg',
  },
}

// homepage work rows come from the CMS — refresh at most every 5 minutes
export const revalidate = 300

export default function HomePage() {
  return (
    <div className={`${archivo.variable} ${sometype.variable} bg-ink [&_section]:border-b-0`}>
      <LamaLoader />
      <LamaBackdrop />
      <LamaNav />
      <LamaSidePanel />
      <main className="relative z-10">
        <LamaHero />
        <LamaLogos />
        <LamaIntro />
        <LamaSteps />
        <LamaCulture />
        <LamaClient />
        <LamaServices />
        <LamaWork />
        <LamaTeam />
        <LamaContact />
      </main>
      <LamaFooterBar />
    </div>
  )
}
