'use client'

import { useEffect } from 'react'
import { utmFrom, withUtm, type Utm } from './lib/utm-core'

/** Keeps the ad's utm_* tags for the visit and puts them on any Calendly link clicked. See app/lib/utm-core.ts. */
const KEY = 'mdm_utm'

function stored(): Utm {
  try { return JSON.parse(sessionStorage.getItem(KEY) || '{}') as Utm } catch { return {} }
}

export default function UtmPassthrough() {
  useEffect(() => {
    const fresh = utmFrom(window.location.search)
    if (Object.keys(fresh).length) { try { sessionStorage.setItem(KEY, JSON.stringify(fresh)) } catch {} }
    const onClick = (e: MouseEvent) => {
      const a = (e.target as Element | null)?.closest?.('a[href*="calendly.com"]') as HTMLAnchorElement | null
      if (!a) return
      const utm = { ...stored(), ...utmFrom(window.location.search) }
      const next = withUtm(a.href, utm)
      if (next !== a.href) a.href = next
    }
    document.addEventListener('click', onClick, true)
    document.addEventListener('auxclick', onClick, true)
    return () => { document.removeEventListener('click', onClick, true); document.removeEventListener('auxclick', onClick, true) }
  }, [])
  return null
}
