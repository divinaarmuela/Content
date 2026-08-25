'use client'

import { useState } from 'react'
import { CANCELLATION_POLICY } from '../../lib/booking-core'

/**
 * The cancellation policy, and the tick that records agreeing to it.
 *
 * The policy carries money — a full refund, a 20% fee, or nothing at all —
 * so it is shown in full before anyone pays, and the agreement is stored
 * against the booking rather than assumed from what the page said that day.
 *
 * The same windows are enforced server-side by policyFor(); this text and
 * that rule read from one shared constant so they cannot drift apart.
 */

const { freeHours, feeHours, feePercent, graceMin } = CANCELLATION_POLICY

export const POLICY_SECTIONS: { heading: string; body: string[] }[] = [
  {
    heading: 'Rescheduling',
    body: [
      `You may reschedule more than ${freeHours} hours in advance at no additional cost, subject to availability.`,
    ],
  },
  {
    heading: 'Cancellations',
    body: [
      `Cancellations made more than ${freeHours} hours before your booking receive a full refund.`,
      `Cancellations made within ${freeHours} hours incur a ${feePercent}% cancellation fee. The remaining ${100 - feePercent}% is refunded.`,
      `Cancellations made less than ${feeHours} hours before the session, or failure to attend, are non-refundable.`,
    ],
  },
  {
    heading: 'Refunds',
    body: ['Eligible refunds are processed within 7 business days to the original payment method.'],
  },
  {
    heading: 'Payment terms',
    body: ['Full payment is required at the time of booking to secure your session.'],
  },
  {
    heading: 'Late arrivals',
    body: [
      `A ${graceMin}-minute grace period applies. Arrivals beyond this window may result in a shortened session, or be treated as a no-show, depending on studio availability.`,
    ],
  },
  {
    heading: 'Need something else',
    body: [
      'Anything outside these windows, or a change the page will not let you make — email contact@mdmmarketing.com.au and we will sort it out with you.',
    ],
  },
]

export default function CancellationPolicy({
  agreed, onAgreedChange, tone = 'dark',
}: {
  agreed: boolean
  onAgreedChange: (v: boolean) => void
  /** 'dark' = the booking site, 'event' = the events page palette */
  tone?: 'dark' | 'event'
}) {
  const [open, setOpen] = useState(false)
  const line = tone === 'event' ? 'rgba(255,255,255,0.16)' : 'var(--bk-line)'
  const dim = tone === 'event' ? 'rgba(255,255,255,0.6)' : undefined

  return (
    <div className="flex flex-col gap-3 border-t pt-4" style={{ borderColor: line }}>
      <div className="flex flex-col gap-1">
        <p className="text-[11px] uppercase tracking-[0.16em]" style={{ opacity: 0.55, color: dim }}>
          Cancellation policy
        </p>
        <p className="text-sm leading-relaxed" style={{ opacity: 0.8, color: dim }}>
          Please reschedule or cancel at least {freeHours} hours before your session.
          Anything else, email{' '}
          <a href="mailto:contact@mdmmarketing.com.au" style={{ textDecoration: 'underline' }}>
            contact@mdmmarketing.com.au
          </a>.
        </p>
      </div>

      <button type="button" onClick={() => setOpen(o => !o)}
        className="w-fit text-[11px] uppercase tracking-[0.14em] underline underline-offset-4"
        style={{ opacity: 0.65, color: dim }}>
        {open ? 'Hide the full policy' : 'Read the full policy'}
      </button>

      {open && (
        <div className="flex flex-col gap-3 border p-4 text-sm leading-relaxed"
          style={{ borderColor: line, color: dim }}>
          {POLICY_SECTIONS.map(s => (
            <div key={s.heading} className="flex flex-col gap-1">
              <p className="text-[11px] uppercase tracking-[0.14em]" style={{ opacity: 0.6 }}>{s.heading}</p>
              {s.body.map((b, i) => <p key={i} style={{ opacity: 0.85 }}>{b}</p>)}
            </div>
          ))}
        </div>
      )}

      <label className="flex cursor-pointer items-start gap-2.5 text-sm">
        <input
          type="checkbox"
          checked={agreed}
          onChange={e => onAgreedChange(e.target.checked)}
          className="mt-0.5 h-4 w-4 shrink-0"
          style={{ accentColor: tone === 'event' ? '#ffffff' : 'var(--bk-ink)' }}
        />
        <span style={{ opacity: 0.85, color: dim }}>
          I have read and agree to the cancellation policy of MD House.
        </span>
      </label>
    </div>
  )
}
