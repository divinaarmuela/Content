'use client'

import { useEffect, useRef } from 'react'
import Script from 'next/script'
import { usePathname } from 'next/navigation'

/**
 * MD Media's Meta Pixel (9 Nov 2026, the owner: "add this to the website"), on the public marketing site only —
 * the same pages as Clarity.tsx and for the same reason: the signed-in app, the client portal, intake forms and
 * sign-in are never tracked, so no client, team member or Meta App Reviewer is sent to Meta as a "visitor".
 * PageView fires on the first load and again on every client-side page change (the site is a single-page app).
 */
const PIXEL_ID = '1989040118499701'
const EXCLUDED = ['/dashboard', '/client', '/portal', '/intake', '/sign-in', '/sign-up']

declare global { interface Window { fbq?: (...args: unknown[]) => void } }

export default function MetaPixel() {
  const pathname = usePathname()
  const excluded = EXCLUDED.some(p => pathname.startsWith(p))
  const first = useRef(true)

  useEffect(() => {
    if (excluded) return
    if (first.current) { first.current = false; return } // the snippet's own PageView covers the first page
    window.fbq?.('track', 'PageView')
  }, [pathname, excluded])

  if (excluded) return null
  return (
    <>
      <Script id="meta-pixel" strategy="afterInteractive">
        {`!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?
n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];
s.parentNode.insertBefore(t,s)}(window, document,'script','https://connect.facebook.net/en_US/fbevents.js');
fbq('init', '${PIXEL_ID}');
fbq('track', 'PageView');`}
      </Script>
      <noscript>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img height="1" width="1" style={{ display: 'none' }} alt="" src={`https://www.facebook.com/tr?id=${PIXEL_ID}&ev=PageView&noscript=1`} />
      </noscript>
    </>
  )
}
