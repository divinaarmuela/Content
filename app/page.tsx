import type { Metadata } from 'next'
import SiteNav from './components/SiteNav'
import HomeVideoHero from './components/home/HomeVideoHero'
import HomeLogoStrip from './components/home/HomeLogoStrip'
import HomeProblem from './components/home/HomeProblem'
import HomeSolution from './components/home/HomeSolution'
import HomeServices from './components/home/HomeServices'
import HomeHowItWorks from './components/home/HomeHowItWorks'
import HomeWhyUs from './components/home/HomeWhyUs'
import HomeTestimonial from './components/home/HomeTestimonial'
import HomeCtaBanner from './components/home/HomeCtaBanner'
import SiteFooter from './components/SiteFooter'

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

export default function HomePage() {
  return (
    <>
      <SiteNav />
      <main>
        <HomeVideoHero />
        <HomeLogoStrip />
        <HomeProblem />
        <HomeSolution />
        <HomeServices />
        <HomeHowItWorks />
        <HomeWhyUs />
        <HomeTestimonial />
        <HomeCtaBanner />
      </main>
      <SiteFooter vol="Vol. 03 // MD Media" tagline={<>Strategy. Content. Distribution.<br />Built for founders and local businesses ready to stop blending in.</>} />
    </>
  )
}
