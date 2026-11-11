import type { Metadata } from 'next'
import MdNav from '../components/md-nav/MdNav'
import MdFooter from '../components/md-footer/MdFooter'
import { archivo, sometype } from '../components/lama/fonts'
import '../components/service-page/service-page.css'
import './book-call.css'
import CallEmbed from './CallEmbed'

/**
 * /book-call — the ONE place a call is booked (11 Nov 2026, the owner: "one dedicated booking page embedded …
 * make it book-call"). Every "Book a call" on the site lands here; the Calendly calendar is embedded inline so the
 * visitor never leaves mdmmarketing.com.au. Not to be confused with /book, the studio's paid-session bookings.
 * Rules for the links and tracking: app/lib/book-call-core.ts.
 */
export const metadata: Metadata = {
  title: 'Book a call — MD Media, Melbourne',
  description: 'Book a free 10-minute call with MD Media. Pick a time that suits you.',
  robots: 'index, follow',
  alternates: { canonical: 'https://www.mdmmarketing.com.au/book-call' },
  openGraph: {
    type: 'website',
    url: 'https://www.mdmmarketing.com.au/book-call',
    title: 'Book a call — MD Media',
    description: 'A free 10-minute call. Pick a time that suits you.',
    siteName: 'MD Media Marketing',
    locale: 'en_AU',
  },
}

export default function BookCallPage() {
  return (
    <div className={`${archivo.variable} ${sometype.variable}`}>
      <MdNav />
      <main className="cv">
        <div className="cv-wrap bc-grid">
          <div className="bc-text">
            <p className="cv-crumb">Book a call</p>
            <h1 className="cv-h1">Let&rsquo;s talk.</h1>
            <p className="cv-lead">A free 10-minute call. Tell us where you are and where you want to be, and we&rsquo;ll tell you honestly how we&rsquo;d get you there.</p>
            <ul className="bc-points">
              <li>No pitch deck, no pressure.</li>
              <li>Pick any time that suits you; you&rsquo;ll get a calendar invite straight away.</li>
              <li>Can&rsquo;t make it? Reschedule or cancel from the email.</li>
            </ul>
          </div>
          <CallEmbed />
        </div>
      </main>
      <MdFooter
        bar={
          <>
            <span><a href="https://www.instagram.com/mdmedia._" target="_blank" rel="noreferrer noopener">@mdmedia._</a> | <a href="/">mdmmarketing.com.au</a></span>
            <span>© MD Media</span>
          </>
        }
      />
    </div>
  )
}
