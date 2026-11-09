'use client'

import { useEffect } from 'react'
import { utmFrom, withUtm, readStoredUtm, storeUtm } from './lib/utm-core'

/**
 * Keeps the ad's utm_* tags and puts them on any Calendly link clicked. See app/lib/utm-core.ts.
 * The tags leave the address bar on the next page — that is normal; they are remembered here (30 days, every tab,
 * owner 9 Nov 2026: "when i go … to strategy consulting page params are gone") and added at the moment of the click.
 */
export default function UtmPassthrough() {
  useEffect(() => {
    const fresh = utmFrom(window.location.search)
    if (Object.keys(fresh).length) storeUtm(fresh)
    const onClick = (e: MouseEvent) => {
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
