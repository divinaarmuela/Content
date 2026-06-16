'use client'

import { useState } from 'react'

export default function FooterLogo() {
  const [ok, setOk] = useState(true)
  return (
    <a href="/" className="footer-mast" aria-label="MD Media Marketing home">
      {ok ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src="/MDLogo-trim.png"
          alt="MD Media Marketing"
          className="footer-logo-img"
          onError={() => setOk(false)}
        />
      ) : (
        'MD Media Marketing'
      )}
    </a>
  )
}
