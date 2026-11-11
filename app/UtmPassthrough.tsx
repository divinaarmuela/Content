'use client'

import { useEffect } from 'react'
import { utmFrom, withUtm, readStoredUtm, storeUtm, rememberFirstVisit } from './lib/utm-core'
import { withFrom } from './lib/book-call-core'

/**
 * Keeps the ad's utm_* tags and puts them on any Calendly link clicked. See app/lib/utm-core.ts.
 * The tags leave the address bar on the next page — that is normal; they are remembered here (30 days, every tab,
 * owner 9 Nov 2026: "when i go … to strategy consulting page params are gone") and added at the moment of the click.
 */
export default function UtmPassthrough() {
  useEffect(() => {
    const fresh = utmFrom(window.location.search)
    if (Object.keys(fresh).length) storeUtm(fresh)
    let referrer: string | null = null
    try { const r = document.referrer ? new URL(document.referrer) : null; referrer = r && r.hostname !== window.location.hostname ? r.hostname : null } catch {}
    rememberFirstVisit({ at: new Date().toISOString(), landing: window.location.pathname, referrer, utm: fresh })
    const onClick = (e: MouseEvent) => {
      // /book-call (11 Nov 2026): the page this button was on travels with it, so Leads can say "Booked from"
      const toBook = (e.target as Element | null)?.closest?.('a[href*="/book-call"]') as HTMLAnchorElement | null
      if (toBook) {
        const next = withFrom(toBook.getAttribute('href') ?? '', window.location.origin, window.location.pathname)
        if (next !== toBook.getAttribute('href')) toBook.setAttribute('href', next)
        return
      }
      const a = (e.target as Element | null)?.closest?.('a[href*="calendly.com"]') as HTMLAnchorElement | null
      if (!a) return
      const utm = { ...readStoredUtm(), ...utmFrom(window.location.search) }
      const next = withUtm(a.href, utm, window.location.pathname)
      if (next !== a.href) a.href = next
    }
    document.addEventListener('click', onClick, true)
    document.addEventListener('auxclick', onClick, true)
    return () => { document.removeEventListener('click', onClick, true); document.removeEventListener('auxclick', onClick, true) }
  }, [])
  return null
}
