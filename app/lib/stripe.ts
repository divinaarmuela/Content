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

export function stripeClient(): Stripe | null {
  if (cached !== undefined) return cached
  const key = process.env.STRIPE_SECRET_KEY?.trim()
  cached = key ? new Stripe(key) : null
  return cached
}

/** Is card payment actually wired up on this deployment? */
export function stripeReady(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY?.trim())
}

export const STRIPE_WEBHOOK_SECRET = () => process.env.STRIPE_BOOKING_WEBHOOK_SECRET?.trim() ?? ''
