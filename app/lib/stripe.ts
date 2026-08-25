import 'server-only'
import Stripe from 'stripe'

/**
 * The Stripe client, or null when this deployment has no keys.
 *
 * Booking works without Stripe — free services take bookings today. Paid
 * services simply refuse politely until the keys are set, rather than the
 * whole module throwing at import time and taking the public page with it.
 *
 * Keys live only in the environment (Vercel sensitive env vars), never in
 * source, and are never logged.
 */

let cached: Stripe | null | undefined

/**
 * The API version is PINNED, not inherited.
 *
 * Without this the SDK follows the account's default version — and this
 * account still defaults to 2020-03-02, which predates embedded Checkout
 * entirely. Every session was rejected with "invalid parameter: ui_mode".
 * Pinning also means a change to the account default cannot silently alter
 * how this code behaves.
 */
const API_VERSION = '2026-07-29.dahlia'

export function stripeClient(): Stripe | null {
  if (cached !== undefined) return cached
  const key = process.env.STRIPE_SECRET_KEY?.trim()
  cached = key
    ? new Stripe(key, { apiVersion: API_VERSION as Stripe.StripeConfig['apiVersion'] })
    : null
  return cached
}

/** Is card payment actually wired up on this deployment? */
export function stripeReady(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY?.trim())
}

export const STRIPE_WEBHOOK_SECRET = () => process.env.STRIPE_BOOKING_WEBHOOK_SECRET?.trim() ?? ''
