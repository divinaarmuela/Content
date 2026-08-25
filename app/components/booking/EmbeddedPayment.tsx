'use client'

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

export default function EmbeddedPayment({ clientSecret }: { clientSecret: string }) {
  if (!stripePromise) {
    return (
      <p className="border p-4 text-sm" style={{ borderColor: 'var(--bk-line)', opacity: 0.8 }}>
        Card payment isn&rsquo;t switched on yet. Email{' '}
        <a href="mailto:contact@mdmmarketing.com.au" className="underline">contact@mdmmarketing.com.au</a>{' '}
        and we&rsquo;ll take payment another way — your time is held.
      </p>
    )
  }
  return (
    <div className="overflow-hidden rounded-lg bg-white">
      <EmbeddedCheckoutProvider stripe={stripePromise} options={{ clientSecret }}>
        <EmbeddedCheckout />
      </EmbeddedCheckoutProvider>
    </div>
  )
}
