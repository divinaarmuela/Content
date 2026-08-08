'use client'

import Script from 'next/script'
import { usePathname } from 'next/navigation'

/**
 * Microsoft Clarity, on the public marketing site only.
 *
 * The app shell is deliberately excluded: a session recorder on /dashboard
 * would ship footage of the CMS — client names, credentials panels, lead
 * details — to a third party, and on /intake it would record clients typing
 * confidential answers. Clarity is for anonymous visitor behaviour, and the
 * marketing pages are the only place visitors are anonymous.
 */
const EXCLUDED = ['/dashboard', '/client', '/portal', '/intake', '/sign-in', '/sign-up']

export default function Clarity() {
  const pathname = usePathname()
  if (EXCLUDED.some(p => pathname.startsWith(p))) return null

  return (
    <Script id="ms-clarity" strategy="afterInteractive">
      {`(function(c,l,a,r,i,t,y){
        c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};
        t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;
        y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);
      })(window, document, "clarity", "script", "xxvbhobyfb");`}
    </Script>
  )
}
