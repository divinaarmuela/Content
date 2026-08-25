'use client'

import { useEffect, useRef } from 'react'
import { loadStripe } from '@stripe/stripe-js'
import { EmbeddedCheckoutProvider, EmbeddedCheckout } from '@stripe/react-stripe-js'

/**
 * The payment step, rendered inside the booking page.
 *
 * Stripe still owns the card fields — they live in an iframe it controls —
 * so card data never touches our page and 3-D Secure, Apple Pay, Google Pay
 * and Link all keep working. What changes is that the customer never leaves:
 * no redirect, no new tab, no losing them to a Stripe-branded page mid-flow.
 *
 * The publishable key is designed to be public (it identifies the account and
 * can do nothing on its own); the secret key stays on the server.
 */

const PUBLISHABLE = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY?.trim()

// created once per page load, not per render — loadStripe injects a script
const stripePromise = PUBLISHABLE ? loadStripe(PUBLISHABLE) : null

export default function EmbeddedPayment(
  { clientSecret, onComplete }: { clientSecret: string; onComplete?: () => void },
) {
  const box = useRef<HTMLDivElement>(null)

  /**
   * Bring the card form into view once it EXISTS.
   *
   * Scrolling when the step changes aims at whatever is there at that
   * instant — the heading — because Stripe's iframe has not mounted yet and
   * has no height. On a phone that leaves you looking at a title with the
   * form somewhere below, having to hunt for it. Two frames later the iframe
   * is real, so that is when we move.
   */
  useEffect(() => {
    const t = window.setTimeout(() => {
      box.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 350)
    return () => window.clearTimeout(t)
  }, [clientSecret])

  if (!stripePromise) {
    return (
      <p className="border p-4 text-sm" style={{ borderColor: 'var(--bk-line)', opacity: 0.8 }}>
        Card payment isn&rsquo;t switched on yet. Email{' '}
        <a href="mailto:contact@mdmmarketing.com.au" className="underline text-inherit">contact@mdmmarketing.com.au</a>{' '}
        and we&rsquo;ll take payment another way — your time is held.
      </p>
    )
  }
  return (
    <div ref={box} className="overflow-hidden rounded-lg bg-white" style={{ scrollMarginTop: 88 }}>
      <EmbeddedCheckoutProvider stripe={stripePromise} options={{ clientSecret, onComplete }}>
        <EmbeddedCheckout />
      </EmbeddedCheckoutProvider>
    </div>
  )
}
