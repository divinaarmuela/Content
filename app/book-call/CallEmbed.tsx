'use client'

import { useEffect, useState } from 'react'
import Script from 'next/script'
import { calendlyEmbedUrl, CALENDLY_CALL_URL } from '../lib/book-call-core'
import { readStoredUtm, utmFrom } from '../lib/utm-core'

declare global {
  interface Window {
    fbq?: (...args: unknown[]) => void
    Calendly?: { initInlineWidget: (o: { url: string; parentElement: HTMLElement }) => void }
  }
}

/**
 * The Calendly calendar, embedded. Built in the browser because the tags it carries (an ad's utm_* kept for 30 days,
 * the page the visitor came from) only exist there.
 *
 * BOOKING → META PIXEL: Calendly's embed tells this page `calendly.event_scheduled` when a booking completes
 * (Calendly docs, "Notifying the parent window"). We fire Meta's standard `Schedule` event from OUR page then — first
 * party, so ads keep counting bookings whether or not Calendly's own pixel fires inside the embedded frame (its docs
 * do not say it does). Only messages from https://calendly.com are believed.
 */
export default function CallEmbed() {
  const [url, setUrl] = useState<string | null>(null)
  const [height, setHeight] = useState(1100)
  const [done, setDone] = useState(false)

  useEffect(() => {
    const q = new URLSearchParams(window.location.search)
    setUrl(calendlyEmbedUrl({
      utm: { ...readStoredUtm(), ...utmFrom(window.location.search) },
      from: q.get('from'),
      cta: q.get('cta'),
    }))
  }, [])

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== 'https://calendly.com') return
      const name = typeof e.data?.event === 'string' ? e.data.event : ''
      if (name === 'calendly.page_height') {
        const px = parseInt(String(e.data?.payload?.height ?? ''), 10)
        if (px > 300) setHeight(Math.min(px + 20, 1600))
      }
      if (name === 'calendly.event_scheduled') {
        setDone(true)
        window.fbq?.('track', 'Schedule', { content_name: 'Inquiry call - MD Media' })
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])

  return (
    <div className="bc-cal">
      {url ? (
        <>
          <div className="calendly-inline-widget bc-widget" data-url={url} style={{ height }} />
          <Script src="https://assets.calendly.com/assets/external/widget.js" strategy="afterInteractive" />
        </>
      ) : (
        <div className="bc-widget bc-loading" style={{ height }}>Loading the calendar…</div>
      )}
      {done && <p className="bc-done" role="status">You&rsquo;re booked in. Check your email for the calendar invite.</p>}
      <noscript>
        <p className="bc-done"><a href={CALENDLY_CALL_URL}>Open the booking calendar</a></p>
      </noscript>
    </div>
  )
}
